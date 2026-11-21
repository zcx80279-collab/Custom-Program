import {
  AppConfig,
  CircularButtonConfig,
  LayoutPreset,
  LogLevel,
  ProfileDefinition,
} from '../shared/types';
import { createButtonsForLayout } from '../shared/defaults';
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

    const newProfile: ProfileDefinition = {
      id,
      name: cleanName,
      description: description.trim(),
      layout,
      backgroundColor: '#0F172A',
      buttons: createButtonsForLayout(layout),
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
    const copy: ProfileDefinition = {
      ...source,
      id: newId,
      name: `${source.name} (복사본)`,
      buttons: source.buttons.map((b) => ({ ...b, id: `${newId}-slot-${b.slotIndex}` })),
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
        lastModifiedAt: new Date().toISOString(),
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

  public changeProfileLayout(config: AppConfig, profileId: string, layout: LayoutPreset): AppConfig {
    const now = new Date().toISOString();
    this.diagnostics.log(LogLevel.INFO, 'ProfileManager', `프로필 레이아웃 변경: ${layout}`);

    return {
      ...config,
      profiles: config.profiles.map((p) =>
        p.id === profileId
          ? {
              ...p,
              layout,
              buttons: createButtonsForLayout(layout, p.buttons),
              updatedAt: now,
            }
          : p
      ),
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
      profiles: config.profiles.map((p) =>
        p.id === profileId
          ? {
              ...p,
              buttons: p.buttons.map((b) =>
                b.slotIndex === slotIndex ? { ...b, ...patch } : b
              ),
              updatedAt: now,
            }
          : p
      ),
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
    this.diagnostics.log(
      LogLevel.INFO,
      'ProfileManager',
      `슬롯 ${slotIndex} 매크로 할당: ${macro ? macro.name : '할당 해제'}`
    );
    return this.updateButton(config, profileId, slotIndex, { macroId });
  }
}
