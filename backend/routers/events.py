import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sse_starlette import EventSourceResponse, JSONServerSentEvent, ServerSentEvent

from deps import get_current_claims
from realtime import ROLE_TOPICS, VALID_TOPICS, event_broker, seconds_until_expiry, utc_timestamp


router = APIRouter()


def parse_topics(value: str) -> frozenset[str]:
    topics = frozenset(part.strip().lower() for part in value.split(",") if part.strip())
    if not topics:
        raise HTTPException(status_code=400, detail="At least one realtime topic is required")
    unknown = topics - VALID_TOPICS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown realtime topics: {', '.join(sorted(unknown))}")
    return topics


def sse_event(event):
    return JSONServerSentEvent(
        data=event.data(),
        event=event.type,
        id=event.id,
    )


def heartbeat_event() -> ServerSentEvent:
    return ServerSentEvent(
        event="system.heartbeat",
        data=f'{{"occurred_at":"{utc_timestamp()}"}}',
    )


@router.get("/stream")
async def stream_events(
    request: Request,
    topics: str = Query(default=""),
    claims: dict = Depends(get_current_claims),
):
    requested_topics = parse_topics(topics)
    allowed_topics = ROLE_TOPICS.get(claims["role"], frozenset())
    forbidden = requested_topics - allowed_topics
    if forbidden:
        raise HTTPException(status_code=403, detail="Realtime topic access denied")

    subscriber, replay_events, sync_required = await event_broker.subscribe(
        requested_topics,
        claims["role"],
        request.headers.get("last-event-id", ""),
    )

    async def event_generator():
        try:
            yield JSONServerSentEvent(
                event="system.connected",
                data={
                    "boot_id": event_broker.boot_id,
                    "topics": sorted(requested_topics),
                    "occurred_at": utc_timestamp(),
                },
            )
            if sync_required:
                yield JSONServerSentEvent(
                    event="system.sync_required",
                    data={
                        "topics": sorted(requested_topics),
                        "reason": "replay_unavailable",
                        "occurred_at": utc_timestamp(),
                    },
                )
            for event in replay_events:
                yield sse_event(event)

            while True:
                remaining = seconds_until_expiry(claims.get("expires_at"))
                if remaining <= 0:
                    yield JSONServerSentEvent(
                        event="system.auth_expired",
                        data={"occurred_at": utc_timestamp()},
                    )
                    return
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(
                        subscriber.queue.get(),
                        timeout=min(30.0, remaining),
                    )
                except asyncio.TimeoutError:
                    continue
                yield sse_event(event)
        finally:
            await event_broker.unsubscribe(subscriber.id)

    return EventSourceResponse(
        event_generator(),
        ping=15,
        ping_message_factory=heartbeat_event,
        send_timeout=30,
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
