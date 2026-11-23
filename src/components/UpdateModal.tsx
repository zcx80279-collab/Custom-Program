import React from 'react';
import { ArrowUpRight, Download, Sparkles, X } from 'lucide-react';
import { ReleaseInfo } from '../modules/UpdateManager';

interface UpdateModalProps {
  open: boolean;
  currentVersion: string;
  latestVersion: string;
  release?: ReleaseInfo;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  currentVersion,
  latestVersion,
  release,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">새로운 업데이트 안내</h3>
              <p className="text-xs text-slate-500">RoundMacroController V2 새 버전이 배포되었습니다.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between p-3.5 bg-blue-50 border border-blue-100 rounded-md text-xs">
            <div>
              <span className="text-slate-500">현재 버전:</span> <span className="font-mono font-medium text-slate-800">v{currentVersion}</span>
            </div>
            <div className="text-blue-700 font-bold">→</div>
            <div>
              <span className="text-slate-500">최신 버전:</span> <span className="font-mono font-bold text-blue-800">{release?.tagName ?? `v${latestVersion}`}</span>
            </div>
          </div>

          {release && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>{release.name}</span>
                {release.publishedAt && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    {new Date(release.publishedAt).toLocaleDateString('ko-KR')}
                  </span>
                )}
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                {release.body}
              </div>
            </div>
          )}

          <div className="text-xs text-slate-500 leading-relaxed">
            Windows 설치형 앱(.exe)을 사용 중이신 경우, GitHub 릴리스 페이지에서 최신 인스톨러를 다운로드하여 덮어쓰기 설치하시면 됩니다.
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors"
          >
            닫기
          </button>
          <a
            href={release?.htmlUrl ?? 'https://github.com/zcx80279/RoundMacroController-V2/releases/latest'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>GitHub 릴리스 페이지로 이동</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-70" />
          </a>
        </div>
      </div>
    </div>
  );
};
