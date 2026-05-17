import React, { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { AgentInspectorFileModel } from '../../../../types/ipc-contract';
import { detectLanguage, getFileIcon } from '../../../utils/inspector';

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
