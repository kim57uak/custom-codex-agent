"""corp.events — SSE 브로커. 단일 asyncio 루프 내 구독 배포."""
from __future__ import annotations

import asyncio
import json
import time

_subs: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subs.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subs.discard(q)


def push(run: str, etype: str, message: str, agent: str = "") -> None:
    payload = {"type": etype, "payload": {"runId": run, "agent": agent, "message": message},
               "createdAt": time.time()}
    dead = []
    for q in _subs:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subs.discard(q)


def sse(payload: dict) -> str:
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
