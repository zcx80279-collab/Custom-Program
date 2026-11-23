import {
  AppConfig,
  LogLevel,
  MacroDefinition,
  MacroExecutionMode,
  MacroExecutionResult,
  MacroStep,
  MacroStepTrace,
  MacroStepType,
  ProgramLaunchTestResult,
  ValidationResult,
} from '../shared/types';
import { formatKeyCombo, isValidKeyCode } from '../shared/keycodes';
import {
  extractProgramNameFromPath,
  macroHasLaunchApp,
  normalizeMacroStep,
  validateWindowsExecutablePath,
  validateWorkingDirectoryPath,
} from '../shared/programLaunch';
import { DiagnosticsManager } from './DiagnosticsManager';

export interface MacroTestVisualEvent {
  id: string;
  phase: 'START' | 'STEP' | 'COMPLETE' | 'ERROR';
  isTestMode: boolean;
  macroId: string;
  macroName: string;
  slotIndex: number | null;
  currentStepIndex: number;
  totalSteps: number;
  stepLabel: string;
  timestamp: string;
}

export interface ExecuteMacroOptions {
  slotIndex?: number;
  forceTestMode?: boolean;
  triggeredByDevice?: boolean;
}

export class MacroEngine {
  private testMode = false;
  private stateListeners = new Set<() => void>();
  private visualFeedbackListeners = new Set<(event: MacroTestVisualEvent) => void>();

  constructor(private readonly diagnostics: DiagnosticsManager) {}

  public isTestMode(): boolean {
    return this.testMode;
  }

  public setTestMode(enabled: boolean, silent = false): void {
    if (this.testMode === enabled) return;
    this.testMode = enabled;
    if (!silent) {
      this.diagnostics.log(
        LogLevel.INFO,
        'MacroEngine',
        enabled
          ? '[TEST MODE 활성화] 매크로 실행 시 실제 OS/HID 입력 및 프로그램 실행을 차단하고 로그 및 시각적 응답만 생성합니다.'
          : '[TEST MODE 비활성화] 매크로 정상 실행 모드로 전환되었습니다.'
      );
    }
    this.stateListeners.forEach((fn) => fn());
  }

  public subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public subscribeVisualFeedback(listener: (event: MacroTestVisualEvent) => void): () => void {
    this.visualFeedbackListeners.add(listener);
    return () => this.visualFeedbackListeners.delete(listener);
  }

  private emitVisualFeedback(event: Omit<MacroTestVisualEvent, 'id' | 'timestamp'>): void {
    const full: MacroTestVisualEvent = {
      ...event,
      id: `vis-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.visualFeedbackListeners.forEach((fn) => fn(full));
  }

  public validateMacro(macro: MacroDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!macro.name.trim()) {
      errors.push('매크로 이름을 입력해야 합니다.');
    }

    if (macro.steps.length === 0) {
      errors.push('최소 1개 이상의 매크로 동작 단계가 필요합니다.');
    }

    if (macro.steps.length > 32) {
      errors.push('ESP32-S3 저장 한계상 매크로당 최대 32개 단계까지 지원합니다.');
    }

    const hasLaunchApp = macroHasLaunchApp(macro);
    const hasKeySteps = macro.steps.some(
      (s) => s.type === MacroStepType.KEY_TAP || s.type === MacroStepType.KEY_COMBO
    );

    if (hasLaunchApp && macro.executionMode === MacroExecutionMode.DEVICE_HID) {
      errors.push(
        'Windows 프로그램 실행 동작은 ESP32-S3 USB HID(DEVICE_HID)에서 실행할 수 없습니다. 실행 방식을 PC_AGENT로 변경하세요.'
      );
    }

    if (hasLaunchApp && macro.executionMode === MacroExecutionMode.HYBRID) {
      errors.push(
        'Windows 프로그램 실행이 포함된 매크로는 HYBRID 모드에서 기기 HID와 PC 실행 간 단계 순서를 보장할 수 없으므로 PC_AGENT 모드에서만 지원됩니다.'
      );
    }

    if (hasLaunchApp && hasKeySteps && macro.executionMode === MacroExecutionMode.PC_AGENT) {
      const hasDelayAfterLaunch = macro.steps.some(
        (step, idx) =>
          step.type === MacroStepType.LAUNCH_APP &&
          macro.steps[idx + 1]?.type === MacroStepType.DELAY
      );
      if (!hasDelayAfterLaunch) {
        warnings.push(
          '프로그램 실행 직후 키 입력을 전송하는 경우, 프로그램 창이 열릴 수 있도록 중간에 지연 시간(예: 500~1500ms)을 추가하는 것을 권장합니다.'
        );
      }
    }

    let totalDelayMs = 0;
    macro.steps.forEach((step, idx) => {
      if (step.delayAfterMs !== undefined) {
        const afterMs = Number(step.delayAfterMs);
        if (!Number.isFinite(afterMs) || afterMs < 0 || afterMs > 5000) {
          errors.push(`${idx + 1}단계: 실행 후 지연 시간은 0ms~5,000ms 사이여야 합니다.`);
        } else {
          totalDelayMs += afterMs;
        }
      }

      if (step.type === MacroStepType.DELAY) {
        const ms = Number(step.delayMs);
        if (!Number.isFinite(ms) || ms < 10 || ms > 10000) {
          errors.push(`${idx + 1}단계: 지연 시간은 10ms~10,000ms 사이여야 합니다.`);
        } else {
          totalDelayMs += ms;
        }
      } else if (step.type === MacroStepType.LAUNCH_APP) {
        const pathCheck = validateWindowsExecutablePath(step.appPath);
        if (!pathCheck.valid && pathCheck.error) {
          errors.push(`${idx + 1}단계: ${pathCheck.error}`);
        }
        const dirCheck = validateWorkingDirectoryPath(step.workingDir);
        if (!dirCheck.valid && dirCheck.error) {
          errors.push(`${idx + 1}단계: ${dirCheck.error}`);
        }
        if (Array.isArray(step.appArgs)) {
          if (step.appArgs.length > 64) {
            errors.push(`${idx + 1}단계: 실행 인수는 최대 64개까지 지정할 수 있습니다.`);
          }
          const badArg = step.appArgs.find((a) => typeof a !== 'string' || /[\x00-\x1F\x7F]/.test(a));
          if (badArg !== undefined) {
            errors.push(`${idx + 1}단계: 실행 인수에 제어 문자를 포함할 수 없습니다.`);
          }
        }
        if (!step.appName?.trim()) {
          warnings.push(
            `${idx + 1}단계: 프로그램 이름이 비어 있어 파일명(${extractProgramNameFromPath(step.appPath) || '미지정'})으로 표시됩니다.`
          );
        }
      } else {
        if (!isValidKeyCode(step.key)) {
          errors.push(`${idx + 1}단계: 허용 목록에 없는 키(${String(step.key)})입니다.`);
        }
        if (step.type === MacroStepType.KEY_COMBO && (!step.modifiers || step.modifiers.length === 0)) {
          warnings.push(`${idx + 1}단계: 키 조합에 보조키(Ctrl/Shift/Alt/Win)가 선택되지 않았습니다.`);
        }
        if (
          macro.executionMode === MacroExecutionMode.DEVICE_HID &&
          step.key &&
          step.key.startsWith('Volume')
        ) {
          warnings.push(
            `${idx + 1}단계: 미디어 키(${step.key})는 표준 Boot Keyboard HID 대신 PC 프로그램 실행 방식(PC_AGENT)을 권장합니다.`
          );
        }
      }
    });

    if (totalDelayMs > 30000) {
      warnings.push(`총 지연 시간이 ${(totalDelayMs / 1000).toFixed(1)}초로 길어 실행 중 버튼 입력이 지연될 수 있습니다.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public formatStepLabel(step: MacroStep): string {
    if (step.type === MacroStepType.DELAY) {
      return `${step.delayMs ?? 0}ms 대기`;
    }
    if (step.type === MacroStepType.LAUNCH_APP) {
      const displayName =
        step.appName?.trim() || extractProgramNameFromPath(step.appPath) || '프로그램 미지정';
      const argsCount = step.appArgs?.length ?? 0;
      return argsCount > 0 ? `실행: ${displayName} (인수 ${argsCount}개)` : `실행: ${displayName}`;
    }
    if (step.type === MacroStepType.KEY_COMBO) {
      return formatKeyCombo(step.key, step.modifiers);
    }
    return formatKeyCombo(step.key);
  }

  public summarizeSteps(steps: MacroStep[]): string {
    if (steps.length === 0) return '동작 없음';
    return steps.map((s) => this.formatStepLabel(s)).join(' → ');
  }

  public createMacro(
    config: AppConfig,
    draft: Omit<MacroDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): { ok: boolean; config: AppConfig; macro?: MacroDefinition; error?: string } {
    const now = new Date().toISOString();
    const macro: MacroDefinition = {
      ...draft,
      steps: draft.steps.map(normalizeMacroStep),
      id: `macro-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      updatedAt: now,
    };

    const validation = this.validateMacro(macro);
    if (!validation.valid) {
      return { ok: false, config, error: validation.errors.join(' / ') };
    }

    this.diagnostics.log(LogLevel.INFO, 'MacroEngine', `매크로 생성: "${macro.name}" (${macro.executionMode})`);
    return {
      ok: true,
      macro,
      config: {
        ...config,
        macros: [...config.macros, macro],
        lastModifiedAt: now,
      },
    };
  }

  public updateMacro(
    config: AppConfig,
    macro: MacroDefinition
  ): { ok: boolean; config: AppConfig; error?: string } {
    const normalized: MacroDefinition = {
      ...macro,
      steps: macro.steps.map(normalizeMacroStep),
    };
    const validation = this.validateMacro(normalized);
    if (!validation.valid) {
      return { ok: false, config, error: validation.errors.join(' / ') };
    }

    const now = new Date().toISOString();
    this.diagnostics.log(LogLevel.INFO, 'MacroEngine', `매크로 수정: "${normalized.name}"`);
    return {
      ok: true,
      config: {
        ...config,
        macros: config.macros.map((m) => (m.id === normalized.id ? { ...normalized, updatedAt: now } : m)),
        lastModifiedAt: now,
      },
    };
  }

  public deleteMacro(config: AppConfig, macroId: string): AppConfig {
    const target = config.macros.find((m) => m.id === macroId);
    const now = new Date().toISOString();

    if (target) {
      this.diagnostics.log(LogLevel.INFO, 'MacroEngine', `매크로 삭제 및 버튼 바인딩 해제: "${target.name}"`);
    }

    return {
      ...config,
      macros: config.macros.filter((m) => m.id !== macroId),
      profiles: config.profiles.map((p) => ({
        ...p,
        buttons: p.buttons.map((b) => (b.macroId === macroId ? { ...b, macroId: null } : b)),
        updatedAt: now,
      })),
      lastModifiedAt: now,
    };
  }

  /**
   * Tests a single Windows program launch step safely.
   * - Test Mode: simulates without spawning any process.
   * - Electron: invokes scoped IPC `testLaunchProgram` (main process validates & spawns with shell: false).
   * - Browser preview: explicitly reports unsupported (never fakes success).
   */
  public async testLaunchProgramStep(
    step: MacroStep,
    macroId?: string
  ): Promise<ProgramLaunchTestResult> {
    const start = performance.now();
    const appPath = step.appPath?.trim() ?? '';
    const appName = step.appName?.trim() || extractProgramNameFromPath(appPath) || '프로그램';

    const pathCheck = validateWindowsExecutablePath(appPath);
    if (!pathCheck.valid) {
      return {
        ok: false,
        executedBy: this.testMode ? 'TEST_MODE' : window.roundMacroAPI ? 'PC_AGENT' : 'BROWSER_UNSUPPORTED',
        isSimulated: this.testMode,
        appName,
        appPath,
        durationMs: Math.round(performance.now() - start),
        errorCode: 'INVALID_PATH',
        errorMessage: pathCheck.error ?? '실행 파일 경로가 올바르지 않습니다.',
        timestamp: new Date().toISOString(),
      };
    }

    const dirCheck = validateWorkingDirectoryPath(step.workingDir);
    if (!dirCheck.valid) {
      return {
        ok: false,
        executedBy: this.testMode ? 'TEST_MODE' : window.roundMacroAPI ? 'PC_AGENT' : 'BROWSER_UNSUPPORTED',
        isSimulated: this.testMode,
        appName,
        appPath,
        durationMs: Math.round(performance.now() - start),
        errorCode: 'INVALID_WORKING_DIR',
        errorMessage: dirCheck.error ?? '작업 디렉터리 경로가 올바르지 않습니다.',
        timestamp: new Date().toISOString(),
      };
    }

    if (this.testMode) {
      this.diagnostics.log(
        LogLevel.INFO,
        'MacroEngine',
        `[TEST MODE] 프로그램 실행 시뮬레이션: "${appName}" (${appPath})`,
        '실제 Windows 프로그램은 실행되지 않았습니다.'
      );
      return {
        ok: true,
        executedBy: 'TEST_MODE',
        isSimulated: true,
        appName,
        appPath,
        durationMs: Math.round(performance.now() - start),
        timestamp: new Date().toISOString(),
      };
    }

    if (window.roundMacroAPI) {
      try {
        const res = await window.roundMacroAPI.macro.testLaunchProgram({
          macroId,
          appName,
          appPath,
          appArgs: step.appArgs,
          workingDir: step.workingDir,
        });
        this.diagnostics.log(
          res.ok ? LogLevel.INFO : LogLevel.ERROR,
          'MacroEngine',
          res.ok
            ? `Windows 프로그램 실행 테스트 성공: "${res.appName}" (PID: ${res.pid ?? '-'})`
            : `Windows 프로그램 실행 테스트 실패: "${appName}"`,
          res.errorMessage ?? res.appPath
        );
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.diagnostics.log(LogLevel.ERROR, 'MacroEngine', `프로그램 실행 IPC 오류: "${appName}"`, msg);
        return {
          ok: false,
          executedBy: 'PC_AGENT',
          isSimulated: false,
          appName,
          appPath,
          durationMs: Math.round(performance.now() - start),
          errorCode: 'IPC_ERROR',
          errorMessage: msg,
          timestamp: new Date().toISOString(),
        };
      }
    }

    const unsupportedMsg =
      '브라우저 미리보기에서는 Windows 실행 파일(.exe)을 직접 실행할 수 없습니다. Windows Electron 앱에서 실제 실행을 테스트하거나 Test Mode를 켜서 시뮬레이션을 확인하세요.';
    this.diagnostics.log(LogLevel.WARN, 'MacroEngine', `브라우저 미리보기 실행 제한: "${appName}"`, unsupportedMsg);
    return {
      ok: false,
      executedBy: 'BROWSER_UNSUPPORTED',
      isSimulated: false,
      appName,
      appPath,
      durationMs: Math.round(performance.now() - start),
      errorCode: 'BROWSER_UNSUPPORTED',
      errorMessage: unsupportedMsg,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Executes a macro cleanly:
   * - When Test Mode is enabled (or `forceTestMode` is passed), NEVER emits OS/HID input events or spawns programs;
   *   instead simulates step progression, writes structured logs, and emits live visual feedback.
   * - In Electron: hardware-triggered events run strictly via `executeSavedMacro(macroId, slot)` against persisted config;
   *   editor/preview triggers run via `executeOnPc(macro)` with main-process path authorization.
   * - In Browser preview: NEVER claims a Windows program was actually executed.
   */
  public async executeMacroOnPc(
    macro: MacroDefinition,
    options: ExecuteMacroOptions = {}
  ): Promise<MacroExecutionResult> {
    const start = performance.now();
    const useTestMode = this.testMode || Boolean(options.forceTestMode);
    const slotIndex = options.slotIndex ?? null;
    const hasLaunchApp = macroHasLaunchApp(macro);

    const validation = this.validateMacro(macro);
    if (!validation.valid) {
      const errorMessage = validation.errors.join(' / ');
      this.diagnostics.log(
        LogLevel.ERROR,
        'MacroEngine',
        `${useTestMode ? '[TEST MODE] ' : ''}매크로 검증 실패: "${macro.name}"`,
        errorMessage
      );
      this.emitVisualFeedback({
        phase: 'ERROR',
        isTestMode: useTestMode,
        macroId: macro.id,
        macroName: macro.name,
        slotIndex,
        currentStepIndex: -1,
        totalSteps: macro.steps.length,
        stepLabel: errorMessage,
      });
      return {
        success: false,
        macroId: macro.id,
        macroName: macro.name,
        executedBy: useTestMode
          ? 'TEST_MODE'
          : window.roundMacroAPI
            ? 'PC_AGENT'
            : hasLaunchApp
              ? 'BROWSER_UNSUPPORTED'
              : 'DRY_RUN_PREVIEW',
        isTestMode: useTestMode,
        isSimulated: useTestMode,
        stepsExecuted: 0,
        durationMs: Math.round(performance.now() - start),
        errorMessage,
        timestamp: new Date().toISOString(),
      };
    }

    // TEST MODE PATH: Strictly suppress all real OS / HID / process spawn events
    if (useTestMode) {
      return this.runTestModeSimulation(macro, slotIndex, Boolean(options.triggeredByDevice), start);
    }

    // Real Electron Windows execution via secure IPC
    if (window.roundMacroAPI) {
      try {
        const result = options.triggeredByDevice
          ? await window.roundMacroAPI.macro.executeSavedMacro(
              macro.id,
              slotIndex !== null ? slotIndex : undefined
            )
          : await window.roundMacroAPI.macro.executeOnPc(macro);

        this.diagnostics.log(
          result.success ? LogLevel.INFO : LogLevel.ERROR,
          'MacroEngine',
          result.success
            ? `PC 매크로 실행 완료: "${result.macroName}" (${result.stepsExecuted}단계, ${result.durationMs}ms)`
            : `PC 매크로 실행 실패: "${result.macroName}"`,
          result.errorMessage ??
            (result.launchedPrograms && result.launchedPrograms.length > 0
              ? result.launchedPrograms.map((p) => `${p.appName} (PID:${p.pid ?? '-'})`).join(', ')
              : undefined)
        );
        this.emitVisualFeedback({
          phase: result.success ? 'COMPLETE' : 'ERROR',
          isTestMode: false,
          macroId: result.macroId,
          macroName: result.macroName,
          slotIndex,
          currentStepIndex: Math.max(0, macro.steps.length - 1),
          totalSteps: macro.steps.length,
          stepLabel: result.success ? this.summarizeSteps(macro.steps) : (result.errorMessage ?? '실행 실패'),
        });
        return { ...result, isTestMode: false, isSimulated: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.diagnostics.log(LogLevel.ERROR, 'MacroEngine', `PC 매크로 IPC 오류: "${macro.name}"`, msg);
        this.emitVisualFeedback({
          phase: 'ERROR',
          isTestMode: false,
          macroId: macro.id,
          macroName: macro.name,
          slotIndex,
          currentStepIndex: -1,
          totalSteps: macro.steps.length,
          stepLabel: msg,
        });
        return {
          success: false,
          macroId: macro.id,
          macroName: macro.name,
          executedBy: 'PC_AGENT',
          isTestMode: false,
          isSimulated: false,
          stepsExecuted: 0,
          durationMs: Math.round(performance.now() - start),
          errorMessage: msg,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Browser preview cannot launch Windows .exe executables — NEVER report fake success!
    if (hasLaunchApp) {
      const errorMessage =
        '브라우저 미리보기에서는 Windows 프로그램(.exe)을 실제로 실행할 수 없습니다. Windows Electron 데스크톱 앱에서 실행하거나, Test Mode를 켜서 단계 시뮬레이션을 확인해 주세요.';
      this.diagnostics.log(
        LogLevel.WARN,
        'MacroEngine',
        `브라우저 미리보기 프로그램 실행 미지원: "${macro.name}"`,
        errorMessage
      );
      this.emitVisualFeedback({
        phase: 'ERROR',
        isTestMode: false,
        macroId: macro.id,
        macroName: macro.name,
        slotIndex,
        currentStepIndex: 0,
        totalSteps: macro.steps.length,
        stepLabel: '브라우저 미리보기에서는 .exe 실행 불가 (Electron 앱 필요)',
      });
      return {
        success: false,
        macroId: macro.id,
        macroName: macro.name,
        executedBy: 'BROWSER_UNSUPPORTED',
        isTestMode: false,
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Math.round(performance.now() - start),
        errorMessage,
        timestamp: new Date().toISOString(),
      };
    }

    // Key/delay-only macro in Browser sandbox: truthful sequence dry-run preview
    for (const step of macro.steps) {
      if (step.type === MacroStepType.DELAY && step.delayMs) {
        await new Promise((r) => setTimeout(r, Math.min(step.delayMs ?? 0, 1500)));
      }
    }
    const durationMs = Math.round(performance.now() - start);
    this.diagnostics.log(
      LogLevel.INFO,
      'MacroEngine',
      `브라우저 프리뷰 드라이런 완료: "${macro.name}" (${this.summarizeSteps(macro.steps)})`,
      '실제 Windows OS 키 입력 전송은 Electron 데스크톱 앱 또는 ESP32-S3 USB HID에서 수행됩니다.'
    );
    this.emitVisualFeedback({
      phase: 'COMPLETE',
      isTestMode: false,
      macroId: macro.id,
      macroName: macro.name,
      slotIndex,
      currentStepIndex: macro.steps.length - 1,
      totalSteps: macro.steps.length,
      stepLabel: `드라이런 프리뷰: ${this.summarizeSteps(macro.steps)}`,
    });
    return {
      success: true,
      macroId: macro.id,
      macroName: macro.name,
      executedBy: 'DRY_RUN_PREVIEW',
      isTestMode: false,
      isSimulated: true,
      stepsExecuted: macro.steps.length,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  private async runTestModeSimulation(
    macro: MacroDefinition,
    slotIndex: number | null,
    triggeredByDevice: boolean,
    startedAt: number
  ): Promise<MacroExecutionResult> {
    const traces: MacroStepTrace[] = [];
    const originLabel = triggeredByDevice
      ? `기기 터치 슬롯 ${slotIndex ?? '-'}`
      : slotIndex !== null
        ? `미리보기 슬롯 ${slotIndex}`
        : '매크로 편집기';

    this.diagnostics.log(
      LogLevel.INFO,
      'MacroEngine',
      `[TEST MODE] 시뮬레이션 시작 (${originLabel}): "${macro.name}"`,
      '실제 키보드/HID 입력 및 Windows 프로그램 실행은 차단되었습니다.'
    );

    this.emitVisualFeedback({
      phase: 'START',
      isTestMode: true,
      macroId: macro.id,
      macroName: macro.name,
      slotIndex,
      currentStepIndex: 0,
      totalSteps: macro.steps.length,
      stepLabel: '시뮬레이션 시작 (실제 입력·실행 차단됨)',
    });

    for (let i = 0; i < macro.steps.length; i++) {
      const step = macro.steps[i];
      const label = this.formatStepLabel(step);
      const simulatedDelayMs =
        step.type === MacroStepType.DELAY
          ? Math.min(step.delayMs ?? 100, 1500)
          : 120;

      this.emitVisualFeedback({
        phase: 'STEP',
        isTestMode: true,
        macroId: macro.id,
        macroName: macro.name,
        slotIndex,
        currentStepIndex: i,
        totalSteps: macro.steps.length,
        stepLabel: label,
      });

      this.diagnostics.log(
        LogLevel.INFO,
        'MacroEngine',
        `[TEST MODE] ${i + 1}/${macro.steps.length}단계 가상 실행: ${label}`,
        step.type === MacroStepType.LAUNCH_APP
          ? `대상 경로: ${step.appPath ?? '-'} · 실제 프로그램 미실행`
          : `모드: ${macro.executionMode} · 실제 입력 이벤트 미발생`
      );

      traces.push({
        stepIndex: i,
        type: step.type,
        label,
        simulatedDelayMs,
        actualExecuted: false,
      });

      await new Promise((r) => setTimeout(r, simulatedDelayMs));
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const summary = this.summarizeSteps(macro.steps);

    this.diagnostics.log(
      LogLevel.INFO,
      'MacroEngine',
      `[TEST MODE] 시뮬레이션 완료: "${macro.name}" (${macro.steps.length}단계, ${durationMs}ms)`,
      `가상 시퀀스(실제 미실행): ${summary}`
    );

    this.emitVisualFeedback({
      phase: 'COMPLETE',
      isTestMode: true,
      macroId: macro.id,
      macroName: macro.name,
      slotIndex,
      currentStepIndex: Math.max(0, macro.steps.length - 1),
      totalSteps: macro.steps.length,
      stepLabel: `시뮬레이션 완료 (실제 미실행): ${summary}`,
    });

    return {
      success: true,
      macroId: macro.id,
      macroName: macro.name,
      executedBy: 'TEST_MODE',
      isTestMode: true,
      isSimulated: true,
      stepsExecuted: macro.steps.length,
      durationMs,
      stepTraces: traces,
      timestamp: new Date().toISOString(),
    };
  }
}
