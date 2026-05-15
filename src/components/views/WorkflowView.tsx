/**
 * WorkflowView - 워크플로 뷰
 *
 * 레이아웃 구조 (mockup 기준):
 * - .main-toolbar: 타이틀 + 서브타이틀
 * - .main-content: 워크플로 선택 + SVG 캔버스
 *
 * Phase 3 완료 항목:
 * - [x] WorkflowView (SVG 캔버스 + 에이전트 노드)
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Workflow } from '../../../types/ipc-contract';

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

/** 워크플로 정의 (UI용) */
interface WorkflowDef {
  id: string;
  name: string;
  steps: number;
  status: string;
}

/** WorkflowSidebarProps */
interface WorkflowSidebarProps {
  onSelectWorkflow?: (workflow: Workflow) => void;
  onCreateWorkflow?: () => void;
}

/**
 * WorkflowSidebarProps
 */
interface WorkflowSidebarProps {}

/**
 * WorkflowSidebar - 사이드바용 워크플로 목록 (동적 IPC)
 */
export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await ipcInvoke<Workflow[]>('workflow:list');
    if (result) {
      setWorkflows(result);
    } else {
      setError('Could not load workflow list');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  if (isLoading) {
    return (
      <div className="workflow-sidebar">
        <div className="workflow-sidebar__section-header">Workflows</div>
        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <span className="codicon codicon-loading codicon-modifier-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-sidebar">
        <div className="workflow-sidebar__section-header">Workflows</div>
        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--status-error)', fontSize: '12px' }}>
          <p>{error}</p>
          <button onClick={loadWorkflows} style={{ marginTop: '8px', padding: '4px 12px', background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-sidebar">
      <div className="workflow-sidebar__section-header">Workflows</div>
      {workflows.length === 0 ? (
        <div style={{ padding: 'var(--space-6) var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <p>No workflows yet</p>
          <button onClick={async () => {
            const result = await ipcInvoke<Workflow>('workflow:create', { name: 'New Workflow', nodes: [], edges: [] });
            if (result && window.electronAPI) {
              window.electronAPI.send('workflow:selected', result);
            }
          }} style={{ marginTop: '8px', padding: '4px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>Create Workflow</button>
        </div>
      ) : (
        workflows.map((wf) => (
          <div
            key={wf.id}
            className="workflow-sidebar__item"
            onClick={() => window.electronAPI?.send('workflow:selected', wf)}
          >
            <span className={`status-dot ${wf.status || 'idle'}`} />
            <span style={{ fontSize: '12px' }}>{wf.name}</span>
            <span className="workflow-sidebar__item-steps">{wf.nodes?.length ?? 0} steps</span>
          </div>
        ))
      )}
    </div>
  );
};

/** WorkflowViewProps */
interface WorkflowViewProps {}

/**
 * WorkflowView - 메인 영역용 워크플로 뷰
 * SVG 캔버스 + 노드 그래프 (mockup 기준)
 */
export const WorkflowView: React.FC<WorkflowViewProps> = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await ipcInvoke<Workflow[]>('workflow:list');
    if (result) {
      setWorkflows(result);
      const first = result[0];
      if (first && !selectedWorkflow) {
        setSelectedWorkflow(first.id);
      }
    } else {
      setError('Could not load workflow list');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  /** 워크플로 선택 이벤트 구독 */
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const handler = (workflow: Workflow) => {
      setSelectedWorkflow(workflow.id);
    };

    api.on('workflow:selected', handler);
    return () => { api.off('workflow:selected', handler); };
  }, []);

  /** 워크플로 생성 핸들러 */
  const handleCreateWorkflow = async () => {
    const newWorkflow: Partial<Workflow> = {
      name: 'New Workflow',
      nodes: [],
      edges: [],
    };

    const result = await ipcInvoke<Workflow>('workflow:create', newWorkflow);
    if (result) {
      setWorkflows(prev => [...prev, result]);
      setSelectedWorkflow(result.id);
    }
  };

  if (isLoading) {
    return (
      <div className="workflow-view">
        <div className="main-toolbar">
          <h1 className="title">Workflow</h1>
          <span className="subtitle">Loading...</span>
        </div>
        <div className="main-content" style={{ flex: 1 }}>
          <div className="loading-spinner">
            <div className="spinner" />
            <span>Loading workflows...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-view">
        <div className="main-toolbar">
          <h1 className="title">Workflow</h1>
          <span className="subtitle">Error</span>
        </div>
        <div className="main-content" style={{ flex: 1 }}>
          <div className="empty-state">
            <span className="codicon codicon-error" />
            <h3>Error</h3>
            <p>{error}</p>
            <button className="btn-cta" onClick={loadWorkflows}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="workflow-view">
        <div className="main-toolbar">
          <h1 className="title">Workflow</h1>
          <span className="subtitle">No workflows</span>
        </div>
        <div className="main-content" style={{ flex: 1 }}>
          <div className="empty-state">
            <span className="codicon codicon-workflow" />
            <h3>No workflows yet</h3>
            <p>Create your first workflow to get started.</p>
            <button className="btn-cta" onClick={handleCreateWorkflow}>Create Workflow</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-view">
      <div className="main-toolbar">
        <h1 className="title">Workflow</h1>
        <span className="subtitle">{selectedWorkflow}</span>
      </div>

      <div className="main-content" style={{ flex: 1 }}>
        <div className="run-config-row" style={{ marginBottom: 'var(--space-3)' }}>
          <select
            value={selectedWorkflow}
            onChange={(e) => setSelectedWorkflow(e.target.value)}
            style={{ flex: '0 0 auto', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '13px' }}
          >
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>{wf.name}</option>
            ))}
          </select>
          <button className="btn-run" style={{ background: 'var(--accent-primary)' }} onClick={handleCreateWorkflow}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Workflow
          </button>
        </div>

        <div className="workflow-canvas">
          <svg viewBox="0 0 600 280">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#2a2a4a"/>
              </marker>
              <marker id="arrowhead-completed" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#22c55e"/>
              </marker>
            </defs>

            {/* Edge connections */}
            <path className="workflow-edge completed" d="M120,50 L280,50" markerEnd="url(#arrowhead-completed)"/>
            <path className="workflow-edge completed" d="M120,50 L120,170 L280,170" markerEnd="url(#arrowhead-completed)"/>
            <path className="workflow-edge" d="M440,50 L440,170 L280,170" markerEnd="url(#arrowhead)"/>
            <path className="workflow-edge" d="M440,50 L520,140" markerEnd="url(#arrowhead)"/>

            {/* Step 1: Lint */}
            <g transform="translate(40, 20)">
              <rect className="workflow-node active" x="0" y="0" width="160" height="60"/>
              <text x="80" y="25" textAnchor="middle" fill="#e0e0ff" fontSize="12" fontWeight="600">Lint &amp; Format</text>
              <text x="80" y="43" textAnchor="middle" fill="#22c55e" fontSize="11">✓ Completed</text>
            </g>

            {/* Step 2: Test */}
            <g transform="translate(40, 140)">
              <rect className="workflow-node" x="0" y="0" width="160" height="60" stroke="#22c55e"/>
              <text x="80" y="25" textAnchor="middle" fill="#e0e0ff" fontSize="12" fontWeight="600">Run Tests</text>
              <text x="80" y="43" textAnchor="middle" fill="#22c55e" fontSize="11">✓ 12/12 passed</text>
            </g>

            {/* Step 3: Build */}
            <g transform="translate(280, 20)">
              <rect className="workflow-node" x="0" y="0" width="160" height="60" stroke="#22c55e" strokeDasharray="4,3"/>
              <text x="80" y="25" textAnchor="middle" fill="#e0e0ff" fontSize="12" fontWeight="600">Build</text>
              <text x="80" y="43" textAnchor="middle" fill="#a0a0cc" fontSize="11">Pending...</text>
            </g>

            {/* Step 4: Deploy */}
            <g transform="translate(280, 140)">
              <rect className="workflow-node" x="0" y="0" width="160" height="60" fill="#1e1e36" opacity="0.5"/>
              <text x="80" y="25" textAnchor="middle" fill="#7070aa" fontSize="12" fontWeight="600">Deploy</text>
              <text x="80" y="43" textAnchor="middle" fill="#7070aa" fontSize="11">Awaiting Build</text>
            </g>

            {/* Step 5: Notify */}
            <g transform="translate(440, 20)">
              <rect className="workflow-node" x="0" y="0" width="160" height="60" fill="#1e1e36" opacity="0.5"/>
              <text x="80" y="25" textAnchor="middle" fill="#7070aa" fontSize="12" fontWeight="600">Notify</text>
              <text x="80" y="43" textAnchor="middle" fill="#7070aa" fontSize="11">Awaiting Deploy</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
};
