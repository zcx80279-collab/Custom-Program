import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileCheck2,
  FolderOpen,
  Hammer,
  HardDriveDownload,
  RefreshCw,
  Send,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  FirmwareBuildEnvironment,
  FirmwareBuildProgressEvent,
  FirmwareBuildResult,
  FirmwareBuildToolStatus,
  FirmwareFlashProgressEvent,
  FirmwareFlashResult,
  FirmwareImageEntry,
  FirmwareImageRole,
  FirmwareInstallMode,
  FirmwareResetMethod,
  FirmwareSelectionState,
  FirmwareToolStatus,
  FirmwareValidationReport,
  getRoleLabelKo,
  JC3636W518C_TARGET,
} from '../shared/firmware';
import { DeviceSnapshot } from '../modules/DeviceManager';

interface FirmwareManagementSectionProps {
  snapshot: DeviceSnapshot;
  selectedPortFromDevicePanel: string;
  onSelectPortFromFirmware: (portPath: string) => void;
  onScanPorts: () => Promise<void>;
  onFlashingStateChange: (active: boolean) => void;
  onPostFlashReconnect: (reconnectedPortPath?: string) => Promise<void>;
  onApplyPcConfigToDevice: () => Promise<{ ok: boolean; error?: string }>;
  onLogFirmwareEvent: (level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: string) => void;
}

const IMAGE_ROLES_ORDER: FirmwareImageRole[] = ['bootloader', 'partitions', 'boot_app0', 'app'];

export const FirmwareManagementSection: React.FC<FirmwareManagementSectionProps> = ({
  snapshot,
  selectedPortFromDevicePanel,
  onSelectPortFromFirmware,
  onScanPorts,
  onFlashingStateChange,
  onPostFlashReconnect,
  onApplyPcConfigToDevice,
  onLogFirmwareEvent,
}) => {
  const isElectron = Boolean(window.roundMacroAPI?.firmware);

  const [installMode, setInstallMode] = useState<FirmwareInstallMode>('UPDATE');
  const [resetMethod, setResetMethod] = useState<FirmwareResetMethod>('auto');
  const [baudRate, setBaudRate] = useState<number>(460800);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [targetPort, setTargetPort] = useState<string>('');
  const [toolStatus, setToolStatus] = useState<FirmwareToolStatus | null>(null);
  const [checkingTools, setCheckingTools] = useState(false);

  const [selection, setSelection] = useState<FirmwareSelectionState | null>(null);
  const [validationReport, setValidationReport] = useState<FirmwareValidationReport | null>(null);
  const [userConfirmed, setUserConfirmed] = useState(false);

  const [flashing, setFlashing] = useState(false);
  const [progress, setProgress] = useState<FirmwareFlashProgressEvent | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [flashResult, setFlashResult] = useState<FirmwareFlashResult | null>(null);
  const [reapplyingConfig, setReapplyingConfig] = useState(false);
  const [reapplyMessage, setReapplyMessage] = useState<string | null>(null);

  const [buildEnv, setBuildEnv] = useState<FirmwareBuildEnvironment>('jc3636w518c_usb_composite');
  const [buildToolStatus, setBuildToolStatus] = useState<FirmwareBuildToolStatus | null>(null);
  const [checkingBuildTools, setCheckingBuildTools] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<FirmwareBuildProgressEvent | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildResult, setBuildResult] = useState<FirmwareBuildResult | null>(null);

  // Sync default port from DevicePanel / snapshot
  useEffect(() => {
    if (selectedPortFromDevicePanel) {
      setTargetPort(selectedPortFromDevicePanel);
    } else if (snapshot.selectedPortPath && !snapshot.selectedPortPath.startsWith('WebSerial(')) {
      setTargetPort(snapshot.selectedPortPath);
    } else {
      const firstSupported = snapshot.ports.find((p) => p.isSupportedTarget);
      if (firstSupported) {
        setTargetPort(firstSupported.path);
      }
    }
  }, [selectedPortFromDevicePanel, snapshot.selectedPortPath, snapshot.ports]);

  // Default installMode sensibly based on whether a device is currently responding via Protocol V2
  useEffect(() => {
    if (!snapshot.deviceInfo && !selection) {
      setInstallMode('INITIAL_INSTALL');
    } else if (snapshot.deviceInfo && !selection) {
      setInstallMode('UPDATE');
    }
  }, [snapshot.deviceInfo, selection]);

  const checkTools = async () => {
    if (!window.roundMacroAPI?.firmware) {
      setToolStatus({
        available: false,
        runtime: 'browser-preview',
        toolKind: 'none',
        toolDisplayName: '브라우저 미리보기 (USB 플래싱 미지원)',
        error:
          'Google AI Studio 브라우저 미리보기에서는 로컬 esptool 실행 및 Windows COM 포트 플래싱을 수행할 수 없습니다.',
        installGuidance: [
          '실제 ESP32-S3 펌웨어 설치는 Windows Electron 데스크톱 앱에서 실행하세요.',
        ],
      });
      return;
    }

    setCheckingTools(true);
    try {
      const status = await window.roundMacroAPI.firmware.detectTools();
      setToolStatus(status);
    } finally {
      setCheckingTools(false);
    }
  };

  const checkBuildTools = async () => {
    if (!window.roundMacroAPI?.firmware?.detectBuildTools) {
      setBuildToolStatus({
        available: false,
        runtime: 'browser-preview',
        toolKind: 'none',
        toolDisplayName: '브라우저 미리보기 (PlatformIO 빌드 미지원)',
        projectFound: false,
        error:
          '브라우저 미리보기에서는 로컬 PlatformIO CLI 빌드 및 firmware/ 프로젝트 실행을 수행할 수 없습니다.',
        installGuidance: [
          '실제 ESP32-S3 펌웨어 빌드는 Windows Electron 데스크톱 앱에서 실행하세요.',
        ],
      });
      return;
    }

    setCheckingBuildTools(true);
    try {
      const status = await window.roundMacroAPI.firmware.detectBuildTools();
      setBuildToolStatus(status);
    } finally {
      setCheckingBuildTools(false);
    }
  };

  useEffect(() => {
    checkTools();
    checkBuildTools();
  }, []);

  useEffect(() => {
    if (!window.roundMacroAPI?.firmware) return;
    const unsub = window.roundMacroAPI.firmware.onProgress((evt) => {
      setProgress(evt);
      if (evt.logLine) {
        setLiveLogs((prev) => [...prev.slice(-180), evt.logLine!]);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.roundMacroAPI?.firmware?.onBuildProgress) return;
    const unsub = window.roundMacroAPI.firmware.onBuildProgress((evt) => {
      setBuildProgress(evt);
      if (evt.logLine) {
        setBuildLogs((prev) => [...prev.slice(-220), evt.logLine!]);
      }
    });
    return unsub;
  }, []);

  const handleModeChange = async (nextMode: FirmwareInstallMode) => {
    if (flashing) return;
    setInstallMode(nextMode);
    setUserConfirmed(false);
    setFlashResult(null);
    setReapplyMessage(null);
    setRecoveryNotice(null);

    // Keep smart auto entry as default for both Initial Install and Update so TinyUSB 1200bps touch & fallback work seamlessly
    if (resetMethod !== 'auto') {
      setResetMethod('auto');
    }

    if (selection && window.roundMacroAPI?.firmware) {
      const updatedSelection: FirmwareSelectionState = {
        ...selection,
        installMode: nextMode,
      };
      setSelection(updatedSelection);
      const report = await window.roundMacroAPI.firmware.inspectSelection(updatedSelection);
      setValidationReport(report);
    }
  };

  const handleBrowseFirmware = async () => {
    if (!window.roundMacroAPI?.firmware || flashing) return;
    setFlashResult(null);
    setUserConfirmed(false);
    setReapplyMessage(null);

    const res = await window.roundMacroAPI.firmware.browseFirmware(installMode);
    if (res.canceled) return;

    if (!res.ok || !res.selection || !res.report) {
      onLogFirmwareEvent('ERROR', '펌웨어 파일 선택/검증 실패', res.error);
      setValidationReport({
        valid: false,
        installMode,
        preservesLittleFs: installMode === 'UPDATE',
        preservesPcConfig: true,
        errors: [res.error ?? '펌웨어 파일을 불러오지 못했습니다.'],
        warnings: [],
        images: [],
      });
      return;
    }

    setSelection(res.selection);
    setValidationReport(res.report);
    onLogFirmwareEvent(
      res.report.valid ? 'INFO' : 'WARN',
      `펌웨어 이미지 선택됨 (${res.report.images.length}개)`,
      res.report.images.map((i) => `${i.role}@${i.offset}:${i.fileName}`).join(', ')
    );
  };

  const handleBrowseSingleRole = async (role: FirmwareImageRole) => {
    if (!window.roundMacroAPI?.firmware || flashing) return;
    setFlashResult(null);
    setUserConfirmed(false);

    const res = await window.roundMacroAPI.firmware.browseSingleImage(role);
    if (res.canceled) return;
    if (!res.ok || !res.image) {
      onLogFirmwareEvent('ERROR', `${role} 이미지 선택 실패`, res.error);
      return;
    }

    const baseImages: FirmwareImageEntry[] = selection?.images
      ? selection.images.filter((i) => i.role !== role)
      : [];
    const nextImages = [...baseImages, res.image].sort(
      (a, b) => IMAGE_ROLES_ORDER.indexOf(a.role) - IMAGE_ROLES_ORDER.indexOf(b.role)
    );

    const nextSelection: FirmwareSelectionState = {
      sourceType: 'BIN_IMAGES',
      installMode,
      boardModel: selection?.boardModel ?? JC3636W518C_TARGET.boardModel,
      firmwareVersion: selection?.firmwareVersion,
      usbMode: selection?.usbMode,
      images: nextImages,
    };

    const report = await window.roundMacroAPI.firmware.inspectSelection(nextSelection);
    setSelection({ ...nextSelection, images: report.images });
    setValidationReport(report);
  };

  const handleBuildFirmware = async () => {
    if (!window.roundMacroAPI?.firmware?.startBuild || building || flashing) return;

    setBuilding(true);
    setBuildResult(null);
    setBuildLogs([]);
    setBuildProgress({
      stage: 'CHECKING_ENV',
      percent: 2,
      message: 'PlatformIO 빌드 환경 및 프로젝트 경로를 확인하고 있습니다...',
      timestamp: new Date().toISOString(),
    });
    onLogFirmwareEvent(
      'INFO',
      `ESP32-S3 펌웨어 빌드 시작 (${buildEnv})`,
      `설치 모드 기준: ${installMode}`
    );

    try {
      const res = await window.roundMacroAPI.firmware.startBuild({
        environment: buildEnv,
        installMode,
      });
      setBuildResult(res);

      if (res.ok && res.selection && res.report) {
        // Connect generated firmware.bin / .rmcfw.json package to existing validation & install UI (NO auto-flash)
        setSelection(res.selection);
        setValidationReport(res.report);
        setUserConfirmed(false);
        setFlashResult(null);
        onLogFirmwareEvent(
          res.report.valid ? 'INFO' : 'WARN',
          `펌웨어 빌드 완료 (${res.firmwareVersion ?? res.environment})`,
          res.firmwareBinPath ?? res.manifestPath
        );
        await checkTools();
        await checkBuildTools();
      } else {
        // Preserve existing firmware selection & validation state on build failure
        onLogFirmwareEvent(
          'ERROR',
          `펌웨어 빌드 실패: ${res.errorMessage ?? '오류'}`,
          res.errorCode
        );
        await checkBuildTools();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBuildResult({
        ok: false,
        stage: 'FAILED',
        environment: buildEnv,
        durationMs: 0,
        errorCode: 'BUILD_IPC_EXCEPTION',
        errorMessage: msg,
        guidanceSteps: ['기존에 선택된 펌웨어 파일은 그대로 보존되었습니다.'],
        logs: buildLogs,
        timestamp: new Date().toISOString(),
      });
      onLogFirmwareEvent('ERROR', '펌웨어 빌드 IPC 예외 발생', msg);
    } finally {
      setBuilding(false);
    }
  };

  const handleCancelBuild = async () => {
    if (!window.roundMacroAPI?.firmware?.cancelBuild || !building) return;
    await window.roundMacroAPI.firmware.cancelBuild();
  };

  const handleStartFlash = async () => {
    if (!window.roundMacroAPI?.firmware || !selection || !validationReport?.valid) return;
    if (!targetPort || !userConfirmed || flashing || building) return;

    const previousVersion = snapshot.deviceInfo?.firmwareVersion;
    setFlashing(true);
    setFlashResult(null);
    setReapplyMessage(null);
    setRecoveryNotice(null);
    setLiveLogs([]);
    setProgress({
      stage: 'VALIDATING',
      percent: 2,
      message: '펌웨어 설치 준비 중...',
      timestamp: new Date().toISOString(),
    });
    onFlashingStateChange(true);
    onLogFirmwareEvent(
      'INFO',
      `ESP32-S3 펌웨어 ${installMode === 'INITIAL_INSTALL' ? '최초 설치' : '업데이트'} 시작`,
      `포트: ${targetPort} · 리셋: ${resetMethod} · 이미지 ${selection.images.length}개`
    );

    try {
      const result = await window.roundMacroAPI.firmware.startFlash({
        portPath: targetPort,
        installMode,
        resetMethod,
        baudRate,
        selection,
        userConfirmed,
        expectedBoardModel: snapshot.deviceInfo?.boardModel,
        previousFirmwareVersion: previousVersion,
      });

      setFlashResult(result);
      onFlashingStateChange(false);

      if (result.ok) {
        onLogFirmwareEvent(
          'INFO',
          `펌웨어 설치 완료 (${result.durationMs}ms)`,
          result.deviceReconnected
            ? `재연결 포트: ${result.reconnectedPortPath}, 새 버전: ${result.newFirmwareVersion}`
            : '플래시 기록 완료 (수동 재연결 필요)'
        );
        await onPostFlashReconnect(result.reconnectedPortPath);
      } else {
        onLogFirmwareEvent(
          'ERROR',
          `펌웨어 설치 실패: ${result.errorMessage ?? '오류'}`,
          result.errorCode
        );
        await onScanPorts();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlashingStateChange(false);
      setFlashResult({
        ok: false,
        stage: 'FAILED',
        portUsed: targetPort,
        deviceReconnected: false,
        durationMs: 0,
        errorCode: 'IPC_EXCEPTION',
        errorMessage: msg,
        logs: liveLogs,
        timestamp: new Date().toISOString(),
      });
      onLogFirmwareEvent('ERROR', '펌웨어 설치 IPC 예외 발생', msg);
    } finally {
      setFlashing(false);
      setUserConfirmed(false);
    }
  };

  const handleCancelFlash = async () => {
    if (!window.roundMacroAPI?.firmware || !flashing) return;
    await window.roundMacroAPI.firmware.cancelFlash();
  };

  const handleReapplyConfig = async () => {
    setReapplyingConfig(true);
    setReapplyMessage(null);
    const res = await onApplyPcConfigToDevice();
    setReapplyMessage(
      res.ok
        ? '기존 PC 활성 프로필 설정을 기기에 다시 적용했습니다.'
        : `설정 재적용 실패: ${res.error ?? '알 수 없는 오류'}`
    );
    setReapplyingConfig(false);
  };

  const handlePrepareManualBootloaderRecovery = async () => {
    if (flashing) return;
    setResetMethod('no_reset');
    setBaudRate(115200);
    await onScanPorts();
    setRecoveryNotice(
      '다운로드 포트를 다시 검색하고 안전 복구 설정(수동 BOOT+RESET 모드 · 115200 bps)으로 전환했습니다. 위에서 ESP32-S3 다운로드(303A:1001) 포트를 확인한 뒤 설치를 다시 시작하세요.'
    );
  };

  const effectivePortOptions = useMemo(() => {
    return snapshot.ports.filter((p) => !p.path.startsWith('webserial-'));
  }, [snapshot.ports]);

  const canStartFlash =
    isElectron &&
    !flashing &&
    !building &&
    Boolean(toolStatus?.available) &&
    Boolean(targetPort) &&
    Boolean(selection) &&
    Boolean(validationReport?.valid) &&
    userConfirmed;

  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
      {/* Section Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <HardDriveDownload className="w-4 h-4 text-blue-600" />
            <span>ESP32-S3 펌웨어 관리 (설치 및 업데이트)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Guition JC3636W518C (ESP32-S3R8 · 16MB QIO Flash · LittleFS @ 0x610000) 전용 USB 플래싱
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={flashing}
            onClick={onScanPorts}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>다운로드 포트 재검색</span>
          </button>
          {isElectron && (
            <button
              type="button"
              disabled={checkingTools || flashing}
              onClick={checkTools}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>{checkingTools ? '도구 확인 중...' : '플래싱 도구 확인'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Browser Preview vs Electron Honesty Banner */}
        {!isElectron && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">브라우저 미리보기 모드 — 실제 USB 펌웨어 플래싱 제한</div>
              <p className="leading-relaxed">
                브라우저 환경에서는 로컬 Windows <span className="font-mono">.bin</span> 파일 선택과{' '}
                <span className="font-mono">esptool</span> COM 포트 플래싱을 실행할 수 없습니다.
                아래에서 JC3636W518C 플래시 구조, 최초 설치/업데이트 절차, 다운로드 모드 가이드를 확인할 수 있으며,
                실제 설치는 Windows Electron 데스크톱 앱에서 수행됩니다.
              </p>
            </div>
          </div>
        )}

        {/* Tool Detection Status (Electron) */}
        {isElectron && toolStatus && (
          <div
            className={`p-3.5 rounded-md border text-xs flex items-start gap-2.5 ${
              toolStatus.available
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            {toolStatus.available ? (
              <CheckCircle2 className="w-4 h-4 text-green-700 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            )}
            <div className="space-y-1">
              <div className="font-medium">
                플래싱 도구 상태: {toolStatus.toolDisplayName}
                {toolStatus.toolVersion ? ` (${toolStatus.toolVersion})` : ''}
              </div>
              {toolStatus.error && <div>{toolStatus.error}</div>}
              {toolStatus.installGuidance.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 text-red-800">
                  {toolStatus.installGuidance.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Current Device Firmware Info & Install Mode Toggle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2 text-xs">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-600" />
              <span>현재 기기 펌웨어 상태</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">대상 보드</span>
              <span className="font-mono text-slate-900">
                {snapshot.deviceInfo?.boardModel ?? 'Guition JC3636W518C (미연결/미확인)'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">현재 펌웨어 버전</span>
              <span className="font-mono font-semibold text-slate-900">
                {snapshot.deviceInfo ? snapshot.deviceInfo.firmwareVersion : '확인 불가 (최초 설치 또는 미연결)'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">현재 USB 모드</span>
              <span className="font-mono text-slate-900">
                {snapshot.deviceInfo?.usbMode ?? '-'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">기기 내장 설정(LittleFS)</span>
              <span className="font-mono text-slate-900">
                {snapshot.deviceStatus
                  ? snapshot.deviceStatus.hasStoredConfig
                    ? `저장됨 (${snapshot.deviceStatus.activeProfileId})`
                    : '저장된 설정 없음'
                  : '-'}
              </span>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={flashing}
              onClick={() => handleModeChange('INITIAL_INSTALL')}
              className={`p-3.5 text-left rounded-md border transition-colors ${
                installMode === 'INITIAL_INSTALL'
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900">
                A. 최초 펌웨어 설치 (Initial Install)
              </div>
              <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                새 보드이거나 펌웨어 통신이 안 될 때 사용합니다.{' '}
                <span className="font-mono">bootloader(0x0000) + partitions(0x8000) + boot_app0(0xe000) + firmware(0x10000)</span>를 함께 기록합니다.
              </p>
            </button>

            <button
              type="button"
              disabled={flashing}
              onClick={() => handleModeChange('UPDATE')}
              className={`p-3.5 text-left rounded-md border transition-colors ${
                installMode === 'UPDATE'
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900">
                B. 기존 펌웨어 업데이트 (Update)
              </div>
              <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                이미 동작 중인 보드에 새 앱 버전을 기록합니다.{' '}
                <span className="font-mono">firmware.bin(0x10000)</span>만 기록하여{' '}
                <span className="font-mono">0x610000</span> LittleFS 설정과 PC 프로필을 유지합니다.
              </p>
            </button>
          </div>
        </div>

        {/* Download Mode Guide (Especially relevant for ESP32-S3 Native USB) */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1.5">
          <div className="font-semibold text-slate-900">
            ESP32-S3 USB 다운로드 모드 및 포트 안내 (Guition JC3636W518C)
          </div>
          <p className="leading-relaxed">
            이 보드는 외부 UART 칩 없이 ESP32-S3 내장 USB PHY(GPIO 19/20)를 사용하므로, 일반 실행 COM 포트와
            부트로더 다운로드 COM 포트(<span className="font-mono">303A:1001</span>) 번호가 다를 수 있습니다.{' '}
            <span className="font-medium text-slate-800">스마트 자동 진입(권장)</span>은 TinyUSB 1200bps 전환,
            다운로드 포트 자동 재탐색, 115200bps 안전 재시도를 자동으로 수행합니다. 자동 진입에 실패하거나 보드가 응답하지 않을 때만 아래 수동 절차를 사용하세요:
          </p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-600">
            <li>
              <span className="font-medium text-slate-800">BOOT (GPIO 0)</span> 버튼을 누른 상태에서{' '}
              <span className="font-medium text-slate-800">RESET</span> 버튼을 1회 눌렀다 떼고, 1초 뒤 BOOT 버튼을 놓습니다
              (또는 BOOT를 누른 채 USB-C 케이블 연결).
            </li>
            <li>
              상단의 <span className="font-medium text-slate-800">다운로드 포트 재검색</span>을 눌러 새로 잡힌{' '}
              <span className="font-mono">303A:1001</span> COM 포트를 선택한 뒤 설치를 시작하세요.
            </li>
          </ol>
        </div>

        {/* Port / Reset Mode / Baud Rate + File Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              플래싱 대상 COM 포트
            </label>
            <select
              value={targetPort}
              disabled={flashing || !isElectron}
              onChange={(e) => {
                setTargetPort(e.target.value);
                onSelectPortFromFirmware(e.target.value);
              }}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
            >
              <option value="">-- COM 포트 선택 --</option>
              {effectivePortOptions.map((p) => {
                const portTag =
                  p.vendorId === JC3636W518C_TARGET.espressifVid &&
                  p.productId === JC3636W518C_TARGET.espressifBootloaderPid
                    ? 'ESP32-S3 다운로드/JTAG'
                    : p.isSupportedTarget
                      ? 'ESP32-S3 TinyUSB'
                      : '일반';
                return (
                  <option key={p.path} value={p.path}>
                    {p.path} ({portTag} · {p.vendorId ?? '----'}:{p.productId ?? '----'})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              부트로더 진입 방식
            </label>
            <select
              value={resetMethod}
              disabled={flashing || !isElectron}
              onChange={(e) => setResetMethod(e.target.value as FirmwareResetMethod)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
            >
              <option value="auto">스마트 자동 진입 — 1200bps + 자동 재시도 (권장)</option>
              <option value="default_reset">자동 리셋 진입 (default_reset)</option>
              <option value="no_reset">수동 BOOT+RESET 진입 후 설치 (no_reset)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              전송 속도 (Baud)
            </label>
            <select
              value={baudRate}
              disabled={flashing || !isElectron}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
            >
              <option value={460800}>460800 bps (권장)</option>
              <option value={921600}>921600 bps (고속)</option>
              <option value={230400}>230400 bps</option>
              <option value={115200}>115200 bps (안정/복구용)</option>
            </select>
          </div>
        </div>

        {/* PlatformIO Firmware Build Section */}
        <div className="p-4 border border-slate-200 rounded-md space-y-3 bg-slate-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Hammer className="w-3.5 h-3.5 text-slate-700" />
                <span>PlatformIO 펌웨어 빌드 (Guition JC3636W518C)</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                기존 <span className="font-mono">firmware/</span> 프로젝트로 펌웨어를 빌드하고{' '}
                <span className="font-mono">rmc-v2-firmware-package</span> 형식으로 패키징한 뒤 아래 설치 목록에 자동 연결합니다.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={buildEnv}
                disabled={!isElectron || building || flashing}
                onChange={(e) => setBuildEnv(e.target.value as FirmwareBuildEnvironment)}
                className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
              >
                <option value="jc3636w518c_usb_composite">
                  jc3636w518c_usb_composite (USB CDC+HID · 2.0.0-rc1)
                </option>
                <option value="jc3636w518c_cdc_only">
                  jc3636w518c_cdc_only (HW CDC 전용 · 2.0.0-rc1-cdc)
                </option>
              </select>

              {isElectron && (
                <button
                  type="button"
                  disabled={checkingBuildTools || building || flashing}
                  onClick={checkBuildTools}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>{checkingBuildTools ? '확인 중...' : '빌드 환경 확인'}</span>
                </button>
              )}

              {building && (
                <button
                  type="button"
                  onClick={handleCancelBuild}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  빌드 중단
                </button>
              )}

              <button
                type="button"
                disabled={!isElectron || building || flashing}
                onClick={handleBuildFirmware}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Hammer className="w-3.5 h-3.5" />
                <span>{building ? '펌웨어 빌드 중...' : '펌웨어 만들기'}</span>
              </button>
            </div>
          </div>

          {isElectron && buildToolStatus && (
            <div
              className={`p-3 rounded-md border text-xs flex items-start gap-2 ${
                buildToolStatus.available
                  ? 'bg-white border-slate-200 text-slate-700'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              {buildToolStatus.available ? (
                <CheckCircle2 className="w-4 h-4 text-green-700 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1 min-w-0 flex-1">
                <div className="font-medium">
                  빌드 도구: {buildToolStatus.toolDisplayName}
                  {buildToolStatus.toolVersion ? ` (${buildToolStatus.toolVersion})` : ''}
                </div>
                {buildToolStatus.projectPath && (
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    프로젝트 경로: {buildToolStatus.projectPath}
                  </div>
                )}
                {buildToolStatus.error && <div>{buildToolStatus.error}</div>}
                {buildToolStatus.installGuidance.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {buildToolStatus.installGuidance.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {buildProgress && (
            <div className="p-3 bg-white border border-slate-200 rounded-md space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-900">{buildProgress.message}</span>
                <span className="font-mono tabular-nums font-semibold text-indigo-700">
                  {buildProgress.percent}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    buildProgress.stage === 'FAILED'
                      ? 'bg-red-600'
                      : buildProgress.stage === 'COMPLETED'
                        ? 'bg-green-600'
                        : 'bg-indigo-600'
                  }`}
                  style={{ width: `${buildProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {buildResult && (
            <div
              className={`p-3 rounded-md border text-xs space-y-2 ${
                buildResult.ok
                  ? 'bg-green-50 border-green-200 text-green-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div className="font-semibold flex items-center gap-1.5">
                {buildResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-green-700" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span>
                  {buildResult.ok
                    ? `펌웨어 빌드 및 패키지 연결 완료 (${(buildResult.durationMs / 1000).toFixed(1)}초)`
                    : `펌웨어 빌드 실패 (${buildResult.errorCode ?? 'BUILD_ERROR'})`}
                </span>
              </div>

              {buildResult.ok && (
                <div className="bg-white/80 p-2 rounded border border-green-200 font-mono text-[11px] space-y-0.5 break-all">
                  <div>
                    환경/버전: {buildResult.environment} ({buildResult.firmwareVersion ?? '-'}) ·{' '}
                    {buildResult.usbMode ?? '-'}
                  </div>
                  {buildResult.firmwareBinPath && (
                    <div>생성된 firmware.bin: {buildResult.firmwareBinPath}</div>
                  )}
                  {buildResult.manifestPath && (
                    <div>패키지 매니페스트: {buildResult.manifestPath}</div>
                  )}
                  <div className="font-sans text-green-800 pt-1">
                    아래 펌웨어 검증 목록에 자동 로드되었습니다. 설치 확인 체크박스를 선택한 뒤 직접 설치를 실행하세요.
                  </div>
                </div>
              )}

              {buildResult.errorMessage && (
                <div className="leading-relaxed">{buildResult.errorMessage}</div>
              )}

              {buildResult.guidanceSteps && buildResult.guidanceSteps.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {buildResult.guidanceSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {buildLogs.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
              <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 text-[11px] font-medium text-slate-700">
                펌웨어 빌드 실행 로그 (PlatformIO)
              </div>
              <pre className="p-2.5 text-[11px] font-mono text-slate-800 bg-slate-950/5 max-h-44 overflow-y-auto whitespace-pre-wrap break-all">
                {buildLogs.join('\n')}
              </pre>
            </div>
          )}
        </div>

        {/* Firmware File Selection */}
        <div className="p-4 border border-slate-200 rounded-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                펌웨어 파일 선택 (.rmcfw.json 패키지 또는 .bin 이미지)
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                PlatformIO 빌드 폴더(<span className="font-mono">firmware/.pio/build/&lt;env&gt;/</span>)의{' '}
                <span className="font-mono">firmware.bin</span>을 선택하면 같은 폴더의 부트로더/파티션 이미지를 자동으로 함께 검사합니다.
              </div>
            </div>

            <button
              type="button"
              disabled={!isElectron || flashing || building}
              onClick={handleBrowseFirmware}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>펌웨어 파일 찾아보기</span>
            </button>
          </div>

          {/* Selected / Required Image Table */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 font-medium">이미지 역할</th>
                  <th className="py-2 px-3 font-medium">플래시 주소</th>
                  <th className="py-2 px-3 font-medium">선택된 파일 / 무결성</th>
                  <th className="py-2 px-3 font-medium text-right">개별 선택</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {IMAGE_ROLES_ORDER.filter(
                  (role) =>
                    installMode === 'INITIAL_INSTALL' ||
                    role === 'app' ||
                    selection?.images.some((i) => i.role === role)
                ).map((role) => {
                  const img = validationReport?.images.find((i) => i.role === role) ??
                    selection?.images.find((i) => i.role === role);
                  const required =
                    role === 'app' ||
                    (installMode === 'INITIAL_INSTALL' &&
                      (role === 'bootloader' || role === 'partitions'));

                  return (
                    <tr key={role}>
                      <td className="py-2 px-3 font-medium text-slate-800">
                        {getRoleLabelKo(role)}
                        {required && <span className="ml-1 text-red-600">*</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">
                        {img?.offset ?? JC3636W518C_TARGET.offsets[role]}
                      </td>
                      <td className="py-2 px-3">
                        {img ? (
                          <div className="space-y-0.5">
                            <div className="font-mono text-slate-900 flex items-center gap-1.5">
                              <FileCheck2
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  img.valid ? 'text-green-700' : 'text-red-600'
                                }`}
                              />
                              <span>{img.fileName}</span>
                              {img.sizeBytes !== undefined && (
                                <span className="text-slate-500">
                                  ({Math.round(img.sizeBytes / 1024)} KB)
                                </span>
                              )}
                            </div>
                            {img.headerNote && (
                              <div className="text-[11px] text-slate-500">{img.headerNote}</div>
                            )}
                            {img.sha256 && (
                              <div className="text-[11px] font-mono text-slate-400 truncate max-w-md">
                                SHA-256: {img.sha256.slice(0, 20)}…
                              </div>
                            )}
                            {img.error && (
                              <div className="text-[11px] text-red-700">{img.error}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">
                            {required ? '필수 이미지 미선택' : '선택 안 됨 (옵션)'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          disabled={!isElectron || flashing}
                          onClick={() => handleBrowseSingleRole(role)}
                          className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                        >
                          .bin 선택
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Validation Feedback */}
          {validationReport && validationReport.warnings.length > 0 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 space-y-1">
              {validationReport.warnings.map((w, idx) => (
                <div key={idx}>안내: {w}</div>
              ))}
            </div>
          )}

          {validationReport && validationReport.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 space-y-1">
              {validationReport.errors.map((err, idx) => (
                <div key={idx}>오류: {err}</div>
              ))}
            </div>
          )}
        </div>

        {/* Pre-flash User Confirmation & Start/Cancel CTA */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
          <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={userConfirmed}
              disabled={!isElectron || flashing || !validationReport?.valid}
              onChange={(e) => setUserConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600"
            />
            <span className="leading-relaxed">
              <span className="font-semibold">
                {installMode === 'INITIAL_INSTALL'
                  ? '최초 펌웨어 설치 확인: '
                  : '기존 펌웨어 업데이트 확인: '}
              </span>
              {snapshot.deviceInfo
                ? `현재 버전(${snapshot.deviceInfo.firmwareVersion}) → 새 펌웨어`
                : '선택한 ESP32-S3 장치'}
              에 기록하는 동안 USB 케이블을 분리하지 않으며, 설치 중 일반 매크로 실행 및 설정 전송이 일시 중지됨을 확인합니다.
              (PC 프로필 및 매크로 설정은 삭제되지 않습니다.)
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              {validationReport?.preservesLittleFs !== false
                ? '파티션 보호: 전체 플래시 삭제(erase_flash)를 실행하지 않으며 0x610000 LittleFS를 보존합니다.'
                : '주의: 파티션 테이블(partitions.bin)을 함께 기록합니다. 재부팅 후 기기 설정 저장 여부를 확인하세요.'}
            </div>

            <div className="flex items-center gap-2">
              {flashing && (
                <button
                  type="button"
                  onClick={handleCancelFlash}
                  className="px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  설치 중단
                </button>
              )}

              <button
                type="button"
                disabled={!canStartFlash}
                onClick={handleStartFlash}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <HardDriveDownload className="w-3.5 h-3.5" />
                <span>
                  {flashing
                    ? '펌웨어 설치 중...'
                    : installMode === 'INITIAL_INSTALL'
                      ? '최초 펌웨어 설치 시작'
                      : '펌웨어 업데이트 시작'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Real Progress Bar (shown only when real Electron flashing starts/ran) */}
        {progress && (
          <div className="p-4 border border-slate-200 rounded-md space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-900">{progress.message}</span>
              <span className="font-mono tabular-nums font-semibold text-blue-700">
                {progress.percent}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  progress.stage === 'FAILED'
                    ? 'bg-red-600'
                    : progress.stage === 'COMPLETED'
                      ? 'bg-green-600'
                      : 'bg-blue-600'
                }`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Flash Result & Recovery / Post-Flash Config Re-apply */}
        {flashResult && (
          <div
            className={`p-4 rounded-md border text-xs space-y-2.5 ${
              flashResult.ok
                ? 'bg-green-50 border-green-200 text-green-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5">
              {flashResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-green-700" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-red-600" />
              )}
              <span>
                {flashResult.ok
                  ? `펌웨어 설치 완료 (${(flashResult.durationMs / 1000).toFixed(1)}초)`
                  : `펌웨어 설치 실패 (${flashResult.errorCode ?? 'ERROR'})`}
              </span>
            </div>

            {flashResult.ok && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] bg-white/80 p-2.5 rounded border border-green-200">
                <div>
                  이전 버전: {flashResult.previousFirmwareVersion ?? '미확인'}
                </div>
                <div>
                  현재 버전: {flashResult.newFirmwareVersion ?? '수동 연결 후 확인'}
                </div>
                <div>
                  재연결 포트: {flashResult.reconnectedPortPath ?? '수동 확인 필요'}
                </div>
              </div>
            )}

            {flashResult.errorMessage && (
              <div className="leading-relaxed">{flashResult.errorMessage}</div>
            )}

            {flashResult.recoverySteps && flashResult.recoverySteps.length > 0 && (
              <div className="space-y-1">
                <div className="font-semibold">복구 및 다음 조치 안내:</div>
                <ol className="list-decimal list-inside space-y-0.5">
                  {flashResult.recoverySteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {!flashResult.ok && flashResult.errorCode === 'BOOTLOADER_CONNECT_FAILED' && (
              <div className="pt-2 border-t border-red-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-red-800">
                    보드에서 BOOT+RESET을 누른 뒤 아래 버튼을 누르면 새 다운로드 포트를 다시 찾고 안전 설정을 자동 적용합니다.
                  </span>
                  <button
                    type="button"
                    disabled={flashing}
                    onClick={handlePrepareManualBootloaderRecovery}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-900 bg-white border border-red-300 rounded hover:bg-red-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>다운로드 포트 재검색 및 수동 복구 모드 설정</span>
                  </button>
                </div>
                {recoveryNotice && (
                  <div className="p-2 rounded bg-white/90 border border-red-200 text-[11px] text-slate-800">
                    {recoveryNotice}
                  </div>
                )}
              </div>
            )}

            {/* Offer confirmed PC config re-apply if device LittleFS has no stored config after flash */}
            {flashResult.ok &&
              flashResult.deviceReconnected &&
              flashResult.deviceHasStoredConfig === false && (
                <div className="pt-2 border-t border-green-200 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    설치 후 기기 내부 설정이 초기화되어 있습니다. 기존 PC 설정을 덮어쓰기 전에 사용자 확인 후 적용할 수 있습니다.
                  </span>
                  <button
                    type="button"
                    disabled={reapplyingConfig}
                    onClick={handleReapplyConfig}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{reapplyingConfig ? '적용 중...' : '기존 PC 설정 기기에 다시 적용'}</span>
                  </button>
                </div>
              )}

            {reapplyMessage && (
              <div className="font-medium text-slate-900">{reapplyMessage}</div>
            )}
          </div>
        )}

        {/* Flashing Raw Tool Logs */}
        {liveLogs.length > 0 && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-700">
              플래싱 도구 실행 로그 (esptool)
            </div>
            <pre className="p-3 text-[11px] font-mono text-slate-800 bg-slate-950/5 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {liveLogs.join('\n')}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
