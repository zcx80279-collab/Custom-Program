import React from 'react';
import {
  CircularButtonConfig,
  MacroDefinition,
  MacroStepType,
} from '../../shared/types';

/**
 * Independent UI Icon Layer for RoundMacroController 360x360 Circular Display.
 *
 * Designed to be swapped out cleanly in the future (e.g., custom SVGs, raster
 * sprites, or firmware LVGL/bitmap icons) without touching macro execution,
 * keycodes, USB protocol, or device configuration schemas.
 */

export type CircularButtonIconId =
  | 'run'
  | 'copy'
  | 'paste'
  | 'undo'
  | 'capture'
  | 'mute'
  | 'launch'
  | 'shortcut'
  | 'folder'
  | 'heart'
  | 'music'
  | 'terminal'
  | 'empty';

export interface CircularIconDefinition {
  id: CircularButtonIconId;
  label: string;
  /** Cheerful smartwatch pastel tint used on neutral dark watch buttons */
  cuteTint: string;
  /** Renders pure SVG elements inside a 32x32 local coordinate space */
  renderSvg: (color: string) => React.ReactNode;
}

export const TEMPORARY_ICON_REGISTRY: Record<CircularButtonIconId, CircularIconDefinition> = {
  run: {
    id: 'run',
    label: '실행',
    cuteTint: '#93C5FD',
    renderSvg: (color) => (
      <g>
        <path
          d="M 10.5 7.2 C 10.5 5.9 11.9 5.1 13.0 5.8 L 24.4 13.6 C 25.4 14.3 25.4 15.7 24.4 16.4 L 13.0 24.2 C 11.9 24.9 10.5 24.1 10.5 22.8 Z"
          fill={color}
          fillOpacity={0.28}
          stroke={color}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
        {/* Cute little sparkle */}
        <path
          d="M 24.5 5.2 L 25.2 7.0 L 27.0 7.7 L 25.2 8.4 L 24.5 10.2 L 23.8 8.4 L 22.0 7.7 L 23.8 7.0 Z"
          fill={color}
        />
      </g>
    ),
  },

  copy: {
    id: 'copy',
    label: '복사',
    cuteTint: '#7DD3FC',
    renderSvg: (color) => (
      <g>
        <rect
          x="11"
          y="5.5"
          width="14.5"
          height="16.5"
          rx="4.2"
          fill={color}
          fillOpacity={0.18}
          stroke={color}
          strokeWidth={2.1}
        />
        <rect
          x="6.5"
          y="10"
          width="14.5"
          height="16.5"
          rx="4.2"
          fill={color}
          fillOpacity={0.32}
          stroke={color}
          strokeWidth={2.2}
        />
        <line
          x1="10.2"
          y1="15.8"
          x2="17.2"
          y2="15.8"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        <line
          x1="10.2"
          y1="20.2"
          x2="15.2"
          y2="20.2"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </g>
    ),
  },

  paste: {
    id: 'paste',
    label: '붙여넣기',
    cuteTint: '#6EE7B7',
    renderSvg: (color) => (
      <g>
        <rect
          x="7"
          y="7.5"
          width="18"
          height="19"
          rx="4.8"
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeWidth={2.2}
        />
        <rect
          x="11.5"
          y="4.5"
          width="9"
          height="5"
          rx="2.5"
          fill={color}
        />
        <path
          d="M 11.5 17.2 L 14.7 20.3 L 20.8 14.2"
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ),
  },

  undo: {
    id: 'undo',
    label: '실행 취소',
    cuteTint: '#FDBA74',
    renderSvg: (color) => (
      <g>
        <circle cx="16" cy="16" r="11" fill={color} fillOpacity={0.14} />
        <path
          d="M 11.2 13.5 H 18.8 C 22.0 13.5 24.2 15.7 24.2 18.6 C 24.2 21.5 22.0 23.6 18.8 23.6 H 13.5"
          fill="none"
          stroke={color}
          strokeWidth={2.7}
          strokeLinecap="round"
        />
        <path
          d="M 13.2 9.4 L 8.8 13.5 L 13.2 17.6"
          fill="none"
          stroke={color}
          strokeWidth={2.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ),
  },

  capture: {
    id: 'capture',
    label: '캡처',
    cuteTint: '#C4B5FD',
    renderSvg: (color) => (
      <g>
        <rect
          x="11.5"
          y="5.5"
          width="9"
          height="4"
          rx="2"
          fill={color}
          fillOpacity={0.85}
        />
        <rect
          x="5.5"
          y="8.5"
          width="21"
          height="16.5"
          rx="5.5"
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeWidth={2.2}
        />
        <circle
          cx="16"
          cy="16.8"
          r="4.5"
          fill={color}
          fillOpacity={0.35}
          stroke={color}
          strokeWidth={2.2}
        />
        <circle cx="22.2" cy="12.5" r="1.4" fill={color} />
      </g>
    ),
  },

  mute: {
    id: 'mute',
    label: '음소거',
    cuteTint: '#FDA4AF',
    renderSvg: (color) => (
      <g>
        <path
          d="M 6.2 13.2 H 9.8 L 15.2 8.4 C 16.0 7.7 17.2 8.2 17.2 9.3 V 22.7 C 17.2 23.8 16.0 24.3 15.2 23.6 L 9.8 18.8 H 6.2 C 5.3 18.8 4.6 18.1 4.6 17.2 V 14.8 C 4.6 13.9 5.3 13.2 6.2 13.2 Z"
          fill={color}
          fillOpacity={0.28}
          stroke={color}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        <path
          d="M 21.2 13.0 L 26.4 18.8 M 26.4 13.0 L 21.2 18.8"
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </g>
    ),
  },

  launch: {
    id: 'launch',
    label: '앱 실행',
    cuteTint: '#67E8F9',
    renderSvg: (color) => (
      <g>
        <rect
          x="5.5"
          y="6.5"
          width="21"
          height="19"
          rx="5.2"
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeWidth={2.2}
        />
        <line x1="6.5" y1="12.2" x2="25.5" y2="12.2" stroke={color} strokeWidth={1.8} />
        <circle cx="9.8" cy="9.4" r="1.1" fill={color} />
        <circle cx="13.2" cy="9.4" r="1.1" fill={color} />
        <path
          d="M 13.2 19.6 L 19.2 14.6 M 15.2 14.4 H 19.4 V 18.6"
          fill="none"
          stroke={color}
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ),
  },

  shortcut: {
    id: 'shortcut',
    label: '단축키',
    cuteTint: '#FDE047',
    renderSvg: (color) => (
      <g>
        <rect
          x="6"
          y="6"
          width="20"
          height="20"
          rx="6.2"
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeWidth={2.2}
        />
        <path
          d="M 17.4 9.5 L 12.2 16.6 H 16.4 L 14.8 22.5 L 20.0 15.4 H 15.8 Z"
          fill={color}
          stroke={color}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      </g>
    ),
  },

  folder: {
    id: 'folder',
    label: '폴더',
    cuteTint: '#FCD34D',
    renderSvg: (color) => (
      <g>
        <path
          d="M 5.5 10.2 C 5.5 8.4 7.0 7.0 8.8 7.0 H 12.8 L 15.2 9.8 H 23.2 C 25.0 9.8 26.5 11.2 26.5 13.0 V 21.8 C 26.5 23.6 25.0 25.0 23.2 25.0 H 8.8 C 7.0 25.0 5.5 23.6 5.5 21.8 Z"
          fill={color}
          fillOpacity={0.25}
          stroke={color}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
      </g>
    ),
  },

  heart: {
    id: 'heart',
    label: '즐겨찾기',
    cuteTint: '#F9A8D4',
    renderSvg: (color) => (
      <path
        d="M 16 25.2 C 16 25.2 6.5 19.4 6.5 12.6 C 6.5 9.4 9.0 7.0 12.0 7.0 C 13.9 7.0 15.3 8.0 16 9.3 C 16.7 8.0 18.1 7.0 20.0 7.0 C 23.0 7.0 25.5 9.4 25.5 12.6 C 25.5 19.4 16 25.2 16 25.2 Z"
        fill={color}
        fillOpacity={0.32}
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    ),
  },

  music: {
    id: 'music',
    label: '미디어',
    cuteTint: '#D8B4FE',
    renderSvg: (color) => (
      <g>
        <path
          d="M 12.5 21.2 V 9.4 L 23.5 7.4 V 19.2"
          fill="none"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9.8" cy="21.8" r="3.2" fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2.1} />
        <circle cx="20.8" cy="19.8" r="3.2" fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2.1} />
      </g>
    ),
  },

  terminal: {
    id: 'terminal',
    label: '터미널',
    cuteTint: '#86EFAC',
    renderSvg: (color) => (
      <g>
        <rect
          x="5.5"
          y="6.8"
          width="21"
          height="18.4"
          rx="5.2"
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeWidth={2.2}
        />
        <path
          d="M 10.5 13.0 L 14.2 16.0 L 10.5 19.0"
          fill="none"
          stroke={color}
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="16.5"
          y1="19.0"
          x2="21.5"
          y2="19.0"
          stroke={color}
          strokeWidth={2.3}
          strokeLinecap="round"
        />
      </g>
    ),
  },

  empty: {
    id: 'empty',
    label: '미할당',
    cuteTint: '#94A3B8',
    renderSvg: (color) => (
      <g>
        <circle
          cx="16"
          cy="16"
          r="9.5"
          fill={color}
          fillOpacity={0.1}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="3.2 3.2"
        />
        <line x1="16" y1="12" x2="16" y2="20" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        <line x1="12" y1="16" x2="20" y2="16" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      </g>
    ),
  },
};

export const TEMPORARY_ICON_LIST: CircularIconDefinition[] = [
  TEMPORARY_ICON_REGISTRY.run,
  TEMPORARY_ICON_REGISTRY.copy,
  TEMPORARY_ICON_REGISTRY.paste,
  TEMPORARY_ICON_REGISTRY.undo,
  TEMPORARY_ICON_REGISTRY.capture,
  TEMPORARY_ICON_REGISTRY.mute,
  TEMPORARY_ICON_REGISTRY.launch,
  TEMPORARY_ICON_REGISTRY.shortcut,
  TEMPORARY_ICON_REGISTRY.folder,
  TEMPORARY_ICON_REGISTRY.heart,
  TEMPORARY_ICON_REGISTRY.music,
  TEMPORARY_ICON_REGISTRY.terminal,
  TEMPORARY_ICON_REGISTRY.empty,
];

/**
 * Resolves a temporary icon independently from button metadata and bound macro.
 * Optional overrideId lets users test icon replacements in the PC editor preview
 * without touching saved firmware or keycode configs.
 */
export function resolveButtonIcon(
  button: CircularButtonConfig,
  macro?: MacroDefinition,
  overrideId?: CircularButtonIconId
): CircularIconDefinition {
  if (overrideId && TEMPORARY_ICON_REGISTRY[overrideId]) {
    return TEMPORARY_ICON_REGISTRY[overrideId];
  }

  if (!macro) {
    return TEMPORARY_ICON_REGISTRY.empty;
  }

  if (macro.steps.some((s) => s.type === MacroStepType.LAUNCH_APP)) {
    return TEMPORARY_ICON_REGISTRY.launch;
  }

  const hint = `${macro.id} ${macro.name} ${button.shortLabel} ${button.label}`.toLowerCase();

  if (hint.includes('copy') || hint.includes('복사')) return TEMPORARY_ICON_REGISTRY.copy;
  if (hint.includes('paste') || hint.includes('붙여')) return TEMPORARY_ICON_REGISTRY.paste;
  if (hint.includes('undo') || hint.includes('취소') || hint.includes('되돌')) return TEMPORARY_ICON_REGISTRY.undo;
  if (hint.includes('redo') || hint.includes('다시 실행')) return TEMPORARY_ICON_REGISTRY.run;
  if (hint.includes('snap') || hint.includes('screenshot') || hint.includes('캡처')) return TEMPORARY_ICON_REGISTRY.capture;
  if (hint.includes('mute') || hint.includes('음소거')) return TEMPORARY_ICON_REGISTRY.mute;
  if (hint.includes('alttab') || hint.includes('창 전환') || hint.includes('mode') || hint.includes('모드')) {
    return TEMPORARY_ICON_REGISTRY.launch;
  }
  if (hint.includes('save') || hint.includes('저장') || hint.includes('folder') || hint.includes('폴더')) {
    return TEMPORARY_ICON_REGISTRY.folder;
  }
  if (hint.includes('build') || hint.includes('run') || hint.includes('실행') || hint.includes('extrude') || hint.includes('돌출')) {
    return TEMPORARY_ICON_REGISTRY.run;
  }
  if (hint.includes('brush') || hint.includes('브러시') || hint.includes('eraser') || hint.includes('지우개') || hint.includes('pick') || hint.includes('스포이드') || hint.includes('heart')) {
    return TEMPORARY_ICON_REGISTRY.heart;
  }
  if (hint.includes('음악') || hint.includes('볼륨') || hint.includes('music')) return TEMPORARY_ICON_REGISTRY.music;
  if (hint.includes('터미널') || hint.includes('개발') || hint.includes('code') || hint.includes('find') || hint.includes('찾기') || hint.includes('bold') || hint.includes('굵게')) {
    return TEMPORARY_ICON_REGISTRY.terminal;
  }

  return TEMPORARY_ICON_REGISTRY.shortcut;
}

interface CircularButtonIconGraphicProps {
  icon: CircularIconDefinition;
  cx: number;
  cy: number;
  size: number;
  isNeutralDarkSurface: boolean;
  isDarkSurface: boolean;
  isSimulating?: boolean;
}

export const CircularButtonIconGraphic: React.FC<CircularButtonIconGraphicProps> = ({
  icon,
  cx,
  cy,
  size,
  isNeutralDarkSurface,
  isDarkSurface,
  isSimulating = false,
}) => {
  const scale = size / 32;
  const tx = cx - size / 2;
  const ty = cy - size / 2;

  // On neutral dark bubbles (#1E293B / #334155), show cheerful smartwatch pastel icons;
  // on bright/colored bubbles (#2563EB, amber simulating), use crisp white or dark slate for contrast.
  const strokeColor = isSimulating
    ? '#FEF3C7'
    : isNeutralDarkSurface
      ? icon.cuteTint
      : isDarkSurface
        ? '#F8FAFC'
        : '#0F172A';

  return (
    <g transform={`translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(4)})`}>
      {icon.renderSvg(strokeColor)}
    </g>
  );
};
