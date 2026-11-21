import { DISPLAY_HEIGHT, DISPLAY_RADIUS, DISPLAY_WIDTH, LayoutPreset } from './types';

export const CENTER_X = DISPLAY_WIDTH / 2; // 180
export const CENTER_Y = DISPLAY_HEIGHT / 2; // 180
export const CENTER_BUTTON_RADIUS = 56;
export const INNER_RING_RADIUS = 64;
export const OUTER_RING_RADIUS = 170;

export interface ButtonSlotGeometry {
  slotIndex: number;
  kind: 'CENTER' | 'SECTOR';
  /** Center coordinates for label placement */
  labelX: number;
  labelY: number;
  /** For SECTOR buttons: start & end angles in degrees (-90 = 12 o'clock) */
  startAngleDeg?: number;
  endAngleDeg?: number;
  /** SVG path string for crisp 360x360 circular rendering */
  svgPath: string;
}

export function getOuterSlotCount(layout: LayoutPreset): number {
  switch (layout) {
    case LayoutPreset.RADIAL_4_CENTER:
      return 4;
    case LayoutPreset.RADIAL_8_CENTER:
      return 8;
    case LayoutPreset.RADIAL_6_CENTER:
    default:
      return 6;
  }
}

export function getTotalSlotCount(layout: LayoutPreset): number {
  return 1 + getOuterSlotCount(layout);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = degToRad(angleDeg);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function buildAnnularSectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
  gapDeg: number
): string {
  const s = startDeg + gapDeg / 2;
  const e = endDeg - gapDeg / 2;
  const outerStart = polarToCartesian(cx, cy, outerR, s);
  const outerEnd = polarToCartesian(cx, cy, outerR, e);
  const innerEnd = polarToCartesian(cx, cy, innerR, e);
  const innerStart = polarToCartesian(cx, cy, innerR, s);
  const largeArc = e - s > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/**
 * Generates exact 360x360 circular slot geometries.
 * Mirrors the C++ hit-test geometry in firmware/src/touch_manager.cpp 1:1.
 */
export function buildLayoutGeometry(layout: LayoutPreset): ButtonSlotGeometry[] {
  const outerCount = getOuterSlotCount(layout);
  const sectorSweep = 360 / outerCount;
  // Offset so sector 1 is centered cleanly at 12 o'clock (-90 deg)
  const baseStartDeg = -90 - sectorSweep / 2;
  const gapDeg = 3.2;

  const slots: ButtonSlotGeometry[] = [
    {
      slotIndex: 0,
      kind: 'CENTER',
      labelX: CENTER_X,
      labelY: CENTER_Y,
      svgPath: `M ${CENTER_X - CENTER_BUTTON_RADIUS} ${CENTER_Y} a ${CENTER_BUTTON_RADIUS} ${CENTER_BUTTON_RADIUS} 0 1 0 ${CENTER_BUTTON_RADIUS * 2} 0 a ${CENTER_BUTTON_RADIUS} ${CENTER_BUTTON_RADIUS} 0 1 0 -${CENTER_BUTTON_RADIUS * 2} 0`,
    },
  ];

  const labelRadius = (INNER_RING_RADIUS + OUTER_RING_RADIUS) / 2;

  for (let i = 0; i < outerCount; i++) {
    const startAngleDeg = baseStartDeg + i * sectorSweep;
    const endAngleDeg = startAngleDeg + sectorSweep;
    const midAngleDeg = (startAngleDeg + endAngleDeg) / 2;
    const labelPos = polarToCartesian(CENTER_X, CENTER_Y, labelRadius, midAngleDeg);

    slots.push({
      slotIndex: i + 1,
      kind: 'SECTOR',
      labelX: labelPos.x,
      labelY: labelPos.y,
      startAngleDeg,
      endAngleDeg,
      svgPath: buildAnnularSectorPath(
        CENTER_X,
        CENTER_Y,
        INNER_RING_RADIUS,
        OUTER_RING_RADIUS,
        startAngleDeg,
        endAngleDeg,
        gapDeg
      ),
    });
  }

  return slots;
}

/**
 * Hit-tests a touch coordinate (x, y) on the 360x360 round display.
 * Identical mathematical formula implemented in ESP32-S3 TouchManager::hitTest().
 */
export function hitTestCircularDisplay(x: number, y: number, layout: LayoutPreset): number | null {
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > DISPLAY_RADIUS) {
    return null;
  }

  if (dist <= CENTER_BUTTON_RADIUS) {
    return 0;
  }

  if (dist < INNER_RING_RADIUS || dist > OUTER_RING_RADIUS) {
    return null;
  }

  const outerCount = getOuterSlotCount(layout);
  const sectorSweep = 360 / outerCount;

  // Angle in degrees where 12 o'clock = 0, increasing clockwise [0, 360)
  let clockwiseDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (clockwiseDeg < 0) clockwiseDeg += 360;

  // Shift by half a sector so sector 1 is centered on 0 deg (12 o'clock)
  const shifted = (clockwiseDeg + sectorSweep / 2) % 360;
  const sectorIndex = Math.floor(shifted / sectorSweep);

  return Math.min(outerCount, Math.max(1, sectorIndex + 1));
}
