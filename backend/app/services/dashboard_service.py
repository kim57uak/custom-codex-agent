from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from app.config import AppSettings
from app.models import (
    ActivityItemModel,
    AgentModel,
    DashboardMetricModel,
    DashboardResponse,
    GraphEdgeModel,
    GraphNodeModel,
    InventoryResponse,
    OrganizationChartResponse,
    OverviewModel,
    RouteModel,
    RouterGraphResponse,
    SkillModel,
)
from app.services.config_reader import CodexConfigReader


class DashboardService:
    """
    summary: 설정 스캔 결과와 활동성 집계를 API 응답 모델로 변환한다.
    purpose/context: UI가 조직도와 대시보드를 즉시 렌더링할 수 있도록 서버 측 조합 로직을 담당한다.
    rationale: Codex CLI의 로컬 설정(TOML/JSON)은 파편화되어 있으므로, 이를 하나의 일관된 인벤토리와 
               그래프 모델로 통합하여 프런트엔드의 복잡도를 낮추고 데이터 일관성을 보장한다.
    input: 로컬 Codex 설정을 읽는 reader와 전역 설정을 주입받는다.
    output: overview, inventory, router graph, organization chart, dashboard 응답을 생성한다.
    rules/constraints: 엔진 타입(Codex/Gemini)에 따라 조직도와 에이전트 목록을 동적으로 구성한다.
    failure behavior: 데이터가 비어 있어도 빈 컬렉션과 0값을 반환해 UI가 실패하지 않게 한다.
    """

    def __init__(self, reader: CodexConfigReader, settings: AppSettings) -> None:
        self._reader = reader
        self._settings = settings
        self._founder_name = settings.founder_name.strip() or "대표이사"

    def build_inventory(self, engine: str | None = None) -> InventoryResponse:
        """
        사용 가능한 모든 스킬과 에이전트 정보를 집계하고 상호 연결 상태를 검증한다.
        에이전트가 참조하는 스킬이 실제로 존재하는지, 라우터에 등록되어 있는지 등을 체크하여
        시스템의 '건강 상태'를 진단하는 핵심 로직임.
        """
        target_engine = engine or self._settings.default_engine
        skills_raw = self._reader.read_skills(target_engine)
        agents_raw = self._reader.read_agents(target_engine)
        router_config = self._reader.read_router_config(target_engine)
        enabled_paths = self._reader.read_enabled_skill_paths()
        routes = self._extract_routes(router_config)
        routed_agent_names = {route.agent_name for route in routes}

        skills = [
            SkillModel(
                name=skill["name"],
                path=skill["path"],
                installed=True,
                enabled=skill["path"] in enabled_paths,
            )
            for skill in skills_raw
        ]
        skill_name_set = {skill.name for skill in skills}
        skill_path_set = {skill.path for skill in skills}
        skill_by_name = {skill.name: skill for skill in skills}
        skill_by_path = {skill.path: skill for skill in skills}

        agents = []
        for agent in agents_raw:
            agent_name = str(agent.get("name", "unknown-agent"))
            description = str(agent.get("description", ""))
            short_description = self._to_optional_str(agent.get("short_description")) or self._short_description(description)
            one_click_prompt = self._to_optional_str(agent.get("one_click_prompt"))
            raw_skill_name = self._to_optional_str(agent.get("skill_name"))
            raw_skill_path = self._to_optional_str(agent.get("skill_path"))
            skill_name, skill_path, mapping_note = self._resolve_skill_mapping(
                raw_skill_name,
                raw_skill_path,
                skill_by_name,
                skill_by_path,
            )
            department_label_ko = self._to_optional_str(agent.get("department")) or self._settings.default_department_label_ko
            role_label_ko = self._to_optional_str(agent.get("role_label")) or self._settings.default_role_label_ko
            is_routed = agent_name in routed_agent_names
            status, reason = self._resolve_agent_status(skill_name, skill_path, skill_name_set, skill_path_set, is_routed)
            if mapping_note:
                reason = f"{reason} {mapping_note}"
            agents.append(
                AgentModel(
                    name=agent_name,
                    role_label_ko=role_label_ko,
                    department_label_ko=department_label_ko,
                    description=description,
                    short_description=short_description,
                    one_click_prompt=one_click_prompt,
                    skill_name=skill_name,
                    skill_path=skill_path,
                    routing_type=str(agent.get("routing_type", "unknown")),
                    routed=is_routed,
                    status=status,
                    reason=reason,
                )
            )

        return InventoryResponse(skills=skills, agents=agents, routes=routes)

    def build_overview(self, engine: str | None = None) -> OverviewModel:
        target_engine = engine or self._settings.default_engine
        inventory = self.build_inventory(target_engine)
        return OverviewModel(
            total_skills=len(inventory.skills),
            total_agents=len(inventory.agents),
            routed_agents=len([a for a in inventory.agents if a.routed]),
            route_hints=len(inventory.routes),
            broken_mappings=len([a for a in inventory.agents if a.status == "broken"]),
            active_threads=len(self._reader.read_recent_threads(100, target_engine)),
            active_agents=len([a for a in inventory.agents if a.status == "healthy"]),
            last_scanned_at=self._reader.get_scan_timestamp(),
        )

    def build_router_graph(self, engine: str | None = None) -> RouterGraphResponse:
        """
        라우터와 에이전트 간의 관계를 그래프 형태로 변환한다.
        사용자가 어떤 키워드를 입력했을 때 어떤 에이전트가 반응하는지를 시각적으로 파악할 수 있도록 돕는다.
        """
        target_engine = engine or self._settings.default_engine
        router_config = self._reader.read_router_config(target_engine)
        routes = self._extract_routes(router_config)
        inventory = self.build_inventory(target_engine)
        agent_map = {a.name: a for a in inventory.agents}

        nodes = [GraphNodeModel(id="router", label="Router", type="router", status="healthy")]
        edges = []
        seen_agents = set()

        for route in routes:
            agent_name = route.agent_name
            if agent_name not in seen_agents:
                label = agent_name
                agent_info = agent_map.get(agent_name)
                status = "healthy"
                if agent_info:
                    label = f"{agent_info.role_label_ko}\n({agent_name})"
                    status = agent_info.status
                nodes.append(GraphNodeModel(id=agent_name, label=label, type="agent", status=status))
                seen_agents.add(agent_name)
            edges.append(GraphEdgeModel(id=f"e-{agent_name}", source="router", target=agent_name, label=route.keyword))

        return RouterGraphResponse(nodes=nodes, edges=edges)

    def build_org_chart(self, engine: str | None = None) -> OrganizationChartResponse:
        """
        부서-에이전트 계층 구조를 트리 형태의 그래프 데이터로 구성한다.
        에이전트의 소속 부서 정보를 기준으로 노드를 그룹화하여 조직도를 생성함.
        """
        target_engine = engine or self._settings.default_engine
        inventory = self.build_inventory(target_engine)
        nodes = [GraphNodeModel(id="founder", label=self._founder_name, type="founder", status="healthy")]
        edges = []

        departments = sorted(list({a.department_label_ko for a in inventory.agents}))
        for dept in departments:
            nodes.append(GraphNodeModel(id=dept, label=dept, type="department", status="healthy"))
            edges.append(GraphEdgeModel(id=f"e-{dept}", source="founder", target=dept))

            dept_agents = [a for a in inventory.agents if a.department_label_ko == dept]
            for agent in dept_agents:
                label = f"{agent.role_label_ko}\n({agent.name})"
                nodes.append(GraphNodeModel(id=agent.name, label=label, type="agent", status=agent.status))
                edges.append(GraphEdgeModel(id=f"e-{agent.name}", source=dept, target=agent.name))

        return OrganizationChartResponse(nodes=nodes, edges=edges)

    def build_dashboard(self, engine: str | None = None) -> DashboardResponse:
        """
        시스템 활동 이력을 분석하여 주요 지표와 타임라인 데이터를 생성한다.
        최근 실행 횟수와 트렌드를 계산하여 대시보드 요약 정보를 제공함.
        """
        target_engine = engine or self._settings.default_engine
        history = self._reader.read_history(target_engine)
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=self._settings.trend_window_days)

        recent_history = [
            item
            for item in history
            if self._parse_iso(item.get("timestamp")) and self._parse_iso(item.get("timestamp")) > window_start
        ]

        total_exec_count = len(history)
        recent_exec_count = len(recent_history)

        agent_usage = Counter([item.get("agent") for item in history if item.get("agent")])
        
        # Trend calculation
        trend_data = self._calculate_trend(recent_history, window_start, now)

        metrics = [
            DashboardMetricModel(key="total_exec", label="전체 실행 횟수", value=total_exec_count, trend_values=trend_data),
            DashboardMetricModel(key="recent_exec", label="최근 실행", value=recent_exec_count, trend_values=[]),
            DashboardMetricModel(key="active_agents", label="활성 에이전트", value=len(agent_usage), trend_values=[]),
        ]

        activities = [
            ActivityItemModel(
                title=str(item.get("agent", "unknown")),
                subtitle=str(item.get("prompt", ""))[:60],
                timestamp=self._parse_iso(item.get("timestamp")) or now,
            )
            for item in history[-10:]
        ]
        activities.reverse()

        return DashboardResponse(
            metrics=metrics,
            active_agents=activities, # 단순 매핑
            recent_skills=[],
            recent_threads=[],
            timeline=activities,
            department_breakdown=[],
            status_breakdown=[],
        )

    def _extract_routes(self, router_config: dict) -> list[RouteModel]:
        routes = []
        raw_routes = router_config.get("routes", [])
        if isinstance(raw_routes, list):
            for r in raw_routes:
                routes.append(
                    RouteModel(
                        agent_name=str(r.get("agent", "unknown")),
                        keyword=str(r.get("intent", ""))[:30],
                    )
                )
        return routes

    def _resolve_skill_mapping(
        self,
        raw_name: str | None,
        raw_path: str | None,
        skill_by_name: dict[str, SkillModel],
        skill_by_path: dict[str, SkillModel],
    ) -> tuple[str | None, str | None, str | None]:
        if raw_path:
            skill = skill_by_path.get(raw_path)
            if skill:
                return skill.name, skill.path, None
            return None, raw_path, "(경로 불일치)"
        if raw_name:
            skill = skill_by_name.get(raw_name)
            if skill:
                return skill.name, skill.path, None
            return raw_name, None, "(이름 불일치)"
        return None, None, None

    def _resolve_agent_status(
        self,
        skill_name: str | None,
        skill_path: str | None,
        skill_name_set: set[str],
        skill_path_set: set[str],
        is_routed: bool,
    ) -> tuple[HealthStatus, str]:
        if not skill_name and not skill_path:
            return "broken", "연결된 스킬 정보가 없습니다."
        if skill_path and skill_path not in skill_path_set:
            return "broken", f"스킬 경로를 찾을 수 없습니다: {skill_path}"
        if skill_name and skill_name not in skill_name_set:
            return "broken", f"스킬 이름이 유효하지 않습니다: {skill_name}"
        if not is_routed:
            return "passive", "라우터에 등록되지 않은 에이전트입니다."
        return "healthy", "정상 작동 중입니다."

    def _calculate_trend(self, history: list[dict], start: datetime, end: datetime) -> list[int]:
        buckets = self._settings.trend_buckets
        delta = (end - start) / buckets
        trend = []
        for i in range(buckets):
            b_start = start + delta * i
            b_end = b_start + delta
            count = len([
                item for item in history
                if b_start <= (self._parse_iso(item.get("timestamp")) or start) < b_end
            ])
            trend.append(count)
        return trend

    @staticmethod
    def _parse_iso(value: object) -> datetime | None:
        if not isinstance(value, str):
            if isinstance(value, datetime):
                return value
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return None

    @staticmethod
    def _to_optional_str(value: object) -> str | None:
        if value is None:
            return None
        s = str(value).strip()
        return s if s else None

    @staticmethod
    def _short_description(text: str) -> str:
        s = text.strip().split("\n")[0]
        if len(s) > 80:
            return f"{s[:77]}..."
        return s
