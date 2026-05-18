/**
 * InspectorView — 에이전트 인스펙터 메인 뷰 컴포넌트.
 *
 * 기능:
 * - 선택된 에이전트/스킬의 상세 정보를 로드하여 표시
 * - Agent/Skill 파일 목록을 파일 브라우저로 보여주고 Monaco 에디터로 편집
 * - InspectorSidebar, InspectorFileBrowser, FileEditor, AgentEditor, SkillEditor 로 구성
 *
 * Props/State:
 * - selectedAgent/selectedSkill (Zustand): 현재 선택된 에이전트/스킬
 * - response (Zustand): 인스펙터 응답 데이터 (AgentInspectorResponse)
 * - selectedFilePath: 현재 편집 중인 파일 경로
 * - editContent/originalContent: 파일 편집 내용 및 변경 감지
 *
 * 앱 내 배치:
 * - ActivityBar의 'inspector' 뷰 ID와 연결된 메인 콘텐츠 영역
 * - WorkflowView 와 같은 레벨에서 라우팅되어 표시됨
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type { AgentConfig, SkillModel, AgentInspectorFileModel, AgentInspectorResponse } from '../../../types/ipc-contract';
import { useInspectorStore } from '../../stores/inspectorStore';
import { useUIStore } from '../../stores/uiStore';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
loader.config({ monaco });

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

/** Monaco 에디터 커스텀 테마(app-theme)를 CSS 변수 기반으로 정의 */
function ensureMonacoTheme() {
  try {
    const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const read = (key: string, fallback: string) => style?.getPropertyValue(key)?.trim() || fallback;
    monaco.editor.defineTheme('app-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': read('--bg-primary', '#1e1e2e'),
        'editor.foreground': read('--text-primary', '#d4d4d4'),
        'editor.lineHighlightBackground': read('--bg-secondary', '#2a2a3a'),
        'editor.selectionBackground': read('--selection-bg', '#3a3a5c'),
        'editor.inactiveSelectionBackground': read('--selection-bg', '#3a3a5c') + '80',
        'editorCursor.foreground': read('--text-primary', '#d4d4d4'),
        'editorLineNumber.foreground': read('--text-tertiary', '#6c7086'),
        'editorLineNumber.activeForeground': read('--text-primary', '#d4d4d4'),
        'editor.selectionHighlightBackground': 'rgba(255,255,255,0.05)',
        'editor.wordHighlightBackground': 'rgba(255,255,255,0.05)',
        'editorBracketMatch.background': 'rgba(255,255,255,0.05)',
        'editorBracketMatch.border': read('--border-primary', '#3a3a4a'),
      },
    });
  } catch {
    // Monaco default theme fallback
  }
}
try { ensureMonacoTheme(); } catch {}

import { ipcInvoke } from '../../utils/ipc';
import { getEngineMeta } from '../../utils/inspector';
import { InspectorSidebar } from './inspector/InspectorSidebar';
import { InspectorFileBrowser } from './inspector/InspectorFileBrowser';
import { FileEditor } from './inspector/FileEditor';
import { AgentEditor } from './inspector/AgentEditor';
import { SkillEditor } from './inspector/SkillEditor';

export { InspectorSidebar };

/**
 * InspectorView — 에이전트 인스펙터 메인 뷰 컴포넌트.
 * 에이전트/스킬 선택 시 파일 브라우저와 Monaco 에디터로 편집 환경 제공.
 * @returns 인스펙터 뷰 JSX 요소
 */
const InspectorView: React.FC = () => {
  const selectedAgent = useInspectorStore(s => s.selectedAgent);
  const selectedSkill = useInspectorStore(s => s.selectedSkill);
  const response = useInspectorStore(s => s.response);
  const loading = useInspectorStore(s => s.loading);
  const error = useInspectorStore(s => s.error);
  const setAgents = useInspectorStore(s => s.setAgents);
  const setSkills = useInspectorStore(s => s.setSkills);
  const setResponse = useInspectorStore(s => s.setResponse);
  const selectedEngine = useUIStore(s => s.selectedEngine);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [selectedEngine]);
  useEffect(() => { if (response) setSelectedFilePath(null); }, [response]);

  const effectiveAgent = selectedAgent ?? (response ? { id: response.agentName, name: response.agentName, engine: 'codex' as const } : null);
  const effectiveMeta = effectiveAgent ? getEngineMeta(effectiveAgent.engine) : undefined;

  /** 에이전트 목록 및 스킬 인벤토리 로드 */
  const loadData = async () => {
    const [agentList, inventory] = await Promise.all([
      ipcInvoke<AgentConfig[]>('agents:list'),
      ipcInvoke<{ skills: SkillModel[] }>('dashboard:inventory', selectedEngine),
    ]);
    if (agentList) setAgents(agentList);
    if (inventory?.skills) setSkills(inventory.skills);
  };

  const fileMap = useMemo(() => {
    const map = new Map<string, AgentInspectorFileModel>();
    if (!response) return map;
    const all = [response.agentToml, response.agentJson, response.skillMarkdown, ...response.references, ...response.scripts, ...response.assets].filter(Boolean) as AgentInspectorFileModel[];
    for (const f of all) map.set(f.path, f);
    return map;
  }, [response]);

  const selectedFileModel = selectedFilePath ? fileMap.get(selectedFilePath) ?? null : null;

  const hasInspectorFiles = useMemo(() => {
    if (!response) return false;
    return !!(response.skillMarkdown || response.agentToml || response.agentJson || response.references.length || response.scripts.length || response.assets.length);
  }, [response]);

  /** 파일 선택 — Monaco 에디터에 내용 로드 */
  const handleSelectFile = useCallback((filePath: string) => {
    const file = fileMap.get(filePath);
    if (!file) return;
    setSelectedFilePath(filePath);
    setEditContent(file.content);
    setOriginalContent(file.content);
    setSaveError(null);
    setSaveSuccess(null);
  }, [fileMap]);

  /** 에디터 내용 변경 핸들러 */
  const handleContentChange = useCallback((content: string) => { setEditContent(content); }, []);
  const hasChanges = editContent !== originalContent;

  /** 편집 내용 저장 */
  const handleSave = useCallback(async () => {
    if (!selectedFilePath) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    const result = await ipcInvoke('inspector:save-file', { path: selectedFilePath, content: editContent });
    if (result) { setOriginalContent(editContent); setSaveSuccess('저장됨'); setTimeout(() => setSaveSuccess(null), 2000); }
    else { setSaveError('저장 실패'); }
    setSaving(false);
  }, [selectedFilePath, editContent]);

  /** 변경 사항 되돌리기 (원본 내용으로 복원) */
  const handleRevert = useCallback(() => { setEditContent(originalContent); }, [originalContent]);

  return (
    <div className="inspector-view">
      {!response && !loading && !error && !selectedSkill && (
        <div className="inspector-view__welcome">
          <div className="inspector-view__welcome-content">
            <span className="codicon codicon-inspect" style={{ fontSize: '48px', opacity: 0.2 }} />
            <h2>Agent Inspector</h2>
            <p>Select an agent from the sidebar</p>
          </div>
        </div>
      )}

      {response && hasInspectorFiles && (
        <div className="inspector-main">
          <div className="inspector-main__split">
            <div className="inspector-main__left">
              <div className="inspector-main__agent-card" style={{ '--card-accent': effectiveMeta?.color } as React.CSSProperties}>
                <span className="inspector-main__agent-badge" style={{ background: effectiveMeta?.color }}>{effectiveMeta?.badge}</span>
                <div className="inspector-main__agent-info">
                  <h2 className="inspector-main__agent-name">{response.agentName}</h2>
                  <p className="inspector-main__agent-sub">
                    {response.roleLabelKo} · {response.departmentLabelKo}
                    {response.skillName && <span> · Skill: {response.skillName}</span>}
                  </p>
                  {response.description && <p className="inspector-main__agent-desc">{response.description}</p>}
                </div>
              </div>
              <InspectorFileBrowser response={response} selectedFile={selectedFilePath} onSelectFile={handleSelectFile} />
            </div>
            <div className="inspector-main__right">
              {selectedFileModel ? (
                <FileEditor file={{ ...selectedFileModel, content: editContent }} onContentChange={handleContentChange} onSave={handleSave} saving={saving} hasChanges={hasChanges} successMsg={saveSuccess} error={saveError} onRevert={handleRevert} />
              ) : (
                <div className="inspector-main__editor-empty">
                  <span className="codicon codicon-file" style={{ fontSize: '48px', opacity: 0.15 }} />
                  <p>파일을 선택하면 내용을 확인할 수 있습니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {response && !hasInspectorFiles && effectiveAgent && <AgentEditor agent={effectiveAgent} />}

      {selectedAgent && !response && (loading ? (
        <div className="inspector-view__welcome"><div className="inspector-view__welcome-content"><div className="spinner" /><p>Loading agent info...</p></div></div>
      ) : !error ? (
        <div className="inspector-view__welcome"><div className="inspector-view__welcome-content"><div className="spinner" /><p>Loading agent info...</p></div></div>
      ) : (
        <div className="inspector-view__welcome"><div className="inspector-view__welcome-content"><span className="codicon codicon-error" style={{ fontSize: '48px', opacity: 0.4 }} /><h2>오류</h2><p>{error}</p></div></div>
      ))}

      {selectedSkill && <SkillEditor skill={selectedSkill} />}
    </div>
  );
};

export default InspectorView;
