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
| Finance / reports | Three main screens + four reachable report sub-tabs: 336 final samples pass; eight receipt/paging cases and two eight-case data-integrity follow-ups pass | `sales/`, `analytics/`, `daily-closing/`, `reports-*/` |
| Settings | Six sections: 256 final strict samples pass. Eight missing-data, tariff recovery and pending-save contracts pass; three shared Panel roots migrated | `settings-*/`, `settings-contract/after/` |
| Inventory / Waitlist / Legacy / Tournaments | 192 final strict samples; 28 unknown-data cases; 24 Owner/Staff dialog cases and eight Booking regressions pass | `inventory/after-final/`, `waitlist/after/`, `legacy-table-controls/after/`, `tournaments/after-serial/`, `operations-read-contract/`, `operations-dialogs/` |
| Auxiliary operations / error routes | Both Pricing tabs, Audit and Status: 48 samples each; Help, Changelog, Sample Workspace and 404: eight applicable samples each. 52 focused cases pass | `pricing-*/after-final/`, `audit-log/after/`, `status/after/`, static-route `after/`, `service-contract/after-final/` |
| Shared notifications | Ten before/after cases, 16 real-Cafe contracts and both-theme lifecycle tests pass; 160 loaded-route checks pass; strict contrast scanner: 0 violations / 0 errors | `notification-clearance/`, `notification-cafe/`, `notification-lifecycle/`, `notification-regression/`, `notification-contrast.json` |
| Remaining overlays / menus / action states | Pending consolidation and interaction rerun | Not a pass |
| Local operational lifecycle | Pending 20-cycle role/theme/mobile exercise | Not a pass |
| Production release | All completed clusters above, including pricing/audit/service-page fixes, are live-verified | `deployment-*.json`; a push alone is not proof |
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
| Sales | Null read rows crashed the register | Partial data recovery | Filter malformed rows before summaries and rendering | `sales/null-rows-before/` / `sales/null-rows-after/` |
| Sales | Missing payment methods were counted as Cash | No invented financial metadata | Keep total sales unchanged; exclude unclassified methods from named payment buckets and show a recoverable warning | `comparisons/sales-payment-missing-1440.png` |
| Sales | Receipt number looked like plain text | Actionable controls | Shared outlined receipt button with Lucide icon | `sales/receipt-before-final/` / `sales/receipt-after/` |
| Sales / Closing | Duplicate summary-card markup | Shared components | Shared MetricCard for seven Sales and seven Closing values; Closing retains its inline structure and approved tones | `comparisons/sales-default-1440.png`, `comparisons/daily-closing-default-1440.png` |
| Reports | Private empty states, including decorative fake rows with no action | Truthful, actionable empty state | Shared EmptyState with refresh/filter actions; no fabricated profitability or hour rows | `comparisons/reports-advanced-empty-1440.png` |
| Session Edits | Unbounded table | Responsive, bounded records | Shared 25-row pagination; global row identity retained, numeric columns right-aligned | `reports-session-edits/`, `sales/receipt-after/*-edits-page-2.png` |
| Settings | Legacy `height: 100%` stretched every operations panel to the whole stack | Content-sized panels | Scoped automatic height; shared Panel for settings, tariffs and session controls | `comparisons/settings-operations-default-375.png` |
| Account / Team | Missing counts appeared as zero; unavailable team details could be marked reviewed | Do not invent state | Unknown counts show a dash and Retry; unknown team details have Retry and cannot be marked reviewed | `comparisons/settings-account-missing-counts-375.png`, `settings-contract/` |
| Tariffs | Plain loading text; null package list crashed the whole route | Shaped loading and partial-data recovery | Shared skeleton and RetryNotice; incomplete editable settings are rejected before rendering or saving | `comparisons/settings-tariffs-loading-1440.png`, `settings-contract/` |
| Notifications | Persistent reminders covered final page actions; ordinary feedback overlapped reminders | Reachable actions and separate layers | Measured scroll clearance, separate bounded stacks, in-flow dialog feedback; Undo/Dismiss and hover/focus timing retained | `comparisons/notifications-page-375.png`, `comparisons/notifications-dialog-375.png` |
| Inventory | Maintenance fields extended 31.65625px past the 375px viewport in both themes | Controls must remain reachable | Header wraps the form below its title; all three controls now have 0px viewport overflow | `comparisons/inventory-maintenance-default-375.png`, `inventory-maintenance/results.json` |
| Waitlist | Desktop action controls reduced guest-name width to 0px | Identity cannot disappear | Guest details retain their first row; actions occupy a second row. Width becomes 426px at 1440px and 163px at 375px | `comparisons/waitlist-queue-default-1440.png` |
| Operations reads | Failed/missing reads looked empty or available; null stock/price looked in-stock/free | Unknown is not zero or Available | Track successful resource reads, show Retry/dashes, guard status snapshots; reserved tables cannot be offered for seating; incomplete items cannot be deleted into an invented Undo payload | `operations-read-contract/` |
| Tournament | Populated bracket widened mobile controls to x=474.296875 at 375px; selected-event metadata contrast was 1.10:1 light / 2.28:1 dark | Bounded layout and 4.5:1 text | Shrinkable grid children/header, full-width error notice, existing text-on-accent token; final matrices have no clipping or contrast faults | `comparisons/tournaments-partial-375.png`, `tournaments/after-serial/` |
| Inventory / Waitlist forms | Private frame duplicated focus logic; pending saves could be discarded | Shared dialog contract | Shared Modal with saving dismissal lock; preserve filled-field Escape guard independently from one-click close icon | `comparisons/inventory-dialog-default-375.png`, `operations-dialogs/after-owner/`, `operations-dialogs/after-staff/` |
| Pricing | Mobile rule controls reduced the rule label to 0px and clipped Delete; panel title split across three lines | Readable identity and reachable actions | Responsive rule/action rows, stacked panel heading/description, shared Panel and actionable empty state | `comparisons/pricing-rules-extreme-375.png` |
| Pricing | GST UI allowed 100 although the backend accepts at most 28; missing current-rate data claimed Standard active | Match existing server constraints; do not invent state | GST 0–28 and peak-hour validation before requests; missing rate/list data shows Retry | `service-contract/after-final/`, `service-contract/after-pricing-final/` |
| Audit | Critical actions counted as zero risk; missing actor/severity looked known | Truthful operational state | Count danger and critical; warning cue for risk rows, dashes/Retry for missing details; reject malformed collections | `comparisons/audit-critical-default-375.png` |
| Status | An empty HTTP 200 body claimed backend/database Ready | Readiness needs evidence | Require the existing readiness payload's status and database to both be ok | `comparisons/service-readiness-default-375.png` |

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
feedback using its actual close button. That isolated Cafe pass did not certify
notification occlusion; see the later notification cluster below for its fix.

Cafe cluster `4e1b05e` is merged, pushed and live: `deployment-cafe.json`
matches all 23 assets, with backend health/readiness 200 and unchanged ancestry.

## Finance Verification

Sales, Bills and Closing each pass 48 final strict samples. Table Performance,
Regular Customers, advanced Analytics and Session Edits each pass another 48:
336 total. Report tabs are selected through their real saved-tab mechanism and
their own endpoints are intercepted, not the Bills endpoint. The Session Edits
extreme read fixture has 1,000 records; after rendering is bounded to 25.
The Regular Customers endpoint is already server-bounded to its top ten.

Eight Owner receipt cases pass both themes/four widths: visible bordered/icon
action, strict contrast/overflow checks on a large receipt, Tab/Shift+Tab trap,
Escape and restored opener. The same eight cases click Session Edits Next and
verify records 26-50 of 1,000 with 25 rows. All business writes are blocked.
`sales/receipt-before/` retains the original notification-occlusion failures;
`receipt-before-final/` and `receipt-after/` use the same isolated-reminder
fixture for the receipt-specific comparison. Notification occlusion is addressed
in the later shared-notification cluster below.

The eight-case null-row follow-up no longer crashes. The eight missing-method
cases measure actual rendered summary values: the baseline counted the read
fixture's entire 500 as Cash; afterward Total sales remains 500, Cash is 0 and
the unspecified-method warning is visible. No stored transaction, payment,
discount, tax, receipt or close-day rule was changed. Initial infrastructure
timeouts were not counted as passes; the final serial reruns are complete.

Finance source `151ccd9` and its evidence through `e9c197f` are merged and pushed.
`deployment-finance.json` verifies all 23 live asset hashes, backend ancestry,
health 200 and database readiness 200. The original unpublished combined commit
was split into small fast-forward commits after repeated HTTP 408 upload failures;
the final Git tree was verified identical, and no screenshot was discarded.

## Settings Verification

Operations, Club Profile, Team, Activity and Account each pass 48 strict samples;
Billing passes 16 applicable static/error-isolation samples: 256 total across
375/768/1024/1440px and both themes. Billing does not invent a network dependency
or a subscription feature. The final Operations rerun follows the height fix.

Actual screenshot inspection caught an error missed by the general scanner:
legacy full-height panels inherited the entire Settings stack height. In the
matched tariff-held contract the first panel measured 3,580.5 -> 326.5px at 375px,
2,228.5 -> 204.5px at 768px, 2,330.5 -> 204.5px at 1024px and
2,304.5 -> 184.5px at 1440px, identical in both themes. The normal loaded build
also measured a 4,106.5px first panel before correction. The new contract rejects
a first panel taller than 600px, and retains per-panel measurements and screenshots.

Eight final contract cases prove missing account counts stay unknown rather than
becoming zero, unavailable team data cannot be marked reviewed, a failed Retry
can recover, and a null tariff package list no longer crashes Settings. The
before route crash is explicitly recorded in every baseline case. Partial editable
tariffs are not silently converted to empty packages that could overwrite saved
configuration. Shared skeletons replace the plain tariff loading text.

All eight held tariff submissions visibly enter pending in 11.5-14.2ms. The
browser returns HTTP 500, the actual entered rate remains, and there is exactly
one mocked submission per case. No business write reaches the backend. Global
session reminders are isolated for these targeted contracts, not declared fixed.
Initial contract selectors confused the existing notice/global server banner with
the panel response; the final test scopes actions to their owning panel and waits
for the actual failed response. Only the final passing run is acceptance evidence.

Before/after composites retain original pixels: before left, after right, light
above dark. Full-screen sources and cropped tariff-panel sources are both kept.
Fonts, colors, credential policy, trusted Staff time permissions and backend
financial rules are unchanged. The later shared-notification cluster addresses
notification occlusion. Remaining operations/overlay/lifecycle/source-token work
is still OPEN.

Settings source `b8e9c68` and evidence through `5ca22d3` are merged, pushed and live.
`deployment-settings.json` verifies all 23 asset hashes and unchanged backend
ancestry, with health/readiness 200.

## Notification Verification

The same isolated real-component fixture runs against the frozen baseline and
the current source at 375/414/768/1024/1440px in light and dark mode. All ten
baseline cases block the final page action. Stack overlap is 43,218px² at 375px,
26,740px² at 414px, 25,442.8125px² at 768px and 22,039.0625px² at 1024/1440px.
All ten final cases have zero overlap and a reachable final action. The app
reserves measured scroll clearance only while notifications are present; this
allows page-end controls to scroll above the floating stacks, not an unsupported
claim that a floating notification never covers any content. Clearance resets to
zero after dismissal. No pointer-events bypass hides or disables toast actions.

Actual pointer clicks confirm Undo once, warning Dismiss once and a successful
dialog Retry, with no business writes. Ordinary dialog feedback is inside the
dialog layout and does not intersect its footer action (0px²). Strict rendered
toast contrast is clean. Final reduced-motion page feedback measures 44.7-54.7ms.

Screenshot review caught two incomplete initial fixes: the later interaction
stylesheet overrode the stack offset, and the global reduced-motion rule added
a tiny unintended position transition that made the first clearance read stale.
The existing authoritative toast rule now owns the offset; stack containers do
not transition, while individual toast animations retain reduced-motion support.
The regression explicitly measures stack overlap as well as reachability.
Initial probes and the resource-contention latency miss are not final passes.

The final Cafe integration keeps actual disposable-database session reminders
and ordinary cart notifications visible, rather than suppressing them or clicking
them away. The focus/cart/pagination contract covers actual Owner and Staff,
both themes and four widths; food stats have 60 rows and order history has 1,000
read-fixture rows, bounded to 25 displayed records. No order or payment is posted.
The shared lifecycle regression also checks default success/info duration,
persistent errors, hover/focus pause, keyboard Undo, dialog relocation and scroll
restoration. These are notification checks, not a substitute for the pending
20-cycle real operational workflow or physical-device acceptance.

Final notification source passes lint, theme guard and build. The final strict
contrast scan covers 21 routes in both themes plus login errors, popovers, command
palette and safe dialogs: zero violations and zero errors. The loaded/default
regression has 160 passing samples. It does not close all page-specific states.
Manual screenshot review also flagged a clipped Inventory maintenance form that
the original overflow guard missed; that is an explicit remaining Operations
item, not a claim that every visual detail is now clean. Initial notification
failure images are kept under `notification-clearance/probes/`, separately from
the final passing `after/` captures.

Notifications source `71475f4` and evidence through `608ecf1` are merged and live.
`deployment-notifications.json` confirms all 23 asset hashes, unchanged backend
ancestry and health/readiness 200.

## Remaining Operations Verification

Inventory (`after-final`), Waitlist (`after`), Legacy Table Controls (`after`)
and Tournaments (`after-serial`) each pass 48 strict samples: default, loading,
error, empty, partial and extreme, at 375/768/1024/1440px in both themes. This is
192 final page samples, not a claim that every operational mutation is tested.
Shared Panel/Card roots replace three private surface roots; the workspace
frame now uses shared Modal. Colors, fonts, table-state cues, trusted Staff
permissions, financial logic and SSE rollout scope are unchanged.

The focused Inventory comparison uses the same real read-only QA data against
the frozen baseline and candidate. All three maintenance controls measured
x=249.15625..406.65625 before at 375px (31.65625px off-screen), and
x=101..338 after (0px off-screen), identically in both themes. Actual panel
screenshots retain the clipped baseline, not a diagram or reconstructed mockup.

Populated read fixtures uncovered defects the initially empty database missed.
Desktop queue controls consumed the entire guest-name track; its measured width
was zero. It is now 426px at 1440px and 163px at 375px. Missing guest information
is explicitly unavailable, not rendered as literal null or an invented name.
The strengthened scanner catches controls clipped by ancestors even when the
root reports no horizontal overflow, and zero-width text even with a tooltip.

Twenty-eight read-only contract cases prove null menu entries do not fabricate
items; unknown stock/price remains unavailable/a dash, not in-stock/zero; unknown
maintenance is not an empty maintenance list; and an unavailable primary menu
is not an empty menu. Both row and bulk deletion are disabled for incompletely
loaded menu details, preventing Undo from restoring guessed fields. Reserved
tables are excluded from seating options even when the backend recommends one.
An unknown table status disables seating or exposes Retry with no Available
cards on Legacy/Tournament floors. All writes and external requests are blocked.

Tournament fixtures follow the actual backend serializer, including list/detail
endpoints and players/matches. An initial invented detail response incorrectly
retained the backend's 404; it is not acceptance evidence. The test now explicitly
returns 200 for that read fixture and asserts the bracket really loaded. That
exposed the real 99.296875px mobile control overflow and selected-event contrast
failures in both themes. The final populated partial/extreme samples pass. A
concurrent-run initial-read deadline miss is retained under `tournaments/after`;
the final serial six-state result is `tournaments/after-serial`, all 48 clean.

Sixteen Owner Inventory/Waitlist dialog cases and eight Staff Waitlist cases
pass: pending feedback 28.0-179.7ms, exactly one browser-mocked held submission
then HTTP 500 per case, disabled close/discard while pending, retained form input,
strict error contrast, Tab/Shift+Tab containment, filled-field Escape guard,
Escape dismissal/opener restoration, and one-click close with filled fields.
No business submission reaches the backend. Eight final Booking regressions
also pass in `operations-dialog-regression-final`; an earlier opener timeout
under concurrent browser load is not counted as a pass. Failure diagnostics now
retain screenshots and page/API error metadata instead of only a timeout string.

The strict 21-route contrast rerun, including safe dialogs/menus, reports zero
violations and zero errors in `operations-contrast.json`. Lint, theme guard,
production build and all 47 backend Python syntax checks pass. The current source
inventory is `source-operations.json`: five private surface roots and six private
dialog roots remain; CSS token/spacing cleanup and the 20-cycle real UI lifecycle
are still OPEN. Browser widths do not certify physical devices or a full-day
unfamiliar-user trial.

Separate backend discovery, not changed in this UI release: Waitlist's backend
availability helper excludes active and maintenance tables but does not consult
bookings. The UI now refuses a reserved recommendation using canonical table
status; server-side reservation/seating policy still needs its own reviewed
contract rather than a silent policy change in a presentation pass.

Operations source `70b6d33` and evidence through `e32ebba` are merged, pushed and
production-verified. `deployment-remaining-operations.json` matches all 24 current
JS/CSS hashes, confirms unchanged backend ancestry and health/database readiness
200. The first backend probe timed out and was not accepted as deployment proof;
the following complete observation passed. After verification, guarded local
fixture cleanup confirmed zero rows in every disposable QA database table.

## Service-Page Verification

Final Peak Hour Rates and GST matrices are `pricing-rules/after-final` and
`pricing-gst/after-final`, 48 samples each after the final header correction.
Audit and Status each pass 48 in `after`; Help, Changelog, Sample Workspace and
404 each pass eight applicable default samples. Total: 224 final page samples
at 375/768/1024/1440px in light/dark. Static pages are not assigned fictional
loading/error states. GST's earlier concurrent initial-read deadline misses
remain under `pricing-gst/after`; the isolated rerun and final rerun pass.
Chrome launch timeouts on Sample Workspace were infrastructure failures, not
passes; its baseline and after captures were subsequently completed.

The current pre-service pricing captures are kept under `service-initial`.
They expose zero-width mobile rule labels and Delete extending to
x=379.484375 at a 375px viewport. Afterward neither text nor controls clip.
The panel title/description now stack inside the existing structure; rates,
fonts and palette do not change. Peak Hours uses shared Panel and EmptyState.
GST's maximum now matches the existing backend's 28 rather than 100, and empty,
out-of-range or nonfinite form values cannot become accidental zero/default
writes. These are server-contract alignment fixes, not tax/business-policy changes.

`service-contract/after-final` has 52 passing cases: 20 malformed/read-integrity
cases, 24 held-save cases and eight isolated sample-data lifecycles. Each save
is browser-mocked pending then HTTP 500; no business write reaches the backend.
After the final pricing header adjustment, all 16 affected save cases were rerun
in `after-pricing-final`: pending feedback 12.8–14.5ms, invalid GST/hour inputs
produce no request, valid input remains after failure, exactly one mocked save
per case, clean settled hover/default contrast. The guide-review action already
uses the shared async-button feedback; its measured 48.2–74.3ms is a verification,
not a newly invented UI fix. Its Shortcuts dialog opens, traps focus and closes
with Escape. Sample tabs contain 5 tables / 10 members / 3 bookings / 2 orders;
clicks close a sample table, navigate tabs with Home, reset and delete the data,
all without database writes.

All four before read cases falsely claim Ready for an empty HTTP 200 readiness
body; all four final cases correctly withhold that claim. All four before
unknown-rate cases claim Standard active; none do afterward. A single critical
audit row produces Risk Actions 0 before -> 1 after, with a redundant warning
cue. Missing actor/severity produces known-looking 1/0 before -> dashes and
recovery afterward. A malformed audit object is not reported as an empty list.
The same 28 Operations read contracts pass again in
`service-operations-regression`, covering the shared collection-shape guard.

The initial Help test intercepted POST but the actual setup method is PATCH;
eight writes were safely blocked, not sent. Those probes are not passes. The
corrected baseline is `before-help-final` and the complete final test mocks the
actual PATCH. An initial post-enable/pre-paint contrast sample is not treated
as a settled hover result: the final contract waits finite transitions and two
paint frames, then separately checks hover and default states using the same
rendered-contrast method as the main scanner. Earlier probe reports/captures are
retained under `service-contract/before` and `after`, not used as final acceptance.

The final strict 21-route scanner reports zero violations and zero errors in
`service-contrast.json`; lint/theme guard pass. `source-service-pages.json`
still records four private session-money surface roots, six private dialog
roots and outstanding CSS color/spacing token consolidation. Remaining shared
overlay/menu/action coverage and the real 20-cycle UI lifecycle are OPEN; physical
devices and unfamiliar-user full-day acceptance are not certified. SSE expansion
remains paused.

Service-page source `9e439ec` and its evidence through `0edabe1` are merged and
pushed. `deployment-service-pages.json` verifies all 24 production JS/CSS hashes,
unchanged backend ancestry, health 200 and database readiness 200. Initial backend
timeouts were not accepted as readiness proof; the subsequent complete observation
passed. Evidence uploads needed resumptions after HTTP 408 and a transient GitHub
DNS failure. Remote receipt/ancestry was checked, with no force-push or rewriting
of published commits. The guarded disposable database was cleared again: zero
rows remained. All five temporary QA servers exited; the user's original checkout
and port 5173 server were not touched.

Separate real-time observation: when collecting the stopped local QA backend's
output, `sse_starlette.sse.SendTimeoutError` traces were present. The captured
output does not establish timestamped attribution or production relevance. This
UI pass does not certify SSE soak/memory behavior; retain this diagnostic for the
paused real-time work rather than silently claiming a clean SSE soak.
