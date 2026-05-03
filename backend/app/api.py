from __future__ import annotations

from fastapi import APIRouter

from app.api_routes import (
    ApiContext,
    register_config_routes,
    register_event_routes,
    register_inspector_routes,
    register_maintenance_routes,
    register_read_routes,
    register_run_routes,
    register_workflow_routes,
)
from app.config import AppSettings
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator
from app.services.skill_agent_backup_service import SkillAgentBackupService
from app.services.workflow_orchestrator import WorkflowOrchestrator
from app.services.inspector_service import AgentInspectorService


def build_api_router(
    service: DashboardService,
    broker: EventBroker,
    run_orchestrator: RunOrchestrator,
    workflow_orchestrator: WorkflowOrchestrator,
    write_api_token: str | None,
    settings: AppSettings,
) -> APIRouter:
    """
    summary: 프런트엔드가 사용하는 읽기/실행 API 라우터를 조립한다.
    purpose/context: 읽기, 인스펙터, 실행, 백업, 워크플로, SSE 관심사를 분리 등록한다.
    input: 대시보드/실행/워크플로 서비스와 공통 설정을 받는다.
    output: FastAPI에 연결 가능한 APIRouter 인스턴스를 반환한다.
    rules/constraints: 쓰기 API는 명시적 토큰 설정이 있을 때만 활성화한다.
    failure behavior: 각 세부 라우터가 도메인 예외를 적절한 HTTP 상태로 변환한다.
    """

    router = APIRouter(prefix="/api")
    ctx = ApiContext(
        router=router,
        service=service,
        broker=broker,
        run_orchestrator=run_orchestrator,
        workflow_orchestrator=workflow_orchestrator,
        settings=settings,
        write_api_token=write_api_token,
        backup_service=SkillAgentBackupService(settings),
        inspector_service=AgentInspectorService(settings),
    )
    register_read_routes(ctx)
    register_inspector_routes(ctx)
    register_config_routes(ctx)
    register_maintenance_routes(ctx)
    register_run_routes(ctx)
    register_workflow_routes(ctx)
    register_event_routes(ctx)
    return router
