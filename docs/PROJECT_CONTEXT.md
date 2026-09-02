# HSR BMS — Project Context for AI Agents

## What this is
HSR Snooker Cafe BMS — a billiards/snooker club management system for a 
single venue in Bengaluru (not multi-location). Live at 
hsr-bms.vercel.app. Real business tool, used daily by café staff — not 
a demo or portfolio piece. Prioritize correctness and stability over 
speed of new features.

## Stack
- Backend: FastAPI (Python), SQLite locally / Supabase-Postgres in 
  production, hosted on Render
- Frontend: Vite + React, plain CSS (no Tailwind/component library) — 
  design system is hand-rolled CSS custom properties in style.css
- Local dev: see backend/.env.example and frontend/.env.example for 
  setup; admin/admin123 is the seeded default login

## Design system (established, do not redefine ad hoc)
CSS custom properties defined in :root and a dark-mode override 
(body.dark class, toggled via localStorage("darkMode"), set in 
main.jsx, toggled from Topbar.jsx):
- --accent: deep emerald (matches HSR logo) — brand/primary actions 
  ONLY, never used for status meaning
- --success / --warning / --danger (+ -bg variants): status meaning 
  ONLY, never decorative
- --text-primary / --text-secondary / --text-muted: content text
- --text-on-accent: text sitting ON the accent color or a dark/colored 
  surface (added specifically to fix a recurring misuse bug — see 
  "Known anti-pattern" below)
- --surface / --surface-muted / --border: backgrounds and borders
- Full type scale, spacing scale (4/8/12/16/20/24px), and button/icon 
  size tiers also defined — check style.css :root before introducing 
  any new value

## Shared components (use these, don't reimplement)
- MetricCard / ui-metric-card — the canonical stat card. Multiple 
  pages previously had their own local duplicate stat-card 
  implementations that silently missed dark-mode fixes applied to the 
  shared one (ReportsTab.jsx and ClubSuiteTab.jsx both had this bug, 
  both migrated to MetricCard — see git history around commit 
  b88556b). If you find another local stat-card-like component 
  anywhere, migrate it, don't leave it duplicated.
- Toast.jsx / .app-toast* — the toast/notification system. Classes 
  are namespaced with app- prefix specifically because a bare .toast 
  class collided with a third-party (Bootstrap) CSS rule and made the 
  Undo button invisible/unclickable in production while all builds and 
  lint passed. See "Known anti-pattern" below — this bug class is the 
  most important lesson from this project so far.

## KNOWN ANTI-PATTERN — read before touching CSS
This codebase has repeatedly had bugs that pass lint/build/type-check 
but are invisible until actually rendered and clicked in a browser:
1. A custom `.toast` class collided with a third-party `.toast:not(.show)` 
   rule, making an Undo button exist in the DOM but have zero visible 
   size — unclickable for real users, not just test automation.
2. Multiple components used `var(--text-primary)` (a TEXT color token) 
   as a BACKGROUND/fill value — this "worked" by coincidence in light 
   mode and produced invisible dark-on-dark text in dark mode.
3. At least 3 separate CSS blocks for the same component (a "running 
   strip" gradient, sidebar background/text, and a stat card) existed 
   as duplicate/legacy versions alongside a newer correct version — 
   dark mode fixes were applied to the new version while the old dead-
   or-still-rendering version kept the bug.

RULE: any CSS/theme change must be verified by actually rendering it 
in a browser in BOTH light and dark mode — "the build passed" is not 
sufficient evidence a UI change works. If browser tooling isn't 
available in a session, log the item as OPEN/unverified explicitly 
rather than assuming it's fine — don't mark anything "done" on the 
strength of a compile pass alone.

## Current progress — see docs/interaction-design-progress.md
That file has the full checklist. Summary as of last update:

LANE A (undo-toast rollout, micro-copy, icon consistency, theme audit) 
— CLOSED. All items browser-verified in both themes.

LANE B (notification/toast polish, skeleton loading, keyboard nav) — 
IN PROGRESS:
- B1 (toast status icons + bell/notification audit) — DONE, committed 
  and browser-verified in both themes (commit 59657b1). Bell icon 
  confirmed to already be genuinely wired to real data (Notification 
  Center pulling from maintenance/waitlist/missed-bookings/audit 
  logs) — not a gap, already satisfied.
- B2 (skeleton-first loading state on Food & Cafe POS) — IN PROGRESS, 
  UNCOMMITTED as of last session interruption. A custom FoodPosSkeleton 
  component was built matching the real page layout (tab rail, 
  toolbar, category row, 5-column menu grid, order panel), with a 
  dark-mode override extension for the new skeleton pieces. This last 
  piece (the dark-mode override) was NEVER VERIFIED IN BROWSER before 
  the session ended — do this first before anything else.
- B3 (keyboard navigation: Esc/Enter/arrow keys on Table Floor) — NOT 
  STARTED.

LANE C (inline editing, bulk actions, global search, optimistic UI 
updates) — NOT STARTED. These are flagged as higher-risk and should 
follow the same rigorous diagnose-fix-verify process as the toast bug, 
not the faster pace used for Lane A/B.

## Process rules to follow
1. Work on a dedicated branch (was codex/interaction-design-safety-pass 
   in the prior tool — confirm current branch, don't assume).
2. One item at a time. Commit each separately with a clear message.
3. Verify in an actual running browser before marking anything done — 
   see anti-pattern section above.
4. Test with clearly-labeled QA data ("QA Test [timestamp]") and 
   always confirm zero QA records left active/upcoming afterward.
5. If interrupted mid-task: check git status first, don't guess-fix 
   uncommitted work — either verify it's complete and safe to keep, or 
   revert it, but don't leave ambiguity.
6. Update docs/interaction-design-progress.md as items close.
7. This is a real production tool for a real café — prioritize not 
   breaking existing functionality over adding new features.
