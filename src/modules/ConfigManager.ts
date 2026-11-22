import {
  AppConfig,
  CONFIG_SCHEMA_VERSION,
  LayoutPreset,
  LogLevel,
  MacroExecutionMode,
  MacroStepType,
  SlotTransitionMode,
  ValidationResult,
} from '../shared/types';
import { createDefaultConfig } from '../shared/defaults';
import { isValidKeyCode } from '../shared/keycodes';
import {
  normalizeLoadedConfig,
  validateWindowsExecutablePath,
  validateWorkingDirectoryPath,
} from '../shared/programLaunch';
import { DiagnosticsManager } from './DiagnosticsManager';

const LOCAL_STORAGE_KEY = 'rmc_v2_pc_config';
const LOCAL_BACKUP_KEY = 'rmc_v2_pc_config_backup';

export class ConfigManager {
  constructor(private readonly diagnostics: DiagnosticsManager) {}

  public validateConfig(candidate: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof candidate !== 'object' || candidate === null) {
      return { valid: false, errors: ['설정 데이터는 JSON 객체여야 합니다.'], warnings };
    }

    const cfg = candidate as Partial<AppConfig>;

    if (typeof cfg.schemaVersion !== 'string' || !cfg.schemaVersion.startsWith('2.')) {
      errors.push(
        `지원되지 않는 설정 스키마 버전입니다. (현재 지원: ${CONFIG_SCHEMA_VERSION}, 입력: ${String(cfg.schemaVersion)})`
      );
    }

    if (!Array.isArray(cfg.profiles) || cfg.profiles.length === 0) {
      errors.push('최소 1개 이상의 프로필이 필요합니다.');
    }

    if (!Array.isArray(cfg.macros)) {
      errors.push('매크로 목록 형식이 올바르지 않습니다.');
    }

    if (cfg.preferences && cfg.preferences.slotTransitionMode !== undefined) {
      if (!Object.values(SlotTransitionMode).includes(cfg.preferences.slotTransitionMode)) {
        errors.push('슬롯 전환 방식 설정(slotTransitionMode)이 유효하지 않습니다.');
      }
    }

    if (Array.isArray(cfg.profiles)) {
      const profileIds = new Set<string>();
      for (const p of cfg.profiles) {
        if (!p || typeof p.id !== 'string' || !p.id.trim()) {
          errors.push('프로필 ID가 누락되었습니다.');
          continue;
        }
        if (profileIds.has(p.id)) {
          errors.push(`중복된 프로필 ID가 발견되었습니다: ${p.id}`);
        }
        profileIds.add(p.id);

        if (!Object.values(LayoutPreset).includes(p.layout)) {
          errors.push(`프로필 "${p.name}"의 레이아웃(${String(p.layout)})이 유효하지 않습니다.`);
        }
        if (!Array.isArray(p.buttons) || p.buttons.length === 0) {
          errors.push(`프로필 "${p.name}"에 버튼 정의가 없습니다.`);
        }
        if (p.macroSlots !== undefined) {
          if (!Array.isArray(p.macroSlots) || p.macroSlots.length !== 3) {
            errors.push(`프로필 "${p.name}"의 매크로 슬롯 목록은 3개여야 합니다.`);
          }
        }
        if (p.activeMacroSlotIndex !== undefined) {
          if (p.activeMacroSlotIndex < 1 || p.activeMacroSlotIndex > 3) {
            errors.push(`프로필 "${p.name}"의 활성 슬롯 번호는 1~3 범위여야 합니다.`);
          }
        }
      }

      if (cfg.activeProfileId && !profileIds.has(cfg.activeProfileId)) {
        warnings.push('활성 프로필 ID가 목록에 없어 첫 번째 프로필로 자동 보정됩니다.');
      }
    }

    if (Array.isArray(cfg.macros)) {
      const macroIds = new Set<string>();
      for (const m of cfg.macros) {
        if (!m || typeof m.id !== 'string' || !m.id.trim()) {
          errors.push('매크로 ID가 누락되었습니다.');
          continue;
        }
        if (macroIds.has(m.id)) {
          errors.push(`중복된 매크로 ID가 발견되었습니다: ${m.id}`);
        }
        macroIds.add(m.id);

        if (!Object.values(MacroExecutionMode).includes(m.executionMode)) {
          errors.push(`매크로 "${m.name}"의 실행 방식이 유효하지 않습니다.`);
        }

        if (!Array.isArray(m.steps)) {
          errors.push(`매크로 "${m.name}"의 동작 단계 배열이 올바르지 않습니다.`);
        } else {
          let hasLaunchApp = false;
          for (const st of m.steps) {
            if (!Object.values(MacroStepType).includes(st.type)) {
              errors.push(`매크로 "${m.name}"에 알 수 없는 단계 유형이 있습니다.`);
            } else if (st.type === MacroStepType.DELAY) {
              const ms = Number(st.delayMs);
              if (!Number.isFinite(ms) || ms < 10 || ms > 10000) {
                errors.push(`매크로 "${m.name}"의 지연 시간은 10~10000ms 범위여야 합니다.`);
              }
            } else if (st.type === MacroStepType.LAUNCH_APP) {
              hasLaunchApp = true;
              const pathCheck = validateWindowsExecutablePath(st.appPath);
              if (!pathCheck.valid) {
                errors.push(`매크로 "${m.name}": ${pathCheck.error}`);
              }
              const dirCheck = validateWorkingDirectoryPath(st.workingDir);
              if (!dirCheck.valid) {
                errors.push(`매크로 "${m.name}": ${dirCheck.error}`);
              }
              if (
                st.appArgs !== undefined &&
                !Array.isArray(st.appArgs) &&
                typeof (st.appArgs as unknown) !== 'string'
              ) {
                errors.push(`매크로 "${m.name}"의 실행 인수 형식이 올바르지 않습니다.`);
              }
            } else if (!isValidKeyCode(st.key)) {
              errors.push(
                `매크로 "${m.name}"에 허용되지 않은 키 코드(${String(st.key)})가 포함되어 있습니다.`
              );
            }
          }

          if (hasLaunchApp && m.executionMode !== MacroExecutionMode.PC_AGENT) {
            errors.push(
              `매크로 "${m.name}": Windows 프로그램 실행 동작이 포함된 매크로는 PC_AGENT 모드여야 합니다.`
            );
          }
        }
      }
    }

    if (cfg.shortcutPresets !== undefined) {
      if (!Array.isArray(cfg.shortcutPresets)) {
        errors.push('단축키 프리셋 목록 형식이 올바르지 않습니다.');
      } else {
        const presetIds = new Set<string>();
        for (const preset of cfg.shortcutPresets) {
          if (!preset || typeof preset.id !== 'string' || !preset.id.trim()) {
            errors.push('단축키 프리셋 ID가 누락되었습니다.');
            continue;
          }
          if (presetIds.has(preset.id)) {
            errors.push(`중복된 단축키 프리셋 ID가 발견되었습니다: ${preset.id}`);
          }
          presetIds.add(preset.id);

          if (typeof preset.name !== 'string' || !preset.name.trim()) {
            errors.push(`단축키 프리셋(${preset.id})의 이름이 누락되었습니다.`);
          }
          if (!Array.isArray(preset.buttons) || preset.buttons.length === 0) {
            errors.push(`단축키 프리셋 "${preset.name || preset.id}"에 버튼 매핑이 없습니다.`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public async load(): Promise<{ config: AppConfig; source: 'ELECTRON_FS' | 'LOCAL_STORAGE' | 'DEFAULT' }> {
    // 1. Electron Windows Desktop IPC persistence
    if (window.roundMacroAPI) {
      try {
        const res = await window.roundMacroAPI.config.load();
        if (res.ok && res.config) {
          const check = this.validateConfig(res.config);
          if (check.valid) {
            this.diagnostics.log(LogLevel.INFO, 'ConfigManager', 'Windows 로컬 설정 파일을 불러왔습니다.');
            return { config: this.normalizeActiveProfile(res.config), source: 'ELECTRON_FS' };
          }
          this.diagnostics.log(
            LogLevel.WARN,
            'ConfigManager',
            '저장된 설정 파일 검증 실패 — 기본 설정으로 복구합니다.',
            check.errors.join('; ')
          );
        }
      } catch (err) {
        this.diagnostics.log(
          LogLevel.ERROR,
          'ConfigManager',
          'Electron 설정 로드 중 오류 발생',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // 2. Browser LocalStorage persistence (preview / web fallback)
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const check = this.validateConfig(parsed);
        if (check.valid) {
          this.diagnostics.log(LogLevel.INFO, 'ConfigManager', '브라우저 로컬 저장소에서 PC 설정을 불러왔습니다.');
          return { config: this.normalizeActiveProfile(parsed as AppConfig), source: 'LOCAL_STORAGE' };
        }
        // Try backup slot if primary corrupted
        const backupRaw = window.localStorage.getItem(LOCAL_BACKUP_KEY);
        if (backupRaw) {
          const backupParsed = JSON.parse(backupRaw);
          if (this.validateConfig(backupParsed).valid) {
            this.diagnostics.log(
              LogLevel.WARN,
              'ConfigManager',
              '주 설정이 손상되어 직전 정상 백업 설정으로 복구했습니다.'
            );
            return { config: this.normalizeActiveProfile(backupParsed as AppConfig), source: 'LOCAL_STORAGE' };
          }
        }
      }
    } catch (err) {
      this.diagnostics.log(
        LogLevel.WARN,
        'ConfigManager',
        '로컬 저장소 설정 읽기 실패 — 기본 설정을 생성합니다.',
        err instanceof Error ? err.message : String(err)
      );
    }

    const fallback = createDefaultConfig();
    this.diagnostics.log(LogLevel.INFO, 'ConfigManager', `초기 기본 PC 설정(v${CONFIG_SCHEMA_VERSION})을 생성했습니다.`);
    return { config: fallback, source: 'DEFAULT' };
  }

  public async save(config: AppConfig): Promise<{ ok: boolean; error?: string }> {
    const check = this.validateConfig(config);
    if (!check.valid) {
      const msg = check.errors.join(' / ');
      this.diagnostics.log(LogLevel.ERROR, 'ConfigManager', '설정 검증 실패로 저장이 중단되었습니다.', msg);
      return { ok: false, error: msg };
    }

    const updated: AppConfig = {
      ...config,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      lastModifiedAt: new Date().toISOString(),
    };

    if (window.roundMacroAPI) {
      try {
        const res = await window.roundMacroAPI.config.save(updated);
        if (!res.ok) {
          this.diagnostics.log(LogLevel.ERROR, 'ConfigManager', 'Windows 파일 저장 실패', res.error);
          return res;
        }
        this.diagnostics.log(LogLevel.INFO, 'ConfigManager', 'Windows 로컬 설정 파일에 저장했습니다.');
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.diagnostics.log(LogLevel.ERROR, 'ConfigManager', 'Electron 저장 오류', msg);
        return { ok: false, error: msg };
      }
    }

    try {
      const prev = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (prev) {
        window.localStorage.setItem(LOCAL_BACKUP_KEY, prev);
      }
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      this.diagnostics.log(LogLevel.INFO, 'ConfigManager', 'PC 설정을 로컬 저장소에 저장했습니다.');
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.diagnostics.log(LogLevel.ERROR, 'ConfigManager', '로컬 저장소 쓰기 실패', msg);
      return { ok: false, error: msg };
    }
  }

  public serializeForExport(config: AppConfig): string {
    return JSON.stringify(config, null, 2);
  }

  public parseImportedJson(rawJson: string): { ok: boolean; config?: AppConfig; error?: string } {
    try {
      const parsed = JSON.parse(rawJson);
      const check = this.validateConfig(parsed);
      if (!check.valid) {
        return { ok: false, error: check.errors.join(' / ') };
      }
      return { ok: true, config: this.normalizeActiveProfile(parsed as AppConfig) };
    } catch (err) {
      return {
        ok: false,
        error: `JSON 파싱 오류: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private normalizeActiveProfile(config: AppConfig): AppConfig {
    return normalizeLoadedConfig(config);
  }
}
