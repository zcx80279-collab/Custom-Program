import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  RotateCcw,
  Save,
  Send,
  Upload,
} from 'lucide-react';
import { AppConfig } from '../shared/types';
import { DisplayManager } from '../modules/DisplayManager';

interface ConfigPanelProps {
  config: AppConfig;
  storageSource: 'ELECTRON_FS' | 'LOCAL_STORAGE' | 'DEFAULT';
  isDeviceConnected: boolean;
  displayManager: DisplayManager;
  hasUnsavedChanges: boolean;
  onSavePcConfig: () => Promise<{ ok: boolean; error?: string }>;
  onReloadPcConfig: () => Promise<void>;
  onExportJson: () => void;
  onImportJsonText: (raw: string) => { ok: boolean; error?: string };
  onApplyToDevice: () => Promise<{ ok: boolean; error?: string }>;
  onRequestResetDevice: () => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  config,
  storageSource,
  isDeviceConnected,
  displayManager,
  hasUnsavedChanges,
  onSavePcConfig,
  onReloadPcConfig,
  onExportJson,
  onImportJsonText,
  onApplyToDevice,
  onRequestResetDevice,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const compiled = useMemo(() => displayManager.compileForDevice(config), [config, displayManager]);

  const handleSave = async () => {
    setBusy(true);
    const res = await onSavePcConfig();
    setStatusMessage(
      res.ok
        ? { type: 'ok', text: 'PC 설정 원본을 정상 저장했습니다.' }
        : { type: 'err', text: res.error ?? 'PC 설정 저장에 실패했습니다.' }
    );
    setBusy(false);
  };

  const handleApply = async () => {
    setBusy(true);
    const res = await onApplyToDevice();
    setStatusMessage(
      res.ok
        ? { type: 'ok', text: '활성 프로필 설정을 연결된 ESP32-S3 기기에 적용했습니다.' }
        : { type: 'err', text: res.error ?? '기기 적용에 실패했습니다.' }
    );
    setBusy(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const res = onImportJsonText(text);
      setStatusMessage(
        res.ok
          ? { type: 'ok', text: `설정 파일(${file.name})을 불러왔습니다. 'PC 설정 저장'으로 영구 반영하세요.` }
          : { type: 'err', text: res.error ?? '설정 파일 검증에 실패했습니다.' }
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">설정 관리 및 기기 적용</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          PC가 설정 원본을 보관하고, 원형 컨트롤러(ESP32-S3)에는 검증된 활성 프로필 설정을 전송하여 비휘발성 저장합니다.
        </p>
      </div>

      {/* Metadata overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">설정 스키마 버전 / 저장소</div>
          <div className="mt-1 text-sm font-mono font-medium text-slate-900">
            v{config.schemaVersion} · {storageSource}
          </div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">마지막 PC 저장 시각</div>
          <div className="mt-1 text-sm font-mono tabular-nums text-slate-900">
            {new Date(config.lastModifiedAt).toLocaleString('ko-KR')}
          </div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">마지막 기기 적용 시각</div>
          <div className="mt-1 text-sm font-mono tabular-nums text-slate-900">
            {config.lastAppliedToDeviceAt
              ? new Date(config.lastAppliedToDeviceAt).toLocaleString('ko-KR')
              : '적용 이력 없음'}
          </div>
        </div>
      </div>

      {/* Action Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PC Config Actions */}
        <div className="p-5 bg-white border border-slate-200 rounded-md space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">PC 설정 원본 관리</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              프로그램 재실행 후에도 프로필과 매크로 원본이 유지됩니다.
              {hasUnsavedChanges ? ' (저장되지 않은 변경 사항 있음)' : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>PC 설정 저장</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onReloadPcConfig}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              <span>저장된 설정 다시 불러오기</span>
            </button>
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExportJson}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON 파일로 내보내기</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>JSON 파일 가져오기</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Device Sync & Recovery Actions */}
        <div className="p-5 bg-white border border-slate-200 rounded-md space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">원형 컨트롤러 적용 및 초기화</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isDeviceConnected
                ? '실제 USB 기기가 연결되어 있어 SET_CONFIG / RESET_CONFIG 명령을 전송할 수 있습니다.'
                : '실제 USB 기기가 연결되어 있지 않습니다. 기기 관리 화면에서 USB 연결 후 적용해 주세요.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isDeviceConnected || !compiled.ok || busy}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>기기에 적용 (SET_CONFIG)</span>
            </button>

            <button
              type="button"
              disabled={!isDeviceConnected || !compiled.ok || busy}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <span>PC 설정 재전송</span>
            </button>

            <button
              type="button"
              disabled={!isDeviceConnected || busy}
              onClick={onRequestResetDevice}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              <span>기기 설정 초기화</span>
            </button>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-md border text-sm ${
            statusMessage.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Compiled ESP32-S3 Payload Inspector */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">ESP32-S3 전송 페이로드 미리보기 (SET_CONFIG)</h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {compiled.byteSize} bytes / 12288 bytes · {compiled.ok ? '유효함' : '크기 초과'}
          </span>
        </div>
        <pre className="p-4 text-xs font-mono text-slate-700 bg-slate-50 overflow-x-auto max-h-72">
          {compiled.payload ? JSON.stringify(compiled.payload, null, 2) : compiled.error}
        </pre>
      </div>
    </div>
  );
};
