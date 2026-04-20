from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class EventMessage:
    """
    summary: 프런트엔드로 전달할 실시간 이벤트를 표현한다.
    purpose/context: SSE 채널에서 타입과 발생 시각이 일관된 메시지를 보내기 위한 경계 객체다.
    input: 이벤트 타입과 추가 payload를 받는다.
    output: JSON 직렬화 가능한 사전으로 변환된다.
    rules/constraints: 민감한 로컬 정보는 payload에 넣지 않는다.
    failure behavior: 직렬화 불가 값이 들어오면 상위 publish 호출에서 정제해야 한다.
    """

    event_type: str
    payload: dict[str, object]
    created_at: datetime

    def to_sse_chunk(self) -> str:
        body = json.dumps(
            {
                "type": self.event_type,
                "payload": self.payload,
                "createdAt": self.created_at.isoformat(),
            },
            ensure_ascii=False,
        )
        return f"data: {body}\n\n"


class EventBroker:
    """
    summary: 서버 내부 이벤트를 다중 SSE 구독자에게 전달한다.
    purpose/context: watchdog와 수동 갱신 이벤트를 프런트엔드가 실시간으로 반영할 수 있게 한다.
    input: publish 호출로 이벤트를 받고, subscribe 호출로 소비자 큐를 반환한다.
    output: 각 구독자에게 asyncio.Queue 기반 메시지 스트림을 제공한다.
    rules/constraints: 느린 소비자가 전체 브로커를 막지 않도록 큐 단위로 분리한다.
    failure behavior: 큐 적재 실패나 취소는 해당 구독자만 정리하고 다른 구독자는 유지한다.
    """

    def __init__(self, queue_maxsize: int = 200) -> None:
        self._queue_maxsize = max(1, queue_maxsize)
        self._subscribers: set[asyncio.Queue[EventMessage]] = set()

    def subscribe(self) -> asyncio.Queue[EventMessage]:
        queue: asyncio.Queue[EventMessage] = asyncio.Queue(maxsize=self._queue_maxsize)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[EventMessage]) -> None:
        self._subscribers.discard(queue)

    async def publish(self, event_type: str, payload: dict[str, object] | None = None) -> None:
        message = EventMessage(
            event_type=event_type,
            payload=payload or {},
            created_at=datetime.now(tz=timezone.utc),
        )
        stale_queues: list[asyncio.Queue[EventMessage]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                stale_queues.append(queue)
        for queue in stale_queues:
            self.unsubscribe(queue)
