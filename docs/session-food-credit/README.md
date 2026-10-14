# Focused session fixes - 2026-10-14

## Evidence

- `comparison/comparison.png`: exact old frontend (`ca1ee07`) beside new frontend,
  both themes and the same local canteen fixture. Old frontend uses the current
  authenticated floor payload for the comparison; this is not a production write.
- `before/`: original untouched UI captures, both themes at 1440/375/414px.
- `verification/`: 24 final screenshots and `results.json`, with both themes at
  1440/375/414px. All had zero horizontal overflow; mobile dialog controls >=44px.
- `rollout-compatibility.json`: four Cash/UPI old-backend-response cases; all close
  writes intercepted, no business writes.
- `contrast.json`: all 17 routes, both themes, dynamic states; 0 violations and
  0 errors. `alert-replay.json` confirms existing notification reload behavior.

## Results

Final two-origin browser test (5181/5180, separate authenticated browser contexts):

| Check | Light | Dark |
| --- | --- | --- |
| Quantity change, request to second DOM | 493ms | 1418ms |
| Mark first item served | 242ms | 1007ms |
| All served; pending dot removed | 214ms | 436ms |
| Cancel item | 273ms | 286ms |
| Place order using actual UI | 237ms | 208ms |
| 10 rapid mutations, floor refetches across both sessions | 2 | 2 |
| Total REST requests for burst, including 10 writes | 14 | 14 |
| Stream drop/reconnect | 666ms | 662ms |
| Forced 503 while REST remains up | 13859ms | 13962ms |

The drop test cancels the actual response reader with a transport error while the
browser is offline, then verifies the real stream connection count increases from
one to two after reconnect. This is local fault injection, not physical WiFi.
The 503 test observes six actual 503 responses per theme, zero successful streams,
and a changed card via the established 15s polling fallback. Healthy SSE updates
are below two seconds; degraded polling is intentionally not described as instant.

Name-only Cash and member Credit closes both succeeded in both themes. The sole
seeded member remained the sole Member row, proving the name-only close created
no profile. Credit showed `Charged to Credit`, not `Payment Complete`.
Focused rendered contrast: zero violations; browser JavaScript errors: zero.

Local PostgreSQL: 34 session-engine, 16 authentication/financial, 16 checkout/alert
and 12 focused order/credit tests passed, plus the migration upgrade/rollback test.
The focused script also reruns the 16 checkout/alert cases (28 total), and the
final 28 cases passed on SQLite too. Concurrent Credit closes create one debit.
Full Postgres soak: one cycle, 87 requests, three closes, three ledger integrity
checks, zero failures, zero active sessions left. Setup-only zero-cycle runs were
not counted as this evidence.

The contrast scanner's fixed-dialog pixel origin and scroll clipping were corrected
separately. A regression fixture confirms hidden text is excluded while a genuine
visible low-contrast label is still detected. This did not change the app palette.

Fresh-runner production parity passed for source `d8acfaae041961870350baacf0a4d4de5fd31e78`:
[GitHub run 38546147366](https://github.com/KingShivesh/hsr-bms/actions/runs/38546147366).
Every required step succeeded, including fresh requirements install, app import,
all suites and a full Postgres soak. The failure-enforcement step was skipped
because the soak passed, not because parity was bypassed.

QA teardown: the dedicated SQLite database was cleared to zero rows in every
application table after stopping test servers. The dedicated Postgres container
was removed. No production accounts or business records were created or changed.
Production bundle/backend deployment proof is recorded separately; a push alone
is not deployment proof.

## Confirmed live

`deployment.json` records successful bundle-hash and commit-ancestry verification:
all 20 production JavaScript/CSS assets match the local production build byte for
byte, including entry `index-eBZrhsu7.js` and floor `LiveFloor-CeA3W0UZ.js`.
Render reports revision `23e06de9efc188b5166a946b47038a3261d571d0`, which contains
the tested backend source `d8acfaa`. `/health` and `/ready` both return 200 and the
database is ready. Main's fresh-runner parity check also succeeded:
[run 38546636918](https://github.com/KingShivesh/hsr-bms/actions/runs/38546636918).

No authenticated production checkout, member creation or order mutation was used
for deployment proof. The final proof commit changes documentation only; it does
not require a new application bundle or database change.
