/**
 * WorkflowView — AI 워크플로 실행 및 관리를 위한 메인 뷰 컴포넌트.
 *
 * 기능:
 * - 사용자 입력(goal prompt)을 받아 워크플로 생성 및 추천
 * - AgentCard 리스트로 각 에이전트 단계(status/prompt/파일첨부) 관리
 * - 드래그 앤 드롭으로 에이전트 순서 변경 및 추가
 * - HITL(Human-In-The-Loop) 승인 요청 처리
 * - 실행 기록 사이드바(WorkflowSidebar): 실행 목록, 에이전트 프로필, 바로 실행
 *
 * Props/State:
 * - steps (WorkflowStepRun[]): 현재 워크플로 단계들
 * - goalPrompt: 사용자의 초기 요청 메시지
 * - runStatus/currentStepIndex: 실행 상태 및 진행 단계
 * - hitlRequests: 승인 대기 중인 요청 목록
 * - AttachedFilesMap/globalFiles: 단계별/전역 파일 첨부 관리
 *
 * 앱 내 배치:
 * - ActivityBar의 'workflow' 뷰 ID와 연결된 메인 콘텐츠
 * - 좌측에 WorkflowSidebar, 우측에 대화형 워크플로 캔버스
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import type {
  WorkflowRunSummary, WorkflowRunDetail, WorkflowStepRun,
  WorkflowRecommendedAgent, WorkflowRunStatus,
} from '../../../types/ipc-contract';
import { ipcInvoke } from '../../utils/ipc';

const STEP_ICONS: Record<string, string> = {
  shield: '\u{1F6E1}', 'check-circle': '\u2705', 'file-text': '\u{1F4C4}',
  database: '\u{1F4BE}', layout: '\u{1F3A8}', server: '\u{1F5A5}',
  'play-square': '\u25B6', folder: '\u{1F4C1}', table: '\u{1F4CA}',
  presentation: '\u{1F4CA}', bot: '\u{1F916}',
};

/** 아이콘 키에 해당하는 이모지 문자열 반환 */
function getIcon(iconKey: string | null | undefined): string {
  return STEP_ICONS[iconKey || 'bot']!;
}

/** 상태 코드를 한글 레이블로 변환 */
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ready: '준비', queued: '대기', running: '실행 중', completed: '완료',
    failed: '실패', cancelled: '중단', skipped: '건너뜀',
    approval_required: '승인 대기', recommended: '추천', draft: '초안',
  };
  return map[status] || status;
}

/** textarea 높이를 내용에 맞게 자동 조절 */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/** 상태별 색상 코드 반환 (완료=초록, 실행=파랑, 실패/중단=빨강) */
function statusColor(status: string): string {
  if (status === 'completed') return '#22c55e';
  if (status === 'running') return '#3b82f6';
  if (status === 'failed' || status === 'cancelled') return '#ef4444';
  return '#6b7280';
}

/**
 * HITL(Human-In-The-Loop) 승인 요청 데이터
 * @property id - 요청 고유 ID
 * @property stepIndex - 관련 워크플로 단계 인덱스
 * @property agentName - 요청한 에이전트 이름
 * @property message - 승인 요청 메시지
 * @property permission - 요청된 권한
 */
interface HitlRequest {
  id: string;
  stepIndex: number;
  agentName: string;
  message: string;
  permission: string;
}

/**
 * 에이전트 프로필 정보
 * @property name - 에이전트 식별자
 * @property roleLabelKo - 한글 역할명
 * @property departmentLabelKo - 한글 부서명
 * @property description - 상세 설명
 * @property shortDescription - 짧은 설명
 * @property oneClickPrompt - 원클릭 실행 프롬프트
 * @property skillName - 연결된 스킬 이름
 * @property iconKey - 아이콘 키
 */
interface AgentProfile {
  name: string; roleLabelKo: string; departmentLabelKo: string;
  description: string; shortDescription: string | null;
  oneClickPrompt: string | null; skillName: string | null; iconKey: string;
}

// ── AI Chat Bubble (Agent Card) ───────────────────

/**
 * AgentCard 컴포넌트 Props
 * @property step - 워크플로 단계 실행 데이터
 * @property index - 단계 인덱스
 * @property isActive - 현재 활성 단계 여부
 * @property isWorkflowRunning - 워크플로 실행 중 여부
 * @property onRun - 단계 실행 콜백
 * @property onStop - 단계 중지 콜백
 * @property onRemove - 단계 제거 콜백
 * @property onPromptChange - 프롬프트 변경 콜백
 * @property attachedFiles - 첨부 파일 목록
 * @property onAttachFiles - 파일 첨부 콜백
 * @property onRemoveFile - 파일 제거 콜백
 */
interface AgentCardProps {
  step: WorkflowStepRun;
  index: number;
  isActive: boolean;
  isWorkflowRunning: boolean;
  onRun: (index: number) => void;
  onStop: () => void;
  onRemove: (index: number) => void;
  onPromptChange: (index: number, prompt: string) => void;
  attachedFiles: string[] | undefined;
  onAttachFiles: (index: number) => void;
  onRemoveFile: (index: number, fileIndex: number) => void;
}

/**
 * AgentCard — 개별 에이전트 단계 카드 컴포넌트.
 * 프롬프트 편집, 실행/중지/제거 버튼, 파일 첨부 UI를 포함.
 * @returns 에이전트 카드 JSX 요소
 */
const AgentCard: React.FC<AgentCardProps> = ({
  step, index, isActive, isWorkflowRunning,
  onRun, onStop, onRemove, onPromptChange,
  attachedFiles, onAttachFiles, onRemoveFile,
}) => {
  const [localPrompt, setLocalPrompt] = useState(step.prompt || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setLocalPrompt(step.prompt || ''); }, [step.prompt]);
  useEffect(() => { autoResize(textareaRef.current); }, [localPrompt]);

  const s = step.status;
  const isRunning = s === 'running';
  const canRun = (s === 'recommended' || s === 'ready') && !isWorkflowRunning && index === 0;

  return (
    <div className={`chat-msg chat-msg--ai ${isActive ? 'chat-msg--active' : ''}`}>
      <div className="agent-card">
        <div className="agent-card__header">
          <span className="agent-card__icon">
            {isRunning ? <span className="csc-spinner" /> : <span>{getIcon(step.iconKey)}</span>}
          </span>
          <span className="agent-card__name">{step.title || step.agentName}</span>
          <span className="agent-card__status" style={{ color: statusColor(s) }}>
            {isRunning && <span className="csc-pulse-dot" />}
            {statusLabel(s)}
          </span>
          <span className="agent-card__spacer" />
          {s !== 'completed' && s !== 'running' && (
            <button className="agent-card__btn agent-card__btn--del" onClick={() => onRemove(index)}
              title="제거" disabled={isRunning}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>

        <div className="agent-card__body">
          <textarea className="agent-card__prompt"
            ref={textareaRef}
            value={localPrompt}
            onChange={(e) => setLocalPrompt(e.target.value)}
            onBlur={() => { if (localPrompt !== step.prompt) onPromptChange?.(index, localPrompt); }}
            onInput={(e) => autoResize(e.currentTarget)}
            placeholder="이 에이전트가 수행할 작업을 입력하세요..."
            disabled={isRunning || s === 'completed'}
            rows={1}
          />
          <div className="agent-card__footer">
            <div className="agent-card__actions">
              {isRunning ? (
                <button className="agent-card__action agent-card__action--stop" onClick={onStop}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  중지
                </button>
              ) : s === 'failed' || s === 'cancelled' ? (
                <button className="agent-card__action agent-card__action--retry" onClick={() => onRun(index)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                  재시도
                </button>
              ) : s === 'skipped' ? (
                <button className="agent-card__action" onClick={() => onRun(index)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  실행
                </button>
              ) : s === 'completed' ? (
                <span className="agent-card__action-result">완료</span>
              ) : canRun ? (
                <button className="agent-card__action agent-card__action--run" onClick={() => onRun(index)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  실행
                </button>
              ) : null}
            </div>
            <button className="agent-card__attach-btn" onClick={() => onAttachFiles(index)}
              disabled={isRunning || s === 'completed'}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            {attachedFiles && attachedFiles.length > 0 && (
              <div className="agent-card__file-list">
                {attachedFiles.map((fp, fi) => (
                  <span key={fi} className="agent-card__file-chip">
                    <span className="agent-card__file-name">{fp.split('/').pop() || fp}</span>
                    <button className="agent-card__file-remove" onClick={() => onRemoveFile(index, fi)}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

// ── HITL Card ──────────────────────────────────────

/**
 * HitlCard 컴포넌트 Props
 * @property request - HITL 승인 요청 데이터
 * @property onRespond - 승인 응답 콜백
 */
interface HitlCardProps {
  request: HitlRequest;
  onRespond: (id: string, response: 'allow_once' | 'allow_always' | 'reject') => void;
}

/**
 * HitlCard — HITL 승인 요청 카드 컴포넌트.
 * Allow Once / Always / Reject 세 가지 응답 버튼 제공.
 * @returns HITL 카드 JSX 요소
 */
const HitlCard: React.FC<HitlCardProps> = ({ request, onRespond }) => (
  <div className="hitl-card">
    <div className="hitl-card__header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span className="hitl-card__msg">{request.message}</span>
      <span className="hitl-card__agent">{request.agentName}</span>
    </div>
    <div className="hitl-card__actions">
      <button className="hitl-btn hitl-btn--once" onClick={() => onRespond(request.id, 'allow_once')}>
        Allow Once
      </button>
      <button className="hitl-btn hitl-btn--always" onClick={() => onRespond(request.id, 'allow_always')}>
        Always
      </button>
      <button className="hitl-btn hitl-btn--reject" onClick={() => onRespond(request.id, 'reject')}>
        Reject
      </button>
    </div>
  </div>
);

// ── Connector ───────────────────────────────────────

/**
 * StepConnector — 워크플로 단계 사이 연결선 컴포넌트.
 * @returns 연결선 JSX 요소
 */
const StepConnector: React.FC<{ done: boolean }> = ({ done }) => (
  <div className={`csc-conn ${done ? 'csc-conn--done' : ''}`}>
    <div className="csc-conn__line" />
  </div>
);

// ── Main Workflow View ──────────────────────────────

/**
 * WorkflowView — AI 워크플로 실행 및 관리를 위한 메인 뷰 컴포넌트.
 * 사용자 입력(goal prompt)을 받아 워크플로 생성, 에이전트 단계 관리, HITL 처리.
 * @returns 워크플로 뷰 JSX 요소
 */
export const WorkflowView: React.FC = () => {
  const selectedRunId = useUIStore((s) => s.selectedWorkflowRunId);
  const setSelectedRunId = useUIStore((s) => s.setSelectedWorkflowRunId);
  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const sandboxMode = useUIStore((s) => s.sandboxMode);
  const approvalPolicy = useUIStore((s) => s.approvalPolicy);

  const [steps, setSteps] = useState<WorkflowStepRun[]>([]);
  const [goalPrompt, setGoalPrompt] = useState('');
  const [runStatus, setRunStatus] = useState<WorkflowRunStatus | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [attachedFilesMap, setAttachedFilesMap] = useState<Record<number, string[]>>({});
  const [globalFiles, setGlobalFiles] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [hitlRequests, setHitlRequests] = useState<HitlRequest[]>([]);
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [responseMsg, setResponseMsg] = useState<{ text: string; error: boolean } | null>(null);
  const dragIndex = useRef<number | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  /** 선택된 워크플로 실행 상세 정보 로드 */
  const loadRunDetail = useCallback(async (runId: string) => {
    const result = await ipcInvoke<WorkflowRunDetail>('workflow:run-detail', runId);
    if (result) {
      setSteps(result.steps);
      setGoalPrompt(result.goalPrompt || '');
      setRunStatus(result.status);
      setCurrentStepIndex(result.currentStepIndex ?? -1);
    }
  }, []);

  useEffect(() => {
    if (selectedRunId) loadRunDetail(selectedRunId);
    else {
      setSteps([]); setRunStatus(null); setCurrentStepIndex(-1);
      setGoalPrompt(''); setHitlRequests([]); setResponseMsg(null);
      setChatInput(''); setGlobalFiles([]); setAttachedFilesMap({});
      setTimeout(() => mainTextareaRef.current?.focus(), 50);
    }
  }, [selectedRunId, loadRunDetail]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const refresh = () => { if (selectedRunId) loadRunDetail(selectedRunId); };
    const unsub1 = api.on('workflow:event', refresh);
    const unsub2 = api.on('workflow:run-status', (data: unknown) => {
      const d = data as { workflowRunId?: string; status?: string; currentStepIndex?: number };
      if (d?.workflowRunId === selectedRunId) {
        if (d.status) setRunStatus(d.status as WorkflowRunStatus);
        if (d.currentStepIndex !== undefined) setCurrentStepIndex(d.currentStepIndex);
      }
    });
    const unsub3 = api.on('workflow:permission-request', (data: unknown) => {
      const d = data as { id: string; runId: string; agentName: string; message: string; permission: string; stepIndex?: number };
      if (d && d.id) {
        setHitlRequests((prev) => {
          if (prev.find((r) => r.id === d.id)) return prev;
          return [...prev, {
            id: d.id,
            stepIndex: d.stepIndex ?? -1,
            agentName: d.agentName,
            message: d.message,
            permission: d.permission,
          }];
        });
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [selectedRunId, loadRunDetail]);

  /** 사용자 입력(goal prompt) 전송 → 워크플로 추천 및 생성 */
  const handleSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setResponseMsg(null);
    try {
      const goalWithFiles = globalFiles.length > 0
        ? text + '\n\n[첨부 파일]\n' + globalFiles.map((f) => `- ${f}`).join('\n')
        : text;
      const result = await ipcInvoke<{ recommendations: WorkflowRecommendedAgent[]; workflowRunId: string | null }>(
        'workflow:recommend-and-create',
        { goalPrompt: goalWithFiles, sandboxMode, approvalPolicy, engine: selectedEngine }
      );
      if (result?.workflowRunId) {
        setSelectedRunId(result.workflowRunId);
        setChatInput('');
      } else {
        setResponseMsg({ text: '추천된 에이전트가 없습니다. 요청을 더 구체적으로 입력하세요.', error: true });
      }
    } finally {
      setIsSending(false);
    }
  }, [chatInput, isSending, selectedEngine, sandboxMode, approvalPolicy, globalFiles, setSelectedRunId]);

  /** 단계별/전역 첨부 파일을 각 단계 프롬프트에 동기화 */
  const _syncFiles = useCallback(async () => {
    if (!selectedRunId) return;
    if (globalFiles.length > 0) {
      const fileSection = '\n\n[첨부 파일]\n' + globalFiles.map((f) => `- ${f}`).join('\n');
      for (const s of stepsRef.current) {
        await ipcInvoke('workflow:update-step-prompt', {
          workflowRunId: selectedRunId, stepIndex: s.stepIndex,
          prompt: s.prompt + fileSection,
        });
      }
    }
    if (Object.keys(attachedFilesMap).length > 0) {
      for (const [stepIdx, files] of Object.entries(attachedFilesMap)) {
        if (files.length > 0) {
          const s = stepsRef.current[Number(stepIdx)];
          if (s) {
            const fileSection = '\n\n[첨부 파일]\n' + files.map((f) => `- ${f}`).join('\n');
            await ipcInvoke('workflow:update-step-prompt', {
              workflowRunId: selectedRunId, stepIndex: s.stepIndex,
              prompt: s.prompt + fileSection,
            });
          }
        }
      }
    }
  }, [selectedRunId, globalFiles, attachedFilesMap]);

  /** 전체 워크플로 실행 시작 */
  const handleRun = useCallback(async () => {
    if (!selectedRunId || isRunning) return;
    setIsRunning(true);
    try {
      await _syncFiles();
      await ipcInvoke('workflow:run', selectedRunId);
    } finally {
      setIsRunning(false);
    }
  }, [selectedRunId, isRunning, _syncFiles]);

  /** 전체 워크플로 실행 중지 */
  const handleStop = useCallback(async () => {
    if (!selectedRunId) return;
    await ipcInvoke('workflow:stop', selectedRunId);
  }, [selectedRunId]);

  /** 특정 단계 실행 */
  const handleStepRun = useCallback(async (_stepIndex: number) => {
    if (runStatus === 'running') return;
    setIsRunning(true);
    try {
      await _syncFiles();
      let targetId = selectedRunId;
      if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled') {
        targetId = await ipcInvoke<string | null>('workflow:retry', { workflowRunId: selectedRunId, engine: selectedEngine });
        if (targetId) setSelectedRunId(targetId);
      }
      if (targetId) await ipcInvoke('workflow:run', targetId);
    } finally {
      setIsRunning(false);
    }
  }, [selectedRunId, runStatus, _syncFiles, selectedEngine, setSelectedRunId]);

  /** 특정 단계 중지 */
  const handleStepStop = useCallback(async () => {
    if (!selectedRunId) return;
    await ipcInvoke('workflow:stop', selectedRunId);
  }, [selectedRunId]);

  /** 실패/취소된 워크플로 재시도 */
  const handleRetry = useCallback(async () => {
    if (!selectedRunId) return;
    const newId = await ipcInvoke<string | null>('workflow:retry', { workflowRunId: selectedRunId, engine: selectedEngine });
    if (newId) {
      setSelectedRunId(newId);
      await ipcInvoke('workflow:run', newId);
    }
  }, [selectedRunId, selectedEngine, setSelectedRunId]);

  /** 워크플로에서 특정 단계 제거 */
  const handleRemoveStep = useCallback(async (stepIndex: number) => {
    if (!selectedRunId) return;
    const detail = await ipcInvoke<WorkflowRunDetail>('workflow:remove-step', { workflowRunId: selectedRunId, stepIndex });
    if (detail) setSteps(detail.steps);
  }, [selectedRunId]);

  /** 에이전트 단계 프롬프트 내용 업데이트 */
  const handlePromptChange = useCallback(async (stepIndex: number, prompt: string) => {
    if (!selectedRunId) return;
    const detail = await ipcInvoke<WorkflowRunDetail>('workflow:update-step-prompt', {
      workflowRunId: selectedRunId, stepIndex, prompt,
    });
    if (detail) setSteps(detail.steps);
  }, [selectedRunId]);

  /** 특정 단계에 파일 첨부 다이얼로그 열기 */
  const handleAttachFiles = useCallback(async (stepIndex: number) => {
    const paths = await ipcInvoke<string[]>('dialog:open-file');
    if (paths && paths.length > 0) {
      setAttachedFilesMap((prev) => ({
        ...prev,
        [stepIndex]: [...(prev[stepIndex] || []), ...paths],
      }));
    }
  }, []);

  /** 특정 단계의 첨부 파일 제거 */
  const handleRemoveFile = useCallback((stepIndex: number, fileIndex: number) => {
    setAttachedFilesMap((prev) => {
      const cur = prev[stepIndex] || [];
      const next = cur.filter((_, i) => i !== fileIndex);
      return { ...prev, [stepIndex]: next };
    });
  }, []);

  /** 워크플로 전역 파일 첨부 다이얼로그 열기 */
  const handleGlobalAttach = useCallback(async () => {
    const paths = await ipcInvoke<string[]>('dialog:open-file');
    if (paths && paths.length > 0) setGlobalFiles((prev) => [...prev, ...paths]);
  }, []);

  /** 전역 첨부 파일 제거 */
  const handleGlobalRemoveFile = useCallback((index: number) => {
    setGlobalFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** HITL 승인 요청에 응답 */
  const handleHitlRespond = useCallback(async (id: string, response: 'allow_once' | 'allow_always' | 'reject') => {
    await ipcInvoke('workflow:permission-respond', { requestId: id, response });
    setHitlRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** 드래그 시작 — 단계 순서 변경을 위한 드래그 인덱스 저장 */
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  /** 드래그 오버 — 드롭 효과 설정 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  /** 드롭 — 단계 순서 변경 또는 새 에이전트 추가 */
  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIndex = dragIndex.current;
    const agentName = e.dataTransfer.getData('text/workflow-agent');
    if (agentName && selectedRunId) {
      dragIndex.current = null;
      ipcInvoke<WorkflowRunDetail>('workflow:add-step', {
        workflowRunId: selectedRunId, agentName,
      }).then((detail) => { if (detail) setSteps(detail.steps); });
      return;
    }
    if (fromIndex === null || fromIndex === dropIndex) return;
    const newSteps = [...steps];
    const [moved] = newSteps.splice(fromIndex, 1);
    newSteps.splice(dropIndex, 0, moved!);
    setSteps(newSteps.map((s, i) => ({ ...s, stepIndex: i })));
    dragIndex.current = null;
  }, [steps, selectedRunId]);

  /** 워크플로 컨테이너 드래그 오버 — 에이전트 드롭 영역 표시 */
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/workflow-agent')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  /** 워크플로 컨테이너에 에이전트 드롭 — 새 단계 추가 */
  const handleContainerDrop = useCallback(async (e: React.DragEvent) => {
    const agentName = e.dataTransfer.getData('text/workflow-agent');
    if (!agentName || !selectedRunId) return;
    e.preventDefault();
    const detail = await ipcInvoke<WorkflowRunDetail>('workflow:add-step', {
      workflowRunId: selectedRunId, agentName,
    });
    if (detail) setSteps(detail.steps);
  }, [selectedRunId]);

  /** 입력 필드 키보드 이벤트 처리 — Enter 전송, Shift+Enter 줄바꿈 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  /** 현재 활성 단계 건너뛰기 */
  const handleSkipStep = useCallback(async () => {
    if (!selectedRunId || currentStepIndex < 0) return;
    await ipcInvoke('workflow:skip-step', { workflowRunId: selectedRunId, stepIndex: currentStepIndex });
  }, [selectedRunId, currentStepIndex]);

  const isWorkflowRunning = runStatus === 'running';

  return (
    <div className="wv">
      <div className="wv__chat"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
      >
        {steps.length === 0 && !responseMsg ? (
          <div className="wv__empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <p>메시지를 입력하면 AI가 자동으로 워크플로를 구성합니다</p>
            <p className="wv__empty-hint">또는 좌측 사이드바에서 에이전트를 직접 추가하세요</p>
          </div>
        ) : (
          <div className="wv__conversation">
            {responseMsg && (
              <div className={`wv__response ${responseMsg.error ? 'wv__response--err' : ''}`}>
                {responseMsg.text}
                <button className="wv__response-dismiss" onClick={() => setResponseMsg(null)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            )}

            {runStatus && (
              <div className="wv__bar">
                <span className={`wv__badge wv__badge--${runStatus}`}>{statusLabel(runStatus)}</span>
                <span className="wv__progress">{Math.max(0, currentStepIndex)} / {steps.length} 단계</span>
                <span className="wv__spacer" />
                {isWorkflowRunning && (
                  <button className="wv__bar-btn wv__bar-btn--skip" onClick={handleSkipStep}
                    disabled={currentStepIndex < 0}>건너뛰기</button>
                )}
                {(runStatus === 'failed' || runStatus === 'cancelled') && (
                  <button className="wv__bar-btn wv__bar-btn--retry" onClick={handleRetry}>재시도</button>
                )}
              </div>
            )}

            {goalPrompt && (
              <div className="chat-msg chat-msg--user">
                <div className="chat-bubble chat-bubble--user">{goalPrompt}</div>
              </div>
            )}

            {steps.map((step, index) => (
              <div key={step.stepIndex}
                className="workflow-step-wrapper"
                draggable={runStatus !== 'running'}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
              >
                <div className="workflow-step-drag-handle" title="드래그하여 순서 변경">⠿</div>
                <AgentCard
                  step={step} index={index}
                  isActive={index === currentStepIndex && isWorkflowRunning}
                  isWorkflowRunning={isWorkflowRunning}
                  onRun={handleStepRun}
                  onStop={handleStepStop}
                  onRemove={handleRemoveStep}
                  onPromptChange={handlePromptChange}
                  attachedFiles={attachedFilesMap[step.stepIndex]}
                  onAttachFiles={handleAttachFiles}
                  onRemoveFile={handleRemoveFile}
                />
                {hitlRequests.filter((h) => h.stepIndex === index).map((h) => (
                  <div key={h.id} className="chat-msg">
                    <HitlCard request={h} onRespond={handleHitlRespond} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="wv__input">
        {globalFiles.length > 0 && (
          <div className="wv__global-files">
            {globalFiles.map((fp, i) => (
              <span key={i} className="agent-card__file-chip">
                <span className="agent-card__file-name">{fp.split('/').pop() || fp}</span>
                <button className="agent-card__file-remove" onClick={() => handleGlobalRemoveFile(i)}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="wv__input-bar">
          <textarea className="wv__textarea" rows={1}
            ref={mainTextareaRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="워크플로 요청사항을 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)"
            disabled={isSending || isWorkflowRunning}
          />
          <div className="wv__input-actions">
            <button className="wv__input-btn" onClick={handleGlobalAttach}
              disabled={isSending || isWorkflowRunning} title="파일 첨부">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button className="wv__input-btn wv__input-btn--send"
              onClick={handleSend}
              disabled={!chatInput.trim() || isSending || isWorkflowRunning}
              title="전송 (Enter)">
              {isSending ? (
                <span className="csc-spinner" style={{ width: 14, height: 14 }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Workflow Sidebar ────────────────────────────────

/**
 * WorkflowSidebar — 워크플로 실행 기록 및 에이전트 목록 사이드바.
 * 실행 기록(runs) 탭과 에이전트(agents) 탭으로 구성.
 * @returns 워크플로 사이드바 JSX 요소
 */
export const WorkflowSidebar: React.FC = () => {
  const selectedRunId = useUIStore((s) => s.selectedWorkflowRunId);
  const setSelectedRunId = useUIStore((s) => s.setSelectedWorkflowRunId);
  const sidebarTab = useUIStore((s) => s.workflowSidebarTab);
  const setSidebarTab = useUIStore((s) => s.setWorkflowSidebarTab);
  const selectedEngine = useUIStore((s) => s.selectedEngine);

  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [runInfo, setRunInfo] = useState<WorkflowRunDetail | null>(null);

  /** 워크플로 실행 목록 로드 */
  const loadRuns = useCallback(async () => {
    const result = await ipcInvoke<WorkflowRunSummary[]>('workflow:runs');
    if (result) setRuns(result);
  }, []);

  /** 선택된 실행의 상세 정보 로드 */
  const loadRunInfo = useCallback(async () => {
    if (!selectedRunId) { setRunInfo(null); return; }
    const detail = await ipcInvoke<WorkflowRunDetail>('workflow:run-detail', selectedRunId);
    if (detail) setRunInfo(detail);
  }, [selectedRunId]);

  /** 에이전트 프로필 목록 로드 */
  const loadAgents = useCallback(async () => {
    const result = await ipcInvoke<AgentProfile[]>('workflow:agent-profiles');
    if (result && Array.isArray(result)) setAgents(result);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadRuns(), loadAgents()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => { loadRunInfo(); }, [selectedRunId, loadRunInfo]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.on('workflow:run-status', () => { loadRuns(); loadRunInfo(); });
    return () => unsub();
  }, [loadRuns, loadRunInfo]);

  /** 선택된 실행 기록 삭제 */
  const handleDeleteRun = useCallback(async (runId: string) => {
    const ok = await ipcInvoke<boolean>('workflow:delete-run', runId);
    if (ok && runId === selectedRunId) setSelectedRunId(null);
    loadRuns();
  }, [selectedRunId, setSelectedRunId]);

  /** 워크플로 초기화 — 선택 해제 */
  const handleReset = useCallback(() => {
    setSelectedRunId(null);
    setRunInfo(null);
  }, [setSelectedRunId]);

  /** 새 워크플로 실행 생성 (goal prompt 입력 상태로) */
  const handleCreateRunFromGoal = useCallback(() => {
    setSelectedRunId(null);
  }, [setSelectedRunId]);

  /** 에이전트 원클릭 프롬프트로 바로 워크플로 생성 및 실행 */
  const handleAgentQuickPrompt = useCallback(async (agentName: string, prompt: string) => {
    const ss = useUIStore.getState();
    const result = await ipcInvoke<{ workflowRunId: string }>('workflow:create-run', {
      goalPrompt: prompt,
      steps: [{ agentName, prompt, title: agentName, iconKey: 'bot', skillName: null }],
      sandboxMode: ss.sandboxMode, approvalPolicy: ss.approvalPolicy, engine: selectedEngine,
    });
    if (result?.workflowRunId) {
      setSelectedRunId(result.workflowRunId);
      setSidebarTab('runs');
      await ipcInvoke('workflow:run', result.workflowRunId);
    }
  }, [setSelectedRunId, setSidebarTab, selectedEngine]);

  /** 에이전트 선택 — 워크플로에 추가하거나 새 실행 생성 */
  const handleAgentClick = useCallback(async (agent: AgentProfile) => {
    if (!selectedRunId) {
      const ss = useUIStore.getState();
      const result = await ipcInvoke<{ workflowRunId: string }>('workflow:create-run', {
        goalPrompt: agent.oneClickPrompt || `${agent.roleLabelKo || agent.name} 실행`,
        steps: [{
          agentName: agent.name, prompt: agent.oneClickPrompt || `${agent.roleLabelKo || agent.name} 작업을 실행합니다.`,
          title: agent.roleLabelKo || agent.name, iconKey: agent.iconKey || 'bot', skillName: agent.skillName,
        }],
        sandboxMode: ss.sandboxMode, approvalPolicy: ss.approvalPolicy, engine: selectedEngine,
      });
      if (result?.workflowRunId) {
        setSelectedRunId(result.workflowRunId);
        setSidebarTab('runs');
      }
      return;
    }
    await ipcInvoke<WorkflowRunDetail>('workflow:add-step', {
      workflowRunId: selectedRunId, agentName: agent.name, prompt: agent.oneClickPrompt || undefined,
    });
  }, [selectedRunId, setSelectedRunId, setSidebarTab, selectedEngine]);

  const currentRun = runs.find((r) => r.workflowRunId === selectedRunId);

  return (
    <div className="workflow-sidebar">
      <div className="workflow-sidebar-tabs">
        <button className={`workflow-sidebar-tab ${sidebarTab === 'runs' ? 'active' : ''}`}
          onClick={() => setSidebarTab('runs')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 10H4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zm10-10h-6c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/></svg>
          실행 기록
        </button>
        <button className={`workflow-sidebar-tab ${sidebarTab === 'agents' ? 'active' : ''}`}
          onClick={() => setSidebarTab('agents')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          에이전트 목록
        </button>
      </div>

      <div className="workflow-sidebar-tab-content">
        {sidebarTab === 'runs' ? (
          <>
            <div className="workflow-sidebar-header">
              <h3>실행 기록</h3>
              <button className="btn-create-run" onClick={handleCreateRunFromGoal} title="AI로 새 워크플로 실행">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                새 실행
              </button>
            </div>
            {loading ? (
              <div className="workflow-sidebar-loading"><span className="codicon codicon-loading codicon-modifier-spin" /></div>
            ) : runs.length === 0 ? (
              <div className="workflow-sidebar-empty"><p>실행 기록이 없습니다</p></div>
            ) : (
              <div className="workflow-run-list">
                {runs.map((run) => (
                  <div key={run.workflowRunId}
                    className={`workflow-run-item ${run.workflowRunId === selectedRunId ? 'selected' : ''}`}
                    onClick={() => setSelectedRunId(run.workflowRunId)}
                  >
                    <span className={`run-status-dot status-${run.status}`} />
                    <div className="workflow-run-item__info">
                      <span className="workflow-run-item__goal">{run.goalPromptPreview}</span>
                      <span className="workflow-run-item__meta">{statusLabel(run.status)} &middot; {run.currentStepIndex ?? 0}/{run.totalSteps} 단계</span>
                    </div>
                    <button className="workflow-run-item__del"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.workflowRunId); }} title="삭제">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="workflow-sidebar-header">
              <h3>에이전트 목록</h3>
            </div>
            {loading ? (
              <div className="workflow-sidebar-loading"><span className="codicon codicon-loading codicon-modifier-spin" /></div>
            ) : agents.length === 0 ? (
              <div className="workflow-sidebar-empty"><p>등록된 에이전트가 없습니다</p></div>
            ) : (
              <div className="workflow-agent-list">
                {agents.map((agent) => (
                  <div key={agent.name} className="workflow-agent-item" draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/workflow-agent', agent.name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => handleAgentClick(agent)}
                  >
                    <span className="workflow-agent-icon">{getIcon(agent.iconKey)}</span>
                    <div className="workflow-agent-info">
                      <span className="workflow-agent-name">{agent.roleLabelKo || agent.name}</span>
                      <span className="workflow-agent-dept">{agent.departmentLabelKo}</span>
                    </div>
                    {agent.oneClickPrompt && (
                      <button className="workflow-agent-quick-run"
                        onClick={(e) => { e.stopPropagation(); handleAgentQuickPrompt(agent.name, agent.oneClickPrompt!); }}
                        title="바로 실행">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {selectedRunId && (
              <div className="workflow-current-run">
                <span className="workflow-current-run__name" onClick={() => setSidebarTab('runs')}>
                  {currentRun?.goalPromptPreview?.slice(0, 30) || '워크플로 실행 중'}
                </span>
                <button className="workflow-current-run__info" onClick={() => loadRunInfo()} title="상세 정보">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                </button>
                <button className="workflow-current-run__reset" onClick={handleReset} title="초기화">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            )}
            {runInfo && (
              <div className="workflow-run-info-popup">
                <div className="workflow-run-info-popup__header">
                  <strong>워크플로 정보</strong>
                  <button onClick={() => setRunInfo(null)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  </button>
                </div>
                <div className="workflow-run-info-popup__field">
                  <label>요청 프롬프트</label>
                  <p>{runInfo.goalPrompt}</p>
                </div>
                <div className="workflow-run-info-popup__field">
                  <label>Sandbox</label>
                  <span>{runInfo.sandboxMode || 'default'}</span>
                </div>
                <div className="workflow-run-info-popup__field">
                  <label>Approval</label>
                  <span>{runInfo.approvalPolicy || 'default'}</span>
                </div>
                <div className="workflow-run-info-popup__field">
                  <label>에이전트 목록</label>
                  <ul>
                    {runInfo.steps.map((s) => (
                      <li key={s.stepIndex}>
                        <strong>{s.title || s.agentName}</strong>
                        {s.reason && <span> — {s.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WorkflowView;
