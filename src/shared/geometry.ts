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
  /** Center coordinates for squishy button bubble placement */
  buttonX: number;
  buttonY: number;
  /** Visual half-size / radius of the squishy button bubble */
  buttonRadius: number;
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
  return getOuterSlotCount(layout);
}

function getSquishyDimensions(outerCount: number): {
  ringRadius: number;
  outerRadius: number;
} {
  if (outerCount === 4) {
    return { ringRadius: 110, outerRadius: 48 };
  }
  if (outerCount === 8) {
    return { ringRadius: 120, outerRadius: 36 };
  }
  // Default 6 outer buttons: 92px outer bubbles arranged in a ring
  return { ringRadius: 115, outerRadius: 46 };
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
 * Generates exact 360x360 circular slot geometries (outer ring buttons only, center button removed).
 */
export function buildLayoutGeometry(layout: LayoutPreset): ButtonSlotGeometry[] {
  const outerCount = getOuterSlotCount(layout);
  const sectorSweep = 360 / outerCount;
  // Offset so sector 1 is centered cleanly at 12 o'clock (-90 deg)
  const baseStartDeg = -90 - sectorSweep / 2;
  const gapDeg = 3.2;
  const { ringRadius, outerRadius } = getSquishyDimensions(outerCount);

  const slots: ButtonSlotGeometry[] = [];
  const labelRadius = (INNER_RING_RADIUS + OUTER_RING_RADIUS) / 2;

  for (let i = 0; i < outerCount; i++) {
    const startAngleDeg = baseStartDeg + i * sectorSweep;
    const endAngleDeg = startAngleDeg + sectorSweep;
    const midAngleDeg = (startAngleDeg + endAngleDeg) / 2;
    const labelPos = polarToCartesian(CENTER_X, CENTER_Y, labelRadius, midAngleDeg);
    const bubblePos = polarToCartesian(CENTER_X, CENTER_Y, ringRadius, midAngleDeg);

    slots.push({
      slotIndex: i + 1,
      kind: 'SECTOR',
      labelX: labelPos.x,
      labelY: labelPos.y,
      buttonX: bubblePos.x,
      buttonY: bubblePos.y,
      buttonRadius: outerRadius,
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
 * Hit-tests a touch coordinate (x, y) on the 360x360 round display (outer ring slots 1..N only).
 */
export function hitTestCircularDisplay(x: number, y: number, layout: LayoutPreset): number | null {
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > DISPLAY_RADIUS || dist < INNER_RING_RADIUS || dist > OUTER_RING_RADIUS) {
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

export const CENTER_SWITCH_RADIUS = 60;

/**
 * Checks whether (x, y) on the 360x360 display falls inside the center 3-tap mode switch zone.
 * Mirrors firmware TouchManager::isCenterZone() 1:1.
 */
export function isCenterSwitchZone(x: number, y: number): boolean {
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist <= CENTER_SWITCH_RADIUS;
}


