/**
 * Sidebar - 좌측 사이드바
 *
 * 위치: app-shell의 좌측 (grid area: "sidebar")
 * 너비: 260px 기본 (mockup 기준), 최소 170px, 드래그 핸들러로 resize 가능
 *
 * DESIGN.md §2 Layout System 참고
 */

import React, { useRef, useCallback } from 'react';
import { OrgTree } from '../views/OrgView';
import { DashboardSidebar } from '../views/DashboardView';
import { ConsoleSidebar } from '../views/ConsoleView';
import { WorkflowSidebar } from '../views/WorkflowView';
import { InspectorSidebar } from '../views/inspector/InspectorSidebar';
import { useUIStore } from '../../stores/uiStore';
import { useResizeHandle } from '../../hooks/useResizeHandle';

/**
 * Sidebar 컴포넌트
 * - activeView prop에 따라 콘텐츠 변경
 * - sidebar-panel 패턴 사용
 *
 * 좌측 2번째 패널 표시 규칙:
 * - org (Organize): 숨김 (에이전트는 3번째 패널로 이동)
 * - dashboard: 표시 (DashboardSidebar)
 * - console: 숨김
 * - workflow: 표시 (WorkflowSidebar) + 스크롤
 * - inspector: 표시 (InspectorSidebar) + 스크롤
 */
export const Sidebar: React.FC<{ activeView: string }> = ({ activeView }) => {
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const resizeRef = useResizeHandle({
    direction: 'horizontal',
    onResize: (delta) => {
      setSidebarWidth(useUIStore.getState().sidebarWidth + delta);
    },
  });

  /**
   * 뷰별 사이드바 패널 렌더링
   */
  const renderPanel = () => {
    switch (activeView) {
      case 'org':
        // org에서는 사이드바 숨김 (에이전트가 3번째 패널로 이동)
        return null;
      case 'dashboard':
        return (
          <div className="sidebar-panel active" id="sidebar-dashboard" style={{ overflowY: 'auto' }}>
            <DashboardSidebar />
          </div>
        );
      case 'console':
        // console에서는 사이드바 숨김
        return null;
      case 'workflow':
        return (
          <div className="sidebar-panel active" id="sidebar-workflow" style={{ overflowY: 'auto' }}>
            <WorkflowSidebar />
          </div>
        );
      case 'inspector':
        return (
          <div className="sidebar-panel active" id="sidebar-inspector">
            <InspectorSidebar />
          </div>
        );
      default:
        return (
          <div className="sidebar__empty">
            <span className="codicon codicon-chrome-minimize" />
            <p>Select a view from the Activity Bar</p>
          </div>
        );
    }
  };

  // 사이드바가 비어있을 때 렌더링하지 않음 (App.tsx의 gridStyle과 동기화)
  // org만 숨김 (에이전트가 메인으로 이동), console도 숨김, dashboard/workflow/inspector는 표시
  const sidebarNeeded = activeView !== 'org' && activeView !== 'console';
  if (!sidebarNeeded) {
    return null;
  }

  return (
    <aside
      className="sidebar"
      role="complementary"
      aria-label="Sidebar"
      style={{ width: sidebarWidth }}
    >
      {/* 사이드바 콘텐츠 (sidebar-panel 패턴) */}
      <div className="sidebar-content">
        {renderPanel()}
      </div>

      {/* 리사이즈 핸들러 */}
      <div className="sidebar__resize-handle" role="separator" aria-orientation="vertical" />
    </aside>
  );
};