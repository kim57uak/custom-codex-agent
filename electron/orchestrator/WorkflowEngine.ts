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
  private runOrchestrator: RunOrchestrator;
  private eventBroker: EventBroker;
  private workflowStore: WorkflowStore;
  private configReader: ConfigReader;
  private runningWorkflows = new Map<string, WorkflowContext>();
  private workflowTasks = new Map<string, Promise<void>>();
  private activeRunIds = new Map<string, string>();

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

  async createWorkflowRun(
    goalPrompt: string,
    steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>,
    workspaceRoot?: string, sandboxMode?: string | null, approvalPolicy?: string | null, engine?: string | null,
  ): Promise<{ workflowRunId: string }> {
    const record = this.workflowStore.createWorkflowRun(goalPrompt, steps, workspaceRoot, sandboxMode, approvalPolicy, engine);
    this._pushWorkflowEvent(record.workflowRunId, 'workflow:queued', 'workflow queued');
    return { workflowRunId: record.workflowRunId };
  }

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

  getWorkflowRun(workflowRunId: string) {
    return this.workflowStore.getWorkflowRun(workflowRunId);
  }

  deleteWorkflowRun(workflowRunId: string): boolean {
    if (this.runningWorkflows.has(workflowRunId)) return false;
    return this.workflowStore.deleteWorkflowRun(workflowRunId);
  }

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
      engine: r.engine,
    }));
  }

  getWorkflowEvents(workflowRunId: string, limit?: number) {
    return this.workflowStore.getWorkflowEvents(workflowRunId, limit);
  }

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

  async removeStepFromRun(workflowRunId: string, stepIndex: number): Promise<WorkflowRunDetail | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    this.workflowStore.removeWorkflowStep(workflowRunId, stepIndex);
    this._pushWorkflowEvent(workflowRunId, 'step:removed', `step ${stepIndex} removed`);
    return this.getWorkflowRunDetail(workflowRunId);
  }

  async updateStepPrompt(workflowRunId: string, stepIndex: number, prompt: string): Promise<WorkflowRunDetail | null> {
    const record = this.workflowStore.getWorkflowRun(workflowRunId);
    if (!record) return null;
    this.workflowStore.updateWorkflowStep(workflowRunId, stepIndex, { prompt });
    return this.getWorkflowRunDetail(workflowRunId);
  }

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

  private _continueExecution(workflowRunId: string, steps: Array<{ stepIndex: number; agentName: string; prompt: string }>, context: WorkflowContext, engine?: string | null, sandboxMode?: string | null, approvalPolicy?: string | null): void {
    const remaining = steps.filter(s => !context.completedStepIndices.has(s.stepIndex));
    const task = this._executeStepsSequentially(workflowRunId, remaining, context, engine, sandboxMode, approvalPolicy);
    this.workflowTasks.set(workflowRunId, task);
    task.finally(() => this.workflowTasks.delete(workflowRunId));
  }

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

  private _buildSearchableText(agent: Record<string, unknown>): string {
    return [
      agent.name, agent.skillName, agent.department,
      agent.roleLabelKo, agent.shortDescription, agent.description,
    ].filter(Boolean).join(' ');
  }

  private _buildReason(score: number): string {
    if (score >= 20) return '목표와 에이전트 스킬 설명의 관련도가 매우 높습니다.';
    if (score >= 10) return '목표 문장과 에이전트 역할/스킬 설명의 관련도가 높습니다.';
    return '목표 문장과 에이전트 설명을 기준으로 선택했습니다.';
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

  private _pushWorkflowRunStatus(workflowRunId: string, status: string, currentStepIndex: number): void {
    this.eventBroker.pushWorkflowRunStatus(workflowRunId, status, currentStepIndex);
  }
}
