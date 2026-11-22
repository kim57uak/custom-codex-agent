"""corp.executor — 엔진 무관 격리 실행기. 세마포어·worktree·타임아웃·장부.

왜 이 파일인가: 멀티 하위 에이전트 병렬 집행(⑥ 격리실행실)의 심장이다.
run마다 git worktree 격리실 배정 → 테스트 통과분만 본점 merge(현재는 격리만,
merge는 인간 결재). 출력은 전부 security.strip_output을 거쳐 저장·중계.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import uuid
from pathlib import Path

from . import config, engines, security, store

_sema = asyncio.Semaphore(max(1, config.CONCURRENCY))
_procs: dict[str, asyncio.subprocess.Process] = {}
_tasks: dict[str, asyncio.Task] = {}


def _broadcast_sync(run: str, etype: str, message: str, agent: str = "") -> None:
    store.add_event(run, etype, message)
    try:
        from .events import push
        if not agent:
            r = store.get_run(run)
            if r:
                agent = r.get("agent", "")
        push(run, etype, message, agent=agent)
    except Exception:
        pass


def _iso_dir(rid: str, cwd: Path) -> tuple[Path, bool]:
    """격리실 배정. git worktree 가능하면 worktree, 아니면 하위 디렉터리."""
    if not config.ENABLE_WORKTREE:
        d = config.WORKTREE_ROOT / rid
        d.mkdir(parents=True, exist_ok=True)
        return d, False
    try:
        r = subprocess.run(["git", "-C", str(cwd), "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True, timeout=10)
        if r.stdout.strip() == "true":
            d = config.WORKTREE_ROOT / rid
            config.WORKTREE_ROOT.mkdir(parents=True, exist_ok=True)
            w = subprocess.run(["git", "-C", str(cwd), "worktree", "add", "--detach", str(d)],
                               capture_output=True, text=True, timeout=60)
            if w.returncode == 0:
                return d, True
    except Exception:
        pass
    d = config.WORKTREE_ROOT / rid
    d.mkdir(parents=True, exist_ok=True)
    return d, False


def _release_iso(rid: str, cwd: Path, is_wt: bool) -> None:
    try:
        if is_wt:
            subprocess.run(["git", "-C", str(cwd), "worktree", "remove", "--force",
                            str(config.WORKTREE_ROOT / rid)],
                           capture_output=True, timeout=60)
        else:
            shutil.rmtree(config.WORKTREE_ROOT / rid, ignore_errors=True)
    except Exception:
        pass


async def _pump(stream, run: str, etype: str, acc: list) -> None:
    try:
        while True:
            chunk = await stream.read(65536)
            if not chunk:
                break
            text = security.strip_output(chunk.decode("utf-8", errors="replace"), limit=65536)
            acc.append(text)
            _broadcast_sync(run, etype, text[-2000:])
    except Exception:
        pass


async def launch(agent: str, engine: str, prompt: str, cwd: str | None,
                 model: str | None = None) -> str:
    """실행 접수 → 격리실에서 비동기 구동. run_id(사번) 즉시 반환."""
    clean = security.check_prompt(prompt)
    root = security.jail(cwd)
    spec = engines.resolve(engine)
    if store.spent_today() >= config.DAILY_TOKEN_BUDGET:
        raise PermissionError("daily token budget exhausted")
    rid = uuid.uuid4().hex[:12]
    iso, is_wt = _iso_dir(rid, root)
    # 결과물 디렉터리 — 격리실 해제 후에도 남는다 (UI·승인 심사용)
    resdir = config.DATA / "results" / rid
    resdir.mkdir(parents=True, exist_ok=True)
    clean = (clean + f"\n[DELIVERABLES] 결과 파일은 반드시 {resdir}/ 에 저장하라. "
             "격리실 내 outputs/는 실행 종료 시 삭제된다.")
    store.add_run(rid, agent, engine, str(iso))
    if model:
        store.set_run(rid, model=model[:80])
    _broadcast_sync(rid, "run:queued", f"agent={agent} engine={engine}"
                    + (f" model={model}" if model else "") + f" iso={iso.name}")
    task = asyncio.create_task(_drive(rid, agent, spec, clean, iso, root, is_wt, model,
                                       resdir))
    _tasks[rid] = task
    task.add_done_callback(lambda t, r=rid: _tasks.pop(r, None))
    return rid


async def _drive(rid: str, agent: str, spec, prompt: str,
                 iso: Path, root: Path, is_wt: bool, model: str | None = None,
                 resdir: Path | None = None) -> None:
    try:
        argv, stdin_data = engines.build_command(spec, prompt, model)
    except engines.EngineError as err:
        store.set_run(rid, status="failed", error=str(err)[:200])
        _broadcast_sync(rid, "run:failed", str(err)[:200])
        _settle_job(rid)
        _release_iso(rid, root, is_wt)
        return
    try:
        async with _sema:
            store.set_run(rid, status="running")
            _broadcast_sync(rid, "run:started", f"engine={spec.name}", agent=agent)
            proc = await asyncio.create_subprocess_exec(
                *argv, cwd=str(iso), env=security.child_env(),
                stdin=(asyncio.subprocess.PIPE if stdin_data else asyncio.subprocess.DEVNULL),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            _procs[rid] = proc
            if stdin_data:
                try:
                    proc.stdin.write(stdin_data)
                    await proc.stdin.drain()
                finally:
                    proc.stdin.close()
            out: list[str] = []
            await asyncio.gather(
                _pump(proc.stdout, rid, "run:stdout", out),
                _pump(proc.stderr, rid, "run:stderr", out))
            try:
                await asyncio.wait_for(proc.wait(), timeout=config.RUN_TIMEOUT_S)
            except asyncio.TimeoutError:
                proc.terminate()
                store.set_run(rid, status="failed", error="timeout")
                _broadcast_sync(rid, "run:failed", "timeout")
                return
            full = "".join(out)
            tokens = security.estimate_tokens(prompt + full)
            store.set_run(rid, tokens=tokens,
                          finished=__import__("time").time())
            store.charge(agent, tokens)

            # 실행 출력 및 산출물 보존 (격리실 해제 전)
            if resdir is not None:
                try:
                    (resdir / "output.txt").write_text(full, encoding="utf-8")
                except Exception:
                    pass
                iso_outputs = iso / "outputs"
                if iso_outputs.is_dir():
                    try:
                        for f in iso_outputs.rglob("*"):
                            if f.is_file():
                                rel = f.relative_to(iso_outputs)
                                dest = resdir / rel
                                dest.parent.mkdir(parents=True, exist_ok=True)
                                shutil.copy2(f, dest)
                    except Exception:
                        pass

            if proc.returncode == 0:
                store.set_run(rid, status="completed", exit_code=0)
                _broadcast_sync(rid, "run:completed", f"tokens~{tokens}")
            else:
                store.set_run(rid, status="failed", exit_code=proc.returncode,
                              error=f"{spec.name} exit={proc.returncode}")
                _broadcast_sync(rid, "run:failed", f"exit={proc.returncode}")
    except Exception as err:
        store.set_run(rid, status="failed", error=f"{type(err).__name__}")
        _broadcast_sync(rid, "run:failed", type(err).__name__)
    finally:
        _procs.pop(rid, None)
        _release_iso(rid, root, is_wt)
        _settle_job(rid)


def _settle_job(rid: str) -> None:
    """자동 정산 — run이 끝나면 묶인 job을 review/failed로 넘긴다.
    수동 정산 버튼도 유지(재시도·예외용). 여기서 멈추면 job이 영원히 running이다."""
    try:
        job = store.job_by_run(rid)
        if job and job["status"] == "running":
            rec = store.get_run(rid)
            nxt = "review" if rec and rec["status"] == "completed" else "failed"
            store.set_job(job["id"], status=nxt)
            _broadcast_sync(rid, "run:review" if nxt == "review" else "run:failed",
                            f"job {job['id']} auto-settled to {nxt}")
    except Exception:
        pass


async def cancel(rid: str) -> bool:
    proc = _procs.get(rid)
    if proc is not None and proc.returncode is None:
        proc.terminate()
    task = _tasks.get(rid)
    if task is not None and not task.done():
        task.cancel()
    rec = store.get_run(rid)
    if rec and rec["status"] not in ("completed", "failed", "canceled"):
        store.set_run(rid, status="canceled")
        _broadcast_sync(rid, "run:canceled", "by user")
        return True
    return False


async def wait(rid: str) -> dict | None:
    task = _tasks.get(rid)
    if task is not None:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    return store.get_run(rid)
