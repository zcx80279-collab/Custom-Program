import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
  ArrowDown,
  ArrowUp,
  FolderOpen,
  Link2,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  MacroDefinition,
  MacroExecutionMode,
  MacroExecutionResult,
  MacroStep,
  MacroStepType,
  ModifierKey,
  ProgramLaunchTestResult,
} from '../shared/types';
import { CANONICAL_KEYS, MODIFIER_LABELS } from '../shared/keycodes';
import {
  extractProgramNameFromPath,
  formatProgramArgs,
  macroHasLaunchApp,
  parseProgramArgs,
} from '../shared/programLaunch';
import { MacroEngine, MacroTestVisualEvent } from '../modules/MacroEngine';

interface MacroEditorPanelProps {
  macros: MacroDefinition[];
  macroEngine: MacroEngine;
  isTestMode: boolean;
  visualFeedback: MacroTestVisualEvent | null;
  onToggleTestMode: (enabled: boolean) => void;
  selectedSlotIndex: number;
  selectedSlotLabel: string;
  onCreateMacro: (
    draft: Omit<MacroDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ) => { ok: boolean; macroId?: string; error?: string };
  onUpdateMacro: (macro: MacroDefinition) => { ok: boolean; error?: string };
  onDeleteMacro: (macroId: string) => void;
  onBindMacroToSelectedSlot: (macroId: string) => void;
  onTestMacro: (macro: MacroDefinition) => Promise<MacroExecutionResult>;
}

const ALL_MODIFIERS: ModifierKey[] = ['CTRL', 'SHIFT', 'ALT', 'WIN'];

const EXECUTION_MODE_INFO: Record<MacroExecutionMode, { title: string; detail: string }> = {
  [MacroExecutionMode.DEVICE_HID]: {
    title: 'USB HID (기기 단독 실행)',
    detail: 'ESP32-S3가 USB 키보드 입력을 직접 전송합니다. PC 프로그램 없이도 동작합니다.',
  },
  [MacroExecutionMode.PC_AGENT]: {
    title: 'PC 프로그램 실행 (USB CDC)',
    detail: '기기가 PC 앱에 이벤트를 보내고 Windows 프로그램이 키 입력 또는 .exe 프로그램 실행을 수행합니다.',
  },
  [MacroExecutionMode.HYBRID]: {
    title: '하이브리드 (HID 우선, 미지원 시 PC 실행)',
    detail: '키/지연 매크로 전용: USB HID 복합 모드가 활성화된 경우 기기에서 실행하고, 아닐 경우 PC 앱으로 대체합니다.',
  },
};

function buildArgsTextMap(steps: MacroStep[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of steps) {
    if (s.type === MacroStepType.LAUNCH_APP) {
      map[s.id] = formatProgramArgs(s.appArgs);
    }
  }
  return map;
}

export const MacroEditorPanel: React.FC<MacroEditorPanelProps> = ({
  macros,
  macroEngine,
  isTestMode,
  visualFeedback,
  onToggleTestMode,
  selectedSlotIndex,
  selectedSlotLabel,
  onCreateMacro,
  onUpdateMacro,
  onDeleteMacro,
  onBindMacroToSelectedSlot,
  onTestMacro,
}) => {
  const isElectronRuntime = Boolean(window.roundMacroAPI);
  const [selectedId, setSelectedId] = useState<string>(macros[0]?.id ?? '');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const selectedMacro = useMemo(
    () => macros.find((m) => m.id === selectedId) ?? macros[0] ?? null,
    [macros, selectedId]
  );

  const [draftName, setDraftName] = useState(selectedMacro?.name ?? '');
  const [draftDesc, setDraftDesc] = useState(selectedMacro?.description ?? '');
  const [draftMode, setDraftMode] = useState<MacroExecutionMode>(
    selectedMacro?.executionMode ?? MacroExecutionMode.DEVICE_HID
  );
  const [draftSteps, setDraftSteps] = useState<MacroStep[]>(selectedMacro?.steps ?? []);
  const [argsInputByStepId, setArgsInputByStepId] = useState<Record<string, string>>(() =>
    buildArgsTextMap(selectedMacro?.steps ?? [])
  );
  const [argsErrorByStepId, setArgsErrorByStepId] = useState<Record<string, string>>({});
  const [stepBrowseNoticeById, setStepBrowseNoticeById] = useState<Record<string, string>>({});
  const [stepLaunchResultById, setStepLaunchResultById] = useState<
    Record<string, ProgramLaunchTestResult>
  >({});
  const [testingStepId, setTestingStepId] = useState<string | null>(null);
  const [modeAutoSwitchNote, setModeAutoSwitchNote] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<MacroExecutionResult | null>(null);

  const hasLaunchAppStep = useMemo(
    () => macroHasLaunchApp({ steps: draftSteps }),
    [draftSteps]
  );

  const activeSimulatingStepIdx =
    visualFeedback &&
    visualFeedback.isTestMode &&
    visualFeedback.phase === 'STEP' &&
    visualFeedback.macroId === (selectedMacro?.id ?? 'draft')
      ? visualFeedback.currentStepIndex
      : null;

  const loadIntoForm = (macro: MacroDefinition) => {
    setIsCreatingNew(false);
    setSelectedId(macro.id);
    setDraftName(macro.name);
    setDraftDesc(macro.description);
    setDraftMode(macro.executionMode);
    const clonedSteps = macro.steps.map((s) => ({
      ...s,
      modifiers: s.modifiers ? [...s.modifiers] : undefined,
      appArgs: s.appArgs ? [...s.appArgs] : undefined,
    }));
    setDraftSteps(clonedSteps);
    setArgsInputByStepId(buildArgsTextMap(clonedSteps));
    setArgsErrorByStepId({});
    setStepBrowseNoticeById({});
    setStepLaunchResultById({});
    setModeAutoSwitchNote(null);
    setFeedback(null);
    setTestResult(null);
  };

  const startNewMacro = () => {
    setIsCreatingNew(true);
    setDraftName('새 매크로');
    setDraftDesc('');
    setDraftMode(MacroExecutionMode.DEVICE_HID);
    setDraftSteps([
      {
        id: `step-${Date.now()}`,
        type: MacroStepType.KEY_COMBO,
        key: 'KeyC',
        modifiers: ['CTRL'],
      },
    ]);
    setArgsInputByStepId({});
    setArgsErrorByStepId({});
    setStepBrowseNoticeById({});
    setStepLaunchResultById({});
    setModeAutoSwitchNote(null);
    setFeedback(null);
    setTestResult(null);
  };

  const addStep = (type: MacroStepType) => {
    const newId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let step: MacroStep;

    if (type === MacroStepType.DELAY) {
      step = { id: newId, type, delayMs: 150 };
    } else if (type === MacroStepType.KEY_COMBO) {
      step = { id: newId, type, key: 'KeyS', modifiers: ['CTRL'] };
    } else if (type === MacroStepType.LAUNCH_APP) {
      step = {
        id: newId,
        type,
        appName: '',
        appPath: '',
        appArgs: [],
        workingDir: '',
      };
      if (draftMode !== MacroExecutionMode.PC_AGENT) {
        setDraftMode(MacroExecutionMode.PC_AGENT);
        setModeAutoSwitchNote(
          'Windows 프로그램 실행 동작을 추가하여 실행 방식을 자동으로 PC 프로그램 실행(PC_AGENT)으로 전환했습니다.'
        );
      }
      setArgsInputByStepId((prev) => ({ ...prev, [newId]: '' }));
    } else {
      step = { id: newId, type, key: 'Enter' };
    }

    setDraftSteps((prev) => [...prev, step]);
  };

  const updateStep = (index: number, patch: Partial<MacroStep>) => {
    setDraftSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s)));
  };

  const toggleModifier = (index: number, mod: ModifierKey) => {
    setDraftSteps((prev) =>
      prev.map((s, idx) => {
        if (idx !== index) return s;
        const curr = s.modifiers ?? [];
        const next = curr.includes(mod) ? curr.filter((m) => m !== mod) : [...curr, mod];
        return { ...s, modifiers: next };
      })
    );
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draftSteps.length) return;
    const copy = [...draftSteps];
    const [removed] = copy.splice(index, 1);
    copy.splice(target, 0, removed);
    setDraftSteps(copy);
  };

  const removeStep = (index: number) => {
    const target = draftSteps[index];
    setDraftSteps((prev) => prev.filter((_, idx) => idx !== index));
    if (target) {
      setArgsInputByStepId((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setArgsErrorByStepId((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setStepBrowseNoticeById((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setStepLaunchResultById((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
  };

  const handleArgsInputChange = (index: number, stepId: string, rawValue: string) => {
    setArgsInputByStepId((prev) => ({ ...prev, [stepId]: rawValue }));
    const parsed = parseProgramArgs(rawValue);
    if (!parsed.ok) {
      setArgsErrorByStepId((prev) => ({ ...prev, [stepId]: parsed.error ?? '실행 인수 형식 오류' }));
      return;
    }
    setArgsErrorByStepId((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    updateStep(index, { appArgs: parsed.args });
  };

  const handleBrowseExecutable = async (index: number, step: MacroStep) => {
    setStepBrowseNoticeById((prev) => {
      const next = { ...prev };
      delete next[step.id];
      return next;
    });

    if (!window.roundMacroAPI) {
      setStepBrowseNoticeById((prev) => ({
        ...prev,
        [step.id]:
          'Windows 기본 파일 선택 창은 Electron 데스크톱 앱에서만 사용할 수 있습니다. 브라우저 미리보기에서는 실행 파일 경로(예: C:\\Windows\\System32\\notepad.exe)를 직접 입력하여 UI와 설정 저장을 미리 확인할 수 있습니다.',
      }));
      return;
    }

    const res = await window.roundMacroAPI.macro.browseExecutable();
    if (res.canceled) return;
    if (!res.ok || !res.appPath) {
      setStepBrowseNoticeById((prev) => ({
        ...prev,
        [step.id]: res.error ?? '실행 파일을 선택하지 못했습니다.',
      }));
      return;
    }

    const derivedName = res.appName || extractProgramNameFromPath(res.appPath);
    updateStep(index, {
      appPath: res.appPath,
      appName: step.appName?.trim() ? step.appName : derivedName,
      workingDir: step.workingDir?.trim() ? step.workingDir : '',
    });
  };

  const handleBrowseDirectory = async (index: number, step: MacroStep) => {
    if (!window.roundMacroAPI) {
      setStepBrowseNoticeById((prev) => ({
        ...prev,
        [step.id]:
          '작업 디렉터리 폴더 선택 창은 Electron 데스크톱 앱에서만 사용할 수 있습니다. 브라우저 미리보기에서는 경로를 직접 입력하세요.',
      }));
      return;
    }

    const res = await window.roundMacroAPI.macro.browseDirectory();
    if (res.canceled) return;
    if (!res.ok || !res.dirPath) {
      setStepBrowseNoticeById((prev) => ({
        ...prev,
        [step.id]: res.error ?? '작업 디렉터리를 선택하지 못했습니다.',
      }));
      return;
    }
    updateStep(index, { workingDir: res.dirPath });
  };

  const handleTestSingleProgram = async (step: MacroStep) => {
    setTestingStepId(step.id);
    const res = await macroEngine.testLaunchProgramStep(
      step,
      !isCreatingNew ? selectedMacro?.id : undefined
    );
    setStepLaunchResultById((prev) => ({ ...prev, [step.id]: res }));
    setTestingStepId(null);
  };

  const hasArgParseErrors = Object.keys(argsErrorByStepId).length > 0;

  const liveValidation = macroEngine.validateMacro({
    id: selectedMacro?.id ?? 'draft',
    name: draftName,
    description: draftDesc,
    executionMode: draftMode,
    steps: draftSteps,
    createdAt: '',
    updatedAt: '',
  });

  const combinedErrors = [
    ...liveValidation.errors,
    ...Object.values(argsErrorByStepId),
  ];
  const isFormValid = combinedErrors.length === 0;

  const handleSave = () => {
    setFeedback(null);
    if (!isFormValid) {
      setFeedback({ type: 'err', text: combinedErrors.join(' / ') });
      return;
    }

    if (isCreatingNew || !selectedMacro) {
      const res = onCreateMacro({
        name: draftName,
        description: draftDesc,
        executionMode: draftMode,
        steps: draftSteps,
      });
      if (res.ok) {
        setIsCreatingNew(false);
        if (res.macroId) {
          setSelectedId(res.macroId);
        }
        setFeedback({
          type: 'ok',
          text: hasLaunchAppStep
            ? '새 매크로를 생성했습니다. 사이드바의 "PC 설정 저장"을 눌러 영구 저장하고 원형 버튼에 연결하세요.'
            : '새 매크로를 저장했습니다.',
        });
      } else {
        setFeedback({ type: 'err', text: res.error ?? '저장 실패' });
      }
      return;
    }

    const res = onUpdateMacro({
      ...selectedMacro,
      name: draftName,
      description: draftDesc,
      executionMode: draftMode,
      steps: draftSteps,
    });
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: hasLaunchAppStep
          ? '매크로 변경 사항을 반영했습니다. 영구 저장과 기기 트리거 적용을 위해 "PC 설정 저장"을 눌러 주세요.'
          : '매크로 변경 사항을 저장했습니다.',
      });
    } else {
      setFeedback({ type: 'err', text: res.error ?? '저장 실패' });
    }
  };

  const handleRunTest = async () => {
    const tempMacro: MacroDefinition = {
      id: selectedMacro?.id ?? 'draft',
      name: draftName || '테스트 매크로',
      description: draftDesc,
      executionMode: draftMode,
      steps: draftSteps,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const res = await onTestMacro(tempMacro);
    setTestResult(res);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">매크로 편집</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            단일 키, 키 조합, 지연 시간 및 Windows 프로그램 실행(.exe) 동작을 구성하고 실행 방식을 지정합니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md cursor-pointer select-none whitespace-nowrap shrink-0">
            <input
              type="checkbox"
              checked={isTestMode}
              onChange={(e) => onToggleTestMode(e.target.checked)}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span className={isTestMode ? 'text-amber-700 font-semibold' : 'text-slate-700'}>
              Test Mode (실제 입력 차단)
            </span>
          </label>

          <button
            type="button"
            onClick={startNewMacro}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>새 매크로 추가</span>
          </button>
        </div>
      </div>

      {isTestMode && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2.5 text-xs text-amber-900">
          <ShieldCheck className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">MacroEngine Test Mode 활성화됨: </span>
            <span>
              매크로를 실행해도 실제 Windows 키 입력, USB HID 신호, Windows 프로그램(.exe) 실행을 발생시키지 않으며,
              단계별 시뮬레이션 로그와 화면 하이라이트 응답만 생성합니다.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Macro List */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-md overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">매크로 목록</span>
            <span className="text-xs font-mono tabular-nums text-slate-500">{macros.length}개</span>
          </div>
          <div className="divide-y divide-slate-200 max-h-[520px] overflow-y-auto">
            {macros.map((m) => {
              const active = !isCreatingNew && selectedMacro?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => loadIntoForm(m)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">{m.name}</span>
                    <span className="text-xs font-mono text-slate-500 shrink-0">{m.executionMode}</span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-500 truncate">
                    {macroEngine.summarizeSteps(m.steps)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor Form */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-md p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {isCreatingNew ? '새 매크로 작성' : `편집 중: ${selectedMacro?.name ?? '-'}`}
            </h3>
            <div className="flex items-center gap-2">
              {!isCreatingNew && selectedMacro && (
                <>
                  <button
                    type="button"
                    onClick={() => onBindMacroToSelectedSlot(selectedMacro.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>
                      슬롯 {selectedSlotIndex} ({selectedSlotLabel})에 연결
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteMacro(selectedMacro.id);
                      const remaining = macros.filter((m) => m.id !== selectedMacro.id);
                      if (remaining[0]) loadIntoForm(remaining[0]);
                      else startNewMacro();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>삭제</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Basic Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">매크로 이름</label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
                placeholder="예: VS Code 실행 또는 복사 후 저장"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">실행 방식</label>
              <select
                value={draftMode}
                onChange={(e) => {
                  setDraftMode(e.target.value as MacroExecutionMode);
                  setModeAutoSwitchNote(null);
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
              >
                {Object.values(MacroExecutionMode).map((mode) => (
                  <option key={mode} value={mode}>
                    {EXECUTION_MODE_INFO[mode].title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-slate-500">{EXECUTION_MODE_INFO[draftMode].detail}</p>
            {modeAutoSwitchNote && (
              <p className="text-xs text-blue-700">{modeAutoSwitchNote}</p>
            )}
            {hasLaunchAppStep && draftMode !== MacroExecutionMode.PC_AGENT && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
                <span>
                  Windows 프로그램 실행 동작은 순차 실행 보장을 위해 PC 프로그램 실행(PC_AGENT) 모드에서만 지원됩니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraftMode(MacroExecutionMode.PC_AGENT);
                    setModeAutoSwitchNote(null);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded whitespace-nowrap shrink-0"
                >
                  PC_AGENT로 전환
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">설명</label>
            <input
              type="text"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
              placeholder="매크로 용도를 입력하세요."
            />
          </div>

          {/* Step Sequence Builder */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                동작 시퀀스 ({draftSteps.length}단계 · 최대 32단계)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => addStep(MacroStepType.KEY_TAP)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                >
                  + 단일 키
                </button>
                <button
                  type="button"
                  onClick={() => addStep(MacroStepType.KEY_COMBO)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                >
                  + 키 조합
                </button>
                <button
                  type="button"
                  onClick={() => addStep(MacroStepType.DELAY)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                >
                  + 지연 시간
                </button>
                <button
                  type="button"
                  onClick={() => addStep(MacroStepType.LAUNCH_APP)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md whitespace-nowrap shrink-0"
                >
                  <AppWindow className="w-3.5 h-3.5" />
                  <span>+ Windows 프로그램 실행</span>
                </button>
              </div>
            </div>

            {draftSteps.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-md">
                동작 단계를 하나 이상 추가해 주세요.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                {draftSteps.map((step, idx) => {
                  const isSimulatingThisStep = activeSimulatingStepIdx === idx;
                  const stepBrowseNotice = stepBrowseNoticeById[step.id];
                  const stepLaunchResult = stepLaunchResultById[step.id];
                  const stepArgsError = argsErrorByStepId[step.id];

                  return (
                    <div
                      key={step.id}
                      className={`p-3 space-y-3 transition-colors ${
                        isSimulatingThisStep ? 'bg-amber-50' : ''
                      }`}
                    >
                      {/* Top row of step */}
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`w-6 text-xs font-mono tabular-nums ${
                            isSimulatingThisStep ? 'text-amber-700 font-semibold' : 'text-slate-400'
                          }`}
                        >
                          {idx + 1}.
                        </span>

                        <select
                          value={step.type}
                          onChange={(e) => {
                            const nextType = e.target.value as MacroStepType;
                            if (nextType === MacroStepType.DELAY) {
                              updateStep(idx, {
                                type: nextType,
                                delayMs: 150,
                                key: undefined,
                                modifiers: undefined,
                                appName: undefined,
                                appPath: undefined,
                                appArgs: undefined,
                                workingDir: undefined,
                              });
                            } else if (nextType === MacroStepType.LAUNCH_APP) {
                              updateStep(idx, {
                                type: nextType,
                                key: undefined,
                                modifiers: undefined,
                                delayMs: undefined,
                                appName: step.appName ?? '',
                                appPath: step.appPath ?? '',
                                appArgs: step.appArgs ?? [],
                                workingDir: step.workingDir ?? '',
                              });
                              setArgsInputByStepId((prev) => ({
                                ...prev,
                                [step.id]: formatProgramArgs(step.appArgs),
                              }));
                              if (draftMode !== MacroExecutionMode.PC_AGENT) {
                                setDraftMode(MacroExecutionMode.PC_AGENT);
                                setModeAutoSwitchNote(
                                  'Windows 프로그램 실행 동작을 선택하여 실행 방식을 PC_AGENT로 자동 전환했습니다.'
                                );
                              }
                            } else {
                              updateStep(idx, {
                                type: nextType,
                                key: step.key ?? 'KeyA',
                                modifiers:
                                  nextType === MacroStepType.KEY_COMBO
                                    ? (step.modifiers ?? ['CTRL'])
                                    : undefined,
                                delayMs: undefined,
                                appName: undefined,
                                appPath: undefined,
                                appArgs: undefined,
                                workingDir: undefined,
                              });
                            }
                          }}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                        >
                          <option value={MacroStepType.KEY_TAP}>단일 키 입력</option>
                          <option value={MacroStepType.KEY_COMBO}>키 조합</option>
                          <option value={MacroStepType.DELAY}>지연 시간 (ms)</option>
                          <option value={MacroStepType.LAUNCH_APP}>Windows 프로그램 실행</option>
                        </select>

                        {step.type === MacroStepType.DELAY && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={10}
                              max={10000}
                              step={10}
                              value={step.delayMs ?? 100}
                              onChange={(e) => updateStep(idx, { delayMs: Number(e.target.value) })}
                              className="w-24 px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
                            />
                            <span className="text-xs text-slate-500">ms</span>
                          </div>
                        )}

                        {(step.type === MacroStepType.KEY_TAP || step.type === MacroStepType.KEY_COMBO) && (
                          <>
                            {step.type === MacroStepType.KEY_COMBO && (
                              <div className="flex items-center gap-1">
                                {ALL_MODIFIERS.map((mod) => {
                                  const active = (step.modifiers ?? []).includes(mod);
                                  return (
                                    <button
                                      key={mod}
                                      type="button"
                                      onClick={() => toggleModifier(idx, mod)}
                                      className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                                        active
                                          ? 'bg-blue-600 text-white border-blue-600'
                                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                                      }`}
                                    >
                                      {MODIFIER_LABELS[mod]}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            <select
                              value={step.key ?? 'KeyA'}
                              onChange={(e) => updateStep(idx, { key: e.target.value })}
                              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
                            >
                              {CANONICAL_KEYS.map((k) => (
                                <option key={k.code} value={k.code}>
                                  {k.label} ({k.code})
                                </option>
                              ))}
                            </select>
                          </>
                        )}

                        {step.type === MacroStepType.LAUNCH_APP && (
                          <span className="text-xs text-slate-500 font-mono truncate">
                            PC_AGENT 전용 · .exe 직접 실행 (shell: false)
                          </span>
                        )}

                        {isSimulatingThisStep && (
                          <span className="text-xs font-mono font-medium text-amber-700">
                            시뮬레이션 중
                          </span>
                        )}

                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveStep(idx, -1)}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            aria-label="위로 이동"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === draftSteps.length - 1}
                            onClick={() => moveStep(idx, 1)}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            aria-label="아래로 이동"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStep(idx)}
                            className="p-1 text-slate-400 hover:text-red-600"
                            aria-label="단계 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Dedicated Windows Program Launch Configuration (shown ONLY for LAUNCH_APP) */}
                      {step.type === MacroStepType.LAUNCH_APP && (
                        <div className="ml-0 sm:ml-9 p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                          {!isElectronRuntime && (
                            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 flex items-start gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 mt-0.5 shrink-0" />
                              <span>
                                브라우저 미리보기 모드: 프로그램 설정 UI와 저장을 미리 볼 수 있으며,
                                Windows 파일 선택 창 및 실제 .exe 실행은 Electron Windows 앱에서 동작합니다.
                              </span>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                프로그램 이름
                              </label>
                              <input
                                type="text"
                                value={step.appName ?? ''}
                                onChange={(e) => updateStep(idx, { appName: e.target.value })}
                                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
                                placeholder="예: 메모장, VS Code, 계산기"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                실행 파일 경로 (.exe)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={step.appPath ?? ''}
                                  onChange={(e) => {
                                    const nextPath = e.target.value;
                                    const shouldAutoFillName =
                                      !step.appName?.trim() && /\.exe$/i.test(nextPath.trim());
                                    updateStep(idx, {
                                      appPath: nextPath,
                                      ...(shouldAutoFillName
                                        ? { appName: extractProgramNameFromPath(nextPath) }
                                        : {}),
                                    });
                                  }}
                                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
                                  placeholder="C:\Windows\System32\notepad.exe"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleBrowseExecutable(idx, step)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                  <span>파일 찾아보기</span>
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                실행 인수 (선택 사항)
                              </label>
                              <input
                                type="text"
                                value={argsInputByStepId[step.id] ?? formatProgramArgs(step.appArgs)}
                                onChange={(e) => handleArgsInputChange(idx, step.id, e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
                                placeholder='예: --new-window "C:\work\notes.txt"'
                              />
                              <p className="mt-1 text-[11px] text-slate-500">
                                공백·따옴표 기준으로 안전하게 분리 전달되며 쉘 명령으로 연결되지 않습니다.
                              </p>
                              {stepArgsError && (
                                <p className="mt-1 text-[11px] text-red-700">{stepArgsError}</p>
                              )}
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                작업 디렉터리 (선택 사항)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={step.workingDir ?? ''}
                                  onChange={(e) => updateStep(idx, { workingDir: e.target.value })}
                                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
                                  placeholder="비워두면 실행 파일 폴더를 기본 사용"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleBrowseDirectory(idx, step)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0"
                                >
                                  폴더 선택
                                </button>
                              </div>
                            </div>
                          </div>

                          {stepBrowseNotice && (
                            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
                              {stepBrowseNotice}
                            </div>
                          )}

                          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">
                              Windows 실행 경로는 PC 설정에만 저장되며 ESP32 기기에는 전송되지 않습니다.
                            </span>
                            <button
                              type="button"
                              disabled={!step.appPath?.trim() || Boolean(stepArgsError) || testingStepId === step.id}
                              onClick={() => handleTestSingleProgram(step)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>
                                {testingStepId === step.id
                                  ? '실행 확인 중...'
                                  : isTestMode
                                    ? '프로그램 실행 시뮬레이션'
                                    : '프로그램 실행 테스트'}
                              </span>
                            </button>
                          </div>

                          {stepLaunchResult && (
                            <div
                              className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
                                stepLaunchResult.executedBy === 'TEST_MODE'
                                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                                  : stepLaunchResult.ok
                                    ? 'bg-green-50 border-green-200 text-green-900'
                                    : 'bg-red-50 border-red-200 text-red-900'
                              }`}
                            >
                              <div>
                                {stepLaunchResult.executedBy === 'TEST_MODE'
                                  ? `[TEST MODE 시뮬레이션 · 실제 미실행] ${stepLaunchResult.appName}`
                                  : stepLaunchResult.executedBy === 'BROWSER_UNSUPPORTED'
                                    ? `[실행 불가 · 브라우저 미리보기 제한] ${stepLaunchResult.appName}`
                                    : stepLaunchResult.ok
                                      ? `[실제 실행 성공 · PC_AGENT] ${stepLaunchResult.appName} (PID: ${stepLaunchResult.pid ?? '-'}, ${stepLaunchResult.durationMs}ms)`
                                      : `[실제 실행 실패 · ${stepLaunchResult.errorCode ?? 'ERROR'}] ${stepLaunchResult.appName}`}
                              </div>
                              {stepLaunchResult.errorMessage && (
                                <div className="font-sans">{stepLaunchResult.errorMessage}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Warnings / Validation */}
          {liveValidation.warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 space-y-1">
              {liveValidation.warnings.map((w, i) => (
                <p key={i}>주의: {w}</p>
              ))}
            </div>
          )}

          {combinedErrors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 space-y-1">
              {combinedErrors.map((err, i) => (
                <p key={i}>오류: {err}</p>
              ))}
            </div>
          )}

          {/* Action Bar */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handleRunTest}
              disabled={!isFormValid || hasArgParseErrors}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4" />
              <span>{isTestMode ? 'Test Mode 시뮬레이션 실행' : '매크로 실행 테스트'}</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!isFormValid || hasArgParseErrors}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>{isCreatingNew ? '매크로 생성' : '변경 사항 저장'}</span>
            </button>
          </div>

          {feedback && (
            <p className={`text-xs font-medium ${feedback.type === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
              {feedback.text}
            </p>
          )}

          {testResult && (
            <div
              className={`p-3 border rounded-md text-xs font-mono space-y-1.5 ${
                testResult.isTestMode
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : testResult.executedBy === 'BROWSER_UNSUPPORTED' || !testResult.success
                    ? 'bg-red-50 border-red-200 text-red-900'
                    : testResult.executedBy === 'PC_AGENT'
                      ? 'bg-green-50 border-green-200 text-green-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div>
                {testResult.isTestMode
                  ? `결과: 시뮬레이션 완료 (실제 입력·실행 미발생) · 실행 주체: TEST_MODE · ${testResult.stepsExecuted}단계 (${testResult.durationMs}ms)`
                  : testResult.executedBy === 'BROWSER_UNSUPPORTED'
                    ? `결과: 실행 불가 (브라우저 미리보기 미지원) · 실행 주체: BROWSER_UNSUPPORTED`
                    : testResult.executedBy === 'DRY_RUN_PREVIEW'
                      ? `결과: 드라이런 프리뷰 완료 (실제 입력 미발생) · 실행 주체: DRY_RUN_PREVIEW · ${testResult.stepsExecuted}단계 (${testResult.durationMs}ms)`
                      : `결과: ${testResult.success ? '실제 실행 성공' : '실행 실패'} · 실행 주체: ${testResult.executedBy} · ${testResult.stepsExecuted}단계 (${testResult.durationMs}ms)`}
              </div>
              {testResult.launchedPrograms && testResult.launchedPrograms.length > 0 && (
                <div className="pt-1 border-t border-green-200 space-y-0.5">
                  {testResult.launchedPrograms.map((prog, pIdx) => (
                    <div key={`${prog.appPath}-${pIdx}`}>
                      • 실행된 프로그램: {prog.appName} (PID: {prog.pid ?? '-'}) — {prog.appPath}
                    </div>
                  ))}
                </div>
              )}
              {testResult.stepTraces && testResult.stepTraces.length > 0 && (
                <div className="pt-1 border-t border-current/15 space-y-0.5">
                  {testResult.stepTraces.map((tr) => (
                    <div key={tr.stepIndex}>
                      • {tr.stepIndex + 1}단계 [{tr.type}] {tr.label} ({tr.simulatedDelayMs}ms) —{' '}
                      {tr.actualExecuted
                        ? tr.pid
                          ? `실제 실행됨 (PID: ${tr.pid})`
                          : '실제 실행됨'
                        : '시뮬레이션 (실제 미실행)'}
                    </div>
                  ))}
                </div>
              )}
              {testResult.errorMessage && <div className="font-sans text-red-700">{testResult.errorMessage}</div>}
              {testResult.executedBy === 'DRY_RUN_PREVIEW' && (
                <div className="font-sans text-slate-500">
                  브라우저 프리뷰에서는 실제 Windows OS 키 입력을 주입하지 않습니다 (Electron 빌드 또는 USB HID 기기에서 실제 입력).
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
