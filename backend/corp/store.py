"""corp.store — SQLite 저장소(runs·jobs·approvals·ledger). stdlib만.

왜 sqlite인가: 단일 사용자 로컬 서버 — 데몬 없이 파일 하나로 감사 추적이 된다.
runs(사번/실행) · jobs(칸반 업무) · approvals(인간 결재) · ledger(토큰 장부).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

from . import config

_lock = threading.Lock()
_db: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _db
    if _db is None:
        config.DATA.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(str(config.DATA / "corp.sqlite"), check_same_thread=False)
        _db.row_factory = sqlite3.Row
        _db.executescript("""
        CREATE TABLE IF NOT EXISTS runs(
          id TEXT PRIMARY KEY, agent TEXT, engine TEXT, cwd TEXT,
          status TEXT DEFAULT 'queued', exit_code INTEGER,
          error TEXT, tokens INTEGER DEFAULT 0,
          created REAL, finished REAL);
        CREATE TABLE IF NOT EXISTS events(
          seq INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT, type TEXT,
          message TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, title TEXT, body TEXT DEFAULT '',
          duty TEXT DEFAULT 'coder', skill TEXT DEFAULT '',
          status TEXT DEFAULT 'queued', run TEXT DEFAULT '',
          created REAL, updated REAL);
        CREATE TABLE IF NOT EXISTS approvals(
          id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, verdict TEXT,
          note TEXT DEFAULT '', created REAL);
        CREATE TABLE IF NOT EXISTS ledger(
          day TEXT, agent TEXT, tokens INTEGER,
          PRIMARY KEY(day, agent));
        """)
        cols = {r["name"] for r in _db.execute("PRAGMA table_info(runs)")}
        if "model" not in cols:
            _db.execute("ALTER TABLE runs ADD COLUMN model TEXT DEFAULT ''")
        jcols = {r["name"] for r in _db.execute("PRAGMA table_info(jobs)")}
        if "model" not in jcols:
            _db.execute("ALTER TABLE jobs ADD COLUMN model TEXT DEFAULT ''")
        if "note" not in jcols:
            _db.execute("ALTER TABLE jobs ADD COLUMN note TEXT DEFAULT ''")
    return _db


def now() -> float:
    return time.time()


def day() -> str:
    return time.strftime("%Y-%m-%d")


def add_run(rid: str, agent: str, engine: str, cwd: str) -> None:
    with _lock:
        db().execute("INSERT INTO runs(id,agent,engine,cwd,created) VALUES(?,?,?,?,?)",
                     (rid, agent, engine, cwd, now()))
        db().commit()


def set_run(rid: str, **kw) -> None:
    with _lock:
        cols = ", ".join(f"{k}=?" for k in kw)
        db().execute(f"UPDATE runs SET {cols} WHERE id=?", (*kw.values(), rid))
        db().commit()


def get_run(rid: str) -> dict | None:
    row = db().execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
    return dict(row) if row else None


def list_runs(limit: int = 30) -> list[dict]:
    rows = db().execute("SELECT * FROM runs ORDER BY created DESC LIMIT ?",
                        (max(1, min(limit, 200)),)).fetchall()
    return [dict(r) for r in rows]


def add_event(run: str, etype: str, message: str) -> None:
    with _lock:
        db().execute("INSERT INTO events(run,type,message,created) VALUES(?,?,?,?)",
                     (run, etype, (message or "")[:2000], now()))
        db().commit()


def run_events(rid: str, limit: int = 500) -> list[dict]:
    rows = db().execute("SELECT * FROM events WHERE run=? ORDER BY seq ASC LIMIT ?",
                        (rid, max(1, min(limit, 2000)))).fetchall()
    return [dict(r) for r in rows]


def add_job(jid: str, title: str, body: str, duty: str, skill: str,
            model: str = "") -> None:
    with _lock:
        db().execute("INSERT INTO jobs(id,title,body,duty,skill,model,created,updated)"
                     " VALUES(?,?,?,?,?,?,?,?)",
                     (jid, title, body, duty, skill, model[:80], now(), now()))
        db().commit()


def set_job(jid: str, **kw) -> None:
    kw["updated"] = now()
    with _lock:
        cols = ", ".join(f"{k}=?" for k in kw)
        db().execute(f"UPDATE jobs SET {cols} WHERE id=?", (*kw.values(), jid))
        db().commit()


def list_jobs(status: str | None = None) -> list[dict]:
    if status:
        rows = db().execute("SELECT * FROM jobs WHERE status=? ORDER BY created",
                            (status,)).fetchall()
    else:
        rows = db().execute("SELECT * FROM jobs ORDER BY created").fetchall()
    return [dict(r) for r in rows]


def job_by_run(rid: str) -> dict | None:
    row = db().execute("SELECT * FROM jobs WHERE run=?", (rid,)).fetchone()
    return dict(row) if row else None


def add_approval(job: str, verdict: str, note: str = "") -> None:
    with _lock:
        db().execute("INSERT INTO approvals(job,verdict,note,created) VALUES(?,?,?,?)",
                     (job, verdict, note[:500], now()))
        db().commit()


def charge(agent: str, tokens: int) -> int:
    """장부 과금 후 오늘 합계 반환."""
    with _lock:
        db().execute("INSERT INTO ledger(day,agent,tokens) VALUES(?,?,?)"
                     " ON CONFLICT(day,agent) DO UPDATE SET tokens=tokens+?",
                     (day(), agent, tokens, tokens))
        db().commit()
        row = db().execute("SELECT SUM(tokens) t FROM ledger WHERE day=?",
                           (day(),)).fetchone()
        return int(row["t"] or 0)


def spent_today() -> int:
    row = db().execute("SELECT SUM(tokens) t FROM ledger WHERE day=?", (day(),)).fetchone()
    return int(row["t"] or 0)
