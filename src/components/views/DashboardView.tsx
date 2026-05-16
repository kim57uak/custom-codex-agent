/**
 * DashboardView - 대시보드 뷰
 *
 * 모든 차트는 실제 run 데이터 기반.
 * - 7일 추이: runs, success rate, avg duration, failures
 * - 분포: engine breakdown, agent workload
 * - 비교: weekly runs, active agents
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { OverviewResponse, InventoryResponse } from '../../../types/ipc-contract';

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

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function toBars(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => Math.round((v / max) * 100));
}

interface DailyStat {
  label: string;
  total: number;
  completed: number;
  failed: number;
  avgDur: number;
}

function computeDailyStats(runs: RunRecord[], days = 7): DailyStat[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const out: DailyStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now - i * dayMs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + dayMs);
    const dayRuns = runs.filter(r => {
      const t = new Date(r.createdAt).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    const total = dayRuns.length;
    out.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      total,
      completed: dayRuns.filter(r => r.status === 'completed').length,
      failed: dayRuns.filter(r => r.status === 'failed').length,
      avgDur: total > 0 ? Math.round(dayRuns.reduce((s, r) => s + (r.durationMs ?? 0), 0) / total) : 0,
    });
  }
  return out;
}

/** MetricCard - 메트릭 카드 + 실제 데이터 차트 */
const MetricCard: React.FC<{
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down';
  bars: number[];
  labels?: string[];
  barColor?: string;
}> = ({ label, value, change, trend, bars, labels, barColor }) => {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {change && <div className={`metric-change ${trend ?? ''}`}>{change}</div>}
      <div className="mini-chart" style={{ height: '44px', marginTop: '8px' }}>
        {bars.map((h, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, height: '100%' }}>
            <div style={{ width: '100%', height: `${Math.max(h, 3)}%`, background: barColor ?? 'var(--accent-primary)', borderRadius: '2px 2px 0 0', minHeight: '0' }} />
            {labels && (
              <div title={labels[i]} style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', textAlign: 'center' }}>
                {labels[i]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** DashboardView - 메인 영역용 대시보드 */
export const DashboardView: React.FC = () => {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [runResult, overviewResult, invResult] = await Promise.all([
      ipcInvoke<{ runs: RunRecord[] }>('run:list'),
      ipcInvoke<OverviewResponse>('dashboard:overview'),
      ipcInvoke<InventoryResponse>('dashboard:inventory'),
    ]);
    if (runResult?.runs) setRuns(runResult.runs);
    if (overviewResult) setOverview(overviewResult);
    if (invResult) setInventory(invResult);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const daily = useMemo(() => computeDailyStats(runs), [runs]);
  const dailyLabels = useMemo(() => daily.map(d => d.label), [daily]);

  const totalRuns = runs.length;
  const completedRuns = runs.filter(r => r.status === 'completed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;
  const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
  const avgDuration = runs.length > 0
    ? Math.round(runs.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / runs.length)
    : 0;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const thisWeekRuns = runs.filter(r => new Date(r.createdAt).getTime() > now - 7 * dayMs).length;
  const lastWeekRuns = runs.filter(r => {
    const t = new Date(r.createdAt).getTime();
    return t > now - 14 * dayMs && t <= now - 7 * dayMs;
  }).length;
  const runChange = lastWeekRuns > 0 ? Math.round(((thisWeekRuns - lastWeekRuns) / lastWeekRuns) * 100) : 0;

  const thisWeekAvg = (() => {
    const weekRuns = runs.filter(r => new Date(r.createdAt).getTime() > now - 7 * dayMs);
    return weekRuns.length > 0 ? Math.round(weekRuns.reduce((s, r) => s + (r.durationMs ?? 0), 0) / weekRuns.length) : 0;
  })();
  const lastWeekAvg = (() => {
    const weekRuns = runs.filter(r => {
      const t = new Date(r.createdAt).getTime();
      return t > now - 14 * dayMs && t <= now - 7 * dayMs;
    });
    return weekRuns.length > 0 ? Math.round(weekRuns.reduce((s, r) => s + (r.durationMs ?? 0), 0) / weekRuns.length) : 0;
  })();
  const avgDurChange = lastWeekAvg > 0 ? Math.round(((thisWeekAvg - lastWeekAvg) / lastWeekAvg) * 100) : 0;

  const engineMap = useMemo(() => {
    return runs.reduce((acc, r) => {
      const e = r.engine ?? 'unknown';
      acc[e] = (acc[e] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [runs]);
  const engineEntries = useMemo(() => Object.entries(engineMap).sort((a, b) => b[1] - a[1]), [engineMap]);
  const dominantEngine = engineEntries[0];
  const dominantEnginePct = totalRuns > 0 && dominantEngine ? Math.round((dominantEngine[1] / totalRuns) * 100) : 0;

  const agentMap = useMemo(() => {
    return runs.reduce((acc, r) => {
      acc[r.agentId] = (acc[r.agentId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [runs]);
  const agentEntries = useMemo(() => Object.entries(agentMap).sort((a, b) => b[1] - a[1]).slice(0, 5), [agentMap]);

  const activeAgents = overview?.activeAgents ?? 0;
  const totalAgents = overview?.totalAgents ?? inventory?.agents?.length ?? 0;
  const totalSkills = overview?.totalSkills ?? inventory?.skills?.length ?? 0;
  const routedAgents = overview?.routedAgents ?? 0;
  const brokenMappings = overview?.brokenMappings ?? 0;

  if (isLoading) {
    return (
      <div className="dashboard-view">
        <div className="main-toolbar"><h1 className="title">Dashboard</h1><span className="subtitle">Loading...</span></div>
        <div className="main-content">
          <div className="loading-spinner"><div className="spinner" /><span>Loading dashboard...</span></div>
        </div>
      </div>
    );
  }

  if (runs.length === 0 && !overview) {
    return (
      <div className="dashboard-view">
        <div className="main-toolbar"><h1 className="title">Dashboard</h1><span className="subtitle">Last 7 days</span></div>
        <div className="main-content">
          <div className="empty-state">
            <div className="empty-state__icon"><span className="codicon codicon-graph" /></div>
            <h3>No runs yet</h3>
            <p>Run your first agent to see metrics here.</p>
            <button className="btn-cta" onClick={loadData}>Refresh</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-view">
      <div className="main-toolbar">
        <h1 className="title">Dashboard</h1>
        <span className="subtitle">Real data &middot; Last 7 days</span>
      </div>

      <div className="main-content">
        <div className="metrics-grid">
          <MetricCard
            label="Total Runs (7d)"
            value={totalRuns}
            change={runChange !== 0 ? `${runChange > 0 ? '▲' : '▼'} ${Math.abs(runChange)}% vs last week` : 'No change'}
            trend={runChange >= 0 ? 'up' : 'down'}
            bars={toBars(daily.map(d => d.total))}
            labels={dailyLabels}
          />
          <MetricCard
            label="Success Rate (7d)"
            value={`${successRate}%`}
            change={daily.length > 0 ? `${daily.filter(d => d.total > 0 && d.completed === d.total).length} perfect days` : 'No data'}
            trend={successRate >= 80 ? 'up' : 'down'}
            bars={daily.map(d => d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0)}
            labels={dailyLabels}
            barColor="var(--accent-success)"
          />
          <MetricCard
            label="Avg Duration (7d)"
            value={avgDuration > 0 ? fmtMs(avgDuration) : 'N/A'}
            change={avgDurChange !== 0 ? `${avgDurChange > 0 ? '▲' : '▼'} ${Math.abs(avgDurChange)}% vs last week` : 'No change'}
            trend={avgDurChange <= 0 ? 'up' : 'down'}
            bars={toBars(daily.map(d => d.avgDur))}
            labels={dailyLabels}
            barColor="var(--accent-warning)"
          />
          <MetricCard
            label="Engine Breakdown"
            value={dominantEngine ? `${dominantEngine[0]} ${dominantEnginePct}%` : 'N/A'}
            change={`${engineEntries.length} engines used`}
            trend="up"
            bars={toBars(engineEntries.map(([, c]) => c))}
            labels={engineEntries.map(([e]) => e.slice(0, 6))}
            barColor="var(--status-info)"
          />
        </div>

        <div className="metrics-grid" style={{ marginTop: 'var(--space-4)' }}>
          <MetricCard
            label="Active Agents"
            value={activeAgents}
            change={totalAgents > 0 ? `${Math.round((activeAgents / totalAgents) * 100)}% of ${totalAgents}` : 'No data'}
            trend="up"
            bars={toBars([activeAgents, Math.max(0, totalAgents - activeAgents)])}
            labels={['Active', 'Idle']}
            barColor="var(--accent-primary)"
          />
          <MetricCard
            label="Agent Workload"
            value={agentEntries[0]?.[0] ?? 'N/A'}
            change={`${agentEntries[0]?.[1] ?? 0} runs`}
            trend="up"
            bars={toBars(agentEntries.map(([, c]) => c))}
            labels={agentEntries.map(([name]) => name.slice(0, 6))}
            barColor="var(--status-success)"
          />
          <MetricCard
            label="Failed Runs (7d)"
            value={failedRuns}
            change={totalRuns > 0 ? `${Math.round((failedRuns / totalRuns) * 100)}% failure rate` : 'No data'}
            trend="down"
            bars={toBars(daily.map(d => d.failed))}
            labels={dailyLabels}
            barColor="var(--status-error)"
          />
          <MetricCard
            label="Weekly Comparison"
            value={thisWeekRuns}
            change={lastWeekRuns > 0 ? `${Math.abs(runChange)}% ${runChange >= 0 ? 'growth' : 'decline'}` : 'No prior data'}
            trend={runChange >= 0 ? 'up' : 'down'}
            bars={toBars([thisWeekRuns, lastWeekRuns])}
            labels={['This week', 'Last week']}
            barColor="var(--accent-tertiary)"
          />
        </div>

        {/* Snapshot strip */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div className="metric-card" style={{ flex: 1, minWidth: '200px' }}>
            <div className="metric-label">Skills</div>
            <div className="metric-value">{totalSkills}</div>
            <div className="metric-change">{routedAgents} agents routed</div>
          </div>
          <div className="metric-card" style={{ flex: 1, minWidth: '200px' }}>
            <div className="metric-label">Broken Mappings</div>
            <div className="metric-value" style={{ color: brokenMappings > 0 ? 'var(--status-error)' : 'var(--accent-success)' }}>{brokenMappings}</div>
            <div className="metric-change">{brokenMappings > 0 ? 'Needs attention' : 'All clear'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** DashboardSidebar - 사이드바용 대시보드 컴포넌트 */
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

export const DashboardSidebar: React.FC = () => {
  const [stats, setStats] = useState<{ totalRuns: number; activeAgents: number; avgDuration: string; successRate?: number }>({
    totalRuns: 0, activeAgents: 0, avgDuration: '0ms', successRate: 0,
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
    if (result?.activities) setActivities(result.activities);
    setActivityLoading(false);
  };

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
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
