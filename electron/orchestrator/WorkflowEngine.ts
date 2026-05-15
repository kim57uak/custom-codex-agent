import { EventBroker } from '../services/EventBroker';
import { RunOrchestrator } from './RunOrchestrator';
import { WorkflowStore } from '../stores/WorkflowStore';
import { ConfigReader } from '../services/ConfigReader';
import { SETTINGS } from '../settings/AppSettings';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowRecommendedAgent, WorkflowStepRun, WorkflowRunDetail, WorkflowRunSummary } from '../../types/ipc-contract';

type WorkflowStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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

Respond with a JSON array of recommended agents. Each item: {"agentName": string, "reason": string, "defaultPrompt": string}. Max {MAX_AGENTS} agents.`;

export class WorkflowEngine {
  private runOrchestrator: RunOrchestrator;
  private eventBroker: EventBroker;
  private workflowStore: WorkflowStore;
  private configReader: ConfigReader;
  private runningWorkflows = new Map<string, WorkflowContext>();

  constructor(deps: { runOrchestrator: RunOrchestrator; eventBroker: EventBroker }) {
    this.runOrchestrator = deps.runOrchestrator;
    this.eventBroker = deps.eventBroker;
    this.workflowStore = new WorkflowStore();
    this.configReader = new ConfigReader();
  }

  createWorkflow(workflow: Workflow): Workflow {
    return this.workflowStore.createWorkflow(workflow);
  }

  updateWorkflow(workflow: Workflow): Workflow | null {
    return this.workflowStore.updateWorkflow(workflow);
  }

  deleteWorkflow(workflowId: string): boolean {
    return this.workflowStore.deleteWorkflow(workflowId);
  }

  listWorkflows(): Workflow[] {
    return this.workflowStore.listWorkflows();
  }

  async recommendAgents(goalPrompt: string, maxAgents?: number, engine?: string): Promise<WorkflowRecommendedAgent[]> {
    const limit = maxAgents ?? SETTINGS.workflowRecommendationMaxAgents;
    const inventory = this._buildInventory(engine);
    const catalog = this._buildAgentCatalog(inventory.agents);

    if (catalog.length === 0) {
      return this._fallbackRecommendation(goalPrompt, limit, inventory);
    }

    try {
      const llmResult = await this._recommendViaCli(goalPrompt, catalog, limit, engine);
      if (llmResult.length > 0) return llmResult;
    } catch {}

    return this._fallbackRecommendation(goalPrompt, limit, inventory);
  }

  async createWorkflowRun(
    goalPrompt: string,
    steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>,
    workspaceRoot?: string, sandboxMode?: string | null, approvalPolicy?: string | null,
  ): Promise<{ workflowRunId: string }> {
    const record = this.workflowStore.createWorkflowRun(goalPrompt, steps, workspaceRoot, sandboxMode, approvalPolicy);
    return { workflowRunId: record.workflowRunId };
  }

  async runWorkflowRun(workflowRunId: string): Promise<string> {
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
    this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'running', 0);
    this.workflowStore.addWorkflowEvent(workflowRunId, 'workflow:started', 'workflow started');

    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    this._executeStepsSequentially(workflowRunId, steps, context);

    return workflowRunId;
  }

  async cancelWorkflowRun(workflowRunId: string): Promise<boolean> {
    const context = this.runningWorkflows.get(workflowRunId);
    if (!context) return false;
    context.status = 'cancelled';
    this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'cancelled', context.currentStepIndex, 'cancelled by user');
    this.workflowStore.addWorkflowEvent(workflowRunId, 'workflow:cancelled', 'workflow cancelled by user');
    this.runningWorkflows.delete(workflowRunId);
    return true;
  }

  async retryWorkflowRun(workflowRunId: string, engine?: string): Promise<string | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    const stepInputs = steps.map(s => ({
      agentName: s.agentName, prompt: s.prompt, title: s.title, iconKey: s.iconKey, skillName: s.skillName,
    }));
    const created = await this.createWorkflowRun(record.goalPrompt, stepInputs, record.workspaceRoot, record.sandboxMode, record.approvalPolicy);
    await this.runWorkflowRun(created.workflowRunId);
    return created.workflowRunId;
  }

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
    const created = await this.createWorkflowRun(record.goalPrompt, stepInputs, record.workspaceRoot, record.sandboxMode, record.approvalPolicy);
    await this.runWorkflowRun(created.workflowRunId);
    return created.workflowRunId;
  }

  async skipWorkflowStepAndContinue(workflowRunId: string, stepIndex: number, engine?: string): Promise<string | null> {
    const context = this.runningWorkflows.get(workflowRunId);
    if (!context) return null;
    if (context.currentStepIndex !== stepIndex) return null;

    this.workflowStore.updateWorkflowStep(workflowRunId, stepIndex, { status: 'skipped' });
    this.workflowStore.addWorkflowEvent(workflowRunId, 'step:skipped', `step ${stepIndex} skipped`, stepIndex);
    context.completedStepIndices.add(stepIndex);
    context.currentStepIndex = stepIndex + 1;

    const steps = this.workflowStore.getWorkflowSteps(workflowRunId);
    this._continueExecution(workflowRunId, steps, context);
    return workflowRunId;
  }

  getWorkflowRun(workflowRunId: string) {
    return this.workflowStore.getWorkflowRun(workflowRunId);
  }

  getWorkflowSteps(workflowRunId: string): WorkflowStepRun[] {
    const records = this.workflowStore.getWorkflowSteps(workflowRunId);
    return records.map(r => ({
      stepIndex: r.stepIndex, agentName: r.agentName, skillName: r.skillName,
      iconKey: r.iconKey, title: r.title, prompt: r.prompt, status: r.status as WorkflowStepRun['status'],
      runId: r.runId, reason: r.reason, summary: r.summary, lastEventMessage: r.lastEventMessage,
      startedAt: r.startedAt, completedAt: r.completedAt, exitCode: r.exitCode, errorMessage: r.errorMessage,
    }));
  }

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
    }));
  }

  getWorkflowEvents(workflowRunId: string, limit?: number) {
    return this.workflowStore.getWorkflowEvents(workflowRunId, limit);
  }

  private async _executeStepsSequentially(workflowRunId: string, steps: Array<{ stepIndex: number; agentName: string; prompt: string }>, context: WorkflowContext): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      if (context.status === 'cancelled') break;
      const step = steps[i]!;
      context.currentStepIndex = i;
      this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'running', i);
      this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'running' });
      this.workflowStore.addWorkflowEvent(workflowRunId, 'step:started', `step ${i}: ${step.agentName}`, i);

      let stepPrompt = step.prompt;
      if (context.carryOverSummaries.length > 0) {
        stepPrompt = `Previous steps summary:\n${context.carryOverSummaries.join('\n')}\n\n${step.prompt}`;
      }

      try {
        const created = await this.runOrchestrator.createRun(step.agentName, stepPrompt, undefined, null, null);
        const completed = await this.runOrchestrator.waitForRun(created.runId);
        if (!completed) {
          this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'failed', errorMessage: 'run not found' });
          this.workflowStore.addWorkflowEvent(workflowRunId, 'step:failed', `step ${i}: run not found`, i);
          continue;
        }

        const stepStatus = completed.status === 'completed' ? 'completed' : 'failed';
        const summary = completed.status === 'completed'
          ? `Step ${i} (${step.agentName}) completed successfully.`
          : `Step ${i} (${step.agentName}) failed: ${completed.error || 'unknown error'}`;

        this.workflowStore.updateWorkflowStep(workflowRunId, i, {
          status: stepStatus, runId: completed.id, summary, exitCode: completed.exitCode, errorMessage: completed.error,
        });
        context.completedStepIndices.add(i);

        if (completed.status === 'completed') {
          context.carryOverSummaries.push(summary);
        }

        this.workflowStore.addWorkflowEvent(workflowRunId, `step:${stepStatus}`, `step ${i}: ${stepStatus}`, i);

        if (completed.status !== 'completed' && (context.status as string) !== 'cancelled') {
          context.status = 'failed';
          this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'failed', i, `step ${i} failed`);
          this.workflowStore.addWorkflowEvent(workflowRunId, 'workflow:failed', `workflow failed at step ${i}`);
          this.runningWorkflows.delete(workflowRunId);
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.workflowStore.updateWorkflowStep(workflowRunId, i, { status: 'failed', errorMessage: msg });
        this.workflowStore.addWorkflowEvent(workflowRunId, 'step:error', `step ${i}: ${msg}`, i);
        context.status = 'failed';
        this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'failed', i, msg);
        this.runningWorkflows.delete(workflowRunId);
        return;
      }
    }

    if (context.status !== 'cancelled') {
      context.status = 'completed';
      this.workflowStore.updateWorkflowRunStatus(workflowRunId, 'completed');
      this.workflowStore.addWorkflowEvent(workflowRunId, 'workflow:completed', 'all steps completed');
      this.runningWorkflows.delete(workflowRunId);
    }
  }

  private _continueExecution(workflowRunId: string, steps: Array<{ stepIndex: number; agentName: string; prompt: string }>, context: WorkflowContext): void {
    const remaining = steps.filter(s => !context.completedStepIndices.has(s.stepIndex));
    this._executeStepsSequentially(workflowRunId, remaining, context);
  }

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

  private _buildAgentCatalog(agents: Array<Record<string, unknown>>): string {
    return agents
      .filter(a => a.status === 'healthy')
      .map(a => `- ${a.name}: ${a.description} (skill: ${a.skillName || 'none'}, dept: ${a.department})`)
      .join('\n');
  }

  private async _recommendViaCli(
    goalPrompt: string, catalog: string, maxAgents: number, engine?: string,
  ): Promise<WorkflowRecommendedAgent[]> {
    const prompt = WORKFLOW_RECOMMENDATION_PROMPT_TEMPLATE
      .replace('{AGENT_CATALOG}', catalog)
      .replace('{GOAL}', goalPrompt)
      .replace('{MAX_AGENTS}', String(maxAgents));
    const response = await this.runOrchestrator.chat(prompt, engine);
    try {
      const parsed = JSON.parse(response);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item: Record<string, unknown>) => ({
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

  private _fallbackRecommendation(
    goalPrompt: string, limit: number,
    inventory: { skills: Array<{ name: string }>; agents: Array<Record<string, unknown>> },
  ): WorkflowRecommendedAgent[] {
    const healthy = inventory.agents.filter(a => a.status === 'healthy');
    const scored = healthy.map((a: Record<string, unknown>) => {
      const desc = String(a.description || '');
      const name = String(a.name || '');
      let score = 0;
      const goalWords = new Set(goalPrompt.toLowerCase().split(/\s+/));
      for (const word of goalWords) {
        if (desc.toLowerCase().includes(word)) score += 2;
        if (name.toLowerCase().includes(word)) score += 3;
        if ((a.skillName && String(a.skillName).toLowerCase().includes(word))) score += 2;
      }
      if (score === 0) score = 1;
      return { agent: a, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => ({
      agentName: String(s.agent.name || ''),
      skillName: s.agent.skillName ? String(s.agent.skillName) : null,
      roleLabelKo: String(s.agent.roleLabelKo || ''),
      departmentLabelKo: String(s.agent.departmentLabelKo || ''),
      iconKey: 'bot',
      reason: `keyword match score: ${s.score}`,
      defaultPrompt: goalPrompt,
      shortDescription: s.agent.shortDescription ? String(s.agent.shortDescription) : null,
    }));
  }

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
}
