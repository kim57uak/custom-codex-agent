import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import fs from 'fs';
import {
  RunOptionsSchema, AgentConfigSchema, WorkflowSchema,
  IPC_CHANNELS,
  AgentInspectorResponseSchema,
} from '../../types/ipc-contract';
import { LogBuffer } from '../services/LogBuffer';
import { ConfigReader } from '../services/ConfigReader';
import { EventBroker } from '../services/EventBroker';
import { RunOrchestrator } from '../orchestrator/RunOrchestrator';
import { WorkflowEngine } from '../orchestrator/WorkflowEngine';
import { BackupService } from '../services/BackupService';
import { DashboardService } from '../services/DashboardService';
import { InspectorService } from '../services/InspectorService';
import { FileWatcher } from '../services/FileWatcher';
import { McpManager } from '../mcp/McpClient';
import { SETTINGS } from '../settings/AppSettings';

interface HandlerDeps {
  logBuffer: LogBuffer;
  configReader: ConfigReader;
  eventBroker: EventBroker;
}

function validateChannel(channel: string): void {
  const validChannels: string[] = [
    ...Object.values(IPC_CHANNELS.invoke),
    ...Object.values(IPC_CHANNELS.on),
  ];
  if (!validChannels.includes(channel)) {
    throw new Error(`Invalid IPC channel: ${channel}`);
  }
}

function safeValidate<T>(schema: z.ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Validation failed: ${issues}`);
    }
    throw err;
  }
}

export function registerIpcHandlers(deps: HandlerDeps): void {
  const { logBuffer, configReader, eventBroker } = deps;
  const runOrchestrator = new RunOrchestrator({ logBuffer, eventBroker });
  const workflowEngine = new WorkflowEngine({ runOrchestrator, eventBroker });
  const dashboardService = new DashboardService(configReader);

  app.on('before-quit', () => {
    runOrchestrator.stopOpencodeServer();
  });

  // Forward send events back to renderer (completes the send→on IPC pattern)
  ipcMain.on('inspector:file-selected', (event, filePath) => {
    event.sender.send('inspector:file-selected', filePath);
  });
  ipcMain.on('org:agent-selected', (event, agent) => {
    event.sender.send('org:agent-selected', agent);
  });

  // ============================================
  // Run 핸들러 (run:*)
  // ============================================
  ipcMain.handle('run:agent', async (_event, options: unknown) => {
    const parsed = safeValidate(RunOptionsSchema, options);
    return runOrchestrator.startRun(parsed);
  });

  ipcMain.handle('run:cancel', async (_event, runId: unknown) => {
    if (typeof runId !== 'string') throw new Error('runId must be string');
    return runOrchestrator.cancelRun(runId);
  });

  ipcMain.handle('run:list', async () => {
    const runs = runOrchestrator.listRuns() as unknown as Array<Record<string, unknown>>;
    const agents = configReader.listAgents();
    const agentMap = new Map(agents.map(a => [a.id, a]));
    const enriched = runs.map(run => {
      const agent = agentMap.get(run.agentId as string);
      return { ...run, engine: agent?.engine ?? run.engine ?? 'codex' };
    });
    return { runs: enriched };
  });

  ipcMain.handle('run:get', async (_event, runId: unknown) => {
    if (typeof runId !== 'string') throw new Error('runId must be string');
    return runOrchestrator.getRun(runId);
  });

  ipcMain.handle('run:start', async (_event, options: unknown) => {
    const parsed = safeValidate(RunOptionsSchema, options);
    return runOrchestrator.startRun(parsed);
  });

  ipcMain.handle('run:reply', async (_event, data: unknown) => {
    const p = data as { runId: string; message: string };
    if (!p || typeof p.runId !== 'string' || typeof p.message !== 'string') {
      throw new Error('runId and message required');
    }
    return runOrchestrator.replyToRun(p.runId, p.message);
  });

  ipcMain.handle('run:retry', async (_event, data: unknown) => {
    const p = data as { runId: string; engine?: string };
    if (!p || typeof p.runId !== 'string') throw new Error('runId required');
    return runOrchestrator.retryRun(p.runId, p.engine);
  });

  ipcMain.handle('run:events', async (_event, data: unknown) => {
    const p = data as { runId: string; limit?: number };
    if (!p || typeof p.runId !== 'string') throw new Error('runId required');
    return runOrchestrator.listRunEvents(p.runId, p.limit);
  });

  // ============================================
  // Workflow 핸들러 (workflow:*)
  // ============================================
  ipcMain.handle('workflow:create', async (_event, workflow: unknown) => {
    const now = new Date().toISOString();
    const enriched = { id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now, updatedAt: now, ...(workflow as Record<string, unknown>) };
    const parsed = safeValidate(WorkflowSchema, enriched);
    return workflowEngine.createWorkflow(parsed);
  });

  ipcMain.handle('workflow:update', async (_event, workflow: unknown) => {
    const parsed = safeValidate(WorkflowSchema, workflow);
    return workflowEngine.updateWorkflow(parsed);
  });

  ipcMain.handle('workflow:delete', async (_event, workflowId: unknown) => {
    if (typeof workflowId !== 'string') throw new Error('workflowId must be string');
    return workflowEngine.deleteWorkflow(workflowId);
  });

  ipcMain.handle('workflow:list', async () => {
    return workflowEngine.listWorkflows();
  });

  ipcMain.handle('workflow:run', async (_event, workflowId: unknown) => {
    if (typeof workflowId !== 'string') throw new Error('workflowId must be string');
    return workflowEngine.runWorkflowRun(workflowId);
  });

  ipcMain.handle('workflow:stop', async (_event, workflowId: unknown) => {
    if (typeof workflowId !== 'string') throw new Error('workflowId must be string');
    return workflowEngine.cancelWorkflowRun(workflowId);
  });

  ipcMain.handle('workflow:recommend', async (_event, data: unknown) => {
    const p = data as { goalPrompt: string; maxAgents?: number; engine?: string };
    if (!p || typeof p.goalPrompt !== 'string') throw new Error('goalPrompt required');
    return workflowEngine.recommendAgents(p.goalPrompt, p.maxAgents, p.engine);
  });

  ipcMain.handle('workflow:retry', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; engine?: string };
    if (!p || typeof p.workflowRunId !== 'string') throw new Error('workflowRunId required');
    return workflowEngine.retryWorkflowRun(p.workflowRunId, p.engine);
  });

  ipcMain.handle('workflow:retry-step', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; stepIndex: number; engine?: string };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.stepIndex !== 'number') {
      throw new Error('workflowRunId and stepIndex required');
    }
    return workflowEngine.retryWorkflowRunFromStep(p.workflowRunId, p.stepIndex, p.engine);
  });

  ipcMain.handle('workflow:skip-step', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; stepIndex: number; engine?: string };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.stepIndex !== 'number') {
      throw new Error('workflowRunId and stepIndex required');
    }
    return workflowEngine.skipWorkflowStepAndContinue(p.workflowRunId, p.stepIndex, p.engine);
  });

  ipcMain.handle('workflow:permission-respond', async (_event, data: unknown) => {
    const p = data as { requestId: string; response: string };
    if (!p || typeof p.requestId !== 'string' || typeof p.response !== 'string') {
      throw new Error('requestId and response required');
    }
    return runOrchestrator.respondToHitl(p.requestId, p.response);
  });

  ipcMain.handle('workflow:events', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; limit?: number };
    if (!p || typeof p.workflowRunId !== 'string') throw new Error('workflowRunId required');
    return workflowEngine.getWorkflowEvents(p.workflowRunId, p.limit);
  });

  ipcMain.handle('workflow:add-step', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; agentName: string; prompt?: string };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.agentName !== 'string') throw new Error('workflowRunId and agentName required');
    return workflowEngine.addStepToRun(p.workflowRunId, p.agentName, p.prompt);
  });

  ipcMain.handle('workflow:remove-step', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; stepIndex: number };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.stepIndex !== 'number') throw new Error('workflowRunId and stepIndex required');
    return workflowEngine.removeStepFromRun(p.workflowRunId, p.stepIndex);
  });

  ipcMain.handle('workflow:update-step-prompt', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; stepIndex: number; prompt: string };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.stepIndex !== 'number' || typeof p.prompt !== 'string') throw new Error('workflowRunId, stepIndex, and prompt required');
    return workflowEngine.updateStepPrompt(p.workflowRunId, p.stepIndex, p.prompt);
  });

  ipcMain.handle('workflow:run-detail', async (_event, workflowRunId: unknown) => {
    if (typeof workflowRunId !== 'string') throw new Error('workflowRunId must be string');
    const detail = workflowEngine.getWorkflowRunDetail(workflowRunId);
    if (!detail) throw new Error('Workflow run not found');
    return detail;
  });

  ipcMain.handle('workflow:runs', async (_event, limit?: unknown) => {
    const l = typeof limit === 'number' ? limit : undefined;
    return workflowEngine.listWorkflowRuns(l);
  });

  ipcMain.handle('workflow:agent-profiles', async () => {
    return workflowEngine.listAgentProfiles();
  });

  ipcMain.handle('workflow:create-run', async (_event, data: unknown) => {
    const p = data as { goalPrompt: string; steps: Array<{ agentName: string; prompt: string; title?: string; iconKey?: string; skillName?: string | null }>; sandboxMode?: string | null; approvalPolicy?: string | null; engine?: string | null };
    if (!p || typeof p.goalPrompt !== 'string' || !Array.isArray(p.steps) || p.steps.length === 0) {
      throw new Error('goalPrompt and steps required');
    }
    const created = await workflowEngine.createWorkflowRun(p.goalPrompt, p.steps, undefined, p.sandboxMode ?? null, p.approvalPolicy ?? null, p.engine);
    return { workflowRunId: created.workflowRunId };
  });

  ipcMain.handle('workflow:recommend-and-create', async (_event, data: unknown) => {
    const p = data as { goalPrompt: string; maxAgents?: number; sandboxMode?: string | null; approvalPolicy?: string | null; engine?: string };
    if (!p || typeof p.goalPrompt !== 'string') throw new Error('goalPrompt required');
    let recommendations = await workflowEngine.recommendAgents(p.goalPrompt, p.maxAgents, p.engine);
    if (recommendations.length === 0) {
      console.log('[recommend-and-create] recommendAgents returned 0, using keyword scoring fallback');
      const allProfiles = workflowEngine.listAgentProfiles(p.engine);
      const scored = allProfiles.map((a) => {
        const text = [a.name, a.roleLabelKo, a.departmentLabelKo, a.shortDescription, p.goalPrompt].filter(Boolean).join(' ').toLowerCase();
        const words = p.goalPrompt.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        const matchCount = words.filter(w => text.includes(w)).length;
        return { agent: a, score: matchCount };
      }).sort((a, b) => b.score - a.score);
      const best = scored.filter(s => s.score > 0).slice(0, p.maxAgents ?? 3);
      const fallbackAgents = best.length > 0 ? best : scored.slice(0, p.maxAgents ?? 3);
      if (fallbackAgents.length === 0) {
        return { recommendations: [], workflowRunId: null };
      }
      recommendations = fallbackAgents.map((s) => ({
        agentName: s.agent.name,
        skillName: s.agent.skillName,
        roleLabelKo: s.agent.roleLabelKo,
        departmentLabelKo: s.agent.departmentLabelKo,
        iconKey: s.agent.iconKey,
        reason: s.score > 0 ? `목표와 일치하는 키워드 ${s.score}개 매칭` : '사용 가능한 에이전트',
        defaultPrompt: p.goalPrompt,
        shortDescription: s.agent.shortDescription,
      }));
    }
    const steps = recommendations.map((r, i) => ({
      agentName: r.agentName,
      prompt: r.defaultPrompt || p.goalPrompt,
      title: r.reason?.slice(0, 40) || `Step ${i + 1}`,
      iconKey: r.iconKey || 'bot',
      skillName: r.skillName,
    }));
    const created = await workflowEngine.createWorkflowRun(p.goalPrompt, steps, undefined, p.sandboxMode ?? null, p.approvalPolicy ?? null, p.engine);
    return { recommendations, workflowRunId: created.workflowRunId };
  });

  ipcMain.handle('workflow:delete-run', async (_event, workflowRunId: unknown) => {
    if (typeof workflowRunId !== 'string') throw new Error('workflowRunId required');
    return workflowEngine.deleteWorkflowRun(workflowRunId);
  });

  // ============================================
  // Agents 핸들러 (agents:*)
  // ============================================
  ipcMain.handle('agents:list', async () => {
    return configReader.listAgents();
  });

  ipcMain.handle('agents:save', async (_event, agent: unknown) => {
    const parsed = safeValidate(AgentConfigSchema, agent);
    return configReader.saveAgent(parsed);
  });

  ipcMain.handle('agents:delete', async (_event, agentId: unknown) => {
    if (typeof agentId !== 'string') throw new Error('agentId must be string');
    return configReader.deleteAgent(agentId);
  });

  // ============================================
  // Inspector 핸들러 (inspector:*)
  // ============================================
  const inspectorService = new InspectorService();

  ipcMain.handle('inspector:list', async (_event, data: unknown) => {
    const p = data as { path?: string; engine?: string };
    const dirPath = p?.path || path.join(os.homedir(), '.config', 'agent-orchestrator');
    return inspectorService.listDirectory(dirPath, p?.engine);
  });

  ipcMain.handle('inspector:load-agent', async (_event, data: unknown) => {
    const p = data as { agentName: string; engine?: string };
    if (!p || typeof p.agentName !== 'string') throw new Error('agentName required');
    const result = inspectorService.loadAgentInspector(p.agentName, p.engine);
    if (!result) throw new Error('Agent not found');
    return safeValidate(AgentInspectorResponseSchema, result);
  });

  ipcMain.handle('inspector:save-file', async (_event, data: unknown) => {
    const p = data as { path: string; content: string; engine?: string };
    if (!p || typeof p.path !== 'string' || typeof p.content !== 'string') {
      throw new Error('path and content required');
    }
    const result = inspectorService.saveFile(p.path, p.content, p.engine);
    if (!result) throw new Error('Failed to save file');
    return result;
  });

  // ============================================
  // Config 핸들러 (config:*)
  // ============================================
  ipcMain.handle('config:get', async (_event, key: unknown) => {
    if (typeof key !== 'string') throw new Error('key must be string');
    return configReader.get(key);
  });

  ipcMain.handle('config:set', async (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string') throw new Error('key must be string');
    return configReader.set(key, value);
  });

  ipcMain.handle('config:get-agents', async () => {
    return { agents: configReader.listAgents() };
  });

  // ============================================
  // Inspector 핸들러 (inspector:*)
  // ============================================
  ipcMain.handle('file:read', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') throw new Error('filePath must be string');
    const result = configReader.readFile(filePath);
    if (!result) throw new Error('파일을 읽을 수 없습니다');
    return result;
  });

  ipcMain.handle('file:write', async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string') throw new Error('filePath must be string');
    if (typeof content !== 'string') throw new Error('content must be string');
    const ok = configReader.writeFile(filePath, content);
    if (!ok) throw new Error('파일 쓰기 실패');
    return { success: true };
  });

  ipcMain.handle('dir:read', async (_event, params: unknown) => {
    const p = params as { path?: string; recursive?: boolean };
    const rawPath = p?.path || path.join(os.homedir(), '.config', 'agent-orchestrator');
    const expandedPath = rawPath.startsWith('~') ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
    const result = configReader.readDir(expandedPath, p?.recursive ?? false);
    if (!result) throw new Error('디렉토리를 읽을 수 없습니다');
    return result;
  });

  ipcMain.handle('inspector:select-file', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') throw new Error('filePath must be string');
    return { filePath };
  });

  // ============================================
  // Dashboard 핸들러 (dashboard:* → DashboardService)
  // ============================================
  ipcMain.handle('dashboard:stats', async () => {
    return dashboardService.getStats(runOrchestrator.listRuns() as Array<{ status: string }>);
  });

  ipcMain.handle('dashboard:recent-activity', async () => {
    const runs = runOrchestrator.listRuns() as unknown as Array<Record<string, unknown>>;
    return { activities: dashboardService.getRecentActivity(runs) };
  });

  ipcMain.handle('dashboard:inventory', async (_event, engine?: unknown) => {
    return dashboardService.getInventory(typeof engine === 'string' ? engine : undefined);
  });

  ipcMain.handle('dashboard:overview', async (_event, engine?: unknown) => {
    return dashboardService.getOverview(typeof engine === 'string' ? engine : undefined);
  });

  ipcMain.handle('dashboard:router-graph', async (_event, engine?: unknown) => {
    return dashboardService.getRouterGraph(typeof engine === 'string' ? engine : undefined);
  });

  ipcMain.handle('dashboard:org-chart', async (_event, engine?: unknown) => {
    return dashboardService.getOrgChart(typeof engine === 'string' ? engine : undefined);
  });

  // ============================================
  // Chat 핸들러 (chat:*)
  // ============================================
  ipcMain.handle('chat:send', async (_event, data: unknown) => {
    const p = data as { message: string; systemPrompt?: string; engine?: string };
    if (!p || typeof p.message !== 'string') throw new Error('message must be string');
    const response = await runOrchestrator.chat(p.message, p.systemPrompt, p.engine);
    return { response };
  });

  // ============================================
  // CLI 핸들러 (cli:*)
  // ============================================
  ipcMain.handle('cli:validate', async (_event, cliPath: unknown) => {
    if (typeof cliPath !== 'string') throw new Error('cliPath must be string');
    return configReader.validateCliPath(cliPath);
  });

  // ============================================
  // MCP 핸들러 (mcp:*)
  // ============================================
  const mcpManager = new McpManager();

  ipcMain.handle('mcp:add-server', async (_event, config: unknown) => {
    const p = config as { name: string; command: string; args?: string[]; env?: Record<string, string> };
    if (!p || typeof p.name !== 'string' || typeof p.command !== 'string') throw new Error('name and command are required');
    const client = await mcpManager.addServer(p);
    return { name: p.name, tools: client.getTools().map((t: { name: string; description: string }) => ({ name: t.name, description: t.description })), connected: true };
  });

  ipcMain.handle('mcp:list-tools', async (_event, serverName: unknown) => {
    if (typeof serverName !== 'string') throw new Error('serverName must be string');
    const client = mcpManager.getClient(serverName);
    if (!client) throw new Error(`MCP server not found: ${serverName}`);
    return client.getTools();
  });

  ipcMain.handle('mcp:call-tool', async (_event, data: unknown) => {
    const p = data as { serverName: string; toolName: string; args: Record<string, unknown> };
    if (!p || typeof p.serverName !== 'string' || typeof p.toolName !== 'string') throw new Error('serverName and toolName are required');
    const result = mcpManager.findToolServer(p.toolName);
    if (!result) throw new Error(`Tool not found: ${p.toolName}`);
    return result.client.callTool(p.toolName, p.args ?? {});
  });

  // ============================================
  // Backup 핸들러 (backup:*)
  // ============================================
  ipcMain.handle('backup:create', async (_event, data: unknown) => {
    const p = data as { type?: string; description?: string; engine?: string };
    const backupService = new BackupService({ ...(p?.engine ? { engine: p.engine } : {}) });
    return backupService.createBackup((p?.type as 'manual' | 'auto' | 'pre-migration') ?? 'manual', p?.description);
  });

  ipcMain.handle('backup:list', async (_event, engine?: unknown) => {
    const eng = typeof engine === 'string' ? engine : undefined;
    const backupService = new BackupService({ ...(eng ? { engine: eng } : {}) });
    return backupService.listBackups();
  });

  ipcMain.handle('backup:restore', async (_event, data: unknown) => {
    const p = data as { backupId: string; engine?: string };
    if (!p || typeof p.backupId !== 'string') throw new Error('backupId must be string');
    const backupService = new BackupService({ ...(p?.engine ? { engine: p.engine } : {}) });
    return backupService.restoreBackup(p.backupId);
  });

  ipcMain.handle('backup:delete', async (_event, data: unknown) => {
    const p = data as { backupId: string; engine?: string };
    if (!p || typeof p.backupId !== 'string') throw new Error('backupId must be string');
    const backupService = new BackupService({ ...(p?.engine ? { engine: p.engine } : {}) });
    return backupService.deleteBackup(p.backupId);
  });

  ipcMain.handle('backup:size', async (_event, engine?: unknown) => {
    const eng = typeof engine === 'string' ? engine : undefined;
    const backupService = new BackupService({ ...(eng ? { engine: eng } : {}) });
    return { totalSize: backupService.getTotalBackupSize(), backupCount: backupService.listBackups().length };
  });

  // ============================================
  // Dialog 핸들러 (dialog:*)
  // ============================================
  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '모든 파일', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  // ============================================
  // FileWatcher 핸들러 (watcher:*)
  // ============================================
  const fileWatcher = new FileWatcher({ push: (_channel: string, _data: unknown) => {} });

  ipcMain.handle('watcher:start', async (_event, data: unknown) => {
    const p = data as { paths: string[]; ignored?: string[]; debounceMs?: number };
    if (!p || !Array.isArray(p.paths)) throw new Error('paths must be string[]');
    fileWatcher.startWatching({ paths: p.paths, ignored: p.ignored ?? [], debounceMs: p.debounceMs ?? 100 });
    return { watching: true, paths: fileWatcher.getWatchedPaths() };
  });

  ipcMain.handle('watcher:stop', async () => {
    await fileWatcher.stopWatching();
    return { watching: false };
  });

  ipcMain.handle('watcher:add-path', async (_event, data: unknown) => {
    const p = data as { path: string };
    if (!p || typeof p.path !== 'string') throw new Error('path must be string');
    fileWatcher.addPath(p.path);
    return { paths: fileWatcher.getWatchedPaths() };
  });

  ipcMain.handle('watcher:remove-path', async (_event, data: unknown) => {
    const p = data as { path: string };
    if (!p || typeof p.path !== 'string') throw new Error('path must be string');
    await fileWatcher.removePath(p.path);
    return { paths: fileWatcher.getWatchedPaths() };
  });

  ipcMain.handle('watcher:status', async () => {
    return { active: fileWatcher.isActive, paths: fileWatcher.getWatchedPaths() };
  });

  ipcMain.handle('settings:set-default-engine', async (_event, engine: unknown) => {
    const validEngines = ['codex', 'gemini', 'opencode', 'claudecode'] as const;
    if (!engine || typeof engine !== 'string' || !validEngines.includes(engine as any)) {
      throw new Error('Invalid engine. Must be: codex, gemini, opencode, or claudecode');
    }
    SETTINGS.setDefaultEngine(engine as any);
    return { engine: SETTINGS.defaultEngine };
  });
}
