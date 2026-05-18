/**
 * StatusBar — 앱 하단 상태 표시줄 컴포넌트.
 *
 * 기능:
 * - 현재 선택된 엔진 표시 (색상 인디케이터 + 이름)
 * - 다른 엔진들의 CLI 유효성 상태 표시 (Available/Not found)
 * - 활성 에이전트 실행 수 표시
 * - 앱 버전 정보 표시
 *
 * Props: 없음 (Zustand store에서 모든 상태 읽음)
 *
 * 앱 내 배치:
 * - 전체 앱 레이아웃의 최하단 footer
 * - App.tsx의 Layout 컴포넌트 내부에 위치
 */
import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { ipcInvoke } from '../../utils/ipc';

interface StatusBarProps {}

const ENGINES = [
  { id: 'gemini', label: 'Gemini', defaultPath: '/usr/local/bin/gemini' },
  { id: 'opencode', label: 'OpenCode', defaultPath: '/usr/local/bin/opencode' },
  { id: 'claudecode', label: 'ClaudeCode', defaultPath: '/usr/local/bin/claude' },
];

const ENGINE_COLORS: Record<string, string> = {
  gemini: 'var(--status-success)',
  opencode: 'var(--status-info)',
  claudecode: 'var(--status-warning)',
};

/**
 * StatusBar — 앱 하단 상태 표시줄.
 * 선택된 엔진, CLI 유효성 상태, 활성 에이전트 수, 앱 버전 표시.
 * @returns 상태 표시줄 JSX 요소
 */
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
