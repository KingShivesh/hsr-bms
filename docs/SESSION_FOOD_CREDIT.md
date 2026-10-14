# Session orders, identity and payment

## Scope

The focused follow-up keeps the existing lifecycle, tariffs, signed frozen
checkout, staff/owner time corrections, PIN/reason/audit guardrails and reminders.
The approved Syne/DM Mono fonts, neutral surfaces, accent colors and saturated
table-state colors are unchanged.

## Canteen data

The shared authenticated floor payload includes active order lines, canteen total,
grand total, tax and peak components. Cards never request their own order data.
The first three distinct names are quantity-aggregated with a remaining-item count;
pending orders have both an amber dot and a text cue. Empty sessions explicitly
show `No canteen orders`. The summary opens an order drawer, not checkout.

New lines have stable IDs and snapshot unit prices. Existing JSON lines acquire
stable legacy IDs without repricing. Quantity/served/cancel writes lock the active
session and reject stale session keys. Cancellations retain their original line
and audit record, but disappear from active totals, payer allocation and receipts.
After commit, `session.orders.updated` and the older `table.updated` invalidation
refresh the shared floor data. Failed writes emit neither event.

The brief's proposed WebSocket payload is intentionally adapted to the established
SSE contract: one stream per tab, metadata only, authenticated REST for the actual
order/customer/financial data. No second transport or financial broadcast is added.
The 150ms debounce, 60s healthy safety poll and 15s degraded poll remain intact.

## Checkout

- `Search LP Member` explicitly links an existing loyalty member and can apply its
  configured hourly rate. It does not fabricate a rate for unconfigured members.
- `Add name` stores optional plain text with `player_type=walk_in`, no phone,
  lookup or new Member record. Whitespace/Skip yields an anonymous guest.
- Customer phone fields and unknown body fields are rejected, not silently saved.
- Exactly UPI, Cash and Credit are accepted for session close. No new Card or
  split-payment close is accepted, including legacy query-parameter requests.
  Historical receipts and unrelated counter-food payment methods are unchanged.
- Cash/UPI create one Payment row and a paid receipt. An optional UPI reference
  is saved. The owner can configure the club UPI ID in Session Controls. No UPI
  account is guessed; when unset, checkout points to the venue's physical QR.
- Credit requires an existing linked LP member, creates one CreditLedger debit,
  atomically increments `current_balance`, and marks the receipt `credit`.
  It creates no Payment. Replay of a completed session cannot charge it again.
  The owner sees the balance in the customer profile. Closing/Sales keep Credit
  separate from cash and UPI; it is outstanding, not collected cash.
- Credit-history members cannot be deleted/merged or erased by data-reset tools.
  Existing destructive resets still work for non-credit data, including dependent
  new Payment rows. Credit repayments, limits, adjustments and a full ledger UI
  are not part of this request and are not advertised as implemented.
- If another device changes food after review, the new client sends the reviewed
  expected total. A mismatch rejects close before any bill/payment/debit commits.
- New-client Credit is capability-gated until the backend advertises support;
  Cash/UPI frozen checkout still works during a staggered deployment.

## Schema and verification

Runtime upgrades add member balance and transaction payment status/reference.
New Payment/CreditLedger tables use unique transaction links and foreign keys.
`identity_004_walk_in` extends existing PostgreSQL checks/SQLite triggers; rollback
refuses to erase a walk-in identity while such sessions or receipts still exist.

`test_session_food_credit.py` covers order state/price/stale-session behavior,
metadata-only events, phone rejection, paid versus credit records, idempotency,
rollback, cash reporting and the concurrent-food review guard. Existing session,
time-edit, alert, migration and authentication suites remain in the parity gate.
The soak runner must attempt at least one full cycle even if setup uses its small
requested duration; zero-cycle setup is no longer mistaken for a passing soak.

Evidence, browser measurements, same-data before/after captures and deployment
proof are in `session-food-credit/`. All QA business mutations are local-only.
