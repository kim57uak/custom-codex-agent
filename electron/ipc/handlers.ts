import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import fs from 'fs';
import {
  RunOptionsSchema, AgentConfigSchema, WorkflowSchema,
  IPC_CHANNELS, InventoryResponseSchema, OverviewResponseSchema,
  RouterGraphResponseSchema, OrganizationChartResponseSchema, DashboardResponseSchema,
  AgentInspectorResponseSchema,
} from '../../types/ipc-contract';
import { LogBuffer } from '../services/LogBuffer';
import { ConfigReader } from '../services/ConfigReader';
import { EventBroker } from '../services/EventBroker';
import { RunOrchestrator } from '../orchestrator/RunOrchestrator';
import { WorkflowEngine } from '../orchestrator/WorkflowEngine';
import { BackupService } from '../services/BackupService';
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

  ipcMain.handle('workflow:skip-step', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; stepIndex: number; engine?: string };
    if (!p || typeof p.workflowRunId !== 'string' || typeof p.stepIndex !== 'number') {
      throw new Error('workflowRunId and stepIndex required');
    }
    return workflowEngine.skipWorkflowStepAndContinue(p.workflowRunId, p.stepIndex, p.engine);
  });

  ipcMain.handle('workflow:events', async (_event, data: unknown) => {
    const p = data as { workflowRunId: string; limit?: number };
    if (!p || typeof p.workflowRunId !== 'string') throw new Error('workflowRunId required');
    return workflowEngine.getWorkflowEvents(p.workflowRunId, p.limit);
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
  // Dashboard 핸들러 (dashboard:*)
  // ============================================
  ipcMain.handle('dashboard:stats', async () => {
    const configStats = configReader.getStats();
    const runs = runOrchestrator.listRuns();
    const completedRuns = runs.filter((r: { status: string }) => r.status === 'completed').length;
    const totalRuns = runs.length;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    return { totalRuns, totalAgents: configStats.totalAgents, uptime: configStats.uptime, successRate, completedRuns, failedRuns: runs.filter((r: { status: string }) => r.status === 'failed').length };
  });

  ipcMain.handle('dashboard:recent-activity', async () => {
    const runs = runOrchestrator.listRuns();
    const recent = (runs.slice(0, 10) as unknown as Array<Record<string, unknown>>).map(run => ({
      id: run.id as string, agentId: run.agentId as string, status: run.status as string,
      message: run.status === 'completed' ? `${run.id} completed` : run.status === 'failed' ? `${run.id} failed${run.error ? `: ${run.error}` : ''}` : `${run.id} ${run.status}`,
      timestamp: run.createdAt as string,
    }));
    return { activities: recent };
  });

  ipcMain.handle('dashboard:inventory', async (_event, engine?: unknown) => {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const skills = configReader.readSkills(targetEngine).map(s => ({ name: s.name, path: s.path, installed: true, enabled: true }));
    const agentsRaw = configReader.readAgents(targetEngine);
    const routerConfig = configReader.readRouterConfig(targetEngine);
    const enabledPaths = configReader.readEnabledSkillPaths();
    const routes = _extractRoutes(routerConfig);
    const routedNames = new Set(routes.map(r => r.agentName));
    const skillNames = new Map(skills.map(s => [s.name, s]));
    const skillPaths = new Map(skills.map(s => [s.path, s]));

    const agents = agentsRaw.map((a: Record<string, unknown>) => {
      const name = String(a.name || 'unknown');
      const desc = String(a.description || '');
      const rawSkillName = a.skill_name ? String(a.skill_name) : null;
      const rawSkillPath = a.skill_path ? String(a.skill_path) : null;

      let resolvedName: string | null = rawSkillName;
      let resolvedPath: string | null = rawSkillPath;
      let mappingNote: string | null = null;
      if (rawSkillPath && skillPaths.has(rawSkillPath)) {
        resolvedName = skillPaths.get(rawSkillPath)!.name;
        resolvedPath = rawSkillPath;
      } else if (rawSkillPath) {
        resolvedPath = null;
        mappingNote = '(경로 불일치)';
      } else if (rawSkillName && skillNames.has(rawSkillName)) {
        resolvedName = rawSkillName;
        resolvedPath = skillNames.get(rawSkillName)!.path;
      } else if (rawSkillName) {
        resolvedName = null;
        mappingNote = '(이름 불일치)';
      }

      const isRouted = routedNames.has(name);
      let status: string; let reason: string;
      if (!resolvedName && !resolvedPath) { status = 'broken'; reason = '연결된 스킬 정보가 없습니다.'; }
      else if (resolvedPath && !skillPaths.has(resolvedPath)) { status = 'broken'; reason = `스킬 경로를 찾을 수 없습니다: ${resolvedPath}`; }
      else if (resolvedName && !skillNames.has(resolvedName)) { status = 'broken'; reason = `스킬 이름이 유효하지 않습니다: ${resolvedName}`; }
      else if (!isRouted) { status = 'passive'; reason = '라우터에 등록되지 않은 에이전트입니다.'; }
      else { status = 'healthy'; reason = '정상 작동 중입니다.'; }
      if (mappingNote) reason = `${reason} ${mappingNote}`;

      return {
        name,
        roleLabelKo: String(a.role_label || SETTINGS.founderName),
        departmentLabelKo: String(a.department || '관리지원'),
        description: desc,
        shortDescription: a.short_description ? String(a.short_description) : (desc.split('\n')[0]?.slice(0, 80) ?? ''),
        oneClickPrompt: a.one_click_prompt ? String(a.one_click_prompt) : null,
        skillName: resolvedName,
        skillPath: resolvedPath,
        routingType: String(a.routing_type || 'unknown'),
        routed: isRouted,
        status, reason,
      };
    });

    const result = { skills, agents, routes };
    safeValidate(InventoryResponseSchema, result);
    return result;
  });

  ipcMain.handle('dashboard:overview', async (_event, engine?: unknown) => {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const skills = configReader.readSkills(targetEngine);
    const agentsRaw = configReader.readAgents(targetEngine);
    const routerConfig = configReader.readRouterConfig(targetEngine);
    const routes = _extractRoutes(routerConfig);
    const activeThreads = configReader.readRecentThreads(100, targetEngine).length;
    const brokenCount = agentsRaw.filter((a: Record<string, unknown>) => {
      const rawSkillName = a.skill_name ? String(a.skill_name) : null;
      const skillPath = a.skill_path ? String(a.skill_path) : null;
      return !rawSkillName && !skillPath;
    }).length;
    const routedCount = routes.length;
    const healthyCount = agentsRaw.length - brokenCount;

    const result = {
      totalSkills: skills.length, totalAgents: agentsRaw.length,
      routedAgents: routedCount, routeHints: routes.length,
      brokenMappings: brokenCount, activeThreads,
      activeAgents: healthyCount, lastScannedAt: new Date().toISOString(),
    };
    safeValidate(OverviewResponseSchema, result);
    return result;
  });

  ipcMain.handle('dashboard:router-graph', async (_event, engine?: unknown) => {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const routerConfig = configReader.readRouterConfig(targetEngine);
    const routes = _extractRoutes(routerConfig);
    const agentsRaw = configReader.readAgents(targetEngine);
    const agentMap = new Map(agentsRaw.map((a: Record<string, unknown>) => [String(a.name), a]));

    const nodes: Array<Record<string, unknown>> = [{ id: 'router', label: 'Router', type: 'router', status: 'healthy' }];
    const edges: Array<Record<string, unknown>> = [];
    const seenAgents = new Set<string>();

    for (const route of routes) {
      if (!seenAgents.has(route.agentName)) {
        const agent = agentMap.get(route.agentName);
        const label = agent ? `${agent.role_label || route.agentName}\n(${route.agentName})` : route.agentName;
        const status = agent ? _resolveStatusSimple(agent) : 'passive';
        nodes.push({ id: route.agentName, label, type: 'agent', status });
        seenAgents.add(route.agentName);
      }
      edges.push({ id: `e-${route.agentName}`, source: 'router', target: route.agentName, label: route.keyword });
    }

    const result = { nodes, edges };
    safeValidate(RouterGraphResponseSchema, result);
    return result;
  });

  ipcMain.handle('dashboard:org-chart', async (_event, engine?: unknown) => {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const agentsRaw = configReader.readAgents(targetEngine);

    const nodes: Array<Record<string, unknown>> = [{ id: 'founder', label: SETTINGS.founderName, type: 'founder', status: 'healthy' }];
    const edges: Array<Record<string, unknown>> = [];
    const deptSet = new Set<string>();

    for (const a of agentsRaw) {
      const dept = String(a.department || '관리지원');
      if (!deptSet.has(dept)) {
        nodes.push({ id: dept, label: dept, type: 'department', status: 'healthy' });
        edges.push({ id: `e-${dept}`, source: 'founder', target: dept });
        deptSet.add(dept);
      }
      const name = String(a.name || 'unknown');
      const roleLabel = String(a.role_label || SETTINGS.founderName);
      const status = _resolveStatusSimple(a);
      nodes.push({ id: name, label: `${roleLabel}\n(${name})`, type: 'agent', status });
      edges.push({ id: `e-${name}`, source: dept, target: name });
    }

    const result = { nodes, edges };
    safeValidate(OrganizationChartResponseSchema, result);
    return result;
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
}

function _extractRoutes(routerConfig: Record<string, unknown>): Array<{ keyword: string; agentName: string }> {
  const routes: Array<{ keyword: string; agentName: string }> = [];
  const rawRoutes = routerConfig.routes;
  if (Array.isArray(rawRoutes)) {
    for (const r of rawRoutes) {
      if (r && typeof r === 'object') {
        routes.push({ agentName: String((r as Record<string, unknown>).agent || 'unknown'), keyword: String((r as Record<string, unknown>).intent || '').slice(0, 30) });
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

function _resolveStatusSimple(agent: Record<string, unknown>): string {
  const skillName = agent.skill_name ? String(agent.skill_name) : null;
  const skillPath = agent.skill_path ? String(agent.skill_path) : null;
  const broken = agent.broken === true;
  if (broken || (!skillName && !skillPath)) return 'broken';
  return 'healthy';
}
