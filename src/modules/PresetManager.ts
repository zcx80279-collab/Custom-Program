import {
  AppConfig,
  CircularButtonConfig,
  ExportedPresetPackage,
  LayoutPreset,
  LogLevel,
  MacroDefinition,
  MacroExecutionMode,
  MacroStepType,
  PresetButtonMapping,
  ShortcutPreset,
} from '../shared/types';
import { isValidKeyCode } from '../shared/keycodes';
import {
  normalizeMacroStep,
  validateWindowsExecutablePath,
  validateWorkingDirectoryPath,
} from '../shared/programLaunch';
import { getBuiltInPresetMacros, mergeBuiltInPresets } from '../shared/presets';
import { DiagnosticsManager } from './DiagnosticsManager';

export interface PresetDraft {
  name: string;
  targetApp: string;
  description: string;
  buttons: PresetButtonMapping[];
}

export interface ActivePresetStatus {
  preset: ShortcutPreset | null;
  isModified: boolean;
}

const DEFAULT_SLOT_COLORS = [
  '#1E293B',
  '#2563EB',
  '#0284C7',
  '#0F766E',
  '#4F46E5',
  '#334155',
];

export function createEmptyPresetButtons(): PresetButtonMapping[] {
  return Array.from({ length: 6 }, (_, i) => {
    const slotIndex = i + 1;
    return {
      slotIndex,
      label: `버튼 ${slotIndex}`,
      shortLabel: `BTN ${slotIndex}`,
      accentColor: DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length],
      macroId: null,
      enabled: true,
    };
  });
}

function normalizeSixButtons(buttons: PresetButtonMapping[]): PresetButtonMapping[] {
  const bySlot = new Map(buttons.map((b) => [b.slotIndex, b]));
  return Array.from({ length: 6 }, (_, i) => {
    const slotIndex = i + 1;
    const found = bySlot.get(slotIndex);
    if (!found) {
      return {
        slotIndex,
        label: `버튼 ${slotIndex}`,
        shortLabel: `BTN ${slotIndex}`,
        accentColor: DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length],
        macroId: null,
        enabled: true,
      };
    }
    const cleanLabel = (found.label || `버튼 ${slotIndex}`).trim().slice(0, 24);
    const cleanShort = (found.shortLabel || cleanLabel || `BTN ${slotIndex}`).trim().slice(0, 8);
    return {
      slotIndex,
      label: cleanLabel || `버튼 ${slotIndex}`,
      shortLabel: cleanShort || `BTN ${slotIndex}`,
      accentColor: /^#[0-9A-Fa-f]{6}$/.test(found.accentColor)
        ? found.accentColor
        : DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length],
      macroId: found.macroId ?? null,
      enabled: Boolean(found.enabled),
    };
  });
}

export class PresetManager {
  constructor(private readonly diagnostics: DiagnosticsManager) {}

  public getPresets(config: AppConfig): ShortcutPreset[] {
    return mergeBuiltInPresets(config.shortcutPresets);
  }

  /**
   * Returns user macros combined with built-in preset shortcut definitions (without duplicates)
   * so preset builders can immediately assign any preset shortcut or user macro.
   */
  public getSelectableMacros(config: AppConfig): MacroDefinition[] {
    const existingIds = new Set(config.macros.map((m) => m.id));
    const builtInExtras = getBuiltInPresetMacros().filter((m) => !existingIds.has(m.id));
    return [...config.macros, ...builtInExtras];
  }

  public getActivePresetStatus(config: AppConfig): ActivePresetStatus {
    if (!config.activePresetId) {
      return { preset: null, isModified: false };
    }
    const presets = this.getPresets(config);
    const preset = presets.find((p) => p.id === config.activePresetId) ?? null;
    if (!preset) {
      return { preset: null, isModified: false };
    }

    const activeProfile =
      config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];
    if (!activeProfile || activeProfile.layout !== LayoutPreset.RADIAL_6_CENTER) {
      return { preset, isModified: true };
    }

    const normalizedPresetButtons = normalizeSixButtons(preset.buttons);
    const isModified = normalizedPresetButtons.some((pb) => {
      const current = activeProfile.buttons.find((b) => b.slotIndex === pb.slotIndex);
      if (!current) return true;
      return (
        current.macroId !== pb.macroId ||
        current.label !== pb.label ||
        current.shortLabel !== pb.shortLabel ||
        current.accentColor !== pb.accentColor ||
        current.enabled !== pb.enabled
      );
    });

    return { preset, isModified };
  }

  /**
   * Non-destructively ensures any built-in preset macros referenced by macroIds
   * exist in config.macros without overwriting or removing user macros.
   */
  private materializeBuiltInMacros(
    existingMacros: MacroDefinition[],
    macroIds: Array<string | null>
  ): MacroDefinition[] {
    const existingIds = new Set(existingMacros.map((m) => m.id));
    const needed = new Set(macroIds.filter((id): id is string => Boolean(id)));
    const builtInCatalog = getBuiltInPresetMacros();
    const toAppend = builtInCatalog.filter((m) => needed.has(m.id) && !existingIds.has(m.id));
    return toAppend.length > 0 ? [...existingMacros, ...toAppend] : existingMacros;
  }

  public createPreset(
    config: AppConfig,
    draft: PresetDraft
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    const cleanName = draft.name.trim();
    if (!cleanName) {
      return { ok: false, config, error: '프리셋 이름을 입력해야 합니다.' };
    }

    const now = new Date().toISOString();
    const id = `preset-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const buttons = normalizeSixButtons(draft.buttons);
    const nextMacros = this.materializeBuiltInMacros(
      config.macros,
      buttons.map((b) => b.macroId)
    );

    const newPreset: ShortcutPreset = {
      id,
      name: cleanName.slice(0, 40),
      targetApp: draft.targetApp.trim().slice(0, 80) || '사용자 지정 앱',
      description: draft.description.trim().slice(0, 160),
      isBuiltIn: false,
      buttons,
      createdAt: now,
      updatedAt: now,
    };

    const currentPresets = this.getPresets(config);
    this.diagnostics.log(
      LogLevel.INFO,
      'PresetManager',
      `사용자 단축키 프리셋 생성: "${newPreset.name}" (대상: ${newPreset.targetApp})`
    );

    return {
      ok: true,
      preset: newPreset,
      config: {
        ...config,
        macros: nextMacros,
        shortcutPresets: [...currentPresets, newPreset],
        lastModifiedAt: now,
      },
    };
  }

  public createPresetFromActiveProfile(
    config: AppConfig,
    name: string,
    targetApp: string,
    description = ''
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    const activeProfile =
      config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];

    const buttons: PresetButtonMapping[] = Array.from({ length: 6 }, (_, i) => {
      const slotIndex = i + 1;
      const existing = activeProfile?.buttons.find((b) => b.slotIndex === slotIndex);
      if (existing) {
        return {
          slotIndex,
          label: existing.label,
          shortLabel: existing.shortLabel,
          accentColor: existing.accentColor,
          macroId: existing.macroId,
          enabled: existing.enabled,
        };
      }
      return {
        slotIndex,
        label: `버튼 ${slotIndex}`,
        shortLabel: `BTN ${slotIndex}`,
        accentColor: DEFAULT_SLOT_COLORS[i % DEFAULT_SLOT_COLORS.length],
        macroId: null,
        enabled: true,
      };
    });

    const created = this.createPreset(config, {
      name,
      targetApp,
      description,
      buttons,
    });

    if (!created.ok || !created.preset) return created;

    return {
      ...created,
      config: {
        ...created.config,
        activePresetId:
          activeProfile?.layout === LayoutPreset.RADIAL_6_CENTER
            ? created.preset.id
            : created.config.activePresetId ?? null,
      },
    };
  }

  public updatePreset(
    config: AppConfig,
    presetId: string,
    draft: PresetDraft
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    const currentPresets = this.getPresets(config);
    const existing = currentPresets.find((p) => p.id === presetId);
    if (!existing) {
      return { ok: false, config, error: '수정할 프리셋을 찾을 수 없습니다.' };
    }
    if (existing.isBuiltIn) {
      return {
        ok: false,
        config,
        error: '기본 프리셋은 직접 수정할 수 없습니다. 복제하여 사용자 프리셋으로 편집해 주세요.',
      };
    }

    const cleanName = draft.name.trim();
    if (!cleanName) {
      return { ok: false, config, error: '프리셋 이름을 입력해야 합니다.' };
    }

    const now = new Date().toISOString();
    const buttons = normalizeSixButtons(draft.buttons);
    const nextMacros = this.materializeBuiltInMacros(
      config.macros,
      buttons.map((b) => b.macroId)
    );

    const updated: ShortcutPreset = {
      ...existing,
      name: cleanName.slice(0, 40),
      targetApp: draft.targetApp.trim().slice(0, 80) || '사용자 지정 앱',
      description: draft.description.trim().slice(0, 160),
      buttons,
      updatedAt: now,
    };

    this.diagnostics.log(LogLevel.INFO, 'PresetManager', `사용자 프리셋 수정: "${updated.name}"`);

    return {
      ok: true,
      preset: updated,
      config: {
        ...config,
        macros: nextMacros,
        shortcutPresets: currentPresets.map((p) => (p.id === presetId ? updated : p)),
        lastModifiedAt: now,
      },
    };
  }

  public duplicatePreset(
    config: AppConfig,
    presetId: string
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    const currentPresets = this.getPresets(config);
    const source = currentPresets.find((p) => p.id === presetId);
    if (!source) {
      return { ok: false, config, error: '복제할 프리셋을 찾을 수 없습니다.' };
    }

    const now = new Date().toISOString();
    const id = `preset-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const copy: ShortcutPreset = {
      ...source,
      id,
      name: `${source.name} (복사본)`.slice(0, 40),
      isBuiltIn: false,
      buttons: normalizeSixButtons(source.buttons),
      createdAt: now,
      updatedAt: now,
    };

    this.diagnostics.log(
      LogLevel.INFO,
      'PresetManager',
      `단축키 프리셋 복제: "${source.name}" -> "${copy.name}"`
    );

    return {
      ok: true,
      preset: copy,
      config: {
        ...config,
        shortcutPresets: [...currentPresets, copy],
        lastModifiedAt: now,
      },
    };
  }

  public deletePreset(
    config: AppConfig,
    presetId: string
  ): { ok: boolean; config: AppConfig; error?: string } {
    const currentPresets = this.getPresets(config);
    const target = currentPresets.find((p) => p.id === presetId);
    if (!target) {
      return { ok: false, config, error: '삭제할 프리셋을 찾을 수 없습니다.' };
    }
    if (target.isBuiltIn) {
      return { ok: false, config, error: '기본 제공 프리셋은 삭제할 수 없습니다.' };
    }

    const now = new Date().toISOString();
    this.diagnostics.log(LogLevel.INFO, 'PresetManager', `사용자 프리셋 삭제: "${target.name}"`);

    return {
      ok: true,
      config: {
        ...config,
        shortcutPresets: currentPresets.filter((p) => p.id !== presetId),
        activePresetId: config.activePresetId === presetId ? null : config.activePresetId ?? null,
        lastModifiedAt: now,
      },
    };
  }

  /**
   * Applies the selected 6-button preset to the currently active profile without deleting
   * or overwriting existing macros in config.macros or other profiles.
   */
  public applyPreset(
    config: AppConfig,
    presetId: string
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    const currentPresets = this.getPresets(config);
    const preset = currentPresets.find((p) => p.id === presetId);
    if (!preset) {
      return { ok: false, config, error: '적용할 프리셋을 찾을 수 없습니다.' };
    }

    const now = new Date().toISOString();
    const normalizedButtons = normalizeSixButtons(preset.buttons);
    const nextMacros = this.materializeBuiltInMacros(
      config.macros,
      normalizedButtons.map((b) => b.macroId)
    );

    const activeProfile =
      config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];

    const updatedButtons: CircularButtonConfig[] = normalizedButtons.map((pb) => ({
      slotIndex: pb.slotIndex,
      id: `${activeProfile.id}-slot-${pb.slotIndex}`,
      label: pb.label,
      shortLabel: pb.shortLabel,
      accentColor: pb.accentColor,
      macroId: pb.macroId,
      enabled: pb.enabled,
    }));

    const nextProfiles = config.profiles.map((p) =>
      p.id === activeProfile.id
        ? {
            ...p,
            layout: LayoutPreset.RADIAL_6_CENTER,
            buttons: updatedButtons,
            updatedAt: now,
          }
        : p
    );

    this.diagnostics.log(
      LogLevel.INFO,
      'PresetManager',
      `단축키 프리셋 적용: "${preset.name}" -> 프로필 "${activeProfile.name}" (기존 매크로 ${config.macros.length}개 유지)`
    );

    return {
      ok: true,
      preset,
      config: {
        ...config,
        profiles: nextProfiles,
        macros: nextMacros,
        shortcutPresets: currentPresets,
        activePresetId: preset.id,
        lastModifiedAt: now,
      },
    };
  }

  public exportPresetPackage(config: AppConfig, presetId: string): string | null {
    const presets = this.getPresets(config);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return null;

    const allMacros = this.getSelectableMacros(config);
    const macroById = new Map(allMacros.map((m) => [m.id, m]));
    const referencedIds = Array.from(
      new Set(preset.buttons.map((b) => b.macroId).filter((id): id is string => Boolean(id)))
    );
    const includedMacros = referencedIds
      .map((id) => macroById.get(id))
      .filter((m): m is MacroDefinition => Boolean(m));

    const pkg: ExportedPresetPackage = {
      format: 'roundmacro-preset-v1',
      exportedAt: new Date().toISOString(),
      preset: {
        ...preset,
        buttons: normalizeSixButtons(preset.buttons),
      },
      macros: includedMacros,
    };

    this.diagnostics.log(LogLevel.INFO, 'PresetManager', `단축키 프리셋 내보내기: "${preset.name}"`);
    return JSON.stringify(pkg, null, 2);
  }

  public importPresetPackage(
    config: AppConfig,
    rawJson: string
  ): { ok: boolean; config: AppConfig; preset?: ShortcutPreset; error?: string } {
    try {
      const parsed = JSON.parse(rawJson) as Partial<ExportedPresetPackage> & Partial<ShortcutPreset>;
      const rawPreset: Partial<ShortcutPreset> | undefined =
        parsed && parsed.format === 'roundmacro-preset-v1' && parsed.preset
          ? parsed.preset
          : parsed && Array.isArray(parsed.buttons)
            ? parsed
            : undefined;

      if (!rawPreset || typeof rawPreset.name !== 'string' || !rawPreset.name.trim()) {
        return {
          ok: false,
          config,
          error: '유효한 RoundMacro 프리셋 JSON 파일이 아닙니다 (프리셋 이름 또는 버튼 정보 누락).',
        };
      }

      if (!Array.isArray(rawPreset.buttons) || rawPreset.buttons.length === 0) {
        return { ok: false, config, error: '프리셋 버튼 매핑 목록이 비어 있습니다.' };
      }

      const rawMacros: MacroDefinition[] = Array.isArray(parsed.macros) ? parsed.macros : [];
      const existingById = new Map(config.macros.map((m) => [m.id, m]));
      const builtInById = new Map(getBuiltInPresetMacros().map((m) => [m.id, m]));
      const idRemap = new Map<string, string>();
      const addedMacros: MacroDefinition[] = [];
      const now = new Date().toISOString();

      for (const rm of rawMacros) {
        if (!rm || typeof rm.id !== 'string' || typeof rm.name !== 'string' || !Array.isArray(rm.steps)) {
          continue;
        }
        if (!Object.values(MacroExecutionMode).includes(rm.executionMode)) {
          return { ok: false, config, error: `가져온 매크로 "${rm.name}"의 실행 방식이 유효하지 않습니다.` };
        }

        const normalizedSteps = rm.steps.map(normalizeMacroStep);
        for (const st of normalizedSteps) {
          if (!Object.values(MacroStepType).includes(st.type)) {
            return { ok: false, config, error: `가져온 매크로 "${rm.name}"에 알 수 없는 단계가 있습니다.` };
          }
          if (st.type === MacroStepType.DELAY) {
            const ms = Number(st.delayMs);
            if (!Number.isFinite(ms) || ms < 10 || ms > 10000) {
              return { ok: false, config, error: `가져온 매크로 "${rm.name}"의 지연 시간이 범위를 벗어났습니다.` };
            }
          } else if (st.type === MacroStepType.LAUNCH_APP) {
            const exeCheck = validateWindowsExecutablePath(st.appPath);
            if (!exeCheck.valid) {
              return { ok: false, config, error: `가져온 매크로 "${rm.name}": ${exeCheck.error}` };
            }
            const dirCheck = validateWorkingDirectoryPath(st.workingDir);
            if (!dirCheck.valid) {
              return { ok: false, config, error: `가져온 매크로 "${rm.name}": ${dirCheck.error}` };
            }
          } else if (!isValidKeyCode(st.key)) {
            return {
              ok: false,
              config,
              error: `가져온 매크로 "${rm.name}"에 허용되지 않은 키 코드(${String(st.key)})가 있습니다.`,
            };
          }
        }

        const existing = existingById.get(rm.id) ?? builtInById.get(rm.id);
        if (existing) {
          const sameSteps = JSON.stringify(existing.steps) === JSON.stringify(normalizedSteps);
          if (sameSteps) {
            if (!existingById.has(rm.id)) {
              addedMacros.push(existing);
              existingById.set(existing.id, existing);
            }
            continue;
          }
          // Avoid overwriting existing user/built-in macro with the same ID
          const freshMacroId = `macro-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          idRemap.set(rm.id, freshMacroId);
          const clonedMacro: MacroDefinition = {
            ...rm,
            id: freshMacroId,
            steps: normalizedSteps,
            createdAt: now,
            updatedAt: now,
          };
          addedMacros.push(clonedMacro);
          existingById.set(freshMacroId, clonedMacro);
        } else {
          const cleanMacro: MacroDefinition = {
            ...rm,
            steps: normalizedSteps,
            createdAt: rm.createdAt || now,
            updatedAt: now,
          };
          addedMacros.push(cleanMacro);
          existingById.set(cleanMacro.id, cleanMacro);
        }
      }

      const mappedButtons = normalizeSixButtons(
        rawPreset.buttons.map((b) => ({
          ...b,
          macroId: b.macroId ? idRemap.get(b.macroId) ?? b.macroId : null,
        }))
      );

      // Materialize any referenced built-in macros if they were not embedded
      const nextMacros = this.materializeBuiltInMacros(
        [...config.macros, ...addedMacros],
        mappedButtons.map((b) => b.macroId)
      );

      const newPresetId = `preset-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const importedPreset: ShortcutPreset = {
        id: newPresetId,
        name: rawPreset.name.trim().slice(0, 40),
        targetApp:
          typeof rawPreset.targetApp === 'string' && rawPreset.targetApp.trim()
            ? rawPreset.targetApp.trim().slice(0, 80)
            : '가져온 사용자 프리셋',
        description:
          typeof rawPreset.description === 'string' ? rawPreset.description.trim().slice(0, 160) : '',
        isBuiltIn: false,
        buttons: mappedButtons,
        createdAt: now,
        updatedAt: now,
      };

      const currentPresets = this.getPresets(config);
      this.diagnostics.log(
        LogLevel.INFO,
        'PresetManager',
        `단축키 프리셋 가져오기 완료: "${importedPreset.name}" (추가 매크로 ${addedMacros.length}개)`
      );

      return {
        ok: true,
        preset: importedPreset,
        config: {
          ...config,
          macros: nextMacros,
          shortcutPresets: [...currentPresets, importedPreset],
          lastModifiedAt: now,
        },
      };
    } catch (err) {
      return {
        ok: false,
        config,
        error: `프리셋 JSON 파싱 오류: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
