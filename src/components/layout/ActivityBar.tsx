import React, { useState, useRef, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { ipcInvoke } from '../../utils/ipc';

/** 뷰 ID 타입 (uiStore와 동기화) */
type ViewId = 'org' | 'dashboard' | 'console' | 'workflow' | 'inspector';

/**
 * SVG 아이콘 컴포넌트 — mockup과 동일한 feather 스타일
 * 각 아이콘: 20×20 viewBox=24, stroke=currentColor, strokeWidth=2
 */
const ICONS: Record<string, React.ReactNode> = {
  /* Organization: people group */
  org: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  /* Dashboard: grid layout */
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  /* Console: terminal prompt */
  console: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  /* Workflow: hexagon/network */
  workflow: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
    </svg>
  ),
  /* Inspector: search/magnify */
  inspector: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  /* Settings: gear */
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  /* Chevron left: sidebar toggle */
  chevronLeft: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  /* Chevron right: chat toggle */
  chevronRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  /* Paint palette: theme */
  theme: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.17-.61-1.59-.38-.42-.61-.98-.61-1.59 0-1.38 1.12-2.5 2.5-2.5H17c3.31 0 6-2.69 6-6 0-4.42-4.03-8-9-8z" />
    </svg>
  ),
};

/**
 * 액티비티 바 아이콘 정의
 */
const ACTIVITY_ITEMS: Array<{ id: ViewId; label: string }> = [
  { id: 'org', label: 'Organization (Cmd+1)' },
  { id: 'dashboard', label: 'Dashboard (Cmd+2)' },
  { id: 'console', label: 'Console (Cmd+3)' },
  { id: 'workflow', label: 'Workflow (Cmd+4)' },
  { id: 'inspector', label: 'Inspector (Cmd+5)' },
];

/**
 * ActivityBarProps
 */
interface ActivityBarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  onToggleSidebar?: () => void;
  onToggleChat?: () => void;
  onSettings?: () => void;
  sidebarVisible?: boolean;
}

/**
 * ActivityBar 컴포넌트
 * - mockup HTML과 동일한 SVG 아이콘 + left active indicator
 * - 하단 spacer + collapse toggles + settings
 */
const THEMES: Array<{ id: string; label: string }> = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'cyber-fusion', label: 'Cyber Fusion' },
  { id: 'night-ops', label: 'Night Ops' },
  { id: 'matrix-green', label: 'Matrix Green' },
  { id: 'dracula-pro', label: 'Dracula Pro' },
  { id: 'glass-enterprise', label: 'Glass Enterprise' },
  { id: 'minimal-pro', label: 'Minimal Pro' },
  { id: 'paper', label: 'Paper' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'nord', label: 'Nord' },
  { id: 'black', label: 'Black' },
];

const ENGINES = [
  { id: 'codex', label: 'Codex CLI', icon: 'C' },
  { id: 'gemini', label: 'Gemini CLI', icon: 'G' },
  { id: 'opencode', label: 'OpenCode CLI', icon: 'O' },
  { id: 'claudecode', label: 'ClaudeCode CLI', icon: 'CC' },
];

export const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange, onToggleSidebar, onToggleChat, onSettings, sidebarVisible = true }) => {
  const sidebarAvailable = activeView === 'inspector';
  const [themeOpen, setThemeOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  const selectedEngine = useUIStore(s => s.selectedEngine);
  const setSelectedEngine = useUIStore(s => s.setSelectedEngine);
  const appVersion = useUIStore(s => s.appVersion);
  const setActiveView = useUIStore(s => s.setActiveView);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
      if (engineRef.current && !engineRef.current.contains(e.target as Node)) {
        setEngineOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentEngine = ENGINES.find(e => e.id === selectedEngine) ?? ENGINES[0]!;

  return (
    <nav className="activity-bar" role="navigation" aria-label="Activity Bar">
      {/* 뷰 아이콘 목록 */}
      {ACTIVITY_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`activity-bar__item ${activeView === item.id ? 'activity-bar__item--active' : ''}`}
          onClick={() => onViewChange(item.id)}
          title={item.label}
          aria-label={item.label}
          aria-pressed={activeView === item.id}
        >
          {ICONS[item.id]}
        </button>
      ))}

      {/* 하단 spacer */}
      <div className="activity-bar__footer">
        {/* Toggle Sidebar - 항상 표시, 좌측두번째 패널이 있는 경우만 동작 */}
        <button 
          className="activity-bar__item" 
          title={sidebarAvailable ? "Toggle Sidebar" : "Sidebar not available in this view"} 
          aria-label="Toggle Sidebar" 
          onClick={sidebarAvailable ? onToggleSidebar : undefined}
          style={{ cursor: sidebarAvailable ? 'pointer' : 'not-allowed', opacity: 1 }}
        >
          {ICONS.chevronLeft}
        </button>
        {/* Toggle Chat */}
        <button className="activity-bar__item" title="Toggle Chat" aria-label="Toggle Chat" onClick={onToggleChat}>
          {ICONS.chevronRight}
        </button>
        {/* Theme Picker */}
        <div ref={themeRef} style={{ position: 'relative' }}>
          <button
            className={`activity-bar__item ${themeOpen ? 'activity-bar__item--active' : ''}`}
            title="Theme"
            aria-label="Select Theme"
            onClick={() => setThemeOpen(o => !o)}
          >
            {ICONS.theme}
          </button>
          {themeOpen && (
            <div className="activity-bar__theme-dropdown">
              {THEMES.map(t => (
                <button
                  key={t.id}
                  className={`activity-bar__theme-option ${theme === t.id ? 'active' : ''}`}
                  onClick={() => { setTheme(t.id as typeof theme); setThemeOpen(false); }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Engine Selector */}
        <div ref={engineRef} style={{ position: 'relative' }}>
          <button
            className={`activity-bar__item ${engineOpen ? 'activity-bar__item--active' : ''}`}
            title={`Engine: ${currentEngine?.label ?? selectedEngine}`}
            aria-label="Select Engine"
            onClick={() => setEngineOpen(o => !o)}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '-0.5px' }}>{currentEngine?.icon ?? '?'}</span>
          </button>
          {engineOpen && (
            <div className="activity-bar__engine-dropdown">
              {ENGINES.map(e => (
                <button
                  key={e.id}
                  className={`activity-bar__theme-option ${selectedEngine === e.id ? 'active' : ''}`}
                  onClick={() => { setSelectedEngine(e.id); setEngineOpen(false); ipcInvoke('settings:set-default-engine', e.id); }}
                >
                  <span style={{ fontWeight: 700, marginRight: 'var(--space-2)' }}>{e.icon}</span>
                  {e.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Settings with dropdown */}
        <div ref={settingsRef} style={{ position: 'relative' }}>
          <button
            className={`activity-bar__item ${settingsOpen ? 'activity-bar__item--active' : ''}`}
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(o => !o)}
          >
            {ICONS.settings}
          </button>
          {settingsOpen && (
            <div className="activity-bar__theme-dropdown" style={{ bottom: 0, minWidth: '180px' }}>
              <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-primary)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Agent Orchestrator v{appVersion}
              </div>
              <button
                className="activity-bar__theme-option"
                onClick={() => { setSettingsOpen(false); setActiveView('inspector'); }}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <span className="codicon codicon-wrench" /> Settings
              </button>
              <button
                className="activity-bar__theme-option"
                onClick={() => { setSettingsOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-tertiary)', cursor: 'default' }}
              >
                <span className="codicon codicon-info" /> Agent Orchestrator v{appVersion}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};