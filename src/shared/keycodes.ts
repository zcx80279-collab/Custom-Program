import { ModifierKey } from './types';

export interface CanonicalKeySpec {
  code: string;
  label: string;
  category: 'LETTER' | 'NUMBER' | 'FUNCTION' | 'CONTROL' | 'NAVIGATION' | 'MEDIA';
  /** USB HID Usage Page 0x07 (Keyboard/Keypad) Usage ID */
  hidUsageId: number;
  /** Windows Virtual-Key Code (winuser.h VK_*) */
  winVkCode: number;
}

/**
 * USB HID modifier bitmask (USB HID 1.11 Boot Keyboard Protocol byte 0)
 * Bit 0: Left Ctrl (0x01)
 * Bit 1: Left Shift (0x02)
 * Bit 2: Left Alt (0x04)
 * Bit 3: Left GUI / Win (0x08)
 */
export const MODIFIER_HID_BITMASK: Record<ModifierKey, number> = {
  CTRL: 0x01,
  SHIFT: 0x02,
  ALT: 0x04,
  WIN: 0x08,
};

export const MODIFIER_WIN_VK: Record<ModifierKey, number> = {
  CTRL: 0x11,  // VK_CONTROL
  SHIFT: 0x10, // VK_SHIFT
  ALT: 0x12,   // VK_MENU
  WIN: 0x5b,   // VK_LWIN
};

export const MODIFIER_LABELS: Record<ModifierKey, string> = {
  CTRL: 'Ctrl',
  SHIFT: 'Shift',
  ALT: 'Alt',
  WIN: 'Win',
};

/**
 * Whitelisted key table shared by Windows PC MacroEngine and ESP32-S3 HID firmware.
 * Restricting keys to this table prevents arbitrary command injection.
 */
export const CANONICAL_KEYS: CanonicalKeySpec[] = [
  // Letters A-Z (HID 0x04..0x1D, VK 0x41..0x5A)
  ...Array.from({ length: 26 }, (_, i) => {
    const ch = String.fromCharCode(65 + i);
    return {
      code: `Key${ch}`,
      label: ch,
      category: 'LETTER' as const,
      hidUsageId: 0x04 + i,
      winVkCode: 0x41 + i,
    };
  }),
  // Numbers 0-9
  { code: 'Digit1', label: '1', category: 'NUMBER', hidUsageId: 0x1e, winVkCode: 0x31 },
  { code: 'Digit2', label: '2', category: 'NUMBER', hidUsageId: 0x1f, winVkCode: 0x32 },
  { code: 'Digit3', label: '3', category: 'NUMBER', hidUsageId: 0x20, winVkCode: 0x33 },
  { code: 'Digit4', label: '4', category: 'NUMBER', hidUsageId: 0x21, winVkCode: 0x34 },
  { code: 'Digit5', label: '5', category: 'NUMBER', hidUsageId: 0x22, winVkCode: 0x35 },
  { code: 'Digit6', label: '6', category: 'NUMBER', hidUsageId: 0x23, winVkCode: 0x36 },
  { code: 'Digit7', label: '7', category: 'NUMBER', hidUsageId: 0x24, winVkCode: 0x37 },
  { code: 'Digit8', label: '8', category: 'NUMBER', hidUsageId: 0x25, winVkCode: 0x38 },
  { code: 'Digit9', label: '9', category: 'NUMBER', hidUsageId: 0x26, winVkCode: 0x39 },
  { code: 'Digit0', label: '0', category: 'NUMBER', hidUsageId: 0x27, winVkCode: 0x30 },

  // Control & Editing
  { code: 'Enter', label: 'Enter', category: 'CONTROL', hidUsageId: 0x28, winVkCode: 0x0d },
  { code: 'Escape', label: 'Esc', category: 'CONTROL', hidUsageId: 0x29, winVkCode: 0x1b },
  { code: 'Backspace', label: 'Backspace', category: 'CONTROL', hidUsageId: 0x2a, winVkCode: 0x08 },
  { code: 'Tab', label: 'Tab', category: 'CONTROL', hidUsageId: 0x2b, winVkCode: 0x09 },
  { code: 'Space', label: 'Space', category: 'CONTROL', hidUsageId: 0x2c, winVkCode: 0x20 },
  { code: 'Delete', label: 'Delete', category: 'CONTROL', hidUsageId: 0x4c, winVkCode: 0x2e },
  { code: 'PrintScreen', label: 'PrtSc', category: 'CONTROL', hidUsageId: 0x46, winVkCode: 0x2c },

  // Function Keys F1-F12
  ...Array.from({ length: 12 }, (_, i) => ({
    code: `F${i + 1}`,
    label: `F${i + 1}`,
    category: 'FUNCTION' as const,
    hidUsageId: 0x3a + i,
    winVkCode: 0x70 + i,
  })),

  // Navigation
  { code: 'Home', label: 'Home', category: 'NAVIGATION', hidUsageId: 0x4a, winVkCode: 0x24 },
  { code: 'PageUp', label: 'PgUp', category: 'NAVIGATION', hidUsageId: 0x4b, winVkCode: 0x21 },
  { code: 'End', label: 'End', category: 'NAVIGATION', hidUsageId: 0x4d, winVkCode: 0x23 },
  { code: 'PageDown', label: 'PgDn', category: 'NAVIGATION', hidUsageId: 0x4e, winVkCode: 0x22 },
  { code: 'ArrowRight', label: '→', category: 'NAVIGATION', hidUsageId: 0x4f, winVkCode: 0x27 },
  { code: 'ArrowLeft', label: '←', category: 'NAVIGATION', hidUsageId: 0x50, winVkCode: 0x25 },
  { code: 'ArrowDown', label: '↓', category: 'NAVIGATION', hidUsageId: 0x51, winVkCode: 0x28 },
  { code: 'ArrowUp', label: '↑', category: 'NAVIGATION', hidUsageId: 0x52, winVkCode: 0x26 },

  // Media / System (Windows VK mapped; HID consumer page handled in firmware notes)
  { code: 'VolumeMute', label: '음소거', category: 'MEDIA', hidUsageId: 0x7f, winVkCode: 0xad },
  { code: 'VolumeUp', label: '볼륨 +', category: 'MEDIA', hidUsageId: 0x80, winVkCode: 0xaf },
  { code: 'VolumeDown', label: '볼륨 -', category: 'MEDIA', hidUsageId: 0x81, winVkCode: 0xae },
];

const KEY_BY_CODE = new Map<string, CanonicalKeySpec>(
  CANONICAL_KEYS.map((k) => [k.code, k])
);

export function getKeySpec(code: string | undefined): CanonicalKeySpec | undefined {
  if (!code) return undefined;
  return KEY_BY_CODE.get(code);
}

export function isValidKeyCode(code: string | undefined): boolean {
  return Boolean(code && KEY_BY_CODE.has(code));
}

export function modifiersToHidMask(modifiers: ModifierKey[] | undefined): number {
  if (!modifiers || modifiers.length === 0) return 0;
  return modifiers.reduce((mask, mod) => mask | (MODIFIER_HID_BITMASK[mod] ?? 0), 0);
}

export function formatKeyCombo(key: string | undefined, modifiers?: ModifierKey[]): string {
  const spec = getKeySpec(key);
  const keyLabel = spec ? spec.label : key ?? '?';
  if (!modifiers || modifiers.length === 0) {
    return keyLabel;
  }
  const modStr = modifiers.map((m) => MODIFIER_LABELS[m]).join('+');
  return `${modStr}+${keyLabel}`;
}
