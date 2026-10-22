# Deployment UI Completion

Scope: the user's October 22 "Fix Everything" brief. Preserve the approved
Syne / DM Mono fonts, palette, table-state cues, trusted Staff access and
server-authoritative payment/receipt confirmation. No feature or role expansion.

## Progress

| Cluster | Status | Evidence |
| --- | --- | --- |
| Login/auth | 48 before and 48 after samples pass; four widths, both themes, six states | `login/before/`, `login/after/` |
| Dashboard/shared cards | 48 after samples pass; all four widths/both themes/six states. Shared MetricCard + 14 Card/Panel roots; 12px minimum; long-text and dense-number overflow fixed | `dashboard/before/`, `dashboard/after/` |
| Live Floor / checkout | Pending current-build rerun | Not a pass |
| Members / bookings / Cafe | Pending current-build rerun and component consolidation | Not a pass |
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

The first shared-change regression is 20 main routes x four widths x both themes
(160 loaded/default captures), all clean. It is not certification of all their
network/error/empty states; those are still being re-run in the ordered pass.
`source-before.json` lists every inventoried color with file:line and selector:
zero React color-utility/literal violations or raw form/table primitives, but
278 CSS color declarations still require token consolidation, 649 literal spacing
declarations, and remaining surface/dialog roots are tracked rather than passed.
