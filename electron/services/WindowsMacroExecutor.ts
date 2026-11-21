import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  LaunchedProgramInfo,
  MacroDefinition,
  MacroExecutionResult,
  MacroStep,
  MacroStepTrace,
  MacroStepType,
  ProgramLaunchTestRequest,
  ProgramLaunchTestResult,
  ProgramPathCheckResult,
} from '../../src/shared/types';
import { getKeySpec, MODIFIER_WIN_VK } from '../../src/shared/keycodes';
import {
  extractProgramNameFromPath,
  validateWindowsExecutablePath,
  validateWorkingDirectoryPath,
} from '../../src/shared/programLaunch';

const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapSpawnErrorToKorean(err: NodeJS.ErrnoException, targetPath: string): { code: string; message: string } {
  const code = err.code ?? 'SPAWN_ERROR';
  switch (code) {
    case 'ENOENT':
      return {
        code,
        message: `실행 파일을 찾을 수 없습니다. 파일이 삭제되었거나 이동되었을 수 있습니다: ${targetPath}`,
      };
    case 'EACCES':
    case 'EPERM':
      return {
        code,
        message: `실행 파일에 접근하거나 실행할 권한이 없습니다 (관리자 권한 또는 보안 정책 확인 필요): ${targetPath}`,
      };
    case 'EISDIR':
      return {
        code,
        message: `지정한 경로가 실행 파일이 아니라 폴더입니다: ${targetPath}`,
      };
    case 'ENOTDIR':
      return {
        code,
        message: `작업 디렉터리 또는 상위 경로가 올바른 폴더가 아닙니다: ${targetPath}`,
      };
    case 'EINVAL':
      return {
        code,
        message: `실행 파일 경로 또는 인수가 올바르지 않습니다: ${targetPath}`,
      };
    case 'E2BIG':
      return {
        code,
        message: '전달된 실행 인수가 Windows 허용 길이를 초과했습니다.',
      };
    default:
      return {
        code,
        message: `프로그램 실행 실패 (${code}): ${err.message}`,
      };
  }
}

/**
 * Safe Windows PC-side macro executor.
 *
 * Security guarantees:
 * - Key automation accepts ONLY strictly whitelisted numeric Virtual-Key (VK_*) codes from CANONICAL_KEYS.
 * - Program launch uses `child_process.spawn(exePath, argsArray, { shell: false })` with separated path and args.
 * - Never builds or concatenates shell command strings (`cmd.exe /c`, etc.) from user input.
 * - Verifies `.exe` extension, path syntax, filesystem existence, file type, read/exec access, and workingDir.
 * - Catches both synchronous and asynchronous `'error'` events so launch failures never crash the Electron app.
 *
 * NOTE: Requires Windows 10/11 runtime for actual OS keystroke injection & `.exe` execution
 * (unverified in Linux container).
 */
export class WindowsMacroExecutor {
  /**
   * Validates a Windows executable path and optional working directory on the local filesystem.
   */
  public checkProgramPath(appPath: string, workingDir?: string): ProgramPathCheckResult {
    const syntax = validateWindowsExecutablePath(appPath);
    if (!syntax.valid) {
      return {
        ok: false,
        exists: false,
        isFile: false,
        isExe: /\.exe$/i.test(appPath?.trim() ?? ''),
        accessible: false,
        workingDirValid: !workingDir?.trim(),
        error: syntax.error,
      };
    }

    const dirSyntax = validateWorkingDirectoryPath(workingDir);
    if (!dirSyntax.valid) {
      return {
        ok: false,
        exists: false,
        isFile: false,
        isExe: true,
        accessible: false,
        workingDirValid: false,
        error: dirSyntax.error,
      };
    }

    const resolvedExe = path.resolve(appPath.trim());
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedExe);
    } catch (err) {
      const mapped = mapSpawnErrorToKorean(err as NodeJS.ErrnoException, resolvedExe);
      return {
        ok: false,
        exists: false,
        isFile: false,
        isExe: true,
        accessible: false,
        workingDirValid: true,
        error: mapped.message,
      };
    }

    if (!stat.isFile()) {
      return {
        ok: false,
        exists: true,
        isFile: false,
        isExe: true,
        accessible: false,
        workingDirValid: true,
        error: `실행 파일이 아니라 폴더입니다: ${resolvedExe}`,
      };
    }

    try {
      fs.accessSync(resolvedExe, fs.constants.R_OK | fs.constants.X_OK);
    } catch (err) {
      const mapped = mapSpawnErrorToKorean(err as NodeJS.ErrnoException, resolvedExe);
      return {
        ok: false,
        exists: true,
        isFile: true,
        isExe: true,
        accessible: false,
        workingDirValid: true,
        error: mapped.message,
      };
    }

    if (workingDir && workingDir.trim()) {
      const resolvedDir = path.resolve(workingDir.trim());
      try {
        const dirStat = fs.statSync(resolvedDir);
        if (!dirStat.isDirectory()) {
          return {
            ok: false,
            exists: true,
            isFile: true,
            isExe: true,
            accessible: true,
            workingDirValid: false,
            error: `지정한 작업 디렉터리가 폴더가 아닙니다: ${resolvedDir}`,
          };
        }
      } catch {
        return {
          ok: false,
          exists: true,
          isFile: true,
          isExe: true,
          accessible: true,
          workingDirValid: false,
          error: `지정한 작업 디렉터리를 찾을 수 없습니다: ${resolvedDir}`,
        };
      }
    }

    return {
      ok: true,
      exists: true,
      isFile: true,
      isExe: true,
      accessible: true,
      workingDirValid: true,
    };
  }

  /**
   * Launches a single validated Windows `.exe` program using `child_process.spawn` with `shell: false`.
   */
  public async launchSingleProgram(request: ProgramLaunchTestRequest): Promise<ProgramLaunchTestResult> {
    const start = Date.now();
    const rawPath = typeof request.appPath === 'string' ? request.appPath.trim() : '';
    const appName =
      request.appName?.trim() || extractProgramNameFromPath(rawPath) || 'Windows 프로그램';

    if (process.platform !== 'win32') {
      return {
        ok: false,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        appName,
        appPath: rawPath,
        durationMs: Date.now() - start,
        errorCode: 'UNSUPPORTED_PLATFORM',
        errorMessage: 'Windows 프로그램 실행은 Windows(win32) 환경에서만 지원됩니다.',
        timestamp: new Date().toISOString(),
      };
    }

    // Validate arguments safely (separated array, no shell interpolation)
    const sanitizedArgs: string[] = [];
    if (Array.isArray(request.appArgs)) {
      if (request.appArgs.length > 64) {
        return {
          ok: false,
          executedBy: 'PC_AGENT',
          isSimulated: false,
          appName,
          appPath: rawPath,
          durationMs: Date.now() - start,
          errorCode: 'INVALID_ARGS',
          errorMessage: '실행 인수는 최대 64개까지 지정할 수 있습니다.',
          timestamp: new Date().toISOString(),
        };
      }
      for (const arg of request.appArgs) {
        if (typeof arg !== 'string' || CONTROL_CHAR_RE.test(arg)) {
          return {
            ok: false,
            executedBy: 'PC_AGENT',
            isSimulated: false,
            appName,
            appPath: rawPath,
            durationMs: Date.now() - start,
            errorCode: 'INVALID_ARGS',
            errorMessage: '실행 인수에 허용되지 않는 제어 문자가 포함되어 있습니다.',
            timestamp: new Date().toISOString(),
          };
        }
        sanitizedArgs.push(arg);
      }
    }

    const pathCheck = this.checkProgramPath(rawPath, request.workingDir);
    if (!pathCheck.ok) {
      return {
        ok: false,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        appName,
        appPath: rawPath,
        durationMs: Date.now() - start,
        errorCode: !pathCheck.exists
          ? 'ENOENT'
          : !pathCheck.accessible
            ? 'EACCES'
            : !pathCheck.workingDirValid
              ? 'INVALID_CWD'
              : 'INVALID_PATH',
        errorMessage: pathCheck.error ?? '실행 파일 검증에 실패했습니다.',
        timestamp: new Date().toISOString(),
      };
    }

    const resolvedExe = path.resolve(rawPath);
    const resolvedCwd =
      request.workingDir && request.workingDir.trim()
        ? path.resolve(request.workingDir.trim())
        : path.dirname(resolvedExe);

    try {
      const pid = await new Promise<number | undefined>((resolve, reject) => {
        let settled = false;
        const child = spawn(resolvedExe, sanitizedArgs, {
          cwd: resolvedCwd,
          shell: false,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });

        child.once('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });

        child.once('spawn', () => {
          if (settled) return;
          settled = true;
          try {
            child.unref();
          } catch {
            // Ignore unref errors if process already exited quickly
          }
          resolve(child.pid);
        });
      });

      return {
        ok: true,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        appName,
        appPath: resolvedExe,
        pid,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const mapped = mapSpawnErrorToKorean(err as NodeJS.ErrnoException, resolvedExe);
      return {
        ok: false,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        appName,
        appPath: resolvedExe,
        durationMs: Date.now() - start,
        errorCode: mapped.code,
        errorMessage: mapped.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Executes a full macro sequentially on Windows PC_AGENT, preserving exact step ordering
   * across KEY_TAP, KEY_COMBO, DELAY, and LAUNCH_APP steps.
   */
  public async executeMacro(macro: MacroDefinition): Promise<MacroExecutionResult> {
    const start = Date.now();

    if (process.platform !== 'win32') {
      return {
        success: false,
        macroId: macro.id,
        macroName: macro.name,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Date.now() - start,
        errorMessage: 'PC 매크로 및 프로그램 실행은 Windows 환경(win32)에서만 지원됩니다.',
        timestamp: new Date().toISOString(),
      };
    }

    if (!Array.isArray(macro.steps) || macro.steps.length === 0) {
      return {
        success: false,
        macroId: macro.id,
        macroName: macro.name,
        executedBy: 'PC_AGENT',
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Date.now() - start,
        errorMessage: '실행할 매크로 단계가 비어 있습니다.',
        timestamp: new Date().toISOString(),
      };
    }

    const traces: MacroStepTrace[] = [];
    const launchedPrograms: LaunchedProgramInfo[] = [];
    let stepsExecuted = 0;

    // Partition consecutive key/delay steps into batches, breaking at LAUNCH_APP boundaries
    // so execution order is 100% preserved even in mixed macros.
    let i = 0;
    while (i < macro.steps.length) {
      const step = macro.steps[i];

      if (step.type === MacroStepType.LAUNCH_APP) {
        const launchRes = await this.launchSingleProgram({
          macroId: macro.id,
          appName: step.appName,
          appPath: step.appPath ?? '',
          appArgs: step.appArgs,
          workingDir: step.workingDir,
        });

        if (!launchRes.ok) {
          return {
            success: false,
            macroId: macro.id,
            macroName: macro.name,
            executedBy: 'PC_AGENT',
            isSimulated: false,
            stepsExecuted,
            durationMs: Date.now() - start,
            stepTraces: traces,
            launchedPrograms,
            errorMessage: `${i + 1}단계(${launchRes.appName}): ${launchRes.errorMessage ?? '실행 실패'}`,
            timestamp: new Date().toISOString(),
          };
        }

        launchedPrograms.push({
          appName: launchRes.appName,
          appPath: launchRes.appPath,
          pid: launchRes.pid,
        });
        traces.push({
          stepIndex: i,
          type: MacroStepType.LAUNCH_APP,
          label: `실행: ${launchRes.appName}`,
          simulatedDelayMs: launchRes.durationMs,
          actualExecuted: true,
          pid: launchRes.pid,
        });
        stepsExecuted++;
        i++;
        continue;
      }

      // Standalone DELAY step (avoid spawning PowerShell when no keys follow immediately)
      if (step.type === MacroStepType.DELAY) {
        const ms = Math.min(10000, Math.max(10, Math.floor(Number(step.delayMs ?? 50))));
        await sleep(ms);
        traces.push({
          stepIndex: i,
          type: MacroStepType.DELAY,
          label: `${ms}ms 대기`,
          simulatedDelayMs: ms,
          actualExecuted: true,
        });
        stepsExecuted++;
        i++;
        continue;
      }

      // Collect contiguous key/delay steps until next LAUNCH_APP
      const batchStart = i;
      const batchSteps: MacroStep[] = [];
      while (i < macro.steps.length && macro.steps[i].type !== MacroStepType.LAUNCH_APP) {
        batchSteps.push(macro.steps[i]);
        i++;
      }

      // Trim trailing standalone delays from key batch so they run cleanly in Node
      let trailingDelays = 0;
      while (
        batchSteps.length > 0 &&
        batchSteps[batchSteps.length - 1].type === MacroStepType.DELAY
      ) {
        batchSteps.pop();
        trailingDelays++;
        i--;
      }

      const keyBatchRes = await this.executeKeyBatch(batchSteps);
      if (!keyBatchRes.ok) {
        return {
          success: false,
          macroId: macro.id,
          macroName: macro.name,
          executedBy: 'PC_AGENT',
          isSimulated: false,
          stepsExecuted,
          durationMs: Date.now() - start,
          stepTraces: traces,
          launchedPrograms,
          errorMessage: keyBatchRes.errorMessage,
          timestamp: new Date().toISOString(),
        };
      }

      batchSteps.forEach((bStep, offset) => {
        traces.push({
          stepIndex: batchStart + offset,
          type: bStep.type,
          label:
            bStep.type === MacroStepType.DELAY
              ? `${bStep.delayMs ?? 50}ms 대기`
              : bStep.key ?? 'KEY',
          simulatedDelayMs: bStep.type === MacroStepType.DELAY ? (bStep.delayMs ?? 50) : 35,
          actualExecuted: true,
        });
      });
      stepsExecuted += batchSteps.length;
      void trailingDelays;
    }

    return {
      success: true,
      macroId: macro.id,
      macroName: macro.name,
      executedBy: 'PC_AGENT',
      isSimulated: false,
      stepsExecuted,
      durationMs: Date.now() - start,
      stepTraces: traces,
      launchedPrograms,
      timestamp: new Date().toISOString(),
    };
  }

  private async executeKeyBatch(steps: MacroStep[]): Promise<{ ok: boolean; errorMessage?: string }> {
    const instructions: string[] = [];
    for (const step of steps) {
      if (step.type === MacroStepType.DELAY) {
        const ms = Math.min(10000, Math.max(10, Math.floor(Number(step.delayMs ?? 50))));
        instructions.push(`D:${ms}`);
        continue;
      }

      const spec = getKeySpec(step.key);
      if (!spec) {
        return {
          ok: false,
          errorMessage: `허용되지 않은 키 코드입니다: ${String(step.key)}`,
        };
      }

      const modVks =
        step.type === MacroStepType.KEY_COMBO && step.modifiers
          ? step.modifiers.map((m) => MODIFIER_WIN_VK[m]).filter((v): v is number => Number.isInteger(v))
          : [];

      instructions.push(`K:${spec.winVkCode}:${modVks.join(',')}`);
    }

    if (instructions.length === 0) {
      return { ok: true };
    }

    const encodedPlan = instructions.join(';');

    // Fixed non-interpolated script reading strictly numeric plan from argument $args[0]
    const psScript = `
param([string]$plan)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RmcWinInput {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
foreach ($item in $plan.Split(';')) {
  if ([string]::IsNullOrWhiteSpace($item)) { continue }
  $parts = $item.Split(':')
  if ($parts[0] -eq 'D') {
    Start-Sleep -Milliseconds ([int]$parts[1])
  } elseif ($parts[0] -eq 'K') {
    $vk = [byte]([int]$parts[1])
    $mods = @()
    if ($parts.Length -ge 3 -and -not [string]::IsNullOrWhiteSpace($parts[2])) {
      $mods = $parts[2].Split(',') | ForEach-Object { [byte]([int]$_) }
    }
    foreach ($m in $mods) { [RmcWinInput]::keybd_event($m, 0, 0, [UIntPtr]::Zero) }
    [RmcWinInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 15
    [RmcWinInput]::keybd_event($vk, 0, [RmcWinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [Array]::Reverse($mods)
    foreach ($m in $mods) { [RmcWinInput]::keybd_event($m, 0, [RmcWinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
    Start-Sleep -Milliseconds 20
  }
}
`;

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psScript, encodedPlan],
          { timeout: 30000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
