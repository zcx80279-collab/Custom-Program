import {
  AppConfig,
  CircularButtonConfig,
  CONFIG_SCHEMA_VERSION,
  LayoutPreset,
  MacroDefinition,
  MacroExecutionMode,
  MacroSlotPage,
  MacroStepType,
  ProfileDefinition,
  SlotTransitionMode,
} from './types';
import { getTotalSlotCount } from './geometry';
import { createBuiltInShortcutPresets } from './presets';

const DEFAULT_COLORS = [
  '#1E293B', // Center
  '#2563EB', // Slot 1
  '#0284C7', // Slot 2
  '#0F766E', // Slot 3
  '#4F46E5', // Slot 4
  '#334155', // Slot 5
  '#0369A1', // Slot 6
  '#475569', // Slot 7
  '#1D4ED8', // Slot 8
];

export function createButtonsForLayout(
  layout: LayoutPreset,
  existingButtons?: CircularButtonConfig[]
): CircularButtonConfig[] {
  const total = getTotalSlotCount(layout);
  const buttons: CircularButtonConfig[] = [];

  for (let i = 0; i < total; i++) {
    const slotIndex = i + 1;
    const existing = existingButtons?.find((b) => b.slotIndex === slotIndex);
    if (existing) {
      buttons.push({ ...existing });
    } else {
      buttons.push({
        slotIndex,
        id: `btn-slot-${slotIndex}`,
        label: `버튼 ${slotIndex}`,
        shortLabel: `BTN ${slotIndex}`,
        accentColor: DEFAULT_COLORS[slotIndex % DEFAULT_COLORS.length],
        macroId: null,
        enabled: true,
      });
    }
  }
  return buttons;
}

export function createDefaultMacroSlots(
  layout: LayoutPreset,
  initialButtons?: CircularButtonConfig[]
): MacroSlotPage[] {
  const slot1Buttons = createButtonsForLayout(layout, initialButtons);
  const slot2Buttons = createButtonsForLayout(layout);
  const slot3Buttons = createButtonsForLayout(layout);

  return [
    { slotIndex: 1, name: '슬롯 1 (기본)', buttons: slot1Buttons },
    { slotIndex: 2, name: '슬롯 2 (작업)', buttons: slot2Buttons },
    { slotIndex: 3, name: '슬롯 3 (미디어)', buttons: slot3Buttons },
  ];
}

export function createDefaultConfig(): AppConfig {
  const now = new Date().toISOString();

  const defaultMacros: MacroDefinition[] = [
    {
      id: 'macro-copy',
      name: '복사 (Ctrl+C)',
      description: '선택 항목을 클립보드에 복사합니다. 기기 단독 USB HID 실행 가능.',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [
        { id: 'st-1', type: MacroStepType.KEY_COMBO, key: 'KeyC', modifiers: ['CTRL'] },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-paste',
      name: '붙여넣기 (Ctrl+V)',
      description: '클립보드 내용을 붙여넣습니다. 기기 단독 USB HID 실행 가능.',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [
        { id: 'st-2', type: MacroStepType.KEY_COMBO, key: 'KeyV', modifiers: ['CTRL'] },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-undo',
      name: '실행 취소 (Ctrl+Z)',
      description: '직전 작업을 취소합니다.',
      executionMode: MacroExecutionMode.DEVICE_HID,
      steps: [
        { id: 'st-3', type: MacroStepType.KEY_COMBO, key: 'KeyZ', modifiers: ['CTRL'] },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-save-build',
      name: '전체 저장 후 실행 (시퀀스)',
      description: 'Ctrl+S 후 250ms 대기, F5를 순차 실행합니다.',
      executionMode: MacroExecutionMode.HYBRID,
      steps: [
        { id: 'st-4a', type: MacroStepType.KEY_COMBO, key: 'KeyS', modifiers: ['CTRL'] },
        { id: 'st-4b', type: MacroStepType.DELAY, delayMs: 250 },
        { id: 'st-4c', type: MacroStepType.KEY_TAP, key: 'F5' },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-screenshot',
      name: '화면 캡처 (Win+Shift+S)',
      description: 'Windows 캡처 도구를 호출합니다. PC 프로그램 경유 실행 예시.',
      executionMode: MacroExecutionMode.PC_AGENT,
      steps: [
        { id: 'st-5', type: MacroStepType.KEY_COMBO, key: 'KeyS', modifiers: ['WIN', 'SHIFT'] },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-mute',
      name: '시스템 음소거',
      description: 'Windows 오디오 음소거 토글 (PC 실행 방식 권장).',
      executionMode: MacroExecutionMode.PC_AGENT,
      steps: [
        { id: 'st-6', type: MacroStepType.KEY_TAP, key: 'VolumeMute' },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const defaultButtonsList = [
    {
      slotIndex: 1,
      id: 'btn-slot-1',
      label: '복사',
      shortLabel: 'COPY',
      accentColor: '#1E293B',
      macroId: 'macro-copy',
      enabled: true,
    },
    {
      slotIndex: 2,
      id: 'btn-slot-2',
      label: '붙여넣기',
      shortLabel: 'PASTE',
      accentColor: '#1E293B',
      macroId: 'macro-paste',
      enabled: true,
    },
    {
      slotIndex: 3,
      id: 'btn-slot-3',
      label: '실행 취소',
      shortLabel: 'UNDO',
      accentColor: '#1E293B',
      macroId: 'macro-undo',
      enabled: true,
    },
    {
      slotIndex: 4,
      id: 'btn-slot-4',
      label: '저장/실행',
      shortLabel: 'RUN',
      accentColor: '#2563EB',
      macroId: 'macro-save-build',
      enabled: true,
    },
    {
      slotIndex: 5,
      id: 'btn-slot-5',
      label: '캡처',
      shortLabel: 'SNAP',
      accentColor: '#334155',
      macroId: 'macro-screenshot',
      enabled: true,
    },
    {
      slotIndex: 6,
      id: 'btn-slot-6',
      label: '음소거',
      shortLabel: 'MUTE',
      accentColor: '#334155',
      macroId: 'macro-mute',
      enabled: true,
    },
  ];

  const defaultSlots = createDefaultMacroSlots(LayoutPreset.RADIAL_6_CENTER, defaultButtonsList);
  const defaultProfile: ProfileDefinition = {
    id: 'profile-default',
    name: '기본 작업 프로필',
    description: '일상 편집 및 기본 단축키 구성 (3개 슬롯 좌우 스와이프 지원)',
    layout: LayoutPreset.RADIAL_6_CENTER,
    backgroundColor: '#0F172A',
    macroSlots: defaultSlots,
    activeMacroSlotIndex: 1,
    buttons: defaultSlots[0].buttons,
    createdAt: now,
    updatedAt: now,
  };

  const devSlots = createDefaultMacroSlots(LayoutPreset.RADIAL_4_CENTER);
  const devProfile: ProfileDefinition = {
    id: 'profile-dev',
    name: '개발 및 디버깅',
    description: 'IDE 빌드 및 탐색용 4방향 원형 구성',
    layout: LayoutPreset.RADIAL_4_CENTER,
    backgroundColor: '#0F172A',
    macroSlots: devSlots,
    activeMacroSlotIndex: 1,
    buttons: devSlots[0].buttons,
    createdAt: now,
    updatedAt: now,
  };

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile, devProfile],
    macros: defaultMacros,
    shortcutPresets: createBuiltInShortcutPresets(),
    activePresetId: null,
    preferences: {
      autoReconnect: true,
      reconnectIntervalMs: 3000,
      preferredPortPath: null,
      hidPreferredWhenAvailable: true,
      macroTestMode: false,
      slotTransitionMode: SlotTransitionMode.CIRCULAR,
    },
    lastModifiedAt: now,
    lastAppliedToDeviceAt: null,
  };
}
