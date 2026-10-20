# UI Readiness Scan

This is the user's new UI-only bug-fix priority, not completion of Day 1 or
authorization for Day 2. The pilot, full-stack security audit and production
restore gates remain incomplete. No new product features or redesigns are in
scope. Preserve Syne + DM Mono, both approved palettes, table-state cues,
trusted Staff time editing and server-authoritative billing.

## Coverage

Every width below is tested in light and dark mode. `Pending` is not a pass.

| Screen / Cluster | 375 | 768 | 1024 | 1440 | 1920 | States / Status |
| --- | --- | --- | --- | --- | --- | --- |
| Login | Pass | Pass | Pass | Pass | Pass | 60 samples: default, filled, pending, invalid credentials, server error, offline |
| Dashboard | Pass | Pass | Pass | Pass | Pass | 60 samples: default, loading, error/retry, empty, partial, extreme |
| Live Floor | Pass | Pass | Pass | Pass | Pass | 60 samples: default, loading, error/retry, empty/reload, partial, extreme (20-hour timer and large totals) |
| Checkout | Pass | Pass | Pass | Pass | Pass | 60 samples: default, quote loading, server failure, missing quote, partial, extreme; zero settlements |
| Members / detail | Pass | Pass | Pass | Pass | Pass | 60 page samples + 10 drawer samples; all 500 records accessible over 21 pages, max 24 cards, no duplicate IDs, both themes |
| Bookings | Pass | Pass | Pass | Pass | Pass | 60 page + 10 form samples; focus trap/Escape; pending/failure test in both themes |
| Cafe / orders | Pass | Pass | Pass | Pass | Pass | 60 New Order + 40 Stats + 40 History samples; separate 100-item cart and empty-action closeout below |
| Sales / receipt | Pass | Pass | Pass | Pass | Pass | 60 page + 10 drawer samples; all 1,000 receipts reached once over 40 pages, 25 rows/page |
| Analytics / reports | Pass | Pass | Pass | Pass | Pass | 300 matrix samples + 20 empty-panel rechecks; 16 focused after cases: direct Retry recovery, 1,000 Bills/40 pages, obsolete-period response ignored |
| Settings | Pass | Pass | Pass | Pass | Pass | Operations/Team/Account/Activity: 240 clean samples; Club Profile: 60 clean samples including extreme name; Billing: 20 no-fetch checks |
| Other routes / error pages | Pass | Pass | Pass | Pass | Pass | Inventory, Waitlist, Advanced Controls, Tournaments, Closing, Pricing, Audit and Status: 480 clean samples; Help/Changelog/Demo/404: 40 default samples (data-fetch states N/A). Eighteen focused after recovery cases pass |
| Shared dialogs / tooltips | Pass | Pass | Pass | Pass | Pass | 40 after dialog samples: bounds, touch targets, focus trap/Escape. Ten after tooltip samples in bounds. Separate keyboard/scroll-lock checks in both themes |
| Command palette | Pass | Pass | Pass | Pass | Pass | 10 after cases; immediate static commands during seven held reads, keyboard navigation, Retry, partial/null rows and Clear search; 31-50.5ms feedback |

## Findings

| Screen | Defect | Severity | Fix / Verification |
| --- | --- | --- | --- |
| Login | Invalid credentials showed a message, but neither field exposed the error association or invalid state. | Medium | Both fields reference the error, show error borders and expose `aria-invalid`; server failures do not falsely mark credentials invalid. Added a next step. |
| Login / tablet controls | At 768px, Sign in was 36px high instead of touch-safe 44px. | Medium | Shared 44px boundary includes 768px; all Login widths remeasured. |
| Login / shared request errors | Offline/server messages exposed Render logs and `VITE_API_URL` instead of recovery instructions. | Medium | Human-readable network/server messages; generic 403/404 include next steps without replacing domain-specific validation. |
| Shared buttons | Accessible label could disappear briefly when a pending label was still hidden but `aria-busy` had cleared. | Medium | Keep a text-derived accessible name in every state; preserve explicit labels. |
| Contrast evidence | Gradient samples could use a frame painted before glyph masking settled. | Test defect | Wait two animation frames after masking; retained tests prove real visible violations are still detected and clipped/occluded text is excluded. No palette change. |
| Dashboard / shared shell | At 768px an obsolete hover-width rule expanded the sidebar over content while retaining a 64px content offset. | High | Removed obsolete shell rules; matched compact-rail breakpoints, including logo/menu placement. Before screenshot shows covered heading/KPIs; after does not. |
| Dashboard / topbar | Truncated subtitle had no way to inspect full text; icon-only mobile primary action had no name. | Medium | Full subtitle tooltip and explicit primary-action accessible label. |
| Dashboard | An empty table response rendered a blank floor panel labelled five idle tables. | Medium | Explicit no-table-data state and existing Live Floor recovery action; no fabricated table-creation feature. |
| Live Floor | Empty table response exposed implementation wording and no recovery. | Medium | Shared empty state explains the missing data and offers Reload tables. Both themes/all widths clean. |
| Checkout | Initial quote failure/missing response left no in-drawer retry. | High | Added Retry quote, separate from settlement; 60 after samples, no app errors or settlement requests. |
| Members | Large spend overflowed metrics and narrow stat cells; long names widened cards and collided with IDs. | High | Existing type-scale size for dense metric values; bounded card tracks, full-value spend row and title-backed name ellipsis. All five widths rechecked. |
| Members | 500 records rendered without pagination. | Medium | Shared client-side pager; browser traversed all 21 pages, found all 500 IDs exactly once and verified search resets the page. No backend changes. |
| Member drawer | 100-character unbroken name pushed Close off-screen; drawer sat inside the page's stacking context. | High | Portal-backed drawer, constrained header/title tooltip, bounded content. Close visible at all five widths; focus trapping and Escape pass. |
| Members | Search had no persistent accessible label; card-level Enter handling also caught nested action buttons. | Medium | Named search and card-target-only keyboard handler; retained existing action safeguards. |
| Bookings | Cancel remained enabled during create, allowing dismissal while the request was pending. | High | Pending form/inputs/Cancel are disabled; Escape blocked. Before test reproduced dismissal; after keeps form/draft and shows failure. Feedback 9.8/17.5ms; one intercepted POST per theme, zero saved bookings. |
| Bookings | Search lacked a persistent label; cancel copy said Discard although the draft was retained. | Medium | Named search, accurate Cancel copy, readable error and safe empty-form backdrop dismissal. Dates use the shared club-time formatter. |
| Cafe Stats / History | Null revenue and missing item arrays each crashed their tab into the route recovery screen. | High | Currency formatter and safe item-detail fallback; 80 sub-tab after samples clean, including partial-data fixtures. |
| Cafe | Customer/table/player fields lacked persistent labels; several amounts skipped Indian grouping. | Medium | Named controls and shared currency/date formatting; no submission/calculation changes. |
| Sales | Only 80 of 1,000 supplied receipts were rendered, without pagination or a way to reach the rest. | High | Removed silent cutoff, reused shared pagination; traversed all 40 pages in both themes with no missing or duplicate receipt IDs. |
| Sales | Large totals overflowed a 1024px metric; receipt rows were pointer-only and long-name drawer Close could escape the viewport. | High | Shared value-density handling via existing type tokens, keyboard receipt button, bounded table names and portal-backed receipt drawer. 60 page + 10 drawer samples clean. |
| Reports | First requests displayed zero/empty content without a skeleton; customer rankings and table performance crashed on missing amounts; failed Analytics stayed on its skeleton indefinitely. | High | Initial per-region skeletons, explicit error/retry, guarded display values/arrays and stale-period response protection. All five tabs: 300 after samples clean. Direct recovery and obsolete-response checks pass in both themes. |
| Reports / Bills | History was unbounded and filters could leave the selected page out of range. | Medium | Reused 25-row pagination with filter resets/page clamping. All 1,000 IDs reached once over 40 pages in each theme; filter and shorter-response clamping checks pass. |
| Reports / Analytics | A wide empty-table preview forced its explanatory text beyond the mobile card. | Medium | Bounded grid track and internal table scrolling; added a panel-overflow assertion. Twenty rechecks clean. |
| Settings | Eleven controls had visually adjacent but unassociated labels; Account and Activity crashed on null team/actions. | High | Associated labels/IDs, safe collections/counts and null action fallback. Operations, Account, Team and Activity matrices clean. |
| Settings / profile and billing | Profile refresh errors disappeared once a form existed; static subscription information depended on an unrelated account request. | Medium | Keep profile Retry visible with the draft; render the truthful unconfigured-billing state without account fetching. No subscription feature added. |
| Inventory / Closing / Pricing / Tournaments | Maintenance, notes, peak-hour and event controls had unnamed inputs. | Medium | Named controls or associated visible labels; matrices clean at all widths. |
| Advanced Table Controls | 1024px command area overflowed by 68px (136px with extreme names); nine inputs had no name; first floor failures silently rendered idle/default data. | High | Wrapping bounded command rows, named inputs, initial skeleton, visible retry and missing-status recovery. All 60 after samples clean; no availability inferred from missing floor data. |
| Shared auth | A stale old-token rejection could clear a newer login; expiry redirected without explanation. | High | Matching-token invalidation and a one-shot sign-in notice. Twenty isolated source cases and ten browser cases pass. No token-refresh feature added. |
| Shared overlays / tooltips | Dialogs leaked background scrolling and fixed-position pseudo tooltips extended off-screen. | Medium | Reference-counted scroll locking, contained overlay scrolling and existing Popper-backed tooltip placement. Twenty before/after viewport samples; both themes pass behavior checks. |
| Shared notifications | Errors auto-dismissed without Close and actionable feedback sat outside the dialog keyboard boundary. | Medium | Manual error dismissal, 4s success/6s info defaults, hover/focus timer suspension and feedback inside the top dialog. Both-theme lifecycle checks pass: focused Undo survives 5.5s; exit measures 126.1/123.2ms; timers resume after dialog removal. |
| Session reminders | Multiple threshold notifications from the same session accumulated over content. | Medium | Replace previous threshold UI with the latest, retain IDs to prevent reappearance, cap the scrollable warning stack at 25dvh. Four dedicated cases pass with sixteen screenshots; warnings stay below checkout. |
| Command palette | All page shortcuts disappeared while seven live-data requests were pending; partial arrays could break search. | High | Keep static shortcuts available immediately, skeleton only for live results, Retry notice and guarded arrays. Ten after cases pass at all widths/both themes, including keyboard navigation before data arrives. |
| Advanced controls | A stalled optional queue/booking request could hide otherwise healthy floor controls. | High | Floor controls settle independently; auxiliary panels retain their own loading/error states. Held-request regression verifies five table actions remain visible. |
| Sales / Reports | Date unification initially removed the year from historical receipts. | Regression caught before shipping | Shared formatter has an explicit historical-year option; 2024 and 2025 rows verified separately in both themes at 375px and 1440px. |
| Bookings / mobile overlay | A page-local stacking context put Close beneath the topbar despite apparently valid modal bounds. | High | Body portal and existing checkout-level layer; center hit-testing and actual trusted Close clicks pass at all five widths/both themes. Twenty before/after cases, forty screenshots, zero degraded cases. |
| Cafe / extreme cart | Long names widened the cart; 100 lines made it tens of thousands of pixels tall; an oversized sticky order could strand checkout below the viewport. | High | Bounded scrollable item list, title-backed ellipsis, token-based large-value sizing, viewport-bounded desktop order region. Fourteen after cases / 324 checks pass, including exact totals, detail focus and actual wheel reachability. No order submitted. |
| Advanced Controls / Book table | An inherited Live Floor mobile-sheet rule fixed the inline session workspace over the booking button at 375/414px. | High | Scoped positioning reset below 1180px only in Advanced Controls. Before: four mobile failures / two desktop passes. After: six passes with actual pointer hover/click and native required-field feedback; no booking created. |

## Evidence

- [Login before](login/before/results.json) and [after](login/after/results.json).
- [375px dark before](login/before/dark-375-error.png) /
  [after](login/after/dark-375-error.png).
- [375px light before](login/before/light-375-error.png) /
  [after](login/after/light-375-error.png).
- [Shared async button checks](async-buttons.json).
- [Dashboard before](dashboard/before/results.json) and [after](dashboard/after/results.json).
- Tablet light [before](dashboard/before/light-768-default.png) / [after](dashboard/after/light-768-default.png).
- Tablet dark [before](dashboard/before/dark-768-default.png) / [after](dashboard/after/dark-768-default.png).

Unsupported signup, password-recovery, dynamic-table creation or tenant-switching
screens are not fabricated. Styled native selects keep browser keyboard behavior;
the operating-system popup is not replaced solely to animate it. Saturated active
and attention table states keep their approved border/shape redundancy.

## Visual Comparisons

Every comparison uses original screenshot pixels: **before left, after right;
light above, dark below**. Tall captures show their first 1,000 pixels; the
full captures remain beside each result file. The [manifest](comparisons/manifest.json)
records source paths and SHA-256 hashes.

| Screen | Before / After, Both Themes |
| --- | --- |
| Login | [Comparison](comparisons/login.png) |
| Dashboard / tablet shell | [Comparison](comparisons/dashboard.png) |
| Live Floor | [Comparison](comparisons/live-floor.png) |
| Checkout | [Comparison](comparisons/checkout.png) |
| Members | [Comparison](comparisons/members.png) |
| Bookings | [Pending form](comparisons/bookings.png), [mobile Close layer](comparisons/booking-layer.png) |
| Cafe Stats / History | [Stats](comparisons/cafe-stats.png), [History](comparisons/cafe-history.png) |
| Sales | [Comparison](comparisons/sales.png) |
| Reports | [Bills](comparisons/reports-bills.png), [Tables](comparisons/reports-tables.png), [Analytics](comparisons/reports-analytics.png), [Session edits](comparisons/reports-session-edits.png) |
| Settings | [Operations](comparisons/settings.png), [Account](comparisons/settings-account.png), [Activity](comparisons/settings-activity.png) |
| Inventory / Advanced Controls | [Inventory](comparisons/inventory.png), [Controls](comparisons/legacy-controls.png), [Book table overlap](comparisons/advanced-book-pointer.png) |
| Tournaments / Closing / Pricing / Status | [Tournaments](comparisons/tournaments.png), [Closing](comparisons/closing.png), [Pricing](comparisons/pricing.png), [Status](comparisons/status.png) |
| Tooltips / session warnings | [Tooltips](comparisons/tooltips.png), [Warnings](comparisons/reminders.png) |
| Command palette / Cafe extremes | [Commands](comparisons/command.png), [Cart footer](comparisons/cafe-cart.png), [Large amount](comparisons/cafe-large-amount.png) |

### Focused Regression Evidence

- [Booking layering and original core retry dispositions](booking-close-layer/results.json): ten after configurations pass; preserves the original raw retry's 68 passes / ten unreachable entries, with individual explanations rather than rewriting history.
- [Command palette](command/after/results.json): ten after configurations pass with fifty screenshots; all static shortcuts remain available during held live reads.
- [Cafe extremes](cafe-extreme/after/results.json): fourteen cases, 324 checks; no overflow, altered totals or business writes. Wheel reachability is tested over the actual order-region edge, not unrelated menu content.
- [Reminder stack](reminder-stack/after-results.json): four cases pass; only latest threshold visible for each session, old IDs do not reappear, stack at most 25dvh and below checkout.
- [Toast / dialog lifecycle](feedback-lifecycle/results.json): both themes pass. Test isolation holds dev-server reload messages; component behavior and timing assertions are unchanged.
- [Review regressions](review-regressions/results.json): nineteen checks pass; optional requests cannot hide floor, historical years remain distinct, focused toast resumes on dialog removal.
- [Checkout safety regression](checkout-regression/results.json): trusted Staff time preview, retained draft/confirmation, blocked pending dismissal, zero duplicate settlement attempts and zero size shift. Payment failure is browser-intercepted, not a successful settlement.
- [Shared navigation retry](button-feedback/shell-final.json): 44/44 actual button feedback checks pass, no degraded screens or business writes.
- [Live production login](production-login/results.json): ten real deployed-page captures, both themes/all five widths, zero layout/contrast faults or page errors; no credentials submitted. Computed font remains Syne Variable; accents remain `#006B3C` / `#00FF7F`.
- [Advanced Controls pointer test](advanced-book-pointer/after/results.json): 6/6 pass at 375/414/1440px in both themes after the narrowly scoped mobile positioning fix; [before](advanced-book-pointer/before/results.json) preserves the four reproduced failures.
- [Session / food / credit regression](session-regression/results.json): twenty checks, twenty-four screenshots, zero contrast/page errors. Actual local cash and member-credit closes, quantity/service/cancellation/add-order flow, reconnect and polling fallback pass. This is the existing regression suite, not an SSE rollout; all mutations use the disposable local SQLite database, never production.

## Button Audit Closeout

The original raw runs remain available: [core](button-feedback/core.json),
[other pages](button-feedback/remaining.json) and [shared shell](button-feedback/shell.json).
They contain 1,837 observations across repeated pages, states, widths and themes,
not 1,837 distinct controls. **Their raw unreachable / expired-token results are
not converted into passes.**

| Finding | Disposition / Evidence |
| --- | --- |
| Booking Close button covered by header | Fixed; ten after configurations pass in [layer test](booking-close-layer/results.json). |
| Advanced Book table covered by session panel | Fixed; six after configurations pass in [pointer test](advanced-book-pointer/after/results.json). |
| All static command shortcuts hidden by live-data loading | Fixed; ten after configurations pass in [command test](command/after/results.json). |
| Shared-shell misses | [44/44 retry passed](button-feedback/shell-final.json). |
| Core retry: two setup timeouts | Separate focused rechecks passed; records retained in [dispositions](booking-close-layer/results.json). |
| Core retry: four reminder View/Dismiss mismatches | Explicit exclusions because reminder records were isolated out of that run; dedicated reminder suite verifies these controls instead. |
| Controls behind an open modal | Thirty explicit modal-background exclusions in [last retry](button-feedback/remaining-final.json), not unresponsive buttons. Modal blocking is intentional. |
| Open T4 history after opening Choose a table | Separate [recheck](button-feedback/remaining-t4-history-recheck.json) confirmed the modal opens; background history is intentionally unavailable, excluded rather than passed. |

The remaining-page raw retry reports are [first](button-feedback/remaining-retry.json)
and [last](button-feedback/remaining-final.json). The latter still says seven
passes / two unreachable: one was the subsequently fixed Book table overlap;
the other is the modal-background history case explained above. They have not
been rewritten to manufacture a clean raw run. Late overnight configurations
with an expired QA token remain invalid coverage, even where other page fixtures
and focused checks cover the same controls. This is a bounded audit, not a claim
that every unavailable record, hidden branch or hypothetical six-state combination
has been clicked.

## Verification Boundaries

- All browser business writes in the scan matrices were mocked or blocked. Local
  QA login is real. Approved QA reads can reconcile the disposable local database;
  this is not a claim of zero database effects. No production business data was mutated.
- The six fixture states are default, loading, error/retry, empty, partial and
  extreme. Static Help/Changelog/Demo/404 and static subscription information do
  not acquire fictional network states or unsupported creation actions.
- The [contrast scan](contrast.json) covers 27 routes in both themes plus safe
  dynamic surfaces: zero violations and zero page errors. It uses WCAG 4.5:1 body /
  3:1 large-text thresholds; disabled controls are exempt. It is not a claim that
  every disabled glyph or every unrendered state has been pixel-tested.
- Button feedback is distinct from business success. The bounded button audit
  blocks writes, records exploration limits and labels unmeasured controls rather
  than passing them. Hover/focus/pressed crops are real; naturally unavailable
  loading/disabled states are not invented. The universal pending-button fixture
  separately verifies duplicate prevention, spinner visibility and zero size shift.
- The overnight remaining-button run outlived its 24-hour QA JWT. Its late 401 /
  redirected / degraded configurations are invalid coverage, not application faults.
  Retry results remain separate from originals. The reusable scanner now refreshes
  its *local QA login* on long runs; application token-refresh behavior is unchanged.
- Native selects remain styled and retain OS keyboard/popup behavior. Their
  platform popup is not replaced merely to imitate custom dropdown animation.
- Financial writes retain server-authoritative confirmation. A failed payment
  is not optimistically marked paid or automatically retried.
- Some captures predate later fixes in this same pass. Each focused regression
  records the surface/build it actually exercised; an old screenshot is not
  presented as evidence for an unrelated later change.
- Real QA timers naturally advanced between some default captures; differences
  in those values are not evidence of changed business calculations.

This UI pass does not close the existing pilot, security audit, production restore,
or 24-hour/no-refresh backlog gates. Final closeout and deployment proof follow below.

## Deployment

The application commits `ebc256f`, `9626ec8`, `fe3371e` and reusable-tool commit
`ec185fb` were fast-forward merged into `main` and pushed. There were no merge
conflicts. [Deployment evidence](deployment.json) confirms the served JS/CSS
SHA-256 values match the production-address build, not merely a successful push.
The backend remains at its unchanged `e014ff4` revision, with `/health` and `/ready`
both 200 and the database ready. Earlier timeout observations remain in the evidence.

Source lint, production build, theme guard, twenty auth-expiry cases, existing
single-connection-manager tests and syntax parsing of all 47 backend Python files
passed. No backend source or dependency changes were made by this UI pass.

The separately verified Advanced Controls follow-up `db10dbb` was also
fast-forward merged and pushed. [Final deployment evidence](deployment.json)
matches all 23 served JS/CSS files, including entry `index-PkPBjIDl.js` and CSS
`index-DEb7ftdp.css`; frontend HTTP 200, backend health 200, database readiness 200.
The [initial deployment record](deployment-initial.json) is preserved separately.
No completed application changes remain unmerged. The screenshot gallery contains
29 both-theme before/after sheets and retains its full-resolution source captures.

After the local mutation regression, cleanup reported **zero rows in all disposable
QA database tables**. All four QA-only servers were stopped; the user's original
checkout and existing development server were not changed or stopped.
