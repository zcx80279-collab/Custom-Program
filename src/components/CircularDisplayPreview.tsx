import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, MousePointer2 } from 'lucide-react';
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
  CENTER_SWITCH_RADIUS,
  CENTER_X,
  CENTER_Y,
  hitTestCircularDisplay,
  isCenterSwitchZone,
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
  mouseCursorSpeed?: number;
}

type ControllerDisplayMode = 'MACRO' | 'MOUSE';
type MouseActionKind = 'IDLE' | 'MOVE' | 'LEFT_CLICK' | 'RIGHT_CLICK' | 'MODE_ENTER';

interface MouseActionFeedback {
  kind: MouseActionKind;
  label: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  timestamp: number;
}

interface ClickRipple {
  id: number;
  x: number;
  y: number;
  button: 'LEFT' | 'RIGHT';
}

// Gesture discrimination thresholds (mirrors firmware/src/touch_manager.cpp 1:1)
const TAP_MAX_DURATION_MS = 240;
const MULTI_TAP_WINDOW_MS = 260;
const DRAG_THRESHOLD_PX = 8;
const MULTI_TAP_MAX_DIST_PX = 32;
const MOUSE_SENSITIVITY_MULT = 2;

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

function clampToCircle(x: number, y: number, maxRadius = 160): { x: number; y: number } {
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxRadius || dist === 0) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  const scale = maxRadius / dist;
  return {
    x: Math.round(CENTER_X + dx * scale),
    y: Math.round(CENTER_Y + dy * scale),
  };
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
  mouseCursorSpeed = 2,
}) => {
  const uid = useId().replace(/:/g, '');
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number; slot: number | null } | null>(null);
  const [pressedSlot, setPressedSlot] = useState<number | null>(null);
  const [iconOverrides, setIconOverrides] = useState<Record<string, CircularButtonIconId>>(() =>
    loadPreviewIconOverrides()
  );

  // Touchpad Mouse Mode state
  const [displayMode, setDisplayMode] = useState<ControllerDisplayMode>('MACRO');
  const [centerTapProgress, setCenterTapProgress] = useState<number>(0);
  const [virtualCursor, setVirtualCursor] = useState<{ x: number; y: number }>({ x: CENTER_X, y: CENTER_Y });
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number }>>([]);
  const [clickRipples, setClickRipples] = useState<ClickRipple[]>([]);
  const [mouseFeedback, setMouseFeedback] = useState<MouseActionFeedback>({
    kind: 'IDLE',
    label: '터치패드 대기 (단일: 좌클릭 · 이중: 우클릭 · 드래그: 이동)',
    dx: 0,
    dy: 0,
    x: CENTER_X,
    y: CENTER_Y,
    timestamp: 0,
  });

  // Unified pointer/touch state machine refs (prevents drag-vs-click and triple-tap conflicts)
  const pointerStateRef = useRef<{
    isDown: boolean;
    isDragging: boolean;
    downX: number;
    downY: number;
    lastX: number;
    lastY: number;
    downClientX: number;
    downClientY: number;
    downAtMs: number;
  }>({
    isDown: false,
    isDragging: false,
    downX: CENTER_X,
    downY: CENTER_Y,
    lastX: CENTER_X,
    lastY: CENTER_Y,
    downClientX: 0,
    downClientY: 0,
    downAtMs: 0,
  });

  const tapBufferRef = useRef<{
    count: number;
    allInCenter: boolean;
    lastUpAtMs: number;
    lastX: number;
    lastY: number;
    timerId: number | null;
  }>({
    count: 0,
    allInCenter: false,
    lastUpAtMs: 0,
    lastX: CENTER_X,
    lastY: CENTER_Y,
    timerId: null,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_ICON_STORAGE_KEY, JSON.stringify(iconOverrides));
    } catch {
      // Ignore storage quota errors for preview-only icon overrides
    }
  }, [iconOverrides]);

  useEffect(() => {
    return () => {
      if (tapBufferRef.current.timerId !== null) {
        window.clearTimeout(tapBufferRef.current.timerId);
      }
    };
  }, []);

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

  const clearPendingTaps = () => {
    if (tapBufferRef.current.timerId !== null) {
      window.clearTimeout(tapBufferRef.current.timerId);
      tapBufferRef.current.timerId = null;
    }
    tapBufferRef.current.count = 0;
    tapBufferRef.current.allInCenter = false;
    setCenterTapProgress(0);
  };

  const spawnClickRipple = (x: number, y: number, button: 'LEFT' | 'RIGHT') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setClickRipples((prev) => [...prev.slice(-4), { id, x, y, button }]);
    window.setTimeout(() => {
      setClickRipples((prev) => prev.filter((r) => r.id !== id));
    }, 520);
  };

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

  const getLocalDisplayCoords = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * DISPLAY_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * DISPLAY_HEIGHT);
    return { x, y };
  };

  const handleDisplayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = getLocalDisplayCoords(e);
    const distFromCenter = Math.hypot(x - CENTER_X, y - CENTER_Y);
    if (distFromCenter > DISPLAY_RADIUS) return;

    pointerStateRef.current = {
      isDown: true,
      isDragging: false,
      downX: x,
      downY: y,
      lastX: x,
      lastY: y,
      downClientX: e.clientX,
      downClientY: e.clientY,
      downAtMs: Date.now(),
    };

    if (displayMode === 'MOUSE') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if synthetic event doesn't support pointer capture
      }
    }
  };

  const handleDisplayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = getLocalDisplayCoords(e);
    const slot = displayMode === 'MACRO' ? hitTestCircularDisplay(x, y, profile.layout) : null;
    setHoverCoords({ x, y, slot });

    const pState = pointerStateRef.current;
    if (!pState.isDown) return;

    const distFromDown = Math.hypot(x - pState.downX, y - pState.downY);

    if (!pState.isDragging && distFromDown > DRAG_THRESHOLD_PX) {
      pState.isDragging = true;
      // Moving beyond DRAG_THRESHOLD_PX immediately cancels pending taps so drag NEVER clicks
      clearPendingTaps();
      pState.lastX = x;
      pState.lastY = y;
    }

    if (pState.isDragging && displayMode === 'MOUSE') {
      const rawDx = x - pState.lastX;
      const rawDy = y - pState.lastY;
      pState.lastX = x;
      pState.lastY = y;

      if (rawDx !== 0 || rawDy !== 0) {
        const speed = mouseCursorSpeed > 0 ? mouseCursorSpeed : 2;
        const hidDx = Math.max(-127, Math.min(127, rawDx * MOUSE_SENSITIVITY_MULT * speed));
        const hidDy = Math.max(-127, Math.min(127, rawDy * MOUSE_SENSITIVITY_MULT * speed));
        const clampedPos = clampToCircle(x, y, 162);

        setVirtualCursor(clampedPos);
        setCursorTrail((prev) => [...prev.slice(-10), clampedPos]);
        setMouseFeedback({
          kind: 'MOVE',
          label: `커서 이동 (ΔX: ${hidDx > 0 ? `+${hidDx}` : hidDx}, ΔY: ${hidDy > 0 ? `+${hidDy}` : hidDy})`,
          dx: hidDx,
          dy: hidDy,
          x: clampedPos.x,
          y: clampedPos.y,
          timestamp: Date.now(),
        });
      }
    }
  };

  const handleDisplayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pState = pointerStateRef.current;
    if (!pState.isDown) return;
    pState.isDown = false;

    if (displayMode === 'MOUSE') {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore pointer capture release errors
      }
    }

    const { x, y } = getLocalDisplayCoords(e);
    const now = Date.now();
    const duration = now - pState.downAtMs;
    const totalMove = Math.hypot(x - pState.downX, y - pState.downY);

    // 1. Check horizontal slot swipe in MACRO mode
    if (displayMode === 'MACRO' && pState.isDragging) {
      const clientDx = e.clientX - pState.downClientX;
      const clientDy = e.clientY - pState.downClientY;
      if (Math.abs(clientDx) > 40 && Math.abs(clientDx) > Math.abs(clientDy) && duration < 600) {
        if (clientDx < 0) {
          onCycleMacroSlot('NEXT');
        } else {
          onCycleMacroSlot('PREV');
        }
      }
      pState.isDragging = false;
      return;
    }

    // 2. If dragging or long hold occurred in MOUSE mode, end drag cleanly without any click
    if (pState.isDragging || duration > TAP_MAX_DURATION_MS || totalMove > DRAG_THRESHOLD_PX) {
      pState.isDragging = false;
      return;
    }

    // 3. Valid short tap (duration <= 240ms and movement <= 8px)
    const inCenter = isCenterSwitchZone(pState.downX, pState.downY);
    const tBuf = tapBufferRef.current;
    const withinTimeWindow = tBuf.count > 0 && now - tBuf.lastUpAtMs <= MULTI_TAP_WINDOW_MS;
    const withinDistWindow = Math.hypot(pState.downX - tBuf.lastX, pState.downY - tBuf.lastY) <= MULTI_TAP_MAX_DIST_PX;

    if (displayMode === 'MACRO') {
      if (inCenter) {
        if (tBuf.timerId !== null) {
          window.clearTimeout(tBuf.timerId);
          tBuf.timerId = null;
        }

        if (withinTimeWindow && tBuf.allInCenter && withinDistWindow) {
          tBuf.count += 1;
        } else {
          tBuf.count = 1;
          tBuf.allInCenter = true;
        }
        tBuf.lastUpAtMs = now;
        tBuf.lastX = pState.downX;
        tBuf.lastY = pState.downY;
        setCenterTapProgress(tBuf.count);

        if (tBuf.count >= 3) {
          // Rapid 3-tap in center -> Switch to Mouse Mode without triggering any macro
          clearPendingTaps();
          setDisplayMode('MOUSE');
          setVirtualCursor({ x: CENTER_X, y: CENTER_Y });
          setCursorTrail([]);
          setMouseFeedback({
            kind: 'MODE_ENTER',
            label: '마우스 모드 전환 완료 (중앙 3회 터치 시 매크로 모드 복귀)',
            dx: 0,
            dy: 0,
            x: CENTER_X,
            y: CENTER_Y,
            timestamp: now,
          });
          return;
        }

        tBuf.timerId = window.setTimeout(() => {
          clearPendingTaps();
        }, MULTI_TAP_WINDOW_MS);
      } else {
        // Outer button tap in Macro Mode
        clearPendingTaps();
        const slot = hitTestCircularDisplay(pState.downX, pState.downY, profile.layout);
        if (slot !== null) {
          triggerSlotInteraction(slot);
        }
      }
      return;
    }

    // 4. MOUSE MODE short tap handling:
    // Buffer taps within MULTI_TAP_WINDOW_MS to cleanly discriminate 1x (Left Click), 2x (Right Click), 3x Center (Mode Exit)
    if (tBuf.timerId !== null) {
      window.clearTimeout(tBuf.timerId);
      tBuf.timerId = null;
    }

    if (withinTimeWindow && withinDistWindow) {
      tBuf.count += 1;
      tBuf.allInCenter = tBuf.allInCenter && inCenter;
    } else {
      tBuf.count = 1;
      tBuf.allInCenter = inCenter;
    }
    tBuf.lastUpAtMs = now;
    tBuf.lastX = pState.downX;
    tBuf.lastY = pState.downY;
    setCenterTapProgress(tBuf.allInCenter ? tBuf.count : 0);

    // Check immediate 3-tap in center to return to Macro Mode (suppresses any mouse click)
    if (tBuf.count >= 3 && tBuf.allInCenter) {
      clearPendingTaps();
      setDisplayMode('MACRO');
      setCursorTrail([]);
      return;
    }

    const tapX = pState.downX;
    const tapY = pState.downY;

    tBuf.timerId = window.setTimeout(() => {
      const resolvedCount = tapBufferRef.current.count;
      clearPendingTaps();

      const clamped = clampToCircle(tapX, tapY, 162);
      setVirtualCursor(clamped);

      if (resolvedCount === 1) {
        spawnClickRipple(clamped.x, clamped.y, 'LEFT');
        setMouseFeedback({
          kind: 'LEFT_CLICK',
          label: `마우스 좌클릭 (LEFT CLICK @ X:${clamped.x}, Y:${clamped.y})`,
          dx: 0,
          dy: 0,
          x: clamped.x,
          y: clamped.y,
          timestamp: Date.now(),
        });
      } else if (resolvedCount === 2) {
        spawnClickRipple(clamped.x, clamped.y, 'RIGHT');
        setMouseFeedback({
          kind: 'RIGHT_CLICK',
          label: `마우스 우클릭 (RIGHT CLICK @ X:${clamped.x}, Y:${clamped.y})`,
          dx: 0,
          dy: 0,
          x: clamped.x,
          y: clamped.y,
          timestamp: Date.now(),
        });
      }
    }, MULTI_TAP_WINDOW_MS);
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
      {/* Metadata line + Mode indicator + Test Mode toggle */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-700 truncate">{profile.name}</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
              displayMode === 'MOUSE'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {displayMode === 'MOUSE' ? (
              <>
                <MousePointer2 className="w-3 h-3 text-cyan-400" />
                <span>MOUSE MODE</span>
              </>
            ) : (
              <span>MACRO MODE</span>
            )}
          </span>
        </div>
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

      {/* 3 Macro Slot Pagination & Swipe Navigation Bar (Maintained intact) */}
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
          displayMode === 'MOUSE'
            ? 'border-cyan-500/80 ring-2 ring-cyan-400/30'
            : activeSimulatingSlot !== null && isTestMode
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
            pointerStateRef.current.isDown = false;
            pointerStateRef.current.isDragging = false;
            setHoverCoords(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={`relative w-[360px] h-[360px] rounded-full overflow-hidden select-none shadow-inner touch-none ${
            displayMode === 'MOUSE' ? 'cursor-crosshair' : 'cursor-pointer'
          }`}
          role="region"
          aria-label={
            displayMode === 'MOUSE'
              ? `360x360 원형 터치패드 마우스 모드 - ${profile.name}`
              : `360x360 원형 화면 미리보기 - ${profile.name} (슬롯 ${activeMacroSlotIndex})`
          }
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
                <stop offset="0%" stopColor={displayMode === 'MOUSE' ? '#131c38' : '#311042'} />
                <stop offset="55%" stopColor="#1e1b4b" />
                <stop offset="100%" stopColor="#09090b" />
              </radialGradient>
              <radialGradient id={`dial-glow-${uid}`} cx="50%" cy="32%" r="65%">
                <stop
                  offset="0%"
                  stopColor={displayMode === 'MOUSE' ? '#22d3ee' : '#c084fc'}
                  stopOpacity="0.20"
                />
                <stop offset="60%" stopColor="#6366f1" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.40" />
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

            {displayMode === 'MACRO' ? (
              <>
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

                {/* Center 3-tap mode switch hint ring (does not block any outer buttons) */}
                <circle
                  cx={CENTER_X}
                  cy={CENTER_Y}
                  r={46}
                  fill="#0f172a"
                  fillOpacity={0.45}
                  stroke={centerTapProgress > 0 ? '#22d3ee' : '#a855f7'}
                  strokeOpacity={centerTapProgress > 0 ? 0.85 : 0.3}
                  strokeWidth={centerTapProgress > 0 ? 1.8 : 1}
                  strokeDasharray="3 3"
                />
                <text
                  x={CENTER_X}
                  y={CENTER_Y - 4}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fillOpacity="0.65"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  3x TAP
                </text>
                <text
                  x={CENTER_X}
                  y={CENTER_Y + 9}
                  textAnchor="middle"
                  fill="#22d3ee"
                  fillOpacity="0.8"
                  fontSize="8.5"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  {centerTapProgress > 0 ? `(${centerTapProgress}/3) MOUSE` : 'MOUSE MODE'}
                </text>
              </>
            ) : (
              /* MOUSE MODE full circular touchpad decorations (all pointer-events-none) */
              <>
                {/* Neon outer touchpad perimeter ring */}
                <circle
                  cx={CENTER_X}
                  cy={CENTER_Y}
                  r={168}
                  fill="none"
                  stroke="#22d3ee"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                />

                {/* Mid touchpad radar ring */}
                <circle
                  cx={CENTER_X}
                  cy={CENTER_Y}
                  r={122}
                  fill="none"
                  stroke="#a855f7"
                  strokeOpacity={0.22}
                  strokeWidth={1}
                  strokeDasharray="4 6"
                />

                {/* Subtle crosshair axis lines */}
                <line
                  x1={24}
                  y1={CENTER_Y}
                  x2={336}
                  y2={CENTER_Y}
                  stroke="#22d3ee"
                  strokeOpacity={0.12}
                  strokeWidth={1}
                />
                <line
                  x1={CENTER_X}
                  y1={24}
                  x2={CENTER_X}
                  y2={336}
                  stroke="#22d3ee"
                  strokeOpacity={0.12}
                  strokeWidth={1}
                />

                {/* Center 3-tap return zone ring (r = 60) */}
                <circle
                  cx={CENTER_X}
                  cy={CENTER_Y}
                  r={CENTER_SWITCH_RADIUS}
                  fill="#090d16"
                  fillOpacity={0.35}
                  stroke={centerTapProgress > 0 ? '#f43f5e' : '#a855f7'}
                  strokeOpacity={centerTapProgress > 0 ? 0.9 : 0.45}
                  strokeWidth={centerTapProgress > 0 ? 2 : 1.2}
                  strokeDasharray="5 4"
                />

                {/* Center 3-tap return label */}
                <text
                  x={CENTER_X}
                  y={CENTER_Y - 5}
                  textAnchor="middle"
                  fill="#e2e8f0"
                  fillOpacity="0.7"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  중앙 3회 터치
                </text>
                <text
                  x={CENTER_X}
                  y={CENTER_Y + 9}
                  textAnchor="middle"
                  fill="#c084fc"
                  fillOpacity="0.9"
                  fontSize="9"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  {centerTapProgress > 0 ? `복귀 (${centerTapProgress}/3)` : '매크로 모드 복귀'}
                </text>

                {/* Cursor movement trail */}
                {cursorTrail.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#22d3ee"
                    strokeOpacity={0.45}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={cursorTrail.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  />
                )}

                {/* Click ripples */}
                {clickRipples.map((r) => (
                  <g key={r.id}>
                    <circle
                      cx={r.x}
                      cy={r.y}
                      r={22}
                      fill="none"
                      stroke={r.button === 'LEFT' ? '#22d3ee' : '#e879f9'}
                      strokeOpacity={0.85}
                      strokeWidth={2}
                    />
                    <circle
                      cx={r.x}
                      cy={r.y}
                      r={10}
                      fill={r.button === 'LEFT' ? '#22d3ee' : '#e879f9'}
                      fillOpacity={0.25}
                    />
                  </g>
                ))}

                {/* Live virtual cursor indicator */}
                <g transform={`translate(${virtualCursor.x}, ${virtualCursor.y})`}>
                  <circle r={11} fill="none" stroke="#a855f7" strokeOpacity={0.75} strokeWidth={1.2} />
                  <circle r={4.5} fill="#22d3ee" />
                </g>
              </>
            )}

            {/* Outer safe bezel ring */}
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={174}
              fill="none"
              stroke={
                isTestMode
                  ? '#D97706'
                  : displayMode === 'MOUSE'
                    ? '#22d3ee'
                    : '#475569'
              }
              strokeOpacity={isTestMode || displayMode === 'MOUSE' ? 0.9 : 0.6}
              strokeWidth={isTestMode || displayMode === 'MOUSE' ? 1.5 : 1}
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

          {/* MOUSE MODE Overlay HUD (strictly pointer-events-none so it never blocks touch) */}
          {displayMode === 'MOUSE' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-7 px-8 text-center">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-400/50 text-cyan-300 text-[11px] font-mono font-bold tracking-wider shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span>TOUCHPAD MOUSE MODE</span>
                </div>
                <div className="text-[10px] font-mono text-slate-300/80">
                  1회 터치: 좌클릭 · 2회 터치: 우클릭 · 드래그: 커서 이동
                </div>
              </div>

              <div className="space-y-0.5">
                <div
                  className={`inline-block px-3 py-1 rounded-full text-[10px] font-mono font-semibold border ${
                    mouseFeedback.kind === 'LEFT_CLICK'
                      ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200'
                      : mouseFeedback.kind === 'RIGHT_CLICK'
                        ? 'bg-purple-950/90 border-purple-400 text-purple-200'
                        : mouseFeedback.kind === 'MOVE'
                          ? 'bg-slate-900/90 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900/80 border-slate-700 text-slate-300'
                  }`}
                >
                  {mouseFeedback.kind === 'LEFT_CLICK'
                    ? 'LEFT CLICK (좌클릭)'
                    : mouseFeedback.kind === 'RIGHT_CLICK'
                      ? 'RIGHT CLICK (우클릭)'
                      : mouseFeedback.kind === 'MOVE'
                        ? `MOVE Δ(${mouseFeedback.dx}, ${mouseFeedback.dy})`
                        : 'READY · FULL 360×360 TOUCHPAD'}
                </div>
              </div>
            </div>
          )}

          {/* Soft Jelly App-Icon Buttons (Rendered ONLY in MACRO mode; hidden in MOUSE mode) */}
          {displayMode === 'MACRO' &&
            geometries.map((geo) => {
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
                    clearPendingTaps();
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

      {/* Live Visual Response Bar for Mouse Mode */}
      {displayMode === 'MOUSE' && (
        <div className="w-full mt-3 px-3.5 py-2.5 rounded-md border bg-slate-900 border-cyan-500/40 text-cyan-100 text-xs">
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span className="text-cyan-300 flex items-center gap-1.5">
              <MousePointer2 className="w-3.5 h-3.5" />
              <span>USB HID 마우스 모드 활성 (360×360 원형 터치패드)</span>
            </span>
            <span className="font-mono text-[11px] text-purple-300">
              중앙 3회 연속 터치 → 매크로 복귀
            </span>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-300 truncate">
            {mouseFeedback.label}
          </div>
        </div>
      )}

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
              {displayMode === 'MOUSE'
                ? isCenterSwitchZone(hoverCoords.x, hoverCoords.y)
                  ? '터치패드 (중앙 3x 전환 영역)'
                  : '터치패드 영역'
                : hoverCoords.slot !== null
                  ? `슬롯 ${hoverCoords.slot}`
                  : isCenterSwitchZone(hoverCoords.x, hoverCoords.y)
                    ? '중앙 (3x 터치: 마우스 모드)'
                    : '영역 외'}
            </span>
          ) : displayMode === 'MOUSE' ? (
            <span>
              마우스 모드 · 커서 X:{String(virtualCursor.x).padStart(3, '0')} Y:{String(virtualCursor.y).padStart(3, '0')}
            </span>
          ) : (
            <span>
              슬롯 {activeMacroSlotIndex} · 버튼 #{selectedSlotIndex} ({selectedButton?.label ?? '-'})
            </span>
          )}
        </div>

        {displayMode === 'MACRO' && selectedMacro && onTriggerPreviewMacro && (
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
