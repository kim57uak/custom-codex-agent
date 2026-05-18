/**
 * SkillEditor — 스킬(Skill Definition Markdown) 편집 컴포넌트.
 *
 * 기능:
 * - 선택된 스킬의 Markdown 내용을 읽어와 텍스트 에디터로 표시
 * - 내용 수정, 저장, 되돌리기 기능
 * - 스킬 상태(설치/활성/비활성) 및 경로 정보 헤더 표시
 *
 * Props:
 * - skill (SkillModel): 편집할 스킬 모델 (name, path, installed, enabled)
 *
 * State:
 * - content/originalContent: 편집 내용 및 변경 감지
 * - saving/error/successMsg: 저장 상태 관리
 *
 * 앱 내 배치:
 * - InspectorView에서 selectedSkill이 있을 때 메인 영역에 렌더링
 * - InspectorSidebar의 Skills 탭에서 스킬 선택 시 활성화
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { SkillModel } from '../../../../types/ipc-contract';
import { ipcInvoke } from '../../../utils/ipc';

/**
 * SkillEditor — 스킬(Skill Definition Markdown) 편집 컴포넌트.
 * Markdown 내용 읽기, 편집, 저장, 되돌리기 기능 제공.
 * @returns 스킬 에디터 JSX 요소
 */
export const SkillEditor: React.FC<{ skill: SkillModel }> = ({ skill }) => {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadContent();
  }, [skill.path]);

  /** 스킬 파일 내용 로드 */
  const loadContent = async () => {
    setLoading(true);
    setError(null);
    const result = await ipcInvoke<{ content: string }>('file:read', skill.path);
    if (result) {
      setContent(result.content);
      setOriginalContent(result.content);
    } else {
      setError('Could not read skill file');
    }
    setLoading(false);
  };

  /** 스킬 내용 저장 */
  const handleSave = useCallback(async () => {
    if (!content) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    const result = await ipcInvoke('inspector:save-file', { path: skill.path, content });
    if (result) {
      setOriginalContent(content);
      setSuccessMsg('저장됨');
      setTimeout(() => setSuccessMsg(null), 2000);
    } else {
      setError('저장 실패');
    }
    setSaving(false);
  }, [content, skill.path]);

  const hasChanges = content !== null && originalContent !== null && content !== originalContent;

  return (
    <div className="inspector-editor">
      <div className="inspector-editor__hero" style={{ '--hero-accent': 'var(--status-success)' } as React.CSSProperties}>
        <span className="inspector-editor__hero-badge" style={{ background: 'var(--status-success)' }}>S</span>
        <div>
          <h2 className="inspector-editor__hero-title">{skill.name}</h2>
          <p className="inspector-editor__hero-sub">
            {skill.installed ? (skill.enabled ? '활성' : '비활성') : '미설치'}
            {' · '}{skill.path}
          </p>
        </div>
      </div>

      <div className="inspector-editor__body">
        {loading && (
          <div className="inspector-editor__loading">
            <div className="spinner" />
            <span>Loading skill content...</span>
          </div>
        )}

        {error && (
          <div className="inspector-editor__error">
            <span className="codicon codicon-error" />
            <span>{error}</span>
          </div>
        )}

        {content !== null && !loading && (
          <>
            <div className="inspector-editor__toolbar">
              <span className="inspector-editor__toolbar-label">Skill Definition (Markdown)</span>
              <div className="inspector-editor__toolbar-actions">
                {successMsg && <span className="inspector-editor__success">{successMsg}</span>}
                {hasChanges && (
                  <button className="inspector-editor__btn inspector-editor__btn--revert" onClick={() => setContent(originalContent)}>
                    되돌리기
                  </button>
                )}
                <button
                  className="inspector-editor__btn inspector-editor__btn--save"
                  disabled={!hasChanges || saving}
                  onClick={handleSave}
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
            <div className="inspector-editor__code-area">
              <textarea
                className="inspector-editor__code-input"
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
              />
            </div>
          </>
        )}

        {!content && !loading && !error && (
          <div className="inspector-editor__empty">
            <p>No content for this skill.</p>
          </div>
        )}
      </div>
    </div>
  );
};
