# Frame and package billing

Feature 2 of the scoped functional build. No palette, typography, sidebar,
whole-app UX or SSE rollout change. Features 3/6/7/10 remain excluded.

## Pricing contract

| Tariff | Charge | Start/configuration | Compatibility |
| --- | --- | --- | --- |
| Hourly | Existing rounded minutes, hourly rate and snapshotted peak multiplier | Default on all old clients and existing rows | Existing minimum, 12-hour cap and legacy pricing retained |
| Frame | Completed frames x snapshotted frame price | Admin sets Wiraka/English/Pool frame rates; 0 disables that group. First frame opens with the session | Open frame blocks checkout; completion without a loser is allowed for Single/Sharing; LP requires a loser |
| Package | One snapshotted fixed price per session | Admin defines name, price and eligible table group | No automatic hourly overtime, minimum or peak surcharge. Removal/edit never reprices an open session |

Food, GST, discounts and manual payment recording keep their existing rules.
Single/Sharing/LP remain **payer allocation**, independent of tariff. Transfers
preserve frame/package snapshots; hourly transfer behavior remains unchanged.
No real frame/package prices are seeded or configured in production by this batch.

Saved transactions, receipts and CSV carry the tariff and unit-price snapshot.
Retrying checkout returns the same saved tariff/charge. PostgreSQL row locks
serialize frame start/complete/checkout; the UI sends a frame ID to reject stale
completion requests. SSE remains a metadata-only `table.updated` invalidation.

## Evidence

Raw screenshots live in `before/` and `after/`; both themes are captured for
start, floor, checkout and Settings. `*-before-after.png` composes the **actual**
captures side by side. The before session is hourly; the after session is frame
billed, so different amounts are expected, not an identical-data pricing test.

`after/measurements.json` records browser clicks, price snapshots, mobile widths,
frame-action hit testing and computed colors/fonts. All mutations use the fixed
disposable local database `/tmp/hsr-tariff-browser.db`, never production.

| Check | Evidence/result |
| --- | --- |
| Rate edit after two completed frames | Config changes INR 80 to INR 120; agreed charge stays INR 160 |
| Package removed during active session | QA fixed price stays INR 500 |
| Open frame | Backend rejects checkout; UI disables finalization |
| Advanced controls | Actual start/complete clicks; one frame charges INR 120 |
| Saved receipt | Sales drawer displays `2 frames x INR 80` |
| Feedback | Save/start/frame completion measured from pointer-down, with 350ms request delay; all below 200ms |
| Mobile | 375/414px document widths match viewport; frame action >=44px and unobscured in both themes |
| Theme | Before/after Syne family, light/dark canvas and emerald tokens exactly equal |
| Backend regressions | 24 tests: 23 pass locally on SQLite; concurrency case runs only on PostgreSQL in parity CI |
| Full local soak | 87 requests, 0 failures, 0 active sessions left |

Browser review caught the sticky action bar covering frame controls on mobile
(`frame-control-overlap-before.png`). Frame workspaces now separate scrolling
content from a fixed-in-layout footer, with a compact mobile header/action grid.
The mobile hit tests prove the frame action is no longer covered.

Reproduce from `frontend/`: run `node scripts/verify-tariff-billing.mjs` with
the disposable backend at port 8002 and preview at port 5175, then
`node scripts/compose-tariff-evidence.mjs`. `AUDIT_PHASE=before` captures the
unchanged base commit. The script refuses to run when that fixture DB has an
active session and cleans up its QA sessions/transactions afterward.

## Shipped verification

- Feature commit `05a8652a12fd476221cc1ec4b4dde91cd7e88b2d` fast-forward merged
  into main and pushed. No merge conflict or unmerged code remains.
- [PostgreSQL parity run](https://github.com/KingShivesh/hsr-bms/actions/runs/37918318131)
  passed on that exact commit: fresh requirements, production-shaped app import,
  all 24 focused tests (including concurrent frame requests), and full soak.
- [Production evidence](production.json), checked 2026-10-09 10:37 UTC:
  Render `/health.revision` exactly matches the feature commit; `/ready` confirms
  the database is healthy. All 22 JS/CSS assets match the verified local build
  byte-for-byte, including the new Settings/Live Floor/FrameControls chunks.
- Main entry: `index-D_ygOBn5.js`, SHA-256
  `640c851f5659348badcb9010ffb3971ab2912c0ebbe8da23c003bad291cc028c`.
  CSS: `index-B4ZBi_Hn.css`, SHA-256
  `20bac3ad278a57d9a86c72124aef91125305e5b7c314a706b61ce5f3c57acb92`.
- `npm run scan:contrast`: **0 violations**; raw output in `contrast.json`.
  Lint, production build, theme guardrail and shared SSE-manager regression pass.
- Local QA sessions, frames, transactions, audit entries and tariff catalog
  are cleaned. No production mutation/account creation was performed.

This closes Feature 2. Member credit is the next separate design checkpoint;
the paused whole-app UX and SSE expansion are not resumed by this batch.
