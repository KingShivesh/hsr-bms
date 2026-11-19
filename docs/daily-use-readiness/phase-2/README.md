# Phase 2: money and data integrity

Branch: `codex/money-data-integrity`, from deployed main `6471be2` (application
source `5f23897`). This phase is not approved for production merge yet.

## Paused checkpoint

Owner requested pushing the current Phase 2 work and stopping, before completing
the phase. This is an in-progress branch, not a release candidate. Do not merge
or deploy it merely because it has been pushed.

Implemented so far: durable mutation receipts, replay/conflict checks, strict
counter payment validation, atomic table carts, explicit pause-state support,
client request IDs retained across uncertain responses/reloads, and a backend
protocol gate for those writes. No palette/font changes or SSE rollout.

Verification at this checkpoint: 8 frontend intent tests pass. The focused
backend suite currently has 6 passing tests and 1 expected outstanding failure:
the approved 3 AM business-day helper is not yet wired into closing/reporting.
Full regression, final browser verification and production verification of Phase
2 have not been performed. See the checkpoint logs for actual command results.
Lint, production build and whitespace checks passed. The disposable PostgreSQL
container and its volumes were removed after the checkpoint run; no production
business records were modified.

Remaining: wire and verify business-day selection throughout reports; locked,
immutable closing and cross-ledger reconciliation; finish legacy/cutover and
constraint review; expand rollback/concurrency/billing-math coverage; verify UI
and final fresh-environment parity. Financial changes stay off main until the
full phase is finished, reported, and approved.
The new focused money suite must also be added to the CI parity gate on resumption.

## Scope and decisions

- Preserve the current palette, typography, trusted Staff time-edit permission,
  whole-rupee rounding policy, tariffs and existing payment choices.
- Owner approved a 3 AM IST business-day boundary: after-midnight sales before
  3 AM belong to the opening date. Actual receipt timestamps remain actual IST.
- Current session checkout intentionally allows Cash, UPI and member Credit.
  New Card/split tender remains disabled; historical split receipts must reconcile.
- SSE expansion remains paused. Existing metadata invalidations may still be
  emitted after successful commits; no financial data enters those events.

## Planned changes

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

Test output and any remaining discrepancies will be recorded here. All QA data is
disposable local data; there are no production financial mutation tests in scope.
