# Session close controls: evidence

## Scope and decisions

The latest brief supersedes the earlier three-player-type start design. The owner
subsequently approved trusted staff time edits, including a start earlier than
record creation for a forgotten start. This build keeps the approved Syne / DM
Mono fonts and light/dark palette unchanged. No production accounts or business
records were created or mutated by this QA pass.

Implemented cluster: direct anonymous starts on available Live Floor, Dashboard
and Advanced-control cards; optional checkout identity; audited owner/staff time
proposals and PIN guardrails; durable half-hour/overtime reminders; admin Session
Edits report/CSV; session-control settings; in-app weekly owner summary.

The full original brief is **not closed**: strict retirement of legacy start
arguments and booking/queue identity-at-start, individual employee permissions,
member-credit settlement and WhatsApp delivery remain open. See
[`../SESSION_CLOSE_CONTROLS.md`](../SESSION_CLOSE_CONTROLS.md) for exact boundaries.
Nothing in the unfinished presentation branch was included or reverted.

## Actual screenshots

[`comparison.png`](comparison.png) places the mobile checkout before/after side by
side in both themes. It is rendered from the actual images, not a mockup.

- `before/`: 18 screenshots of untouched main `6de0ff0`, at 1440/375/414px.
- `after/`: 26 screenshots at the same widths/themes, including staff-authenticated
  checkout, receipt, alerts and admin Session Edits.
- Corresponding `measurements.json` files record viewport overflow, dialog bounds,
  control sizes, computed fonts/palette and pass/fail interaction results.
- After: zero page overflow in every sample; mobile dialogs fit the 844px viewport
  and their controls have 44px targets. Desktop buttons retain the existing tier.
- The illustrated staff correction changes 46 to 91 billable minutes, ₹245 to ₹485,
  with the original duration, reason and staff account visibly recorded. Exact
  timestamps differ between capture runs; these are real local QA sessions.

## Browser checks

`verify-session-close.mjs` drives real clicks against the exclusively named
`/tmp/hsr-session-close-ui.db` fixture, never production:

- Available table starts with exactly `{table_id: "t3"}`; no modal or identity
  fields; pending buttons visibly disable before the delayed start completes.
- Staff can open Adjust Time, move start earlier and preview a recalculated bill.
  Apply is disabled without a reason. The receipt/history records staff and edit.
- Optional phone/name is captured at close; preview creates nothing.
- Overtime toast remains after 11 seconds, is acknowledged through the bell, and
  disappears after acknowledgment. The bell and payment buttons are clickable.
- Light and dark checkout/reminder foregrounds pass focused rendered-contrast
  scans. The 17-route stable-state scanner also reports zero violations/errors.
- `test:realtime-manager`: one maximum concurrent stream, 503 fallback succeeds,
  subscription cleanup returns to zero. No per-component stream was introduced.

Found/fixed during QA: a persistent top-right toast covered the bell; moving it
bottom-right initially covered checkout buttons. Reminder toasts now have their
own stack below modal overlays. Mobile customer choices now wrap into full-width
44px actions. No forced-click workaround was used.

Follow-up rollout checks (`rollout-compatibility.json`): four UI-only cases retain
UPI/split payment, signed freeze and session key against old backend responses,
with new identity/time controls withheld until their capability is present.
All close requests were intercepted; zero business writes. The backend was
already serving `ecce8a5` when this guard was checked, so this is forward rollout
protection rather than evidence of a live failed payment.

Reload checks (`alert-replay.json`): in both themes normal reminders do not replay
their toast after a same-tab refresh; unread bell entries remain. Unacknowledged
urgent reminders restore exactly one persistent toast, without a repeat chime.
The seen set is bounded to current unread IDs in per-tab, per-login storage.

## Backend and production parity

On a disposable loopback PostgreSQL 16 DB, with a **fresh virtualenv installed only
from requirements.txt** and production-shaped configuration:

| Check | Result |
| --- | --- |
| Fresh app import with `postgresql+psycopg` URL | Pass |
| Existing session engine / concurrent checkout / billing snapshots | 34 pass |
| Existing auth / financial integrity | 16 pass |
| New staff edits, PIN, identity, alerts, summary and split payments | 16 pass |
| Existing identity upgrade/backfill/rollback | 1 pass |
| Full operational soak cycle | 87 requests, 0 failures, 3 closes, 0 active sessions |

New cases include permission revocation, unconfigured/wrong/correct PIN, future
start and excessive pause rejection, preview cancellation, phone match reuse,
phone-only profile delete/undo, member-rate calculation, stale/duplicate closes,
split-payment validation, exact thresholds despite billing minimums, pause/resume,
overtime uniqueness/no auto-end, late-edit flags, filter/CSV safety and owner-only
weekly aggregation.

The required clean GitHub runner repeated the PostgreSQL import/tests/migrations
and soak successfully for source `cba6f1e`:
[Backend production parity run](https://github.com/KingShivesh/hsr-bms/actions/runs/38379397919).
The guard now permanently includes `test_session_controls.py`.

Lint, production-addressed build, theme guard and whitespace checks pass. The
schema change is additive; no receipt/session rows or legacy columns are dropped.

## Deployment

Production deployment confirmation is recorded in `deployment.json` after merge:
every deployed JS/CSS asset must match its local SHA256 and Render's health
revision must contain source commit `cba6f1e`, with both health and readiness 200.
Until that file says `verified: true`, a push is not proof of a live deployment.

Confirmed live on 2026-10-13: frontend source `43e4e2e`, all **19** JS/CSS assets
match SHA256; entry `index-HGPpw919.js`, CSS `index-D1g-VnvD.css`. Render revision
`ecce8a5cb5583fb3a56fd0edce4f811a6bbfee1f` contains backend source `cba6f1e`;
health/readiness are both 200. Render did not need a new backend release for the
frontend-only rollout/reload guards.

`production-login/` has six anonymous production samples, both themes at
1440/375/414px: Syne actually loaded, approved canvas colors retained, zero
overflow/contrast errors, mobile 44px buttons. No credentials were entered and no
login or business mutation was attempted. Authenticated feature interactions were
verified only against disposable local data, not claimed as production mutations.

QA cleanup: stopped the task's local servers; all rows in the dedicated SQLite
fixture removed (zero residue); disposable PostgreSQL container removed. Existing
user servers/work and the uncommitted presentation branch were left untouched.
