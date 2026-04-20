from __future__ import annotations

import asyncio
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from app.services.event_stream import EventBroker


WATCHABLE_FILE_NAMES = {"config.toml", "history.jsonl", "state_5.sqlite", "logs_2.sqlite", "config.json", "SKILL.md"}


class _CodexWatchHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop, broker: EventBroker) -> None:
        self._loop = loop
        self._broker = broker

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.name not in WATCHABLE_FILE_NAMES:
            return
        asyncio.run_coroutine_threadsafe(
            self._broker.publish(
                "config:changed",
                {
                    "path": str(path),
                    "name": path.name,
                    "eventType": event.event_type,
                },
            ),
            self._loop,
        )


class CodexFileWatcher:
    """
    summary: Codex 홈 경로를 감시하고 변경 이벤트를 SSE 브로커에 전달한다.
    purpose/context: 프런트엔드가 폴링 없이도 설정/활동 변경을 감지하도록 돕는다.
    input: asyncio loop, 이벤트 브로커, 감시할 루트 경로 목록을 받는다.
    output: Observer를 시작 및 종료한다.
    rules/constraints: 존재하는 경로만 감시하고, 디렉터리 전체를 재귀 감시한다.
    failure behavior: 개별 경로 감시 실패는 무시하고 나머지 경로는 계속 감시한다.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop, broker: EventBroker, roots: list[Path]) -> None:
        self._loop = loop
        self._broker = broker
        self._roots = roots
        self._observer = Observer()

    def start(self) -> None:
        handler = _CodexWatchHandler(self._loop, self._broker)
        for root in self._roots:
            if root.exists():
                self._observer.schedule(handler, str(root), recursive=True)
        self._observer.start()

    def stop(self) -> None:
        self._observer.stop()
        self._observer.join(timeout=2)
