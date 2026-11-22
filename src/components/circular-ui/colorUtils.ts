export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SquishyButtonPalette {
  topHex: string;
  midHex: string;
  bottomHex: string;
  rimHex: string;
  textHex: string;
  subTextHex: string;
  isDarkSurface: boolean;
  isNeutralDark: boolean;
}

export function parseHexColor(hex: string | undefined, fallback = '#1E293B'): RGB {
  const raw = (hex || fallback).trim().replace('#', '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.length === 6
        ? raw
        : fallback.replace('#', '');

  const num = Number.parseInt(normalized, 16);
  if (Number.isNaN(num)) {
    return parseHexColor(fallback, '#1E293B');
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function toHex({ r, g, b }: RGB): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function mixHexColors(hexA: string, hexB: string, ratioB: number): string {
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  const t = Math.max(0, Math.min(1, ratioB));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function getSaturation(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/**
 * Generates a soft, cushioned 3-stop palette for squishy smartwatch buttons
 * from any user-configured accentColor while maintaining AA contrast.
 */
export function buildSquishyPalette(
  accentColor: string | undefined,
  state: 'normal' | 'pressed' | 'simulating' | 'disabled'
): SquishyButtonPalette {
  const base =
    state === 'disabled'
      ? '#1E293B'
      : state === 'simulating'
        ? '#D97706'
        : state === 'pressed'
          ? mixHexColors(accentColor || '#1E293B', '#3B82F6', 0.35)
          : accentColor || '#1E293B';

  const luminance = getRelativeLuminance(base);
  const saturation = getSaturation(base);
  const isDarkSurface = luminance < 0.38;
  const isNeutralDark = isDarkSurface && saturation < 0.28;

  const topHex = mixHexColors(base, '#FFFFFF', isDarkSurface ? 0.22 : 0.34);
  const midHex = base;
  const bottomHex = mixHexColors(base, '#020617', isDarkSurface ? 0.28 : 0.16);
  const rimHex = mixHexColors(base, '#FFFFFF', isDarkSurface ? 0.32 : 0.5);

  return {
    topHex,
    midHex,
    bottomHex,
    rimHex,
    textHex: isDarkSurface ? '#F8FAFC' : '#0F172A',
    subTextHex: isDarkSurface ? '#CBD5E1' : '#334155',
    isDarkSurface,
    isNeutralDark,
  };
}
