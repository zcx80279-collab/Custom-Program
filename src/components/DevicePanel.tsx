import React, { useState } from 'react';
import {
  Plug,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Unplug,
} from 'lucide-react';
import { ConnectionState } from '../shared/types';
import { DeviceSnapshot } from '../modules/DeviceManager';
import { FirmwareManagementSection } from './FirmwareManagementSection';

interface DevicePanelProps {
  snapshot: DeviceSnapshot;
  onScanPorts: () => Promise<void>;
  onConnect: (portPath?: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onTestConnection: () => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  onToggleAutoReconnect: (enabled: boolean) => void;
  onRequestResetModal: () => void;
  onFlashingStateChange: (active: boolean) => void;
  onPostFlashReconnect: (reconnectedPortPath?: string) => Promise<void>;
  onApplyPcConfigToDevice: () => Promise<{ ok: boolean; error?: string }>;
  onLogFirmwareEvent: (level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: string) => void;
}

const CONNECTION_LABELS: Record<ConnectionState, { text: string; colorClass: string }> = {
  [ConnectionState.DISCONNECTED]: { text: '미연결 (실제 기기 없음)', colorClass: 'text-slate-600' },
  [ConnectionState.SCANNING]: { text: 'USB 포트 검색 중', colorClass: 'text-blue-700' },
  [ConnectionState.CONNECTING]: { text: '핸드셰이크 연결 중', colorClass: 'text-blue-700' },
  [ConnectionState.CONNECTED]: { text: '실제 USB 기기 연결됨', colorClass: 'text-green-700' },
  [ConnectionState.RECONNECTING]: { text: 'USB 분리 감지 · 자동 재연결 대기', colorClass: 'text-amber-700' },
  [ConnectionState.ERROR]: { text: 'USB 통신 오류', colorClass: 'text-red-700' },
};

export const DevicePanel: React.FC<DevicePanelProps> = ({
  snapshot,
  onScanPorts,
  onConnect,
  onDisconnect,
  onTestConnection,
  onToggleAutoReconnect,
  onRequestResetModal,
  onFlashingStateChange,
  onPostFlashReconnect,
  onApplyPcConfigToDevice,
  onLogFirmwareEvent,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isConnected = snapshot.connectionState === ConnectionState.CONNECTED;
  const isFlashing = snapshot.isFlashing;
  const statusMeta = CONNECTION_LABELS[snapshot.connectionState];

  const handleTest = async () => {
    setBusy(true);
    setTestResult(null);
    const res = await onTestConnection();
    setTestResult(
      res.ok
        ? `연결 테스트 성공 (HELLO 왕복 ${res.latencyMs ?? 0}ms)`
        : `연결 테스트 실패: ${res.error ?? '응답 없음'}`
    );
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">기기 관리 (USB 연결)</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            대상 하드웨어: Guition JC3636W518C (ESP32-S3R8 · 16MB Flash · 8MB PSRAM · 360×360)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isFlashing}
            onClick={onScanPorts}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Search className="w-4 h-4" />
            <span>USB 장치 검색</span>
          </button>

          {isConnected ? (
            <button
              type="button"
              disabled={isFlashing}
              onClick={onDisconnect}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Unplug className="w-4 h-4" />
              <span>연결 해제</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isFlashing}
              onClick={() => onConnect(selectedPort || undefined)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Plug className="w-4 h-4" />
              <span>
                {snapshot.runtimeTransport === 'WEB_SERIAL' ? 'USB 포트 선택 및 연결' : 'USB 연결'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Honest runtime transport notice */}
      {snapshot.runtimeTransport !== 'ELECTRON_IPC' && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-700">
          <p className="font-medium text-slate-900">
            현재 실행 환경:{' '}
            {snapshot.runtimeTransport === 'WEB_SERIAL'
              ? '브라우저 미리보기 (Chromium Web Serial API 지원)'
              : '브라우저 미리보기 (USB 시리얼 API 비활성 환경)'}
          </p>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            실제 기기가 연결되지 않은 상태에서는 가상 기기를 연결됨으로 허위 표시하지 않습니다.
            Windows 데스크톱 전체 기능(COM 포트 자동 탐색, 백그라운드 재연결, PC 키 입력 자동화)은{' '}
            <span className="font-mono">electron/</span> 빌드 환경에서 실행됩니다.
          </p>
        </div>
      )}

      {/* Connection status grid (single-elevation hairline table) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">연결 상태</div>
          <div className={`mt-1 text-sm font-semibold ${statusMeta.colorClass}`}>{statusMeta.text}</div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">연결된 기기 이름</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {snapshot.deviceInfo ? snapshot.deviceInfo.deviceName : '연결된 기기 없음'}
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">펌웨어 / 프로토콜 버전</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900">
            {snapshot.deviceInfo
              ? `${snapshot.deviceInfo.firmwareVersion} · v${snapshot.deviceInfo.protocolVersion}`
              : '-'}
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">USB 동작 모드</div>
          <div className="mt-1 text-sm font-mono font-medium text-slate-900">
            {snapshot.deviceInfo ? snapshot.deviceInfo.usbMode : '-'}
          </div>
        </div>
      </div>

      {/* Error banner if present */}
      {snapshot.lastError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5 text-sm text-red-800">
          <ShieldAlert className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">통신 오류: </span>
            <span>{snapshot.lastError}</span>
          </div>
        </div>
      )}

      {/* Detected USB ports list */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">감지된 USB 시리얼 포트</h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            총 {snapshot.ports.length}개 · 대상 VID 0x303A (Espressif ESP32-S3)
          </span>
        </div>

        {snapshot.ports.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            감지된 USB 포트가 없습니다. Guition JC3636W518C 보드를 USB-C 케이블로 연결한 뒤
            &ldquo;USB 장치 검색&rdquo;을 눌러 주세요.
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-medium">선택</th>
                <th className="py-2.5 px-4 font-medium">포트 경로</th>
                <th className="py-2.5 px-4 font-medium">장치 설명</th>
                <th className="py-2.5 px-4 font-medium">VID / PID</th>
                <th className="py-2.5 px-4 font-medium text-right">지원 여부</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {snapshot.ports.map((port) => (
                <tr
                  key={port.path}
                  onClick={() => setSelectedPort(port.path)}
                  className={`cursor-pointer hover:bg-slate-50 ${
                    selectedPort === port.path ? 'bg-blue-50/60' : ''
                  }`}
                >
                  <td className="py-2.5 px-4">
                    <input
                      type="radio"
                      name="usb-port"
                      checked={selectedPort === port.path}
                      onChange={() => setSelectedPort(port.path)}
                    />
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-900">{port.path}</td>
                  <td className="py-2.5 px-4 text-slate-700">{port.friendlyName || port.manufacturer || '-'}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600">
                    {port.vendorId ?? '----'}:{port.productId ?? '----'}
                  </td>
                  <td className="py-2.5 px-4 text-right text-xs font-medium">
                    {port.isSupportedTarget ? (
                      <span className="text-green-700">지원 대상</span>
                    ) : (
                      <span className="text-slate-500">일반 시리얼</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Controls: Auto-reconnect, Test Connection, Device Reset */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-md space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">연결 유지 및 통신 테스트</h3>

          <label className="flex items-center justify-between text-sm text-slate-700 cursor-pointer">
            <span>USB 분리 후 자동 재연결 시도 (3초 주기)</span>
            <input
              type="checkbox"
              checked={snapshot.autoReconnect}
              onChange={(e) => onToggleAutoReconnect(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
          </label>

          <div className="pt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isConnected || busy || isFlashing}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <PlugZap className="w-4 h-4" />
              <span>연결 테스트 (HELLO)</span>
            </button>

            <button
              type="button"
              disabled={busy || isFlashing || !snapshot.selectedPortPath}
              onClick={() => onConnect(snapshot.selectedPortPath || undefined)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
              <span>재연결</span>
            </button>
          </div>

          {testResult && (
            <p className="text-xs font-mono text-slate-700 pt-1">{testResult}</p>
          )}
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-md space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">기기 설정 초기화 및 복구</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            기기에 적용된 설정에 문제가 발생하면 기기 내부 설정 데이터만 삭제하고 PC 원본 설정을 다시
            전송할 수 있습니다. 펌웨어 및 PC 원본 설정은 유지됩니다.
          </p>
          <div className="pt-1">
            <button
              type="button"
              disabled={!isConnected || isFlashing}
              onClick={onRequestResetModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              <span>기기 설정 초기화</span>
            </button>
          </div>
        </div>
      </div>

      {/* Firmware Management (ESP32-S3 Initial Install & Update) */}
      <FirmwareManagementSection
        snapshot={snapshot}
        selectedPortFromDevicePanel={selectedPort}
        onSelectPortFromFirmware={(port) => setSelectedPort(port)}
        onScanPorts={onScanPorts}
        onFlashingStateChange={onFlashingStateChange}
        onPostFlashReconnect={onPostFlashReconnect}
        onApplyPcConfigToDevice={onApplyPcConfigToDevice}
        onLogFirmwareEvent={onLogFirmwareEvent}
      />

      {/* Connected Hardware Details */}
      {snapshot.deviceInfo && (
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">연결된 기기 상세 정보</h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-6 text-xs">
            <div>
              <dt className="text-slate-500">보드 모델</dt>
              <dd className="mt-0.5 font-mono text-slate-900">{snapshot.deviceInfo.boardModel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">MCU</dt>
              <dd className="mt-0.5 font-mono text-slate-900">{snapshot.deviceInfo.mcu}</dd>
            </div>
            <div>
              <dt className="text-slate-500">디스플레이</dt>
              <dd className="mt-0.5 font-mono text-slate-900">{snapshot.deviceInfo.displayResolution}</dd>
            </div>
            <div>
              <dt className="text-slate-500">USB HID 지원</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {snapshot.deviceInfo.hidSupported ? '활성화됨' : '미활성 (PC 실행 모드 사용)'}
              </dd>
            </div>
            {snapshot.deviceStatus && (
              <>
                <div>
                  <dt className="text-slate-500">디스플레이 / 터치 상태</dt>
                  <dd className="mt-0.5 font-mono text-slate-900">
                    DISP:{snapshot.deviceStatus.displayReady ? 'OK' : 'UNVERIFIED'} / TOUCH:
                    {snapshot.deviceStatus.touchReady ? 'OK' : 'UNVERIFIED'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">가용 Heap / PSRAM</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                    {Math.round(snapshot.deviceStatus.freeHeapBytes / 1024)}KB /{' '}
                    {Math.round(snapshot.deviceStatus.freePsramBytes / 1024)}KB
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">기기 저장 설정</dt>
                  <dd className="mt-0.5 font-mono text-slate-900">
                    {snapshot.deviceStatus.hasStoredConfig
                      ? `${snapshot.deviceStatus.activeProfileId} (v${snapshot.deviceStatus.configSchemaVersion})`
                      : '저장된 설정 없음'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">가동 시간</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                    {Math.floor(snapshot.deviceStatus.uptimeMs / 1000)}초
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};
