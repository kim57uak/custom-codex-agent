/**
 * InspectorView 컴포넌트 통합 테스트
 *
 * 테스트 대상: src/components/views/InspectorView.tsx
 * 테스트 방식: 유닛 테스트 + React Testing Library 렌더링 테스트
 * 주요 검증 시나리오:
 * - IPC 호출 시 engine 파라미터 전달 여부 (소스 코드 분석)
 * - AgentEditor 렌더링 (에이전트에 스킬 파일이 없는 경우)
 * - FileBrowser 렌더링 (에이전트에 스킬 파일이 있는 경우)
 * - loading 상태에서 스피너 표시
 * - welcome 화면 (에이전트 미선택)
 * - error 상태에서 오류 메시지 표시
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import InspectorView from '../views/InspectorView';
import { useInspectorStore } from '../../stores/inspectorStore';
import type { AgentConfig } from '../../../types/ipc-contract';

const VIEWS_DIR = path.resolve(__dirname, '../views');
const INSPECTOR_FILE = path.join(VIEWS_DIR, 'InspectorView.tsx');

describe('InspectorView engine passthrough', () => {
  it('should pass engine in inspector:load-agent IPC call', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    const ipcCallLines = source
      .split('\n')
      .filter(line => line.includes("inspector:load-agent"));
    const hasEngineInIpc = ipcCallLines.some(line => line.includes('engine'));
    expect(hasEngineInIpc).toBe(true);
  });

  it('should extract agent name from AgentConfig for IPC call', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    const ipcCallLines = source
      .split('\n')
      .filter(line => line.includes("inspector:load-agent"));
    const hasAgentName = ipcCallLines.some(line => line.includes('agent.name'));
    expect(hasAgentName).toBe(true);
  });

  it('should have agent selection handler', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    expect(source).toContain('handleSelectAgent');
    expect(source).toContain('inspector:load-agent');
  });

  it('should support agents and skills tabs', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    expect(source).toContain("activeTab === 'agents'");
    expect(source).toContain("activeTab === 'skills'");
  });
});

describe('InspectorView AgentEditor integration', () => {
  const mockAgent: AgentConfig = {
    id: 'test-agent-1',
    name: 'test-agent',
    engine: 'codex',
    description: 'A test agent',
    department: '개발',
  };

  const emptyResponse = {
    agentName: 'test-agent',
    roleLabelKo: '테스트 에이전트',
    departmentLabelKo: '개발',
    description: 'A test agent',
    shortDescription: null,
    oneClickPrompt: null,
    skillName: null,
    skillPath: null,
    agentTomlPath: null,
    agentJsonPath: null,
    skillMarkdown: null,
    agentToml: null,
    agentJson: null,
    references: [] as never[],
    scripts: [] as never[],
    assets: [] as never[],
  };

  const responseWithFiles = {
    agentName: 'test-agent-file',
    roleLabelKo: '파일 있음',
    departmentLabelKo: '개발',
    description: 'Has skill files',
    shortDescription: null,
    oneClickPrompt: null,
    skillName: 'test-skill',
    skillPath: '/path/to/skill.md',
    agentTomlPath: '/path/to/agent.toml',
    agentJsonPath: null,
    skillMarkdown: {
      name: 'skill.md',
      path: '/path/to/skill.md',
      kind: 'skill-md',
      sizeBytes: 100,
      modifiedAt: null,
      content: '# Skill content',
      truncated: false,
    },
    agentToml: null,
    agentJson: null,
    references: [] as never[],
    scripts: [] as never[],
    assets: [] as never[],
  };

  beforeEach(() => {
    useInspectorStore.setState({
      agents: [],
      skills: [],
      selectedAgent: null,
      selectedSkill: null,
      activeTab: 'agents',
      response: null,
      selectedFile: null,
      selectedFileContent: null,
      selectedFileOriginal: null,
      loading: false,
      error: null,
    });
    cleanup();
  });

  it('renders AgentEditor when agent has no skill files', () => {
    useInspectorStore.setState({
      selectedAgent: mockAgent,
      response: emptyResponse,
      loading: false,
      error: null,
    });

    render(<InspectorView />);

    expect(screen.getByText('Save Changes')).toBeTruthy();
    expect(screen.getByText(mockAgent.name)).toBeTruthy();
    expect(screen.getByDisplayValue(mockAgent.name)).toBeTruthy();
  });

  it('renders file browser when agent has skill files', () => {
    useInspectorStore.setState({
      selectedAgent: { ...mockAgent, name: 'test-agent-file' },
      response: responseWithFiles,
      loading: false,
      error: null,
    });

    render(<InspectorView />);

    expect(screen.getByText('Skill Files')).toBeTruthy();
    expect(screen.queryByText('Save Changes')).toBeNull();
  });

  it('renders loading state while fetching agent data', () => {
    useInspectorStore.setState({
      selectedAgent: mockAgent,
      response: null,
      loading: true,
      error: null,
    });

    render(<InspectorView />);

    expect(screen.getByText('Loading agent info...')).toBeTruthy();
  });

  it('renders welcome when no agent is selected', () => {
    useInspectorStore.setState({
      selectedAgent: null,
      response: null,
      loading: false,
      error: null,
    });

    render(<InspectorView />);

    expect(screen.getByText('Agent Inspector')).toBeTruthy();
  });

  it('renders error state when IPC fails', () => {
    useInspectorStore.setState({
      selectedAgent: mockAgent,
      response: null,
      loading: false,
      error: 'Could not load agent info.',
    });

    render(<InspectorView />);

    expect(screen.getByText('오류')).toBeTruthy();
    expect(screen.getByText('Could not load agent info.')).toBeTruthy();
  });
});
