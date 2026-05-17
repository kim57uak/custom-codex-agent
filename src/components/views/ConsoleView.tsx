/**
 * ConsoleView - 콘솔 뷰 (에이전트 실행 터미널 + 실시간 로그)
 *
 * 기능:
 * - xterm.js 터미널 에뮬레이션
 * - 에이전트 실행 설정 (엔진/워크스페이스/프롬프트)
 * - 실시간 로그 출력 (LogBuffer IPC events 사용)
 *
 * 설계 원칙:
 * - xterm.js는 DOM 기반 터미널 에뮬레이터 (WebGL 아님, 가볍게)
 * - terminal.fit() → dimensions 기반으로 자동 리사이즈
 * - IPC 'log:entry' 이벤트 구독 → 로그를 터미널에 실시간 출력
 * - 사용자가 직접 명령 입력 불가 (読み取り전용 로그 뷰)
 */

import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useUIStore } from '../../stores/uiStore';

interface ConsoleViewProps {}

/** IPC 헬퍼: 타입 안전 invoke */
async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

/** 로그 엔트리 타입 */
interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

/** 실행 시작 데이터 */
interface RunStartedData {
  runId: string;
  agentId: string;
}

/** 실행 종료 데이터 */
interface RunEndedData {
  runId: string;
  exitCode: number;
  durationMs: number;
}

/**
 * ConsoleSidebar - 사이드바용 Console 컴포넌트
 * 에이전트 선택 및 실행 설정 (엔진은 ActivityBar 전역에서 선택)
 */
export const ConsoleSidebar: React.FC = () => {
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [skills, setSkills] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [workspace, setWorkspace] = useState('');
  const [prompt, setPrompt] = useState('');
  const selectedEngine = useUIStore((s) => s.selectedEngine);

  useEffect(() => {
    loadData();
  }, [selectedEngine]);

  const loadData = async () => {
    const [agentResult, inventory] = await Promise.all([
      ipcInvoke<{ agents: Array<{ id: string; name: string; engine: string }> }>('config:get-agents'),
      ipcInvoke<{ skills: Array<{ name: string; path: string; installed: boolean }> }>('dashboard:inventory', selectedEngine),
    ]);
    const agentList = agentResult?.agents ?? [];
    setAgents(agentList);
    if (agentList.length > 0) {
      setSelectedAgentId(agentList[0]?.id ?? '');
    }
    if (inventory?.skills) {
      setSkills(inventory.skills.filter(s => s.installed));
    }
  };

  const handleBrowseWorkspace = async () => {
    const dir = await ipcInvoke<string>('dialog:open-directory');
    if (dir) setWorkspace(dir);
  };

  const handleRun = async () => {
    const agentId = selectedAgentId || agents[0]?.id || '';
    if (!agentId) return;
    await ipcInvoke('run:start', { agentId, workspace, prompt, engine: selectedEngine });
  };

  const engineLabel = selectedEngine === 'codex' ? 'Codex CLI' :
    selectedEngine === 'gemini' ? 'Gemini CLI' :
    selectedEngine === 'opencode' ? 'OpenCode CLI' :
    selectedEngine === 'claudecode' ? 'ClaudeCode CLI' : selectedEngine;

  return (
    <div className="console-sidebar">
      <div className="console-sidebar__section">
        <label className="console-sidebar__label">Agent</label>
        <select className="console-sidebar__select" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      <div className="console-sidebar__section">
        <label className="console-sidebar__label">Workspace</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input type="text" className="console-sidebar__input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="/path/to/workspace" style={{ flex: 1 }} readOnly />
          <button className="console-sidebar__btn console-sidebar__btn--browse" onClick={handleBrowseWorkspace} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '3px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>📁 Browse</button>
        </div>
      </div>

      <div className="console-sidebar__section">
        <label className="console-sidebar__label">Prompt</label>
        <textarea className="console-sidebar__textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What do you want the agent to do?" rows={4} />
      </div>

      <div className="console-sidebar__actions">
        <button className="console-sidebar__btn console-sidebar__btn--run" onClick={handleRun}>▶ Run</button>
        <button className="console-sidebar__btn console-sidebar__btn--clear" onClick={() => { window.electronAPI?.send('console:clear'); }}>
          ↺ Clear
        </button>
      </div>

      <div className="console-sidebar__engine-section">
        <div className="console-sidebar__engine-section-header">
          <span className="console-sidebar__engine-section-icon">⚡</span>
          <span>{engineLabel}</span>
          <span className="console-sidebar__engine-section-count">{agents.length} agents</span>
        </div>
        <div className="console-sidebar__engine-agents">
          {agents.slice(0, 5).map(agent => (
            <div key={agent.id} className="console-sidebar__engine-agent-item" onClick={() => setSelectedAgentId(agent.id)}>
              <span className="console-sidebar__engine-agent-dot" />
              <span className="console-sidebar__engine-agent-name">{agent.name}</span>
            </div>
          ))}
          {agents.length > 5 && (
            <div className="console-sidebar__engine-agent-more">+{agents.length - 5} more</div>
          )}
        </div>
        {skills.length > 0 && (
          <>
            <div className="console-sidebar__engine-section-header" style={{ marginTop: 'var(--space-2)' }}>
              <span className="console-sidebar__engine-section-icon">📚</span>
              <span>Available Skills</span>
              <span className="console-sidebar__engine-section-count">{skills.length}</span>
            </div>
            <div className="console-sidebar__engine-agents">
              {skills.slice(0, 3).map(skill => (
                <div key={skill.name} className="console-sidebar__engine-agent-item">
                  <span className="console-sidebar__engine-skill-dot" />
                  <span className="console-sidebar__engine-agent-name">{skill.name}</span>
                </div>
              ))}
              {skills.length > 3 && (
                <div className="console-sidebar__engine-agent-more">+{skills.length - 3} more</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * ConsoleView - 메인 콘솔 뷰 (xterm.js 터미널)
 */
export const ConsoleView: React.FC<ConsoleViewProps> = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [workspace, setWorkspace] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    (async () => {
      const result = await ipcInvoke<{ agents: Array<{ id: string; name: string }> }>('config:get-agents');
      const list = result?.agents ?? [];
      setAgents(list);
      if (list.length > 0) setSelectedAgentId(list[0]?.id ?? '');
    })();
  }, [selectedEngine]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      convertEol: true,
    });

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    terminal.current = term;
    term.writeln('\x1b[36m[System]\x1b[0m Terminal initialized. Waiting for agent output...');
    term.writeln('');

    const api = window.electronAPI;
    if (!api) return;

    const handleLogEntry = (entry: LogEntry) => {
      const levelColors: Record<string, string> = {
        error: '\x1b[31m', ERROR: '\x1b[31m',
        warn: '\x1b[33m', WARN: '\x1b[33m',
        info: '\x1b[36m', INFO: '\x1b[36m',
        debug: '\x1b[90m', DEBUG: '\x1b[90m',
      };
      const color = levelColors[entry.level] ?? '\x1b[0m';
      const prefix = `\x1b[90m${entry.timestamp}\x1b[0m [\x1b[33m${entry.source}\x1b[0m]`;
      term.writeln(`${prefix} ${color}${entry.message}\x1b[0m`);
    };

    const handleRunStarted = (data: RunStartedData) => {
      term.writeln(`\x1b[32m[Run Started]\x1b[0m runId=${data.runId}, agentId=${data.agentId}`);
      term.writeln('');
    };

    const handleRunEnded = (data: RunEndedData) => {
      const color = data.exitCode === 0 ? '\x1b[32m' : '\x1b[31m';
      term.writeln('');
      term.writeln(`${color}[Run Ended]\x1b[0m exitCode=${data.exitCode}, duration=${data.durationMs}ms`);
    };

    const handleClear = () => {
      term.clear();
      term.writeln('\x1b[36m[System]\x1b[0m Terminal cleared.');
      term.writeln('');
    };

    api.on('log:entry', handleLogEntry);
    api.on('run:started', handleRunStarted);
    api.on('run:ended', handleRunEnded);
    api.on('console:clear', handleClear);

    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try { fitAddon.current.fit(); } catch { /* ignore */ }
      }
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      api.off('log:entry', handleLogEntry);
      api.off('run:started', handleRunStarted);
      api.off('run:ended', handleRunEnded);
      api.off('console:clear', handleClear);
      term.dispose();
    };
  }, []);

  const handleBrowseWorkspace = async () => {
    const dir = await ipcInvoke<string>('dialog:open-directory');
    if (dir) setWorkspace(dir);
  };

  const handleRun = async () => {
    if (!workspace) {
      if (terminal.current) {
        terminal.current.writeln('\x1b[33m[Warning]\x1b[0m Workspace path is required');
      }
      return;
    }
    await ipcInvoke('run:start', { agentId: `engine-${selectedEngine}`, workspace, prompt, engine: selectedEngine });
  };

  return (
    <div className="console-view">
      <div className="main-toolbar">
        <h1 className="title">Console</h1>
        <span className="subtitle">codex-agent</span>
      </div>
      <div className="main-content">
        <div className="run-config">
          <div className="run-config-row">
            <label>Workspace</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flex: 1 }}>
              <input type="text" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="/path/to/workspace" readOnly style={{ flex: 1 }} />
              <button onClick={handleBrowseWorkspace} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '3px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12px' }}>📁 Browse</button>
            </div>
          </div>
          <div className="run-config-row">
            <label>Agent</label>
            <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} style={{ flex: 1, padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: '3px', color: 'var(--text-primary)', fontSize: '13px' }}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>
          <div className="run-config-row">
            <label>Prompt</label>
            <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Enter prompt..." />
            <button className="btn-run" onClick={handleRun}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run
            </button>
          </div>
        </div>
        <div className="terminal-output">
          <div ref={terminalRef} className="terminal-output-host" />
        </div>
      </div>
    </div>
  );
};