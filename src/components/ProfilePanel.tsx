import React, { useState } from 'react';
import { Check, Copy, Edit3, Plus, Trash2 } from 'lucide-react';
import { LayoutPreset, ProfileDefinition } from '../shared/types';

interface ProfilePanelProps {
  profiles: ProfileDefinition[];
  activeProfileId: string;
  onCreateProfile: (name: string, layout: LayoutPreset, description: string) => void;
  onRenameProfile: (profileId: string, newName: string, newDescription: string) => void;
  onDuplicateProfile: (profileId: string) => void;
  onDeleteProfile: (profileId: string) => { ok: boolean; error?: string };
  onSwitchProfile: (profileId: string) => void;
}

const LAYOUT_LABEL: Record<LayoutPreset, string> = {
  [LayoutPreset.RADIAL_4_CENTER]: '4방향 원형 (4버튼)',
  [LayoutPreset.RADIAL_6_CENTER]: '6방향 원형 (6버튼)',
  [LayoutPreset.RADIAL_8_CENTER]: '8방향 원형 (8버튼)',
};

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  profiles,
  activeProfileId,
  onCreateProfile,
  onRenameProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onSwitchProfile,
}) => {
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLayout, setNewLayout] = useState<LayoutPreset>(LayoutPreset.RADIAL_6_CENTER);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    onCreateProfile(newName || `프로필 ${profiles.length + 1}`, newLayout, newDesc);
    setNewName('');
    setNewDesc('');
  };

  const startEdit = (profile: ProfileDefinition) => {
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditDesc(profile.description);
    setError(null);
  };

  const commitEdit = () => {
    if (editingId && editName.trim()) {
      onRenameProfile(editingId, editName, editDesc);
    }
    setEditingId(null);
  };

  const handleDelete = (profileId: string) => {
    const res = onDeleteProfile(profileId);
    if (!res.ok) {
      setError(res.error ?? '삭제할 수 없습니다.');
    } else {
      setError(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">프로필 관리</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          작업 환경별로 버튼 배치와 매크로 구성을 분리하여 관리하고 기기에 전환 적용할 수 있습니다.
        </p>
      </div>

      {/* Create Profile Form */}
      <form
        onSubmit={handleCreate}
        className="p-4 bg-white border border-slate-200 rounded-md grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
      >
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">새 프로필 이름</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="예: 영상 편집, 회의 제어"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">원형 레이아웃</label>
          <select
            value={newLayout}
            onChange={(e) => setNewLayout(e.target.value as LayoutPreset)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
          >
            {Object.values(LayoutPreset).map((lp) => (
              <option key={lp} value={lp}>
                {LAYOUT_LABEL[lp]}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">설명 (선택)</label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="용도 메모"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>프로필 생성</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Profile List Table */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">저장된 프로필 목록</h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">총 {profiles.length}개</span>
        </div>

        <div className="divide-y divide-slate-200">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const assignedCount = profile.buttons.filter((b) => Boolean(b.macroId)).length;
            const isEditing = editingId === profile.id;

            return (
              <div
                key={profile.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-4 ${
                  isActive ? 'bg-blue-50/40' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md"
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="설명"
                        className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md flex-1 min-w-[160px]"
                      />
                      <button
                        type="button"
                        onClick={commitEdit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>확인</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-slate-900">{profile.name}</span>
                        {isActive && (
                          <span className="text-xs font-medium text-blue-700">· 현재 활성</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-2">
                        <span>{LAYOUT_LABEL[profile.layout]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          매크로 연결 {assignedCount}/{profile.buttons.length}
                        </span>
                        {profile.description && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{profile.description}</span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => onSwitchProfile(profile.id)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0"
                    >
                      활성 전환
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(profile)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>이름 변경</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateProfile(profile.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>복제</span>
                  </button>
                  <button
                    type="button"
                    disabled={profiles.length <= 1}
                    onClick={() => handleDelete(profile.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 disabled:opacity-35 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>삭제</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
