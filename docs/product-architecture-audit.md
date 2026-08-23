# HSR BMS Product Architecture Audit

## Current Architecture

- Frontend: React + Vite, token-driven CSS in `frontend/src/style.css`, app shell in `frontend/src/App.jsx`, shared shell components under `frontend/src/components`.
- Backend: FastAPI + SQLAlchemy, routers under `backend/routers`, runtime compatibility helpers in `backend/database.py`, live table projection in `backend/live_state.py`.
- Data source of truth: backend database. Frontend is an operator UI and must not recreate billing, authorization, timer, or checkout rules.
- Authentication: JWT login with admin/staff roles. Backend authorization must remain authoritative.
- Live operations: active sessions live in `ActiveSession`, transactions in `Transaction`, bookings in `Booking`, food-only bills in `FoodOnlyOrder`, customers in `Member`.

## Dependency Map

- Live Floor depends on `/sessions/live-floor`, `/sessions/start`, `/sessions/pause`, `/sessions/transfer`, and session food APIs.
- Bookings depends on `/bookings`, `/sessions/tables`, and `/sessions/start` for check-in. Starting a matching session completes the booking server-side.
- Customers depends on `/members`, `/members/duplicates`, `/members/merge`, `/members/{id}/upgrade`, and delete.
- Sales depends on `/reports/history` and `/food/orders`.
- Daily Closing depends on `/reports/closing-report` and `/reports/day-close`.
- Analytics depends on report endpoints and must use real historical rows only.
- Inventory depends on settings/menu APIs and maintenance APIs.

## Safe To Reuse

- Existing API client with request IDs, retry behavior, backend failure events, and JWT injection.
- Existing `RetryNotice`, toast, confirm dialog, table status constants, and HSR table config.
- Existing live floor projection for operator-facing table state.
- Existing checkout idempotency, session keys, unique transaction protection, and backend billing calculations.

## Safe To Refactor

- Large frontend tab components can be gradually split into feature pages.
- Old page terminology can be updated to the operating-system vocabulary.
- Sales, bookings, and customer screens can be redesigned around existing endpoints.
- CSS can be consolidated further around shared page/card/table patterns.

## Do Not Touch Without Explicit Review

- Checkout/billing math in backend session close paths.
- `session_key` and checkout idempotency behavior.
- Staff/admin backend authorization.
- Daily close duplicate protection.
- Database compatibility migrations in `backend/database.py`.
- Legacy frame database tables and endpoints. They can remain for compatibility, but normal table sessions must not depend on them.

## Technical Debt

- `TablesTab.jsx` remains a large legacy control surface and should continue shrinking behind Live Floor.
- `ClubSuiteTab.jsx` still contains old billing/reservation implementations used by some legacy routes.
- Frame compatibility code remains in backend reports/session archives for historical records.
- Some mobile layouts rely on page-level CSS rather than reusable primitives.

## Current Product Direction

The operator path should stay:

Live Floor -> Session -> Orders -> Checkout -> Payment -> Receipt -> Sales -> Customer History

Normal table sessions must not require frame creation or frame completion. Tournament-specific frame/match logic can remain separate.
