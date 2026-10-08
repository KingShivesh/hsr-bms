# SNOOK-derived HSR theme

Approved source: https://www.snook.in/#modes, inspected live on 2026-10-08.
This adopts its palette and font families, not its consumer/mobile scoring layout.
The existing Vite/React/FastAPI application and business data remain in place.

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#0B0B0F` | `#FAFAFA` |
| Card | `#111116` | `#F4F4F4` |
| Overlay | `#1A1A22` | `#FAFAFA` |
| Border | `#25252C` | `#DEDEE4` |
| Primary/active | `#00FF7F` | `#006B3C` |
| On primary | `#07120D` | `#FAFAFA` |
| Primary text | `#FAFAFA` | `#18181B` |
| Secondary text | `#B4B4BD` | `#52525B` |
| Muted text | `#92929F` | `#62626C` |

Live SNOOK computed body font: `Syne, "Syne Fallback", Syne, sans-serif`.
Its numeric UI uses `"DM Mono", "DM Mono Fallback"`. HSR self-hosts Syne
Variable (400–800) and DM Mono (400/500) through Fontsource. Numeric values
use the real 500 face, not synthetic 900 weight. Interface headings use 600
to fit a dense operations tool; SNOOK's marketing title computes to 48px/900.

`frontend/src/design-tokens.css` owns the primitive-to-semantic contract.
Existing shared components consume these aliases; table-specific component
tokens live in `table-states.css`, derived from `config/tableStatus.js`.
The theme guard checks all three stylesheets. No new remote font CDN is needed.

Neon buttons use dark text; secondary values remain neutral. Warning/error
colors retain separate semantic roles. Dark surfaces use borders rather than
shadows. Light mode uses a darker green to keep small labels readable.

Evidence and measured acceptance results: [table-state audit](table-state-audit/README.md).
