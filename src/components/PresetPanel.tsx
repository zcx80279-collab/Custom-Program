import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Edit3,
  FolderOpen,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MacroDefinition,
  PresetButtonMapping,
  ProfileDefinition,
  ShortcutPreset,
} from '../shared/types';
import { MacroEngine } from '../modules/MacroEngine';
import {
  ActivePresetStatus,
  createEmptyPresetButtons,
  PresetDraft,
} from '../modules/PresetManager';

interface PresetPanelProps {
  presets: ShortcutPreset[];
  activePresetStatus: ActivePresetStatus;
  activeProfile: ProfileDefinition;
  macros: MacroDefinition[];
  selectableMacros: MacroDefinition[];
  macroEngine: MacroEngine;
  onApplyPreset: (presetId: string) => void;
  onCreatePreset: (draft: PresetDraft) => { ok: boolean; error?: string };
  onSaveActiveAsPreset: (
    name: string,
    targetApp: string,
    description: string
  ) => { ok: boolean; error?: string };
  onUpdatePreset: (presetId: string, draft: PresetDraft) => { ok: boolean; error?: string };
  onDuplicatePreset: (presetId: string, openEditor?: boolean) => ShortcutPreset | null;
  onDeletePreset: (presetId: string) => { ok: boolean; error?: string };
  onExportPreset: (presetId: string) => void;
  onImportPresetJson: (rawJson: string) => { ok: boolean; error?: string };
  onJumpToMacroEditor: () => void;
}

type PresetFilter = 'ALL' | 'BUILTIN' | 'USER';

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

function profileButtonsToMappings(profile: ProfileDefinition): PresetButtonMapping[] {
  return Array.from({ length: 6 }, (_, i) => {
    const slotIndex = i + 1;
    const found = profile.buttons.find((b) => b.slotIndex === slotIndex);
    if (found) {
      return {
        slotIndex,
        label: found.label,
        shortLabel: found.shortLabel,
        accentColor: found.accentColor,
        macroId: found.macroId,
        enabled: found.enabled,
      };
    }
    return {
      slotIndex,
      label: `버튼 ${slotIndex}`,
      shortLabel: `BTN ${slotIndex}`,
      accentColor: COLOR_SWATCHES[i % COLOR_SWATCHES.length],
      macroId: null,
      enabled: true,
    };
  });
}

export const PresetPanel: React.FC<PresetPanelProps> = ({
  presets,
  activePresetStatus,
  activeProfile,
  macros,
  selectableMacros,
  macroEngine,
  onApplyPreset,
  onCreatePreset,
  onSaveActiveAsPreset,
  onUpdatePreset,
  onDuplicatePreset,
  onDeletePreset,
  onExportPreset,
  onImportPresetJson,
  onJumpToMacroEditor,
}) => {
  const [filter, setFilter] = useState<PresetFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Quick save current 6 buttons inline modal/panel
  const [quickSaveOpen, setQuickSaveOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickTargetApp, setQuickTargetApp] = useState('');
  const [quickDesc, setQuickDesc] = useState('');

  // Create / Edit Preset form state
  const [editorMode, setEditorMode] = useState<'CLOSED' | 'CREATE' | 'EDIT'>('CLOSED');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftTargetApp, setDraftTargetApp] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftButtons, setDraftButtons] = useState<PresetButtonMapping[]>(createEmptyPresetButtons);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const userMacroIdSet = useMemo(() => new Set(macros.map((m) => m.id)), [macros]);
  const macroById = useMemo(
    () => new Map(selectableMacros.map((m) => [m.id, m])),
    [selectableMacros]
  );

  const userMacros = useMemo(
    () => selectableMacros.filter((m) => userMacroIdSet.has(m.id)),
    [selectableMacros, userMacroIdSet]
  );
  const builtInOnlyMacros = useMemo(
    () => selectableMacros.filter((m) => !userMacroIdSet.has(m.id)),
    [selectableMacros, userMacroIdSet]
  );

  const builtInCount = useMemo(() => presets.filter((p) => p.isBuiltIn).length, [presets]);
  const userCount = useMemo(() => presets.filter((p) => !p.isBuiltIn).length, [presets]);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return presets.filter((p) => {
      if (filter === 'BUILTIN' && !p.isBuiltIn) return false;
      if (filter === 'USER' && p.isBuiltIn) return false;
      if (!q) return true;
      const buttonText = p.buttons.map((b) => `${b.label} ${b.shortLabel}`).join(' ');
      const haystack = `${p.name} ${p.targetApp} ${p.description} ${buttonText}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [presets, filter, searchQuery]);

  const openCreateForm = (seedFromActive = false) => {
    setError(null);
    setQuickSaveOpen(false);
    setEditorMode('CREATE');
    setEditingPresetId(null);
    setDraftName('');
    setDraftTargetApp('');
    setDraftDesc('');
    setDraftButtons(
      seedFromActive ? profileButtonsToMappings(activeProfile) : createEmptyPresetButtons()
    );
  };

  const openEditForm = (preset: ShortcutPreset) => {
    setError(null);
    setQuickSaveOpen(false);
    setEditorMode('EDIT');
    setEditingPresetId(preset.id);
    setDraftName(preset.name);
    setDraftTargetApp(preset.targetApp);
    setDraftDesc(preset.description);
    setDraftButtons(preset.buttons.map((b) => ({ ...b })));
  };

  const closeEditor = () => {
    setEditorMode('CLOSED');
    setEditingPresetId(null);
    setError(null);
  };

  const updateDraftSlot = (slotIndex: number, patch: Partial<PresetButtonMapping>) => {
    setDraftButtons((prev) =>
      prev.map((b) => (b.slotIndex === slotIndex ? { ...b, ...patch } : b))
    );
  };

  const handleAssignMacroInDraft = (slotIndex: number, macroId: string | null) => {
    const macro = macroId ? macroById.get(macroId) : undefined;
    setDraftButtons((prev) =>
      prev.map((b) => {
        if (b.slotIndex !== slotIndex) return b;
        const isGenericLabel = b.label === `버튼 ${slotIndex}` || !b.label.trim();
        const isGenericShort = b.shortLabel === `BTN ${slotIndex}` || !b.shortLabel.trim();
        return {
          ...b,
          macroId,
          label: isGenericLabel && macro ? macro.name.split('(')[0].trim().slice(0, 24) : b.label,
          shortLabel:
            isGenericShort && macro
              ? macro.name.replace(/[^A-Za-z0-9가-힣+]/g, '').slice(0, 8) || b.shortLabel
              : b.shortLabel,
        };
      })
    );
  };

  const handleSubmitEditor = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const draft: PresetDraft = {
      name: draftName,
      targetApp: draftTargetApp,
      description: draftDesc,
      buttons: draftButtons,
    };

    const res =
      editorMode === 'EDIT' && editingPresetId
        ? onUpdatePreset(editingPresetId, draft)
        : onCreatePreset(draft);

    if (!res.ok) {
      setError(res.error ?? '프리셋 저장에 실패했습니다.');
      return;
    }

    setEditorMode('CLOSED');
    setEditingPresetId(null);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = onSaveActiveAsPreset(
      quickName || `${activeProfile.name} 프리셋`,
      quickTargetApp || '사용자 지정 앱',
      quickDesc
    );
    if (!res.ok) {
      setError(res.error ?? '현재 구성을 프리셋으로 저장하지 못했습니다.');
      return;
    }
    setQuickSaveOpen(false);
    setQuickName('');
    setQuickTargetApp('');
    setQuickDesc('');
  };

  const handleDuplicateAndEdit = (presetId: string) => {
    const created = onDuplicatePreset(presetId, true);
    if (created) {
      openEditForm(created);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = onImportPresetJson(text);
      if (!res.ok) {
        setError(res.error ?? '프리셋 파일을 불러오지 못했습니다.');
      } else {
        setError(null);
      }
    } catch (err) {
      setError(`파일 읽기 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">단축키 프리셋 관리</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            프로그램별 6버튼 단축키 프리셋을 적용하거나, 나만의 프리셋을 무제한으로 제작·저장·불러오기할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>프리셋 불러오기 (.json)</span>
          </button>
          <button
            type="button"
            onClick={() => openCreateForm(false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>새 프리셋 만들기</span>
          </button>
        </div>
      </div>

      {/* Current Applied Preset Status Card */}
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-2">
            <span>현재 활성 프로필: {activeProfile.name}</span>
            <span aria-hidden="true">·</span>
            <span>프리셋 적용 시 기존 매크로 목록({macros.length}개)은 그대로 유지됩니다</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {activePresetStatus.preset
                ? `적용된 프리셋: ${activePresetStatus.preset.name}`
                : '적용된 프리셋 없음 (사용자 개별 버튼 구성)'}
            </span>
            {activePresetStatus.preset && activePresetStatus.isModified && (
              <span className="text-xs font-medium text-amber-700">
                · 적용 후 버튼 구성 수정됨
              </span>
            )}
          </div>
          {activePresetStatus.preset && (
            <div className="text-xs text-slate-600">
              적용 대상: {activePresetStatus.preset.targetApp}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activePresetStatus.preset && activePresetStatus.isModified && (
            <button
              type="button"
              onClick={() => onApplyPreset(activePresetStatus.preset!.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>원본 프리셋 다시 적용</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditorMode('CLOSED');
              setQuickSaveOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>현재 6버튼을 프리셋으로 저장</span>
          </button>
        </div>
      </div>

      {/* Inline Quick Save Active Profile as Preset */}
      {quickSaveOpen && (
        <form
          onSubmit={handleQuickSaveSubmit}
          className="bg-white border border-slate-300 rounded-md p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              현재 활성 프로필({activeProfile.name})의 6버튼을 새 프리셋으로 저장
            </h3>
            <button
              type="button"
              onClick={() => openCreateForm(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              6버튼 상세 편집하며 만들기
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">프리셋 이름 *</label>
              <input
                type="text"
                required
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="예: 내 Premiere 편집, Figma 단축키"
                maxLength={40}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">적용 대상 프로그램</label>
              <input
                type="text"
                value={quickTargetApp}
                onChange={(e) => setQuickTargetApp(e.target.value)}
                placeholder="예: Adobe Premiere Pro 2025 / Figma Desktop"
                maxLength={80}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">설명 (선택)</label>
              <input
                type="text"
                value={quickDesc}
                onChange={(e) => setQuickDesc(e.target.value)}
                placeholder="용도 및 주의사항 메모"
                maxLength={160}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setQuickSaveOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              취소
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>프리셋 저장</span>
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Create / Edit User Preset Builder */}
      {editorMode !== 'CLOSED' && (
        <form
          onSubmit={handleSubmitEditor}
          className="bg-white border border-slate-300 rounded-md p-5 space-y-5"
        >
          <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {editorMode === 'EDIT' ? '사용자 프리셋 수정' : '새 사용자 프리셋 제작'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                기존 매크로 또는 기본 단축키를 6개 원형 버튼(슬롯 1~6)에 자유롭게 배정합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDraftButtons(profileButtonsToMappings(activeProfile))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>현재 6버튼 불러오기</span>
              </button>
              <button
                type="button"
                onClick={onJumpToMacroEditor}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>매크로 편집기로 이동</span>
              </button>
            </div>
          </div>

          {/* Preset Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">프리셋 이름 *</label>
              <input
                type="text"
                required
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="예: CAD 작업, 웹 브라우저, 내 작업용"
                maxLength={40}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                적용 대상 프로그램 / 환경
              </label>
              <input
                type="text"
                value={draftTargetApp}
                onChange={(e) => setDraftTargetApp(e.target.value)}
                placeholder="예: AutoCAD / Chrome / Clip Studio Paint"
                maxLength={80}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">설명 (선택)</label>
              <input
                type="text"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder="단축키 기준 또는 작업 설명"
                maxLength={160}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 6-Button Slot Configurator */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                6버튼 단축키·매크로 배정 (슬롯 1~6)
              </span>
              <span className="text-xs text-slate-500">
                원하는 단축키가 목록에 없으면 상단 &ldquo;매크로 편집기로 이동&rdquo;에서 먼저 등록하세요.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {draftButtons.map((btn) => {
                const selectedMacro = btn.macroId ? macroById.get(btn.macroId) : undefined;
                return (
                  <div
                    key={btn.slotIndex}
                    className="p-3.5 border border-slate-200 rounded-md bg-slate-50/70 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-sm border border-slate-300 shrink-0"
                          style={{ backgroundColor: btn.accentColor }}
                        />
                        <span className="text-xs font-semibold font-mono tabular-nums text-slate-900">
                          슬롯 {btn.slotIndex}
                        </span>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={btn.enabled}
                          onChange={(e) =>
                            updateDraftSlot(btn.slotIndex, { enabled: e.target.checked })
                          }
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span>활성</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-7">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          버튼 이름
                        </label>
                        <input
                          type="text"
                          value={btn.label}
                          onChange={(e) =>
                            updateDraftSlot(btn.slotIndex, { label: e.target.value })
                          }
                          maxLength={24}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-5">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          짧은 라벨 (최대 8자)
                        </label>
                        <input
                          type="text"
                          value={btn.shortLabel}
                          onChange={(e) =>
                            updateDraftSlot(btn.slotIndex, {
                              shortLabel: e.target.value.slice(0, 8),
                            })
                          }
                          maxLength={8}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        배정할 매크로 / 단축키
                      </label>
                      <select
                        value={btn.macroId ?? ''}
                        onChange={(e) =>
                          handleAssignMacroInDraft(btn.slotIndex, e.target.value || null)
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-- 미할당 --</option>
                        {userMacros.length > 0 && (
                          <optgroup label="내 매크로 목록">
                            {userMacros.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({macroEngine.summarizeSteps(m.steps)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {builtInOnlyMacros.length > 0 && (
                          <optgroup label="기본 제공 단축키">
                            {builtInOnlyMacros.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({macroEngine.summarizeSteps(m.steps)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {selectedMacro && (
                        <div className="mt-1 text-[11px] font-mono text-slate-500 truncate">
                          동작: {macroEngine.summarizeSteps(selectedMacro.steps)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 mr-1">색상</span>
                      {COLOR_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => updateDraftSlot(btn.slotIndex, { accentColor: hex })}
                          className={`w-5 h-5 rounded border ${
                            btn.accentColor === hex
                              ? 'border-blue-600 ring-2 ring-blue-200'
                              : 'border-slate-300'
                          }`}
                          style={{ backgroundColor: hex }}
                          aria-label={`슬롯 ${btn.slotIndex} 색상 ${hex}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeEditor}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              취소
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{editorMode === 'EDIT' ? '프리셋 수정 저장' : '사용자 프리셋 저장'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {[
            { id: 'ALL' as const, label: `전체 (${presets.length})` },
            { id: 'BUILTIN' as const, label: `기본 프리셋 (${builtInCount})` },
            { id: 'USER' as const, label: `사용자 프리셋 (${userCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="프리셋 이름·프로그램·단축키 검색"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Preset List */}
      {filteredPresets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-md p-8 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700">조건에 맞는 단축키 프리셋이 없습니다.</p>
          <p className="text-xs text-slate-500">
            검색어를 지우거나 &ldquo;새 프리셋 만들기&rdquo;를 눌러 사용자 프리셋을 추가해 보세요.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPresets.map((preset) => {
            const isApplied = activePresetStatus.preset?.id === preset.id;
            const isAppliedClean = isApplied && !activePresetStatus.isModified;

            return (
              <div
                key={preset.id}
                className={`bg-white border rounded-md p-4 space-y-3 ${
                  isApplied ? 'border-blue-400 bg-blue-50/20' : 'border-slate-200'
                }`}
              >
                {/* Top Row: Title + Metadata + Actions */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{preset.name}</h3>
                      <span className="text-xs text-slate-500">
                        · {preset.isBuiltIn ? '기본 제공 프리셋' : '사용자 프리셋'}
                      </span>
                      {isApplied && (
                        <span
                          className={`text-xs font-semibold ${
                            activePresetStatus.isModified ? 'text-amber-700' : 'text-blue-700'
                          }`}
                        >
                          · {activePresetStatus.isModified ? '현재 적용 중 (수정됨)' : '현재 적용 중'}
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-medium text-slate-700">
                      적용 대상: {preset.targetApp}
                    </div>

                    {preset.description && (
                      <p className="text-xs text-slate-500">{preset.description}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onApplyPreset(preset.id)}
                      disabled={isAppliedClean}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        isAppliedClean
                          ? 'bg-slate-100 text-slate-500 cursor-default'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {isAppliedClean
                          ? '적용됨'
                          : isApplied
                            ? '다시 적용'
                            : '프리셋 적용'}
                      </span>
                    </button>

                    {preset.isBuiltIn ? (
                      <button
                        type="button"
                        onClick={() => handleDuplicateAndEdit(preset.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>복제 후 편집</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEditForm(preset)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>수정</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDuplicatePreset(preset.id, false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>복제</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onExportPreset(preset.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>내보내기</span>
                    </button>

                    {!preset.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => {
                          const res = onDeletePreset(preset.id);
                          if (!res.ok && res.error) setError(res.error);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>삭제</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 6-Button Shortcut Preview Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
                  {preset.buttons.map((btn) => {
                    const boundMacro = btn.macroId ? macroById.get(btn.macroId) : undefined;
                    const stepSummary = boundMacro
                      ? macroEngine.summarizeSteps(boundMacro.steps)
                      : '미할당';

                    return (
                      <div
                        key={btn.slotIndex}
                        className={`p-2.5 rounded-md border text-xs space-y-1 ${
                          btn.enabled
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-slate-50/50 border-slate-200 opacity-55'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono tabular-nums text-[11px] text-slate-500">
                            #{btn.slotIndex}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-sm border border-slate-300 shrink-0"
                            style={{ backgroundColor: btn.accentColor }}
                          />
                        </div>
                        <div className="font-semibold text-slate-900 truncate" title={btn.label}>
                          {btn.label}
                        </div>
                        <div
                          className="font-mono text-[11px] text-slate-600 truncate"
                          title={stepSummary}
                        >
                          {stepSummary}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
