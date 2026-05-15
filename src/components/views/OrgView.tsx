/**
 * OrgView + OrgTree - Organization 뷰
 *
 * 기능:
 * - 에이전트 계층 트리 표시 (부서별 그룹핑 + 트리 형태)
 * - 에이전트 선택 시 상세 정보 표시
 * - 계층형 조직도 (HUD bar → Founder card → Router → Department clusters)
 * - 부서 정보는 각 에이전트 설정(config.json)의 department 필드를 기준으로 동적 그룹핑
 * - department 필드가 없으면 엔진명을 부서명으로 사용
 *
 * 구성:
 * - OrgTree: 사이드바용 트리 컴포넌트 (부서별 그룹)
 * - OrgView: 메인 영역용 계층형 조직도
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AgentConfig } from '../../../types/ipc-contract';

const DEPT_META: Record<string, { label: string; deptEn: string; color: string; icon: string }> = {
  '개발팀': { label: '개발팀', deptEn: 'Engineering', color: 'var(--accent-primary)', icon: 'device-terminal' },
  '전략 기획팀': { label: '전략 기획팀', deptEn: 'Strategic Planning', color: 'var(--status-success)', icon: 'sparkles' },
  '플랫폼 지원팀': { label: '플랫폼 지원팀', deptEn: 'Platform Support', color: 'var(--status-info)', icon: 'symbol-method' },
  '품질 검증팀': { label: '품질 검증팀', deptEn: 'Quality', color: 'var(--status-warning)', icon: 'beaker' },
  '콘텐츠 자산팀': { label: '콘텐츠 자산팀', deptEn: 'Content Assets', color: 'var(--accent-tertiary)', icon: 'file' },
  '플랫폼 운영팀': { label: '플랫폼 운영팀', deptEn: 'Platform Ops', color: 'var(--status-error)', icon: 'settings-gear' },
  '경영진': { label: '경영진', deptEn: 'Executive Office', color: 'var(--accent-secondary)', icon: 'organization' },
  '마케팅/영업/CS': { label: '마케팅/영업/CS', deptEn: 'Sales · CS', color: '#ec4899', icon: 'megaphone' },
};

function getDeptMeta(dept: string): { label: string; deptEn: string; color: string; icon: string } {
  return DEPT_META[dept] ?? {
    label: dept,
    deptEn: dept,
    color: 'var(--text-tertiary)',
    icon: 'account',
  };
}

async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

interface AgentGroup {
  dept: string;
  agents: AgentConfig[];
}

/** OrgTreeGroup - 부서별 그룹 (아코디언) */
const OrgTreeGroup: React.FC<{ group: AgentGroup; selectedId: string | null; onSelect: (agent: AgentConfig) => void }> = ({ group, selectedId, onSelect }) => {
  const [expanded, setExpanded] = useState(true);
  const meta = getDeptMeta(group.dept);
  return (
    <div className="org-tree__group">
      <div className="org-tree__group-header" onClick={() => setExpanded(!expanded)}>
        <span className={`chevron ${expanded ? 'open' : ''}`}>{'\u25B6'}</span>
        <span style={{ flex: 1 }}>{meta.label}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{group.agents.length}</span>
      </div>
      {expanded && (
        <div className="org-tree__children">
          {group.agents.map((agent) => (
            <div
              key={agent.id}
              className={`org-tree__agent ${selectedId === agent.id ? 'active' : ''}`}
              onClick={() => onSelect(agent)}
              role="treeitem"
              aria-selected={selectedId === agent.id}
            >
              <span className={`codicon codicon-${meta.icon}`} style={{ fontSize: '14px' }} />
              <span className="org-tree__name">{agent.name}</span>
              <span className={`status-dot online`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** OrgTreeProps */
interface OrgTreeProps {
  onSelectAgent?: (agent: AgentConfig) => void;
}

/**
 * OrgTree - 사이드바용 에이전트 계층 트리
 * 엔진별로 그룹핑된 에이전트 목록 (모든 4개 엔진)
 */
export const OrgTree: React.FC<OrgTreeProps> = ({ onSelectAgent }) => {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function groupByDept(agents: AgentConfig[]): AgentGroup[] {
    const map = new Map<string, AgentConfig[]>();
    for (const agent of agents) {
      const dept = agent.department || agent.engine;
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(agent);
    }
    return Array.from(map.entries())
      .map(([dept, agts]) => ({ dept, agents: agts }))
      .sort((a, b) => a.dept.localeCompare(b.dept));
  }

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await ipcInvoke<AgentConfig[]>('agents:list');
    if (result) {
      setGroups(groupByDept(result));
    } else {
      setError('에이전트 목록을 불러올 수 없습니다');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleSelect = (agent: AgentConfig) => {
    setSelectedId(agent.id);
    onSelectAgent?.(agent);
    window.electronAPI?.send('org:agent-selected', agent);
  };

  const handleAddAgent = () => {
    window.electronAPI?.send('org:add-agent');
  };

  if (isLoading) {
    return (
      <div className="org-tree">
        <div className="sidebar-section-header">Agents</div>
        <div className="org-tree__loading">
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <p>Loading agents...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="org-tree">
        <div className="sidebar-section-header">Agents</div>
        <div className="org-tree__empty">
          <span className="codicon codicon-error" />
          <p>{error}</p>
          <button className="org-tree__cta" onClick={loadAgents}>Retry</button>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="org-tree">
        <div className="sidebar-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Agents</span>
          <button onClick={handleAddAgent} title="Add Agent" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '14px' }}>+</button>
        </div>
        <div className="org-tree__empty">
          <span className="codicon codicon-account" style={{ fontSize: '32px' }} />
          <p>No agents configured</p>
          <button className="org-tree__cta" onClick={handleAddAgent}>Configure Agent</button>
        </div>
      </div>
    );
  }

  return (
    <div className="org-tree">
      <div className="sidebar-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Agents</span>
        <button onClick={handleAddAgent} title="Add Agent" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '14px' }}>+</button>
      </div>
      <div role="tree">
        {groups.map((group) => (
          <OrgTreeGroup
            key={group.dept}
            group={group}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
};

/** OrgViewProps */
interface OrgViewProps {}

/**
 * OrgView - 메인 영역용 계층형 조직도 (Hierarchical Org Chart)
 *
 * 좌측 3번째 패널 (Main Area)에서 에이전트를 표시합니다.
 * (Sidebar에서 OrgTree가 제거됨 - 에이전트가 메인으로 이동)
 *
 * 레이아웃 (mockup 기준):
 *   Main Toolbar (title + stats)
 *   HUD Stats Bar (PC Owner, Router, Departments, Agents, Skills badges)
 *   ─────────────────────────────────────
 *   Scrollable Canvas:
 *     Founder Card (PC Owner, centered)
 *     CEO Card
 *     Router Agent Card
 *     Department Grid (collapsible, one per engine)
 *       ├── Dept Header (name + count)
 *       └── Agent Cards (status dot + name + description)
 */
export const OrgView: React.FC<OrgViewProps> = () => {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [stats, setStats] = useState<{ totalRuns: number; totalAgents: number }>({ totalRuns: 0, totalAgents: 0 });
  const [departments, setDepartments] = useState<Array<{ dept: string; agents: AgentConfig[] }>>([]);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const [agentList, dashboardStats] = await Promise.all([
        ipcInvoke<AgentConfig[]>('agents:list'),
        ipcInvoke<{ totalRuns: number; totalAgents: number }>('dashboard:stats'),
      ]);
      if (agentList) {
        setAgents(agentList);
        const map = new Map<string, AgentConfig[]>();
        for (const agent of agentList) {
          const dept = agent.department || agent.engine;
          if (!map.has(dept)) map.set(dept, []);
          map.get(dept)!.push(agent);
        }
        const depts = Array.from(map.entries())
          .map(([dept, agts]) => ({ dept, agents: agts }))
          .sort((a, b) => a.dept.localeCompare(b.dept));
        setDepartments(depts);
        setExpandedDepts(new Set(depts.map(d => d.dept)));
      }
      if (dashboardStats) setStats(dashboardStats);
    })();
  }, []);

  const toggleDept = (dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const totalAgents = agents.length;
  const totalDepartments = departments.length;
  const username = 'dolpaks';

  return (
    <div className="org-view">
      {/* Main Toolbar */}
      <div className="org-view__toolbar">
        <h1 className="org-view__toolbar-title">Organization</h1>
        <span className="org-view__toolbar-subtitle">{totalAgents} Agents &middot; {totalDepartments} Departments</span>
      </div>

      {/* HUD Stats Bar */}
      <div className="org-view__hud">
        <div className="org-view__hud-item">
          <span className="org-view__hud-badge org-view__hud-badge--owner">P</span>
          <span className="org-view__hud-label">PC Owner ({username})</span>
        </div>
        <div className="org-view__hud-item">
          <span className="org-view__hud-badge org-view__hud-badge--accent">R</span>
          <span className="org-view__hud-label">Router Agent</span>
        </div>
        <div className="org-view__hud-item">
          <span className="org-view__hud-badge org-view__hud-badge--surface">{totalDepartments}</span>
          <span className="org-view__hud-label">Departments</span>
        </div>
        <div className="org-view__hud-item">
          <span className="org-view__hud-badge org-view__hud-badge--surface">{totalAgents}</span>
          <span className="org-view__hud-label">Agents</span>
        </div>
      </div>

      {/* Scrollable Org Canvas */}
      <div className="org-view__canvas">
        {/* Founder Card */}
        <div className="org-view__founder-card">
          <div className="org-view__founder-subtitle">이 PC의 주인</div>
          <div className="org-view__founder-name">{username}</div>
          <div className="org-view__founder-role">System Owner</div>
          <div className="org-view__founder-tags">
            <span>최고 의사결정권자</span>
          </div>
        </div>

        {/* CEO Card */}
        <div className="org-view__ceo-card">
          <div className="org-view__ceo-subtitle">대표이사</div>
          <div className="org-view__ceo-name">CEO</div>
          <div className="org-view__ceo-role">총괄 의사결정</div>
          <div className="org-view__ceo-tags">
            <span>경영 총괄</span>
          </div>
        </div>

        {/* Router Agent Card */}
        <div className="org-view__router-card">
          <div className="org-view__router-subtitle">비서실</div>
          <div className="org-view__router-name">router-agent</div>
          <div className="org-view__router-role">Keyword Router · {totalAgents} routes</div>
          <div className="org-view__router-tags">
            <span>대기</span>
          </div>
        </div>

        {/* Department Clusters */}
        {departments.length > 0 && (
          <div className="org-view__dept-grid">
            {departments.map((dept) => {
              const meta = getDeptMeta(dept.dept);
              return (
              <div
                key={dept.dept}
                className="org-view__dept"
                style={{ '--dept-accent': meta.color } as React.CSSProperties}
              >
                <div className="org-view__dept-header" onClick={() => toggleDept(dept.dept)}>
                  <span className={`org-view__dept-chevron ${expandedDepts.has(dept.dept) ? 'open' : ''}`}>{'\u25BC'}</span>
                  <span className="org-view__dept-name">{meta.label}</span>
                  <span className="org-view__dept-en">{meta.deptEn}</span>
                  <span className="org-view__dept-count">{dept.agents.length}</span>
                </div>
                {expandedDepts.has(dept.dept) && (
                  <div className="org-view__dept-body">
                    {dept.agents.map((agent) => (
                      <div key={agent.id} className="org-view__agent-item">
                        <span className="org-view__agent-dot" />
                        <div className="org-view__agent-info">
                          <div className="org-view__agent-name">{agent.name}</div>
                          <div className="org-view__agent-desc">{agent.description || `${meta.deptEn} Agent`}</div>
                        </div>
                        <span className="org-view__agent-skills">
                          <span className="org-view__agent-badge">{meta.label}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}

            {/* Summary Card */}
            <div className="org-view__summary-card">
              <div className="org-view__summary-title">Agent Fleet Summary</div>
              <div className="org-view__summary-grid">
                <div>
                  <div className="org-view__summary-label">Router</div>
                  <div className="org-view__summary-value org-view__summary-value--accent">1</div>
                </div>
                <div>
                  <div className="org-view__summary-label">Departments</div>
                  <div className="org-view__summary-value">{totalDepartments}</div>
                </div>
                <div>
                  <div className="org-view__summary-label">Agents</div>
                  <div className="org-view__summary-value">{totalAgents}</div>
                </div>
                <div>
                  <div className="org-view__summary-label">Runs</div>
                  <div className="org-view__summary-value">{stats.totalRuns}</div>
                </div>
              </div>
              <div className="org-view__summary-footer">
                각 에이전트는 1개의 엔진에 매핑. Router가 키워드로 라우팅.
              </div>
            </div>
          </div>
        )}

        {departments.length === 0 && (
          <div className="org-view__canvas-empty">
            <div className="empty-state__icon">
              <span className="codicon codicon-symbol-group" />
            </div>
            <h3>No agents configured</h3>
            <p>Configure agents from the sidebar to build your organization.</p>
          </div>
        )}
      </div>
    </div>
  );
};

