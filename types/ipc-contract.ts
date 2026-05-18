/**
 * Zod schemas and inferred TypeScript types defining the complete IPC contract
 * between the Electron main process and renderer — agent configs, workflow runs,
 * dashboard metrics, inspector data, and file-change events.
 */
import { z } from 'zod';
import { IPC_CHANNELS, IPC_VERSION } from './ipc-channels';

export { IPC_CHANNELS, IPC_VERSION };

export const EngineTypeSchema = z.enum(['gemini', 'opencode', 'claudecode', 'kiro-cli']);
export type EngineType = z.infer<typeof EngineTypeSchema>;

export const RunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']).nullable();
export type SandboxMode = z.infer<typeof SandboxModeSchema>;

export const ApprovalPolicySchema = z.enum(['untrusted', 'on-request', 'never']).nullable();
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const HealthStatusSchema = z.enum(['healthy', 'partial', 'broken', 'passive']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const NodeTypeSchema = z.enum(['department', 'agent', 'skill', 'router', 'keyword', 'founder']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const WorkflowRunStatusSchema = z.enum(['draft', 'queued', 'running', 'completed', 'failed', 'cancelled']);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WorkflowStepStatusSchema = z.enum(['recommended', 'ready', 'queued', 'running', 'approval_required', 'completed', 'failed', 'cancelled', 'skipped']);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  engine: EngineTypeSchema,
  cliPath: z.string().optional(),
  model: z.string().optional(),
  env: z.record(z.string()).optional(),
  description: z.string().optional(),
  department: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const SkillModelSchema = z.object({
  name: z.string(),
  path: z.string(),
  installed: z.boolean(),
  enabled: z.boolean(),
});
export type SkillModel = z.infer<typeof SkillModelSchema>;

export const AgentModelSchema = z.object({
  name: z.string(),
  roleLabelKo: z.string(),
  departmentLabelKo: z.string(),
  description: z.string(),
  shortDescription: z.string().nullable(),
  oneClickPrompt: z.string().nullable(),
  skillName: z.string().nullable(),
  skillPath: z.string().nullable(),
  routingType: z.string(),
  routed: z.boolean(),
  status: HealthStatusSchema,
  reason: z.string(),
});
export type AgentModel = z.infer<typeof AgentModelSchema>;

export const RouteModelSchema = z.object({
  keyword: z.string(),
  agentName: z.string(),
});
export type RouteModel = z.infer<typeof RouteModelSchema>;

export const GraphNodeModelSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  label: z.string(),
  sublabel: z.string().optional(),
  status: HealthStatusSchema.default('healthy'),
  metadata: z.record(z.string()).default({}),
});
export type GraphNodeModel = z.infer<typeof GraphNodeModelSchema>;

export const GraphEdgeModelSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().nullable(),
});
export type GraphEdgeModel = z.infer<typeof GraphEdgeModelSchema>;

export const DashboardMetricModelSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  trendValues: z.array(z.number()).default([]),
});
export type DashboardMetricModel = z.infer<typeof DashboardMetricModelSchema>;

export const ActivityItemModelSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  timestamp: z.string().nullable(),
});
export type ActivityItemModel = z.infer<typeof ActivityItemModelSchema>;

export const OverviewResponseSchema = z.object({
  totalSkills: z.number(),
  totalAgents: z.number(),
  routedAgents: z.number(),
  routeHints: z.number(),
  brokenMappings: z.number(),
  activeThreads: z.number(),
  activeAgents: z.number(),
  lastScannedAt: z.string(),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

export const InventoryResponseSchema = z.object({
  skills: z.array(SkillModelSchema),
  agents: z.array(AgentModelSchema),
  routes: z.array(RouteModelSchema),
});
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

export const RouterGraphResponseSchema = z.object({
  nodes: z.array(GraphNodeModelSchema),
  edges: z.array(GraphEdgeModelSchema),
});
export type RouterGraphResponse = z.infer<typeof RouterGraphResponseSchema>;

export const OrganizationChartResponseSchema = z.object({
  nodes: z.array(GraphNodeModelSchema),
  edges: z.array(GraphEdgeModelSchema),
});
export type OrganizationChartResponse = z.infer<typeof OrganizationChartResponseSchema>;

export const DashboardResponseSchema = z.object({
  metrics: z.array(DashboardMetricModelSchema),
  activeAgents: z.array(ActivityItemModelSchema),
  recentSkills: z.array(ActivityItemModelSchema),
  recentThreads: z.array(ActivityItemModelSchema),
  timeline: z.array(ActivityItemModelSchema),
  departmentBreakdown: z.array(DashboardMetricModelSchema),
  statusBreakdown: z.array(DashboardMetricModelSchema),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const RunOptionsSchema = z.object({
  agentId: z.string(),
  prompt: z.string().max(100_000),
  workspace: z.string().optional(),
  timeout: z.number().int().positive().max(3600).optional(),
  maxTokens: z.number().int().positive().optional(),
  engine: EngineTypeSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
});
export type RunOptions = z.infer<typeof RunOptionsSchema>;

export const RunEventSchema = z.object({
  eventId: z.number().optional(),
  runId: z.string(),
  type: z.enum(['start', 'progress', 'log', 'output', 'done', 'error']),
  timestamp: z.string().datetime(),
  data: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunSummarySchema = z.object({
  runId: z.string(),
  agentName: z.string(),
  workspaceRoot: z.string(),
  status: RunStatusSchema,
  promptPreview: z.string(),
  engine: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  errorMessage: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = z.object({
  runId: z.string(),
  agentName: z.string(),
  workspaceRoot: z.string(),
  prompt: z.string(),
  status: RunStatusSchema,
  engine: z.string(),
  sandboxMode: z.string().nullable(),
  approvalPolicy: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  errorMessage: z.string().nullable(),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.enum(['agent', 'condition', 'merge', 'delay', 'start', 'end']),
  agentId: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
  label: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  status: z.enum(['idle', 'running', 'completed', 'failed', 'stopped']).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowRecommendedAgentSchema = z.object({
  agentName: z.string(),
  skillName: z.string().nullable(),
  roleLabelKo: z.string(),
  departmentLabelKo: z.string(),
  iconKey: z.string(),
  reason: z.string(),
  defaultPrompt: z.string(),
  shortDescription: z.string().nullable(),
});
export type WorkflowRecommendedAgent = z.infer<typeof WorkflowRecommendedAgentSchema>;

export const WorkflowStepRunSchema = z.object({
  stepIndex: z.number(),
  agentName: z.string(),
  skillName: z.string().nullable(),
  iconKey: z.string(),
  title: z.string(),
  prompt: z.string(),
  status: WorkflowStepStatusSchema,
  runId: z.string().nullable(),
  reason: z.string().nullable(),
  summary: z.string().nullable(),
  lastEventMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  errorMessage: z.string().nullable(),
  attachedFiles: z.array(z.string()).optional(),
});
export type WorkflowStepRun = z.infer<typeof WorkflowStepRunSchema>;

export const WorkflowRunSummarySchema = z.object({
  workflowRunId: z.string(),
  goalPromptPreview: z.string(),
  workspaceRoot: z.string(),
  status: WorkflowRunStatusSchema,
  currentStepIndex: z.number().nullable(),
  totalSteps: z.number(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  engine: z.string().nullable(),
});
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>;

export const WorkflowRunDetailSchema = z.object({
  workflowRunId: z.string(),
  goalPrompt: z.string(),
  workspaceRoot: z.string(),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  engine: z.string().nullable(),
  status: WorkflowRunStatusSchema,
  currentStepIndex: z.number().nullable(),
  totalSteps: z.number(),
  steps: z.array(WorkflowStepRunSchema),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetailSchema>;

export const WorkflowEventModelSchema = z.object({
  eventId: z.number(),
  workflowRunId: z.string(),
  stepIndex: z.number().nullable(),
  eventType: z.string(),
  message: z.string(),
  createdAt: z.string(),
});

export const ExecutableAgentSchema = z.object({
  name: z.string(),
  roleLabelKo: z.string(),
  departmentLabelKo: z.string(),
  runnable: z.boolean(),
  reason: z.string(),
  shortDescription: z.string().nullable(),
  oneClickPrompt: z.string().nullable(),
});

export const AgentInspectorFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.string(),
  sizeBytes: z.number(),
  modifiedAt: z.string().nullable(),
  content: z.string(),
  truncated: z.boolean().default(false),
});
export type AgentInspectorFileModel = z.infer<typeof AgentInspectorFileSchema>;

export const AgentInspectorResponseSchema = z.object({
  agentName: z.string(),
  roleLabelKo: z.string(),
  departmentLabelKo: z.string(),
  description: z.string(),
  shortDescription: z.string().nullable(),
  oneClickPrompt: z.string().nullable(),
  skillName: z.string().nullable(),
  skillPath: z.string().nullable(),
  agentTomlPath: z.string().nullable(),
  agentJsonPath: z.string().nullable(),
  skillMarkdown: AgentInspectorFileSchema.nullable(),
  agentToml: AgentInspectorFileSchema.nullable(),
  agentJson: AgentInspectorFileSchema.nullable(),
  references: z.array(AgentInspectorFileSchema),
  scripts: z.array(AgentInspectorFileSchema),
  assets: z.array(AgentInspectorFileSchema),
});
export type AgentInspectorResponse = z.infer<typeof AgentInspectorResponseSchema>;

export const FileChangeSchema = z.object({
  path: z.string(),
  event: z.enum(['add', 'change', 'delete']),
  content: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const IpcVersionCheckSchema = z.object({
  version: z.string(),
  minVersion: z.string(),
});
export type IpcVersionCheck = z.infer<typeof IpcVersionCheckSchema>;

export const IpcChannelSchema = z.record(z.string(), z.string());
export type IpcChannel = z.infer<typeof IpcChannelSchema>;

export const HitlRequestSchema = z.object({
  id: z.string(),
  stepIndex: z.number(),
  agentName: z.string(),
  message: z.string(),
  permission: z.string(),
});
export type HitlRequest = z.infer<typeof HitlRequestSchema>;

export const IPC_MIN_VERSION = '1.0.0';
