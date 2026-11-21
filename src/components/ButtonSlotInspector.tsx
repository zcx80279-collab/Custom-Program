import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  CircularButtonConfig,
  LayoutPreset,
  MacroDefinition,
  MacroExecutionMode,
  MacroStepType,
  ProfileDefinition,
} from '../shared/types';
import { MacroEngine } from '../modules/MacroEngine';

interface ButtonSlotInspectorProps {
  profile: ProfileDefinition;
  selectedButton: CircularButtonConfig;
  macros: MacroDefinition[];
  macroEngine: MacroEngine;
  onUpdateButton: (slotIndex: number, patch: Partial<CircularButtonConfig>) => void;
  onAssignMacro: (slotIndex: number, macroId: string | null) => void;
  onChangeLayout: (layout: LayoutPreset) => void;
  onJumpToMacroEditor: () => void;
}

const COLOR_SWATCHES = [
  '#1E293B',
  '#334155',
  '#2563EB',
  '#0284C7',
  '#0F766E',
  '#4F46E5',
  '#B45309',
  '#991B1B',
];

const MODE_DESC: Record<MacroExecutionMode, string> = {
  [MacroExecutionMode.DEVICE_HID]: '기기 단독 실행 (USB HID)',
  [MacroExecutionMode.PC_AGENT]: 'PC 프로그램 필요 (USB CDC)',
  [MacroExecutionMode.HYBRID]: '하이브리드 (HID 우선 / PC 대체)',
};

export const ButtonSlotInspector: React.FC<ButtonSlotInspectorProps> = ({
  profile,
  selectedButton,
  macros,
  macroEngine,
  onUpdateButton,
  onAssignMacro,
  onChangeLayout,
  onJumpToMacroEditor,
}) => {
  const assignedMacro = selectedButton.macroId
    ? macros.find((m) => m.id === selectedButton.macroId)
    : undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-md p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            선택된 버튼 설정 · 슬롯 {selectedButton.slotIndex}{' '}
            ({selectedButton.slotIndex === 0 ? '중앙 원형' : `외곽 섹터 ${selectedButton.slotIndex}`})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            원형 화면에 표시할 이름, 색상, 활성화 여부 및 매크로 연결을 편집합니다.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={selectedButton.enabled}
            onChange={(e) => onUpdateButton(selectedButton.slotIndex, { enabled: e.target.checked })}
            className="rounded border-slate-300 text-blue-600"
          />
          <span>버튼 활성</span>
        </label>
      </div>

      {/* Button Labels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">버튼 이름 (PC 표시)</label>
          <input
            type="text"
            value={selectedButton.label}
            onChange={(e) => onUpdateButton(selectedButton.slotIndex, { label: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
            maxLength={24}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            기기 화면 짧은 라벨 (최대 8자)
          </label>
          <input
            type="text"
            value={selectedButton.shortLabel}
            onChange={(e) =>
              onUpdateButton(selectedButton.slotIndex, { shortLabel: e.target.value.slice(0, 8) })
            }
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
            maxLength={8}
          />
        </div>
      </div>

      {/* Accent Color */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">버튼 배경 색상</label>
        <div className="flex flex-wrap items-center gap-2">
          {COLOR_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onUpdateButton(selectedButton.slotIndex, { accentColor: hex })}
              className={`w-7 h-7 rounded-md border transition-transform ${
                selectedButton.accentColor === hex
                  ? 'border-blue-600 ring-2 ring-blue-200 scale-105'
                  : 'border-slate-300'
              }`}
              style={{ backgroundColor: hex }}
              aria-label={`색상 ${hex}`}
            />
          ))}
        </div>
      </div>

      {/* Macro Assignment */}
      <div className="pt-3 border-t border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">연결된 매크로</label>
          <button
            type="button"
            onClick={onJumpToMacroEditor}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>매크로 편집으로 이동</span>
          </button>
        </div>

        <select
          value={selectedButton.macroId ?? ''}
          onChange={(e) => onAssignMacro(selectedButton.slotIndex, e.target.value || null)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
        >
          <option value="">-- 매크로 미할당 --</option>
          {macros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} [{m.executionMode}]
            </option>
          ))}
        </select>

        {assignedMacro ? (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-700">
              <span className="font-medium">{assignedMacro.name}</span>
              <span className="font-mono text-slate-500">{MODE_DESC[assignedMacro.executionMode]}</span>
            </div>
            <div className="font-mono text-slate-600">
              동작: {macroEngine.summarizeSteps(assignedMacro.steps)}
            </div>
            {assignedMacro.steps
              .filter((s) => s.type === MacroStepType.LAUNCH_APP && s.appPath)
              .map((s) => (
                <div key={s.id} className="pt-1 border-t border-slate-200 text-slate-600 space-y-0.5">
                  <div className="font-mono truncate" title={s.appPath}>
                    경로: {s.appPath}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Windows 실행 경로는 PC에만 저장되며, ESP32-S3 터치 시 USB를 통해 PC 앱이 프로그램을 실행합니다.
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            이 슬롯에는 아직 매크로가 연결되어 있지 않습니다.
          </p>
        )}
      </div>

      {/* Layout Preset for Active Profile */}
      <div className="pt-3 border-t border-slate-200 space-y-2">
        <label className="block text-xs font-semibold text-slate-700">
          현재 프로필 원형 버튼 배치 ({profile.name})
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: LayoutPreset.RADIAL_4_CENTER, label: '4방향 + 중앙 (5버튼)' },
            { value: LayoutPreset.RADIAL_6_CENTER, label: '6방향 + 중앙 (7버튼)' },
            { value: LayoutPreset.RADIAL_8_CENTER, label: '8방향 + 중앙 (9버튼)' },
          ].map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChangeLayout(preset.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                profile.layout === preset.value
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
