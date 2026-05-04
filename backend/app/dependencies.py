from typing import Annotated
from fastapi import Depends, Header, HTTPException, status
from app.config import SETTINGS, AppSettings
from app.services.config_reader import CodexConfigReader
from app.services.dashboard_service import DashboardService
from app.services.event_stream import EventBroker
from app.services.run_orchestrator import RunOrchestrator
from app.services.run_store import RunStore
from app.services.workflow_orchestrator import WorkflowOrchestrator
from app.services.workflow_store import WorkflowStore
from app.services.skill_agent_backup_service import SkillAgentBackupService
from app.services.inspector_service import AgentInspectorService
import sqlite3

# Singletons (initialized in main.py)
_reader = CodexConfigReader(SETTINGS)
_service = DashboardService(_reader, SETTINGS)
_broker = EventBroker()

try:
    _run_store = RunStore(SETTINGS.run_db_path)
except sqlite3.OperationalError:
    _run_store = RunStore(SETTINGS.fallback_run_db_path)

_run_orchestrator = RunOrchestrator(SETTINGS, _broker, _run_store)

try:
    _workflow_store = WorkflowStore(SETTINGS.run_db_path)
except sqlite3.OperationalError:
    _workflow_store = WorkflowStore(SETTINGS.fallback_run_db_path)

_workflow_orchestrator = WorkflowOrchestrator(SETTINGS, _service, _broker, _run_orchestrator, _workflow_store)
_backup_service = SkillAgentBackupService(SETTINGS)
_inspector_service = AgentInspectorService(SETTINGS)

def get_settings() -> AppSettings:
    return SETTINGS

def get_dashboard_service() -> DashboardService:
    return _service

def get_event_broker() -> EventBroker:
    return _broker

def get_run_orchestrator() -> RunOrchestrator:
    return _run_orchestrator

def get_workflow_orchestrator() -> WorkflowOrchestrator:
    return _workflow_orchestrator

def get_backup_service() -> SkillAgentBackupService:
    return _backup_service

def get_inspector_service() -> AgentInspectorService:
    return _inspector_service

def verify_write_access(x_api_token: Annotated[str | None, Header(alias="X-API-Token")] = None):
    write_api_token = SETTINGS.write_api_token
    if not write_api_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="write api disabled")
    if x_api_token != write_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid write api token")
