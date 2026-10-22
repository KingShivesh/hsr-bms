# Deployment UI Completion

Scope: the user's October 22 "Fix Everything" brief. Preserve the approved
Syne / DM Mono fonts, palette, table-state cues, trusted Staff access and
server-authoritative payment/receipt confirmation. No feature or role expansion.

## Progress

| Cluster | Status | Evidence |
| --- | --- | --- |
| Login/auth | 48 before and 48 after samples pass; four widths, both themes, six states | `login/before/`, `login/after/` |
| Dashboard/shared cards | 48 after samples pass; all four widths/both themes/six states. Shared MetricCard + 14 Card/Panel roots; 12px minimum; long-text and dense-number overflow fixed | `dashboard/before/`, `dashboard/after/` |
| Live Floor / checkout | 48 + 48 final samples pass; all five table states, null rows and missing-status recovery also pass. Eight actual role/theme/mobile checkout contract cases pass | `live-floor/`, `checkout/` |
| Members / bookings | 48 final samples per page; eight null-row samples per page; 16 role-Owner dialog cases across both themes/four widths pass | `customers/`, `bookings/`, `member-booking-dialogs/after-final/` |
| Cafe | Main order view and both tabs: 48 final samples each. 16 price/cart/pagination contracts, 16 anonymous-target contracts and eight independent-read cases pass | `cafe-pos/`, `cafe-stats/`, `cafe-history/`, `cafe-contract/after-verified/`, `cafe-guest-target/`, `cafe-loading-isolation/` |
| Finance / reports / Settings / error routes | Pending current-build rerun and component consolidation | Not a pass |
| Shared overlays / menus / action states | Pending consolidation and interaction rerun | Not a pass |
| Local operational lifecycle | Pending 20-cycle role/theme/mobile exercise | Not a pass |
| Production release | Pending each verified cluster | A push alone is not proof |
| Real devices / unfamiliar human | External acceptance remains unverified | Browser viewports are not physical-device testing |

All current captures use a guarded disposable local database. No production
business mutations are authorized. The actual roles are Owner and Staff; Manager
and Counter are not built and will not be fabricated for this audit. Static
pages do not acquire fictional network states or unsupported creation actions.
Pending feedback may be immediate; settled money is never optimistically marked
paid. A loop animation (skeleton/spinner/status pulse) is not an entrance
transition and retains reduced-motion behavior.

## Current Findings

| Page | Fault | Rule | Fix Applied | Before / After |
| --- | --- | --- | --- | --- |
| Dashboard | 11px labels | Minimum 12px | Shared smallest type token is 12px; fonts and palette unchanged | `dashboard/before/results.json` / `dashboard/after/results.json` |
| Dashboard | Duplicate KPI markup | Shared cards | Removed local KpiCard; lead and summary metrics use MetricCard, itself backed by Card | `comparisons/dashboard-default-1440.png` |
| Dashboard | Long comparison text widened KPI card; oversized lead amount clipped on mobile | Bounded content, full-value access | Shared delta ellipsis/title; shared dense-number token also covers lead values | `comparisons/dashboard-extreme-1440.png` |
| Dashboard | Long table labels squeezed table ID out of view | Identity must remain readable | Bounded grid track; fixed ID track; label/player-name ellipsis with full-text title | Full `dashboard/before/` / `dashboard/after/` captures |
| Live Floor | Null table/order records crashed the route | Partial data must not crash | Guard the snapshot before rendering; keep valid records and authoritative totals | `live-floor/null-rows-before/` / `live-floor/null-rows-after/` |
| Live Floor | Missing status fell back to Available | Never invent availability | Reject an unrecognized status and show the existing recovery path | `live-floor/unknown-status-before/` / `live-floor/unknown-status-after/` |
| Checkout | Large totals widened the drawer by 36px; narrow summary cells overflowed | Bounded, readable values | Shared compact MetricCard grid, shared dense MetricValue, bounded/wrapping total header | `comparisons/checkout-extreme-1440.png` |
| Checkout | Recalculation used only status text | Shaped loading feedback | Existing quote stays visible with a shared one-row skeleton; instant pending state is retained | `checkout/contract/` |
| Live Floor | Staff saw an editable rate, then received HTTP 403 `Admin access required`; Owner edit control had no border or icon | Match existing permissions; visible action | Staff sees a read-only rate; Owner gets the shared bordered 44px button with pencil. No backend permission change | `live-floor/rate-role-before/` / `live-floor/rate-role-after/` |
| Live Floor | Card padding was 16px rather than the shared 20px contract | Shared spacing | Uses the existing 20px token, without changing status palette or cues | `comparisons/table-states-before.png` / `comparisons/table-states-after.png` |
| Members / bookings | Null API rows crashed each route | Partial data must not crash | Filter malformed records at the read boundary; preserve valid records and server values | Per-page `null-rows-before/` / `null-rows-after/` |
| Members / bookings | Local summary/card markup duplicated shared primitives | Shared component contract | Shared MetricCard for summaries and member profile; five remaining Card/Panel roots migrated | `comparisons/customers-default-1440.png`, `comparisons/bookings-default-1440.png` |
| Booking form | Private modal frame duplicated shared overlay behavior | One dialog system | Shared Modal, sticky footer, existing dirty-backdrop guard and saving-dismissal lock | `member-booking-dialogs/before/` / `member-booking-dialogs/after-final/` |
| Bookings | Missing/failed availability displayed five Available cards | Never invent availability | Only render known table states; missing states show refresh recovery and cannot be check-in candidates | `bookings/before/*-error.png` / `bookings/after/*-error.png` |
| Cafe | Slow stats/history held the whole counter behind a loader | Independent shaped loading states | Counter waits only for menu/floor; each data tab has its own skeleton and recoverable error state | `cafe-loading-isolation/results.json`, per-tab before/after loading captures |
| Cafe | Null history/stat rows crashed the route | Partial data must not crash | Filter malformed read records on initial and realtime refreshes, preserving valid rows | `cafe-stats/null-rows-*`, `cafe-history/null-rows-*` |
| Cafe | Price dialog was clipped/under navigation on mobile; actions looked like plain text; Escape lost opener focus | Shared modal and actionable controls | Shared Modal, bordered/primary buttons, explicit price-field initial focus without early autofocus | `comparisons/cafe-price-default-375.png`, `cafe-contract/before-final/`, `cafe-contract/after-verified/` |
| Cafe | History and performance tables rendered unbounded rows | Bounded shared tables | Shared pagination renders at most 25 rows, preserves global ranks, clamps after deletion | `comparisons/cafe-history-extreme-1440.png`, `cafe-contract/after-verified/` |
| Cafe | Missing payment method was labeled Cash | Do not invent financial metadata | Missing method displays a neutral dash; recorded methods and palette unchanged | `FoodTab.jsx` history fallback |
| Cafe | Anonymous running session could not receive food because an empty player selector blocked submission | Honor existing anonymous-session contract | No player required if the session has no names; no invented name sent; existing session key included | `cafe-guest-target/before/`, `cafe-guest-target/after/` |

The first shared-change regression is 20 main routes x four widths x both themes
(160 loaded/default captures), all clean. It is not certification of all their
network/error/empty states; those are still being re-run in the ordered pass.
`source-before.json` lists every inventoried color with file:line and selector:
zero React color-utility/literal violations or raw form/table primitives, but
278 CSS color declarations still require token consolidation, 649 literal spacing
declarations, and remaining surface/dialog roots are tracked rather than passed.

## Operational Verification

Final Live Floor and Staff checkout matrices each contain 48 clean samples
(six data states x four widths x two themes), including disabled-text contrast
at 4.5:1, minimum 12px text, named controls, 44px mobile buttons and content
overflow. Null-row and unknown-status follow-ups each contain eight after
samples; all five valid tables survive null rows, while missing availability
exposes Retry with no invented idle cards. Server totals are not recalculated
by the new presentation guard. The pure snapshot unit regression also passes.

All five states have full-page and per-card captures at every requested width;
the fixture isolates global notification popups so the cards can be inspected.
Card-level attention remains. See `comparisons/table-states-after.png` (light
above dark) and its before counterpart. These are browser read fixtures, not
production data or a billing-calculation test.

The eight checkout contract cases cover actual Owner/Staff, both themes and
375/1440px: native select type-ahead + Enter, read-only one-minute time preview,
Reset, focus trap, Escape and restored opener focus. The chevron reaches 180
degrees with a 150ms transition. Three payment options differ by <1px in width.
Only read-only preview POSTs are allowed; every business write is blocked.
The initial native-menu probes are retained separately: native popup ArrowDown
automation fails on a bare select as well in this Chrome build. It is NOT an
application failure or a certified arrow-key pass. OS-level testing remains
part of the physical-device gate. Tiny CSS matrix rounding is compared with
numeric tolerance, not exact string equality. `contract/results.json` is the
final passing contract; `*-probe.json` and failure PNGs are diagnostic history.

Dashboard/shared-text cluster `0893bc4` and tooling/evidence `cb49102` were
fast-forward merged and pushed. `deployment-dashboard.json` matches all 23
live JS/CSS hashes, with health/readiness 200 and unchanged backend ancestry.
Operational cluster `e06b2f0` is merged, pushed and production-verified in
`deployment-operations.json`; all 23 assets match and health/readiness return 200.

The final rate-action regression contains eight actual role/theme/width cases.
All four baseline Staff submissions returned 403 and left stored rates unchanged.
Afterward Staff has no edit control, and Owner has a 1px bordered, pencil-marked
44px control; opening and cancelling preserves rates. The final 48-case floor
matrix and eight all-state captures were rerun after this correction and pass.

Member/profile and Booking dialog verification has 16 final cases (two dialogs,
two themes, four widths). Tab, Shift+Tab, Escape and opener restoration pass;
the test waits for the shared focus-restoration animation frame instead of
sampling before it runs. Initial probes remain under `after/`, not the final
passing record. Eight Booking cases additionally browser-mock a held POST then
HTTP 500: visible pending feedback is <=200ms, close stays disabled, Escape cannot
dismiss while saving, failure preserves input and reenables submission. No such
POST reaches the backend. No new member or booking was created by these checks.
Measured Booking pending feedback was 14.0-15.6ms in these eight local cases.
The final Booking matrix also asserts zero status cards for failed/empty table
responses, rather than accepting visually polished but invented Available states.

Members/Bookings cluster `cf3bb21` is merged, pushed and production-verified:
`deployment-members-bookings.json` matches all 23 assets and backend readiness.

## Cafe Verification

The main order view, Food Stats and Order History each have 48 final strict
samples (six states, four widths, both themes). Tab loading is genuinely the
selected tab, not a successful screenshot of the main POS loader. The baseline
could not select tabs until all four reads completed; that limitation is recorded
as `tabSelected: false` on baseline loading samples. The final stress fixture is
60 ranked items and 1,000 orders; all after text is checked on bounded pages,
while the unpaginated baseline is explicitly viewport-only above 16,000px.

Sixteen Owner/Staff price/cart/pagination cases pass in `cafe-contract/after-verified`:
price focus, Escape/restored opener, quantity 2 at MRP 20 + 3, second page
26-50, and 25 rendered rows. Sixteen real anonymous-local-session cases pass in
`cafe-guest-target/after`: submission enabled without a name, one browser-mocked
HTTP 500 request, immediate pending feedback, retained cart, no false settlement
success, blank player name and nonempty session key. No food/order/payment write
reaches the backend. This does not replace the pending real 20-cycle workflow.

Eight held-read cases prove the counter loads with BOTH history/stats held;
stats can finish independently while history still shows its own skeleton.
Null-row baseline crashes are captured separately for both tabs; each after
follow-up has eight clean samples retaining the valid read fixture.

Early `cafe-contract/after` probes used the wrong text assertion for a numeric
input. `after-final` records real overlay interception by undismissed notifications
at smaller widths, not a passing pager check. The final isolated price/paging
contract suppresses unrelated aged-session reminders and dismisses ordinary cart
feedback using its actual close button. Cross-cutting notification occlusion is
still OPEN for the shared-overlay cluster; it is not silently treated as fixed.
