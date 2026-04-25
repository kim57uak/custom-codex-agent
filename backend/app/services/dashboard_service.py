from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

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


DEFAULT_DEPARTMENT_LABEL_KO = "관리지원"
DEFAULT_ROLE_LABEL_KO = "관리지원 담당"
TREND_WINDOW_DAYS = 7
TREND_BUCKETS = 12


class DashboardService:
    """
    summary: 설정 스캔 결과와 활동성 집계를 API 응답 모델로 변환한다.
    purpose/context: UI가 조직도와 대시보드를 즉시 렌더링할 수 있도록 서버 측 조합 로직을 담당한다.
    input: 로컬 Codex 설정을 읽는 reader를 주입받는다.
    output: overview, inventory, router graph, organization chart, dashboard 응답을 생성한다.
    rules/constraints: 조직 역할은 1차에서 규칙 기반으로 분류하고, 활동성은 로그/스레드 기반 추정 모델을 사용한다.
    failure behavior: 데이터가 비어 있어도 빈 컬렉션과 0값을 반환해 UI가 실패하지 않게 한다.
    """

    def __init__(self, reader: CodexConfigReader, founder_name: str) -> None:
        self._reader = reader
        self._founder_name = founder_name.strip() or "대표이사"

    def build_inventory(self) -> InventoryResponse:
        skills_raw = self._reader.read_skills()
        agents_raw = self._reader.read_agents()
        router_config = self._reader.read_router_config()
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
            department_label_ko = self._to_optional_str(agent.get("department")) or DEFAULT_DEPARTMENT_LABEL_KO
            role_label_ko = self._to_optional_str(agent.get("role_label")) or DEFAULT_ROLE_LABEL_KO
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

    def build_overview(self) -> OverviewModel:
        inventory = self.build_inventory()
        threads = self._reader.read_recent_threads(limit=10)
        active_agents = self._guess_active_agents(inventory, threads)
        broken_count = sum(1 for agent in inventory.agents if agent.status == "broken")
        return OverviewModel(
            total_skills=len(inventory.skills),
            total_agents=len(inventory.agents),
            routed_agents=sum(1 for agent in inventory.agents if agent.routed),
            route_hints=len(inventory.routes),
            broken_mappings=broken_count,
            active_threads=len(threads),
            active_agents=len(active_agents),
            last_scanned_at=self._reader.get_scan_timestamp(),
        )

    def build_router_graph(self) -> RouterGraphResponse:
        inventory = self.build_inventory()
        nodes = [
            GraphNodeModel(
                id="router:main",
                type="router",
                label="router-agent",
                sublabel="요청 분기 허브",
                status="healthy",
            )
        ]
        edges: list[GraphEdgeModel] = []
        skill_map = {skill.name: skill for skill in inventory.skills}
        agent_map = {agent.name: agent for agent in inventory.agents}

        for route in inventory.routes:
            keyword_node_id = f"keyword:{route.keyword}"
            agent_node_id = f"agent:{route.agent_name}"
            agent = agent_map.get(route.agent_name)
            nodes.append(
                GraphNodeModel(
                    id=keyword_node_id,
                    type="keyword",
                    label=route.keyword,
                    sublabel="라우팅 키워드",
                    status="healthy",
                )
            )
            edges.append(GraphEdgeModel(id=f"{keyword_node_id}->router:main", source=keyword_node_id, target="router:main"))

            if agent:
                nodes.append(
                    GraphNodeModel(
                        id=agent_node_id,
                        type="agent",
                        label=agent.role_label_ko,
                        sublabel=agent.name,
                        status=agent.status,
                        metadata={
                            "에이전트": agent.name,
                            "직무": agent.role_label_ko,
                            "부서": agent.department_label_ko,
                            "라우팅 방식": agent.routing_type,
                            "연결 스킬": agent.skill_name or "없음",
                            "설정 경로": agent.skill_path or "없음",
                            "상태 근거": agent.reason,
                        },
                    )
                )
                edges.append(GraphEdgeModel(id=f"router:main->{agent_node_id}", source="router:main", target=agent_node_id))
                if agent.skill_name and agent.skill_name in skill_map:
                    skill_node_id = f"skill:{agent.skill_name}"
                    nodes.append(
                        GraphNodeModel(
                            id=skill_node_id,
                            type="skill",
                            label=agent.skill_name,
                            sublabel="연결 스킬",
                            status="healthy",
                        )
                    )
                    edges.append(GraphEdgeModel(id=f"{agent_node_id}->{skill_node_id}", source=agent_node_id, target=skill_node_id))

        return RouterGraphResponse(nodes=self._deduplicate_nodes(nodes), edges=edges)

    def build_org_chart(self) -> OrganizationChartResponse:
        inventory = self.build_inventory()
        nodes = [
            GraphNodeModel(id="dept:founder", type="department", label="대표", sublabel=self._founder_name, status="healthy"),
            GraphNodeModel(id="dept:staff", type="department", label="비서실", sublabel="요청 분기 및 운영 조정", status="healthy"),
        ]
        edges = [GraphEdgeModel(id="founder->staff", source="dept:founder", target="dept:staff")]

        departments: dict[str, str] = {}
        for agent in inventory.agents:
            department_id = f"dept:{agent.department_label_ko}"
            departments[agent.department_label_ko] = department_id

        for department_label, department_id in sorted(departments.items()):
            if department_id == "dept:비서실":
                continue
            nodes.append(GraphNodeModel(id=department_id, type="department", label=department_label, status="healthy"))
            edges.append(GraphEdgeModel(id=f"dept:founder->{department_id}", source="dept:founder", target=department_id))

        for agent in inventory.agents:
            agent_node_id = f"agent:{agent.name}"
            parent_id = "dept:staff" if agent.department_label_ko == "비서실" else f"dept:{agent.department_label_ko}"
            nodes.append(
                GraphNodeModel(
                    id=agent_node_id,
                    type="agent",
                    label=agent.role_label_ko,
                    sublabel=agent.name,
                    status=agent.status,
                    metadata={
                        "부서": agent.department_label_ko,
                        "근거": agent.reason,
                        "short_description": agent.short_description or self._short_description(agent.description),
                    },
                )
            )
            edges.append(GraphEdgeModel(id=f"{parent_id}->{agent_node_id}", source=parent_id, target=agent_node_id))

        return OrganizationChartResponse(nodes=self._deduplicate_nodes(nodes), edges=edges)

    def build_dashboard(self) -> DashboardResponse:
        inventory = self.build_inventory()
        overview = self.build_overview()
        recent_threads = self._reader.read_recent_threads(limit=8)
        recent_logs = self._reader.read_recent_logs(limit=8)
        recent_history = self._reader.read_recent_history(limit=8)
        metric_trends = self._build_metric_trends(inventory)
        active_agents = self._guess_active_agents(inventory, recent_threads)
        recent_skills = self._guess_recent_skills(inventory, recent_history)
        department_breakdown = Counter(agent.department_label_ko for agent in inventory.agents)
        status_breakdown = Counter(agent.status for agent in inventory.agents)

        metrics = [
            DashboardMetricModel(key="skills", label="전체 스킬", value=overview.total_skills, trend_values=metric_trends.get("skills", [])),
            DashboardMetricModel(key="agents", label="전체 에이전트", value=overview.total_agents, trend_values=metric_trends.get("agents", [])),
            DashboardMetricModel(key="routed", label="라우팅 에이전트", value=overview.routed_agents, trend_values=metric_trends.get("routed", [])),
            DashboardMetricModel(key="threads", label="최근 활성 스레드", value=overview.active_threads, trend_values=metric_trends.get("threads", [])),
            DashboardMetricModel(key="activeAgents", label="활동 추정 에이전트", value=overview.active_agents, trend_values=metric_trends.get("activeAgents", [])),
            DashboardMetricModel(key="broken", label="깨진 매핑", value=overview.broken_mappings, trend_values=metric_trends.get("broken", [])),
        ]

        return DashboardResponse(
            metrics=metrics,
            active_agents=active_agents,
            recent_skills=recent_skills,
            recent_threads=[
                ActivityItemModel(
                    title=str(item.get("title") or "제목 없음"),
                    subtitle=str(item.get("id") or "thread"),
                    timestamp=self._from_unix(item.get("updated_at")),
                )
                for item in recent_threads
            ],
            timeline=[
                ActivityItemModel(
                    title=str(item.get("target") or "log"),
                    subtitle=str(item.get("feedback_log_body") or "")[:120],
                    timestamp=self._from_unix(item.get("ts")),
                )
                for item in recent_logs
            ],
            department_breakdown=[
                DashboardMetricModel(key=department, label=department, value=count)
                for department, count in department_breakdown.most_common()
            ],
            status_breakdown=[
                DashboardMetricModel(key=status, label=self._status_label_ko(status), value=count)
                for status, count in status_breakdown.most_common()
            ],
        )

    def _build_metric_trends(self, inventory: InventoryResponse) -> dict[str, list[int]]:
        now = datetime.now(tz=timezone.utc)
        window_start = now - timedelta(days=TREND_WINDOW_DAYS)
        window_start_ts = int(window_start.timestamp())
        threads = self._reader.read_threads_since(window_start_ts)
        if not threads:
            return {}

        bucket_seconds = max(1, int((TREND_WINDOW_DAYS * 24 * 60 * 60) / TREND_BUCKETS))
        thread_counts = [0] * TREND_BUCKETS
        active_agent_sets: list[set[str]] = [set() for _ in range(TREND_BUCKETS)]

        for thread in threads:
            updated_at = self._safe_int(thread.get("updated_at"))
            if updated_at is None or updated_at < window_start_ts:
                continue
            bucket_index = min(TREND_BUCKETS - 1, max(0, int((updated_at - window_start_ts) // bucket_seconds)))
            thread_counts[bucket_index] += 1
            inferred_agent = self._infer_thread_agent_key(thread, inventory)
            if inferred_agent:
                active_agent_sets[bucket_index].add(inferred_agent)

        trends: dict[str, list[int]] = {}
        if any(value > 0 for value in thread_counts):
            trends["threads"] = thread_counts

        active_agent_counts = [len(bucket) for bucket in active_agent_sets]
        if any(value > 0 for value in active_agent_counts):
            trends["activeAgents"] = active_agent_counts

        return trends

    def _extract_routes(self, router_config: dict[str, object]) -> list[RouteModel]:
        routing_hints = router_config.get("routing_hints", {})
        if not isinstance(routing_hints, dict):
            return []
        return [RouteModel(keyword=str(keyword), agent_name=str(agent_name)) for keyword, agent_name in routing_hints.items()]

    def _resolve_agent_status(
        self,
        skill_name: str | None,
        skill_path: str | None,
        skill_name_set: set[str],
        skill_path_set: set[str],
        is_routed: bool,
    ) -> tuple[str, str]:
        if skill_name and skill_name not in skill_name_set:
            return "broken", "연결된 skill_name이 설치 목록에 없습니다."
        if skill_path and skill_path not in skill_path_set:
            return "broken", "연결된 skill_path가 실제 파일과 일치하지 않습니다."
        if not is_routed:
            return "passive", "라우터에 연결되지 않은 에이전트입니다."
        return "healthy", "정상 연결 상태입니다."

    @staticmethod
    def _resolve_skill_mapping(
        raw_skill_name: str | None,
        raw_skill_path: str | None,
        skill_by_name: dict[str, SkillModel],
        skill_by_path: dict[str, SkillModel],
    ) -> tuple[str | None, str | None, str | None]:
        if raw_skill_name and raw_skill_name in skill_by_name:
            installed_skill = skill_by_name[raw_skill_name]
            note = None
            if raw_skill_path and raw_skill_path != installed_skill.path:
                note = "설정 skill_path가 설치 경로와 달라 실제 설치 경로로 표시합니다."
            return installed_skill.name, installed_skill.path, note

        if raw_skill_path and raw_skill_path in skill_by_path:
            installed_skill = skill_by_path[raw_skill_path]
            note = None
            if raw_skill_name and raw_skill_name != installed_skill.name:
                note = "설정 skill_name이 설치 스킬명과 달라 실제 설치명으로 표시합니다."
            return installed_skill.name, installed_skill.path, note

        return raw_skill_name, raw_skill_path, None

    def _guess_active_agents(self, inventory: InventoryResponse, recent_threads: list[dict[str, object]]) -> list[ActivityItemModel]:
        agent_counter: Counter[str] = Counter()
        for thread in recent_threads:
            title = str(thread.get("title") or "").lower()
            for agent in inventory.agents:
                token = agent.name.replace("-agent", "").lower()
                if token and token in title:
                    agent_counter[agent.role_label_ko] += 1
            if "router" in title:
                agent_counter["비서실장"] += 1

        return [
            ActivityItemModel(title=title, subtitle=f"최근 스레드에서 {count}회 감지", timestamp=datetime.now(tz=timezone.utc))
            for title, count in agent_counter.most_common(5)
        ]

    def _guess_recent_skills(self, inventory: InventoryResponse, recent_history: list[dict[str, object]]) -> list[ActivityItemModel]:
        skill_counter: Counter[str] = Counter()
        for item in recent_history:
            text = str(item.get("text") or "").lower()
            for skill in inventory.skills:
                if skill.name.lower() in text:
                    skill_counter[skill.name] += 1
        return [
            ActivityItemModel(title=skill_name, subtitle=f"최근 요청 {count}건에서 언급", timestamp=datetime.now(tz=timezone.utc))
            for skill_name, count in skill_counter.most_common(5)
        ]

    def _infer_thread_agent_key(self, thread: dict[str, object], inventory: InventoryResponse) -> str | None:
        nickname = self._to_optional_str(thread.get("agent_nickname"))
        if nickname:
            return nickname
        role = self._to_optional_str(thread.get("agent_role"))
        if role:
            return role

        title = str(thread.get("title") or "").lower()
        for agent in inventory.agents:
            agent_tokens = {
                agent.name.lower(),
                agent.name.replace("-agent", "").lower(),
                agent.role_label_ko.lower(),
            }
            if any(token and token in title for token in agent_tokens):
                return agent.name
        if "router" in title:
            return "router-agent"
        return None

    @staticmethod
    def _short_description(text: str) -> str:
        normalized = " ".join(str(text or "").split())
        if not normalized:
            return "설명 없음"
        if len(normalized) <= 72:
            return normalized
        return f"{normalized[:69].rstrip()}..."

    @staticmethod
    def _status_label_ko(status: str) -> str:
        labels = {
            "healthy": "정상",
            "partial": "부분 경고",
            "broken": "깨짐",
            "passive": "비활성",
        }
        return labels.get(status, status)

    @staticmethod
    def _deduplicate_nodes(nodes: list[GraphNodeModel]) -> list[GraphNodeModel]:
        deduplicated: dict[str, GraphNodeModel] = {}
        for node in nodes:
            deduplicated[node.id] = node
        return list(deduplicated.values())

    @staticmethod
    def _to_optional_str(value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _safe_int(value: object) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _from_unix(value: object) -> datetime | None:
        if value in (None, ""):
            return None
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            return None
