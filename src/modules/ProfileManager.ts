import {
  AppConfig,
  CircularButtonConfig,
  LayoutPreset,
  LogLevel,
  ProfileDefinition,
  SlotTransitionMode,
} from '../shared/types';
import { createButtonsForLayout, createDefaultMacroSlots } from '../shared/defaults';
import { DiagnosticsManager } from './DiagnosticsManager';

export class ProfileManager {
  constructor(private readonly diagnostics: DiagnosticsManager) {}

  public getActiveProfile(config: AppConfig): ProfileDefinition {
    return (
      config.profiles.find((p) => p.id === config.activeProfileId) ??
      config.profiles[0]
    );
  }

  public createProfile(
    config: AppConfig,
    name: string,
    layout: LayoutPreset = LayoutPreset.RADIAL_6_CENTER,
    description = ''
  ): AppConfig {
    const cleanName = name.trim() || `새 프로필 ${config.profiles.length + 1}`;
    const now = new Date().toISOString();
    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const macroSlots = createDefaultMacroSlots(layout);

    const newProfile: ProfileDefinition = {
      id,
      name: cleanName,
      description: description.trim(),
      layout,
      backgroundColor: '#0F172A',
      macroSlots,
      activeMacroSlotIndex: 1,
      buttons: macroSlots[0].buttons,
      createdAt: now,
      updatedAt: now,
    };

    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 생성: "${cleanName}" (${layout})`);

    return {
      ...config,
      activeProfileId: id,
      profiles: [...config.profiles, newProfile],
      lastModifiedAt: now,
    };
  }

  public renameProfile(config: AppConfig, profileId: string, newName: string, newDescription?: string): AppConfig {
    const trimmed = newName.trim();
    if (!trimmed) return config;
    const now = new Date().toISOString();

    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 이름 변경: "${trimmed}"`);

    return {
      ...config,
      profiles: config.profiles.map((p) =>
        p.id === profileId
          ? {
              ...p,
              name: trimmed,
              description: newDescription !== undefined ? newDescription.trim() : p.description,
              updatedAt: now,
            }
          : p
      ),
      lastModifiedAt: now,
    };
  }

  public duplicateProfile(config: AppConfig, profileId: string): AppConfig {
    const source = config.profiles.find((p) => p.id === profileId);
    if (!source) return config;

    const now = new Date().toISOString();
    const newId = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const clonedSlots = source.macroSlots.map((slot) => ({
      ...slot,
      buttons: slot.buttons.map((b) => ({ ...b, id: `${newId}-s${slot.slotIndex}-slot-${b.slotIndex}` })),
    }));

    const copy: ProfileDefinition = {
      ...source,
      id: newId,
      name: `${source.name} (복사본)`,
      macroSlots: clonedSlots,
      activeMacroSlotIndex: source.activeMacroSlotIndex,
      buttons: clonedSlots[source.activeMacroSlotIndex - 1].buttons,
      createdAt: now,
      updatedAt: now,
    };

    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 복제: "${source.name}" -> "${copy.name}"`);

    return {
      ...config,
      activeProfileId: newId,
      profiles: [...config.profiles, copy],
      lastModifiedAt: now,
    };
  }

  public deleteProfile(config: AppConfig, profileId: string): { ok: boolean; config: AppConfig; error?: string } {
    if (config.profiles.length <= 1) {
      return {
        ok: false,
        config,
        error: '최소 1개의 프로필은 유지되어야 합니다.',
      };
    }

    const target = config.profiles.find((p) => p.id === profileId);
    if (!target) {
      return { ok: false, config, error: '삭제할 프로필을 찾을 수 없습니다.' };
    }

    const now = new Date().toISOString();
    const remaining = config.profiles.filter((p) => p.id !== profileId);
    const nextActiveId =
      config.activeProfileId === profileId ? remaining[0].id : config.activeProfileId;

    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 삭제: "${target.name}"`);

    return {
      ok: true,
      config: {
        ...config,
        activeProfileId: nextActiveId,
        profiles: remaining,
        lastModifiedAt: now,
      },
    };
  }

  public switchProfile(config: AppConfig, profileId: string): AppConfig {
    const target = config.profiles.find((p) => p.id === profileId);
    if (!target || config.activeProfileId === profileId) return config;

    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `활성 프로필 전환: "${target.name}"`);

    return {
      ...config,
      activeProfileId: profileId,
    };
  }

  public switchMacroSlot(config: AppConfig, profileId: string, slotIndex: number): AppConfig {
    if (slotIndex < 1 || slotIndex > 3) return config;
    const now = new Date().toISOString();

    return {
      ...config,
      profiles: config.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const targetSlot = p.macroSlots.find((s) => s.slotIndex === slotIndex) ?? p.macroSlots[0];
        return {
          ...p,
          activeMacroSlotIndex: slotIndex,
          buttons: targetSlot.buttons,
          updatedAt: now,
        };
      }),
      lastModifiedAt: now,
    };
  }

  public cycleMacroSlot(
    config: AppConfig,
    direction: 'NEXT' | 'PREV',
    mode: SlotTransitionMode = SlotTransitionMode.CIRCULAR
  ): AppConfig {
    const activeProfile = this.getActiveProfile(config);
    const currentIndex = activeProfile.activeMacroSlotIndex;
    let nextIndex = currentIndex;

    if (direction === 'NEXT') {
      if (mode === SlotTransitionMode.CIRCULAR) {
        nextIndex = (currentIndex % 3) + 1; // 1 -> 2 -> 3 -> 1
      } else {
        nextIndex = Math.min(3, currentIndex + 1); // 1 -> 2 -> 3 (stop at 3)
      }
    } else {
      if (mode === SlotTransitionMode.CIRCULAR) {
        nextIndex = currentIndex === 1 ? 3 : currentIndex - 1; // 3 -> 2 -> 1 -> 3
      } else {
        nextIndex = Math.max(1, currentIndex - 1); // 1 -> 1 -> 2 -> 3 (stop at 1)
      }
    }

    if (nextIndex === currentIndex) return config;

    this.diagnostics.log(
      LogLevel.INFO,
      'ProfileManager',
      `매크로 슬롯 좌우 전환: 슬롯 ${currentIndex} -> 슬롯 ${nextIndex} (${mode})`
    );

    return this.switchMacroSlot(config, activeProfile.id, nextIndex);
  }

  public changeProfileLayout(config: AppConfig, profileId: string, layout: LayoutPreset): AppConfig {
    const now = new Date().toISOString();
    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 레이아웃 변경: ${layout}`);

    return {
      ...config,
      profiles: config.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const updatedSlots = p.macroSlots.map((slot) => ({
          ...slot,
          buttons: createButtonsForLayout(layout, slot.buttons),
        }));
        const activeSlot = updatedSlots[p.activeMacroSlotIndex - 1] ?? updatedSlots[0];
        return {
          ...p,
          layout,
          macroSlots: updatedSlots,
          buttons: activeSlot.buttons,
          updatedAt: now,
        };
      }),
      lastModifiedAt: now,
    };
  }

  public updateButton(
    config: AppConfig,
    profileId: string,
    slotIndex: number,
    patch: Partial<CircularButtonConfig>
  ): AppConfig {
    const now = new Date().toISOString();
    return {
      ...config,
      profiles: config.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const activeSlotIdx = p.activeMacroSlotIndex;
        const updatedSlots = p.macroSlots.map((slot) => {
          if (slot.slotIndex !== activeSlotIdx) return slot;
          return {
            ...slot,
            buttons: slot.buttons.map((b) => (b.slotIndex === slotIndex ? { ...b, ...patch } : b)),
          };
        });
        const currentActiveSlot = updatedSlots[activeSlotIdx - 1];
        return {
          ...p,
          macroSlots: updatedSlots,
          buttons: currentActiveSlot.buttons,
          updatedAt: now,
        };
      }),
      lastModifiedAt: now,
    };
  }

  public assignMacroToButton(
    config: AppConfig,
    profileId: string,
    slotIndex: number,
    macroId: string | null
  ): AppConfig {
    const macro = macroId ? config.macros.find((m) => m.id === macroId) : null;
    const activeProfile = config.profiles.find((p) => p.id === profileId) ?? config.profiles[0];
    this.diagnostics.log(
      LogLevel.INFO,
      'ProfileManager',
      `[슬롯 ${activeProfile?.activeMacroSlotIndex ?? 1}] 버튼 ${slotIndex} 매크로 할당: ${
        macro ? macro.name : '할당 해제'
      }`
    );
    return this.updateButton(config, profileId, slotIndex, { macroId });
  }

  public pasteButtonSettings(
    config: AppConfig,
    profileId: string,
    targetSlotIndex: number,
    sourceButton: CircularButtonConfig
  ): AppConfig {
    const activeProfile = config.profiles.find((p) => p.id === profileId) ?? config.profiles[0];
    const slotPageIndex = activeProfile.activeMacroSlotIndex;
    this.diagnostics.log(
      LogLevel.INFO,
      'ProfileManager',
      `[슬롯 페이지 ${slotPageIndex}] 버튼 #${sourceButton.slotIndex} 설정을 버튼 #${targetSlotIndex}에 붙여넣기`
    );
    return this.updateButton(config, profileId, targetSlotIndex, {
      label: sourceButton.label,
      shortLabel: sourceButton.shortLabel,
      accentColor: sourceButton.accentColor,
      macroId: sourceButton.macroId,
      enabled: sourceButton.enabled,
    });
  }
}
