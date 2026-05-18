/**
 * Zustand store managing inspector panel UI state — agents list, skills list,
 * active tab, selected agent/skill, file viewer state, and loading/error flags.
 */
import { create } from 'zustand';
import type { AgentConfig, AgentModel, SkillModel, AgentInspectorResponse } from '../../types/ipc-contract';

/** 인스펙터 탭 종류 — agents(에이전트 목록) / skills(스킬 목록) */
type InspectorTab = 'agents' | 'skills';

/**
 * InspectorStore 인터페이스
 * 인스펙터 패널의 UI 상태 관리를 위한 Zustand 스토어
 */
interface InspectorStore {
  agents: AgentConfig[];
  skills: SkillModel[];
  selectedAgent: AgentConfig | null;
  selectedSkill: SkillModel | null;
  activeTab: InspectorTab;
  response: AgentInspectorResponse | null;
  selectedFile: string | null;
  selectedFileContent: string | null;
  selectedFileOriginal: string | null;
  loading: boolean;
  error: string | null;
  setAgents: (agents: AgentConfig[]) => void;
  setSkills: (skills: SkillModel[]) => void;
  setSelectedAgent: (agent: AgentConfig | null) => void;
  setSelectedSkill: (skill: SkillModel | null) => void;
  setActiveTab: (tab: InspectorTab) => void;
  setResponse: (r: AgentInspectorResponse | null) => void;
  setSelectedFile: (path: string | null) => void;
  setFileContent: (content: string | null) => void;
  setFileOriginal: (content: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  resetSelection: () => void;
}

export const useInspectorStore = create<InspectorStore>((set) => ({
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
  setAgents: (agents) => set({ agents }),
  setSkills: (skills) => set({ skills }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent, selectedSkill: null }),
  setSelectedSkill: (skill) => set({ selectedSkill: skill, selectedAgent: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setResponse: (r) => set({ response: r, selectedFile: null, selectedFileContent: null, selectedFileOriginal: null }),
  setSelectedFile: (path) => set({ selectedFile: path }),
  setFileContent: (content) => set({ selectedFileContent: content }),
  setFileOriginal: (content) => set({ selectedFileOriginal: content }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  resetSelection: () => set({ selectedFile: null, selectedFileContent: null, selectedFileOriginal: null }),
}));
