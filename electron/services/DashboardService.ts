import { z } from 'zod';
import {
  InventoryResponseSchema, OverviewResponseSchema,
  RouterGraphResponseSchema, OrganizationChartResponseSchema,
} from '../../types/ipc-contract';
import { ConfigReader } from './ConfigReader';
import { SETTINGS } from '../settings/AppSettings';

export interface DashboardActivity {
  id: string; agentId: string; status: string; message: string; timestamp: string;
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

export class DashboardService {
  private configReader: ConfigReader;

  constructor(configReader: ConfigReader) {
    this.configReader = configReader;
  }

  getStats(runList: Array<{ status: string }>): { totalRuns: number; totalAgents: number; uptime: number; successRate: number; completedRuns: number; failedRuns: number } {
    const configStats = this.configReader.getStats();
    const completedRuns = runList.filter(r => r.status === 'completed').length;
    const totalRuns = runList.length;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    return { totalRuns, totalAgents: configStats.totalAgents, uptime: configStats.uptime, successRate, completedRuns, failedRuns: runList.filter(r => r.status === 'failed').length };
  }

  getRecentActivity(runs: Array<Record<string, unknown>>): DashboardActivity[] {
    return runs.slice(0, 10).map(run => ({
      id: run.id as string, agentId: run.agentId as string, status: run.status as string,
      message: run.status === 'completed' ? `${run.id} completed` : run.status === 'failed' ? `${run.id} failed${run.error ? `: ${run.error}` : ''}` : `${run.id} ${run.status}`,
      timestamp: run.createdAt as string,
    }));
  }

  getInventory(engine?: string): Record<string, unknown> {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const skills = this.configReader.readSkills(targetEngine).map(s => ({ name: s.name, path: s.path, installed: true, enabled: true }));
    const agentsRaw = this.configReader.readAgents(targetEngine);
    const routerConfig = this.configReader.readRouterConfig(targetEngine);
    const enabledPaths = this.configReader.readEnabledSkillPaths();
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
    return safeValidate(InventoryResponseSchema, result);
  }

  getOverview(engine?: string): Record<string, unknown> {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const skills = this.configReader.readSkills(targetEngine);
    const agentsRaw = this.configReader.readAgents(targetEngine);
    const routerConfig = this.configReader.readRouterConfig(targetEngine);
    const routes = _extractRoutes(routerConfig);
    const activeThreads = this.configReader.readRecentThreads(100, targetEngine).length;
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
    return safeValidate(OverviewResponseSchema, result);
  }

  getRouterGraph(engine?: string): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const routerConfig = this.configReader.readRouterConfig(targetEngine);
    const routes = _extractRoutes(routerConfig);
    const agentsRaw = this.configReader.readAgents(targetEngine);
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
    return safeValidate(RouterGraphResponseSchema, result);
  }

  getOrgChart(engine?: string): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
    const targetEngine = typeof engine === 'string' ? engine : undefined;
    const agentsRaw = this.configReader.readAgents(targetEngine);

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
    return safeValidate(OrganizationChartResponseSchema, result);
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
