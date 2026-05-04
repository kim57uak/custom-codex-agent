from __future__ import annotations

from fastapi import APIRouter

from app.api_routes import (
    register_config_routes,
    register_event_routes,
    register_inspector_routes,
    register_maintenance_routes,
    register_read_routes,
    register_run_routes,
    register_workflow_routes,
)


def build_api_router() -> APIRouter:
    """
    summary: 프런트엔드가 사용하는 읽기/실행 API 라우터를 조립한다.
    purpose/context: 읽기, 인스펙터, 실행, 백업, 워크플로, SSE 관심사를 분리 등록한다.
    input: 없음 (FastAPI Depends를 통해 서비스 주입).
    output: FastAPI에 연결 가능한 APIRouter 인스턴스를 반환한다.
    rules/constraints: 의존성 주입은 각 라우터 함수 레벨에서 수행된다.
    failure behavior: 각 세부 라우터가 도메인 예외를 적절한 HTTP 상태로 변환한다.
    """

    router = APIRouter(prefix="/api")
    
    register_read_routes(router)
    register_inspector_routes(router)
    register_config_routes(router)
    register_maintenance_routes(router)
    register_run_routes(router)
    register_workflow_routes(router)
    register_event_routes(router)
    
    return router
