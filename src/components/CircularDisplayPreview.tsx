import React, { useMemo, useState } from 'react';
import {
  DISPLAY_HEIGHT,
  DISPLAY_RADIUS,
  DISPLAY_WIDTH,
  MacroDefinition,
  MacroExecutionMode,
  ProfileDefinition,
} from '../shared/types';
import {
  buildLayoutGeometry,
  CENTER_X,
  CENTER_Y,
  hitTestCircularDisplay,
} from '../shared/geometry';
import { MacroTestVisualEvent } from '../modules/MacroEngine';

interface CircularDisplayPreviewProps {
  profile: ProfileDefinition;
  macros: MacroDefinition[];
  selectedSlotIndex: number;
  isTestMode: boolean;
  visualFeedback: MacroTestVisualEvent | null;
  onToggleTestMode: (enabled: boolean) => void;
  onSelectSlot: (slotIndex: number) => void;
  onTriggerPreviewMacro?: (slotIndex: number, macro: MacroDefinition) => void;
  isDeviceConnected: boolean;
}

const MODE_SHORT_LABEL: Record<MacroExecutionMode, string> = {
  [MacroExecutionMode.DEVICE_HID]: 'HID',
  [MacroExecutionMode.PC_AGENT]: 'PC',
  [MacroExecutionMode.HYBRID]: 'HYB',
};

export const CircularDisplayPreview: React.FC<CircularDisplayPreviewProps> = ({
  profile,
  macros,
  selectedSlotIndex,
  isTestMode,
  visualFeedback,
  onToggleTestMode,
  onSelectSlot,
  onTriggerPreviewMacro,
  isDeviceConnected,
}) => {
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number; slot: number | null } | null>(null);
  const [pressedSlot, setPressedSlot] = useState<number | null>(null);

  const geometries = useMemo(() => buildLayoutGeometry(profile.layout), [profile.layout]);
  const macroMap = useMemo(() => new Map(macros.map((m) => [m.id, m])), [macros]);

  const activeSimulatingSlot =
    visualFeedback && (visualFeedback.phase === 'START' || visualFeedback.phase === 'STEP')
      ? visualFeedback.slotIndex
      : null;

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DISPLAY_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DISPLAY_HEIGHT);
    const slot = hitTestCircularDisplay(x, y, profile.layout);
    setHoverCoords({ x, y, slot });
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DISPLAY_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DISPLAY_HEIGHT);
    const slot = hitTestCircularDisplay(x, y, profile.layout);
    if (slot !== null) {
      onSelectSlot(slot);
      setPressedSlot(slot);
      setTimeout(() => setPressedSlot(null), 160);

      // In Test Mode, clicking a mapped button on the circular preview immediately runs visual/log simulation
      if (isTestMode && onTriggerPreviewMacro) {
        const btn = profile.buttons.find((b) => b.slotIndex === slot);
        const macro = btn?.enabled && btn.macroId ? macroMap.get(btn.macroId) : undefined;
        if (macro) {
          onTriggerPreviewMacro(slot, macro);
        }
      }
    }
  };

  const selectedButton = profile.buttons.find((b) => b.slotIndex === selectedSlotIndex);
  const selectedMacro = selectedButton?.macroId ? macroMap.get(selectedButton.macroId) : undefined;

  return (
    <div className="flex flex-col items-center w-full">
      {/* Metadata line + Test Mode toggle */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-3 px-1">
        <span className="font-medium text-slate-700 truncate">{profile.name}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono tabular-nums whitespace-nowrap">
            360×360 · {isDeviceConnected ? '기기 연결됨' : '로컬 미리보기'}
          </span>
          <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={isTestMode}
              onChange={(e) => onToggleTestMode(e.target.checked)}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span className={isTestMode ? 'font-semibold text-amber-700' : 'font-medium'}>
              Test Mode
            </span>
          </label>
        </div>
      </div>

      {/* Physical circular bezel frame at exact 360x360 logical coordinates */}
      <div
        className={`relative p-3 rounded-full bg-slate-900 border transition-colors shadow-sm ${
          activeSimulatingSlot !== null && isTestMode
            ? 'border-amber-500 ring-2 ring-amber-400/50'
            : isTestMode
              ? 'border-amber-600/70'
              : 'border-slate-800'
        }`}
      >
        <svg
          width={DISPLAY_WIDTH}
          height={DISPLAY_HEIGHT}
          viewBox={`0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}`}
          onPointerMove={handleSvgPointerMove}
          onPointerLeave={() => setHoverCoords(null)}
          onClick={handleSvgClick}
          className="block rounded-full select-none cursor-pointer"
          role="img"
          aria-label={`360x360 원형 화면 미리보기 - ${profile.name}`}
        >
          {/* Circular display background */}
          <circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r={DISPLAY_RADIUS}
            fill={profile.backgroundColor || '#0F172A'}
          />

          {/* Subtle outer safe bezel ring (amber tint when Test Mode active) */}
          <circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r={174}
            fill="none"
            stroke={isTestMode ? '#D97706' : '#334155'}
            strokeWidth={isTestMode ? 1.5 : 1}
          />

          {/* Interactive button slots */}
          {geometries.map((geo) => {
            const btn = profile.buttons.find((b) => b.slotIndex === geo.slotIndex);
            if (!btn) return null;

            const macro = btn.macroId ? macroMap.get(btn.macroId) : undefined;
            const isSelected = selectedSlotIndex === geo.slotIndex;
            const isHovered = hoverCoords?.slot === geo.slotIndex;
            const isPressed = pressedSlot === geo.slotIndex;
            const isSimulating = activeSimulatingSlot === geo.slotIndex;

            const baseFill = !btn.enabled
              ? '#1E293B'
              : isSimulating
                ? '#B45309'
                : isPressed
                  ? '#1D4ED8'
                  : btn.accentColor || '#1E293B';

            const strokeColor = isSimulating
              ? '#FBBF24'
              : isSelected
                ? '#60A5FA'
                : isHovered
                  ? '#94A3B8'
                  : '#334155';

            return (
              <g key={geo.slotIndex} opacity={btn.enabled ? 1 : 0.45}>
                <path
                  d={geo.svgPath}
                  fill={baseFill}
                  stroke={strokeColor}
                  strokeWidth={isSimulating || isSelected ? 2.5 : 1.2}
                />
                <text
                  x={geo.labelX}
                  y={geo.labelY - (macro ? 5 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#F8FAFC"
                  fontSize={geo.kind === 'CENTER' ? 13 : 12}
                  fontWeight={600}
                  style={{ pointerEvents: 'none' }}
                >
                  {(btn.shortLabel || btn.label).slice(0, 8)}
                </text>
                {macro ? (
                  <text
                    x={geo.labelX}
                    y={geo.labelY + 12}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#CBD5E1"
                    fontSize={9.5}
                    fontFamily="IBM Plex Mono, monospace"
                    style={{ pointerEvents: 'none' }}
                  >
                    {isSimulating ? 'TEST' : MODE_SHORT_LABEL[macro.executionMode]}
                  </text>
                ) : (
                  <text
                    x={geo.labelX}
                    y={geo.labelY + 12}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#64748B"
                    fontSize={9}
                    style={{ pointerEvents: 'none' }}
                  >
                    비어 있음
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Live Visual Response Bar for Macro / Test Mode */}
      {visualFeedback && (
        <div
          className={`w-full mt-3 px-3 py-2 rounded-md border text-xs ${
            visualFeedback.phase === 'ERROR'
              ? 'bg-red-50 border-red-200 text-red-800'
              : visualFeedback.isTestMode
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2 font-medium">
            <span className="truncate">
              {visualFeedback.isTestMode ? '[TEST MODE] ' : ''}
              {visualFeedback.macroName}
            </span>
            <span className="font-mono tabular-nums shrink-0">
              {visualFeedback.phase === 'COMPLETE'
                ? '완료'
                : visualFeedback.phase === 'ERROR'
                  ? '오류'
                  : `${Math.max(1, visualFeedback.currentStepIndex + 1)}/${visualFeedback.totalSteps}`}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-xs opacity-90 truncate">
            {visualFeedback.stepLabel}
          </div>
        </div>
      )}

      {/* Coordinate telemetry & quick test trigger */}
      <div className="w-full mt-3 pt-3 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
        <div className="font-mono tabular-nums text-slate-500">
          {hoverCoords ? (
            <span>
              X:{String(hoverCoords.x).padStart(3, '0')} · Y:{String(hoverCoords.y).padStart(3, '0')} ·{' '}
              {hoverCoords.slot !== null ? `슬롯 ${hoverCoords.slot}` : '영역 외'}
            </span>
          ) : (
            <span>
              선택됨: 슬롯 {selectedSlotIndex} ({selectedButton?.label ?? '-'})
            </span>
          )}
        </div>

        {selectedMacro && onTriggerPreviewMacro && (
          <button
            type="button"
            onClick={() => onTriggerPreviewMacro(selectedSlotIndex, selectedMacro)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {isTestMode ? 'Test Mode 시뮬레이션' : '선택 버튼 동작 테스트'}
          </button>
        )}
      </div>
    </div>
  );
};
