/**
 * App.tsx - React 애플리케이션 진입점
 *
 * 레이아웃 구조:
 * ┌─────────┬─────────────────────────────┬────────────┐
 * │Activity │  Sidebar    │  Main Area   │ Chat       │
 * │ Bar     │             │              │ Sidepanel  │
 * ├─────────┴─────────────┴──────────────┴────────────┤
 * │  Panel (Terminal / Output / Events / Problems)   │
 * ├───────────────────────────────────────────────────┤
 * │  Status Bar                                       │
 * └───────────────────────────────────────────────────┘
 *
 * 사용 기술:
 * - @vscode/webview-ui-toolkit: VS Code 디자인 시스템 컴포넌트
 * - CSS Variables: 10개 테마 지원 (DESIGN.md §1-3)
 * - Zustand: UI 상태 관리 (§3)
 */

import React, { useEffect } from 'react';
import { ActivityBar } from './components/layout/ActivityBar';
import { Sidebar } from './components/layout/Sidebar';
import { MainArea } from './components/layout/MainArea';
import { Panel } from './components/layout/Panel';
import { StatusBar } from './components/layout/StatusBar';
import { ChatSidepanel } from './components/ai-chat/ChatSidepanel';
import { useUIStore } from './stores/uiStore';
import './styles/global.css';

/**
 * App 컴포넌트
 * - 레이아웃 컨테이너
 * - 테마 초기화 (localStorage에서 restored)
 * - IPC 버전 확인 (Plan-eng-review E5)
 *
 * sidebar 표시 규칙:
 * - org (Organize): 숨김 (에이전트는 3번째 패널로 이동)
 * - dashboard: 표시
 * - console: 숨김
 * - workflow: 표시
 * - inspector: 표시
 */
const App: React.FC = () => {
  const theme = useUIStore((s) => s.theme);
  const activeView = useUIStore((s) => s.activeView);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const chatCollapsed = useUIStore((s) => s.chatCollapsed);
  const chatWidth = useUIStore((s) => s.chatWidth);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleChat = useUIStore((s) => s.toggleChat);
  const setSelectedEngine = useUIStore((s) => s.setSelectedEngine);



  // activeView에 따라 sidebar 표시 여부 결정 (Sidebar.tsx와 동기화)
  const sidebarNeeded = !sidebarCollapsed && activeView !== 'org' && activeView !== 'console';

  /**
   * 컴포넌트 마운트 시 테마 적용
   * - localStorage에서 저장된 테마 restored
   * - document.documentElement.dataset.theme으로 테마 전환
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-w', `${chatWidth}px`);
  }, [chatWidth]);

  /**
   * IPC 버전 확인 핸드셰이크
   * - Plan-eng-review E5: hot-reload TypeError 방지
   * - 버전 불일치 시 콘솔 경고
   */
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.versionCheck().then((result: { version: string; minVersion: string }) => {
        if (result.version !== '1.0.0') {
          console.warn(`[IPC Version Mismatch] expected: 1.0.0, got: ${result.version}`);
        }
      }).catch(() => {
        // 버전 확인 실패 시 silent (dev mode 등)
      });
    }
  }, []);

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `var(--activity-bar-w) ${sidebarNeeded ? 'var(--sidebar-w)' : '0px'} 1fr ${chatCollapsed ? '0px' : 'var(--chat-w)'}`,
  };

  return (
    <div className="app-shell" style={gridStyle}>
      {/* Activity Bar (좌측 고정, 48px) */}
      <ActivityBar
        activeView={activeView}
        onViewChange={setActiveView}
        onToggleSidebar={toggleSidebar}
        onToggleChat={toggleChat}
        onSettings={() => setActiveView('inspector')}
        sidebarVisible={sidebarNeeded}
      />

      {/* Sidebar (가변 너비, 250px 기본, collapsible) */}
      <Sidebar activeView={activeView} />

      {/* Main Area (남은 공간) */}
      <MainArea activeView={activeView} />

      {/* Chat Sidepanel (가변 너비, 320px 기본, collapsible) */}
      <ChatSidepanel collapsed={chatCollapsed} onToggle={toggleChat} />

      {/* Panel (하단 고정, 200px 기본) */}
      <Panel />

      {/* Status Bar (하단 고정, 28px) */}
      <StatusBar />
    </div>
  );
};

export default App;