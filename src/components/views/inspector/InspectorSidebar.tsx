import React, { useState } from 'react';
import type { AgentConfig, SkillModel, AgentInspectorResponse } from '../../../../types/ipc-contract';
import { useInspectorStore } from '../../../stores/inspectorStore';
import { useUIStore } from '../../../stores/uiStore';
import { ipcInvoke } from '../../../utils/ipc';
import { getEngineMeta, getDeptColor } from '../../../utils/inspector';

export const InspectorSidebar: React.FC = () => {
  const agents = useInspectorStore(s => s.agents);
  const skills = useInspectorStore(s => s.skills);
  const selectedAgent = useInspectorStore(s => s.selectedAgent);
  const selectedSkill = useInspectorStore(s => s.selectedSkill);
  const activeTab = useInspectorStore(s => s.activeTab);
  const response = useInspectorStore(s => s.response);
  const loading = useInspectorStore(s => s.loading);
  const error = useInspectorStore(s => s.error);
  const setSelectedAgent = useInspectorStore(s => s.setSelectedAgent);
  const setSelectedSkill = useInspectorStore(s => s.setSelectedSkill);
  const setActiveTab = useInspectorStore(s => s.setActiveTab);
  const setResponse = useInspectorStore(s => s.setResponse);
  const setLoading = useInspectorStore(s => s.setLoading);
  const setError = useInspectorStore(s => s.setError);
  const selectedEngine = useUIStore(s => s.selectedEngine);

  const [search, setSearch] = useState('');

  const engineFilteredAgents = agents.filter(a => a.engine === selectedEngine);

  const filteredAgents = engineFilteredAgents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const groupedAgents: Record<string, AgentConfig[]> = {};
  for (const agent of filteredAgents) {
    const dept = agent.department || agent.engine || 'other';
    if (!groupedAgents[dept]) groupedAgents[dept] = [];
    groupedAgents[dept].push(agent);
  }

  const handleSelectAgent = async (agent: AgentConfig) => {
    setSelectedAgent(agent);
    setSelectedSkill(null);
    setResponse(null);
    setError(null);
    setLoading(true);
    const result = await ipcInvoke<AgentInspectorResponse>('inspector:load-agent', { agentName: agent.name, engine: agent.engine });
    setLoading(false);
    if (result) {
      setResponse(result);
    } else {
      setError('Could not load agent info.');
    }
  };

  const handleSelectSkill = (skill: SkillModel) => {
    setSelectedSkill(skill);
    setSelectedAgent(null);
    setResponse(null);
  };

  const selectedEngineMeta = getEngineMeta(selectedEngine);

  return (
    <div className="inspector-sidebar">
      <div className="inspector-sidebar__header">
        <span>Inspector</span>
        {selectedEngine !== 'all' && selectedEngineMeta && (
          <span className="inspector-sidebar__engine-badge" style={{ background: selectedEngineMeta.color }}>
            {selectedEngineMeta.badge} {selectedEngineMeta.label}
          </span>
        )}
        {selectedEngine === 'all' && (
          <span className="inspector-sidebar__engine-badge" style={{ background: 'var(--text-tertiary)' }}>
            All Engines
          </span>
        )}
      </div>

      <div className="inspector-sidebar__tabs">
        <button
          className={`inspector-sidebar__tab ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          <span className="codicon codicon-account" />
          Agents
          <span className="inspector-sidebar__tab-count">{engineFilteredAgents.length}</span>
        </button>
        <button
          className={`inspector-sidebar__tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          <span className="codicon codicon-book" />
          Skills
          <span className="inspector-sidebar__tab-count">{skills.length}</span>
        </button>
      </div>

      <div className="inspector-sidebar__search">
        <span className="codicon codicon-search" />
        <input
          type="text"
          className="inspector-sidebar__search-input"
          placeholder={activeTab === 'agents' ? 'Search agents...' : 'Search skills...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="inspector-sidebar__list">
        {activeTab === 'agents' && (
          <>
            {filteredAgents.length === 0 && (
              <div className="inspector-sidebar__empty">
                <span className="codicon codicon-account" style={{ fontSize: '24px', opacity: 0.3 }} />
                <p>No agents found</p>
              </div>
            )}
            {Object.entries(groupedAgents).map(([dept, deptAgents]) => (
              <div key={dept} className="inspector-sidebar__group">
                <div className="inspector-sidebar__group-header" style={{ '--group-color': getDeptColor(dept) } as React.CSSProperties}>
                  <span className="inspector-sidebar__group-dot" />
                  <span className="inspector-sidebar__group-name">{dept}</span>
                  <span className="inspector-sidebar__group-count">{deptAgents.length}</span>
                </div>
                {deptAgents.map(agent => {
                  const meta = getEngineMeta(agent.engine);
                  const isSelected = selectedAgent?.id === agent.id;
                  return (
                    <div
                      key={agent.id}
                      className={`inspector-sidebar__item ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectAgent(agent)}
                    >
                      <span className="inspector-sidebar__item-badge" style={{ background: meta.color }}>
                        {meta.badge}
                      </span>
                      <div className="inspector-sidebar__item-info">
                        <span className="inspector-sidebar__item-name">{agent.name}</span>
                        <span className="inspector-sidebar__item-desc">{agent.description || meta.label}</span>
                      </div>
                      <span className="inspector-sidebar__item-engine">{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {activeTab === 'skills' && (
          <>
            {filteredSkills.length === 0 && (
              <div className="inspector-sidebar__empty">
                <span className="codicon codicon-book" style={{ fontSize: '24px', opacity: 0.3 }} />
                <p>No skills found</p>
              </div>
            )}
            {filteredSkills.map(skill => {
              const isSelected = selectedSkill?.name === skill.name;
              return (
                <div
                  key={skill.name}
                  className={`inspector-sidebar__item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectSkill(skill)}
                >
                  <span className="inspector-sidebar__item-badge" style={{ background: 'var(--status-success)' }}>
                    S
                  </span>
                  <div className="inspector-sidebar__item-info">
                    <span className="inspector-sidebar__item-name">{skill.name}</span>
                    <span className="inspector-sidebar__item-desc">{skill.path}</span>
                  </div>
                  <span className={`inspector-sidebar__item-status ${skill.installed ? 'installed' : 'missing'}`}>
                    {skill.installed ? (skill.enabled ? 'ON' : 'OFF') : 'MISS'}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {response && (
        <div className="inspector-sidebar__agent-detail">
          <div className="inspector-sidebar__agent-detail-header">
            <span className="inspector-sidebar__agent-detail-title">Agent Info</span>
          </div>
          <div className="inspector-sidebar__agent-detail-scroll">
            <div className="inspector-sidebar__agent-detail-body">
              {response.description && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">설명</span>
                  <span className="inspector-sidebar__detail-value">{response.description}</span>
                </div>
              )}
              {response.roleLabelKo && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">역할</span>
                  <span className="inspector-sidebar__detail-value">{response.roleLabelKo}</span>
                </div>
              )}
              {response.departmentLabelKo && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">부서</span>
                  <span className="inspector-sidebar__detail-value">{response.departmentLabelKo}</span>
                </div>
              )}
              {response.skillName && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">Skills</span>
                  <span className="inspector-sidebar__detail-value">{response.skillName}</span>
                </div>
              )}
              {response.shortDescription && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">요약</span>
                  <span className="inspector-sidebar__detail-value">{response.shortDescription}</span>
                </div>
              )}
              {response.oneClickPrompt && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">빠른 프롬프트</span>
                  <span className="inspector-sidebar__detail-value">{response.oneClickPrompt}</span>
                </div>
              )}
              {response.agentTomlPath && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">TOML</span>
                  <span className="inspector-sidebar__detail-value">{response.agentTomlPath}</span>
                </div>
              )}
              {response.agentJsonPath && (
                <div className="inspector-sidebar__detail-row">
                  <span className="inspector-sidebar__detail-label">JSON</span>
                  <span className="inspector-sidebar__detail-value">{response.agentJsonPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
