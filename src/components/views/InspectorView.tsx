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
    // fallback: Monaco uses default theme
  }
}
try { ensureMonacoTheme(); } catch {}

async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', py: 'python', go: 'go', rs: 'rust',
    java: 'java', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', toml: 'ini', sh: 'shell', bash: 'shell', sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const ENGINE_META: Record<string, { label: string; color: string; badge: string }> = {
  codex: { label: 'Codex CLI', color: 'var(--accent-primary)', badge: 'C' },
  gemini: { label: 'Gemini CLI', color: 'var(--status-success)', badge: 'G' },
  opencode: { label: 'OpenCode CLI', color: 'var(--status-info)', badge: 'O' },
  claudecode: { label: 'ClaudeCode CLI', color: 'var(--status-warning)', badge: 'CC' },
  all: { label: 'All Engines', color: 'var(--text-tertiary)', badge: '*' },
};

function getEngineMeta(engine: string | undefined): { label: string; color: string; badge: string } {
  return ENGINE_META[engine ?? ''] ?? { label: engine ?? 'Unknown', color: 'var(--text-tertiary)', badge: '?' };
}

const DEPT_COLORS: Record<string, string> = {
  'dev': 'var(--accent-primary)',
  'engineering': 'var(--accent-primary)',
  'strategy': 'var(--status-success)',
  'platform': 'var(--status-info)',
  'quality': 'var(--status-warning)',
  'content': 'var(--accent-tertiary)',
  'ops': 'var(--status-error)',
  'executive': 'var(--accent-secondary)',
  'marketing': '#ec4899',
};

function getDeptColor(dept: string | undefined): string {
  if (!dept) return 'var(--text-tertiary)';
  const key = dept.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(DEPT_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'var(--text-tertiary)';
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const iconMap: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    json: '📋', md: '📝', py: '🐍', go: '🔷', rs: '🦀',
    java: '☕', css: '🎨', scss: '🎨', html: '🌐', xml: '📄',
    yaml: '📋', yml: '📋', toml: '⚙️', sh: '⚡', bash: '⚡', sql: '🗄️',
  };
  return iconMap[ext] ?? '📄';
}

const FILE_KIND_LABELS: Record<string, string> = {
  'agent-toml': 'Agent Config (TOML)',
  'agent-json': 'Agent Config (JSON)',
  'skill-md': 'Skill Definition',
  'reference': 'Reference Doc',
  'script': 'Script',
  'asset': 'Asset',
};

function getKindIcon(kind: string): string {
  const map: Record<string, string> = {
    'agent-toml': '⚙️',
    'agent-json': '⚙️',
    'skill-md': '📝',
    'reference': '📚',
    'script': '⚡',
    'asset': '📦',
  };
  return map[kind] ?? '📄';
}

const InspectorSidebar: React.FC = () => {
  const agents = useInspectorStore(s => s.agents);
  const skills = useInspectorStore(s => s.skills);
  const selectedAgent = useInspectorStore(s => s.selectedAgent);
  const selectedSkill = useInspectorStore(s => s.selectedSkill);
  const activeTab = useInspectorStore(s => s.activeTab);
  const response = useInspectorStore(s => s.response);
  const loading = useInspectorStore(s => s.loading);
  const error = useInspectorStore(s => s.error);
  const setSelectedAgent = useInspectorStore(s => s.setSelectedAgent);
  const setSelectedSkill = useInspectorStore(s => s.setSelectedSkill);
  const setActiveTab = useInspectorStore(s => s.setActiveTab);
  const setResponse = useInspectorStore(s => s.setResponse);
  const setLoading = useInspectorStore(s => s.setLoading);
  const setError = useInspectorStore(s => s.setError);
  const selectedEngine = useUIStore(s => s.selectedEngine);

  const [search, setSearch] = useState('');

  const engineFilteredAgents = agents.filter(a => a.engine === selectedEngine);

  const filteredAgents = engineFilteredAgents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const groupedAgents: Record<string, AgentConfig[]> = {};
  for (const agent of filteredAgents) {
    const dept = agent.department || agent.engine || 'other';
    if (!groupedAgents[dept]) groupedAgents[dept] = [];
    groupedAgents[dept].push(agent);
  }

  const handleSelectAgent = async (agent: AgentConfig) => {
    console.debug('[InspectorSidebar] handleSelectAgent called', agent.name, agent.engine);
    setSelectedAgent(agent);
    setSelectedSkill(null);
    setResponse(null);
    setError(null);
    setLoading(true);
    const result = await ipcInvoke<AgentInspectorResponse>('inspector:load-agent', { agentName: agent.name, engine: agent.engine });
    console.debug('[InspectorSidebar] IPC result', result ? 'success' : 'null');
    setLoading(false);
    if (result) {
      setResponse(result);
    } else {
      setError('Could not load agent info.');
    }
  };

  const handleSelectSkill = (skill: SkillModel) => {
    setSelectedSkill(skill);
    setSelectedAgent(null);
    setResponse(null);
  };

  const selectedEngineMeta = getEngineMeta(selectedEngine);

  return (
    <div className="inspector-sidebar">
      <div className="inspector-sidebar__header">
        <span>Inspector</span>
        {selectedEngine !== 'all' && selectedEngineMeta && (
          <span className="inspector-sidebar__engine-badge" style={{ background: selectedEngineMeta.color }}>
            {selectedEngineMeta.badge} {selectedEngineMeta.label}
          </span>
        )}
        {selectedEngine === 'all' && (
          <span className="inspector-sidebar__engine-badge" style={{ background: 'var(--text-tertiary)' }}>
            All Engines
          </span>
        )}
      </div>

      <div className="inspector-sidebar__tabs">
        <button
          className={`inspector-sidebar__tab ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          <span className="codicon codicon-account" />
          Agents
          <span className="inspector-sidebar__tab-count">{engineFilteredAgents.length}</span>
        </button>
        <button
          className={`inspector-sidebar__tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          <span className="codicon codicon-book" />
          Skills
          <span className="inspector-sidebar__tab-count">{skills.length}</span>
        </button>
      </div>

      <div className="inspector-sidebar__search">
        <span className="codicon codicon-search" />
        <input
          type="text"
          className="inspector-sidebar__search-input"
          placeholder={activeTab === 'agents' ? 'Search agents...' : 'Search skills...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="inspector-sidebar__list">
        {activeTab === 'agents' && (
          <>
            {filteredAgents.length === 0 && (
              <div className="inspector-sidebar__empty">
                <span className="codicon codicon-account" style={{ fontSize: '24px', opacity: 0.3 }} />
                <p>No agents found</p>
              </div>
            )}
            {Object.entries(groupedAgents).map(([dept, deptAgents]) => (
              <div key={dept} className="inspector-sidebar__group">
                <div className="inspector-sidebar__group-header" style={{ '--group-color': getDeptColor(dept) } as React.CSSProperties}>
                  <span className="inspector-sidebar__group-dot" />
                  <span className="inspector-sidebar__group-name">{dept}</span>
                  <span className="inspector-sidebar__group-count">{deptAgents.length}</span>
                </div>
                {deptAgents.map(agent => {
                  const meta = getEngineMeta(agent.engine);
                  const isSelected = selectedAgent?.id === agent.id;
                  return (
                    <div
                      key={agent.id}
                      className={`inspector-sidebar__item ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectAgent(agent)}
                    >
                      <span className="inspector-sidebar__item-badge" style={{ background: meta.color }}>
                        {meta.badge}
                      </span>
                      <div className="inspector-sidebar__item-info">
                        <span className="inspector-sidebar__item-name">{agent.name}</span>
                        <span className="inspector-sidebar__item-desc">{agent.description || meta.label}</span>
                      </div>
                      <span className="inspector-sidebar__item-engine">{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {activeTab === 'skills' && (
          <>
            {filteredSkills.length === 0 && (
              <div className="inspector-sidebar__empty">
                <span className="codicon codicon-book" style={{ fontSize: '24px', opacity: 0.3 }} />
                <p>No skills found</p>
              </div>
            )}
            {filteredSkills.map(skill => {
              const isSelected = selectedSkill?.name === skill.name;
              return (
                <div
                  key={skill.name}
                  className={`inspector-sidebar__item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectSkill(skill)}
                >
                  <span className="inspector-sidebar__item-badge" style={{ background: 'var(--status-success)' }}>
                    S
                  </span>
                  <div className="inspector-sidebar__item-info">
                    <span className="inspector-sidebar__item-name">{skill.name}</span>
                    <span className="inspector-sidebar__item-desc">{skill.path}</span>
                  </div>
                  <span className={`inspector-sidebar__item-status ${skill.installed ? 'installed' : 'missing'}`}>
                    {skill.installed ? (skill.enabled ? 'ON' : 'OFF') : 'MISS'}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {response && (
        <div className="inspector-sidebar__agent-detail">
          <div className="inspector-sidebar__agent-detail-header">
            <span className="inspector-sidebar__agent-detail-title">Agent Info</span>
          </div>
          <div className="inspector-sidebar__agent-detail-scroll">
            <div className="inspector-sidebar__agent-detail-body">
              {response.description && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">설명</span>
                  <span className="inspector-sidebar__detail-value">{response.description}</span>
                </div>
              )}
              {response.roleLabelKo && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">역할</span>
                  <span className="inspector-sidebar__detail-value">{response.roleLabelKo}</span>
                </div>
              )}
              {response.departmentLabelKo && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">부서</span>
                  <span className="inspector-sidebar__detail-value">{response.departmentLabelKo}</span>
                </div>
              )}
              {response.skillName && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">Skills</span>
                  <span className="inspector-sidebar__detail-value">{response.skillName}</span>
                </div>
              )}
              {response.shortDescription && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">요약</span>
                  <span className="inspector-sidebar__detail-value">{response.shortDescription}</span>
                </div>
              )}
              {response.oneClickPrompt && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">빠른 프롬프트</span>
                  <span className="inspector-sidebar__detail-value">{response.oneClickPrompt}</span>
                </div>
              )}
              {response.agentTomlPath && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">TOML</span>
                  <span className="inspector-sidebar__detail-value">{response.agentTomlPath}</span>
                </div>
              )}
              {response.agentJsonPath && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">JSON</span>
                  <span className="inspector-sidebar__detail-value">{response.agentJsonPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { InspectorSidebar };

const FileCard: React.FC<{
  file: AgentInspectorFileModel;
  selected: boolean;
  onClick: () => void;
}> = ({ file, selected, onClick }) => (
  <div
    className={`inspector-file-card ${selected ? 'active' : ''}`}
    onClick={onClick}
  >
    <div className="inspector-file-card__icon">
      <span className="inspector-file-card__emoji">{getKindIcon(file.kind)}</span>
    </div>
    <div className="inspector-file-card__info">
      <span className="inspector-file-card__name">{file.name}</span>
      <span className="inspector-file-card__meta">
        {FILE_KIND_LABELS[file.kind] || file.kind} · {formatBytes(file.sizeBytes)}
      </span>
    </div>
    <div className="inspector-file-card__lang">{detectLanguage(file.name)}</div>
  </div>
);

const FileGroup: React.FC<{
  title: string;
  icon: string;
  files: AgentInspectorFileModel[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}> = ({ title, icon, files, selectedFile, onSelect }) => {
  if (!files || files.length === 0) return null;
  return (
    <div className="inspector-file-group">
      <div className="inspector-file-group__header">
        <span className="inspector-file-group__icon">{icon}</span>
        <span className="inspector-file-group__title">{title}</span>
        <span className="inspector-file-group__count">{files.length}</span>
      </div>
      <div className="inspector-file-group__list">
        {files.map(file => (
          <FileCard
            key={file.path}
            file={file}
            selected={selectedFile === file.path}
            onClick={() => onSelect(file.path)}
          />
        ))}
      </div>
    </div>
  );
};

const InspectorFileBrowser: React.FC<{
  response: AgentInspectorResponse;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}> = ({ response, selectedFile, onSelectFile }) => {
  const allFiles: { file: AgentInspectorFileModel; group: string }[] = [];
  if (response.agentToml) allFiles.push({ file: response.agentToml, group: 'config' });
  if (response.agentJson) allFiles.push({ file: response.agentJson, group: 'config' });
  if (response.skillMarkdown) allFiles.push({ file: response.skillMarkdown, group: 'skill' });
  for (const ref of response.references) allFiles.push({ file: ref, group: 'refs' });
  for (const script of response.scripts) allFiles.push({ file: script, group: 'scripts' });
  for (const asset of response.assets) allFiles.push({ file: asset, group: 'assets' });

  return (
    <div className="inspector-file-browser">
      <div className="inspector-file-browser__header">
        <span className="codicon codicon-files" />
        <span>Skill Files</span>
        <span className="inspector-file-browser__count">{allFiles.length}개</span>
      </div>
      <div className="inspector-file-browser__body">
        {response.agentToml || response.agentJson ? (
          <FileGroup
            title="설정"
            icon="⚙️"
            files={[response.agentToml, response.agentJson].filter(Boolean) as AgentInspectorFileModel[]}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        ) : null}
        {response.skillMarkdown ? (
          <FileGroup
            title="Skill Definition"
            icon="📝"
            files={[response.skillMarkdown]}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        ) : null}
        {response.references.length > 0 && (
          <FileGroup
            title="참조 문서"
            icon="📚"
            files={response.references}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {response.scripts.length > 0 && (
          <FileGroup
            title="스크립트"
            icon="⚡"
            files={response.scripts}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {response.assets.length > 0 && (
          <FileGroup
            title="에셋"
            icon="📦"
            files={response.assets}
            selectedFile={selectedFile}
            onSelect={onSelectFile}
          />
        )}
        {allFiles.length === 0 && (
          <div className="inspector-file-browser__empty">
            <span className="codicon codicon-files" style={{ fontSize: '32px', opacity: 0.2 }} />
            <p>No skill files for this agent.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const FileEditor: React.FC<{
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

  useEffect(() => { ensureMonacoTheme(); }, []);

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

  console.debug('[InspectorView] render', { selectedAgent: !!selectedAgent, selectedSkill: !!selectedSkill, response: !!response, loading, error });

  useEffect(() => {
    loadData();
  }, [selectedEngine]);

  useEffect(() => {
    if (response) setSelectedFilePath(null);
  }, [response]);

  const effectiveAgent = selectedAgent ?? (response ? { id: response.agentName, name: response.agentName, engine: 'codex' as const } : null);
  const effectiveMeta = effectiveAgent ? getEngineMeta(effectiveAgent.engine) : undefined;

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
    const all = [
      response.agentToml,
      response.agentJson,
      response.skillMarkdown,
      ...response.references,
      ...response.scripts,
      ...response.assets,
    ].filter(Boolean) as AgentInspectorFileModel[];
    for (const f of all) map.set(f.path, f);
    return map;
  }, [response]);

  const selectedFileModel = selectedFilePath ? fileMap.get(selectedFilePath) ?? null : null;

  const hasInspectorFiles = useMemo(() => {
    if (!response) return false;
    return !!(
      response.skillMarkdown ||
      response.agentToml ||
      response.agentJson ||
      response.references.length ||
      response.scripts.length ||
      response.assets.length
    );
  }, [response]);

  const handleSelectFile = useCallback((filePath: string) => {
    const file = fileMap.get(filePath);
    if (!file) return;
    setSelectedFilePath(filePath);
    setEditContent(file.content);
    setOriginalContent(file.content);
    setSaveError(null);
    setSaveSuccess(null);
  }, [fileMap]);

  const handleContentChange = useCallback((content: string) => {
    setEditContent(content);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedFilePath) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    const result = await ipcInvoke('inspector:save-file', { path: selectedFilePath, content: editContent });
    if (result) {
      setOriginalContent(editContent);
      setSaveSuccess('저장됨');
      setTimeout(() => setSaveSuccess(null), 2000);
    } else {
      setSaveError('저장 실패');
    }
    setSaving(false);
  }, [selectedFilePath, editContent]);

  const handleRevert = useCallback(() => {
    setEditContent(originalContent);
  }, [originalContent]);

  const hasChanges = editContent !== originalContent;

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
                <span className="inspector-main__agent-badge" style={{ background: effectiveMeta?.color }}>
                  {effectiveMeta?.badge}
                </span>
                <div className="inspector-main__agent-info">
                  <h2 className="inspector-main__agent-name">{response.agentName}</h2>
                  <p className="inspector-main__agent-sub">
                    {response.roleLabelKo} · {response.departmentLabelKo}
                    {response.skillName && <span> · Skill: {response.skillName}</span>}
                  </p>
                  {response.description && (
                    <p className="inspector-main__agent-desc">{response.description}</p>
                  )}
                </div>
              </div>
              <InspectorFileBrowser
                response={response}
                selectedFile={selectedFilePath}
                onSelectFile={handleSelectFile}
              />
            </div>
            <div className="inspector-main__right">
              {selectedFileModel ? (
                <FileEditor
                  file={{ ...selectedFileModel, content: editContent }}
                  onContentChange={handleContentChange}
                  onSave={handleSave}
                  saving={saving}
                  hasChanges={hasChanges}
                  successMsg={saveSuccess}
                  error={saveError}
                  onRevert={handleRevert}
                />
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

      {response && !hasInspectorFiles && effectiveAgent && (
        <AgentEditor agent={effectiveAgent} />
      )}

      {selectedAgent && !response && !loading && !error && (
        <div className="inspector-view__welcome">
          <div className="inspector-view__welcome-content">
            <div className="spinner" />
            <p>Loading agent info...</p>
          </div>
        </div>
      )}

      {selectedAgent && loading && (
        <div className="inspector-view__welcome">
          <div className="inspector-view__welcome-content">
            <div className="spinner" />
            <p>Loading agent info...</p>
          </div>
        </div>
      )}

      {selectedAgent && error && !response && (
        <div className="inspector-view__welcome">
          <div className="inspector-view__welcome-content">
            <span className="codicon codicon-error" style={{ fontSize: '48px', opacity: 0.4 }} />
            <h2>오류</h2>
            <p>{error}</p>
          </div>
        </div>
      )}

      {selectedSkill && (
        <SkillEditor skill={selectedSkill} />
      )}
    </div>
  );
};

export default InspectorView;

const EditorField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}> = ({ label, value, onChange, multiline, hint }) => (
  <div className="inspector-editor__field">
    <label className="inspector-editor__label">{label}</label>
    {multiline ? (
      <textarea
        className="inspector-editor__textarea"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
      />
    ) : (
      <input
        className="inspector-editor__input"
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )}
    {hint && <span className="inspector-editor__hint">{hint}</span>}
  </div>
);

const AgentEditor: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [model, setModel] = useState(agent.model || '');
  const [cliPath, setCliPath] = useState(agent.cliPath || '');
  const [department, setDepartment] = useState(agent.department || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    const result = await ipcInvoke<boolean>('agents:save', {
      ...agent,
      name,
      description,
      model,
      cliPath,
      department,
    });
    if (result) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }, [agent, name, description, model, cliPath, department]);

  const meta = getEngineMeta(agent.engine);

  return (
    <div className="inspector-editor">
      <div className="inspector-editor__hero" style={{ '--hero-accent': meta.color } as React.CSSProperties}>
        <span className="inspector-editor__hero-badge" style={{ background: meta.color }}>
          {meta.badge}
        </span>
        <div>
          <h2 className="inspector-editor__hero-title">{agent.name}</h2>
          <p className="inspector-editor__hero-sub">{meta.label} · {agent.id}</p>
        </div>
      </div>

      <div className="inspector-editor__body">
        <EditorField label="Name" value={name} onChange={setName} />
        <EditorField label="Description" value={description} onChange={setDescription} multiline hint="Describe what this agent does" />
        <EditorField label="Model" value={model} onChange={setModel} hint="e.g. gpt-4o, gemini-2.0-flash" />
        <EditorField label="CLI Path" value={cliPath} onChange={setCliPath} hint="Leave empty to use default PATH" />
        <EditorField label="Department" value={department} onChange={setDepartment} hint="e.g. Development, Strategy, Platform" />

        {agent.env && Object.keys(agent.env).length > 0 && (
          <div className="inspector-editor__section">
            <label className="inspector-editor__label">Environment Variables</label>
            {Object.entries(agent.env).map(([k, v]) => (
              <div key={k} className="inspector-editor__env-row">
                <span className="inspector-editor__env-key">{k}</span>
                <span className="inspector-editor__env-val">{v as string}</span>
              </div>
            ))}
          </div>
        )}

        <div className="inspector-editor__actions">
          <button
            className="inspector-editor__btn inspector-editor__btn--save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="inspector-editor__success">Saved</span>}
        </div>
      </div>
    </div>
  );
};

const SkillEditor: React.FC<{ skill: SkillModel }> = ({ skill }) => {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadContent();
  }, [skill.path]);

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
