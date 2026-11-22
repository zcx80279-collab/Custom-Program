import { ChildProcess, execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FirmwareFlashProgressEvent,
  FirmwareFlashRequest,
  FirmwareFlashResult,
  FirmwareFlashStage,
  FirmwareImageEntry,
  FirmwareImageRole,
  FirmwareInstallMode,
  FirmwareSelectionState,
  FirmwareToolStatus,
  FirmwareValidationReport,
  getDefaultOffsetForRole,
  JC3636W518C_TARGET,
  validateFirmwareManifestObject,
  validateSelectionImageComposition,
} from '../../src/shared/firmware';
import { SerialDeviceService } from './SerialDeviceService';

interface ResolvedToolRunner {
  kind: 'esptool_exe' | 'platformio_python' | 'python_esptool';
  displayName: string;
  version: string;
  command: string;
  prefixArgs: string[];
}

const VALID_PORT_RE = /^(COM\d{1,3}|\/dev\/tty[\w.-]+)$/i;
const VALID_OFFSET_RE = /^0x[0-9a-fA-F]{1,8}$/;
const ALLOWED_BAUD_RATES = new Set([115200, 230400, 460800, 921600]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function execCheck(command: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim(),
      });
    });
  });
}

function isInsideDirectory(candidatePath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedBase ||
    resolvedCandidate.startsWith(resolvedBase + path.sep)
  );
}

/**
 * ESP32-S3 Firmware Flash & Update Service (Electron Main Process).
 *
 * Security & Hardware Guarantees:
 * - Never executes `shell: true` or interpolated command strings.
 * - Only flashes files explicitly selected via native OS dialog or strictly contained
 *   within the selected manifest/build directory.
 * - Never invokes `erase_flash` as default behavior (preserves 0x610000 LittleFS config).
 * - Verifies ESP32-S3 image magic (0xE9, chip_id=9) and partition table magic (0xAA 0x50).
 * - Blocks concurrent flashes and disconnects normal SerialDeviceService traffic while flashing.
 */
export class FirmwareFlashService {
  private activeFlashProcess: ChildProcess | null = null;
  private flashing = false;
  private cancelled = false;
  private authorizedFiles = new Set<string>();
  private authorizedDirs = new Set<string>();

  constructor(private readonly serialDeviceService: SerialDeviceService) {}

  public isFlashing(): boolean {
    return this.flashing;
  }

  public authorizeSelectedFile(filePath: string, allowSiblingBuildDir = false): void {
    const resolved = path.resolve(filePath);
    this.authorizedFiles.add(resolved.toLowerCase());
    if (allowSiblingBuildDir) {
      this.authorizedDirs.add(path.dirname(resolved).toLowerCase());
    }
  }

  private isFileAuthorized(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const lower = resolved.toLowerCase();
    if (this.authorizedFiles.has(lower)) return true;
    for (const dirLower of this.authorizedDirs) {
      if (resolved.toLowerCase().startsWith(dirLower + path.sep)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Probes available verified ESP32-S3 flashing tools on the host system.
   */
  public async detectTools(): Promise<FirmwareToolStatus> {
    const resolved = await this.resolveFlashingTool();
    if (!resolved) {
      const runtime =
        process.platform === 'win32' ? 'electron-windows' : 'electron-non-windows';
      return {
        available: false,
        runtime,
        toolKind: 'none',
        toolDisplayName: 'esptool 미설치',
        error:
          'ESP32-S3 플래싱 도구(esptool.exe 또는 Python esptool / PlatformIO)를 찾을 수 없습니다.',
        installGuidance: [
          '방법 1 (권장): Python 3 설치 후 명령 프롬프트에서 `pip install esptool` 실행',
          '방법 2: VS Code PlatformIO IDE를 설치하고 1회 펌웨어 빌드를 실행 (자동으로 tool-esptoolpy 포함)',
          '방법 3: Espressif 공식 esptool.exe를 다운로드하여 Windows PATH 또는 앱 resources/tools/esptool.exe에 배치',
        ],
      };
    }

    return {
      available: true,
      runtime: process.platform === 'win32' ? 'electron-windows' : 'electron-non-windows',
      toolKind: resolved.kind,
      toolDisplayName: resolved.displayName,
      toolVersion: resolved.version,
      installGuidance: [],
    };
  }

  private async resolveFlashingTool(): Promise<ResolvedToolRunner | null> {
    const candidates: Array<{
      kind: ResolvedToolRunner['kind'];
      label: string;
      command: string;
      prefixArgs: string[];
    }> = [];

    // 1. Bundled esptool.exe in Electron resources/tools
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const bundledWin = path.join(resourcesPath || '', 'tools', 'esptool.exe');
    if (resourcesPath && fs.existsSync(bundledWin)) {
      candidates.push({
        kind: 'esptool_exe',
        label: '내장 esptool.exe',
        command: bundledWin,
        prefixArgs: [],
      });
    }

    // 2. esptool.exe / esptool in PATH
    if (process.platform === 'win32') {
      candidates.push({
        kind: 'esptool_exe',
        label: 'esptool.exe (PATH)',
        command: 'esptool.exe',
        prefixArgs: [],
      });
    }
    candidates.push({
      kind: 'esptool_exe',
      label: 'esptool (PATH)',
      command: 'esptool',
      prefixArgs: [],
    });

    // 3. PlatformIO penv Python + tool-esptoolpy
    const home = os.homedir();
    const pioPython =
      process.platform === 'win32'
        ? path.join(home, '.platformio', 'penv', 'Scripts', 'python.exe')
        : path.join(home, '.platformio', 'penv', 'bin', 'python');
    const pioEsptoolPy = path.join(
      home,
      '.platformio',
      'packages',
      'tool-esptoolpy',
      'esptool.py'
    );

    if (fs.existsSync(pioPython) && fs.existsSync(pioEsptoolPy)) {
      candidates.push({
        kind: 'platformio_python',
        label: 'PlatformIO esptool.py',
        command: pioPython,
        prefixArgs: [pioEsptoolPy],
      });
    }

    // 4. Python -m esptool
    if (process.platform === 'win32') {
      candidates.push({
        kind: 'python_esptool',
        label: 'py -3 -m esptool',
        command: 'py',
        prefixArgs: ['-3', '-m', 'esptool'],
      });
    }
    candidates.push({
      kind: 'python_esptool',
      label: 'python -m esptool',
      command: process.platform === 'win32' ? 'python.exe' : 'python3',
      prefixArgs: ['-m', 'esptool'],
    });

    for (const c of candidates) {
      const res = await execCheck(c.command, [...c.prefixArgs, 'version']);
      const output = res.stdout || res.stderr;
      if (res.ok && /esptool/i.test(output)) {
        const versionLine = output.split(/\r?\n/)[0]?.trim() || 'esptool';
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

  /**
   * Builds a FirmwareSelectionState from a user-selected file (manifest JSON or firmware `.bin`).
   * When selecting `firmware.bin` inside a PlatformIO build folder, safely discovers sibling
   * `bootloader.bin`, `partitions.bin`, and `boot_app0.bin` within that same folder.
   */
  public buildSelectionFromPickedFile(
    pickedPath: string,
    installMode: FirmwareInstallMode
  ): { ok: boolean; selection?: FirmwareSelectionState; report?: FirmwareValidationReport; error?: string } {
    const resolved = path.resolve(pickedPath);
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `선택한 파일을 찾을 수 없습니다: ${resolved}` };
    }

    const ext = path.extname(resolved).toLowerCase();

    // Case A: Firmware Package Manifest (.json / .rmcfw.json)
    if (ext === '.json') {
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      } catch (err) {
        return {
          ok: false,
          error: `패키지 JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const manifestCheck = validateFirmwareManifestObject(parsedRaw);
      if (!manifestCheck.ok || !manifestCheck.manifest) {
        return { ok: false, error: manifestCheck.error ?? '유효하지 않은 펌웨어 패키지입니다.' };
      }

      const manifest = manifestCheck.manifest;
      const baseDir = path.dirname(resolved);
      this.authorizeSelectedFile(resolved, true);

      const images: FirmwareImageEntry[] = [];
      for (const item of manifest.images) {
        const imgAbs = path.resolve(baseDir, item.path);
        if (!isInsideDirectory(imgAbs, baseDir)) {
          return {
            ok: false,
            error: `보안 오류: 패키지 이미지 경로(${item.path})가 패키지 폴더 외부를 참조합니다.`,
          };
        }
        // In UPDATE mode from a package manifest, keep app image by default unless initial install
        if (installMode === 'UPDATE' && item.role !== 'app') {
          continue;
        }
        images.push({
          role: item.role,
          offset: item.offset.toLowerCase(),
          fileName: path.basename(imgAbs),
          filePath: imgAbs,
          expectedSha256: item.sha256?.toLowerCase(),
        });
      }

      const selection: FirmwareSelectionState = {
        sourceType: 'MANIFEST',
        installMode,
        manifestPath: resolved,
        firmwareVersion: manifest.firmwareVersion,
        boardModel: manifest.boardModel,
        usbMode: manifest.usbMode,
        images,
      };
      const report = this.inspectSelection(selection);
      return { ok: true, selection: { ...selection, images: report.images }, report };
    }

    // Case B: Binary image (.bin)
    if (ext !== '.bin') {
      return {
        ok: false,
        error: '펌웨어 패키지(.rmcfw.json / .json) 또는 바이너리 이미지(.bin) 파일만 선택할 수 있습니다.',
      };
    }

    const baseDir = path.dirname(resolved);
    const pickedName = path.basename(resolved).toLowerCase();
    this.authorizeSelectedFile(resolved, true);

    const images: FirmwareImageEntry[] = [];

    if (pickedName === 'bootloader.bin') {
      images.push({
        role: 'bootloader',
        offset: getDefaultOffsetForRole('bootloader'),
        fileName: path.basename(resolved),
        filePath: resolved,
      });
    } else if (pickedName === 'partitions.bin') {
      images.push({
        role: 'partitions',
        offset: getDefaultOffsetForRole('partitions'),
        fileName: path.basename(resolved),
        filePath: resolved,
      });
    } else if (pickedName === 'boot_app0.bin') {
      images.push({
        role: 'boot_app0',
        offset: getDefaultOffsetForRole('boot_app0'),
        fileName: path.basename(resolved),
        filePath: resolved,
      });
    } else {
      // Selected firmware.bin (or custom app .bin)
      if (installMode === 'INITIAL_INSTALL') {
        const siblingBoot = path.join(baseDir, 'bootloader.bin');
        const siblingPart = path.join(baseDir, 'partitions.bin');
        const siblingBootApp0 = path.join(baseDir, 'boot_app0.bin');
        const pioBootApp0 = path.join(
          os.homedir(),
          '.platformio',
          'packages',
          'framework-arduinoespressif32',
          'tools',
          'partitions',
          'boot_app0.bin'
        );

        if (fs.existsSync(siblingBoot)) {
          images.push({
            role: 'bootloader',
            offset: getDefaultOffsetForRole('bootloader'),
            fileName: 'bootloader.bin',
            filePath: siblingBoot,
          });
        }
        if (fs.existsSync(siblingPart)) {
          images.push({
            role: 'partitions',
            offset: getDefaultOffsetForRole('partitions'),
            fileName: 'partitions.bin',
            filePath: siblingPart,
          });
        }
        if (fs.existsSync(siblingBootApp0)) {
          images.push({
            role: 'boot_app0',
            offset: getDefaultOffsetForRole('boot_app0'),
            fileName: 'boot_app0.bin',
            filePath: siblingBootApp0,
          });
        } else if (fs.existsSync(pioBootApp0)) {
          this.authorizeSelectedFile(pioBootApp0, false);
          images.push({
            role: 'boot_app0',
            offset: getDefaultOffsetForRole('boot_app0'),
            fileName: 'boot_app0.bin',
            filePath: pioBootApp0,
          });
        }
      }

      images.push({
        role: 'app',
        offset: getDefaultOffsetForRole('app'),
        fileName: path.basename(resolved),
        filePath: resolved,
      });
    }

    const selection: FirmwareSelectionState = {
      sourceType: 'BIN_IMAGES',
      installMode,
      boardModel: JC3636W518C_TARGET.boardModel,
      images,
    };
    const report = this.inspectSelection(selection);
    return { ok: true, selection: { ...selection, images: report.images }, report };
  }

  /**
   * Inspects every selected firmware binary (existence, size limits, ESP32-S3 header magic, SHA-256).
   */
  public inspectSelection(selection: FirmwareSelectionState): FirmwareValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const inspectedImages: FirmwareImageEntry[] = [];

    for (const entry of selection.images) {
      const inspected = this.inspectSingleImage(entry);
      inspectedImages.push(inspected);
      if (!inspected.valid && inspected.error) {
        errors.push(`${inspected.fileName}: ${inspected.error}`);
      }
    }

    const composition = validateSelectionImageComposition({
      ...selection,
      images: inspectedImages,
    });
    errors.push(...composition.errors);
    warnings.push(...composition.warnings);

    // Check if partition layout alters 0x610000 LittleFS offset
    const includesPartitions = inspectedImages.some((img) => img.role === 'partitions');
    const preservesLittleFs = !includesPartitions;

    return {
      valid: errors.length === 0,
      installMode: selection.installMode,
      preservesLittleFs,
      preservesPcConfig: true,
      errors,
      warnings,
      images: inspectedImages,
      firmwareVersion: selection.firmwareVersion,
      boardModel: selection.boardModel ?? JC3636W518C_TARGET.boardModel,
      usbMode: selection.usbMode,
    };
  }

  public inspectSingleImage(entry: FirmwareImageEntry): FirmwareImageEntry {
    const filePath = path.resolve(entry.filePath);
    const fileName = entry.fileName || path.basename(filePath);

    if (!this.isFileAuthorized(filePath)) {
      return {
        ...entry,
        fileName,
        filePath,
        valid: false,
        error: '파일 선택 창에서 승인되지 않은 경로입니다.',
      };
    }

    if (!VALID_OFFSET_RE.test(entry.offset.trim())) {
      return {
        ...entry,
        fileName,
        filePath,
        valid: false,
        error: `잘못된 플래시 오프셋(${entry.offset})입니다.`,
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return {
        ...entry,
        fileName,
        filePath,
        valid: false,
        error: '파일이 존재하지 않거나 읽을 수 없습니다.',
      };
    }

    if (!stat.isFile() || stat.size === 0) {
      return {
        ...entry,
        fileName,
        filePath,
        sizeBytes: stat.size,
        valid: false,
        error: '비어 있거나 올바른 파일이 아닙니다.',
      };
    }

    const maxSize = JC3636W518C_TARGET.maxSizes[entry.role];
    if (stat.size > maxSize) {
      return {
        ...entry,
        fileName,
        filePath,
        sizeBytes: stat.size,
        valid: false,
        error: `파일 크기(${stat.size} bytes)가 파티션 허용 한도(${maxSize} bytes)를 초과합니다.`,
      };
    }

    let headerBuf: Buffer;
    try {
      const fd = fs.openSync(filePath, 'r');
      headerBuf = Buffer.alloc(Math.min(stat.size, 32));
      fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
      fs.closeSync(fd);
    } catch (err) {
      return {
        ...entry,
        fileName,
        filePath,
        sizeBytes: stat.size,
        valid: false,
        error: `파일 헤더 읽기 실패: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let headerNote = '';

    if (entry.role === 'app' || entry.role === 'bootloader') {
      if (headerBuf[0] !== 0xe9) {
        return {
          ...entry,
          fileName,
          filePath,
          sizeBytes: stat.size,
          valid: false,
          error: `올바른 ESP32-S3 바이너리가 아닙니다 (헤더 매직 0xE9 불일치: 0x${headerBuf[0].toString(16).toUpperCase()}).`,
        };
      }
      if (headerBuf.length >= 14) {
        const chipId = headerBuf.readUInt16LE(12);
        if (chipId !== 9) {
          return {
            ...entry,
            fileName,
            filePath,
            sizeBytes: stat.size,
            valid: false,
            error: `대상 MCU가 ESP32-S3(chip_id=9)가 아닙니다 (감지된 chip_id=${chipId}). 다른 보드용 펌웨어입니다.`,
          };
        }
        headerNote = 'ESP32-S3 이미지 헤더(0xE9, chip_id=9) 확인됨';
      } else {
        headerNote = 'ESP-IDF 이미지 매직(0xE9) 확인됨';
      }
    } else if (entry.role === 'partitions') {
      if (headerBuf.length < 2 || headerBuf[0] !== 0xaa || headerBuf[1] !== 0x50) {
        return {
          ...entry,
          fileName,
          filePath,
          sizeBytes: stat.size,
          valid: false,
          error: '올바른 ESP32 파티션 테이블 바이너리(매직 0xAA50)가 아닙니다.',
        };
      }
      headerNote = 'ESP32 파티션 테이블 매직(0xAA50) 확인됨';
    } else if (entry.role === 'boot_app0') {
      headerNote = `OTA 부트 데이터 (${stat.size} bytes)`;
    }

    const actualSha = sha256File(filePath);
    if (entry.expectedSha256 && actualSha.toLowerCase() !== entry.expectedSha256.toLowerCase()) {
      return {
        ...entry,
        fileName,
        filePath,
        sizeBytes: stat.size,
        sha256: actualSha,
        valid: false,
        error: 'SHA-256 무결성 해시가 패키지 매니페스트와 일치하지 않습니다.',
      };
    }

    return {
      ...entry,
      fileName,
      filePath,
      sizeBytes: stat.size,
      sha256: actualSha,
      valid: true,
      headerNote,
    };
  }

  /**
   * Executes real ESP32-S3 flashing via `esptool` (`shell: false`), verifies hardware chip ID,
   * streams real progress events, and attempts post-flash reconnection + version verification.
   */
  public async startFlash(
    request: FirmwareFlashRequest,
    onProgress: (event: FirmwareFlashProgressEvent) => void
  ): Promise<FirmwareFlashResult> {
    const startedAt = Date.now();
    const collectedLogs: string[] = [];

    const emit = (stage: FirmwareFlashStage, percent: number, message: string, logLine?: string) => {
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
      stage: FirmwareFlashStage,
      errorCode: string,
      errorMessage: string,
      recoverySteps: string[]
    ): FirmwareFlashResult => {
      this.flashing = false;
      this.activeFlashProcess = null;
      emit('FAILED', 0, errorMessage, `[ERROR:${errorCode}] ${errorMessage}`);
      return {
        ok: false,
        stage,
        portUsed: request.portPath,
        previousFirmwareVersion: request.previousFirmwareVersion,
        deviceReconnected: false,
        durationMs: Date.now() - startedAt,
        errorCode,
        errorMessage,
        recoverySteps,
        logs: collectedLogs,
        timestamp: new Date().toISOString(),
      };
    };

    if (this.flashing) {
      return {
        ok: false,
        stage: 'FAILED',
        portUsed: request.portPath,
        deviceReconnected: false,
        durationMs: 0,
        errorCode: 'ALREADY_FLASHING',
        errorMessage: '이미 펌웨어 설치가 진행 중입니다. 완료 또는 취소 후 다시 시도하세요.',
        logs: ['[ERROR:ALREADY_FLASHING] 중복 실행 차단됨'],
        timestamp: new Date().toISOString(),
      };
    }

    if (!request.userConfirmed) {
      return fail(
        'VALIDATING',
        'CONFIRM_REQUIRED',
        '펌웨어 설치 전 사용자 확인이 필요합니다.',
        ['체크박스로 설치 대상 기기와 주의사항을 확인한 뒤 다시 실행하세요.']
      );
    }

    const portPath = request.portPath?.trim() ?? '';
    if (!VALID_PORT_RE.test(portPath)) {
      return fail(
        'VALIDATING',
        'INVALID_PORT',
        `올바른 COM 포트 형식이 아닙니다: ${portPath || '(미선택)'}`,
        ['USB 장치 검색 후 연결된 Espressif ESP32-S3 COM 포트를 선택하세요.']
      );
    }

    if (request.expectedBoardModel && !request.expectedBoardModel.includes('JC3636W518C')) {
      return fail(
        'VALIDATING',
        'UNSUPPORTED_DEVICE',
        `지원되지 않는 대상 기기(${request.expectedBoardModel})입니다.`,
        ['Guition JC3636W518C (ESP32-S3R8) 장치를 연결하세요.']
      );
    }

    this.flashing = true;
    this.cancelled = false;

    try {
      emit('VALIDATING', 4, '펌웨어 이미지 무결성 및 설치 도구를 검증하고 있습니다...');

      // 1. Validate flashing tool availability
      const tool = await this.resolveFlashingTool();
      if (!tool) {
        return fail(
          'VALIDATING',
          'TOOL_NOT_FOUND',
          'esptool 실행 도구를 찾을 수 없습니다. (pip install esptool 또는 PlatformIO 설치 필요)',
          [
            'Windows 명령 프롬프트에서 `pip install esptool`을 실행하여 설치하세요.',
            '또는 VS Code PlatformIO IDE를 설치하고 `firmware/` 프로젝트를 1회 빌드하세요.',
            '설치 후 "도구 다시 확인"을 눌러 플래싱 도구 인식을 확인한 뒤 재시도하세요.',
          ]
        );
      }
      emit('VALIDATING', 7, `플래싱 도구 확인됨: ${tool.displayName} (${tool.version})`);

      // 2. Re-validate all firmware files & integrity right before flashing
      const report = this.inspectSelection({
        ...request.selection,
        installMode: request.installMode,
      });

      if (!report.valid) {
        return fail(
          'VALIDATING',
          'INVALID_FIRMWARE',
          report.errors.join(' / '),
          [
            'PlatformIO에서 `jc3636w518c_usb_composite` 또는 `jc3636w518c_cdc_only` 환경으로 다시 빌드하세요.',
            '최초 설치 시 bootloader.bin, partitions.bin, firmware.bin이 모두 포함되었는지 확인하세요.',
          ]
        );
      }

      // 3. Check selected port against listed USB ports (block clearly non-Espressif VID if known)
      const currentPorts = await this.serialDeviceService.listPorts();
      const matchedPort = currentPorts.find(
        (p) => p.path.toLowerCase() === portPath.toLowerCase()
      );
      if (!matchedPort) {
        return fail(
          'PREPARING_PORT',
          'PORT_NOT_FOUND',
          `선택한 포트(${portPath})가 현재 시스템에서 감지되지 않습니다.`,
          [
            'USB-C 케이블 연결 상태를 확인하고 "USB 장치 검색"으로 포트를 다시 조회하세요.',
            'BOOT(GPIO 0) 버튼을 누른 상태에서 USB를 연결하거나 RESET을 누른 뒤 새 다운로드 COM 포트를 선택하세요.',
          ]
        );
      }
      if (matchedPort.vendorId && matchedPort.vendorId !== JC3636W518C_TARGET.espressifVid) {
        return fail(
          'PREPARING_PORT',
          'UNSUPPORTED_USB_VID',
          `선택한 포트(${portPath})의 USB VID(0x${matchedPort.vendorId})가 Espressif ESP32-S3(0x303A)가 아닙니다.`,
          ['다른 USB 시리얼 장치에 잘못 설치하지 않도록 차단했습니다. ESP32-S3 포트를 선택하세요.']
        );
      }

      // 3.8 Pre-flash update mode readiness handshake verification
      if (request.installMode === 'UPDATE') {
        emit('PREPARING_PORT', 11, `기기가 '업데이트 모드' 상태에서 응답하는지 사전 핸드셰이크를 확인하고 있습니다...`);
        try {
          const testRes = await this.serialDeviceService.testConnection();
          if (testRes.ok) {
            emit('PREPARING_PORT', 12, `업데이트 모드 핸드셰이크 성공 (왕복 ${testRes.latencyMs ?? 0}ms). 포트 해제 및 부트로더 전환 준비 중...`);
          } else {
            emit('PREPARING_PORT', 12, `안내: 기존 포트 응답 지연 (${testRes.error ?? '타임아웃'}). 수동 다운로드 모드로 전환될 수 있습니다.`);
          }
        } catch {
          // Non-fatal if already in bootloader mode
        }
      }

      // 4. Disconnect normal Protocol V2 communication cleanly to unlock COM port
      emit('PREPARING_PORT', 13, `${portPath}의 일반 USB 통신을 중지하고 포트를 준비하고 있습니다...`);
      await this.serialDeviceService.disconnect();

      // Dynamic settling delay based on installMode and baud rate to prevent timeout/race conditions
      const dynamicSettleMs = request.installMode === 'UPDATE' ? 650 : 400;
      await sleep(dynamicSettleMs);

      // 5. Build safe non-shell esptool write_flash argument list
      const baud =
        request.baudRate && ALLOWED_BAUD_RATES.has(request.baudRate)
          ? request.baudRate
          : 460800;

      const beforeMode = request.resetMethod === 'no_reset' ? 'no_reset' : 'default_reset';
      const sortedImages = [...report.images].sort(
        (a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16)
      );

      const writeArgs: string[] = [
        ...tool.prefixArgs,
        '--chip',
        JC3636W518C_TARGET.mcu,
        '--port',
        portPath,
        '--baud',
        String(baud),
        '--before',
        beforeMode,
        '--after',
        'hard_reset',
        'write_flash',
        '-z',
        '--flash_mode',
        JC3636W518C_TARGET.flashMode,
        '--flash_freq',
        JC3636W518C_TARGET.flashFreq,
        '--flash_size',
        JC3636W518C_TARGET.flashSize,
      ];

      for (const img of sortedImages) {
        writeArgs.push(img.offset, img.filePath);
      }

      emit(
        'CONNECTING_BOOTLOADER',
        16,
        `ESP32-S3 부트로더(${portPath}, ${beforeMode})에 연결 중...`,
        `[EXEC] ${tool.command} ${writeArgs.join(' ')}`
      );

      // 6. Execute esptool via spawn with shell: false
      const totalBytes = sortedImages.reduce((sum, img) => sum + (img.sizeBytes ?? 1), 0);
      let completedBytes = 0;
      let currentImageIndex = -1;
      let currentImagePercent = 0;

      const flashExec = await new Promise<{ exitCode: number | null; stderrAll: string; spawnError?: Error }>(
        (resolve) => {
          let settled = false;
          let stderrAll = '';
          let lineBuf = '';

          const child = spawn(tool.command, writeArgs, {
            shell: false,
            windowsHide: true,
          });
          this.activeFlashProcess = child;

          const processLine = (rawLine: string) => {
            const line = rawLine.trim();
            if (!line) return;

            if (/Connecting/i.test(line)) {
              emit('CONNECTING_BOOTLOADER', 18, 'ESP32-S3 다운로드 모드 응답 대기 중...', line);
              return;
            }
            if (/Chip is ESP32-S3/i.test(line)) {
              emit('FLASHING', 22, `칩 확인 완료: ${line}`, line);
              return;
            }
            if (/Writing at 0x[0-9a-fA-F]+/i.test(line)) {
              const pctMatch = line.match(/\((\d+)\s*%\)/);
              if (pctMatch) {
                const imgPct = Number(pctMatch[1]);
                if (currentImageIndex < 0 || imgPct < currentImagePercent) {
                  if (currentImageIndex >= 0 && currentImageIndex < sortedImages.length) {
                    completedBytes += sortedImages[currentImageIndex].sizeBytes ?? 0;
                  }
                  currentImageIndex = Math.min(currentImageIndex + 1, sortedImages.length - 1);
                }
                currentImagePercent = imgPct;
                const currentSize = sortedImages[Math.max(0, currentImageIndex)]?.sizeBytes ?? 0;
                const weightedBytes = completedBytes + (currentSize * imgPct) / 100;
                const overallPct = 22 + Math.round((weightedBytes / Math.max(1, totalBytes)) * 66);
                emit(
                  'FLASHING',
                  Math.min(88, overallPct),
                  `플래시 기록 중 (${sortedImages[Math.max(0, currentImageIndex)]?.fileName ?? 'image'} ${imgPct}%)`,
                  line
                );
                return;
              }
            }
            if (/Hash of data verified/i.test(line)) {
              emit('VERIFYING', 90, '플래시 데이터 무결성 해시 검증 완료', line);
              return;
            }
            if (/Hard resetting/i.test(line)) {
              emit('REBOOTING', 93, 'ESP32-S3 장치를 재부팅하고 있습니다...', line);
              return;
            }
            emit('FLASHING', Math.min(89, 20), line, line);
          };

          const handleChunk = (chunk: Buffer, isErr: boolean) => {
            const text = chunk.toString('utf8');
            if (isErr) stderrAll += text;
            lineBuf += text;
            const parts = lineBuf.split(/\r?\n|\r/);
            lineBuf = parts.pop() ?? '';
            for (const part of parts) {
              processLine(part);
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
              processLine(lineBuf);
            }
            if (settled) return;
            settled = true;
            resolve({ exitCode: code, stderrAll });
          });
        }
      );

      this.activeFlashProcess = null;

      if (this.cancelled) {
        return fail(
          'FAILED',
          'FLASH_CANCELLED',
          '사용자가 펌웨어 설치를 취소했습니다.',
          ['부분 기록 상태에서 기기가 부팅되지 않으면 BOOT(GPIO 0) 버튼을 누르고 다시 설치하세요.']
        );
      }

      if (flashExec.spawnError) {
        return fail(
          'FAILED',
          'SPAWN_ERROR',
          `플래싱 도구 실행 오류: ${flashExec.spawnError.message}`,
          ['esptool 또는 Python 환경이 정상 동작하는지 확인한 뒤 다시 시도하세요.']
        );
      }

      if (flashExec.exitCode !== 0) {
        const combinedErr = `${collectedLogs.slice(-8).join('\n')}\n${flashExec.stderrAll}`;
        return this.classifyFlashFailure(combinedErr, portPath, startedAt, collectedLogs, request.previousFirmwareVersion);
      }

      // 7. Post-flash reboot wait, COM port re-discovery, and Protocol V2 version check
      emit(
        'RECONNECTING',
        95,
        '재부팅 후 USB COM 포트를 재검색하여 새 펌웨어 연결을 확인하고 있습니다...'
      );

      await sleep(2200);
      const reconnectResult = await this.reconnectAndVerifyDevice(portPath);

      if (reconnectResult.connected && reconnectResult.info) {
        emit(
          'COMPLETED',
          100,
          `펌웨어 설치 및 재연결 완료 (버전: ${reconnectResult.info.firmwareVersion}, 포트: ${reconnectResult.portPath})`
        );
        this.flashing = false;
        return {
          ok: true,
          stage: 'COMPLETED',
          portUsed: portPath,
          reconnectedPortPath: reconnectResult.portPath,
          previousFirmwareVersion: request.previousFirmwareVersion,
          newFirmwareVersion: reconnectResult.info.firmwareVersion,
          newUsbMode: reconnectResult.info.usbMode,
          deviceHasStoredConfig: reconnectResult.hasStoredConfig,
          deviceReconnected: true,
          durationMs: Date.now() - startedAt,
          logs: collectedLogs,
          timestamp: new Date().toISOString(),
        };
      }

      // Flashing succeeded, but runtime USB port didn't auto-handshake yet (e.g., manual RESET needed after no_reset)
      emit(
        'COMPLETED',
        100,
        '플래시 기록은 완료되었으나 재부팅 후 USB 핸드셰이크를 자동 확인하지 못했습니다. 포트 재검색 후 수동 연결해 주세요.'
      );
      this.flashing = false;
      return {
        ok: true,
        stage: 'COMPLETED',
        portUsed: portPath,
        previousFirmwareVersion: request.previousFirmwareVersion,
        deviceReconnected: false,
        durationMs: Date.now() - startedAt,
        errorMessage:
          reconnectResult.error ??
          '플래시 기록은 성공했으나 재부팅 후 COM 포트 열거가 지연되었거나 수동 RESET이 필요합니다.',
        recoverySteps: [
          '수동 다운로드 모드(BOOT+RESET)로 설치한 경우 보드의 RESET 버튼을 1회 누르거나 USB 케이블을 재연결하세요.',
          '"USB 장치 검색" 버튼을 눌러 새로 인식된 COM 포트를 확인한 뒤 "USB 연결"을 클릭하세요.',
        ],
        logs: collectedLogs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return fail(
        'FAILED',
        'UNEXPECTED_ERROR',
        err instanceof Error ? err.message : String(err),
        ['USB 연결 상태와 포트를 확인한 뒤 다시 시도하세요.']
      );
    } finally {
      this.flashing = false;
      this.activeFlashProcess = null;
    }
  }

  public cancelFlash(): { ok: boolean; error?: string } {
    if (!this.flashing || !this.activeFlashProcess) {
      return { ok: false, error: '진행 중인 펌웨어 설치 작업이 없습니다.' };
    }
    this.cancelled = true;
    try {
      this.activeFlashProcess.kill();
    } catch {
      // Ignore kill error
    }
    return { ok: true };
  }

  private classifyFlashFailure(
    output: string,
    portPath: string,
    startedAt: number,
    logs: string[],
    previousFirmwareVersion?: string
  ): FirmwareFlashResult {
    this.flashing = false;
    let errorCode = 'FLASH_FAILED';
    let errorMessage = `펌웨어 설치에 실패했습니다 (${portPath}). 아래 로그를 확인하세요.`;
    let recoverySteps: string[] = [
      'USB 케이블이 데이터 전송을 지원하는지 확인하고 PC 본체 USB 포트에 직접 연결하세요.',
      'ESP32-S3 수동 다운로드 모드(BOOT 버튼 누른 채 RESET 버튼 클릭 → BOOT 해제)로 진입 후 "재시도"하세요.',
    ];

    if (/Failed to connect|No serial data received|Timed out waiting for packet/i.test(output)) {
      errorCode = 'BOOTLOADER_CONNECT_FAILED';
      errorMessage =
        'ESP32-S3 부트로더 다운로드 모드에 진입하지 못했습니다 (응답 시간 초과).';
      recoverySteps = [
        '보드의 BOOT(GPIO 0) 버튼을 누른 상태에서 RESET 버튼을 1회 눌렀다 떼고, 1초 뒤 BOOT 버튼에서 손을 떼세요.',
        'BOOT 버튼이 없는 경우 BOOT를 누른 채 USB-C 케이블을 분리 후 다시 연결하세요.',
        '"USB 장치 검색"으로 다운로드 COM 포트를 다시 선택한 뒤, 리셋 방식 "수동 BOOT/RESET 모드(no_reset)"로 실행하세요.',
      ];
    } else if (/PermissionError|Access is denied|could not open port|busy/i.test(output)) {
      errorCode = 'PORT_ACCESS_DENIED';
      errorMessage = `${portPath} 포트가 다른 프로그램에서 사용 중이거나 접근 권한이 없습니다.`;
      recoverySteps = [
        'Arduino IDE, PlatformIO 시리얼 모니터, PuTTY 등 다른 시리얼 프로그램을 모두 종료하세요.',
        '장치 재연결 후 "USB 장치 검색"을 다시 실행하세요.',
      ];
    } else if (/ClearCommError|WriteFile|disconnected|SerialException|device attached to the system is not functioning/i.test(output)) {
      errorCode = 'USB_DISCONNECTED_DURING_FLASH';
      errorMessage = '펌웨어 설치 도중 USB 연결이 끊어졌습니다.';
      recoverySteps = [
        'USB-C 케이블 및 포트 접촉 상태를 확인하세요.',
        '설치 중단으로 보드가 부팅되지 않을 수 있으므로 BOOT+RESET 수동 다운로드 모드로 진입한 뒤 "최초 설치"로 다시 기록하세요.',
      ];
    } else if (/This chip is|Wrong chip|chip_id/i.test(output)) {
      errorCode = 'WRONG_MCU';
      errorMessage = '연결된 장치가 ESP32-S3가 아닙니다.';
      recoverySteps = ['Guition JC3636W518C (ESP32-S3R8) 장치를 연결했는지 확인하세요.'];
    }

    return {
      ok: false,
      stage: 'FAILED',
      portUsed: portPath,
      previousFirmwareVersion,
      deviceReconnected: false,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
      recoverySteps,
      logs,
      timestamp: new Date().toISOString(),
    };
  }

  private async reconnectAndVerifyDevice(originalPortPath: string): Promise<{
    connected: boolean;
    portPath?: string;
    info?: { firmwareVersion: string; usbMode: string };
    hasStoredConfig?: boolean;
    error?: string;
  }> {
    // Poll up to 4 times across ~6 seconds for Windows USB re-enumeration
    for (let attempt = 0; attempt < 4; attempt++) {
      const ports = await this.serialDeviceService.listPorts();
      const espressifPorts = ports.filter((p) => p.isSupportedTarget);
      const orderedCandidates = [
        ...espressifPorts.filter((p) => p.path.toLowerCase() === originalPortPath.toLowerCase()),
        ...espressifPorts.filter((p) => p.path.toLowerCase() !== originalPortPath.toLowerCase()),
      ];

      for (const candidate of orderedCandidates) {
        const res = await this.serialDeviceService.connect(candidate.path);
        if (res.ok && res.info) {
          const statusRes = await this.serialDeviceService.getStatus();
          return {
            connected: true,
            portPath: candidate.path,
            info: {
              firmwareVersion: res.info.firmwareVersion,
              usbMode: res.info.usbMode,
            },
            hasStoredConfig: statusRes.ok ? statusRes.status?.hasStoredConfig : undefined,
          };
        }
      }

      await sleep(1500);
    }

    return {
      connected: false,
      error: '재부팅 후 6초 내에 Protocol V2 핸드셰이크 응답을 수신하지 못했습니다.',
    };
  }
}
