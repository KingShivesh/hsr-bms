# HSR presentation verification

This pass consolidates presentation and interaction without adding features or
changing backend endpoints, pricing calculations, session identity, or SSE
subscriptions. Syne and DM Mono remain the application fonts. The existing
SNOOK colors remain unchanged.

## Visual evidence

- [Every route before and after](index.html): actual Chrome screenshots from
  untouched main and the new shared presentation, using the same disposable
  local database. Light and dark, 1440px desktop and selected 375px/414px mobile
  screens. Root redirects to Live Floor.
- [Dashboard comparison](dashboard-before-after.png).
- [Syne and Inter comparison](font-comparison/index.html): 16 matched previews
  across Dashboard, Live Floor, Settings, themes, and Dashboard mobile. Inter
  was injected into the browser only; no application dependency or font token
  was changed. Numbers remain DM Mono in both previews.
- [Before measurements](before/measurements.json) and
  [after measurements](after/measurements.json).
- [Contrast output](contrast.json) and [interaction output](controls.json).
- [Dark button audit](buttons-dark.json) and [light button audit](buttons-light.json).

## Applied changes

| Page or cluster | Fault | Rule | Fix applied | Before and after |
| --- | --- | --- | --- | --- |
| All routes | Eight visible text sizes, mixed native controls, external icon font | Shared scale and controls | Seven token sizes; shared Button/Input/Select/Textarea/Table; Lucide stroke 1.5 | Gallery and measurements |
| Dashboard | Default-looking zero state during first fetch; tight action labels wrap | Honest loading and readable actions | KPI/floor skeletons, retry state, standardized control spacing | dashboard images in both themes |
| Live Floor and Advanced Controls | Different action sizing and weak selected-control text | Consistent actions; readable selection | Shared controls, preserved state fills and status borders; selected text uses primary text role | live-floor and legacy-table-controls pairs |
| Bookings, Customers and Waitlist | Local control and table styling | Shared form/table rhythm | Shared controls, input focus treatment and numeric alignment | bookings, customers and waitlist pairs |
| Cafe POS and Inventory | Local icons and control sizing | One icon/control system | Lucide and shared buttons/inputs without changing stock/order handling | cafe-pos and inventory pairs |
| Sales, Analytics and Closing | Local monetary formatters and table treatment | Consistent financial presentation | Shared en-IN money/duration formatting, right-aligned marked numeric columns, shared tables | sales, analytics and daily-closing pairs |
| Settings and Pricing | Saves have no explicit busy state; editable defaults appear after fetch failure | Immediate feedback and safe errors | Save spinners/disabled state, no width shift, skeleton-first settings and retry | settings pairs plus saving/error captures |
| Tournament and Audit Log | Local typography and controls | Shared presentation | Token scale, shared buttons/tables/icons | tournaments and audit-log pairs |
| Login and dialogs | Separate control styles; first Escape only blurs a filled field | Consistent controls and keyboard response | Shared login loading treatment; Escape closes the active dialog | login and start-dialog pairs |

## Measured results

The full layout run has 66 samples, zero page errors, zero horizontal-overflow
samples, zero off-scale visible text, and zero unshared visible controls. The
visible sizes changed from 10/12/14/16/18/22/24/28 to
11/13/14/16/20/24/32px. Meta-K, Ctrl-K, arrows/Enter and Escape passed in both
themes. The contrast scan covers loaded routes, login failure, popovers,
command palette and the first safe action: **0 violations, 0 errors**.

With REST delayed 700ms, Settings Save Table Rates showed busy feedback in
1.9ms dark / 2.9ms light. Its width remained 162.25px while loading. Tooltip
visibility, skeleton-first loading on seven data routes in both themes, and
the absence of editable settings defaults after a forced 503 all passed.
Settings test writes were intercepted; no production mutation was performed.

The actual-click audit passed 189 enabled buttons on 15 pages in each theme,
with zero failures. Each theme rendered 431 buttons in total; shared navigation
was tested once rather than repeated on every page. Paint/position feedback
was sampled after 60ms and visible page changes after 190ms, while REST was
delayed 700ms. Off-screen buttons were scrolled into view before clicking.
Dynamic row/modal actions absent from the initial fixture are outside that
count, not silently classified as passing.

The font comparison measured Executive Overview at 240.44px in Syne and
230.14px in Inter, both 24px/600. The three primary KPI values remain DM Mono,
32px/500, in both variants. Inter looks more conventional for dense labels;
Syne retains more of the established identity. Recommendation: Inter for
interface text, subject to the user's explicit choice. **No switch applied.**

## Scope and exceptions

- The requested four-weight scale conflicts with the two-weight-per-screen
  rule. Existing weights 400/500/600/700 remain; this pass does not claim a
  two-weight result. DM Mono stays at supported 400/500 rather than synthetic
  700. Letter spacing is zero under the workspace design rule.
- Semantic table-state colors, thick/dashed state borders and circular dots
  remain as previously approved. Generic cards/controls use the 6/8/12px
  radius system; circles are not made rectangular.
- The existing command palette is retained and tested. No duplicate command
  palette, onboarding flow, new route, payment feature or CSV import was added.
- No invented seven-day KPI history, unsupported deltas or decorative avatar
  hues. Those conflict with the no-new-features / preserve-colors scope.
- The baseline database is mostly empty. Route coverage is not a claim that
  every possible populated-row, sport-state or financial edge case was tested.
- Button audit excludes disabled controls, logout and native printing, and
  tests the default loaded page state rather than every nested modal state.
  It uses local forced SSE 503 with REST available to isolate button feedback;
  the separate existing realtime-manager regression passed unchanged.
- Test setup problems were corrected before final captures: local CORS allowed
  all QA origins, and the scanner waits for all visible skeletons to disappear.
  Error-state-only previews are not accepted as route coverage.

## Production verification

The presentation source commit `ab959cd` and evidence commit `f1cf95a` are
merged and pushed to main. [Deployment proof](deployment.json) confirms all
21 production JS/CSS assets match the local production build byte-for-byte,
including `index-BljHRHAv.js`. Backend health and readiness returned 200; the
unchanged backend revision `4d8a0b2` contains the required existing fixes by
commit ancestry. No backend source changed in this pass.

[Public production measurements](production/measurements.json) cover anonymous
login in both themes at 1440px, 375px and 414px. Syne is actually loaded; canvas
colors remain `#0B0B0F` / `#FAFAFA`; the title is 24px; buttons measure 36px
desktop / 44px mobile. Zero overflow, contrast violations or page errors. No
production credential entry or mutation was performed.

Final pixel inspection caught login prefix icons overlapping placeholder text
after shared input padding took precedence. The explicit leading-icon inset
now uses the shared 40px spacing token with physical left padding. [Correction comparison](input-prefix-fix/index.html)
preserves the before-production pixels and corrected light/dark screenshots.
The regression assertion measures 10px clearance and actual placeholder ink
beginning at 42-43px inside each field in all six viewport/theme samples.
Geometry alone was insufficient, so placeholder paint is checked separately.
Fonts, colors, button heights and contrast remain unchanged.

## Reproduce

Use a disposable local database, never production. Start the backend and two
frontend origins: the untouched baseline and the changed application. Set
`POLISH_APP_URL`, `POLISH_API_URL` and `POLISH_STAGE=before|after` for
`npm run test:presentation`. Set the first two variables for
`npm run test:presentation-controls`. Contrast accepts `CONTRAST_APP_URL`,
`CONTRAST_API_URL`, and `CONTRAST_REPORT_PATH`.

`compare-fonts.mjs` accepts `INTER_PREVIEW_FONT` pointing to a local Inter
Latin variable WOFF2. The preview package is installed outside the repository;
it is not a production dependency. `compose-presentation-evidence.mjs`
assembles screenshot galleries without modifying screenshot pixels.

The two normalization scripts record the structured Babel/PostCSS migration
used in this pass. They are migration tools, not part of runtime rendering.
