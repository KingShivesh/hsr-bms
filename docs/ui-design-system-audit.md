# HSR BMS UI System Audit

## Sprint 1 Scope

This sprint establishes reusable UI primitives without changing data flow, API calls, or page structure. The goal is to stop new screens from creating one-off button, badge, card, input, empty-state, and metric styles.

## Existing Drift Found

- Buttons are split across feature-specific classes such as `lf-primary-button`, `lf-card-primary`, `lf-secondary-button`, `lf-danger-button`, `btn`, `btn-primary-sm`, and `btn-danger-sm`.
- Status UI is repeated locally, especially table status pills. `TableStatusBadge` is now routed through the shared `Badge` primitive.
- Cards and panels use multiple feature prefixes (`lf-*`, `cf-*`, `ops-*`, session classes) even when they represent the same visual object.
- Form controls are mostly styled per page, which makes future CRUD screens likely to drift.
- A few headings use viewport-based `clamp()` sizing. Operational dashboard text should stay token-based and predictable.

## Shared Primitives Added

- `Button` and `IconButton`: primary, secondary, tertiary, danger, ghost, icon, loading, disabled, and size tiers.
- `Badge`: icon/dot badge with canonical tones for status and payment states.
- `Card` and `Panel`: standard surface treatment for repeated content and grouped sections.
- `Field`, `Input`, `Select`, `SearchInput`: consistent label, focus, hint, and error rhythm.
- `EmptyState`: consistent empty state structure.
- `MetricCard`, `CurrencyAmount`, `Timer`: dashboard data display primitives with tabular numbers.

## Next Migration Targets

1. Replace page-level CTA classes with `Button`.
2. Replace empty-state markup across Waitlist, Reservations, Billing, and Food POS with `EmptyState`.
3. Move page stat cards to `MetricCard`.
4. Create a shared `DataTable` once Analytics, Members, and Inventory tables are normalized.
