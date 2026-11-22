"""corp.api — 단일 API 라우터. GET 읽기 전용 개방, POST 쓰기는 토큰 필수.

왜 이 파일인가: 구앱의 쓰기 엔드포인트는 토큰이 없으면 503 장애 모드였다.
신앱은 토큰을 첫 기동에 생성(0600)하고, 없으면 쓸 수 있게 둔다 — 기본 거부.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import config, engines, executor, registry, security, store, supervisor
from .events import sse, subscribe, unsubscribe

router = APIRouter(prefix="/api")
_token = config.write_token()


def _write(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> None:
    if x_api_token != _token:
        raise HTTPException(status_code=401, detail="invalid write token")


class JobIn(BaseModel):
    title: str
    body: str = ""
    duty: str = "coder"
    skill: str = ""
    model: str = ""


class RunIn(BaseModel):
    agent: str = "supervisor"
    engine: str = "opencode"
    model: str | None = None
    prompt: str
    cwd: str | None = None


class ApproveIn(BaseModel):
    verdict: str
    note: str = ""


@router.get("/health")
def health() -> dict:
    return {"ok": True, "engines": engines.available(),
            "concurrency": config.CONCURRENCY,
            "spent_today": store.spent_today(), "budget": config.DAILY_TOKEN_BUDGET}


@router.get("/inventory")
def inventory() -> dict:
    rows = registry.roster()
    return {"count": len(rows), "agents": [
        {**r, "record": registry.record(r["name"])} for r in rows]}


@router.get("/runs")
def runs(limit: int = Query(30, le=200)) -> dict:
    return {"runs": store.list_runs(limit)}


@router.get("/runs/{rid}")
def run_one(rid: str) -> dict:
    rec = store.get_run(rid)
    if not rec:
        raise HTTPException(status_code=404, detail="no such run")
    return rec


@router.get("/runs/{rid}/events")
def run_events(rid: str, limit: int = Query(500, le=2000)) -> dict:
    return {"run": rid, "events": store.run_events(rid, limit)}


@router.get("/runs/{rid}/details")
def run_details(rid: str) -> dict:
    rec = store.get_run(rid)
    if not rec:
        raise HTTPException(status_code=404, detail="no such run")
    job = store.job_by_run(rid)
    resdir = config.DATA / "results" / rid
    output_text = ""
    output_file = resdir / "output.txt"
    if output_file.is_file():
        try:
            output_text = output_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass

    # output.txt가 아직 없거나 비어있는 경우 최근 run:stdout 이벤트들에서 추출
    events = store.run_events(rid, limit=500)
    if not output_text:
        stdout_parts = [e["message"] for e in events if e["type"] in ("run:stdout", "run:stderr")]
        if stdout_parts:
            output_text = "\n".join(stdout_parts)

    files = []
    if resdir.is_dir():
        for f in sorted(resdir.rglob("*")):
            if f.is_file() and f.name != "output.txt":
                rel = str(f.relative_to(resdir))
                files.append({
                    "name": rel,
                    "size": f.stat().st_size,
                    "url": f"/api/runs/{rid}/files/{rel}",
                })

    return {
        "run": rec,
        "job": job,
        "output": output_text[-120000:],
        "files": files,
        "events": events,
    }


@router.get("/runs/{rid}/files/{filename:path}")
def get_run_file(rid: str, filename: str):
    resdir = config.DATA / "results" / rid
    # 경로 탐색(traversal) 방지
    try:
        target = (resdir / filename).resolve()
        if not str(target).startswith(str(resdir.resolve())):
            raise HTTPException(status_code=403, detail="access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="invalid path")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(target, filename=target.name)


@router.post("/runs", dependencies=[Depends(_write)])
async def create_run(body: RunIn) -> dict:
    try:
        rid = await executor.launch(body.agent, body.engine, body.prompt, body.cwd,
                                    body.model)
    except (ValueError, PermissionError, engines.EngineError) as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"run": rid}


@router.post("/runs/{rid}/cancel", dependencies=[Depends(_write)])
async def cancel_run(rid: str) -> dict:
    return {"run": rid, "canceled": await executor.cancel(rid)}


@router.get("/jobs")
def jobs(status: str | None = None) -> dict:
    rows = store.list_jobs(status)
    return {"count": len(rows), "jobs": rows}


@router.post("/jobs", dependencies=[Depends(_write)])
def create_job(body: JobIn) -> dict:
    try:
        jid = supervisor.create_job(body.title, body.body, body.duty, body.skill,
                                    body.model)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"job": jid}


@router.post("/jobs/{jid}/dispatch", dependencies=[Depends(_write)])
async def dispatch_job(jid: str, engine: str = "opencode",
                       model: str | None = None) -> dict:
    try:
        rid = await supervisor.dispatch(jid, engine, model)
    except (KeyError, ValueError, PermissionError, engines.EngineError) as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"job": jid, "run": rid}


@router.post("/jobs/{jid}/settle", dependencies=[Depends(_write)])
async def settle_job(jid: str) -> dict:
    try:
        return {"job": jid, "status": await supervisor.settle(jid)}
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err))


@router.post("/jobs/{jid}/approve", dependencies=[Depends(_write)])
def approve_job(jid: str, body: ApproveIn) -> dict:
    try:
        return {"job": jid, "verdict": supervisor.approve(jid, body.verdict, body.note)}
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/skills/{name}/retire", dependencies=[Depends(_write)])
def retire_skill(name: str) -> dict:
    return {"skill": name, "retired": registry.retire(name)}


@router.post("/skills/{name}/rehire", dependencies=[Depends(_write)])
def rehire_skill(name: str) -> dict:
    return {"skill": name, "rehired": registry.rehire(name)}


@router.get("/a2a/cards")
def a2a_cards() -> dict:
    cards = [c for r in registry.roster()
             if (c := registry.card(r["name"])) is not None]
    return {"count": len(cards), "cards": cards}


@router.get("/models")
def models() -> dict:
    lst = engines.list_models()
    return {"count": len(lst), "models": lst[:300],
            "pinned": ["opencode-go/muse-spark-1.3-contributor"]}


@router.get("/events")
async def stream_events():
    from fastapi.responses import StreamingResponse
    queue = subscribe()

    async def gen():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15)
                    yield sse(msg)
                except asyncio.TimeoutError:
                    yield sse({"type": "heartbeat", "payload": {}, "createdAt": None})
        finally:
            unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream")
