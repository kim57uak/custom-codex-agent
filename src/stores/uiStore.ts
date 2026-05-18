/**
 * useUIStore - UI 상태 관리 (Zustand)
 *
 * 상태 유형:
 * - 레이아웃 상태: activeView, sidebarWidth, panelHeight, chatWidth
 * - 테마 상태: theme
 * - 에이전트 상태: activeEngines, activeRunCount
 * - 앱 상태: appVersion
 *
 * Persistence:
 * - theme, sidebarWidth, panelHeight, activeView만 localStorage에 저장
 * - appVersion은 sessionStorage에 저장 (앱 시작 시 결정)
 *
 * 사용 예:
 * ```typescript
 * const theme = useUIStore(s => s.theme);
 * const setTheme = useUIStore(s => s.setTheme);
 * ```
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 테마 목록 (DESIGN.md §1-3) */
type Theme = 'aurora' | 'cyber-fusion' | 'night-ops' | 'matrix-green' | 'dracula-pro' | 'glass-enterprise' | 'minimal-pro' | 'paper' | 'solarized-light' | 'nord' | 'black';

/** 뷰 ID 목록 */
type ViewId = 'org' | 'dashboard' | 'console' | 'workflow' | 'inspector';

/**
 * UIStore 상태 타입
 */
interface UIState {
  // 레이아웃 상태
  activeView: ViewId;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  panelHeight: number;
  chatWidth: number;
  chatCollapsed: boolean;
  panelExpanded: boolean;

  // 테마 상태
  theme: Theme;

  // 에이전트 상태
  activeEngines: string[];
  activeRunCount: number;

  // 앱 상태
  appVersion: string;

  // 선택된 엔진
  selectedEngine: string;

  // 워크플로 상태
  selectedWorkflowRunId: string | null;
  workflowSidebarTab: 'runs' | 'agents';
  sandboxMode: string;
  approvalPolicy: string;
}

/**
 * UIStore 액션 타입
 */
interface UIActions {
  // 레이아웃 액션
  setActiveView: (view: ViewId) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setPanelHeight: (height: number) => void;
  setChatWidth: (width: number) => void;
  toggleChat: () => void;
  togglePanelExpand: () => void;

  // 테마 액션
  setTheme: (theme: Theme) => void;

  // 에이전트 액션
  setActiveEngines: (engines: string[]) => void;
  setActiveRunCount: (count: number) => void;

  // 앱 액션
  setAppVersion: (version: string) => void;

  // 엔진 액션
  setSelectedEngine: (engine: string) => void;

  // 워크플로 액션
  setSelectedWorkflowRunId: (id: string | null) => void;
  setWorkflowSidebarTab: (tab: 'runs' | 'agents') => void;
  setSandboxMode: (mode: string) => void;
  setApprovalPolicy: (policy: string) => void;
}

/** UIStore 전체 타입 */
type UIStore = UIState & UIActions;

/**
 * initial state
 */
const initialState: UIState = {
  activeView: 'org',
  sidebarWidth: 250,
  sidebarCollapsed: false,
  panelHeight: 200,
  chatWidth: 320,
  chatCollapsed: false,
  panelExpanded: false,
  theme: 'aurora',
  activeEngines: ['gemini', 'opencode'],
  activeRunCount: 0,
  appVersion: '0.1.0',
  selectedEngine: 'gemini',
  selectedWorkflowRunId: null,
  workflowSidebarTab: 'agents',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'never',
};

/**
 * UIStore 생성
 * - persist 미들웨어: theme, sidebarWidth, panelHeight, activeView만 localStorage에 저장
 * - 그 외 상태 (appVersion, activeRunCount 등)는 session에서 유지
 */
export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      ...initialState,

      // 레이아웃 액션
      setActiveView: (view) => set({ activeView: view }),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(170, Math.min(500, width)) }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setPanelHeight: (height) => set({ panelHeight: Math.max(100, Math.min(500, height)) }),
      setChatWidth: (width) => set({ chatWidth: Math.max(100, Math.min(600, width)) }),
      toggleChat: () => set((state) => {
        const willShow = state.chatCollapsed;
        return { chatCollapsed: !state.chatCollapsed, chatWidth: willShow ? Math.max(state.chatWidth, 260) : state.chatWidth };
      }),
      togglePanelExpand: () => set((state) => ({ panelExpanded: !state.panelExpanded })),

      // 테마 액션
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },

      // 에이전트 액션
      setActiveEngines: (engines) => set({ activeEngines: engines }),
      setActiveRunCount: (count) => set({ activeRunCount: count }),

      // 앱 액션
      setAppVersion: (version) => set({ appVersion: version }),

      // 엔진 액션
      setSelectedEngine: (engine) => set({ selectedEngine: engine }),

      // 워크플로 액션
      setSelectedWorkflowRunId: (id) => set({ selectedWorkflowRunId: id }),
      setWorkflowSidebarTab: (tab) => set({ workflowSidebarTab: tab }),
      setSandboxMode: (mode) => set({ sandboxMode: mode }),
      setApprovalPolicy: (policy) => set({ approvalPolicy: policy }),
    }),
    {
      name: 'agent-orchestrator-ui',
      // persist할 상태만 선택 (불필요한 상태 localStorage 저장 방지)
      partialize: (state) => ({
        activeView: state.activeView,
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        panelHeight: state.panelHeight,
        chatWidth: state.chatWidth,
        chatCollapsed: state.chatCollapsed,
        panelExpanded: state.panelExpanded,
        theme: state.theme,
        selectedEngine: state.selectedEngine,
      }),
    }
  )
);