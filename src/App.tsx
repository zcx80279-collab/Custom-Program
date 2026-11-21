import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CircleDot,
  Cpu,
  HardDrive,
  Keyboard,
  Layers,
  Send,
} from 'lucide-react';
import {
  AppConfig,
  CircularButtonConfig,
  ConnectionState,
  LayoutPreset,
  LogLevel,
  MacroDefinition,
} from './shared/types';
import { createDefaultConfig } from './shared/defaults';
import { DiagnosticsManager } from './modules/DiagnosticsManager';
import { ConfigManager } from './modules/ConfigManager';
import { ProfileManager } from './modules/ProfileManager';
import { MacroEngine, MacroTestVisualEvent } from './modules/MacroEngine';
import { DisplayManager } from './modules/DisplayManager';
import { DeviceManager, DeviceSnapshot } from './modules/DeviceManager';

import { CircularDisplayPreview } from './components/CircularDisplayPreview';
import { ButtonSlotInspector } from './components/ButtonSlotInspector';
import { DevicePanel } from './components/DevicePanel';
import { MacroEditorPanel } from './components/MacroEditorPanel';
import { ProfilePanel } from './components/ProfilePanel';
import { ConfigPanel } from './components/ConfigPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { ResetConfirmModal } from './components/ResetConfirmModal';

type NavSection = 'preview' | 'device' | 'macros' | 'profiles' | 'config' | 'diagnostics';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'preview', label: '원형 화면 미리보기', icon: CircleDot },
  { id: 'device', label: '기기 관리', icon: Cpu },
  { id: 'macros', label: '매크로 편집', icon: Keyboard },
  { id: 'profiles', label: '프로필 관리', icon: Layers },
  { id: 'config', label: '설정 관리', icon: HardDrive },
  { id: 'diagnostics', label: '기기 진단', icon: Activity },
];

export function App() {
  // Instantiate the 6 separated domain modules once per application lifetime
  const servicesRef = useRef<{
    diagnostics: DiagnosticsManager;
    configManager: ConfigManager;
    profileManager: ProfileManager;
    macroEngine: MacroEngine;
    displayManager: DisplayManager;
    deviceManager: DeviceManager;
  } | null>(null);

  if (!servicesRef.current) {
    const diagnostics = new DiagnosticsManager();
    servicesRef.current = {
      diagnostics,
      configManager: new ConfigManager(diagnostics),
      profileManager: new ProfileManager(diagnostics),
      macroEngine: new MacroEngine(diagnostics),
      displayManager: new DisplayManager(diagnostics),
      deviceManager: new DeviceManager(diagnostics),
    };
  }

  const {
    diagnostics,
    configManager,
    profileManager,
    macroEngine,
    displayManager,
    deviceManager,
  } = servicesRef.current;

  const [activeNav, setActiveNav] = useState<NavSection>('preview');
  const [config, setConfig] = useState<AppConfig>(() => createDefaultConfig());
  const [storageSource, setStorageSource] = useState<'ELECTRON_FS' | 'LOCAL_STORAGE' | 'DEFAULT'>('DEFAULT');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(0);

  const [deviceSnapshot, setDeviceSnapshot] = useState<DeviceSnapshot>(() => deviceManager.getSnapshot());
  const [isTestMode, setIsTestMode] = useState<boolean>(() => macroEngine.isTestMode());
  const [visualFeedback, setVisualFeedback] = useState<MacroTestVisualEvent | null>(null);
  const [, setDiagTick] = useState(0);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Load persisted PC config and subscribe to DeviceManager + DiagnosticsManager
  useEffect(() => {
    let mounted = true;
    configManager.load().then(({ config: loaded, source }) => {
      if (!mounted) return;
      setConfig(loaded);
      setStorageSource(source);
      setHasUnsavedChanges(false);
      macroEngine.setTestMode(Boolean(loaded.preferences?.macroTestMode), true);
      setIsTestMode(macroEngine.isTestMode());
    });

    const unsubDevice = deviceManager.subscribe(() => {
      setDeviceSnapshot(deviceManager.getSnapshot());
    });
    const unsubDiag = diagnostics.subscribe(() => {
      setDiagTick((t) => t + 1);
    });
    const unsubMacroEngine = macroEngine.subscribe(() => {
      setIsTestMode(macroEngine.isTestMode());
    });
    const unsubVisual = macroEngine.subscribeVisualFeedback((evt) => {
      setVisualFeedback(evt);
    });

    // Listen for real ESP32-S3 button press MACRO_EVENT (PC_AGENT or device Test Mode)
    const unsubMacro = deviceManager.onDeviceMacroTrigger(async (macroId, slot, fromDeviceTestMode) => {
      if (deviceManager.getSnapshot().isFlashing) {
        diagnostics.log(
          LogLevel.WARN,
          'FirmwareManager',
          '펌웨어 설치 중에는 기기 매크로 실행을 중지합니다.'
        );
        return;
      }
      const currentConfig = configRef.current;
      const currentActiveProfile =
        currentConfig.profiles.find((p) => p.id === currentConfig.activeProfileId) ??
        currentConfig.profiles[0];

      // Resolve macro against current active profile slot first (supports profile switching cleanly)
      let resolvedMacroId: string | null = macroId;
      if (slot >= 0 && currentActiveProfile) {
        const slotBtn = currentActiveProfile.buttons.find((b) => b.slotIndex === slot);
        if (slotBtn) {
          if (!slotBtn.enabled) {
            const msg = `현재 활성 프로필("${currentActiveProfile.name}")의 슬롯 ${slot}이 비활성화되어 있어 실행하지 않았습니다.`;
            diagnostics.log(LogLevel.WARN, 'MacroEngine', msg);
            showToast('err', msg);
            return;
          }
          if (slotBtn.macroId !== macroId) {
            diagnostics.log(
              LogLevel.WARN,
              'MacroEngine',
              `기기 이벤트 매크로 ID(${macroId})가 현재 PC 활성 프로필("${currentActiveProfile.name}") 슬롯 ${slot} 설정과 달라 PC 활성 프로필 기준으로 실행합니다.`,
              '기기 화면 동기화를 위해 "기기에 적용"을 실행해 주세요.'
            );
          }
          resolvedMacroId = slotBtn.macroId;
        }
      }

      const targetMacro = resolvedMacroId
        ? currentConfig.macros.find((m) => m.id === resolvedMacroId)
        : undefined;

      if (!targetMacro) {
        const msg = `기기 슬롯 ${slot}에 연결된 저장 매크로(${resolvedMacroId ?? '미할당'})를 찾을 수 없습니다.`;
        diagnostics.log(LogLevel.WARN, 'MacroEngine', msg);
        showToast('err', msg);
        return;
      }

      const res = await macroEngine.executeMacroOnPc(targetMacro, {
        slotIndex: slot >= 0 ? slot : undefined,
        forceTestMode: Boolean(fromDeviceTestMode),
        triggeredByDevice: true,
      });

      if (res.isTestMode) {
        showToast('ok', `[TEST MODE] 기기 슬롯 ${slot}: "${res.macroName}" 시뮬레이션 완료 (실제 미실행)`);
      } else if (res.success && res.executedBy === 'PC_AGENT') {
        const launchedSummary =
          res.launchedPrograms && res.launchedPrograms.length > 0
            ? ` · 실행됨: ${res.launchedPrograms.map((p) => p.appName).join(', ')}`
            : '';
        showToast('ok', `기기 슬롯 ${slot}: "${res.macroName}" 실행 완료${launchedSummary}`);
      } else if (!res.success) {
        showToast('err', `기기 슬롯 ${slot} 실행 실패: ${res.errorMessage ?? '알 수 없는 오류'}`);
      }
    });

    return () => {
      mounted = false;
      unsubDevice();
      unsubDiag();
      unsubMacroEngine();
      unsubVisual();
      unsubMacro();
      deviceManager.dispose();
    };
  }, [configManager, deviceManager, diagnostics, macroEngine]);

  const activeProfile = useMemo(
    () => profileManager.getActiveProfile(config),
    [config, profileManager]
  );

  // Ensure selectedSlotIndex stays valid if layout changes
  useEffect(() => {
    const exists = activeProfile.buttons.some((b) => b.slotIndex === selectedSlotIndex);
    if (!exists) setSelectedSlotIndex(0);
  }, [activeProfile, selectedSlotIndex]);

  const selectedButton =
    activeProfile.buttons.find((b) => b.slotIndex === selectedSlotIndex) ??
    activeProfile.buttons[0];

  const isDeviceConnected = deviceSnapshot.connectionState === ConnectionState.CONNECTED;
  const isFlashing = deviceSnapshot.isFlashing;

  const mutateConfig = (next: AppConfig) => {
    setConfig(next);
    setHasUnsavedChanges(true);
  };

  const handleToggleTestMode = (enabled: boolean) => {
    macroEngine.setTestMode(enabled);
    mutateConfig({
      ...config,
      preferences: {
        ...config.preferences,
        macroTestMode: enabled,
      },
    });
    showToast(
      'ok',
      enabled
        ? 'MacroEngine Test Mode가 활성화되었습니다 (실제 입력 차단 · 로그/시각 응답만 생성).'
        : 'MacroEngine Test Mode가 해제되었습니다.'
    );
  };

  const handleSavePcConfig = async () => {
    const res = await configManager.save(config);
    if (res.ok) {
      setHasUnsavedChanges(false);
      setStorageSource(window.roundMacroAPI ? 'ELECTRON_FS' : 'LOCAL_STORAGE');
      showToast('ok', 'PC 설정을 저장했습니다.');
    } else {
      showToast('err', res.error ?? 'PC 설정 저장에 실패했습니다.');
    }
    return res;
  };

  const handleApplyToDevice = async () => {
    const compiled = displayManager.compileForDevice(config);
    if (!compiled.ok || !compiled.payload) {
      const err = compiled.error ?? '설정 컴파일 실패';
      showToast('err', err);
      return { ok: false, error: err };
    }
    const res = await deviceManager.applyConfigToDevice(compiled.payload);
    if (res.ok) {
      const next: AppConfig = {
        ...config,
        lastAppliedToDeviceAt: new Date().toISOString(),
      };
      setConfig(next);
      await configManager.save(next);
      setHasUnsavedChanges(false);
      showToast('ok', `프로필 "${activeProfile.name}"을 기기에 적용했습니다.`);
    } else {
      showToast('err', res.error ?? '기기 적용 실패');
    }
    return res;
  };

  const handleConfirmResetDevice = async (resendAfterReset: boolean) => {
    setResetInProgress(true);
    const res = await deviceManager.resetDeviceConfig();
    if (!res.ok) {
      setResetInProgress(false);
      showToast('err', res.error ?? '기기 설정 초기화에 실패했습니다.');
      return;
    }

    if (resendAfterReset) {
      const applyRes = await handleApplyToDevice();
      setResetInProgress(false);
      setResetModalOpen(false);
      if (applyRes.ok) {
        showToast('ok', '기기 초기화 후 PC 설정을 재전송했습니다.');
      }
      return;
    }

    setResetInProgress(false);
    setResetModalOpen(false);
    showToast('ok', '기기 설정을 초기화했습니다. PC 원본 설정은 유지됩니다.');
  };

  const handleExportJson = () => {
    const json = configManager.serializeForExport(config);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roundmacro-v2-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    diagnostics.log(LogLevel.INFO, 'ConfigManager', 'PC 설정을 JSON 파일로 내보냈습니다.');
  };

  const handleExportDiagnostics = () => {
    const report = diagnostics.exportDiagnosticReport({
      runtimeTransport: deviceSnapshot.runtimeTransport,
      connectionState: deviceSnapshot.connectionState,
      deviceInfo: deviceSnapshot.deviceInfo,
      activeProfileId: config.activeProfileId,
      schemaVersion: config.schemaVersion,
    });
    const blob = new Blob([report], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roundmacro-v2-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Single row, 3 zones (Wordmark | Breadcrumb + Active Profile | Primary CTA) */}
      <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        <div className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          RoundMacroController V2
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 truncate">
          <span>활성 프로필: {activeProfile.name}</span>
          <span aria-hidden="true">·</span>
          <span className={isDeviceConnected ? 'text-green-700 font-medium' : 'text-slate-600'}>
            USB: {isDeviceConnected ? deviceSnapshot.deviceInfo?.deviceName ?? '연결됨' : '미연결'}
          </span>
          {isTestMode && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 font-semibold">Test Mode</span>
            </>
          )}
          {hasUnsavedChanges && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 font-medium">저장 안 됨</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleApplyToDevice}
            disabled={!isDeviceConnected || isFlashing}
            title={
              isFlashing
                ? '펌웨어 설치 중에는 기기 설정 전송이 중지됩니다.'
                : isDeviceConnected
                  ? '현재 활성 프로필을 연결된 ESP32-S3 기기에 적용합니다.'
                  : '실제 USB 기기가 연결되어 있어야 기기에 적용할 수 있습니다.'
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>기기에 적용</span>
          </button>
        </div>
      </header>

      {/* Main Desktop Workbench */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar Navigation (224px) */}
        <aside className="w-56 bg-white border-r border-slate-200 p-3 flex flex-col justify-between shrink-0">
          <nav className="space-y-1" aria-label="주 메뉴">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Compact Profile Switcher inside Sidebar */}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <label htmlFor="sidebar-profile-select" className="block text-xs font-medium text-slate-500 px-1">
              빠른 프로필 전환
            </label>
            <select
              id="sidebar-profile-select"
              value={config.activeProfileId}
              onChange={(e) => mutateConfig(profileManager.switchProfile(config, e.target.value))}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:border-blue-500"
            >
              {config.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSavePcConfig}
              className="w-full py-1.5 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
            >
              {hasUnsavedChanges ? 'PC 설정 저장 *' : 'PC 설정 저장됨'}
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {toast && (
              <div
                className={`px-4 py-2.5 rounded-md border text-sm ${
                  toast.type === 'ok'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {toast.text}
              </div>
            )}

            {/* Screen D: 360x360 Circular Preview Workbench (Default Focal Screen) */}
            {activeNav === 'preview' && (
              <div className="space-y-6">
                <div className="pb-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-semibold text-slate-900">
                      원형 화면 미리보기 및 버튼 매핑
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                      360×360 원형 화면에서 버튼을 직접 클릭해 선택하고, 라벨과 매크로를 연결합니다.
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-500">
                    대상 보드: Guition JC3636W518C (ESP32-S3R8)
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-5 bg-white border border-slate-200 rounded-md p-5 flex justify-center">
                    <CircularDisplayPreview
                      profile={activeProfile}
                      macros={config.macros}
                      selectedSlotIndex={selectedSlotIndex}
                      isTestMode={isTestMode}
                      visualFeedback={visualFeedback}
                      onToggleTestMode={handleToggleTestMode}
                      onSelectSlot={setSelectedSlotIndex}
                      onTriggerPreviewMacro={(slot, macro) => {
                        macroEngine.executeMacroOnPc(macro, { slotIndex: slot }).then((res) => {
                          if (res.isTestMode) {
                            showToast('ok', `[TEST MODE] ${res.macroName} 시뮬레이션 완료 (실제 입력·실행 미발생)`);
                          } else if (res.executedBy === 'BROWSER_UNSUPPORTED') {
                            showToast('err', res.errorMessage ?? '브라우저 미리보기에서는 Windows 프로그램을 실행할 수 없습니다.');
                          } else if (res.executedBy === 'DRY_RUN_PREVIEW') {
                            showToast('ok', `${res.macroName} 드라이런 프리뷰 완료 (실제 OS 입력 미발생)`);
                          } else if (res.success) {
                            const launched =
                              res.launchedPrograms && res.launchedPrograms.length > 0
                                ? ` · ${res.launchedPrograms.map((p) => p.appName).join(', ')}`
                                : '';
                            showToast('ok', `${res.macroName} 실행 완료 (${res.executedBy}${launched})`);
                          } else {
                            showToast('err', res.errorMessage ?? '실행 오류');
                          }
                        });
                      }}
                      isDeviceConnected={isDeviceConnected}
                    />
                  </div>

                  <div className="lg:col-span-7">
                    <ButtonSlotInspector
                      profile={activeProfile}
                      selectedButton={selectedButton}
                      macros={config.macros}
                      macroEngine={macroEngine}
                      onUpdateButton={(slotIdx: number, patch: Partial<CircularButtonConfig>) =>
                        mutateConfig(
                          profileManager.updateButton(config, activeProfile.id, slotIdx, patch)
                        )
                      }
                      onAssignMacro={(slotIdx: number, macroId: string | null) =>
                        mutateConfig(
                          profileManager.assignMacroToButton(config, activeProfile.id, slotIdx, macroId)
                        )
                      }
                      onChangeLayout={(layout: LayoutPreset) =>
                        mutateConfig(
                          profileManager.changeProfileLayout(config, activeProfile.id, layout)
                        )
                      }
                      onJumpToMacroEditor={() => setActiveNav('macros')}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Screen A: Device Management & Firmware Installation */}
            {activeNav === 'device' && (
              <DevicePanel
                snapshot={deviceSnapshot}
                onScanPorts={async () => {
                  await deviceManager.scanPorts();
                }}
                onConnect={async (portPath) => {
                  const res = await deviceManager.connect(portPath);
                  if (!res.ok && res.error) showToast('err', res.error);
                  else if (res.ok) showToast('ok', '실제 USB 기기에 연결했습니다.');
                }}
                onDisconnect={async () => {
                  await deviceManager.disconnect();
                  showToast('ok', 'USB 연결을 해제했습니다.');
                }}
                onTestConnection={() => deviceManager.testConnection()}
                onToggleAutoReconnect={(enabled) => {
                  deviceManager.setAutoReconnect(enabled);
                  mutateConfig({
                    ...config,
                    preferences: { ...config.preferences, autoReconnect: enabled },
                  });
                }}
                onRequestResetModal={() => setResetModalOpen(true)}
                onFlashingStateChange={(active) => deviceManager.setFlashingState(active)}
                onPostFlashReconnect={(reconnectedPortPath) =>
                  deviceManager.syncPostFlashConnection(reconnectedPortPath)
                }
                onApplyPcConfigToDevice={handleApplyToDevice}
                onLogFirmwareEvent={(level, message, details) => {
                  const lv =
                    level === 'ERROR'
                      ? LogLevel.ERROR
                      : level === 'WARN'
                        ? LogLevel.WARN
                        : LogLevel.INFO;
                  diagnostics.log(lv, 'FirmwareManager', message, details);
                }}
              />
            )}

            {/* Screen B: Macro Editor */}
            {activeNav === 'macros' && (
              <MacroEditorPanel
                macros={config.macros}
                macroEngine={macroEngine}
                isTestMode={isTestMode}
                visualFeedback={visualFeedback}
                onToggleTestMode={handleToggleTestMode}
                selectedSlotIndex={selectedSlotIndex}
                selectedSlotLabel={selectedButton.label}
                onCreateMacro={(draft) => {
                  const res = macroEngine.createMacro(config, draft);
                  if (res.ok) mutateConfig(res.config);
                  return { ok: res.ok, macroId: res.macro?.id, error: res.error };
                }}
                onUpdateMacro={(macro: MacroDefinition) => {
                  const res = macroEngine.updateMacro(config, macro);
                  if (res.ok) mutateConfig(res.config);
                  return { ok: res.ok, error: res.error };
                }}
                onDeleteMacro={(macroId) => {
                  mutateConfig(macroEngine.deleteMacro(config, macroId));
                }}
                onBindMacroToSelectedSlot={(macroId) => {
                  mutateConfig(
                    profileManager.assignMacroToButton(
                      config,
                      activeProfile.id,
                      selectedSlotIndex,
                      macroId
                    )
                  );
                  showToast('ok', `슬롯 ${selectedSlotIndex}(${selectedButton.label})에 매크로를 연결했습니다.`);
                }}
                onTestMacro={(macro) => macroEngine.executeMacroOnPc(macro)}
              />
            )}

            {/* Screen C: Profile Management */}
            {activeNav === 'profiles' && (
              <ProfilePanel
                profiles={config.profiles}
                activeProfileId={config.activeProfileId}
                onCreateProfile={(name, layout, desc) =>
                  mutateConfig(profileManager.createProfile(config, name, layout, desc))
                }
                onRenameProfile={(id, name, desc) =>
                  mutateConfig(profileManager.renameProfile(config, id, name, desc))
                }
                onDuplicateProfile={(id) =>
                  mutateConfig(profileManager.duplicateProfile(config, id))
                }
                onDeleteProfile={(id) => {
                  const res = profileManager.deleteProfile(config, id);
                  if (res.ok) mutateConfig(res.config);
                  return { ok: res.ok, error: res.error };
                }}
                onSwitchProfile={(id) =>
                  mutateConfig(profileManager.switchProfile(config, id))
                }
              />
            )}

            {/* Screen E: Config Management */}
            {activeNav === 'config' && (
              <ConfigPanel
                config={config}
                storageSource={storageSource}
                isDeviceConnected={isDeviceConnected}
                displayManager={displayManager}
                hasUnsavedChanges={hasUnsavedChanges}
                onSavePcConfig={handleSavePcConfig}
                onReloadPcConfig={async () => {
                  const { config: loaded, source } = await configManager.load();
                  setConfig(loaded);
                  setStorageSource(source);
                  setHasUnsavedChanges(false);
                  showToast('ok', '저장된 PC 설정을 다시 불러왔습니다.');
                }}
                onExportJson={handleExportJson}
                onImportJsonText={(raw) => {
                  const res = configManager.parseImportedJson(raw);
                  if (res.ok && res.config) {
                    mutateConfig(res.config);
                    return { ok: true };
                  }
                  return { ok: false, error: res.error };
                }}
                onApplyToDevice={handleApplyToDevice}
                onRequestResetDevice={() => setResetModalOpen(true)}
              />
            )}

            {/* Screen F: Diagnostics */}
            {activeNav === 'diagnostics' && (
              <DiagnosticsPanel
                snapshot={deviceSnapshot}
                lastComm={diagnostics.getLastComm()}
                lastError={diagnostics.getLastError()}
                logs={diagnostics.getLogs()}
                onClearLogs={() => diagnostics.clearLogs()}
                onExportReport={handleExportDiagnostics}
              />
            )}
          </div>
        </main>
      </div>

      {/* Explicit confirmation modal for RESET_CONFIG */}
      <ResetConfirmModal
        open={resetModalOpen}
        deviceName={deviceSnapshot.deviceInfo?.deviceName ?? '연결된 ESP32-S3 기기'}
        isProcessing={resetInProgress}
        onCancel={() => setResetModalOpen(false)}
        onConfirmReset={handleConfirmResetDevice}
      />
    </div>
  );
}

export default App;
