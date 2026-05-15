import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';

interface StatusBarProps {}

async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

const ENGINES = [
  { id: 'codex', label: 'Codex', defaultPath: '/usr/local/bin/codex' },
  { id: 'gemini', label: 'Gemini', defaultPath: '/usr/local/bin/gemini' },
  { id: 'opencode', label: 'OpenCode', defaultPath: '/usr/local/bin/opencode' },
  { id: 'claudecode', label: 'ClaudeCode', defaultPath: '/usr/local/bin/claude' },
];

const ENGINE_COLORS: Record<string, string> = {
  codex: 'var(--accent-primary)',
  gemini: 'var(--status-success)',
  opencode: 'var(--status-info)',
  claudecode: 'var(--status-warning)',
};

export const StatusBar: React.FC<StatusBarProps> = () => {
  const activeRunCount = useUIStore((s) => s.activeRunCount);
  const appVersion = useUIStore((s) => s.appVersion);
  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const [engineStatus, setEngineStatus] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const statuses: Record<string, boolean> = {};
      for (const eng of ENGINES) {
        const result = await ipcInvoke<{ valid: boolean }>('cli:validate', eng.defaultPath);
        statuses[eng.id] = result?.valid ?? false;
      }
      setEngineStatus(statuses);
      setChecking(false);
    })();
  }, []);

  const selColor = ENGINE_COLORS[selectedEngine] || 'var(--text-tertiary)';

  return (
    <footer className="status-bar" role="contentinfo" aria-label="Status Bar">
      <div className="status-bar__left">
        <div className="status-bar__item" title={`Selected Engine: ${selectedEngine}`}>
          <span className="status-bar__indicator" style={{ background: selColor }} />
          <span style={{ fontWeight: 600, color: selColor }}>
            {selectedEngine.charAt(0).toUpperCase() + selectedEngine.slice(1)}
          </span>
        </div>
        <div className="status-bar__divider" />
        {ENGINES.filter((eng) => eng.id !== selectedEngine).map((eng) => (
          <div
            key={eng.id}
            className="status-bar__item"
            title={`${eng.label} Engine - ${engineStatus[eng.id] ? 'Available' : 'Not found'}`}
            style={{ opacity: 0.5 }}
          >
            <span className={`status-bar__indicator ${checking ? '' : (engineStatus[eng.id] ? 'status-bar__indicator--active' : 'status-bar__indicator--inactive')}`} />
            <span>{eng.label}</span>
          </div>
        ))}
        <div className="status-bar__divider" />
        <div className="status-bar__item" title="Active agents">
          <span className="codicon codicon-account" />
          <span>{activeRunCount} active</span>
        </div>
      </div>
      <div className="status-bar__right">
        <div className="status-bar__item" title="Version">
          <span>v{appVersion}</span>
        </div>
      </div>
    </footer>
  );
};
