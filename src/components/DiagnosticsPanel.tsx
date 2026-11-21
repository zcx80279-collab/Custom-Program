import React, { useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { DiagnosticLogEntry, LastCommResult, LogLevel } from '../shared/types';
import { DeviceSnapshot } from '../modules/DeviceManager';

interface DiagnosticsPanelProps {
  snapshot: DeviceSnapshot;
  lastComm: LastCommResult;
  lastError: string | null;
  logs: DiagnosticLogEntry[];
  onClearLogs: () => void;
  onExportReport: () => void;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  [LogLevel.INFO]: 'text-slate-600',
  [LogLevel.WARN]: 'text-amber-700',
  [LogLevel.ERROR]: 'text-red-700',
  [LogLevel.TX]: 'text-blue-700',
  [LogLevel.RX]: 'text-green-700',
};

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  snapshot,
  lastComm,
  lastError,
  logs,
  onClearLogs,
  onExportReport,
}) => {
  const [levelFilter, setLevelFilter] = useState<'ALL' | LogLevel>('ALL');

  const filteredLogs = useMemo(() => {
    if (levelFilter === 'ALL') return logs;
    return logs.filter((l) => l.level === levelFilter);
  }, [logs, levelFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">기기 진단 및 통신 로그</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            USB 연결 상태, 프로토콜 V2 송수신 결과, 펌웨어 버전 및 오류 이력을 확인합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExportReport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>진단 리포트 내보내기</span>
          </button>
          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-4 h-4" />
            <span>로그 비우기</span>
          </button>
        </div>
      </div>

      {/* Telemetry summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">USB 연결 상태 / 계층</div>
          <div className="mt-1 text-sm font-mono font-medium text-slate-900">
            {snapshot.connectionState} · {snapshot.runtimeTransport}
          </div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">마지막 통신 결과</div>
          <div className="mt-1 text-sm text-slate-900 truncate" title={lastComm.summary}>
            {lastComm.summary}
          </div>
          {lastComm.latencyMs !== null && (
            <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
              명령: {lastComm.command} · {lastComm.latencyMs}ms
            </div>
          )}
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">펌웨어 버전 / 실물 검증 상태</div>
          <div className="mt-1 text-sm font-mono text-slate-900">
            {snapshot.deviceInfo
              ? `${snapshot.deviceInfo.firmwareVersion} (${
                  snapshot.deviceInfo.hardwareVerified ? '검증됨' : '실물 미검증'
                })`
              : '기기 미연결'}
          </div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-md">
          <div className="text-xs text-slate-500">최근 오류 메시지</div>
          <div className="mt-1 text-sm text-slate-900 truncate" title={lastError ?? '없음'}>
            {lastError ? <span className="text-red-700">{lastError}</span> : '기록된 오류 없음'}
          </div>
        </div>
      </div>

      {/* Filter bar + Log Table */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">모듈 및 프로토콜 로그</h3>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['ALL', LogLevel.INFO, LogLevel.TX, LogLevel.RX, LogLevel.WARN, LogLevel.ERROR] as const).map(
              (lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevelFilter(lv)}
                  className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                    levelFilter === lv
                      ? 'bg-white text-slate-900 shadow-xs font-medium'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lv === 'ALL' ? '전체' : lv}
                </button>
              )
            )}
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">표시할 로그 항목이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="py-2 px-4 font-medium w-28">시각</th>
                  <th className="py-2 px-3 font-medium w-16">레벨</th>
                  <th className="py-2 px-3 font-medium w-36">모듈</th>
                  <th className="py-2 px-4 font-medium">내용</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                {filteredLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="py-2 px-4 tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleTimeString('ko-KR', { hour12: false })}
                    </td>
                    <td className={`py-2 px-3 font-semibold whitespace-nowrap ${LEVEL_COLOR[entry.level]}`}>
                      {entry.level}
                    </td>
                    <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{entry.source}</td>
                    <td className="py-2 px-4 font-sans text-slate-800">
                      <div>{entry.message}</div>
                      {entry.details && (
                        <div className="text-slate-500 font-mono mt-0.5 break-all">{entry.details}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
