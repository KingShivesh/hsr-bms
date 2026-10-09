# Inline table actions and full-color states

Scope: Live Floor only. The surrounding SNOOK palette, Syne/DM Mono fonts,
other pages' table treatment, backend billing and SSE protocols are unchanged.
Baseline: `db488c3` on main, captured before editing. All screenshots and
mutation tests used the disposable local `/tmp/hsr-tariff-browser.db`, never
production or the user's primary local database.

## Interaction changes

- Available: white Start Session button opens a centered modal with customer,
  table, tariff and Single/Sharing/LP choices. No start drawer or workspace.
- Running: Pause, Food and End are on the card. Paused replaces Pause with Resume.
- Reserved: Check In opens the same modal with the reserved guest and table.
- End goes directly to the existing frozen-bill checkout. It does not close or
  charge a session until the staff member confirms payment; cancelling keeps it.
- Card body/Enter opens a detail-only slide-over: facts, order history, player
  information, activity, frames and transfer. Primary controls were removed from
  that component, and no workspace opens automatically after loading/starting.
- Controls stop card-click propagation. Pause/Resume disable immediately,
  display Working, reject duplicate clicks and restore state after failure.
- Four/ five-column desktop grids where space permits; one dense card per row on
  small mobile widths. All card actions and modal close targets are at least 44px.

## Exact accessible card colors

| State | Fill | White-text contrast | Hover |
| --- | --- | --- | --- |
| Available | `#15803D` | 5.02:1 | `#166534` |
| Running | `#DC2626` | 4.83:1 | `#B91C1C` |
| Paused | `#B45309` | 5.02:1 | `#92400E` |
| Reserved | `#2563EB` | 5.17:1 | `#1D4ED8` |

The requested `#16A34A` green and `#D97706` amber produce only 3.30:1 and
3.19:1 against white, respectively, so neither passes AA for small text.
Saturated darker green/amber, opaque white labels, and darker transparent button
overlays preserve the requested full-card colors without losing text contrast.
Primary buttons are white with state-colored text. The End button is darker and
separated from Food by 12px. Status labels/icons remain; available has a hollow
dot, running has a pulsing filled dot, paused has a pause icon/frozen timer,
reserved keeps a dashed border/clock, maintenance keeps hatching/disabled controls.
Reduced-motion disables pulse and hover motion. Attention badges use white/amber
ink, distinct from the red running surface.

## Actual verification

`after/measurements.json` contains computed colors/fonts, action dimensions,
four mobile/theme combinations and click-feedback measurements. Verified with
real browser clicks, not direct invocation of React handlers:

- Modal entry/centering in both themes; no start drawer; generic start deep-link.
- Pause, frozen timer, Resume; forced 503 reports an error and restores controls.
- Food posts to the intended table; End/cancel/confirmed payment and receipt.
- Reserved guest check-in; frame controls and open-frame checkout guard.
- 375px/414px, both themes: zero horizontal overflow, every enabled card action
  unobscured and at least 44px, modal entirely inside the 896px-high viewport.
- Feedback was below 200ms with 350ms artificial REST delays.
- Separate full tariff regression: `tariff-regression.json`. Locked frame price
  remains INR 80 after catalog change, two completed frames charge INR 160;
  deleted catalog package remains INR 500; advanced controls/history preserved.
- Lint/build/theme guard and shared SSE manager test pass. The manager still
  uses at most one stream; forced 503 fallback works; zero retained subscribers.
- `contrast.json`: all 16 routes, both themes and dynamic states, zero violations.

Two actual interaction failures were caught and fixed during verification:
legacy mobile hover expanded the rail over table buttons; route-animation
stacking placed the new detail close button underneath the header. Mobile rail
expansion now requires its menu button. Live Floor overlays opt into body portals;
other shared Modal/Drawer callers retain their existing default behavior.

## Visual evidence

- `floor-before-after.png`: original and changed floor, light and dark.
- `start-before-after.png`: original and changed start modal, light and dark.
- `after/mobile-*`: actual mobile cards and modal screenshots.
- `after/states-blurred-*`: actual CDP `blurredVision` captures, not CSS blur.

A physical six-foot wall-tablet readability check needs the user's confirmation;
browser tests do not establish viewing distance or physical screen size.

## Reproduce

Run an isolated backend on 8002 using the fixed disposable database path above
and the frontend on 5175 with `VITE_API_URL=http://127.0.0.1:8002`.
Then run `node scripts/verify-inline-table-actions.mjs` from frontend. The test
refuses non-QA active sessions and cleans its temporary records afterwards.
`node scripts/compose-inline-table-evidence.mjs` builds the side-by-side images.
Use `TARIFF_AUDIT_DIR` when rerunning the tariff script to avoid replacing
historical release evidence. Production verification is read-only bundle
byte-hash comparison against the exact local release build.
