# Session start identity repair

## Actual fault

The previous Live Floor dialog already enabled Start with a blank name, but
substituted `Walk-in`. The backend substituted `Walk In Customer` and used
the presence of a customer name to decide whether a session existed. Checkouts
also created member records from arbitrary typed names. Making only the field
nullable would hide anonymous sessions from floor state, closing and waitlist.

## Shipped scope

- One Guest / Member / From Booking modal for Live Floor and Advanced Controls.
- Guest nickname optional, trimmed, maximum 80 characters; empty becomes SQL NULL.
  Player count defaults to 2, bounded 1-20. No generated customer name.
- Member lookup requires three characters, supports formatted phone/name, and
  returns name, phone, visit count and tier. Identity/name snapshot resolved by
  server, not trusted from request. Only linked members get checkout statistics;
  guest nicknames never create customers. Member merge retains receipt snapshots.
- Booking selection only for matching table/type within 30 minutes either side
  of now, while still booked. Explicit booking ID is consumed under the same
  transaction gate as start. Completed booking cannot be replayed/cancelled/restored.
- New phone/venue bookings and quick reservations snapshot their hourly tariffs.
  Existing bookings cannot recover historical rates: the dialog explicitly says
  current tariff when no snapshot exists. No fabricated prepayment information.
- Session/receipt persist guest/member/booking source and IDs. Anonymous cards
  show Guest; checkout uses table ID plus Guest; report bucket is Walk-in Guest.
- Existing single/sharing/LP allocation remains separate from hourly/frame/package
  tariffs. A group nickname is not added as a third sharing payer.
- PostgreSQL advisory transaction gate protects empty table slots, followed by
  session/member/booking row locks. SQLite uses BEGIN IMMEDIATE. Actor is actual
  JWT username. Events are queued after commit, using the existing SSE manager.
  SSE remains metadata-only: identity comes from authorized REST, not a PII broadcast.
- Palette and Syne/DM Mono fonts unchanged. Disabled checkbox captions no longer
  inherit opacity; the checkbox remains genuinely disabled.

## Verification

- PostgreSQL: 34 session regressions, 16 auth/financial regressions, one migration
  upgrade/backfill/rollback test. Simultaneous blank starts: exactly 200 + 409,
  one active session and one start audit entry.
- SQLite: matching suites (Postgres-only cases intentionally skipped).
- Postgres soak: PASS, 87 requests, 3 closed sessions, 3 ledger checks,
  0 active sessions remaining. This is a short parity cycle, not a new long soak.
- Browser: guest NULL persisted and visible; phone-selected member ID persisted;
  booking linked and completed; nullable-name checkout; same modal in Advanced
  Controls; arrow-key tabs and Escape. Both themes, 375px/414px, all three tabs.
  No horizontal overflow or page errors. Actual click-to-feedback in browser.json.
- Before/after pixels: comparison.png, before/, after/. No production test data
  or production mutations were used. QA lives only in a disposable local DB.
- Lint/build, theme guardrail, realtime-manager regression and contrast scan.
  Detailed results and any limitations are stored alongside screenshots.
  Final contrast scan: 0 violations, 0 errors across 17 routes in both themes.
  Theme runtime rerun: PASS with the required local running, paused, reserved and
  available fixtures. The initial run lacked those fixtures; its failure was not
  evidence of a stale harness. Seven bootstrap scenarios, both-theme token pairs,
  toggle/reload/navigation/cross-tab persistence and eight mobile cases passed.
  Actual red/green/amber/blue floor fills and white foreground are unchanged.
  The reusable local-only `verify-session-theme.mjs` seeds and cleans its own
  sessions/booking; final checks found zero active sessions or booked QA fixtures.
  Full results and mobile screenshots: theme-runtime/runtime.json and
  theme-runtime/after/.

## Staged Migration And Rollback

`ensure_runtime_columns()` applies three independently recorded stages in order:

1. `identity_001_columns`: nullable discriminator and links, default guest.
2. `identity_002_backfill`: infer only from existing explicit IDs, otherwise guest.
   Prior NULL discriminator rows are recorded for reversal. Never guess membership
   from a name. Existing legacy names are not rewritten.
3. `identity_003_constraints`: PostgreSQL NOT NULL/default/check, plus reporting
   indexes. SQLite enforces the same allowed/non-null discriminator using triggers
   rather than rebuilding occupied operational tables. Names were already nullable.

Every module has up/down. `migrations.downgrade(conn, keep=2)` reverses stage 3;
keep=1 additionally reverses backfill; keep=0 drops added columns. Tested on both
engines with preserved legacy names. Run rollback only in maintenance with writers
stopped and a backup. Export identity/pricing data first: dropping columns loses
post-release links/snapshots. The old backend cannot detect active NULL-name
sessions, so close those safely before reverting application code. Prefer a
forward repair; never rename anonymous sessions to fabricated placeholders.

## Explicitly Still Open

- **Member credit ledger/limit enforcement and PIN overrides are NOT implemented
  or tested in this release.** No balances, limits, member active-status field or
  settlement ledger exist in the current schema. They remain functional roadmap
  feature 4, requiring a real accounting contract. Do not display invented zero
  balances, silently promise a credit gate, or mark the entire supplied blueprint
  accepted. A scope question was raised before implementation.
- Public online booking/payments and multi-tenant IDs are excluded by the existing
  roadmap. This patch links existing single-venue venue/phone bookings; it does not
  invent a payment provider, tenant schema, UUID migration or WebSocket stack.
- No WhatsApp sending integration currently exists, so anonymous checkout cannot
  trigger a send. Do not claim phone-based receipt delivery has been built.

## Deployment

Merged and pushed to main without conflicts. Verified live on 2026-10-11:

- All 23 production JavaScript/CSS assets match the production-configured local
  build byte-for-byte by SHA-256. Entry: `index-gXNUQWmC.js`;
  stylesheet: `index-CGHGsiHY.css`. Rebuild with the production `VITE_API_URL`
  before comparing; a localhost-configured build has different bytes.
- Render `/health` and `/ready` returned 200; database readiness was OK.
  Runtime revision `4d8a0b215bf6400b8f81b10b147b75d10c207c77` contains backend fix
  `e38c9ad`, confirmed with commit ancestry. Receipt: deployment.json.
- Clean-environment main CI passed: fresh requirements install, production-shaped
  PostgreSQL import, database regressions, reversible migrations and parity soak.
  [Run 38127021362](https://github.com/KingShivesh/hsr-bms/actions/runs/38127021362).
- Production verification was read-only. No production QA accounts, bookings,
  sessions or transactions were created by this pass.
