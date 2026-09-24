import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import BackgroundTasks


VALID_TOPICS = frozenset({"floor", "orders", "inventory", "reservations", "waitlist"})
ROLE_TOPICS = {
    "admin": VALID_TOPICS,
    "staff": VALID_TOPICS,
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class RealtimeEvent:
    id: str
    type: str
    topic: str
    resources: tuple[str, ...]
    occurred_at: str

    def data(self) -> dict:
        return {
            "type": self.type,
            "topic": self.topic,
            "resources": list(self.resources),
            "occurred_at": self.occurred_at,
        }


@dataclass
class Subscriber:
    id: str
    topics: frozenset[str]
    role: str
    queue: asyncio.Queue


class EventBroker:
    def __init__(self, *, replay_size: int = 512, queue_size: int = 64):
        self.boot_id = uuid.uuid4().hex[:12]
        self.replay = deque(maxlen=replay_size)
        self.queue_size = queue_size
        self.sequence = 0
        self.subscribers: dict[str, Subscriber] = {}
        self.lock = asyncio.Lock()

    def _next_event(
        self,
        event_type: str,
        topic: str,
        resources: tuple[str, ...],
    ) -> RealtimeEvent:
        self.sequence += 1
        return RealtimeEvent(
            id=f"{self.boot_id}:{self.sequence}",
            type=event_type,
            topic=topic,
            resources=resources,
            occurred_at=utc_timestamp(),
        )

    async def publish(
        self,
        event_type: str,
        topic: str,
        resources: tuple[str, ...] = (),
    ) -> RealtimeEvent:
        if topic not in VALID_TOPICS:
            raise ValueError(f"Unknown realtime topic: {topic}")

        async with self.lock:
            event = self._next_event(event_type, topic, resources)
            self.replay.append(event)
            subscribers = list(self.subscribers.values())

        for subscriber in subscribers:
            if topic not in subscriber.topics:
                continue
            if subscriber.queue.full():
                while not subscriber.queue.empty():
                    subscriber.queue.get_nowait()
                subscriber.queue.put_nowait(
                    RealtimeEvent(
                        id=f"{event.id}:sync",
                        type="system.sync_required",
                        topic="system",
                        resources=tuple(sorted(subscriber.topics)),
                        occurred_at=utc_timestamp(),
                    )
                )
                continue
            subscriber.queue.put_nowait(event)
        return event

    async def subscribe(
        self,
        topics: frozenset[str],
        role: str,
        last_event_id: str = "",
    ) -> tuple[Subscriber, list[RealtimeEvent], bool]:
        subscriber = Subscriber(
            id=uuid.uuid4().hex,
            topics=topics,
            role=role,
            queue=asyncio.Queue(maxsize=self.queue_size),
        )
        replay_events: list[RealtimeEvent] = []
        sync_required = False

        async with self.lock:
            if last_event_id:
                replay_snapshot = list(self.replay)
                matching_index = next(
                    (index for index, event in enumerate(replay_snapshot) if event.id == last_event_id),
                    None,
                )
                if matching_index is None:
                    sync_required = True
                else:
                    replay_events = [
                        event
                        for event in replay_snapshot[matching_index + 1 :]
                        if event.topic in topics
                    ]
            self.subscribers[subscriber.id] = subscriber

        return subscriber, replay_events, sync_required

    async def unsubscribe(self, subscriber_id: str) -> None:
        async with self.lock:
            self.subscribers.pop(subscriber_id, None)


event_broker = EventBroker()


def queue_realtime_event(
    background_tasks: BackgroundTasks,
    event_type: str,
    topic: str,
    *resources: str,
) -> None:
    background_tasks.add_task(
        event_broker.publish,
        event_type,
        topic,
        tuple(resources),
    )


def seconds_until_expiry(expires_at: int | float | None) -> float:
    if not expires_at:
        return 0
    return max(0.0, float(expires_at) - time.time())
