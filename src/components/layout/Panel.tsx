/**
 * Panel — 앱 하단 로그/이벤트 패널 컴포넌트 (VS Code 스타일).
 *
 * 기능:
 * - 4개 탭: Terminal(로그), Output(INFO/ERROR 필터), Events(시스템 이벤트), Problems(에러/경고)
 * - Electron API의 log:entry, run:event, run:started, run:ended 이벤트 구독
 * - 로그는 최대 500개, 문제/이벤트는 최대 100개까지 유지
 * - 패널 높이 리사이즈 (useResizeHandle 훅) 및 확대/축소 토글
 * - 내용 전체 clear 버튼
 *
 * Props: 없음 (Zustand store에서 panelHeight/panelExpanded 읽음)
 *
 * 앱 내 배치:
 * - 전체 앱 레이아웃의 최하단, StatusBar 바로 위
 * - App.tsx의 Layout 컴포넌트 내부에 위치
 */
import React, { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useResizeHandle } from '../../hooks/useResizeHandle';

const PANEL_TABS = [
  { id: 'terminal', icon: 'terminal', label: 'Terminal' },
  { id: 'output', icon: 'output', label: 'Output' },
  { id: 'events', icon: 'bell', label: 'Events' },
  { id: 'problems', icon: 'error', label: 'Problems' },
] as const;

type PanelTabId = (typeof PANEL_TABS)[number]['id'];

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

interface PanelProps {}

/**
 * Panel — 앱 하단 로그/이벤트 패널.
 * Terminal(로그), Output(INFO/ERROR 필터), Events(시스템 이벤트), Problems(에러/경고) 탭 제공.
 * @returns 패널 JSX 요소
 */
export const Panel: React.FC<PanelProps> = () => {
  const [activeTab, setActiveTab] = useState<PanelTabId>('terminal');
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<Array<{ type: string; data: string; time: string }>>([]);
  const [problems, setProblems] = useState<Array<{ message: string; severity: string; file?: string }>>([]);
  const panelHeight = useUIStore((s) => s.panelHeight);
  const panelExpanded = useUIStore((s) => s.panelExpanded);
  const togglePanelExpand = useUIStore((s) => s.togglePanelExpand);
  const setPanelHeight = useUIStore((s) => s.setPanelHeight);
  const logEndRef = useRef<HTMLDivElement>(null);
  const panelResizeRef = useResizeHandle({
    direction: 'vertical',
    invert: true,
    onResize: (delta) => {
      setPanelHeight(useUIStore.getState().panelHeight + delta);
    },
  });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const handleLogEntry = (entry: LogEntry) => {
      setLogEntries(prev => [...prev.slice(-499), entry]);
      const upper = entry.level.toUpperCase();
      if (upper === 'ERROR' || upper === 'WARN') {
        setProblems(prev => {
          const newProblem = { message: entry.message, severity: upper === 'ERROR' ? 'error' : 'warning', file: entry.source };
          return [...prev, newProblem].slice(-99);
        });
      }
    };

    const handleRunEvent = (event: { type: string; data?: unknown; runId?: string }) => {
      setEvents(prev => [...prev.slice(-99), {
        type: event.type,
        data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
        time: new Date().toLocaleTimeString(),
      }]);
    };

    const handleRunStarted = () => {
      setEvents(prev => [...prev.slice(-99), { type: 'run:started', data: 'Run started', time: new Date().toLocaleTimeString() }]);
    };

    const handleRunEnded = (data: { runId?: string; exitCode?: number }) => {
      setEvents(prev => [...prev.slice(-99), { type: 'run:ended', data: `Run ${data?.runId ?? '?'} ended with exit code ${data?.exitCode ?? '?'}`, time: new Date().toLocaleTimeString() }]);
    };

    api.on('log:entry', handleLogEntry);
    api.on('run:event', handleRunEvent);
    api.on('run:started', handleRunStarted);
    api.on('run:ended', handleRunEnded);

    return () => {
      api.off('log:entry', handleLogEntry);
      api.off('run:event', handleRunEvent);
      api.off('run:started', handleRunStarted);
      api.off('run:ended', handleRunEnded);
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries, events]);

  /** 패널 내용 전체 초기화 */
  const handleClear = () => {
    setLogEntries([]);
    setEvents([]);
    setProblems([]);
  };

  /** 활성 탭에 따른 패널 내용 렌더링 */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'terminal':
        return (
          <div className="panel__content panel__content--terminal">
            {logEntries.length === 0 ? (
              <div className="panel__placeholder">
                <span className="codicon codicon-terminal" />
                <p>Terminal logs will appear here when you run an agent.</p>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.6 }}>
                {logEntries.map((entry, i) => (
                  <div key={i} style={{ color: entry.level.toUpperCase() === 'ERROR' ? 'var(--status-error)' : entry.level.toUpperCase() === 'WARN' ? 'var(--status-warning)' : 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)', marginRight: '8px' }}>{entry.timestamp}</span>
                    <span style={{ color: 'var(--accent-primary)', marginRight: '8px' }}>[{entry.source}]</span>
                    {entry.message}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        );
      case 'output':
        return (
          <div className="panel__content panel__content--output">
            {logEntries.length === 0 ? (
              <div className="panel__placeholder">
                <span className="codicon codicon-output" />
                <p>Output logs will appear here.</p>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.6 }}>
                {logEntries.filter(e => e.level.toUpperCase() === 'INFO' || e.level.toUpperCase() === 'ERROR').map((entry, i) => (
                  <div key={i}>{entry.message}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        );
      case 'events':
        return (
          <div className="panel__content panel__content--events">
            {events.length === 0 ? (
              <div className="panel__placeholder">
                <span className="codicon codicon-bell" />
                <p>System events will be logged here.</p>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.6 }}>
                {events.map((ev, i) => (
                  <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    <span style={{ color: 'var(--text-tertiary)', marginRight: '8px' }}>{ev.time}</span>
                    <span style={{ color: 'var(--accent-primary)', marginRight: '8px' }}>[{ev.type}]</span>
                    {ev.data}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        );
      case 'problems':
        return (
          <div className="panel__content panel__content--problems">
            {problems.length === 0 ? (
              <div className="panel__placeholder">
                <span className="codicon codicon-error" />
                <p>No problems detected.</p>
              </div>
            ) : (
              <div>
                {problems.map((p, i) => (
                  <div key={i} style={{ padding: '4px 8px', fontSize: '12px', color: p.severity === 'error' ? 'var(--status-error)' : 'var(--status-warning)', borderBottom: '1px solid var(--border-muted)' }}>
                    <span className={`codicon codicon-${p.severity === 'error' ? 'error' : 'warning'}`} style={{ marginRight: '8px' }} />
                    {p.message}
                    {p.file && <span style={{ float: 'right', color: 'var(--text-tertiary)', fontSize: '11px' }}>{p.file}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <section className="panel" role="region" aria-label="Bottom Panel" style={{ height: panelExpanded ? '40vh' : panelHeight, minHeight: panelExpanded ? '30vh' : '100px' }}>
      <div className="panel__header">
        <div className="panel__tabs" role="tablist">
          {PANEL_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`panel__tab ${activeTab === tab.id ? 'panel__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              title={tab.label}
            >
              <span className={`codicon codicon-${tab.icon}`} />
              <span className="panel__tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="panel__actions">
          <button className="panel__action" title="Clear" aria-label="Clear panel" onClick={handleClear}>
            <span className="codicon codicon-trash" />
          </button>
          <button className="panel__action" title="Expand" aria-label="Expand panel" onClick={togglePanelExpand}>
            <span className={`codicon codicon-${panelExpanded ? 'collapse' : 'expand'}`} />
          </button>
        </div>
      </div>
      <div
        className="panel__body"
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-label={`${activeTab} panel`}
      >
        {renderTabContent()}
      </div>
      <div ref={panelResizeRef} className="panel__resize-handle" role="separator" aria-orientation="horizontal" />
    </section>
  );
};
