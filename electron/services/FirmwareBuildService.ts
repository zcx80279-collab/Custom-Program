import { app } from 'electron';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FirmwareBuildEnvironment,
  FirmwareBuildProgressEvent,
  FirmwareBuildRequest,
  FirmwareBuildResult,
  FirmwareBuildStage,
  FirmwareBuildToolStatus,
  FirmwarePackageManifest,
  JC3636W518C_TARGET,
  validateFirmwareManifestObject,
} from '../../src/shared/firmware';
import { FirmwareFlashService } from './FirmwareFlashService';

interface ResolvedPioRunner {
  kind: 'pio_exe' | 'platformio_penv' | 'python_platformio';
  displayName: string;
  version: string;
  command: string;
  prefixArgs: string[];
}

const ALLOWED_BUILD_ENVIRONMENTS = new Set<FirmwareBuildEnvironment>([
  'jc3636w518c_usb_composite',
  'jc3636w518c_cdc_only',
]);

function execCheck(
  command: string,
  args: string[],
  timeoutMs = 6000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr ?? '').trim(),
        });
      }
    );
  });
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function isInsideDirectory(candidatePath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedBase ||
    resolvedCandidate.startsWith(resolvedBase + path.sep)
  );
}

function isDirectoryWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    const probe = path.join(dirPath, `.rmc-write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function copyDirectoryRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getSafeUserDataDir(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // Fallback if called outside ready Electron app
  }
  return path.join(os.tmpdir(), 'RoundMacroControllerV2');
}

/**
 * PlatformIO ESP32-S3 Firmware Build & Packaging Service (Electron Main Process).
 *
 * Guarantees:
 * - Never uses `shell: true`.
 * - Resolves PlatformIO CLI in PATH and standard `%USERPROFILE%\.platformio\penv` locations.
 * - Resolves `firmware/` project across dev workspace and packaged Windows `resources/firmware`.
 * - Falls back to writable `userData/firmware-workspace` when `resources/firmware` is read-only.
 * - Preserves existing `.pio/build/<env>/firmware.bin` and existing packaged `rmc-v2-firmware-package`
 *   files on build failure; only commits packaged artifacts after `pio run` succeeds.
 * - Never auto-flashes the device.
 */
export class FirmwareBuildService {
  private activeBuildProcess: ChildProcess | null = null;
  private building = false;
  private cancelled = false;

  constructor(private readonly firmwareFlashService: FirmwareFlashService) {}

  public isBuilding(): boolean {
    return this.building;
  }

  private isValidFirmwareProject(dirPath: string): boolean {
    if (!dirPath) return false;
    return (
      fs.existsSync(path.join(dirPath, 'platformio.ini')) &&
      fs.existsSync(path.join(dirPath, 'partitions_16mb.csv')) &&
      fs.existsSync(path.join(dirPath, 'src', 'main.cpp'))
    );
  }

  public resolveProjectSourceDir(): string | null {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const exeDir = path.dirname(process.execPath);

    const candidates = [
      path.resolve(__dirname, '../../../firmware'),
      path.resolve(__dirname, '../../firmware'),
      path.resolve(process.cwd(), 'firmware'),
      resourcesPath ? path.join(resourcesPath, 'firmware') : '',
      path.join(exeDir, 'resources', 'firmware'),
      path.join(exeDir, 'firmware'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (this.isValidFirmwareProject(resolved)) {
        return resolved;
      }
    }

    return null;
  }

  private resolveOutputRootForSource(sourceProjectDir: string): {
    workProjectDir: string;
    outputRootDir: string;
    usesUserDataWorkspace: boolean;
  } {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const insideResources = resourcesPath
      ? isInsideDirectory(sourceProjectDir, resourcesPath)
      : false;

    if (!insideResources && isDirectoryWritable(sourceProjectDir)) {
      return {
        workProjectDir: sourceProjectDir,
        outputRootDir: path.join(sourceProjectDir, 'dist'),
        usesUserDataWorkspace: false,
      };
    }

    const userDataDir = getSafeUserDataDir();
    return {
      workProjectDir: path.join(userDataDir, 'firmware-workspace'),
      outputRootDir: path.join(userDataDir, 'firmware-packages'),
      usesUserDataWorkspace: true,
    };
  }

  private syncSourceToWritableWorkspace(sourceProjectDir: string, workProjectDir: string): void {
    fs.mkdirSync(workProjectDir, { recursive: true });
    // Copy only source files; preserve `.pio/` build cache and any previous artifacts
    const requiredFiles = ['platformio.ini', 'partitions_16mb.csv'];
    for (const file of requiredFiles) {
      const srcFile = path.join(sourceProjectDir, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(workProjectDir, file));
      }
    }
    const sourceDirs = ['src', 'include', 'scripts'];
    for (const dir of sourceDirs) {
      const srcSub = path.join(sourceProjectDir, dir);
      if (fs.existsSync(srcSub)) {
        copyDirectoryRecursive(srcSub, path.join(workProjectDir, dir));
      }
    }
  }

  private async resolvePioTool(): Promise<ResolvedPioRunner | null> {
    const home = os.homedir();
    const candidates: Array<{
      kind: ResolvedPioRunner['kind'];
      label: string;
      command: string;
      prefixArgs: string[];
      requireFileExists?: boolean;
    }> = [];

    if (process.platform === 'win32') {
      const pioExePenv = path.join(home, '.platformio', 'penv', 'Scripts', 'pio.exe');
      const platformioExePenv = path.join(home, '.platformio', 'penv', 'Scripts', 'platformio.exe');
      const pioPyPenv = path.join(home, '.platformio', 'penv', 'Scripts', 'python.exe');

      candidates.push(
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv pio.exe)',
          command: pioExePenv,
          prefixArgs: [],
          requireFileExists: true,
        },
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv platformio.exe)',
          command: platformioExePenv,
          prefixArgs: [],
          requireFileExists: true,
        },
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv python -m platformio)',
          command: pioPyPenv,
          prefixArgs: ['-m', 'platformio'],
          requireFileExists: true,
        },
        {
          kind: 'pio_exe',
          label: 'pio.exe (PATH)',
          command: 'pio.exe',
          prefixArgs: [],
        },
        {
          kind: 'pio_exe',
          label: 'platformio.exe (PATH)',
          command: 'platformio.exe',
          prefixArgs: [],
        },
        {
          kind: 'pio_exe',
          label: 'pio (PATH)',
          command: 'pio',
          prefixArgs: [],
        },
        {
          kind: 'python_platformio',
          label: 'py -3 -m platformio',
          command: 'py',
          prefixArgs: ['-3', '-m', 'platformio'],
        },
        {
          kind: 'python_platformio',
          label: 'python.exe -m platformio',
          command: 'python.exe',
          prefixArgs: ['-m', 'platformio'],
        }
      );
    } else {
      const pioBinPenv = path.join(home, '.platformio', 'penv', 'bin', 'pio');
      const platformioBinPenv = path.join(home, '.platformio', 'penv', 'bin', 'platformio');
      const pioPyPenv = path.join(home, '.platformio', 'penv', 'bin', 'python');

      candidates.push(
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv pio)',
          command: pioBinPenv,
          prefixArgs: [],
          requireFileExists: true,
        },
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv platformio)',
          command: platformioBinPenv,
          prefixArgs: [],
          requireFileExists: true,
        },
        {
          kind: 'platformio_penv',
          label: 'PlatformIO Core (penv python -m platformio)',
          command: pioPyPenv,
          prefixArgs: ['-m', 'platformio'],
          requireFileExists: true,
        },
        {
          kind: 'pio_exe',
          label: 'pio (PATH)',
          command: 'pio',
          prefixArgs: [],
        },
        {
          kind: 'pio_exe',
          label: 'platformio (PATH)',
          command: 'platformio',
          prefixArgs: [],
        },
        {
          kind: 'python_platformio',
          label: 'python3 -m platformio',
          command: 'python3',
          prefixArgs: ['-m', 'platformio'],
        }
      );
    }

    for (const c of candidates) {
      if (c.requireFileExists && !fs.existsSync(c.command)) {
        continue;
      }
      const res = await execCheck(c.command, [...c.prefixArgs, '--version']);
      const output = res.stdout || res.stderr;
      if (res.ok && /platformio|version\s+\d+/i.test(output)) {
        const versionLine = output.split(/\r?\n/)[0]?.trim() || 'PlatformIO';
        return {
          kind: c.kind,
          displayName: c.label,
          version: versionLine,
          command: c.command,
          prefixArgs: c.prefixArgs,
        };
      }
    }

    return null;
  }

  public async detectBuildTools(): Promise<FirmwareBuildToolStatus> {
    const runtime = process.platform === 'win32' ? 'electron-windows' : 'electron-non-windows';
    const sourceProjectDir = this.resolveProjectSourceDir();
    const resolvedTool = await this.resolvePioTool();

    const pathsInfo = sourceProjectDir ? this.resolveOutputRootForSource(sourceProjectDir) : null;

    if (!resolvedTool || !sourceProjectDir) {
      const missingReasons: string[] = [];
      if (!resolvedTool) {
        missingReasons.push(
          'PlatformIO CLI(pio / platformio)를 찾을 수 없습니다.'
        );
      }
      if (!sourceProjectDir) {
        missingReasons.push(
          'PlatformIO 펌웨어 프로젝트 폴더(firmware/platformio.ini)를 찾을 수 없습니다.'
        );
      }

      const guidance: string[] = [];
      if (!resolvedTool) {
        guidance.push(
          '방법 1 (권장): Python 3 설치 후 명령 프롬프트에서 `pip install -U platformio` 실행'
        );
        guidance.push(
          '방법 2: VS Code 확장 마켓에서 `PlatformIO IDE` 설치 (%USERPROFILE%\\.platformio\\penv\\Scripts\\pio.exe 자동 생성)'
        );
        guidance.push(
          '최초 빌드 시 ESP32-S3 툴체인(platform-espressif32) 및 Arduino 라이브러리 다운로드를 위해 인터넷 연결이 필요합니다.'
        );
      }
      if (!sourceProjectDir) {
        guidance.push(
          '앱 실행 폴더 또는 resources/firmware 내에 platformio.ini, partitions_16mb.csv, src/main.cpp가 포함되어 있는지 확인하세요.'
        );
      }

      return {
        available: false,
        runtime,
        toolKind: resolvedTool?.kind ?? 'none',
        toolDisplayName: resolvedTool ? resolvedTool.displayName : 'PlatformIO 미설치',
        toolVersion: resolvedTool?.version,
        projectFound: Boolean(sourceProjectDir),
        projectPath: sourceProjectDir ?? undefined,
        outputRootPath: pathsInfo?.outputRootDir,
        error: missingReasons.join(' '),
        installGuidance: guidance,
      };
    }

    return {
      available: true,
      runtime,
      toolKind: resolvedTool.kind,
      toolDisplayName: resolvedTool.displayName,
      toolVersion: resolvedTool.version,
      projectFound: true,
      projectPath: sourceProjectDir,
      outputRootPath: pathsInfo?.outputRootDir,
      installGuidance: [],
    };
  }

  private readFirmwareVersionFromIni(projectDir: string, envName: FirmwareBuildEnvironment): string {
    const fallback = envName === 'jc3636w518c_usb_composite' ? '2.0.0-rc1' : '2.0.0-rc1-cdc';
    try {
      const ini = fs.readFileSync(path.join(projectDir, 'platformio.ini'), 'utf-8');
      const sectionHeader = `[env:${envName}]`;
      const startIdx = ini.indexOf(sectionHeader);
      if (startIdx < 0) return fallback;
      const nextIdx = ini.indexOf('\n[', startIdx + sectionHeader.length);
      const sectionBody = nextIdx > startIdx ? ini.slice(startIdx, nextIdx) : ini.slice(startIdx);
      const match = sectionBody.match(/RMC_FIRMWARE_VERSION=\\?"([^"\\]+)\\?"/);
      return match?.[1]?.trim() || fallback;
    } catch {
      return fallback;
    }
  }

  public async startBuild(
    request: FirmwareBuildRequest,
    onProgress: (event: FirmwareBuildProgressEvent) => void
  ): Promise<FirmwareBuildResult> {
    const startedAt = Date.now();
    const envName: FirmwareBuildEnvironment = ALLOWED_BUILD_ENVIRONMENTS.has(request.environment)
      ? request.environment
      : 'jc3636w518c_usb_composite';
    const collectedLogs: string[] = [];

    const emit = (
      stage: FirmwareBuildStage,
      percent: number,
      message: string,
      logLine?: string
    ) => {
      if (logLine) {
        collectedLogs.push(logLine);
      } else {
        collectedLogs.push(`[${stage}] ${message}`);
      }
      onProgress({
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        message,
        logLine,
        timestamp: new Date().toISOString(),
      });
    };

    const fail = (
      stage: FirmwareBuildStage,
      errorCode: string,
      errorMessage: string,
      guidanceSteps: string[]
    ): FirmwareBuildResult => {
      this.building = false;
      this.activeBuildProcess = null;
      emit('FAILED', 0, errorMessage, `[ERROR:${errorCode}] ${errorMessage}`);
      return {
        ok: false,
        stage,
        environment: envName,
        durationMs: Date.now() - startedAt,
        errorCode,
        errorMessage,
        guidanceSteps,
        logs: collectedLogs,
        timestamp: new Date().toISOString(),
      };
    };

    if (this.building) {
      return {
        ok: false,
        stage: 'FAILED',
        environment: envName,
        durationMs: 0,
        errorCode: 'ALREADY_BUILDING',
        errorMessage: '이미 펌웨어 빌드가 진행 중입니다. 완료 또는 중단 후 다시 시도하세요.',
        logs: ['[ERROR:ALREADY_BUILDING] 중복 빌드 실행 차단됨'],
        timestamp: new Date().toISOString(),
      };
    }

    if (this.firmwareFlashService.isFlashing()) {
      return {
        ok: false,
        stage: 'FAILED',
        environment: envName,
        durationMs: 0,
        errorCode: 'FLASH_IN_PROGRESS',
        errorMessage: '펌웨어 설치가 진행 중일 때는 빌드를 시작할 수 없습니다.',
        logs: ['[ERROR:FLASH_IN_PROGRESS] 플래싱 중 빌드 차단됨'],
        timestamp: new Date().toISOString(),
      };
    }

    this.building = true;
    this.cancelled = false;

    let backupFirmwareBinPath: string | null = null;
    let originalFirmwareBinPath: string | null = null;

    const restoreBackupBinIfNeeded = () => {
      if (backupFirmwareBinPath && originalFirmwareBinPath && fs.existsSync(backupFirmwareBinPath)) {
        try {
          fs.copyFileSync(backupFirmwareBinPath, originalFirmwareBinPath);
        } catch {
          // Best-effort restore
        }
      }
      if (backupFirmwareBinPath && fs.existsSync(backupFirmwareBinPath)) {
        try {
          fs.unlinkSync(backupFirmwareBinPath);
        } catch {
          // Ignore cleanup failure
        }
      }
    };

    try {
      emit('CHECKING_ENV', 5, 'PlatformIO 빌드 도구 및 펌웨어 프로젝트 경로를 확인하고 있습니다...');

      const sourceProjectDir = this.resolveProjectSourceDir();
      if (!sourceProjectDir) {
        return fail(
          'CHECKING_ENV',
          'PROJECT_NOT_FOUND',
          'PlatformIO 펌웨어 프로젝트(firmware/platformio.ini)를 찾을 수 없습니다.',
          [
            '애플리케이션 설치 폴더(resources/firmware) 또는 개발 프로젝트 루트에 firmware/ 폴더가 존재하는지 확인하세요.',
            '기존에 선택하거나 패키징된 펌웨어 파일은 그대로 보존되었습니다.',
          ]
        );
      }

      const tool = await this.resolvePioTool();
      if (!tool) {
        return fail(
          'CHECKING_ENV',
          'PLATFORMIO_NOT_FOUND',
          'PlatformIO CLI(pio / platformio)가 설치되어 있지 않거나 찾을 수 없습니다.',
          [
            'Python 3 설치 후 Windows 명령 프롬프트에서 `pip install -U platformio`를 실행하세요.',
            '또는 VS Code에서 `PlatformIO IDE` 확장을 설치하면 `%USERPROFILE%\\.platformio\\penv\\Scripts\\pio.exe`가 자동 구성됩니다.',
            '설치 완료 후 "빌드 도구 다시 확인" 또는 "펌웨어 만들기"를 다시 실행하세요.',
          ]
        );
      }

      emit(
        'PREPARING',
        10,
        `빌드 환경 준비 중 (${tool.displayName} · 환경: ${envName})`,
        `[ENV] Tool: ${tool.displayName} (${tool.version}) | Source: ${sourceProjectDir}`
      );

      const { workProjectDir, outputRootDir, usesUserDataWorkspace } =
        this.resolveOutputRootForSource(sourceProjectDir);

      if (usesUserDataWorkspace) {
        this.syncSourceToWritableWorkspace(sourceProjectDir, workProjectDir);
        emit(
          'PREPARING',
          13,
          `읽기 전용 설치 경로를 보호하기 위해 사용자 작업 폴더에서 빌드를 준비했습니다.`,
          `[WORKSPACE] ${workProjectDir} -> Packages: ${outputRootDir}`
        );
      }

      // Preserve any existing `.pio/build/<env>/firmware.bin` before running PlatformIO
      const pioBuildDir = path.join(workProjectDir, '.pio', 'build', envName);
      const pioFirmwareBin = path.join(pioBuildDir, 'firmware.bin');
      if (fs.existsSync(pioFirmwareBin)) {
        originalFirmwareBinPath = pioFirmwareBin;
        backupFirmwareBinPath = path.join(pioBuildDir, `.firmware.bin.rmc_bak_${Date.now()}`);
        try {
          fs.copyFileSync(pioFirmwareBin, backupFirmwareBinPath);
        } catch {
          backupFirmwareBinPath = null;
        }
      }

      const pioArgs = [...tool.prefixArgs, 'run', '-d', workProjectDir, '-e', envName];
      emit(
        'BUILDING',
        16,
        `Guition JC3636W518C 펌웨어(${envName})를 빌드하고 있습니다...`,
        `[EXEC] ${tool.command} ${pioArgs.join(' ')}`
      );

      let currentPercent = 18;
      const buildExec = await new Promise<{
        exitCode: number | null;
        stderrAll: string;
        spawnError?: Error;
      }>((resolve) => {
        let settled = false;
        let stderrAll = '';
        let lineBuf = '';

        const child = spawn(tool.command, pioArgs, {
          cwd: workProjectDir,
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });
        this.activeBuildProcess = child;

        const handleLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line) return;

          if (/Processing\s+/i.test(line)) {
            currentPercent = Math.max(currentPercent, 22);
            emit('BUILDING', currentPercent, `PlatformIO 환경 구성 중 (${envName})...`, line);
            return;
          }
          if (/Tool Manager:|Installing\s+/i.test(line)) {
            currentPercent = Math.min(45, Math.max(currentPercent, 28));
            emit('BUILDING', currentPercent, 'ESP32-S3 툴체인/라이브러리 확인 중...', line);
            return;
          }
          if (/Scanning dependencies|Dependency Graph/i.test(line)) {
            currentPercent = Math.max(currentPercent, 38);
            emit('BUILDING', currentPercent, '라이브러리 의존성 분석 중...', line);
            return;
          }
          if (/Compiling\s+/i.test(line)) {
            currentPercent = Math.min(72, Math.max(42, currentPercent + 1));
            emit('BUILDING', currentPercent, 'C/C++ 펌웨어 소스 컴파일 중...', line);
            return;
          }
          if (/Linking\s+/i.test(line)) {
            currentPercent = Math.max(currentPercent, 76);
            emit('BUILDING', currentPercent, '펌웨어 ELF 바이너리 링크 중...', line);
            return;
          }
          if (/Building\s+.*firmware\.bin|Checking size/i.test(line)) {
            currentPercent = Math.max(currentPercent, 84);
            emit('BUILDING', currentPercent, 'firmware.bin 생성 및 플래시 크기 검사 중...', line);
            return;
          }
          if (/\[SUCCESS\]/i.test(line)) {
            currentPercent = 87;
            emit('BUILDING', currentPercent, 'PlatformIO 컴파일 성공', line);
            return;
          }

          emit('BUILDING', currentPercent, `빌드 진행 중 (${envName})...`, line);
        };

        const handleChunk = (chunk: Buffer, isErr: boolean) => {
          const text = chunk.toString('utf8');
          if (isErr) stderrAll += text;
          lineBuf += text;
          const parts = lineBuf.split(/\r?\n|\r/);
          lineBuf = parts.pop() ?? '';
          for (const part of parts) {
            handleLine(part);
          }
        };

        child.stdout?.on('data', (d: Buffer) => handleChunk(d, false));
        child.stderr?.on('data', (d: Buffer) => handleChunk(d, true));

        child.once('error', (err) => {
          if (settled) return;
          settled = true;
          resolve({ exitCode: null, stderrAll, spawnError: err });
        });

        child.once('close', (code) => {
          if (lineBuf.trim()) {
            handleLine(lineBuf);
          }
          if (settled) return;
          settled = true;
          resolve({ exitCode: code, stderrAll });
        });
      });

      this.activeBuildProcess = null;

      if (this.cancelled) {
        restoreBackupBinIfNeeded();
        return fail(
          'FAILED',
          'BUILD_CANCELLED',
          '사용자가 펌웨어 빌드를 중단했습니다. 기존 펌웨어 파일은 보존되었습니다.',
          ['필요 시 "펌웨어 만들기"를 눌러 빌드를 다시 실행하세요.']
        );
      }

      if (buildExec.spawnError) {
        restoreBackupBinIfNeeded();
        return fail(
          'BUILDING',
          'SPAWN_ERROR',
          `PlatformIO 실행 오류: ${buildExec.spawnError.message}`,
          [
            'PlatformIO CLI가 정상 설치되어 있는지 확인하세요.',
            '기존 펌웨어 파일 및 선택 상태는 변경되지 않고 보존되었습니다.',
          ]
        );
      }

      if (buildExec.exitCode !== 0) {
        restoreBackupBinIfNeeded();
        const combinedErr = `${collectedLogs.slice(-15).join('\n')}\n${buildExec.stderrAll}`;
        return this.classifyBuildFailure(combinedErr, envName, startedAt, collectedLogs);
      }

      // Build succeeded: clean up backup file
      if (backupFirmwareBinPath && fs.existsSync(backupFirmwareBinPath)) {
        try {
          fs.unlinkSync(backupFirmwareBinPath);
        } catch {
          // Ignore cleanup error
        }
      }

      // Package into rmc-v2-firmware-package via staging directory so failed packaging never corrupts existing files
      emit('PACKAGING', 90, 'rmc-v2-firmware-package 패키지 및 SHA-256 무결성 매니페스트를 생성하고 있습니다...');

      const bootloaderSrc = path.join(pioBuildDir, 'bootloader.bin');
      const partitionsSrc = path.join(pioBuildDir, 'partitions.bin');
      const firmwareSrc = path.join(pioBuildDir, 'firmware.bin');

      if (!fs.existsSync(firmwareSrc) || !fs.existsSync(bootloaderSrc) || !fs.existsSync(partitionsSrc)) {
        return fail(
          'PACKAGING',
          'MISSING_BUILD_ARTIFACTS',
          `빌드는 종료되었으나 필수 출력 파일(firmware.bin / bootloader.bin / partitions.bin)이 ${pioBuildDir}에 생성되지 않았습니다.`,
          [
            '빌드 로그의 마지막 오류 메시지를 확인하세요.',
            '기존 패키징 펌웨어 파일은 보존되었습니다.',
          ]
        );
      }

      const outDir = path.join(outputRootDir, envName);
      const stagingDir = path.join(outputRootDir, `.${envName}.staging_${Date.now()}`);
      fs.mkdirSync(stagingDir, { recursive: true });

      const candidateBootApp0 = [
        path.join(pioBuildDir, 'boot_app0.bin'),
        path.join(
          os.homedir(),
          '.platformio',
          'packages',
          'framework-arduinoespressif32',
          'tools',
          'partitions',
          'boot_app0.bin'
        ),
        path.join(outDir, 'boot_app0.bin'),
      ].find((p) => fs.existsSync(p));

      const filesToStage: Array<{
        role: 'bootloader' | 'partitions' | 'boot_app0' | 'app';
        offset: string;
        src: string;
        fileName: string;
      }> = [
        { role: 'bootloader', offset: JC3636W518C_TARGET.offsets.bootloader, src: bootloaderSrc, fileName: 'bootloader.bin' },
        { role: 'partitions', offset: JC3636W518C_TARGET.offsets.partitions, src: partitionsSrc, fileName: 'partitions.bin' },
        ...(candidateBootApp0
          ? [{ role: 'boot_app0' as const, offset: JC3636W518C_TARGET.offsets.boot_app0, src: candidateBootApp0, fileName: 'boot_app0.bin' }]
          : []),
        { role: 'app', offset: JC3636W518C_TARGET.offsets.app, src: firmwareSrc, fileName: 'firmware.bin' },
      ];

      try {
        const manifestImages: FirmwarePackageManifest['images'] = [];
        for (const item of filesToStage) {
          const stagedDest = path.join(stagingDir, item.fileName);
          fs.copyFileSync(item.src, stagedDest);
          manifestImages.push({
            role: item.role,
            offset: item.offset,
            path: item.fileName,
            sha256: sha256File(stagedDest),
          });
        }

        const firmwareVersion = this.readFirmwareVersionFromIni(workProjectDir, envName);
        const usbMode: 'TINYUSB_CDC_HID' | 'HW_CDC_ONLY' =
          envName === 'jc3636w518c_usb_composite' ? 'TINYUSB_CDC_HID' : 'HW_CDC_ONLY';

        const manifest: FirmwarePackageManifest = {
          packageFormat: 'rmc-v2-firmware-package',
          schemaVersion: '1.0.0',
          boardModel: JC3636W518C_TARGET.boardModel,
          mcu: JC3636W518C_TARGET.mcu,
          flashSize: JC3636W518C_TARGET.flashSize,
          flashMode: JC3636W518C_TARGET.flashMode,
          flashFreq: JC3636W518C_TARGET.flashFreq,
          firmwareVersion,
          environment: envName,
          usbMode,
          createdAt: new Date().toISOString(),
          images: manifestImages,
        };

        const check = validateFirmwareManifestObject(manifest);
        if (!check.ok) {
          throw new Error(check.error ?? '생성된 패키지 매니페스트 형식이 유효하지 않습니다.');
        }

        const stagedManifestPath = path.join(stagingDir, `${envName}.rmcfw.json`);
        fs.writeFileSync(stagedManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        // Commit staged files to final package directory only after full validation
        fs.mkdirSync(outDir, { recursive: true });
        for (const entry of fs.readdirSync(stagingDir)) {
          fs.copyFileSync(path.join(stagingDir, entry), path.join(outDir, entry));
        }
        fs.rmSync(stagingDir, { recursive: true, force: true });

        const finalManifestPath = path.join(outDir, `${envName}.rmcfw.json`);
        const finalFirmwareBinPath = path.join(outDir, 'firmware.bin');

        emit('PACKAGING', 96, '생성된 펌웨어를 검증 및 설치 목록에 연결하고 있습니다...', `[PACKAGE] ${finalManifestPath}`);

        const loaded = this.firmwareFlashService.buildSelectionFromPickedFile(
          finalManifestPath,
          request.installMode
        );
        if (!loaded.ok || !loaded.selection || !loaded.report) {
          return fail(
            'PACKAGING',
            'PACKAGE_LOAD_FAILED',
            loaded.error ?? '생성된 펌웨어 패키지를 검증 목록에 불러오지 못했습니다.',
            ['"펌웨어 파일 찾아보기"로 생성된 .rmcfw.json 또는 firmware.bin을 직접 선택해 확인하세요.']
          );
        }

        emit(
          'COMPLETED',
          100,
          `펌웨어 빌드 및 검증 연결 완료 (${firmwareVersion} · ${envName})`,
          `[OK] Built & loaded ${finalFirmwareBinPath}`
        );
        this.building = false;

        return {
          ok: true,
          stage: 'COMPLETED',
          environment: envName,
          firmwareVersion,
          usbMode,
          projectPathUsed: workProjectDir,
          outputDir: outDir,
          manifestPath: finalManifestPath,
          firmwareBinPath: finalFirmwareBinPath,
          selection: loaded.selection,
          report: loaded.report,
          durationMs: Date.now() - startedAt,
          logs: collectedLogs,
          timestamp: new Date().toISOString(),
        };
      } catch (pkgErr) {
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup failure
        }
        return fail(
          'PACKAGING',
          'PACKAGING_FAILED',
          `펌웨어 패키지 생성 실패: ${pkgErr instanceof Error ? pkgErr.message : String(pkgErr)}`,
          ['디스크 공간 및 쓰기 권한을 확인하세요. 기존 패키지 파일은 보존되었습니다.']
        );
      }
    } catch (err) {
      restoreBackupBinIfNeeded();
      return fail(
        'FAILED',
        'UNEXPECTED_BUILD_ERROR',
        err instanceof Error ? err.message : String(err),
        ['PlatformIO 환경 및 빌드 로그를 확인한 뒤 다시 시도하세요. 기존 펌웨어 파일은 보존되었습니다.']
      );
    } finally {
      this.building = false;
      this.activeBuildProcess = null;
    }
  }

  public cancelBuild(): { ok: boolean; error?: string } {
    if (!this.building || !this.activeBuildProcess) {
      return { ok: false, error: '진행 중인 펌웨어 빌드 작업이 없습니다.' };
    }
    this.cancelled = true;
    try {
      this.activeBuildProcess.kill();
    } catch {
      // Ignore kill error
    }
    return { ok: true };
  }

  private classifyBuildFailure(
    output: string,
    environment: FirmwareBuildEnvironment,
    startedAt: number,
    logs: string[]
  ): FirmwareBuildResult {
    this.building = false;
    let errorCode = 'PLATFORMIO_BUILD_FAILED';
    let errorMessage = `PlatformIO 펌웨어 빌드(${environment})에 실패했습니다. 아래 빌드 로그를 확인하세요.`;
    let guidanceSteps: string[] = [
      '아래 빌드 로그에서 빨간 오류(error:) 줄을 확인하세요.',
      '기존에 선택 또는 패키징된 펌웨어 파일은 변경되지 않고 그대로 보존되었습니다.',
    ];

    if (/HTTPSConnectionPool|ConnectionError|NameResolutionError|HTTPClientError|TimeoutError|Please check your internet/i.test(output)) {
      errorCode = 'NETWORK_DEPENDENCY_ERROR';
      errorMessage =
        'ESP32-S3 플랫폼 또는 라이브러리 다운로드 중 네트워크 오류가 발생했습니다. (기존 펌웨어 파일은 보존됨)';
      guidanceSteps = [
        '인터넷 연결 상태와 회사/학교 방화벽 또는 프록시 설정을 확인하세요.',
        '최초 빌드에서 espressif32 툴체인 및 ArduinoJson/GFX 라이브러리 설치가 완료되면 이후 오프라인에서도 빌드할 수 있습니다.',
      ];
    } else if (/PermissionError|Access is denied|Errno 13/i.test(output)) {
      errorCode = 'BUILD_PERMISSION_ERROR';
      errorMessage =
        '빌드 작업 경로에 대한 파일 쓰기 권한이 거부되었습니다. (기존 펌웨어 파일은 보존됨)';
      guidanceSteps = [
        '백신 프로그램이 .pio/build 폴더의 컴파일러 실행을 차단하고 있지 않은지 확인하세요.',
        '다른 프로그램(VS Code PlatformIO 등)이 동일 프로젝트 폴더를 점유 중이면 종료 후 재시도하세요.',
      ];
    } else if (/No space left on device|Errno 28/i.test(output)) {
      errorCode = 'DISK_FULL';
      errorMessage = '디스크 여유 공간이 부족하여 빌드를 완료할 수 없습니다. (기존 펌웨어 파일은 보존됨)';
      guidanceSteps = ['C: 드라이브 또는 사용자 폴더의 디스크 공간을 확보한 뒤 다시 빌드하세요.'];
    } else if (/error:|undefined reference|ld returned 1 exit status|fatal error:/i.test(output)) {
      errorCode = 'COMPILE_OR_LINK_ERROR';
      errorMessage =
        '펌웨어 소스 컴파일 또는 링크 중 오류가 발생했습니다. (기존 펌웨어 파일은 보존됨)';
      guidanceSteps = [
        '아래 빌드 로그에서 구체적인 `error:` 파일명과 행 번호를 확인하세요.',
        '기존 펌웨어 파일은 보존되었으므로 필요 시 이전 빌드로 설치할 수 있습니다.',
      ];
    }

    return {
      ok: false,
      stage: 'FAILED',
      environment,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
      guidanceSteps,
      logs,
      timestamp: new Date().toISOString(),
    };
  }
}
