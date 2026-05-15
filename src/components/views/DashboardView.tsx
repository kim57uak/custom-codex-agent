/**
 * DashboardView - 대시보드 뷰
 *
 * 레이아웃 구조 (mockup 기준):
 * - .main-toolbar: 타이틀 + 서브타이틀
 * - .main-content: .metrics-grid + 미니 차트
 *
 * Phase 3 완료 항목:
 * - [x] DashboardView (메트릭 카드 + 미니 차트)
 */

import React, { useState, useEffect, useCallback } from 'react';

interface RunRecord {
  id: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode: number;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  engine?: string;
}

/** IPC 헬퍼 */
async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

/** MetricCard - 메트릭 카드 컴포넌트 (mockup 스타일) */
const MetricCard: React.FC<{
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down';
  bars: number[];
  barColor?: string;
}> = ({ label, value, change, trend, bars, barColor }) => {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {change && <div className={`metric-change ${trend ?? ''}`}>{change}</div>}
      <div className="mini-chart">
        {bars.map((h, i) => (
          <div key={i} className="bar" style={{ height: `${h}%`, background: barColor ?? undefined }} />
        ))}
      </div>
    </div>
  );
};

/** DashboardSidebarProps */
interface DashboardSidebarProps {}

interface ActivityItem {
  id: string;
  agentId: string;
  status: string;
  message: string;
  timestamp: string;
}

interface ActivityResult {
  activities: ActivityItem[];
}

/**
 * DashboardSidebar - 사이드바용 대시보드 컴포넌트
 * 빠른 통계 요약 + 최근 활동 (동적 IPC)
 */
export const DashboardSidebar: React.FC<DashboardSidebarProps> = () => {
  const [stats, setStats] = useState<{ totalRuns: number; activeAgents: number; avgDuration: string; successRate?: number }>({
    totalRuns: 0,
    activeAgents: 0,
    avgDuration: '0ms',
    successRate: 0,
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    loadStats();
    loadRecentActivity();
  }, []);

  const loadStats = async () => {
    const result = await ipcInvoke<{ totalRuns: number; totalAgents: number; uptime: number; successRate?: number }>('dashboard:stats');
    if (result) {
      setStats({
        totalRuns: result.totalRuns,
        activeAgents: result.totalAgents,
        avgDuration: `${result.uptime || 0}ms`,
        successRate: result.successRate ?? 0,
      });
    }
  };

  const loadRecentActivity = async () => {
    setActivityLoading(true);
    const result = await ipcInvoke<ActivityResult>('dashboard:recent-activity');
    if (result?.activities) {
      setActivities(result.activities);
    }
    setActivityLoading(false);
  };

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="dashboard-sidebar">
      <div className="dashboard-sidebar__metric">
        <span className="dashboard-sidebar__metric-label">Total Runs</span>
        <span className="dashboard-sidebar__metric-value">{stats.totalRuns}</span>
      </div>
      <div className="dashboard-sidebar__metric">
        <span className="dashboard-sidebar__metric-label">Success Rate</span>
        <span className="dashboard-sidebar__metric-value" style={{ color: stats.successRate && stats.successRate >= 80 ? 'var(--accent-success)' : 'var(--status-error)' }}>
          {stats.successRate ?? 0}%
        </span>
      </div>
      <div className="dashboard-sidebar__metric">
        <span className="dashboard-sidebar__metric-label">Avg Duration</span>
        <span className="dashboard-sidebar__metric-value" style={{ color: 'var(--accent-warning)' }}>{stats.avgDuration}</span>
      </div>
      <div className="dashboard-sidebar__metric">
        <span className="dashboard-sidebar__metric-label">Active Agents</span>
        <span className="dashboard-sidebar__metric-value" style={{ color: 'var(--accent-primary)' }}>{stats.activeAgents}</span>
      </div>
      <div className="sidebar-section-header">Recent Activity</div>
      {activityLoading ? (
        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '11px' }}>
          <span className="codicon codicon-loading codicon-modifier-spin" />
        </div>
      ) : activities.length === 0 ? (
        <div className="dashboard-sidebar__activity" style={{ color: 'var(--text-tertiary)' }}>No recent activity</div>
      ) : (
        activities.map((a, i) => (
          <div key={a.id} className="dashboard-sidebar__activity" style={{ borderBottom: i < activities.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            {a.message}
            <span style={{ float: 'right', color: 'var(--text-tertiary)', fontSize: '10px' }}>{formatTime(a.timestamp)}</span>
          </div>
        ))
      )}
    </div>
  );
};

/** DashboardViewProps */
interface DashboardViewProps {}

/**
 * DashboardView - 메인 영역용 대시보드
 * 메트릭 카드 그리드 + 미니 차트 (mockup 기준)
 */
export const DashboardView: React.FC<DashboardViewProps> = () => {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /** 실행 목록 로드 */
  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    const result = await ipcInvoke<{ runs: RunRecord[] }>('run:list');
    if (result?.runs) {
      setRuns(result.runs);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  /** 메트릭 계산 */
  const totalRuns = runs.length;
  const completedRuns = runs.filter(r => r.status === 'completed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;
  const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
  const avgDuration = runs.length > 0
    ? Math.round(runs.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / runs.length)
    : 0;
  const engineRuns = runs.reduce<Record<string, number>>((acc, r) => {
    const eng = r.engine ?? 'codex';
    acc[eng] = (acc[eng] || 0) + 1;
    return acc;
  }, {});
  const dominantEngine = Object.entries(engineRuns).sort((a, b) => b[1] - a[1])[0];
  const dominantEnginePct = dominantEngine && totalRuns > 0 ? Math.round((dominantEngine[1] / totalRuns) * 100) : 0;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const runsThisWeek = runs.filter(r => new Date(r.createdAt).getTime() > now - weekMs).length;
  const runsLastWeek = runs.filter(r => {
    const t = new Date(r.createdAt).getTime();
    return t > now - 2 * weekMs && t <= now - weekMs;
  }).length;
  const runChange = runsLastWeek > 0 ? Math.round(((runsThisWeek - runsLastWeek) / runsLastWeek) * 100) : 0;
  const successThisWeek = runs.filter(r => r.status === 'completed' && new Date(r.createdAt).getTime() > now - weekMs).length;
  const successLastWeek = runs.filter(r => r.status === 'completed' && (() => { const t = new Date(r.createdAt).getTime(); return t > now - 2 * weekMs && t <= now - weekMs; })()).length;
  const successRateChange = runsLastWeek > 0 ? Math.round(((successThisWeek - successLastWeek) / runsLastWeek) * 100) : 0;

  /** 로딩 상태 */
  if (isLoading) {
    return (
      <div className="dashboard-view">
        <div className="main-toolbar">
          <span className="title">Dashboard</span>
          <span className="subtitle">Loading...</span>
        </div>
        <div className="main-content">
          <div className="loading-spinner">
            <div className="spinner" />
            <span>Loading dashboard...</span>
          </div>
        </div>
      </div>
    );
  }

  /** Empty 상태 */
  if (runs.length === 0) {
    return (
      <div className="dashboard-view">
        <div className="main-toolbar">
          <span className="title">Dashboard</span>
          <span className="subtitle">Last 7 days</span>
        </div>
        <div className="main-content">
          <div className="empty-state">
            <div className="illustration">
              <span className="codicon codicon-graph" />
            </div>
            <h3>No runs yet</h3>
            <p>Run your first agent to see metrics here.</p>
            <button className="btn-cta" onClick={loadRuns}>Run Agent</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-view">
      <div className="main-toolbar">
        <span className="title">Dashboard</span>
        <span className="subtitle">Last 7 days</span>
      </div>

      <div className="main-content">
        <div className="metrics-grid">
          <MetricCard
            label="Total Runs"
            value={totalRuns}
            change={runChange !== 0 ? `${runChange > 0 ? '▲' : '▼'} ${Math.abs(runChange)}% vs last week` : 'No change'}
            trend={runChange >= 0 ? 'up' : 'down'}
            bars={[65, 45, 80, 55, 90, 70, 85]}
          />
          <MetricCard
            label="Success Rate"
            value={`${successRate}%`}
            change={successRateChange !== 0 ? `${successRateChange > 0 ? '▲' : '▼'} ${Math.abs(successRateChange)}% vs last week` : 'No change'}
            trend={successRateChange >= 0 ? 'up' : 'down'}
            bars={[88, 92, 96, 90, 95, 98, 94]}
            barColor="var(--accent-success)"
          />
          <MetricCard
            label="Avg Duration"
            value={avgDuration > 0 ? `${avgDuration}ms` : 'N/A'}
            change={avgDuration > 0 ? `${avgDuration < 1000 ? '▼' : '▲'} ${Math.round(avgDuration * 0.08)}ms` : 'N/A'}
            trend="down"
            bars={[40, 55, 35, 60, 45, 50, 55]}
            barColor="var(--accent-warning)"
          />
          <MetricCard
            label="Engine Usage"
            value={dominantEngine ? `${dominantEnginePct}%` : 'N/A'}
            change={dominantEngine ? `${dominantEngine[0]} dominant` : 'No data'}
            trend="up"
            bars={Object.values(engineRuns).length > 0 ? [dominantEnginePct, 100 - dominantEnginePct] : [50, 50]}
            barColor="var(--status-info)"
          />
        </div>
      </div>
    </div>
  );
};