/**
 * WorkflowEngine — 다단계 워크플로우 실행 엔진.
 *
 * @what
 * - 여러 AI 에이전트를 순차적으로 실행하는 워크플로우를 생성, 실행, 취소, 재시도합니다.
 * - 사용자 목표에 적합한 에이전트를 LLM 추천 또는 키워드 스코어링으로 자동 선택합니다.
 *
 * @design
 * - 각 단계(step)는 RunOrchestrator.createRun()을 호출하여 개별 Run으로 실행됩니다.
 * - 이전 단계 결과를 carryOverSummary로 다음 단계 컨텍스트에 주입합니다.
 * - SQLite(WorkflowStore)에 모든 상태를 영구 저장합니다.
 *
 * @usage
 *   const engine = new WorkflowEngine({ runOrchestrator, eventBroker });
 *   const agents = await engine.recommendAgents(goalPrompt);
 *   const { workflowRunId } = await engine.createWorkflowRun(goalPrompt, steps);
 *   await engine.runWorkflowRun(workflowRunId);
 */
import { EventBroker } from '../services/EventBroker';
import { RunOrchestrator } from './RunOrchestrator';
import { WorkflowStore } from '../stores/WorkflowStore';
import { ConfigReader } from '../services/ConfigReader';
import { SETTINGS } from '../settings/AppSettings';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowRecommendedAgent, WorkflowStepRun, WorkflowRunDetail, WorkflowRunSummary } from '../../types/ipc-contract';

/**
 * 워크플로우 실행 상태를 나타내는 타입.
 * draft(초안), queued(대기 중), running(실행 중), completed(완료), failed(실패), cancelled(취소).
 */
type WorkflowStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 워크플로우 실행 중 메모리 내 실행 컨텍스트.
 * 현재 단계 인덱스, 완료된 단계 집합, 단계별 결과 및 이월 요약을 보관합니다.
 */
interface WorkflowContext {
  workflowRunId: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  completedStepIndices: Set<number>;
  stepResults: Map<number, unknown>;
  carryOverSummaries: string[];
}

const WORKFLOW_RECOMMENDATION_PROMPT_TEMPLATE = `You are a workflow planner. Given a user's goal, recommend the best agents to accomplish it.

Available agents:
{AGENT_CATALOG}

User's goal: {GOAL}

Rules:
- Recommend between 1 and {MAX_AGENTS} agents.
- Use only agent names from the available list.
- Select agents by matching the user goal against skill description, agent description, role, and department.
- Reject agents whose skill does not directly contribute to the goal.
- Preserve a sensible execution order for multi-step workflows.
- Choose complementary agents with distinct responsibilities.
- Keep each reason concise and cite the matched skill capability.
- Write defaultPrompt targeted to that agent's specific capability.
- Output ONLY valid JSON with no markdown fences or explanatory text.

Respond with a JSON array: [{"agentName": string, "reason": string, "defaultPrompt": string}]`;

export class WorkflowEngine {
  /** RunOrchestrator 인스턴스: 각 워크플로우 단계를 개별 Run으로 실행합니다. */
  private runOrchestrator: RunOrchestrator;
  /** 이벤트 브로커: 워크플로우/단계 상태 변경 이벤트를 구독자에게 전파합니다. */
  private eventBroker: EventBroker;
  /** SQLite WorkflowStore: 워크플로우 실행 상태를 영구 저장/조회합니다. */
  private workflowStore: WorkflowStore;
  /** ConfigReader: 에이전트/스킬/라우터 설정을 읽어옵니다. */
  private configReader: ConfigReader;
  /** 현재 실행 중인 워크플로우의 컨텍스트 맵 (workflowRunId → WorkflowContext). */
  private runningWorkflows = new Map<string, WorkflowContext>();
  /** 현재 실행 중인 워크플로우의 최상위 Promise 맵 (workflowRunId → Promise). */
  private workflowTasks = new Map<string, Promise<void>>();
  /** 워크플로우 단계가 현재 할당된 Run의 ID 맵 (workflowRunId → runId). */
  private activeRunIds = new Map<string, string>();

  /**
   * WorkflowEngine을 초기화합니다.
   * @param deps.runOrchestrator - 개별 Run 실행을 위임할 RunOrchestrator
   * @param deps.eventBroker - 이벤트 전파에 사용할 EventBroker
   */
  constructor(deps: { runOrchestrator: RunOrchestrator; eventBroker: EventBroker }) {
    this.runOrchestrator = deps.runOrchestrator;
    this.eventBroker = deps.eventBroker;
    this.workflowStore = new WorkflowStore();
    this.configReader = new ConfigReader();
  }

  /**
   * 새 워크플로우 템플릿을 생성합니다.
   * @param workflow - 생성할 워크플로우 데이터
   * @returns 생성된 워크플로우
   */
  createWorkflow(workflow: Workflow): Workflow {
    return this.workflowStore.createWorkflow(workflow);
  }

  /**
   * 기존 워크플로우 템플릿을 업데이트합니다.
   * @param workflow - 업데이트할 워크플로우 데이터
   * @returns 업데이트된 워크플로우, 없으면 null
   */
  updateWorkflow(workflow: Workflow): Workflow | null {
    return this.workflowStore.updateWorkflow(workflow);
  }

  /**
   * 워크플로우 템플릿을 삭제합니다.
   * @param workflowId - 삭제할 워크플로우 ID
   * @returns 삭제 성공 여부
   */
  deleteWorkflow(workflowId: string): boolean {
    return this.workflowStore.deleteWorkflow(workflowId);
  }

  /**
   * 모든 워크플로우 템플릿 목록을 반환합니다.
   * @returns 워크플로우 배열
   */
  listWorkflows(): Workflow[] {
    return this.workflowStore.listWorkflows();
  }

  /**
   * 사용자 목표에 적합한 AI 에이전트를 추천합니다.
   * 우선 LLM 추천을 시도하고, 실패 시 키워드 스코어링 기반 폴백 추천을 반환합니다.
   * @param goalPrompt - 사용자 목표 문장
   * @param maxAgents - 최대 추천 에이전트 수 (기본값: SETTINGS.workflowRecommendationMaxAgents)
   * @param engine - 사용할 엔진 (gemini, opencode, claudecode)
   * @returns 추천 에이전트 배열
   */
  async recommendAgents(goalPrompt: string, maxAgents?: number, engine?: string): Promise<WorkflowRecommendedAgent[]> {
    const limit = maxAgents ?? SETTINGS.workflowRecommendationMaxAgents;
    const inventory = this._buildInventory(engine);
    const agentProfiles = this._buildAgentProfiles(inventory.agents, engine);
    const healthy = agentProfiles.filter(a => a.status === 'healthy');

    if (healthy.length === 0) {
      return this._fallbackRecommendation(goalPrompt, limit, inventory);
    }

    const catalog = this._buildRichCatalog(healthy);
    try {
      const llmResult = await this._recommendViaCli(goalPrompt, catalog, limit, engine);
      if (llmResult.length > 0) {
        return this._completeRecommendations(goalPrompt, llmResult, healthy, limit);
      }
    } catch {}

    return this._fallbackRecommendation(goalPrompt, limit, inventory);
  }

  /**
   * 워크플로우 실행 레코드를 생성하고 대기열에 등록합니다.
   * 생성된 레코드는 'draft' 상태이며, runWorkflowRun() 호출로 실행됩니다.
   * @param goalPrompt - 워크플로우 목표 문장
   * @param steps - 실행할 단계 목록 (agentName, prompt, title, iconKey, skillName)
   * @param workspaceRoot - 작업 디렉터리 경로
   * @param sandboxMode - 샌드박스 모드 (read-only / workspace-write / danger-full-access)
   * @param approvalPolicy - 승인 정책 (untrusted / on-request / never)
   * @param engine - 사용할 엔진
   * @returns 생성된 워크플로우 실행 ID
   */
  async createWorkflowRun(
    goalPrompt: string,
    steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>,
    workspaceRoot?: string, sandboxMode?: string | null, approvalPolicy?: string | null, engine?: string | null,
  ): Promise<{ workflowRunId: string }> {
    const record = this.workflowStore.createWorkflowRun(goalPrompt, steps, workspaceRoot, sandboxMode, approvalPolicy, engine);
    this._pushWorkflowEvent(record.workflowRunId, 'workflow:queued', 'workflow queued');
    return { workflowRunId: record.workflowRunId };
  }

  /**
   * 등록된 워크플로우 실행을 순차적으로 시작합니다.
   * 중복 실행을 방지하고, 각 단계를 RunOrchestrator.createRun()으로 실행합니다.
   * @param workflowRunId - 실행할 워크플로우 실행 ID
   * @returns 워크플로우 실행 ID
   * @throws 워크플로우 실행 레코드가 없거나 draft 상태가 아닌 경우
   */
  async runWorkflowRun(workflowRunId: string): Promise<string> {
    if (this.runningWorkflows.has(workflowRunId)) {
      console.log(`[workflow] ${workflowRunId} already running, ignoring duplicate call`);
      return workflowRunId;
    }
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) throw new Error(`Workflow run not found: ${workflowRunId}`);
    if (record.status !== 'draft') throw new Error(`Workflow run is not in draft status: ${record.status}`);

    const context: WorkflowContext = {
      workflowRunId,
      status: 'running',
      currentStepIndex: 0,
      completedStepIndices: new Set(),
      stepResults: new Map(),
      carryOverSummaries: [],
    };

    this.runningWorkflows.set(workflowRunId, context);

    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const task = this._executeStepsSequentially(workflowRunId, steps, context, record.engine, record.sandboxMode, record.approvalPolicy);
    this.workflowTasks.set(workflowRunId, task);
    task.finally(() => this.workflowTasks.delete(workflowRunId));

    return workflowRunId;
  }

  /**
   * 실행 중인 워크플로우를 취소합니다.
   * 현재 활성 Run을 취소하고, 모든 단계를 취소 상태로 기록합니다.
   * @param workflowRunId - 취소할 워크플로우 실행 ID
   * @returns 취소 성공 여부 (실행 중이 아니면 false)
   */
  async cancelWorkflowRun(workflowRunId: string): Promise<boolean> {
    const context = this.runningWorkflows.get(workflowRunId);
    if (!context) return false;

    context.status = 'cancelled';

    const activeRunId = this.activeRunIds.get(workflowRunId);
    if (activeRunId) {
      try {
        await this.runOrchestrator.cancelRun(activeRunId);
      } catch {}
      this.activeRunIds.delete(workflowRunId);
    }

    const task = this.workflowTasks.get(workflowRunId);

    if (context.currentStepIndex !== undefined) {
      this.workflowStore.updateWorkflowStep(workflowRunId, context.currentStepIndex, { status: 'cancelled', errorMessage: 'workflow cancelled by user' });
    }
    this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'cancelled', context.currentStepIndex, 'cancelled by user');
    this._pushWorkflowEvent(workflowRunId, 'workflow:cancelled', 'workflow cancelled by user');
    this.runningWorkflows.delete(workflowRunId);
    return true;
  }

  /**
   * 완료 또는 실패한 워크플로우를 처음부터 재시도합니다.
   * 동일한 단계 입력으로 새 워크플로우 실행을 생성하고 바로 실행합니다.
   * @param workflowRunId - 재시도할 워크플로우 실행 ID
   * @param engine - 재시도에 사용할 엔진 (기본값: 기존 엔진)
   * @returns 새 워크플로우 실행 ID, 실패 시 null
   */
  async retryWorkflowRun(workflowRunId: string, engine?: string): Promise<string | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const stepInputs = steps.map(s => ({
      agentName: s.agentName, prompt: s.prompt, title: s.title, iconKey: s.iconKey, skillName: s.skillName,
    }));
    const created = await this.createWorkflowRun(record.goalPrompt, stepInputs, record.workspaceRoot, record.sandboxMode, record.approvalPolicy, engine ?? record.engine);
    await this.runWorkflowRun(created.workflowRunId);
    return created.workflowRunId;
  }

  /**
   * 실패한 워크플로우를 특정 단계부터 재시도합니다.
   * 지정된 단계부터 끝까지만 새 워크플로우로 생성하며, 이전 단계의 요약을 carryOver로 주입합니다.
   * @param workflowRunId - 재시도할 워크플로우 실행 ID
   * @param stepIndex - 재시작할 단계 인덱스
   * @param engine - 재시도에 사용할 엔진
   * @returns 새 워크플로우 실행 ID, 실패 시 null
   */
  async retryWorkflowRunFromStep(workflowRunId: string, stepIndex: number, engine?: string): Promise<string | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const stepInputs = steps.slice(stepIndex).map(s => ({
      agentName: s.agentName, prompt: s.prompt, title: s.title, iconKey: s.iconKey, skillName: s.skillName,
    }));
    const carryOver = steps.slice(0, stepIndex).filter(s => s.summary).map(s => s.summary).join('\n');
    if (carryOver && stepInputs[0]) {
      stepInputs[0] = { ...stepInputs[0], prompt: `${stepInputs[0].prompt}\n\nPrevious context:\n${carryOver}`, agentName: stepInputs[0].agentName ?? '', title: stepInputs[0].title ?? `Step ${stepIndex}`, iconKey: stepInputs[0].iconKey ?? 'bot', skillName: stepInputs[0].skillName ?? null };
    }
    const created = await this.createWorkflowRun(record.goalPrompt, stepInputs, record.workspaceRoot, record.sandboxMode, record.approvalPolicy, engine ?? record.engine);
    await this.runWorkflowRun(created.workflowRunId);
    return created.workflowRunId;
  }

  /**
   * 현재 실행 중인 단계를 건너뛰고 다음 단계를 계속 실행합니다.
   * 건너뛴 단계는 'skipped' 상태로 기록됩니다.
   * @param workflowRunId - 대상 워크플로우 실행 ID
   * @param stepIndex - 건너뛸 단계 인덱스
   * @param engine - 계속 실행에 사용할 엔진
   * @returns 워크플로우 실행 ID, 조건 불일치 시 null
   */
  async skipWorkflowStepAndContinue(workflowRunId: string, stepIndex: number, engine?: string): Promise<string | null> {
    const context = this.runningWorkflows.get(workflowRunId);
    if (!context) return null;
    if (context.currentStepIndex !== stepIndex) return null;

    this.workflowStore.updateWorkflowStep(workflowRunId, stepIndex, { status: 'skipped' });
    this._pushWorkflowEvent(workflowRunId, 'step:skipped', `step ${stepIndex} skipped`, stepIndex);
    context.completedStepIndices.add(stepIndex);
    context.currentStepIndex = stepIndex + 1;

    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    this._continueExecution(workflowRunId, steps, context, engine ?? record?.engine, record?.sandboxMode, record?.approvalPolicy);
    return workflowRunId;
  }

  /**
   * 워크플로우 실행 레코드를 조회합니다.
   * @param workflowRunId - 조회할 실행 ID
   * @returns 워크플로우 실행 레코드 또는 null
   */
  getWorkflowRun(workflowRunId: string) {
    return this.workflowStore.getWorkflowRun(workflowRunId);
  }

  /**
   * 워크플로우 실행 레코드를 삭제합니다.
   * 현재 실행 중인 워크플로우는 삭제할 수 없습니다.
   * @param workflowRunId - 삭제할 실행 ID
   * @returns 삭제 성공 여부 (실행 중이면 false)
   */
  deleteWorkflowRun(workflowRunId: string): boolean {
    if (this.runningWorkflows.has(workflowRunId)) return false;
    return this.workflowStore.deleteWorkflowRun(workflowRunId);
  }

  /**
   * 워크플로우 실행 상세 정보(레코드 + 단계 목록)를 반환합니다.
   * @param workflowRunId - 조회할 실행 ID
   * @returns 상세 정보 객체 또는 null
   */
  getWorkflowRunDetail(workflowRunId: string): WorkflowRunDetail | null {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    const steps = this.getWorkflowSteps(workflowRunId);
    return {
      workflowRunId: record.workflowRunId,
      goalPrompt: record.goalPrompt,
      workspaceRoot: record.workspaceRoot,
      sandboxMode: record.sandboxMode as WorkflowRunDetail['sandboxMode'],
      approvalPolicy: record.approvalPolicy as WorkflowRunDetail['approvalPolicy'],
      engine: record.engine,
      status: record.status as WorkflowRunDetail['status'],
      currentStepIndex: record.currentStepIndex,
      totalSteps: record.totalSteps,
      steps,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      errorMessage: record.errorMessage,
    };
  }

  /**
   * 워크플로우의 모든 실행 단계를 반환합니다.
   * @param workflowRunId - 조회할 실행 ID
   * @returns 워크플로우 단계 배열
   */
  getWorkflowSteps(workflowRunId: string): WorkflowStepRun[] {
    const records = this.workflowStore.getWorkflowSteps(workflowRunId);
    return records.map(r => ({
      stepIndex: r.stepIndex, agentName: r.agentName, skillName: r.skillName,
      iconKey: r.iconKey, title: r.title, prompt: r.prompt, status: r.status as WorkflowStepRun['status'],
      runId: r.runId, reason: r.reason, summary: r.summary, lastEventMessage: r.lastEventMessage,
      startedAt: r.startedAt, completedAt: r.completedAt, exitCode: r.exitCode, errorMessage: r.errorMessage,
    }));
  }

  /**
   * 워크플로우 실행 목록을 최신순으로 반환합니다.
   * goalPrompt는 미리보기 길이로 잘라서 표시합니다.
   * @param limit - 최대 조회 개수
   * @returns 워크플로우 실행 요약 배열
   */
  listWorkflowRuns(limit?: number): WorkflowRunSummary[] {
    const records = this.workflowStore.listWorkflowRuns(limit);
    return records.map(r => ({
      workflowRunId: r.workflowRunId,
      goalPromptPreview: r.goalPrompt.length > SETTINGS.workflowGoalPreviewMaxChars
        ? r.goalPrompt.slice(0, SETTINGS.workflowGoalPreviewMaxChars - 3) + '...'
        : r.goalPrompt,
      workspaceRoot: r.workspaceRoot, status: r.status as WorkflowRunSummary['status'],
      currentStepIndex: r.currentStepIndex, totalSteps: r.totalSteps,
      createdAt: r.createdAt, startedAt: r.startedAt, completedAt: r.completedAt, errorMessage: r.errorMessage,
      engine: r.engine,
    }));
  }

  /**
   * 워크플로우 실행 중 발생한 이벤트 목록을 반환합니다.
   * @param workflowRunId - 조회할 실행 ID
   * @param limit - 최대 조회 개수
   * @returns 이벤트 배열
   */
  getWorkflowEvents(workflowRunId: string, limit?: number) {
    return this.workflowStore.getWorkflowEvents(workflowRunId, limit);
  }

  /**
   * 등록된 모든 에이전트의 프로필 정보를 반환합니다.
   * 각 에이전트에 아이콘 키를 순차적으로 할당합니다.
   * @param engine - 에이전트 설정을 읽어올 엔진
   * @returns 에이전트 프로필 배열 (이름, 역할, 부서, 설명, 아이콘 등)
   */
  listAgentProfiles(engine?: string): Array<{ name: string; roleLabelKo: string; departmentLabelKo: string; description: string; shortDescription: string | null; oneClickPrompt: string | null; skillName: string | null; iconKey: string; }> {
    const inventory = this._buildInventory(engine);
    const iconKeys = ['bot', 'shield', 'check-circle', 'file-text', 'database', 'layout', 'server', 'play-square', 'folder', 'table', 'presentation'];
    return inventory.agents.map((a, i) => ({
      name: String(a.name || 'unknown'),
      roleLabelKo: String(a.roleLabelKo || a.department || ''),
      departmentLabelKo: String(a.departmentLabelKo || ''),
      description: String(a.description || ''),
      shortDescription: a.shortDescription ? String(a.shortDescription) : null,
      oneClickPrompt: a.oneClickPrompt ? String(a.oneClickPrompt) : null,
      skillName: a.skillName ? String(a.skillName) : null,
      iconKey: iconKeys[i % iconKeys.length]!,
    }));
  }

  /**
   * 워크플로우 실행에서 특정 단계를 제거합니다.
   * @param workflowRunId - 대상 실행 ID
   * @param stepIndex - 제거할 단계 인덱스
   * @returns 업데이트된 워크플로우 상세 또는 null
   */
  async removeStepFromRun(workflowRunId: string, stepIndex: number): Promise<WorkflowRunDetail | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    this.workflowStore.removeWorkflowStep(workflowRunId, stepIndex);
    this._pushWorkflowEvent(workflowRunId, 'step:removed', `step ${stepIndex} removed`);
    return this.getWorkflowRunDetail(workflowRunId);
  }

  /**
   * 워크플로우 단계의 프롬프트를 업데이트합니다.
   * @param workflowRunId - 대상 실행 ID
   * @param stepIndex - 수정할 단계 인덱스
   * @param prompt - 새 프롬프트 내용
   * @returns 업데이트된 워크플로우 상세 또는 null
   */
  async updateStepPrompt(workflowRunId: string, stepIndex: number, prompt: string): Promise<WorkflowRunDetail | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    this.workflowStore.updateWorkflowStep(workflowRunId, stepIndex, { prompt });
    return this.getWorkflowRunDetail(workflowRunId);
  }

  /**
   * 워크플로우 실행에 새 단계를 추가합니다.
   * 에이전트의 oneClickPrompt가 있으면 기본 프롬프트로 사용합니다.
   * @param workflowRunId - 대상 실행 ID
   * @param agentName - 추가할 에이전트 이름
   * @param prompt - 단계 프롬프트 (생략 시 에이전트 기본 프롬프트 사용)
   * @returns 업데이트된 워크플로우 상세 또는 null
   */
  async addStepToRun(workflowRunId: string, agentName: string, prompt?: string): Promise<WorkflowRunDetail | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;

    const inventory = this._buildInventory();
    const agent = inventory.agents.find(a => String(a.name) === agentName);
    const iconKeys = ['bot', 'shield', 'check-circle', 'file-text', 'database', 'layout', 'server', 'play-square', 'folder', 'table', 'presentation'];

    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const nextIndex = steps.length;
    const agentPrompt = prompt || (agent?.oneClickPrompt ? String(agent!.oneClickPrompt) : `${agentName} 실행`);
    const stepInput = {
      agentName,
      prompt: agentPrompt,
      title: agent?.roleLabelKo ? String(agent!.roleLabelKo) : agentName,
      iconKey: iconKeys[nextIndex % iconKeys.length]!,
      skillName: agent?.skillName ? String(agent!.skillName) : null,
    };

    this.workflowStore.addWorkflowStep(workflowRunId, stepInput);
    this._pushWorkflowEvent(workflowRunId, 'step:added', `step ${nextIndex}: ${agentName}`, nextIndex);
    return this.getWorkflowRunDetail(workflowRunId);
  }

  /**
   * 각 워크플로우 단계에 전달할 컨텍스트가 포함된 프롬프트를 구성합니다.
   * 워크플로우 목표, 현재 단계 번호, 이전 단계 요약을 주입합니다.
   * @param goalPrompt - 워크플로우 전체 목표
   * @param stepIndex - 현재 단계 인덱스
   * @param totalSteps - 전체 단계 수
   * @param instructionPrompt - 해당 단계의 실행 지시문
   * @param carryoverSummaries - 이전 단계 실행 요약 배열
   * @returns 구성된 전체 프롬프트 문자열
   */
  private _buildStepPrompt(goalPrompt: string, stepIndex: number, totalSteps: number, instructionPrompt: string, carryoverSummaries: string[]): string {
    const previousContext = carryoverSummaries.length > 0
      ? carryoverSummaries.slice(-4).map(s => `- ${s}`).join('\n')
      : '- 이전 단계 요약 없음';
    return (
      '[Workflow Context]\n' +
      `Workflow Goal: ${goalPrompt}\n` +
      `Current Step: ${stepIndex + 1} / ${totalSteps}\n` +
      'Previous Step Summaries:\n' +
      `${previousContext}\n\n` +
      '[Current Step Instruction]\n' +
      `${instructionPrompt}`
    );
  }

  /**
   * 워크플로우의 모든 단계를 순차적으로 실행합니다.
   * 각 단계는 RunOrchestrator.createRun()으로 실행되고, 결과에 따라 carryOverSummary를 누적합니다.
   * 단계 실패 또는 전체 예외 발생 시 워크플로우를 실패 처리합니다.
   * @param workflowRunId - 실행 ID
   * @param steps - 실행할 단계 목록
   * @param context - 워크플로우 실행 컨텍스트
   * @param engine - 사용할 엔진
   * @param sandboxMode - 샌드박스 모드
   * @param approvalPolicy - 승인 정책
   */
  private async _executeStepsSequentially(workflowRunId: string, steps: Array<{ stepIndex: number; agentName: string; prompt: string }>, context: WorkflowContext, engine?: string | null, sandboxMode?: string | null, approvalPolicy?: string | null): Promise<void> {
    try {
      this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'running', 0);
      this._pushWorkflowEvent(workflowRunId, 'workflow:started', 'workflow started');
      console.log(`[workflow] started ${workflowRunId} with ${steps.length} steps`);

      for (let i = 0; i < steps.length; i++) {
        if (context.status === 'cancelled') break;
        const step = steps[i]!;
        context.currentStepIndex = i;
        this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'running', i);
        this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'running' });
        this._pushWorkflowEvent(workflowRunId, 'step:started', `step ${i}: ${step.agentName}`, i);
        console.log(`[workflow] step ${i}/${steps.length}: ${step.agentName}`);

        const record = this.workflowStore.getWorkflowRun(workflowRunId);
        const stepPrompt = this._buildStepPrompt(
          record?.goalPrompt ?? '',
          i, steps.length, step.prompt, context.carryOverSummaries,
        );

        try {
          console.log(`[workflow]  -> createRun(${step.agentName})`);
          const created = await this.runOrchestrator.createRun(step.agentName, stepPrompt, record?.workspaceRoot || undefined, sandboxMode, approvalPolicy, engine ?? undefined, { workflowRunId, stepIndex: i });
          this.activeRunIds.set(workflowRunId, created.runId);
          this.workflowStore.updateWorkflowStep(workflowRunId, i, { runId: created.runId, lastEventMessage: 'prompt submitted to engine' });
          console.log(`[workflow]  -> runId=${created.runId}, waiting...`);

          const completed = await this.runOrchestrator.waitForRun(created.runId);
          this.activeRunIds.delete(workflowRunId);

          if (!completed) {
            const msg = `step ${i}: waitForRun returned null`;
            console.error(`[workflow] ERROR ${msg}`);
            this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'failed', errorMessage: 'run not found' });
            this._pushWorkflowEvent(workflowRunId, 'step:failed', msg, i);
            continue;
          }

          const stepStatus = completed.status === 'completed' ? 'completed' : 'failed';
          console.log(`[workflow]  -> ${stepStatus} (exit=${completed.exitCode})`);
          const cliOutput = this.runOrchestrator.popRunOutput(created.runId);
          const cliText = cliOutput.join('\n');
          const summary = cliText
            ? (completed.status === 'completed' ? cliText : `Failed: ${completed.error || cliText}`)
            : (completed.status === 'completed'
              ? `Step ${i} (${step.agentName}) completed successfully.`
              : `Step ${i} (${step.agentName}) failed: ${completed.error || 'unknown error'}`);

          this.workflowStore.updateWorkflowStep(workflowRunId, i, {
            status: stepStatus, runId: completed.id, summary, exitCode: completed.exitCode, errorMessage: completed.error,
          });
          context.completedStepIndices.add(i);

          if (completed.status === 'completed') {
            context.carryOverSummaries.push(summary);
          }

          this._pushWorkflowEvent(workflowRunId, `step:${stepStatus}`, `step ${i}: ${stepStatus}`, i);
          this._pushWorkflowRunStatus(workflowRunId, stepStatus === 'completed' ? 'running' : 'failed', i);

          if (completed.status !== 'completed' && (context.status as string) !== 'cancelled') {
            context.status = 'failed';
            this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'failed', i, `step ${i} failed`);
            this._pushWorkflowEvent(workflowRunId, 'workflow:failed', `workflow failed at step ${i}`);
            this.runningWorkflows.delete(workflowRunId);
            console.error(`[workflow] FAILED at step ${i}`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[workflow] EXCEPTION at step ${i}: ${msg}`);
          if (err instanceof Error && err.stack) console.error(`[workflow] stack: ${err.stack.split('\n').slice(0, 4).join('\n')}`);
          this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'failed', errorMessage: msg });
          this._pushWorkflowEvent(workflowRunId, 'step:error', `step ${i}: ${msg}`, i);
          context.status = 'failed';
          this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'failed', i, msg);
          this._pushWorkflowRunStatus(workflowRunId, 'failed', i);
          this.runningWorkflows.delete(workflowRunId);
          this.activeRunIds.delete(workflowRunId);
          return;
        }
      }

      if (context.status !== 'cancelled') {
        context.status = 'completed';
        this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'completed');
        this._pushWorkflowEvent(workflowRunId, 'workflow:completed', 'all steps completed');
        this._pushWorkflowRunStatus(workflowRunId, 'completed', steps.length - 1);
        this.runningWorkflows.delete(workflowRunId);
        console.log(`[workflow] completed ${workflowRunId}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workflow] FATAL: ${msg}`);
      if (err instanceof Error && err.stack) console.error(`[workflow] stack: ${err.stack.split('\n').slice(0, 4).join('\n')}`);
      this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'failed', context.currentStepIndex, msg);
      this._pushWorkflowEvent(workflowRunId, 'workflow:failed', `unexpected error: ${msg}`);
      this._pushWorkflowRunStatus(workflowRunId, 'failed', context.currentStepIndex);
      this.runningWorkflows.delete(workflowRunId);
      this.activeRunIds.delete(workflowRunId);
    }
  }

  /**
   * 중단된 워크플로우 실행을 남은 단계부터 계속 진행합니다.
   * skipWorkflowStepAndContinue 호출 후 남은 단계를 이어서 실행합니다.
   * @param workflowRunId - 실행 ID
   * @param steps - 전체 단계 목록
   * @param context - 워크플로우 실행 컨텍스트
   * @param engine - 사용할 엔진
   * @param sandboxMode - 샌드박스 모드
   * @param approvalPolicy - 승인 정책
   */
  private _continueExecution(workflowRunId: string, steps: Array<{ stepIndex: number; agentName: string; prompt: string }>, context: WorkflowContext, engine?: string | null, sandboxMode?: string | null, approvalPolicy?: string | null): void {
    const remaining = steps.filter(s => !context.completedStepIndices.has(s.stepIndex));
    const task = this._executeStepsSequentially(workflowRunId, remaining, context, engine, sandboxMode, approvalPolicy);
    this.workflowTasks.set(workflowRunId, task);
    task.finally(() => this.workflowTasks.delete(workflowRunId));
  }

  /**
   * 에이전트 목록에 스킬 설명과 에이전트 요약을 추가하여 프로필을 확장합니다.
   * 검색 가능한 텍스트(searchableText)도 함께 구성합니다.
   * @param agents - 원본 에이전트 설정 배열
   * @param engine - 설정을 읽어올 엔진
   * @returns 확장된 에이전트 프로필 배열
   */
  private _buildAgentProfiles(agents: Array<Record<string, unknown>>, engine?: string): Array<Record<string, unknown>> {
    return agents.map(a => {
      const name = String(a.name || 'unknown');
      const skillPath = a.skill_path ? String(a.skill_path) : null;

      let skillDescription = '';
      let agentSummary = '';
      if (skillPath) {
        skillDescription = this._readSkillDescription(skillPath);
      }
      agentSummary = this._readAgentSummary(name, engine);

      return {
        ...a,
        skillDescription,
        agentSummary,
        searchableText: [name, a.skillName, a.department, a.roleLabelKo, a.shortDescription, a.description, skillDescription]
          .filter(Boolean).join(' ').toLowerCase(),
      };
    });
  }

  /**
   * 스킬 파일에서 description 메타데이터를 읽어 반환합니다.
   * SKILL.md의 front-matter에서 description 필드를 추출합니다.
   * @param skillPath - 스킬 파일 경로 (~ 확장자 지원)
   * @returns 스킬 설명 문자열, 없으면 빈 문자열
   */
  private _readSkillDescription(skillPath: string): string {
    try {
      const fs = require('fs');
      const resolved = skillPath.startsWith('~')
        ? require('path').join(require('os').homedir(), skillPath.slice(1))
        : require('path').resolve(skillPath);
      if (!fs.existsSync(resolved)) return '';
      const text = fs.readFileSync(resolved, 'utf-8');
      const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) return '';
      const descMatch = match[1]!.match(/^description:\s*(.+)$/m);
      return descMatch ? descMatch[1]!.trim().replace(/["']/g, '') : '';
    } catch {
      return '';
    }
  }

  /**
   * 에이전트의 agent.md 파일에서 요약 정보를 읽어 반환합니다.
   * @param agentName - 에이전트 이름
   * @param engine - 에이전트 루트 경로를 결정할 엔진
   * @returns agent.md 내용 (최대 1200자), 없으면 빈 문자열
   */
  private _readAgentSummary(agentName: string, engine?: string): string {
    try {
      const fs = require('fs');
      const path = require('path');
      const agentsRoot = SETTINGS.getAgentsRoot(engine);
      const agentMd = path.join(agentsRoot, agentName, 'agent.md');
      if (!fs.existsSync(agentMd)) return '';
      return fs.readFileSync(agentMd, 'utf-8').slice(0, 1200);
    } catch {
      return '';
    }
  }

  /**
   * LLM 추천용 에이전트 카탈로그 문자열을 구성합니다.
   * 각 에이전트의 이름, 스킬명, 부서, 역할, 설명을 구조화된 텍스트로 포맷팅합니다.
   * @param agents - 확장된 에이전트 프로필 배열
   * @returns LLM 프롬프트에 주입할 카탈로그 문자열
   */
  private _buildRichCatalog(agents: Array<Record<string, unknown>>): string {
    return agents.map(a => {
      const name = String(a.name || '');
      const desc = String(a.description || '');
      const skillName = String(a.skillName || a.skill_name || '');
      const dept = String(a.department || '');
      const role = String(a.roleLabelKo || a.role_label || '');
      const shortDesc = String(a.shortDescription || '');
      const skillDesc = String(a.skillDescription || '');
      return `- name: ${name}\n  skillName: ${skillName}\n  department: ${dept}\n  role: ${role}\n  agentDescription: ${shortDesc || desc}\n  skillDescription: ${skillDesc}`;
    }).join('\n');
  }

  /**
   * LLM CLI를 통해 에이전트 추천을 요청합니다.
   * 템플릿 프롬프트에 카탈로그와 목표를 주입하고, LLM 응답을 JSON으로 파싱합니다.
   * @param goalPrompt - 사용자 목표 문장
   * @param catalog - 에이전트 카탈로그 문자열
   * @param maxAgents - 최대 추천 수
   * @param engine - 사용할 LLM 엔진
   * @returns 추천 에이전트 배열 (파싱 실패 시 빈 배열)
   */
  private async _recommendViaCli(
    goalPrompt: string, catalog: string, maxAgents: number, engine?: string,
  ): Promise<WorkflowRecommendedAgent[]> {
    const prompt = WORKFLOW_RECOMMENDATION_PROMPT_TEMPLATE
      .replace('{AGENT_CATALOG}', catalog)
      .replace('{GOAL}', goalPrompt)
      .replace('{MAX_AGENTS}', String(maxAgents));
    const response = await this.runOrchestrator.chat(prompt, undefined, engine);
    try {
      const parsed = JSON.parse(response);
      const rawAgents = Array.isArray(parsed) ? parsed : (parsed.recommendedAgents || []);
      if (!Array.isArray(rawAgents)) return [];
      return rawAgents.map((item: Record<string, unknown>) => ({
        agentName: String(item.agentName || ''),
        skillName: null,
        roleLabelKo: '',
        departmentLabelKo: '',
        iconKey: 'bot',
        reason: String(item.reason || ''),
        defaultPrompt: String(item.defaultPrompt || ''),
        shortDescription: null,
      })).filter(a => a.agentName);
    } catch {
      return [];
    }
  }

  /**
   * LLM 추천 결과가 최대 개수에 미치지 못할 때 폴백 추천으로 부족분을 채웁니다.
   * 중복 추천을 방지하기 위해 이미 추천된 에이전트는 제외합니다.
   * @param goalPrompt - 사용자 목표 문장
   * @param recommendations - LLM 추천 결과 배열
   * @param allProfiles - 전체 에이전트 프로필
   * @param maxAgents - 최대 추천 수
   * @returns 완성된 추천 에이전트 배열
   */
  private _completeRecommendations(
    goalPrompt: string,
    recommendations: WorkflowRecommendedAgent[],
    allProfiles: Array<Record<string, unknown>>,
    maxAgents: number,
  ): WorkflowRecommendedAgent[] {
    if (recommendations.length >= maxAgents) {
      return recommendations.slice(0, maxAgents);
    }

    const seenNames = new Set(recommendations.map(r => r.agentName));
    const supplements = this._fallbackRecommendation(goalPrompt, maxAgents, { skills: [], agents: allProfiles })
      .filter(r => !seenNames.has(r.agentName));

    return [...recommendations, ...supplements].slice(0, maxAgents);
  }

  /**
   * LLM 추천 실패 시 키워드 스코어링 기반으로 에이전트를 추천합니다.
   * 목표 문장과 에이전트 설명의 TF-IDF 유사도를 계산하여 상위 에이전트를 선택합니다.
   * @param goalPrompt - 사용자 목표 문장
   * @param limit - 최대 추천 수
   * @param inventory - 스킬 및 에이전트 인벤토리
   * @returns 스코어 기반 추천 에이전트 배열
   */
  private _fallbackRecommendation(
    goalPrompt: string, limit: number,
    inventory: { skills: Array<{ name: string }>; agents: Array<Record<string, unknown>> },
  ): WorkflowRecommendedAgent[] {
    const healthy = inventory.agents.filter(a => a.status === 'healthy');
    const candidates = healthy.length > 0 ? healthy : inventory.agents;
    const scored = this._scoreAgentProfiles(goalPrompt, candidates);
    const ranked = scored.sort((a, b) => b.score - a.score);
    const topScore = ranked.length > 0 ? ranked[0]!.score : 0;
    const cutoff = Math.max(2, Math.floor(topScore * 0.4));
    const selected = ranked.filter(s => s.score >= cutoff).slice(0, limit);

    if (selected.length === 0) {
      return ranked.slice(0, Math.min(3, ranked.length)).map(s => ({
        agentName: String(s.agent.name || ''),
        skillName: s.agent.skillName ? String(s.agent.skillName) : null,
        roleLabelKo: String(s.agent.roleLabelKo || ''),
        departmentLabelKo: String(s.agent.departmentLabelKo || ''),
        iconKey: 'bot',
        reason: '목표 문장과 관련된 보조 후보로 선택했습니다.',
        defaultPrompt: goalPrompt,
        shortDescription: s.agent.shortDescription ? String(s.agent.shortDescription) : null,
      }));
    }

    return selected.map(s => ({
      agentName: String(s.agent.name || ''),
      skillName: s.agent.skillName ? String(s.agent.skillName) : null,
      roleLabelKo: String(s.agent.roleLabelKo || ''),
      departmentLabelKo: String(s.agent.departmentLabelKo || ''),
      iconKey: 'bot',
      reason: this._buildReason(s.score),
      defaultPrompt: goalPrompt,
      shortDescription: s.agent.shortDescription ? String(s.agent.shortDescription) : null,
    }));
  }

  /** Common Korean → English keyword map for goal matching */
  private readonly KO_EN_MAP: Record<string, string[]> = {
    디자인: ['design'], 리뷰: ['review'], 검토: ['review'],
    개발: ['develop', 'development'], 테스트: ['test', 'testing'],
    분석: ['analysis', 'analyze'], 기획: ['plan', 'planning'],
    배포: ['deploy', 'deployment'], 보안: ['security'],
    문서: ['doc', 'documentation'], 코드: ['code'],
    성능: ['performance'], 최적화: ['optimize', 'optimization'],
    자동화: ['auto', 'automation'], 모니터링: ['monitor', 'monitoring'],
    품질: ['quality'], 버그: ['bug'], 오류: ['error'],
    데이터: ['data'], db: ['database'], api: ['api'],
    보고서: ['report'], 알림: ['alert', 'notification'],
    ui: ['ui', 'ux', 'frontend'], 백엔드: ['backend', 'server'],
    실험: ['experiment', 'ab test'], 통계: ['statistics', 'statistical'],
    시각화: ['visualize', 'visualization', 'chart'],
    감사: ['audit'], 진단: ['diagnose', 'diagnostic'],
    변환: ['convert', 'migration'], 마이그레이션: ['migration'],
    검색: ['search'], 추천: ['recommend'],
    생성: ['generate', 'generation'], 작성: ['write'],
    수정: ['fix', 'modify'], 추가: ['add'],
    삭제: ['delete', 'remove'], 조회: ['query', 'inquiry'],
    로그: ['log'], 설정: ['config', 'configure'],
    프로젝트: ['project'], 작업: ['task', 'job'],
  };

  /**
   * 목표 문장과 각 에이전프로필 간의 관련성을 스코어링합니다.
   * TF-IDF 변형을 사용하여 희귀 키워드 매칭에 가중치를 부여하고, 구문 매칭과 스킬명 오버랩을 추가 점수로 반영합니다.
   * @param goalPrompt - 사용자 목표 문장
   * @param agents - 스코어링할 에이전트 프로필 배열
   * @returns 에이전트별 스코어 결과 배열
   */
  private _scoreAgentProfiles(goalPrompt: string, agents: Array<Record<string, unknown>>): Array<{ agent: Record<string, unknown>; score: number }> {
    const goalWords = goalPrompt.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    const expandedGoalWords = new Set(goalWords);
    for (const word of goalWords) {
      const engTerms = this.KO_EN_MAP[word];
      if (engTerms) engTerms.forEach(t => expandedGoalWords.add(t));
    }
    const allGoalWords = [...expandedGoalWords];

    const goalPhrases: string[] = [];
    for (const size of [3, 2]) {
      for (let i = 0; i <= goalWords.length - size; i++) {
        goalPhrases.push(goalWords.slice(i, i + size).join(' '));
      }
    }

    const documentCount = agents.length;
    const docFrequency = new Map<string, number>();
    for (const agent of agents) {
      const haystack = String(agent.searchableText || this._buildSearchableText(agent));
      const tokens = new Set(haystack.split(/\s+/).filter(w => w.length >= 2));
      for (const token of tokens) {
        docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
      }
    }

    return agents.map(agent => {
      const haystack = String(agent.searchableText || this._buildSearchableText(agent)).toLowerCase();
      let score = 0;

      for (const word of allGoalWords) {
        const df = docFrequency.get(word) || 1;
        if (df > Math.max(3, Math.floor(documentCount * 0.35))) continue;
        if (!haystack.includes(word)) continue;
        const rarityWeight = Math.max(2, Math.min(12, Math.floor((documentCount / df) * 2)));
        score += rarityWeight;
      }

      for (const phrase of goalPhrases) {
        if (haystack.includes(phrase)) score += 5;
      }

      const skillName = String(agent.skillName || agent.skill_name || '').toLowerCase().replace(/-/g, ' ');
      if (skillName) {
        const skillTokens = skillName.split(/\s+/).filter(w => w.length >= 2);
        const overlap = skillTokens.filter(t => allGoalWords.includes(t)).length;
        score += overlap * 3;
      }

      return { agent, score: Math.max(1, score) };
    });
  }

  /**
   * 에이전트의 검색 가능한 텍스트를 구성합니다.
   * 이름, 스킬명, 부서, 역할, 설명을 공백으로 연결합니다.
   * @param agent - 에이전트 설정 객체
   * @returns 검색용 텍스트 문자열
   */
  private _buildSearchableText(agent: Record<string, unknown>): string {
    return [
      agent.name, agent.skillName, agent.department,
      agent.roleLabelKo, agent.shortDescription, agent.description,
    ].filter(Boolean).join(' ');
  }

  /**
   * 스코어에 따라 에이전트 추천 이유를 한글 문장으로 반환합니다.
   * @param score - 계산된 관련성 스코어
   * @returns 추천 이유 한글 문장
   */
  private _buildReason(score: number): string {
    if (score >= 20) return '목표와 에이전트 스킬 설명의 관련도가 매우 높습니다.';
    if (score >= 10) return '목표 문장과 에이전트 역할/스킬 설명의 관련도가 높습니다.';
    return '목표 문장과 에이전트 설명을 기준으로 선택했습니다.';
  }

  /**
   * ConfigReader로부터 스킬, 에이전트, 라우터 설정을 읽어 통합 인벤토리를 구성합니다.
   * 각 에이전트의 상태(healthy/broken/passive)와 사유를 함께 판단합니다.
   * @param engine - 설정을 읽어올 엔진
   * @returns 스킬 목록, 에이전트 목록(상태 포함), 라우트 목록
   */
  private _buildInventory(engine?: string) {
    const skills = this.configReader.readSkills(engine);
    const agentsRaw = this.configReader.readAgents(engine);
    const routerConfig = this.configReader.readRouterConfig(engine);
    const routes = this._extractRoutes(routerConfig);
    const routedNames = new Set(routes.map(r => r.agentName));
    const skillNames = new Set(skills.map(s => s.name));

    const agents = agentsRaw.map((a: Record<string, unknown>) => {
      const name = String(a.name || 'unknown');
      const rawSkillName = a.skill_name ? String(a.skill_name) : null;
      const skillPath = a.skill_path ? String(a.skill_path) : null;
      const isRouted = routedNames.has(name);
      let status: string;
      let reason: string;
      if (!rawSkillName && !skillPath) {
        status = 'broken'; reason = '연결된 스킬 정보가 없습니다.';
      } else if (rawSkillName && !skillNames.has(rawSkillName)) {
        status = 'broken'; reason = `스킬 이름이 유효하지 않습니다: ${rawSkillName}`;
      } else if (!isRouted) {
        status = 'passive'; reason = '라우터에 등록되지 않은 에이전트입니다.';
      } else {
        status = 'healthy'; reason = '정상 작동 중입니다.';
      }
      return {
        name, description: String(a.description || ''), department: String(a.department || ''),
        skillName: rawSkillName, skillPath, status, reason, isRouted, routingType: String(a.routing_type || 'unknown'),
        roleLabelKo: String(a.role_label || SETTINGS.founderName),
        departmentLabelKo: String(a.department || '관리지원'),
        shortDescription: a.short_description ? String(a.short_description) : null,
        oneClickPrompt: a.one_click_prompt ? String(a.one_click_prompt) : null,
      };
    });

    return { skills, agents, routes };
  }

  /**
   * 라우터 설정에서 에이전트 라우팅 정보를 추출합니다.
   * routes 배열과 routing_hints 객체를 모두 수집하여 통합 라우트 목록을 반환합니다.
   * @param routerConfig - 라우터 설정 객체
   * @returns 키워드-에이전트 라우트 배열
   */
  private _extractRoutes(routerConfig: Record<string, unknown>): Array<{ keyword: string; agentName: string }> {
    const routes: Array<{ keyword: string; agentName: string }> = [];
    const rawRoutes = routerConfig.routes;
    if (Array.isArray(rawRoutes)) {
      for (const r of rawRoutes) {
        if (r && typeof r === 'object') {
          routes.push({ agentName: String((r as Record<string, unknown>).agent || 'unknown'), keyword: String((r as Record<string, unknown>).intent || '') });
        }
      }
    }
    const hints = routerConfig.routing_hints;
    if (hints && typeof hints === 'object') {
      for (const [keyword, agentName] of Object.entries(hints as Record<string, unknown>)) {
        routes.push({ keyword: keyword.slice(0, 30), agentName: String(agentName) });
      }
    }
    return routes;
  }

  /**
   * 워크플로우 이벤트를 WorkflowStore에 저장하고 EventBroker를 통해 구독자에게 전파합니다.
   * @param workflowRunId - 관련 워크플로우 실행 ID
   * @param eventType - 이벤트 타입 (예: workflow:started, step:completed)
   * @param message - 이벤트 메시지
   * @param stepIndex - 관련 단계 인덱스 (선택)
   */
  private _pushWorkflowEvent(workflowRunId: string, eventType: string, message: string, stepIndex?: number | null): void {
    const event = this.workflowStore.addWorkflowEvent(workflowRunId, eventType, message, stepIndex);
    this.eventBroker.pushWorkflowEvent({
      eventId: event.eventId,
      workflowRunId,
      stepIndex: stepIndex ?? null,
      eventType,
      message,
      createdAt: event.createdAt,
    });
  }

  /**
   * 워크플로우 실행 상태 변경을 EventBroker를 통해 구독자에게 전파합니다.
   * @param workflowRunId - 관련 워크플로우 실행 ID
   * @param status - 변경된 상태 (running / completed / failed / cancelled)
   * @param currentStepIndex - 현재 단계 인덱스
   */
  private _pushWorkflowRunStatus(workflowRunId: string, status: string, currentStepIndex: number): void {
    this.eventBroker.pushWorkflowRunStatus(workflowRunId, status, currentStepIndex);
  }
}
