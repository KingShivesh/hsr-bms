# Realtime SSE Architecture

HSR BMS uses one authenticated Server-Sent Events endpoint to send small invalidation events. Clients continue to fetch authoritative data through the existing REST API.

## Deployment Constraint

The event broker is in process. The current Render command starts one Uvicorn worker:

```text
python -m uvicorn main:app --host 0.0.0.0 --port $PORT
```

Do not increase Uvicorn or Gunicorn worker count while this broker is in-process. A client connected to worker A will not receive an event published by worker B, which would cause silent cross-device synchronization gaps.

Before scaling beyond one worker or one backend instance, replace the in-process broker with shared fan-out such as Redis pub/sub or PostgreSQL LISTEN/NOTIFY. Preserve the existing SSE endpoint contract so frontend consumers do not need to change.

The replay buffer is also in memory. Deploys and process restarts clear it. Reconnecting clients with an event ID from a previous process receive `system.sync_required` and must refetch their subscribed REST resources.

## Security Boundary

- `/events/stream` uses the same Bearer JWT validation as protected REST routes.
- Requested topics are checked against the authenticated role.
- Events contain invalidation metadata only. They do not include customer names, notes, totals, revenue, credentials, or complete records.
- Streams close when their JWT expires. The current application has no refresh-token mechanism, so users must sign in again after the existing 24-hour token lifetime.

## Role-Based Access Handoff

The backend already exposes `get_current_claims()` and `require_admin()` in `deps.py`. The next role-based access discovery pass should build on those existing checks and update `ROLE_TOPICS` in `realtime.py` alongside the REST permission matrix. Do not add a role to a realtime topic merely because its events contain no record data: topic access and the REST resources it invalidates must remain aligned.

## Reliability

- Per-client queues and the replay ring are bounded.
- Queue overflow produces `system.sync_required` instead of growing memory indefinitely.
- A heartbeat is sent every 15 seconds.
- The frontend must retain polling as a degraded-mode fallback.
