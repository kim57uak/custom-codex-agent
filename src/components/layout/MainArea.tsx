/**
 * MainArea - 메인 콘텐츠 영역
 *
 * 위치: app-shell의 중앙 (grid area: "main")
 * 최소 너비: 320px, flex: 1 (남은 공간 모두 차지)
 *
 * 기능:
 * - activeView에 따라 메인 콘텐츠 렌더링
 * - 5개 뷰: Org, Dashboard, Console, Workflow, Inspector
 * - 에러 경계 (ErrorBoundary) 적용
 * - 뷰 선택 탭 바 (view-selector)
 *
 * DESIGN.md §2 Layout System 참고
 */

import React from 'react';
import { OrgView } from '../views/OrgView';
import { DashboardView } from '../views/DashboardView';
import { ConsoleView } from '../views/ConsoleView';
import { WorkflowView } from '../views/WorkflowView';
import InspectorView from '../views/InspectorView';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useUIStore } from '../../stores/uiStore';

/** 뷰 ID 타입 */
type ViewId = 'org' | 'dashboard' | 'console' | 'workflow' | 'inspector';

/** 뷰 라벨 매핑 */
const VIEW_LABELS: Record<ViewId, string> = {
  org: 'Organization',
  dashboard: 'Dashboard',
  console: 'Console',
  workflow: 'Workflow',
  inspector: 'Inspector',
};

/**
 * MainAreaProps
 * - activeView: 현재 활성화된 뷰 ID
 */
interface MainAreaProps {
  activeView: string;
}

/**
 * MainArea 컴포넌트
 * - 각 뷰의 메인 콘텐츠 렌더링
 * - ErrorBoundary로 감싸서 panel별 isolation 제공 (CEO Amendment #4)
 * - 뷰 선택 탭 바 포함
 */
export const MainArea: React.FC<MainAreaProps> = ({ activeView }) => {
  const setActiveView = useUIStore((s) => s.setActiveView);

  /**
   * 뷰별 메인 콘텐츠 렌더링
   */
  const renderView = () => {
    switch (activeView) {
      case 'org':
        return <OrgView />;
      case 'dashboard':
        return <DashboardView />;
      case 'console':
        return <ConsoleView />;
      case 'workflow':
        return <WorkflowView />;
      case 'inspector':
        return <InspectorView />;
      default:
        return (
          <div className="main-area__empty">
            <div className="empty-state">
              <span className="codicon codicon-fold" style={{ fontSize: '48px' }} />
              <h3>No View Selected</h3>
              <p>Select a view from the Activity Bar to get started.</p>
            </div>
          </div>
        );
    }
  };

  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const engineLabel = selectedEngine === 'gemini' ? 'Gemini CLI' :
    selectedEngine === 'opencode' ? 'OpenCode CLI' :
    selectedEngine === 'claudecode' ? 'ClaudeCode CLI' :
    selectedEngine === 'kiro-cli' ? 'Kiro CLI' : selectedEngine;
  const engineColors: Record<string, string> = {
    gemini: 'var(--status-success)',
    opencode: 'var(--status-info)',
    claudecode: 'var(--status-warning)',
    'kiro-cli': 'var(--accent-secondary)',
  };
  const engineColor = engineColors[selectedEngine] || 'var(--text-tertiary)';

  return (
    <main className="main-area" role="main" aria-label="Main Content">
      {/* 뷰 선택 탭 바 */}
      <div className="view-selector">
        <div className="view-selector__tabs">
          {(['console', 'dashboard', 'workflow', 'inspector'] as ViewId[]).map((viewId) => (
            <button
              key={viewId}
              className={`view-btn ${activeView === viewId ? 'active' : ''}`}
              onClick={() => setActiveView(viewId)}
            >
              {VIEW_LABELS[viewId]}
            </button>
          ))}
        </div>
        <div className="view-selector__engine" style={{ color: engineColor }}>
          <span className="view-selector__engine-dot" style={{ background: engineColor }} />
          <span className="view-selector__engine-label">{engineLabel}</span>
        </div>
      </div>

      <ErrorBoundary viewId={activeView}>
        {renderView()}
      </ErrorBoundary>
    </main>
  );
};