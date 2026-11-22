import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DISPLAY_HEIGHT,
  DISPLAY_RADIUS,
  DISPLAY_WIDTH,
  LayoutPreset,
  MacroDefinition,
  ProfileDefinition,
} from '../shared/types';
import {
  buildLayoutGeometry,
  CENTER_X,
  CENTER_Y,
  hitTestCircularDisplay,
} from '../shared/geometry';
import { MacroTestVisualEvent } from '../modules/MacroEngine';
import { buildSquishyPalette } from './circular-ui/colorUtils';
import {
  CircularButtonIconId,
  resolveButtonIcon,
  TEMPORARY_ICON_LIST,
} from './circular-ui/iconRegistry';

interface CircularDisplayPreviewProps {
  profile: ProfileDefinition;
  macros: MacroDefinition[];
  selectedSlotIndex: number;
  isTestMode: boolean;
  visualFeedback: MacroTestVisualEvent | null;
  onToggleTestMode: (enabled: boolean) => void;
  onSelectSlot: (slotIndex: number) => void;
  onTriggerPreviewMacro?: (slotIndex: number, macro: MacroDefinition) => void;
  onSwitchMacroSlot: (slotIndex: number) => void;
  onCycleMacroSlot: (direction: 'NEXT' | 'PREV') => void;
  isDeviceConnected: boolean;
}

const PREVIEW_ICON_STORAGE_KEY = 'rmc_ui_preview_icon_overrides_v1';

const TAILWIND_JELLY_GRADIENT_BY_HEX: Record<string, string> = {
  '#0F172A': 'bg-gradient-to-b from-slate-600 via-slate-800 to-slate-950 shadow-slate-950/40',
  '#1E293B': 'bg-gradient-to-b from-slate-600 via-slate-800 to-slate-950 shadow-slate-950/40',
  '#334155': 'bg-gradient-to-b from-slate-500 via-slate-700 to-slate-900 shadow-slate-950/40',
  '#475569': 'bg-gradient-to-b from-slate-400 via-slate-600 to-slate-800 shadow-slate-950/40',
  '#2563EB': 'bg-gradient-to-b from-blue-400 via-blue-600 to-blue-900 shadow-blue-950/40',
  '#1D4ED8': 'bg-gradient-to-b from-blue-400 via-blue-700 to-blue-950 shadow-blue-950/40',
  '#0284C7': 'bg-gradient-to-b from-sky-300 via-sky-600 to-sky-900 shadow-sky-950/40',
  '#0369A1': 'bg-gradient-to-b from-sky-400 via-sky-700 to-sky-950 shadow-sky-950/40',
  '#0F766E': 'bg-gradient-to-b from-teal-300 via-teal-600 to-teal-950 shadow-teal-950/40',
  '#4F46E5': 'bg-gradient-to-b from-indigo-300 via-indigo-600 to-indigo-950 shadow-indigo-950/40',
  '#B45309': 'bg-gradient-to-b from-amber-300 via-amber-600 to-amber-900 shadow-amber-950/40',
  '#991B1B': 'bg-gradient-to-b from-rose-400 via-red-600 to-red-950 shadow-red-950/40',
};

function loadPreviewIconOverrides(): Record<string, CircularButtonIconId> {
  try {
    const raw = window.localStorage.getItem(PREVIEW_ICON_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export const CircularDisplayPreview: React.FC<CircularDisplayPreviewProps> = ({
  profile,
  macros,
  selectedSlotIndex,
  isTestMode,
  visualFeedback,
  onToggleTestMode,
  onSelectSlot,
  onTriggerPreviewMacro,
  onSwitchMacroSlot,
  onCycleMacroSlot,
  isDeviceConnected,
}) => {
  const uid = useId().replace(/:/g, '');
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number; slot: number | null } | null>(null);
  const [pressedSlot, setPressedSlot] = useState<number | null>(null);
  const [iconOverrides, setIconOverrides] = useState<Record<string, CircularButtonIconId>>(() =>
    loadPreviewIconOverrides()
  );

  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_ICON_STORAGE_KEY, JSON.stringify(iconOverrides));
    } catch {
      // Ignore storage quota errors for preview-only icon overrides
    }
  }, [iconOverrides]);

  const geometries = useMemo(() => buildLayoutGeometry(profile.layout), [profile.layout]);
  const macroMap = useMemo(() => new Map(macros.map((m) => [m.id, m])), [macros]);

  const outerCount = useMemo(() => {
    if (profile.layout === LayoutPreset.RADIAL_4_CENTER) return 4;
    if (profile.layout === LayoutPreset.RADIAL_8_CENTER) return 8;
    return 6;
  }, [profile.layout]);

  const ringRadius = outerCount === 4 ? 110 : outerCount === 8 ? 120 : 115;

  const activeSimulatingSlot =
    visualFeedback && (visualFeedback.phase === 'START' || visualFeedback.phase === 'STEP')
      ? visualFeedback.slotIndex
      : null;

  const triggerSlotInteraction = (slot: number) => {
    onSelectSlot(slot);
    setPressedSlot(slot);
    setTimeout(() => setPressedSlot(null), 180);

    if (isTestMode && onTriggerPreviewMacro) {
      const btn = profile.buttons.find((b) => b.slotIndex === slot);
      const macro = btn?.enabled && btn.macroId ? macroMap.get(btn.macroId) : undefined;
      if (macro) {
        onTriggerPreviewMacro(slot, macro);
      }
    }
  };

  const handleDisplayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    swipeStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handleDisplayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DISPLAY_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DISPLAY_HEIGHT);
    const slot = hitTestCircularDisplay(x, y, profile.layout);
    setHoverCoords({ x, y, slot });
  };

  const handleDisplayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeStartRef.current) return;
    const dx = e.clientX - swipeStartRef.current.x;
    const dy = e.clientY - swipeStartRef.current.y;
    const dt = Date.now() - swipeStartRef.current.time;
    swipeStartRef.current = null;

    // Horizontal swipe threshold: > 40px movement, horizontal dominant, < 600ms
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && dt < 600) {
      if (dx < 0) {
        onCycleMacroSlot('NEXT');
      } else {
        onCycleMacroSlot('PREV');
      }
    }
  };

  const handleDisplayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DISPLAY_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DISPLAY_HEIGHT);
    const slot = hitTestCircularDisplay(x, y, profile.layout);
    if (slot !== null) {
      triggerSlotInteraction(slot);
    }
  };

  const activeMacroSlotIndex = profile.activeMacroSlotIndex ?? 1;
  const selectedButton = profile.buttons.find((b) => b.slotIndex === selectedSlotIndex);
  const selectedMacro = selectedButton?.macroId ? macroMap.get(selectedButton.macroId) : undefined;
  const selectedOverrideKey = `${profile.id}:${activeMacroSlotIndex}:${selectedSlotIndex}`;
  const selectedOverrideId = iconOverrides[selectedOverrideKey];
  const resolvedSelectedIcon = selectedButton
    ? resolveButtonIcon(selectedButton, selectedMacro, selectedOverrideId)
    : null;

  const handleSelectPreviewIcon = (iconId: CircularButtonIconId) => {
    setIconOverrides((prev) => ({
      ...prev,
      [selectedOverrideKey]: iconId,
    }));
  };

  const handleResetPreviewIcon = () => {
    setIconOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedOverrideKey];
      return next;
    });
  };

  return (
    <div className="CircularDisplayPreview flex flex-col items-center w-full">
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

      {/* 3 Macro Slot Pagination & Swipe Navigation Bar */}
      <div className="w-full flex items-center justify-between bg-slate-100 border border-slate-200 px-4 py-2.5 rounded-md mb-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">매크로 슬롯 스와이프:</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSwitchMacroSlot(idx)}
                className={`px-2.5 py-1 font-mono rounded border transition-colors ${
                  activeMacroSlotIndex === idx
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title={`슬롯 ${idx}로 전환`}
              >
                슬롯 {idx} {activeMacroSlotIndex === idx ? '●' : '○'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCycleMacroSlot('PREV')}
            className="p-1 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            title="이전 슬롯 (우측 스와이프)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono px-2 text-slate-600">{activeMacroSlotIndex} / 3</span>
          <button
            type="button"
            onClick={() => onCycleMacroSlot('NEXT')}
            className="p-1 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
            title="다음 슬롯 (좌측 스와이프)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Physical circular smartwatch bezel frame at exact 360x360 logical coordinates */}
      <div
        className={`relative p-3.5 rounded-full bg-gradient-to-b from-slate-800 via-slate-950 to-black border transition-colors shadow-xl ${
          activeSimulatingSlot !== null && isTestMode
            ? 'border-amber-500 ring-2 ring-amber-400/50'
            : isTestMode
              ? 'border-amber-600/70'
              : 'border-slate-800'
        }`}
      >
        <div
          onPointerDown={handleDisplayPointerDown}
          onPointerMove={handleDisplayPointerMove}
          onPointerUp={handleDisplayPointerUp}
          onPointerLeave={() => {
            swipeStartRef.current = null;
            setHoverCoords(null);
          }}
          onClick={handleDisplayClick}
          className="relative w-[360px] h-[360px] rounded-full overflow-hidden select-none cursor-pointer shadow-inner touch-none"
          role="region"
          aria-label={`360x360 원형 화면 미리보기 - ${profile.name} (슬롯 ${activeMacroSlotIndex})`}
        >
          {/* Circular dial backdrop with dark indigo-purple gradient and star/sparkle decorations */}
          <svg
            width={DISPLAY_WIDTH}
            height={DISPLAY_HEIGHT}
            viewBox={`0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}`}
            className="absolute inset-0 block pointer-events-none"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id={`dial-bg-${uid}`} cx="50%" cy="45%" r="75%">
                <stop offset="0%" stopColor="#311042" />
                <stop offset="55%" stopColor="#1e1b4b" />
                <stop offset="100%" stopColor="#09090b" />
              </radialGradient>
              <radialGradient id={`dial-glow-${uid}`} cx="50%" cy="32%" r="65%">
                <stop offset="0%" stopColor="#c084fc" stopOpacity="0.18" />
                <stop offset="60%" stopColor="#6366f1" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
              </radialGradient>
            </defs>

            {/* Rich dark indigo-purple background */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={DISPLAY_RADIUS}
              fill={`url(#dial-bg-${uid})`}
            />
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={DISPLAY_RADIUS}
              fill={`url(#dial-glow-${uid})`}
            />

            {/* Subtle star/sparkle decorations */}
            <g fill="#ffffff" fillOpacity="0.45">
              <circle cx="105" cy="85" r="1.3" />
              <circle cx="265" cy="95" r="0.9" opacity="0.6" />
              <circle cx="80" cy="255" r="1.1" opacity="0.5" />
              <circle cx="280" cy="265" r="1.5" opacity="0.7" />
              <circle cx="180" cy="65" r="0.8" opacity="0.4" />
              <circle cx="130" cy="295" r="1.2" opacity="0.6" />
              <circle cx="225" cy="80" r="1.0" opacity="0.5" />
              <circle cx="95" cy="180" r="0.7" opacity="0.3" />
            </g>

            {/* Subtle orbital track connecting outer smartwatch bubbles */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={ringRadius}
              fill="none"
              stroke="#a855f7"
              strokeOpacity={0.15}
              strokeWidth={1.5}
              strokeDasharray="4 6"
            />

            {/* Outer safe bezel ring */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={174}
              fill="none"
              stroke={isTestMode ? '#D97706' : '#475569'}
              strokeOpacity={isTestMode ? 0.9 : 0.6}
              strokeWidth={isTestMode ? 1.5 : 1}
            />

            {/* Top curved glass soft reflection */}
            <path
              d="M 58 92 A 154 154 0 0 1 302 92"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity={0.12}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>

          {/* Soft Jelly App-Icon Buttons with framer-motion whileTap */}
          {geometries.map((geo) => {
            const btn = profile.buttons.find((b) => b.slotIndex === geo.slotIndex);
            if (!btn) return null;

            const macro = btn.macroId ? macroMap.get(btn.macroId) : undefined;
            const isSelected = selectedSlotIndex === geo.slotIndex;
            const isHovered = hoverCoords?.slot === geo.slotIndex;
            const isPressed = pressedSlot === geo.slotIndex;
            const isSimulating = activeSimulatingSlot === geo.slotIndex;

            const state = !btn.enabled
              ? 'disabled'
              : isSimulating
                ? 'simulating'
                : isPressed
                  ? 'pressed'
                  : 'normal';
            const palette = buildSquishyPalette(btn.accentColor, state);

            const normalizedHex = (btn.accentColor || '#1E293B').trim().toUpperCase();
            const jellyGradientClasses =
              state === 'disabled'
                ? 'bg-gradient-to-b from-slate-600 via-slate-800 to-slate-950 shadow-slate-950/40'
                : state === 'simulating'
                  ? 'bg-gradient-to-b from-amber-300 via-amber-500 to-orange-700 shadow-amber-950/60'
                  : state === 'pressed'
                    ? 'bg-gradient-to-b from-sky-300 via-blue-500 to-blue-800 shadow-blue-950/60'
                    : TAILWIND_JELLY_GRADIENT_BY_HEX[normalizedHex] ?? 'bg-gradient-to-b shadow-slate-950/50';

            const isCustomNonPresetHex =
              state === 'normal' && !TAILWIND_JELLY_GRADIENT_BY_HEX[normalizedHex];

            const overrideId = iconOverrides[`${profile.id}:${activeMacroSlotIndex}:${geo.slotIndex}`];
            const iconDef = resolveButtonIcon(btn, macro, overrideId);

            const iconColor = isSimulating
              ? '#FEF3C7'
              : palette.isNeutralDark
                ? iconDef.cuteTint
                : palette.isDarkSurface
                  ? '#F8FAFC'
                  : '#0F172A';

            const sizePx = geo.buttonRadius * 2;
            const iconSize = outerCount === 8 ? 22 : 28;
            const displayLabel = (btn.shortLabel || btn.label).slice(0, 8);

            return (
              <motion.button
                key={geo.slotIndex}
                type="button"
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.04 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  triggerSlotInteraction(geo.slotIndex);
                }}
                aria-label={`슬롯 ${activeMacroSlotIndex} - 버튼 ${geo.slotIndex}: ${btn.label}${macro ? ` (${macro.name})` : ' (미할당)'}`}
                aria-pressed={isSelected}
                style={{
                  left: `${geo.buttonX - geo.buttonRadius}px`,
                  top: `${geo.buttonY - geo.buttonRadius}px`,
                  width: `${sizePx}px`,
                  height: `${sizePx}px`,
                  ...(isCustomNonPresetHex
                    ? {
                        backgroundImage: `linear-gradient(180deg, ${palette.topHex} 0%, ${palette.midHex} 52%, ${palette.bottomHex} 100%)`,
                      }
                    : undefined),
                }}
                className={`absolute rounded-full shadow-lg shadow-black/35 flex flex-col items-center justify-center gap-0.5 px-1.5 overflow-hidden select-none focus-visible:outline-none ${jellyGradientClasses} ${
                  !btn.enabled ? 'opacity-45' : 'opacity-100'
                } ${
                  isSimulating
                    ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950'
                    : isPressed
                      ? 'ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-950'
                      : isSelected
                        ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950'
                        : isHovered
                          ? 'ring-1 ring-inset ring-white/50'
                          : 'ring-1 ring-inset ring-white/30'
                }`}
              >
                {/* Soft jelly top highlight */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 w-4/5 h-1/3 rounded-full bg-gradient-to-b from-white/30 via-white/10 to-transparent"
                />
                {/* Soft bottom inner cushion depth */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 rounded-b-full bg-gradient-to-t from-black/30 to-transparent"
                />

                <svg
                  width={iconSize}
                  height={iconSize}
                  viewBox="0 0 32 32"
                  className="relative z-10 shrink-0 drop-shadow-sm"
                  aria-hidden="true"
                >
                  {iconDef.renderSvg(iconColor)}
                </svg>

                <span
                  className={`relative z-10 font-semibold leading-tight tracking-tight truncate max-w-full ${
                    outerCount === 8 ? 'text-[8.5px]' : 'text-[10px]'
                  } ${
                    palette.isDarkSurface
                      ? macro
                        ? 'text-slate-50'
                        : 'text-slate-300'
                      : 'text-slate-900'
                  }`}
                >
                  {isSimulating ? 'TEST' : displayLabel}
                </span>
              </motion.button>
            );
          })}
        </div>
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
              슬롯 {activeMacroSlotIndex} · 버튼 #{selectedSlotIndex} ({selectedButton?.label ?? '-'})
            </span>
          )}
        </div>

        {selectedMacro && onTriggerPreviewMacro && (
          <button
            type="button"
            onClick={() => onTriggerPreviewMacro(selectedSlotIndex, selectedMacro)}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-full shadow-lg shadow-black/25 ring-1 ring-inset ring-white/30 transition-all duration-150 active:scale-95 whitespace-nowrap shrink-0 ${
              isTestMode
                ? 'bg-gradient-to-b from-amber-400 via-amber-500 to-orange-600 hover:brightness-105'
                : 'bg-gradient-to-b from-sky-400 via-blue-500 to-blue-600 hover:brightness-105'
            }`}
          >
            {isTestMode ? 'Test Mode 시뮬레이션' : '선택 버튼 동작 테스트'}
          </button>
        )}
      </div>

      {/* Independent Temporary Icon Swap Preview Bar */}
      {selectedButton && (
        <div className="w-full mt-3 pt-3 border-t border-slate-200 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-700">
              임시 아이콘 미리보기 · 슬롯 {activeMacroSlotIndex}번 / 버튼 #{selectedSlotIndex}
            </span>
            {selectedOverrideId && (
              <button
                type="button"
                onClick={handleResetPreviewIcon}
                className="px-3 py-1 text-xs font-medium text-blue-700 bg-gradient-to-b from-white to-blue-50 hover:to-blue-100 rounded-full shadow-md shadow-blue-200/50 ring-1 ring-blue-200/80 active:scale-95 transition-all whitespace-nowrap shrink-0"
              >
                자동 매칭으로 복원
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {TEMPORARY_ICON_LIST.map((item) => {
              const isActiveIcon = resolvedSelectedIcon?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectPreviewIcon(item.id)}
                  title={`${item.label} 아이콘 미리보기`}
                  aria-label={`${item.label} 아이콘 선택`}
                  className={`w-10 h-10 rounded-full shadow-md shadow-black/20 ring-1 ring-inset flex items-center justify-center transition-all duration-150 active:scale-90 ${
                    isActiveIcon
                      ? 'bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950 ring-white/30 text-white scale-105'
                      : 'bg-gradient-to-b from-white via-slate-50 to-slate-200 ring-white/80 hover:scale-105 text-slate-700'
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
                    {item.renderSvg(isActiveIcon ? item.cuteTint : '#475569')}
                  </svg>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-500">
            아이콘은 매크로·펌웨어 설정과 분리된 UI 레이어이며, 추후 원하는 아이콘 에셋으로 교체할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
};
