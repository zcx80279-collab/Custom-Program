import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ResetConfirmModalProps {
  open: boolean;
  deviceName: string;
  isProcessing: boolean;
  onCancel: () => void;
  onConfirmReset: (resendAfterReset: boolean) => void;
}

export const ResetConfirmModal: React.FC<ResetConfirmModalProps> = ({
  open,
  deviceName,
  isProcessing,
  onCancel,
  onConfirmReset,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [resendAfterReset, setResendAfterReset] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <h2 id="reset-modal-title" className="text-base font-semibold text-slate-900">
              기기 설정 초기화 확인
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-600 leading-relaxed">
          연결된 기기(<span className="font-medium text-slate-900">{deviceName}</span>)에 저장된 매크로 및
          화면 설정 데이터를 초기화합니다.
        </p>

        <div className="mt-4 p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs text-slate-700">
          <p>• 기기 내부 설정 데이터(LittleFS/NVS)만 삭제되며, ESP32-S3 펌웨어는 삭제되지 않습니다.</p>
          <p>• PC 프로그램에 저장된 프로필 및 매크로 원본은 유지됩니다.</p>
          <p>• 초기화 실패 시 기기는 직전 정상 백업 설정을 유지하도록 설계되어 있습니다.</p>
        </div>

        <div className="mt-4 space-y-2.5">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            <span>위 내용을 확인했으며 기기 설정 초기화를 진행합니다.</span>
          </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={resendAfterReset}
              onChange={(e) => setResendAfterReset(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>초기화 완료 직후 현재 PC 설정을 기기로 자동 재전송</span>
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!acknowledged || isProcessing}
            onClick={() => onConfirmReset(resendAfterReset)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            {isProcessing ? '초기화 진행 중...' : '기기 설정 초기화 실행'}
          </button>
        </div>
      </div>
    </div>
  );
};
