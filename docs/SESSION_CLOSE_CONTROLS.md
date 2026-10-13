# Session close controls

## Confirmed scope

- Session starts will be anonymous and require no identity form.
- Identity is optional at checkout.
- Authenticated counter staff as well as the owner may correct session time.
- The owner explicitly approved moving start time before record creation for a
  forgotten start. End time remains server-controlled; reasons and audit trails
  are mandatory, and large amount changes require the configured manager PIN.
- Existing billing rounding, caps, tax, peak snapshots and checkout concurrency
  protections must remain unchanged.
- Thirty-minute check-ins and overtime alerts must not end or lock a session.

## Existing dependencies, not implemented features

The current app has admin/staff roles, not individual manager accounts; it has
no credit ledger, member-rate catalog or WhatsApp sender. Do not invent balances,
discounts, successful delivery or a credit payment option. Those integrations
must be built and verified before claiming the full brief is complete.

This implementation can apply an explicitly configured member `hourly_rate` at
checkout, but does not invent a default discount or a member-rate catalog UI.
An unset rate uses the snapshotted club tariff. Frame/package calculations remain
unchanged. Cash, UPI, Card and existing split-payment validation are retained.

Weekly owner summaries are delivered in-app, once per IST week. The minute job
generates Monday's summary on Monday, or catches up after downtime. This does not
send email, WhatsApp or push notifications to a closed browser. WhatsApp options
cannot be enabled until a real provider and delivery verification exist.

## Implementation boundaries

- The Live Floor and Dashboard available-table action starts directly with only
  `table_id`. Advanced controls use the same anonymous start. Global toolbar
  actions still need a table choice; that chooser has no identity form.
- Existing start API arguments remain accepted during compatibility rollout for
  older clients, booking check-in and hourly/frame/package integrations. They
  are not a claim that the strict table-only API acceptance item is complete.
- Checkout identity and time proposals are previewed without mutation and saved
  atomically by the existing close endpoint. There is intentionally no separate
  attach-customer write that would leave an identity behind after Cancel.
- Existing active member/booked sessions retain their data. Booking and queue
  identity-at-start paths still need a separately verified migration before the
  whole name-at-close brief can be called closed.
- No column is destructively removed. There are no prepaid columns in this repo.
- Admin and the shared staff account may edit time by default, as explicitly
  approved. Settings can revoke either permission; every request rechecks it.
  Audit identity is the login account, not an individual employee. Individual
  manager/staff permission records remain part of the separate access roadmap.
- Reasons are mandatory; category is derived server-side. Large **time** deltas
  (strictly greater than the configured threshold) require a real configured PIN
  even when reset PIN protection is off. Missing PIN configuration fails closed.
- Preview uses the existing signed frozen end time. End is read-only. Existing
  rounding, minimums, caps, peak snapshots, tax and frame-close gates still apply.
- Only a successful close records the edit, original/new values, account, notes,
  delta and late flag. Preview/cancel cannot create profile or audit residue.
- The reminder job runs each minute. Thresholds use unrounded active elapsed time,
  not minimum-charge minutes: a 120-minute minimum must not emit a 30m reminder
  immediately. Paused sessions never generate new thresholds.
- Each session/threshold/type has a DB uniqueness constraint. Acknowledgments are
  durable and shared across staff devices. Transfers retain the session key.
- 30m is badge/chime only; 60m and later add toast/bell; overtime remains until
  acknowledged. Warning toasts sit bottom-right and below open checkout dialogs.
- Sounds require an initial browser interaction and supported/unmuted audio.
  Closed/suspended browsers cannot promise immediate sound or visual delivery.
- Per-tab seen IDs prevent repeat normal toasts/chimes on reload. Unacknowledged
  urgent reminders restore visibly without a repeat sound. If browser storage is
  unavailable, server threshold/acknowledgment uniqueness still holds.
- During staggered deployment, an old quote response uses legacy frozen checkout
  and retains payment/split parameters; new identity/time controls stay hidden
  until the backend returns their capability marker.
- The task is single-process, matching the documented SSE single-worker runtime.
  Before scaling workers, replace the in-process event broker with shared delivery.
- Session Edits is admin-only, filterable by date/staff/reason/category, CSV-safe.
  Customer receipts never show original time; the optional footnote includes a
  correction reason only, not internal commercial notes.

## Verification

Before/after screenshots and measurements: `session-close-controls/`.
`backend/test_session_controls.py` runs against disposable SQLite or loopback
PostgreSQL, with the existing session-engine fixture. The production parity
workflow also runs this suite in its clean requirements-only environment.

The production SSE stream deliberately carries invalidation metadata only.
Financial and customer fields remain in authenticated REST responses, not general
SSE events. No WebSocket channel is present.

Unpaid walkouts must be a separately recorded receivable/loss, not a fabricated
shorter paid session. The pasted explanatory advice is not an accounting design.
