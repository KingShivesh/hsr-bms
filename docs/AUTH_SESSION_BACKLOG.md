# Authentication Session Continuity Backlog

## Current Behavior

- Admin and staff JWTs expire 24 hours after login (`TOKEN_HOURS = 24` in `backend/deps.py`).
- The application does not issue or store refresh tokens.
- A protected REST request made after expiry returns `401`; the frontend removes the stored token, reloads, and requires a manual login.
- The realtime SSE stream emits `system.auth_expired` and closes when the same JWT expires. It cannot silently reconnect until the user authenticates again.

## Operational Risk

A counter tablet may remain signed in across multiple shifts or for several days. The current behavior can interrupt an active shift with a full re-login, including while the operator is using Live Floor or Cafe POS. This affects the whole application, not only realtime updates.

## Deferred Work

Design session renewal as a dedicated authentication change. A future implementation should use a short-lived access token plus a securely handled refresh mechanism, rotate or revoke refresh credentials, preserve admin/staff role checks, and coordinate renewal across REST and SSE clients.

Acceptance testing must cover:

- silent renewal before access-token expiry;
- SSE reconnection with the renewed credential;
- explicit logout and credential revocation;
- expired, invalid, and reused refresh credentials;
- a multi-day counter-tablet session without loss of in-progress UI state.

This item is documented but intentionally not part of the SSE rollout.
