import {
  AppConfig,
  CONFIG_SCHEMA_VERSION,
  LayoutPreset,
  MacroDefinition,
  MacroStep,
  MacroStepType,
  ProfileDefinition,
  SlotTransitionMode,
} from './types';
import { mergeBuiltInPresets } from './presets';
import { createButtonsForLayout, createDefaultMacroSlots } from './defaults';

export interface ParsedArgsResult {
  ok: boolean;
  args: string[];
  error?: string;
}

export interface PathValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/].+/;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\/]+\\[^\\/]+(?:\\.*)?$/;
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

/**
 * Splits a command-line argument string into an argv array without invoking any shell.
 * Supports double-quoted and single-quoted arguments (e.g. --file "C:\My Docs\a.txt").
 */
export function parseProgramArgs(raw: string): ParsedArgsResult {
  const input = raw.trim();
  if (!input) {
    return { ok: true, args: [] };
  }

  if (CONTROL_CHAR_RE.test(input)) {
    return {
      ok: false,
      args: [],
      error: '실행 인수에 제어 문자나 줄바꿈을 포함할 수 없습니다.',
    };
  }

  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === '\\' && inQuote === '"' && i + 1 < input.length && input[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += ch;
    tokenStarted = true;
  }

  if (inQuote) {
    return {
      ok: false,
      args: [],
      error: `실행 인수의 따옴표(${inQuote})가 닫히지 않았습니다.`,
    };
  }

  if (tokenStarted) {
    args.push(current);
  }

  if (args.length > 64) {
    return {
      ok: false,
      args: [],
      error: '실행 인수는 최대 64개까지 지정할 수 있습니다.',
    };
  }

  return { ok: true, args };
}

/**
 * Formats an argv array back into an editable string representation.
 */
export function formatProgramArgs(args?: string[]): string {
  if (!Array.isArray(args) || args.length === 0) return '';
  return args
    .map((arg) => {
      if (arg === '') return '""';
      if (/[\s"]/.test(arg)) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(' ');
}

/**
 * Extracts a clean display program name from a Windows executable path.
 * Example: "C:\Windows\System32\notepad.exe" -> "notepad"
 */
export function extractProgramNameFromPath(appPath?: string): string {
  if (!appPath) return '';
  const trimmed = appPath.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const segments = trimmed.split(/[\\/]/);
  const fileName = segments[segments.length - 1] ?? '';
  return fileName.replace(/\.exe$/i, '') || fileName;
}

/**
 * Normalizes a Windows path string for consistent comparison (case-insensitive on Win32).
 */
export function normalizeWindowsPathForMatch(filePath: string): string {
  return filePath.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Validates syntax and safety constraints of a Windows executable (.exe) path.
 * Actual filesystem existence and permissions are verified in Electron Main Process.
 */
export function validateWindowsExecutablePath(appPath?: string): PathValidationResult {
  if (typeof appPath !== 'string' || !appPath.trim()) {
    return { valid: false, error: '실행 파일 경로(.exe)를 입력하거나 찾아보기로 선택해야 합니다.' };
  }

  const trimmed = appPath.trim();
  if (trimmed.length > 1024) {
    return { valid: false, error: '실행 파일 경로가 너무 깁니다 (최대 1024자).' };
  }

  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { valid: false, error: '실행 파일 경로에 제어 문자나 줄바꿈을 포함할 수 없습니다.' };
  }

  if (trimmed.includes('"') || trimmed.includes('|') || trimmed.includes('<') || trimmed.includes('>')) {
    return {
      valid: false,
      error: '실행 파일 경로에는 따옴표나 쉘 리다이렉션 문자(|, <, >)를 포함할 수 없습니다. 실행 인수는 별도 입력란에 입력하세요.',
    };
  }

  const isAbsoluteWinPath =
    WINDOWS_DRIVE_PATH_RE.test(trimmed) || WINDOWS_UNC_PATH_RE.test(trimmed);
  if (!isAbsoluteWinPath) {
    return {
      valid: false,
      error: 'Windows 전체 절대 경로를 입력해야 합니다 (예: C:\\Program Files\\App\\app.exe).',
    };
  }

  if (!/\.exe$/i.test(trimmed)) {
    return {
      valid: false,
      error: '기본 지원 대상은 Windows 실행 파일(.exe)입니다. .exe 파일을 선택해 주세요.',
    };
  }

  return { valid: true };
}

/**
 * Validates optional working directory path syntax.
 */
export function validateWorkingDirectoryPath(workingDir?: string): PathValidationResult {
  if (workingDir === undefined || workingDir === null || workingDir.trim() === '') {
    return { valid: true };
  }

  const trimmed = workingDir.trim();
  if (trimmed.length > 1024) {
    return { valid: false, error: '작업 디렉터리 경로가 너무 깁니다 (최대 1024자).' };
  }

  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { valid: false, error: '작업 디렉터리 경로에 제어 문자나 줄바꿈을 포함할 수 없습니다.' };
  }

  if (trimmed.includes('"') || trimmed.includes('|') || trimmed.includes('<') || trimmed.includes('>')) {
    return { valid: false, error: '작업 디렉터리 경로에 허용되지 않는 특수 문자가 포함되어 있습니다.' };
  }

  const isAbsoluteWinDir =
    /^[A-Za-z]:([\\/].*)?$/.test(trimmed) || WINDOWS_UNC_PATH_RE.test(trimmed);
  if (!isAbsoluteWinDir) {
    return {
      valid: false,
      error: '작업 디렉터리는 Windows 절대 경로여야 합니다 (예: C:\\Users\\Name\\Projects).',
    };
  }

  return { valid: true };
}

export function macroHasLaunchApp(macro: Pick<MacroDefinition, 'steps'>): boolean {
  return Array.isArray(macro.steps) && macro.steps.some((s) => s.type === MacroStepType.LAUNCH_APP);
}

/**
 * Normalizes a MacroStep loaded from existing v2.0.0 or v2.1.0 configs
 * for seamless backward compatibility.
 */
export function normalizeMacroStep(step: MacroStep): MacroStep {
  if (step.type !== MacroStepType.LAUNCH_APP) {
    return {
      id: step.id,
      type: step.type,
      ...(step.key !== undefined ? { key: step.key } : {}),
      ...(step.modifiers !== undefined ? { modifiers: [...step.modifiers] } : {}),
      ...(step.delayMs !== undefined ? { delayMs: step.delayMs } : {}),
    };
  }

  const rawArgs = step.appArgs as unknown;
  let normalizedArgs: string[] = [];
  if (Array.isArray(rawArgs)) {
    normalizedArgs = rawArgs
      .filter((a): a is string => typeof a === 'string')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
    const parsed = parseProgramArgs(rawArgs);
    normalizedArgs = parsed.ok ? parsed.args : [];
  }

  const appPath = typeof step.appPath === 'string' ? step.appPath.trim() : '';
  const appName =
    typeof step.appName === 'string' && step.appName.trim()
      ? step.appName.trim()
      : extractProgramNameFromPath(appPath);
  const workingDir =
    typeof step.workingDir === 'string' && step.workingDir.trim()
      ? step.workingDir.trim()
      : undefined;

  return {
    id: step.id,
    type: MacroStepType.LAUNCH_APP,
    appName,
    appPath,
    ...(normalizedArgs.length > 0 ? { appArgs: normalizedArgs } : {}),
    ...(workingDir ? { workingDir } : {}),
  };
}

export function normalizeProfile(profile: ProfileDefinition): ProfileDefinition {
  const layout = profile.layout || LayoutPreset.RADIAL_6_CENTER;
  let macroSlots = profile.macroSlots;
  if (!Array.isArray(macroSlots) || macroSlots.length !== 3) {
    const existingButtons = Array.isArray(profile.buttons) ? profile.buttons : undefined;
    macroSlots = createDefaultMacroSlots(layout, existingButtons);
  } else {
    macroSlots = macroSlots.map((slot, idx) => ({
      slotIndex: idx + 1,
      name: slot.name || `슬롯 ${idx + 1}`,
      buttons: createButtonsForLayout(layout, slot.buttons),
    }));
  }

  const activeSlotIndex =
    typeof profile.activeMacroSlotIndex === 'number' &&
    profile.activeMacroSlotIndex >= 1 &&
    profile.activeMacroSlotIndex <= 3
      ? profile.activeMacroSlotIndex
      : 1;

  const activeButtons = macroSlots[activeSlotIndex - 1].buttons;

  return {
    ...profile,
    layout,
    macroSlots,
    activeMacroSlotIndex: activeSlotIndex,
    buttons: activeButtons,
  };
}

/**
 * Migrates/normalizes loaded AppConfig from v2.0.0 to current v2.1.0 structure
 * without dropping any existing macros, profiles, or preferences.
 */
export function normalizeLoadedConfig(config: AppConfig): AppConfig {
  const activeExists = config.profiles.some((p) => p.id === config.activeProfileId);
  const shortcutPresets = mergeBuiltInPresets(config.shortcutPresets);
  const activePresetExists =
    typeof config.activePresetId === 'string' &&
    shortcutPresets.some((p) => p.id === config.activePresetId);

  const slotTransitionMode =
    config.preferences?.slotTransitionMode === SlotTransitionMode.STOP_AT_ENDS
      ? SlotTransitionMode.STOP_AT_ENDS
      : SlotTransitionMode.CIRCULAR;

  return {
    ...config,
    schemaVersion: config.schemaVersion || CONFIG_SCHEMA_VERSION,
    activeProfileId: activeExists ? config.activeProfileId : config.profiles[0]?.id ?? 'profile-default',
    profiles: Array.isArray(config.profiles) && config.profiles.length > 0
      ? config.profiles.map(normalizeProfile)
      : [],
    macros: Array.isArray(config.macros)
      ? config.macros.map((m) => ({
          ...m,
          steps: Array.isArray(m.steps) ? m.steps.map(normalizeMacroStep) : [],
        }))
      : [],
    shortcutPresets,
    activePresetId: activePresetExists ? config.activePresetId : null,
    preferences: {
      autoReconnect: config.preferences?.autoReconnect ?? true,
      reconnectIntervalMs: config.preferences?.reconnectIntervalMs ?? 3000,
      preferredPortPath: config.preferences?.preferredPortPath ?? null,
      hidPreferredWhenAvailable: config.preferences?.hidPreferredWhenAvailable ?? true,
      macroTestMode: config.preferences?.macroTestMode ?? false,
      slotTransitionMode,
    },
  };
}
