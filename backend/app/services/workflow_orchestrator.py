from __future__ import annotations

import asyncio
import json
import re
from collections import Counter
from pathlib import Path
from uuid import uuid4

from app.config import AppSettings
from app.models import WorkflowRecommendedAgentModel, WorkflowStepInputModel
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator
from app.services.workflow_catalog import (
    DEFAULT_WORKFLOW_RECOMMENDATION_MAX_AGENTS,
    DEFAULT_WORKFLOW_STEP_TITLE_PREFIX,
    WORKFLOW_GOAL_PREVIEW_MAX_CHARS,
    WORKFLOW_STEP_SUMMARY_MAX_CHARS,
    resolve_workflow_icon_key,
)
from app.services.workflow_store import WorkflowRunRecord, WorkflowStore


WORKFLOW_RECOMMENDATION_PROMPT_TEMPLATE = """
You are helping assemble a workflow of Codex agents from a live local skill registry.
Return only valid JSON, with no markdown fences and no explanatory text.

User goal:
{goal_prompt}

Available agent catalog JSON:
{agent_catalog}

Rules:
- Recommend between 1 and {max_agents} agents.
- Use only agent names from the available list.
- Select agents by matching the user goal against skillSummary, skillDescription, agentSummary, role, and department.
- Reject agents whose skill does not directly contribute to the goal, even if their name sounds broadly useful.
- Preserve a sensible execution order.
- For multi-step work, choose complementary agents with distinct responsibilities.
- Keep each reason concise and cite the matched skill capability.
- Write defaultPrompt in Korean and make it specific to that agent's skill.
- Output JSON with this exact shape:
{{
  "recommendedAgents": [
    {{
      "agentName": "example-agent",
      "reason": "short reason",
      "defaultPrompt": "step instruction"
    }}
  ]
}}
""".strip()

WORKFLOW_RECOMMENDATION_TIMEOUT_SECONDS = 20
WORKFLOW_SKILL_SUMMARY_MAX_CHARS = 1200
WORKFLOW_AGENT_SUMMARY_MAX_CHARS = 900
WORKFLOW_CATALOG_TEXT_MAX_CHARS = 2200
WORKFLOW_RECOMMENDATION_MIN_SCORE = 6
WORKFLOW_RECOMMENDATION_RELATIVE_SCORE_RATIO = 0.5


class WorkflowOrchestrator:
    """
    summary: 워크플로 추천과 순차 실행을 담당하는 상위 오케스트레이터다.
    purpose/context: 기존 단일 run 실행 엔진 위에서 멀티 에이전트 워크플로를 조립하고 진행 상태를 기록한다.
    input: 설정, 대시보드 서비스, 이벤트 브로커, 단일 실행 오케스트레이터, 워크플로 저장소를 주입받는다.
    output: 추천 결과, workflow run 생성/조회/취소/재시도, 단계 상태 이벤트를 제공한다.
    rules/constraints: 단계 실행은 기본적으로 순차적이며, 단계 프롬프트에는 이전 단계 요약만 제한적으로 전달한다.
    failure behavior: 추천 CLI 실패 시 로컬 휴리스틱으로 폴백하고, 단계 실패 시 workflow run을 명시적으로 failed/canceled로 종료한다.
    """

    def __init__(
        self,
        settings: AppSettings,
        dashboard_service: DashboardService,
        broker: EventBroker,
        run_orchestrator: RunOrchestrator,
        store: WorkflowStore,
    ) -> None:
        self._settings = settings
        self._dashboard_service = dashboard_service
        self._broker = broker
        self._run_orchestrator = run_orchestrator
        self._store = store
        self._workflow_tasks: dict[str, asyncio.Task[None]] = {}
        self._active_run_ids: dict[str, str] = {}

    async def recommend_agents(self, goal_prompt: str, max_agents: int | None = None) -> list[WorkflowRecommendedAgentModel]:
        validated_goal = self._run_orchestrator.validate_prompt(goal_prompt)
        bounded_max_agents = self._sanitize_max_agents(max_agents)
        inventory = self._dashboard_service.build_inventory()
        available_agents = [agent for agent in inventory.agents if agent.status != "broken" and agent.skill_name]
        if not available_agents:
            return []

        agent_profiles = self._build_agent_profiles(available_agents)
        recommendations = await self._recommend_via_codex(validated_goal, agent_profiles, bounded_max_agents)
        if recommendations:
            return self._complete_recommendations(validated_goal, recommendations, agent_profiles, bounded_max_agents)
        return self._recommend_via_heuristics(validated_goal, agent_profiles, bounded_max_agents)

    async def create_workflow_run(
        self,
        goal_prompt: str,
        steps: list[WorkflowStepInputModel],
        workspace_root: str | None,
        sandbox_mode: str | None,
        approval_policy: str | None,
        initial_carryover_summaries: list[str] | None = None,
    ) -> WorkflowRunRecord:
        validated_goal = self._run_orchestrator.validate_prompt(goal_prompt)
        validated_workspace_root = self._run_orchestrator.validate_workspace_root(workspace_root)
        validated_sandbox_mode = self._run_orchestrator.validate_sandbox_mode(sandbox_mode)
        validated_approval_policy = self._run_orchestrator.validate_approval_policy(approval_policy)
        prepared_steps = self._prepare_steps(steps)

        workflow_run_id = uuid4().hex
        record = self._store.create_workflow_run(
            workflow_run_id=workflow_run_id,
            goal_prompt=validated_goal,
            workspace_root=str(validated_workspace_root),
            sandbox_mode=validated_sandbox_mode,
            approval_policy=validated_approval_policy,
            steps=prepared_steps,
        )
        await self._publish_workflow_event(workflow_run_id, "workflow:queued", "workflow queued")
        task = asyncio.create_task(
            self._execute_workflow(
                workflow_run_id=workflow_run_id,
                goal_prompt=validated_goal,
                steps=prepared_steps,
                workspace_root=validated_workspace_root,
                sandbox_mode=validated_sandbox_mode,
                approval_policy=validated_approval_policy,
                initial_carryover_summaries=list(initial_carryover_summaries or []),
            )
        )
        self._workflow_tasks[workflow_run_id] = task
        task.add_done_callback(lambda _done, current_id=workflow_run_id: self._workflow_tasks.pop(current_id, None))
        return record

    async def cancel_workflow_run(self, workflow_run_id: str) -> WorkflowRunRecord | None:
        record = self._store.get_workflow_run(workflow_run_id)
        if record is None:
            return None
        if record.status in {"completed", "failed", "canceled"}:
            return record

        active_run_id = self._active_run_ids.get(workflow_run_id)
        if active_run_id:
            await self._run_orchestrator.cancel_run(active_run_id)

        task = self._workflow_tasks.get(workflow_run_id)
        if task is not None and not task.done():
            task.cancel()

        if record.current_step_index is not None:
            self._store.update_step_status(
                workflow_run_id,
                record.current_step_index,
                status="canceled",
                error_message="workflow canceled by user",
                mark_completed=True,
            )
        updated = self._store.finish_workflow_run(workflow_run_id, status="canceled", error_message="workflow canceled by user")
        await self._publish_workflow_event(workflow_run_id, "workflow:canceled", "workflow canceled by user")
        return updated

    async def retry_workflow_run(self, workflow_run_id: str) -> WorkflowRunRecord | None:
        record = self._store.get_workflow_run(workflow_run_id)
        if record is None:
            return None
        steps = self._store.list_workflow_steps(workflow_run_id)
        step_inputs = [
            WorkflowStepInputModel(
                agent_name=step.agent_name,
                prompt=step.prompt,
                title=step.title,
                icon_key=step.icon_key,
                skill_name=step.skill_name,
            )
            for step in steps
        ]
        return await self.create_workflow_run(
            goal_prompt=record.goal_prompt,
            steps=step_inputs,
            workspace_root=record.workspace_root,
            sandbox_mode=record.sandbox_mode,
            approval_policy=record.approval_policy,
        )

    async def retry_workflow_run_from_step(
        self,
        workflow_run_id: str,
        step_index: int,
        follow_up_note: str | None = None,
    ) -> WorkflowRunRecord | None:
        """
        summary: 기존 워크플로 실행의 특정 단계부터 새 워크플로 run을 다시 시작한다.
        purpose/context: 실패 단계 재시도처럼 전체를 다시 돌리지 않고 필요한 단계부터 이어가는 운영 경로를 제공한다.
        input: 원본 workflow_run_id와 다시 시작할 step_index를 받는다.
        output: 새로 생성된 WorkflowRunRecord 또는 원본 run 미존재 시 None을 반환한다.
        rules/constraints: step_index 이전 단계의 summary만 carry-over 컨텍스트로 전달하고, 시작 단계 이후 단계만 새 run에 포함한다.
        failure behavior: 잘못된 step_index이면 ValueError를 발생시켜 API가 4xx로 응답하게 한다.
        """

        return await self._restart_workflow_from_existing_run(
            workflow_run_id=workflow_run_id,
            step_index=step_index,
            follow_up_note=follow_up_note,
        )

    async def skip_workflow_step_and_continue(self, workflow_run_id: str, step_index: int) -> WorkflowRunRecord | None:
        """
        summary: 특정 단계를 건너뛰고 다음 단계부터 새 워크플로 run을 만든다.
        purpose/context: 실패 단계를 수동 판단으로 제외한 채 후속 단계를 이어가려는 운영 시나리오를 지원한다.
        input: 원본 workflow_run_id와 건너뛸 step_index를 받는다.
        output: step_index + 1부터 시작하는 새 WorkflowRunRecord 또는 원본 run 미존재 시 None을 반환한다.
        rules/constraints: 건너뛴 단계는 carry-over summary에 포함하지 않고, 그 이전 완료 단계들의 summary만 전달한다.
        failure behavior: 마지막 단계를 건너뛰려 하면 후속 단계가 없어 ValueError를 발생시킨다.
        """

        return await self._restart_workflow_from_existing_run(
            workflow_run_id=workflow_run_id,
            step_index=step_index + 1,
        )

    def list_workflow_runs(self, limit: int = 30) -> list[WorkflowRunRecord]:
        return self._store.list_workflow_runs(limit=limit)

    def get_workflow_run(self, workflow_run_id: str) -> WorkflowRunRecord | None:
        return self._store.get_workflow_run(workflow_run_id)

    def list_workflow_steps(self, workflow_run_id: str):
        return self._store.list_workflow_steps(workflow_run_id)

    def list_workflow_events(self, workflow_run_id: str, limit: int = 500):
        return self._store.list_workflow_events(workflow_run_id, limit=limit)

    @staticmethod
    def to_goal_preview(goal_prompt: str, max_chars: int = WORKFLOW_GOAL_PREVIEW_MAX_CHARS) -> str:
        compact = " ".join(goal_prompt.strip().split())
        if len(compact) <= max_chars:
            return compact
        return f"{compact[: max_chars - 3]}..."

    async def _execute_workflow(
        self,
        workflow_run_id: str,
        goal_prompt: str,
        steps: list[dict[str, str | None]],
        workspace_root: Path,
        sandbox_mode: str | None,
        approval_policy: str | None,
        initial_carryover_summaries: list[str] | None = None,
    ) -> None:
        carryover_summaries: list[str] = list(initial_carryover_summaries or [])
        try:
            self._store.mark_workflow_running(workflow_run_id)
            await self._publish_workflow_event(workflow_run_id, "workflow:started", "workflow started")

            for step in steps:
                step_index = int(step["step_index"] or 0)
                self._store.update_workflow_current_step(workflow_run_id, step_index)
                self._store.update_step_status(
                    workflow_run_id,
                    step_index,
                    status="running",
                    mark_started=True,
                    last_event_message="agent run starting",
                )
                await self._publish_workflow_event(
                    workflow_run_id,
                    "workflow:step:started",
                    f"step {step_index + 1} started: {step['agent_name']}",
                    step_index=step_index,
                )

                created = await self._run_orchestrator.create_run(
                    agent_name=str(step["agent_name"] or ""),
                    prompt=self._build_step_prompt(
                        goal_prompt=goal_prompt,
                        step_index=step_index,
                        total_steps=len(steps),
                        instruction_prompt=str(step["prompt"] or ""),
                        carryover_summaries=carryover_summaries,
                    ),
                    workspace_root=workspace_root,
                    sandbox_mode=sandbox_mode,
                    approval_policy=approval_policy,
                )
                self._active_run_ids[workflow_run_id] = created.run_id
                self._store.update_step_status(
                    workflow_run_id,
                    step_index,
                    status="running",
                    run_id=created.run_id,
                    last_event_message="prompt submitted to codex",
                )
                final_run = await self._run_orchestrator.wait_for_run(created.run_id)
                self._active_run_ids.pop(workflow_run_id, None)
                if final_run is None:
                    self._store.update_step_status(
                        workflow_run_id,
                        step_index,
                        status="failed",
                        error_message="run record missing",
                        mark_completed=True,
                    )
                    self._store.finish_workflow_run(workflow_run_id, status="failed", error_message="run record missing")
                    await self._publish_workflow_event(
                        workflow_run_id,
                        "workflow:step:failed",
                        f"step {step_index + 1} failed: run record missing",
                        step_index=step_index,
                    )
                    return

                step_events = self._run_orchestrator.list_run_events(final_run.run_id, limit=1200)
                step_summary = self._summarize_step(final_run.agent_name, step_events)
                last_event_message = step_events[-1].message if step_events else None

                if final_run.status == "completed":
                    self._store.update_step_status(
                        workflow_run_id,
                        step_index,
                        status="completed",
                        run_id=final_run.run_id,
                        summary=step_summary,
                        last_event_message=last_event_message,
                        exit_code=final_run.exit_code,
                        error_message=None,
                        mark_completed=True,
                    )
                    carryover_summaries.append(step_summary)
                    await self._publish_workflow_event(
                        workflow_run_id,
                        "workflow:step:completed",
                        f"step {step_index + 1} completed",
                        step_index=step_index,
                    )
                    continue

                failed_status = "canceled" if final_run.status == "canceled" else "failed"
                self._store.update_step_status(
                    workflow_run_id,
                    step_index,
                    status=failed_status,
                    run_id=final_run.run_id,
                    summary=step_summary,
                    last_event_message=last_event_message,
                    exit_code=final_run.exit_code,
                    error_message=final_run.error_message,
                    mark_completed=True,
                )
                self._store.finish_workflow_run(
                    workflow_run_id,
                    status=failed_status,
                    error_message=final_run.error_message,
                )
                await self._publish_workflow_event(
                    workflow_run_id,
                    "workflow:step:failed" if failed_status == "failed" else "workflow:step:canceled",
                    f"step {step_index + 1} {failed_status}",
                    step_index=step_index,
                )
                return

            self._store.update_workflow_current_step(workflow_run_id, None)
            self._store.finish_workflow_run(workflow_run_id, status="completed", error_message=None)
            await self._publish_workflow_event(workflow_run_id, "workflow:completed", "workflow completed")
        except asyncio.CancelledError:
            self._store.finish_workflow_run(workflow_run_id, status="canceled", error_message="workflow canceled by user")
            await self._publish_workflow_event(workflow_run_id, "workflow:canceled", "workflow canceled")
            raise
        except Exception as err:
            self._store.finish_workflow_run(workflow_run_id, status="failed", error_message=str(err))
            await self._publish_workflow_event(workflow_run_id, "workflow:failed", f"unexpected workflow error: {err}")
        finally:
            self._active_run_ids.pop(workflow_run_id, None)

    async def _restart_workflow_from_existing_run(
        self,
        workflow_run_id: str,
        step_index: int,
        follow_up_note: str | None = None,
    ) -> WorkflowRunRecord | None:
        source_run = self._store.get_workflow_run(workflow_run_id)
        if source_run is None:
            return None
        source_steps = self._store.list_workflow_steps(workflow_run_id)
        if step_index < 0 or step_index >= len(source_steps):
            raise ValueError("invalid step_index")

        initial_carryover_summaries = [
            str(step.summary).strip()
            for step in source_steps[:step_index]
            if step.summary and str(step.summary).strip()
        ]
        restart_steps = source_steps[step_index:]
        if not restart_steps:
            raise ValueError("no remaining step to run")

        step_inputs = [
            WorkflowStepInputModel(
                agent_name=step.agent_name,
                prompt=step.prompt,
                title=step.title,
                icon_key=step.icon_key,
                skill_name=step.skill_name,
            )
            for step in restart_steps
        ]
        cleaned_follow_up = str(follow_up_note or "").strip()
        if cleaned_follow_up and step_inputs:
            step_inputs[0].prompt = (
                f"{step_inputs[0].prompt.rstrip()}\n\n"
                f"[User Follow-up]\n{cleaned_follow_up}"
            )
        return await self.create_workflow_run(
            goal_prompt=source_run.goal_prompt,
            steps=step_inputs,
            workspace_root=source_run.workspace_root,
            sandbox_mode=source_run.sandbox_mode,
            approval_policy=source_run.approval_policy,
            initial_carryover_summaries=initial_carryover_summaries,
        )

    async def _publish_workflow_event(
        self,
        workflow_run_id: str,
        event_type: str,
        message: str,
        step_index: int | None = None,
    ) -> None:
        event = self._store.append_event(workflow_run_id, event_type=event_type, message=message, step_index=step_index)
        await self._broker.publish(
            event_type,
            {
                "workflowRunId": workflow_run_id,
                "stepIndex": step_index,
                "eventId": event.event_id,
                "eventType": event.event_type,
                "message": event.message,
                "createdAt": event.created_at.isoformat(),
            },
        )

    def _prepare_steps(self, steps: list[WorkflowStepInputModel]) -> list[dict[str, str | None]]:
        inventory = self._dashboard_service.build_inventory()
        agent_map = {agent.name: agent for agent in inventory.agents}
        if not steps:
            raise ValueError("workflow requires at least one step")

        prepared_steps: list[dict[str, str | None]] = []
        for index, step in enumerate(steps):
            target_agent = agent_map.get(step.agent_name)
            if target_agent is None:
                raise ValueError(f"agent not found: {step.agent_name}")
            if target_agent.status == "broken":
                raise ValueError(f"broken agent cannot be executed: {step.agent_name}")
            prompt = self._run_orchestrator.validate_prompt(step.prompt)
            prepared_steps.append(
                {
                    "step_index": str(index),
                    "agent_name": step.agent_name,
                    "skill_name": step.skill_name or target_agent.skill_name,
                    "icon_key": step.icon_key
                    or resolve_workflow_icon_key(target_agent.skill_name, target_agent.name, target_agent.description),
                    "title": (step.title or f"{DEFAULT_WORKFLOW_STEP_TITLE_PREFIX} {index + 1}").strip(),
                    "prompt": prompt,
                }
            )
        return prepared_steps

    def _sanitize_max_agents(self, raw_value: int | None) -> int:
        value = raw_value if raw_value is not None else self._settings.workflow_recommendation_max_agents
        if value <= 0:
            return DEFAULT_WORKFLOW_RECOMMENDATION_MAX_AGENTS
        return min(value, self._settings.workflow_recommendation_max_agents)

    def _build_agent_profiles(self, available_agents) -> list[dict[str, object]]:
        profiles: list[dict[str, object]] = []
        for agent in available_agents:
            skill_description = self._read_skill_description(agent.skill_path)
            skill_summary = self._read_skill_summary(agent.skill_path)
            agent_summary = self._read_agent_summary(agent.name)
            searchable_text = self._compact_text(
                " ".join(
                    [
                        agent.name,
                        agent.skill_name or "",
                        agent.department_label_ko,
                        agent.role_label_ko,
                        agent.short_description or "",
                        agent.description or "",
                        skill_description,
                    ]
                ),
                WORKFLOW_CATALOG_TEXT_MAX_CHARS,
            )
            profiles.append(
                {
                    "agent": agent,
                    "catalog": {
                        "name": agent.name,
                        "skillName": agent.skill_name,
                        "department": agent.department_label_ko,
                        "role": agent.role_label_ko,
                        "agentDescription": agent.short_description or agent.description,
                        "skillDescription": skill_description,
                        "skillSummary": skill_summary,
                        "agentSummary": agent_summary,
                    },
                    "searchable_text": searchable_text,
                }
            )
        return profiles

    async def _recommend_via_codex(self, goal_prompt: str, agent_profiles: list[dict[str, object]], max_agents: int) -> list[WorkflowRecommendedAgentModel]:
        catalog_items = [profile["catalog"] for profile in agent_profiles]
        agent_catalog = json.dumps(
            catalog_items,
            ensure_ascii=False,
            indent=2,
        )
        prompt = WORKFLOW_RECOMMENDATION_PROMPT_TEMPLATE.format(
            goal_prompt=goal_prompt,
            agent_catalog=agent_catalog,
            max_agents=max_agents,
        )
        try:
            return_code, stdout_text, _stderr_text = await asyncio.wait_for(
                self._run_orchestrator.execute_codex_text(
                    prompt=prompt,
                    workspace_root=self._settings.workspace_root,
                    sandbox_mode="read-only",
                    approval_policy="on-request",
                ),
                timeout=WORKFLOW_RECOMMENDATION_TIMEOUT_SECONDS,
            )
        except Exception:
            return []
        if return_code != 0:
            return []

        payload = self._extract_json_object(stdout_text)
        if payload is None:
            return []
        raw_agents = payload.get("recommendedAgents")
        if not isinstance(raw_agents, list):
            return []

        profile_map = {profile["agent"].name: profile for profile in agent_profiles}
        profile_scores = self._score_agent_profiles(goal_prompt, agent_profiles)
        recommendations: list[WorkflowRecommendedAgentModel] = []
        seen_agent_names: set[str] = set()
        for item in raw_agents:
            if not isinstance(item, dict):
                continue
            agent_name = str(item.get("agentName") or "").strip()
            profile = profile_map.get(agent_name)
            if profile is None or agent_name in seen_agent_names:
                continue
            target_agent = profile["agent"]
            if profile_scores.get(agent_name, 0) < WORKFLOW_RECOMMENDATION_MIN_SCORE:
                continue
            seen_agent_names.add(agent_name)
            recommendations.append(
                WorkflowRecommendedAgentModel(
                    agent_name=target_agent.name,
                    skill_name=target_agent.skill_name,
                    role_label_ko=target_agent.role_label_ko,
                    department_label_ko=target_agent.department_label_ko,
                    icon_key=resolve_workflow_icon_key(target_agent.skill_name, target_agent.name, target_agent.description),
                    reason=str(item.get("reason") or "").strip() or "작업 목표와의 관련성이 높습니다.",
                    default_prompt=str(item.get("defaultPrompt") or "").strip()
                    or self._build_default_prompt(goal_prompt, target_agent.role_label_ko),
                    short_description=target_agent.short_description,
                )
            )
            if len(recommendations) >= max_agents:
                break
        return recommendations

    def _complete_recommendations(
        self,
        goal_prompt: str,
        recommendations: list[WorkflowRecommendedAgentModel],
        agent_profiles: list[dict[str, object]],
        max_agents: int,
    ) -> list[WorkflowRecommendedAgentModel]:
        if len(recommendations) >= max_agents:
            return recommendations[:max_agents]

        seen_agent_names = {item.agent_name for item in recommendations}
        supplements = [
            item
            for item in self._recommend_via_heuristics(goal_prompt, agent_profiles, max_agents)
            if item.agent_name not in seen_agent_names
        ]
        return (recommendations + supplements)[:max_agents]

    def _recommend_via_heuristics(self, goal_prompt: str, agent_profiles: list[dict[str, object]], max_agents: int) -> list[WorkflowRecommendedAgentModel]:
        profile_scores = self._score_agent_profiles(goal_prompt, agent_profiles)
        ranked_profiles = sorted(
            agent_profiles,
            key=lambda profile: profile_scores.get(profile["agent"].name, 0),
            reverse=True,
        )
        top_score = profile_scores.get(ranked_profiles[0]["agent"].name, 0) if ranked_profiles else 0
        cutoff_score = max(WORKFLOW_RECOMMENDATION_MIN_SCORE, int(top_score * WORKFLOW_RECOMMENDATION_RELATIVE_SCORE_RATIO))
        selected = [
            profile
            for profile in ranked_profiles
            if profile_scores.get(profile["agent"].name, 0) >= cutoff_score
        ][:max_agents]
        if not selected:
            selected = ranked_profiles[: min(3, len(ranked_profiles))]
        return [
            WorkflowRecommendedAgentModel(
                agent_name=agent.name,
                skill_name=agent.skill_name,
                role_label_ko=agent.role_label_ko,
                department_label_ko=agent.department_label_ko,
                icon_key=resolve_workflow_icon_key(agent.skill_name, agent.name, agent.description),
                reason=self._build_heuristic_reason(goal_prompt, profile),
                default_prompt=self._build_default_prompt(goal_prompt, agent.role_label_ko),
                short_description=agent.short_description,
            )
            for profile in selected
            for agent in [profile["agent"]]
        ]

    def _read_skill_summary(self, skill_path: str | None) -> str:
        if not skill_path:
            return ""
        path = Path(skill_path).expanduser()
        if not path.exists() or not path.is_file():
            return ""
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        frontmatter_description = self._extract_frontmatter_description(text)
        body = self._strip_frontmatter(text)
        headings_and_intro = self._extract_headings_and_intro(body)
        return self._compact_text(" ".join([frontmatter_description, headings_and_intro]), WORKFLOW_SKILL_SUMMARY_MAX_CHARS)

    def _read_skill_description(self, skill_path: str | None) -> str:
        if not skill_path:
            return ""
        path = Path(skill_path).expanduser()
        if not path.exists() or not path.is_file():
            return ""
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return self._extract_frontmatter_description(text)

    def _read_agent_summary(self, agent_name: str) -> str:
        path = self._settings.agents_root / agent_name / "agent.md"
        if not path.exists() or not path.is_file():
            return ""
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return self._compact_text(text, WORKFLOW_AGENT_SUMMARY_MAX_CHARS)

    @staticmethod
    def _extract_frontmatter_description(text: str) -> str:
        match = re.match(r"^---\s*\n(.*?)\n---\s*", text, re.DOTALL)
        if not match:
            return ""
        frontmatter = match.group(1)
        description_match = re.search(r"^description:\s*(.+)$", frontmatter, re.MULTILINE)
        if not description_match:
            return ""
        return description_match.group(1).strip().strip('"').strip("'")

    @staticmethod
    def _strip_frontmatter(text: str) -> str:
        without_frontmatter = re.sub(r"^---\s*\n.*?\n---\s*", "", text, count=1, flags=re.DOTALL)
        return re.split(r"\n##\s+파일 입력 유효성 체크\b", without_frontmatter, maxsplit=1)[0]

    @classmethod
    def _extract_headings_and_intro(cls, text: str) -> str:
        lines = []
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#") or line.startswith("- ") or line.startswith("1. "):
                lines.append(line)
            elif len(lines) < 8:
                lines.append(line)
            if len(" ".join(lines)) >= WORKFLOW_SKILL_SUMMARY_MAX_CHARS:
                break
        return cls._compact_text(" ".join(lines), WORKFLOW_SKILL_SUMMARY_MAX_CHARS)

    @staticmethod
    def _compact_text(text: str, max_chars: int) -> str:
        compact = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(compact) <= max_chars:
            return compact
        return f"{compact[: max_chars - 3].rstrip()}..."

    def _build_heuristic_reason(self, goal_prompt: str, profile: dict[str, object]) -> str:
        catalog = profile["catalog"]
        skill_name = str(catalog.get("skillName") or "")
        score = self._score_agent(goal_prompt, str(profile["searchable_text"]))
        if score > 0 and skill_name:
            return f"목표 문장과 `{skill_name}` 스킬 설명의 관련도가 높습니다."
        return "목표 문장과 에이전트 역할/스킬 설명을 기준으로 보조 후보로 선택했습니다."

    @classmethod
    def _score_agent_profiles(cls, goal_prompt: str, agent_profiles: list[dict[str, object]]) -> dict[str, int]:
        goal_tokens = cls._text_tokens(goal_prompt)
        if not goal_tokens:
            return {profile["agent"].name: 0 for profile in agent_profiles}

        profile_token_sets: dict[str, set[str]] = {}
        document_frequency: Counter[str] = Counter()
        for profile in agent_profiles:
            agent_name = profile["agent"].name
            tokens = set(cls._text_tokens(str(profile["searchable_text"])))
            profile_token_sets[agent_name] = tokens
            document_frequency.update(tokens)

        total_profiles = max(1, len(agent_profiles))
        phrases = cls._goal_phrases(goal_tokens)
        scores: dict[str, int] = {}
        for profile in agent_profiles:
            agent = profile["agent"]
            agent_name = agent.name
            haystack = str(profile["searchable_text"]).lower()
            token_set = profile_token_sets.get(agent_name, set())
            score = 0
            for token in goal_tokens:
                df = max(1, document_frequency.get(token, 1))
                if df > max(3, int(total_profiles * 0.35)):
                    continue
                if token not in token_set:
                    continue
                rarity_weight = max(2, min(12, int((total_profiles / df) * 2)))
                score += rarity_weight
            for token in goal_tokens:
                if len(token) < 3:
                    continue
                if any(item != token and (item.startswith(token) or token.startswith(item)) for item in token_set):
                    score += 8
            for phrase in phrases:
                if phrase in haystack:
                    score += 5
            skill_name = str(agent.skill_name or "").lower()
            if skill_name:
                skill_tokens = set(cls._text_tokens(skill_name.replace("-", " ")))
                score += 3 * len(skill_tokens.intersection(goal_tokens))
            scores[agent_name] = score
        return scores

    @staticmethod
    def _extract_json_object(text: str) -> dict[str, object] | None:
        if not text.strip():
            return None
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                return None
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None

    @staticmethod
    def _score_agent(goal_prompt: str, *values: str | None) -> int:
        goal_tokens = WorkflowOrchestrator._text_tokens(goal_prompt)
        haystack = " ".join(str(value or "").lower() for value in values)
        score = 0
        for token in goal_tokens:
            if len(token) >= 2 and token in haystack:
                score += 3
        for phrase in WorkflowOrchestrator._goal_phrases(goal_tokens):
            if phrase in haystack:
                score += 5
        return score

    @staticmethod
    def _text_tokens(text: str) -> list[str]:
        return [token for token in re.split(r"[^0-9A-Za-z가-힣_-]+", str(text or "").lower()) if len(token) >= 2]

    @staticmethod
    def _goal_phrases(tokens: list[str]) -> list[str]:
        phrases: list[str] = []
        for size in (3, 2):
            if len(tokens) < size:
                continue
            for index in range(0, len(tokens) - size + 1):
                phrases.append(" ".join(tokens[index : index + size]))
        return phrases

    @staticmethod
    def _build_default_prompt(goal_prompt: str, role_label_ko: str) -> str:
        return f"전체 목표는 '{goal_prompt}' 입니다. {role_label_ko} 관점에서 현재 단계에서 필요한 작업만 수행하고, 다음 단계에 넘길 핵심 결과를 분명히 정리해줘."

    @staticmethod
    def _build_step_prompt(
        goal_prompt: str,
        step_index: int,
        total_steps: int,
        instruction_prompt: str,
        carryover_summaries: list[str],
    ) -> str:
        previous_context = "\n".join([f"- {item}" for item in carryover_summaries[-4:]]) or "- 이전 단계 요약 없음"
        return (
            "[Workflow Context]\n"
            f"Workflow Goal: {goal_prompt}\n"
            f"Current Step: {step_index + 1} / {total_steps}\n"
            "Previous Step Summaries:\n"
            f"{previous_context}\n\n"
            "[Current Step Instruction]\n"
            f"{instruction_prompt}"
        )

    @staticmethod
    def _summarize_step(agent_name: str, step_events) -> str:
        important_messages = [str(event.message).strip() for event in step_events if str(event.message or "").strip()]
        if not important_messages:
            return f"{agent_name} 단계가 종료되었습니다."
        tail = important_messages[-3:]
        joined = " / ".join(tail)
        compact = re.sub(r"\s+", " ", joined).strip()
        if len(compact) > WORKFLOW_STEP_SUMMARY_MAX_CHARS:
            compact = f"{compact[: WORKFLOW_STEP_SUMMARY_MAX_CHARS - 3]}..."
        return compact or f"{agent_name} 단계가 종료되었습니다."
