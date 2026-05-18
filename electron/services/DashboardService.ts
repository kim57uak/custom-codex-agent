/**
 * DashboardService — 대시보드 데이터 집계 서비스.
 *
 * @what
 * - 실행 통계(stats), 최근 활동(recentActivity), 인벤토리(inventory), 개요(overview),
 *   라우터 그래프(routerGraph), 조직도(orgChart) 등 대시보드 화면에 필요한 데이터를
 *   ConfigReader로부터 읽어 가공합니다.
 *
 * @design
 * - 모든 응답은 Zod 스키마(ipc-contract)로 검증되어 타입 안전성을 보장합니다.
 * - 에이전트 상태(healthy/broken/passive)와 스킬 매핑 상태를 실시간으로 분석합니다.
 * - 데이터 변환 책임을 ConfigReader(읽기)와 분리하여 단일 책임 원칙을 따릅니다.
 *
 * @usage
 *   const svc = new DashboardService(configReader);
 *   const stats = svc.getStats(runList);
 *   const overview = svc.getOverview('gemini');
 */
import { z } from 'zod';
import {
  InventoryResponseSchema, OverviewResponseSchema,
  RouterGraphResponseSchema, OrganizationChartResponseSchema,
} from '../../types/ipc-contract';
import { ConfigReader } from './ConfigReader';
import { SETTINGS } from '../settings/AppSettings';

/** 대시보드 최근 활동 목록의 단일 항목을 나타냅니다. */
export interface DashboardActivity {
  /** 활동 ID */
  id: string;
  /** 에이전트 ID */
  agentId: string;
  /** 활동 상태 (completed, failed, running 등) */
  status: string;
  /** 활동 설명 메시지 */
  message: string;
  /** 활동 발생 타임스탬프 */
  timestamp: string;
}

/**
 * 라우터 설정에서 키워드-에이전트 매핑 라우트 목록을 추출합니다.
 * routes 배열과 routing_hints 객체를 모두 처리합니다.
 * @param routerConfig - 라우터 설정 객체
 * @returns 키워드와 에이전트 이름 쌍 배열
 */
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

/**
 * 에이전트 레코드의 스킬 매핑 정보를 기반으로 상태를 판별합니다.
 * @param agent - 에이전트 설정 객체
 * @returns 'healthy' 또는 'broken' 상태 문자열
 */
function _resolveStatusSimple(agent: Record<string, unknown>): string {
  const skillName = agent.skill_name ? String(agent.skill_name) : null;
  const skillPath = agent.skill_path ? String(agent.skill_path) : null;
  const broken = agent.broken === true;
  if (broken || (!skillName && !skillPath)) return 'broken';
  return 'healthy';
}

export class DashboardService {
  /** 설정 데이터 읽기를 위임받은 ConfigReader 인스턴스 */
  private configReader: ConfigReader;

  /**
   * DashboardService 인스턴스를 생성합니다.
   * @param configReader - 데이터 읽기에 사용할 ConfigReader
   */
  constructor(configReader: ConfigReader) {
    this.configReader = configReader;
  }

  /**
   * 실행 목록에서 통계를 집계합니다.
   * @param runList - 실행 레코드 배열
   * @returns 총 실행 수, 에이전트 수, 업타임, 성공률, 완료/실패 수
   */
  getStats(runList: Array<{ status: string }>): { totalRuns: number; totalAgents: number; uptime: number; successRate: number; completedRuns: number; failedRuns: number } {
    const configStats = this.configReader.getStats();
    const completedRuns = runList.filter(r => r.status === 'completed').length;
    const totalRuns = runList.length;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    return { totalRuns, totalAgents: configStats.totalAgents, uptime: configStats.uptime, successRate, completedRuns, failedRuns: runList.filter(r => r.status === 'failed').length };
  }

  /**
   * 최근 실행 목록에서 대시보드 표시용 활동 항목을 생성합니다.
   * @param runs - 실행 레코드 배열
   * @returns 최대 10개의 DashboardActivity 항목
   */
  getRecentActivity(runs: Array<Record<string, unknown>>): DashboardActivity[] {
    return runs.slice(0, 10).map(run => ({
      id: run.id as string, agentId: run.agentId as string, status: run.status as string,
      message: run.status === 'completed' ? `${run.id} completed` : run.status === 'failed' ? `${run.id} failed${run.error ? `: ${run.error}` : ''}` : `${run.id} ${run.status}`,
      timestamp: run.createdAt as string,
    }));
  }

  /**
   * 지정된 엔진의 스킬, 에이전트, 라우트 정보를 통합한 인벤토리 데이터를 반환합니다.
   * 에이전트-스킬 매핑 상태(healthy/broken/passive)도 함께 분석합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns Zod 스키마로 검증된 인벤토리 응답
   */
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

  /**
   * 지정된 엔진의 개요(overview) 데이터를 집계합니다.
   * 스킬/에이전트 수, 라우팅 현황, 활성 스레드, 손상된 매핑 등을 포함합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns Zod 스키마로 검증된 개요 응답
   */
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

  /**
   * 라우터-에이전트 간 연결 관계를 그래프(노드/엣지) 형태로 반환합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 노드와 엣지 배열 (Zod 검증됨)
   */
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

  /**
   * 창업자-부서-에이전트 계층 구조의 조직도를 그래프 형태로 반환합니다.
   * @param engine - 엔진 이름 (선택)
   * @returns 노드와 엣지 배열 (Zod 검증됨)
   */
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

/**
 * Zod 스키마로 데이터를 검증하고 실패 시 상세한 검증 오류를 throw합니다.
 * @param schema - 검증에 사용할 Zod 스키마
 * @param data - 검증할 데이터
 * @returns 검증된 타입 안전 데이터
 */
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
