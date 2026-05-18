/**
 * FileEditor — Monaco 에디터를 이용한 파일 내용 편집 컴포넌트.
 *
 * 기능:
 * - InspectorView에서 선택한 에이전트 설정/스킬 파일 내용을 표시
 * - Monaco 에디터로 구문 강조, 라인 넘버, 자동 레이아웃 지원
 * - 변경 사항 감지 및 되돌리기, 저장 UI 제공
 * - 파일이 너무 큰 경우 truncated 경고 표시
 *
 * Props:
 * - file (AgentInspectorFileModel): 편집할 파일 데이터 (name, path, content, truncated)
 * - onContentChange: 에디터 내용 변경 콜백
 * - onSave/saving/hasChanges/successMsg/error: 저장 상태 및 제어
 * - onRevert: 변경 사항 되돌리기
 *
 * 앱 내 배치:
 * - InspectorView 메인 영역 우측 패널에서 사용
 * - InspectorFileBrowser에서 파일 선택 시 활성화
 */
import React, { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { AgentInspectorFileModel } from '../../../../types/ipc-contract';
import { detectLanguage, getFileIcon } from '../../../utils/inspector';

/**
 * FileEditor — Monaco 에디터를 이용한 파일 내용 편집 컴포넌트.
 * 구문 강조, 변경 감지, 저장/되돌리기 UI 제공.
 * @returns 파일 에디터 JSX 요소
 */
export const FileEditor: React.FC<{
  file: AgentInspectorFileModel;
  onContentChange: (content: string) => void;
  onSave: () => void;
  saving: boolean;
  hasChanges: boolean;
  successMsg: string | null;
  error: string | null;
  onRevert: () => void;
}> = ({ file, onContentChange, onSave, saving, hasChanges, successMsg, error, onRevert }) => {
  const lang = detectLanguage(file.name);

  return (
    <div className="inspector-file-editor">
      <div className="inspector-file-editor__toolbar">
        <div className="inspector-file-editor__toolbar-left">
          <span className="inspector-file-editor__file-icon">{getFileIcon(file.name)}</span>
          <span className="inspector-file-editor__file-name">{file.name}</span>
          <span className="inspector-file-editor__file-lang">{lang}</span>
          <span className="inspector-file-editor__file-path" title={file.path}>{file.path}</span>
        </div>
        <div className="inspector-file-editor__toolbar-right">
          {successMsg && <span className="inspector-editor__success">{successMsg}</span>}
          {error && <span className="inspector-file-editor__error">{error}</span>}
          {hasChanges && (
            <button className="inspector-file-editor__btn inspector-file-editor__btn--revert" onClick={onRevert}>
              되돌리기
            </button>
          )}
          <button
            className="inspector-file-editor__btn inspector-file-editor__btn--save"
            disabled={!hasChanges || saving}
            onClick={onSave}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
      <div className="inspector-file-editor__body">
        <Editor
          height="100%"
          language={lang}
          value={file.content}
          onChange={v => onContentChange(v ?? '')}
          theme="app-theme"
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            tabSize: 2,
            automaticLayout: true,
            wordWrap: 'on',
            padding: { top: 12 },
            renderWhitespace: 'selection',
          }}
        />
        {file.truncated && (
          <div className="inspector-file-editor__truncated-warning">
            파일이 너무 큽니다 — 처음 {file.content.length}자만 표시합니다
          </div>
        )}
      </div>
    </div>
  );
};
