import {
  MacroDefinition,
  MacroExecutionMode,
  MacroStepType,
  ShortcutPreset,
} from './types';

const PRESET_EPOCH_ISO = '2026-01-01T00:00:00.000Z';

/**
 * Built-in shortcut macro definitions referenced by the default 6-button presets.
 * All keycodes strictly use canonical keys from src/shared/keycodes.ts.
 * These are merged non-destructively into config.macros when a preset is applied
 * or selected, without ever overwriting or deleting existing user macros.
 */
export function getBuiltInPresetMacros(): MacroDefinition[] {
  return [
    // --- Windows 기본 ---
    {
      id: 'macro-copy',
      name: '복사 (Ctrl+C)',
      description: '선택 항목을 클립보드에 복사합니다. (Windows 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-copy', type: MacroStepType.KEY_COMBO, key: 'KeyC', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-paste',
      name: '붙여넣기 (Ctrl+V)',
      description: '클립보드 내용을 붙여넣습니다. (Windows 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-paste', type: MacroStepType.KEY_COMBO, key: 'KeyV', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-undo',
      name: '실행 취소 (Ctrl+Z)',
      description: '직전 작업을 취소합니다. (Windows 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-undo', type: MacroStepType.KEY_COMBO, key: 'KeyZ', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-screenshot',
      name: '화면 캡처 (Win+Shift+S)',
      description: 'Windows 캡처 도구를 호출합니다. (Windows 10/11)',
      executionMode: MacroExecutionMode.PC_AGENT,
      steps: [
        { id: 'pm-snap', type: MacroStepType.KEY_COMBO, key: 'KeyS', modifiers: ['WIN', 'SHIFT'] },
      ],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-win-alttab',
      name: '창 전환 (Alt+Tab)',
      description: '열려 있는 작업 창을 전환합니다. (Windows 10/11)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-alttab', type: MacroStepType.KEY_COMBO, key: 'Tab', modifiers: ['ALT'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-mute',
      name: '시스템 음소거',
      description: 'Windows 오디오 음소거 토글 (PC_AGENT 권장).',
      executionMode: MacroExecutionMode.PC_AGENT,
      steps: [{ id: 'pm-mute', type: MacroStepType.KEY_TAP, key: 'VolumeMute' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },

    // --- Blender 모델링 (Blender 3.x / 4.x 3D Viewport) ---
    {
      id: 'macro-preset-blender-grab',
      name: 'Blender: 이동 (G)',
      description: '선택 오브젝트/버텍스를 이동합니다. (Blender 3.x/4.x 3D Viewport)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-bl-g', type: MacroStepType.KEY_TAP, key: 'KeyG' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-blender-rotate',
      name: 'Blender: 회전 (R)',
      description: '선택 대상을 회전합니다. (Blender 3.x/4.x 3D Viewport)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-bl-r', type: MacroStepType.KEY_TAP, key: 'KeyR' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-blender-scale',
      name: 'Blender: 크기 조절 (S)',
      description: '선택 대상의 크기를 조절합니다. (Blender 3.x/4.x 3D Viewport)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-bl-s', type: MacroStepType.KEY_TAP, key: 'KeyS' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-blender-extrude',
      name: 'Blender: 돌출 (E)',
      description: 'Edit Mode에서 면/모서리를 돌출(Extrude)합니다. (Blender Edit Mode)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-bl-e', type: MacroStepType.KEY_TAP, key: 'KeyE' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-blender-mode',
      name: 'Blender: 모드 전환 (Tab)',
      description: 'Object Mode와 Edit Mode를 전환합니다. (Blender 3D Viewport)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-bl-tab', type: MacroStepType.KEY_TAP, key: 'Tab' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },

    // --- 그림 작업 (Clip Studio Paint / Adobe Photoshop 기준) ---
    {
      id: 'macro-preset-art-brush',
      name: '그림: 브러시 (B)',
      description: '브러시 도구를 선택합니다. (Clip Studio Paint / Adobe Photoshop 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-art-b', type: MacroStepType.KEY_TAP, key: 'KeyB' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-art-eraser',
      name: '그림: 지우개 (E)',
      description: '지우개 도구를 선택합니다. (Clip Studio Paint / Adobe Photoshop 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-art-e', type: MacroStepType.KEY_TAP, key: 'KeyE' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-art-eyedropper',
      name: '그림: 스포이드 (I)',
      description: '화면 색상을 추출합니다. (Clip Studio Paint / Adobe Photoshop 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-art-i', type: MacroStepType.KEY_TAP, key: 'KeyI' }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-art-redo',
      name: '그림: 다시 실행 (Ctrl+Y)',
      description: 'Clip Studio Paint 기본 Redo 단축키 (Photoshop 사용 시 Ctrl+Shift+Z 권장).',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-art-y', type: MacroStepType.KEY_COMBO, key: 'KeyY', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-save',
      name: '저장 (Ctrl+S)',
      description: '현재 작업 파일을 저장합니다. (그림/문서/편집 프로그램 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-save', type: MacroStepType.KEY_COMBO, key: 'KeyS', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },

    // --- 문서 작업 (MS Word / Google Docs / 한글 공통) ---
    {
      id: 'macro-preset-doc-bold',
      name: '문서: 굵게 (Ctrl+B)',
      description: '선택 텍스트를 굵게 처리합니다. (MS Word · Google Docs · Notion 기준, 한글 HWP는 Alt+Shift+B)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-doc-b', type: MacroStepType.KEY_COMBO, key: 'KeyB', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
    {
      id: 'macro-preset-doc-find',
      name: '문서: 찾기 (Ctrl+F)',
      description: '문서 내 검색 창을 엽니다. (MS Word · Google Docs · 한글 · 브라우저 공통)',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [{ id: 'pm-doc-f', type: MacroStepType.KEY_COMBO, key: 'KeyF', modifiers: ['CTRL'] }],
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
    },
  ];
}

export function createBuiltInShortcutPresets(): ShortcutPreset[] {
  return [
    {
      id: 'preset-windows-basic',
      name: 'Windows 기본',
      targetApp: 'Windows 10 / 11 데스크톱 & 탐색기',
      description: '복사·붙여넣기·실행 취소·화면 캡처·창 전환·음소거의 기본 6버튼 구성입니다.',
      isBuiltIn: true,
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
      buttons: [
        { slotIndex: 1, label: '복사', shortLabel: 'COPY', accentColor: '#1E293B', macroId: 'macro-copy', enabled: true },
        { slotIndex: 2, label: '붙여넣기', shortLabel: 'PASTE', accentColor: '#1E293B', macroId: 'macro-paste', enabled: true },
        { slotIndex: 3, label: '실행 취소', shortLabel: 'UNDO', accentColor: '#1E293B', macroId: 'macro-undo', enabled: true },
        { slotIndex: 4, label: '캡처', shortLabel: 'SNAP', accentColor: '#2563EB', macroId: 'macro-screenshot', enabled: true },
        { slotIndex: 5, label: '창 전환', shortLabel: 'ALT+TAB', accentColor: '#334155', macroId: 'macro-preset-win-alttab', enabled: true },
        { slotIndex: 6, label: '음소거', shortLabel: 'MUTE', accentColor: '#334155', macroId: 'macro-mute', enabled: true },
      ],
    },
    {
      id: 'preset-blender-modeling',
      name: 'Blender 모델링',
      targetApp: 'Blender 3.x / 4.x (3D Viewport · Object/Edit Mode)',
      description: '이동(G), 회전(R), 크기(S), 돌출(E), 모드 전환(Tab), 실행 취소(Ctrl+Z) 6버튼 구성입니다.',
      isBuiltIn: true,
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
      buttons: [
        { slotIndex: 1, label: '이동 (G)', shortLabel: 'GRAB', accentColor: '#0284C7', macroId: 'macro-preset-blender-grab', enabled: true },
        { slotIndex: 2, label: '회전 (R)', shortLabel: 'ROTATE', accentColor: '#0284C7', macroId: 'macro-preset-blender-rotate', enabled: true },
        { slotIndex: 3, label: '크기 (S)', shortLabel: 'SCALE', accentColor: '#0F766E', macroId: 'macro-preset-blender-scale', enabled: true },
        { slotIndex: 4, label: '돌출 (E)', shortLabel: 'EXTRUDE', accentColor: '#B45309', macroId: 'macro-preset-blender-extrude', enabled: true },
        { slotIndex: 5, label: '모드 전환', shortLabel: 'MODE', accentColor: '#4F46E5', macroId: 'macro-preset-blender-mode', enabled: true },
        { slotIndex: 6, label: '실행 취소', shortLabel: 'UNDO', accentColor: '#334155', macroId: 'macro-undo', enabled: true },
      ],
    },
    {
      id: 'preset-drawing-art',
      name: '그림 작업',
      targetApp: 'Clip Studio Paint 기준 (Photoshop은 다시 실행만 Ctrl+Shift+Z 권장)',
      description: '브러시(B), 지우개(E), 스포이드(I), 실행 취소(Ctrl+Z), 다시 실행(Ctrl+Y), 저장(Ctrl+S) 구성입니다.',
      isBuiltIn: true,
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
      buttons: [
        { slotIndex: 1, label: '브러시 (B)', shortLabel: 'BRUSH', accentColor: '#4F46E5', macroId: 'macro-preset-art-brush', enabled: true },
        { slotIndex: 2, label: '지우개 (E)', shortLabel: 'ERASE', accentColor: '#991B1B', macroId: 'macro-preset-art-eraser', enabled: true },
        { slotIndex: 3, label: '스포이드 (I)', shortLabel: 'PICK', accentColor: '#0284C7', macroId: 'macro-preset-art-eyedropper', enabled: true },
        { slotIndex: 4, label: '실행 취소', shortLabel: 'UNDO', accentColor: '#1E293B', macroId: 'macro-undo', enabled: true },
        { slotIndex: 5, label: '다시 실행', shortLabel: 'REDO', accentColor: '#334155', macroId: 'macro-preset-art-redo', enabled: true },
        { slotIndex: 6, label: '파일 저장', shortLabel: 'SAVE', accentColor: '#0F766E', macroId: 'macro-preset-save', enabled: true },
      ],
    },
    {
      id: 'preset-document-work',
      name: '문서 작업',
      targetApp: 'MS Word · Google Docs 기준 (한글 HWP는 굵게가 Alt+Shift+B)',
      description: '복사·붙여넣기·실행 취소·굵게(Ctrl+B)·찾기(Ctrl+F)·저장(Ctrl+S) 문서 편집 구성입니다.',
      isBuiltIn: true,
      createdAt: PRESET_EPOCH_ISO,
      updatedAt: PRESET_EPOCH_ISO,
      buttons: [
        { slotIndex: 1, label: '복사', shortLabel: 'COPY', accentColor: '#1E293B', macroId: 'macro-copy', enabled: true },
        { slotIndex: 2, label: '붙여넣기', shortLabel: 'PASTE', accentColor: '#1E293B', macroId: 'macro-paste', enabled: true },
        { slotIndex: 3, label: '실행 취소', shortLabel: 'UNDO', accentColor: '#1E293B', macroId: 'macro-undo', enabled: true },
        { slotIndex: 4, label: '굵게', shortLabel: 'BOLD', accentColor: '#2563EB', macroId: 'macro-preset-doc-bold', enabled: true },
        { slotIndex: 5, label: '찾기', shortLabel: 'FIND', accentColor: '#0284C7', macroId: 'macro-preset-doc-find', enabled: true },
        { slotIndex: 6, label: '저장', shortLabel: 'SAVE', accentColor: '#0F766E', macroId: 'macro-preset-save', enabled: true },
      ],
    },
  ];
}

/**
 * Merges built-in presets non-destructively with any existing user presets.
 * Never overwrites or deletes user-created presets.
 */
export function mergeBuiltInPresets(existing?: ShortcutPreset[]): ShortcutPreset[] {
  const builtIns = createBuiltInShortcutPresets();
  if (!Array.isArray(existing) || existing.length === 0) {
    return builtIns;
  }

  const existingById = new Map(existing.map((p) => [p.id, p]));
  const mergedBuiltIns = builtIns.map((bi) => {
    const found = existingById.get(bi.id);
    // Keep built-in definition up to date while preserving user presets separately
    return found && !found.isBuiltIn ? found : bi;
  });

  const builtInIds = new Set(builtIns.map((b) => b.id));
  const userPresets = existing.filter((p) => !builtInIds.has(p.id) && p && typeof p.id === 'string');

  return [...mergedBuiltIns, ...userPresets];
}
