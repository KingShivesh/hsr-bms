# Phase 2: money and data integrity

Developed on `codex/money-data-integrity` from main `6471be2` (application source
`5f23897`). Owner-approved and deployed on 21 November 2026: source merge
`248390b`, backend stage `5e57d8c`. The approved source `2307dac` is an ancestor
of main and its backend/frontend application trees match the final merged code.

## Shipped and Verified

The owner confirmed the club was idle and a backup was ready, explicitly
approving an immediate rollout outside the suggested quiet window. Backend
`5e57d8c` was verified healthy twice with protocol 2 before frontend publication.
The complete Phase 2 source was then merged with no conflicts and pushed as
`248390b`. Production serves all 35 JS/CSS/font files byte-identical to the tested
build; backend ancestry and unchanged backend code were also verified.
`deployment.json` is the strict receipt; `backend-deployment.json` and
`deployment-timeline.json` preserve the staged observations. Do not confuse the
earlier checkpoint logs below with the shipped result.

The read-only production login smoke check passed 10 cases: both themes at 375,
768, 1024, 1440 and 1920 pixels, with zero layout/contrast/page errors and no
credential submissions or business writes. Evidence: `production-login/`.
Authenticated production financial mutations were not tested or performed.
Legacy production ledger coverage remains unverified; no historical money was
silently repaired. Security Phase 3 is separate and has not been deployed.

## Original Pre-Merge Review

The earlier `009657d` checkpoint was intentionally incomplete. This continuation
finishes Phase 2 on its branch; pushing it is NOT approval to merge or deploy.
At that review point main remained `6471be2`. No production business-record writes or destructive migrations
were performed. Colors, fonts, Staff time-edit access and SSE scope are unchanged.

Implemented: durable request receipts and conflict/replay checks; client intent
IDs retained through uncertain responses/reloads; atomic multi-item table carts;
explicit pause state; strict payment validation; shared 3 AM IST financial-day
selection; serialized closing; immutable saved closings; owner-only read-only
`GET /reports/reconciliation`; ledger discrepancies that block closing; explicit
owner acknowledgement of legacy payment coverage warnings. Closing shows unpaid
member credit separately and submits the date actually being reviewed, including
when the page stays open past 3 AM. Earlier dates can be selected for late close.

Daily Reset and Clear All cannot erase closed or newly audited financial history
or leave archived frames orphaned. Legacy reference columns were reviewed, not
retroactively constrained or cascaded without migration approval. Existing Payment
and CreditLedger foreign keys/unique receipt links are tested on PostgreSQL;
SQLite now explicitly enforces its declared foreign keys too.

The reusable money suite is part of both the parity workflow and local readiness
runner. The workflow also gates frontend financial-intent/recovery tests, lint
and build on frontend changes. The original checkpoint/baseline logs remain historical evidence, not the
final result. See final evidence below.

## Scope and decisions

- Preserve the current palette, typography, trusted Staff time-edit permission,
  whole-rupee rounding policy, tariffs and existing payment choices.
- Owner approved a 3 AM IST business-day boundary: after-midnight sales before
  3 AM belong to the opening date. Actual receipt timestamps remain actual IST.
- Current session checkout intentionally allows Cash, UPI and member Credit.
  New Card/split tender remains disabled; historical split receipts must reconcile.
- SSE expansion remains paused. Existing metadata invalidations may still be
  emitted after successful commits; no financial data enters those events.

## Delivered changes

1. Persist request fingerprints and successful replies in the same transaction as
   money mutations. Retries reuse the request key; a changed payload cannot reuse it.
2. Make a multi-item table-food cart atomic instead of committing one line at a time.
3. Bind pause/resume to the intended state/session, rather than retrying a toggle.
4. Use the approved business-day boundary for current-day reporting/closing, lock
   closing against concurrent sales, and reject mutations of a closed business day.
5. Reconcile receipt totals, paid records, credit debits/balances and closing totals.
   Report legacy coverage explicitly instead of manufacturing missing payments.
6. Exercise duplicate/concurrent requests, rollback, rounding, rates, tax/discount,
   midnight and cash/UPI/Credit paths on disposable SQLite and PostgreSQL only.

## Schema and rollback plan

The initial schema addition is an idempotency-receipt table with a composite
primary key, request fingerprint and saved reply. It does not rewrite existing
bills, balances or bookings. No destructive migration, drop, cascade or backfill
is authorized. Additional legacy foreign keys require a separate orphan/delete
behavior review; do not silently attach cascading deletes to financial history.

Rollback is code-only and retains the receipt table and all money records.
Pause financial writes and reconcile any uncertain requests before reverting to
older code that does not enforce the new request contract. Never drop deduplication
receipts during rollback: doing so can make a previously committed request run twice.
The final deployment plan must address stale browser clients and backend/frontend
version overlap before owner approval.

## Evidence

Final local gate: 141 backend test executions across eight suites on Python 3.11.9
and PostgreSQL 16, plus one full 87-request soak cycle; all passed. The 26 focused
money tests also passed on SQLite. Frontend: 24 retry/intent unit tests, lint and
production build passed. The environment was initially installed fresh, then the
entire gate was repeated in that same isolated environment after final review.

- `fresh-python311/results.json` and individual logs: fresh Python 3.11.9
  requirements installation, production-shaped PostgreSQL import, all eight
  regression suites, and one full soak cycle on disposable PostgreSQL 16.
- `sqlite-money.log`: the focused money suite on disposable SQLite.
- `frontend-final.log`: lint, 8 financial-intent tests, 16 request-recovery tests,
  and production build. No automatic retry of financial POSTs is introduced.
- `contrast.json`: all 21 routes in both themes; zero violations and zero errors
  at the strict 4.5:1 threshold, including disabled text and large text.
- `browser/after.json`: 375px and 1440px, light and dark; no overflow, zero visible
  contrast violations; legacy review gates closing and a ledger mismatch disables
  it. Actual local committed-response loss + page reload + retry produced ONE
  order with the SAME request key. A real close persisted after page reload.
- `browser/comparison-375.png` and `comparison-1440.png`: before left, after right;
  light above, dark below. Original screenshots and hashes are retained.
- `postgres/`: additional Python 3.13 regression run, not the production-version
  install gate. Final production-version results take precedence.
- `cleanup.log`: browser QA database cleared to zero rows; owned disposable
  PostgreSQL/Python containers and database volumes removed after verification.

## Billing and constraint audit

Partial minutes round up, minimum session duration applies, and rupee/tax amounts
retain the existing Python half-even rounding policy (2.5 -> 2, 3.5 -> 4). Tests
cover all three table tiers (320/270/170), snapshotted peak/member/package/frame
rates, multiple pauses, food prices/quantities, discount reasons, tax, historic
split sums, Cash/UPI records, Credit debits/balance changes, concurrent checkout,
commit failure and atomic cart rollback. New Card/split session tender remains
rejected; historical Card/split receipts are still readable and reconcilable.

Reconciliation compares table receipt components/food lines, payment or member
debit, every recorded credit running balance, member current balances, active
counter receipts and combined tender totals. Counter sales are their own paid
receipts, not duplicate Payment rows. Orphan payment/credit/frame rows and undated
money are flagged. Invalid split/unknown tender is never silently counted as Cash.
Legacy missing payment/food-line coverage is a warning requiring owner review;
fresh audited records with missing coverage are blockers. No missing payment or
opening credit balance is guessed or automatically backfilled.

Idempotency is per persisted logical request ID. Different tabs/devices must
reuse that ID to retry the SAME operation; independent IDs represent independent
sales. The app cannot infer that two independently entered identical sales are
accidentally the same sale. Session-key uniqueness separately protects checkout.

## Pre-merge decisions and rollout

No implementation discrepancy is intentionally deferred within Phase 2. Production
legacy coverage is NOT asserted clean: no production financial audit/mutation was
authorized or run. Legacy findings must be reviewed, not silently repaired.

After owner approval, choose a quiet 3-11 AM IST window, review unfinished tables
and the previous closing, and take a backup. Deploy backend before frontend,
verify `/ready` reports `financial_integrity_version: 2`, then verify frontend
bundle hashes/commit ancestry. Old clients without safe request IDs receive 428
and must reload; a new frontend refuses financial writes to an older backend.
This intentionally fails closed during a staggered deployment rather than risking
duplicate orders. Do not combine this phase with a wider SSE rollout.

Old closing snapshots are returned exactly as saved and marked as legacy when
they lack the new cutoff field. They may reflect the older midnight policy; they
are never retroactively repartitioned or recalculated. New unclosed financial
days use 3 AM. Compare historical reports with this policy difference in mind.
