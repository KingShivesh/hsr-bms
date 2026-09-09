# Interaction Design Progress

## Current Verification Notes

- A1 CLOSED: browser/API/database verification passed for booking cancel, food-order cancel, menu-item deletion, customer deletion, and toast-expiry undo paths. Temporary QA records were cleaned up; only inert cancelled history rows remain.
- `frontend/src/components/tabs/MembersTab.jsx` is currently dead code: the `members` route renders `CustomersPage`, and `MembersTab` is not imported by the app shell.
- A2 micro-copy rule: use "Delete" for permanent record deletion and "Discard" only for unsaved modal/form drafts. Reversible business actions keep "Cancel" plus the object name.
- A2 CLOSED: outcome-oriented copy has been applied across the reachable app surfaces. Browser label-fit scans passed on desktop for Live Floor, Cafe POS, Customers, Settings, Bookings, and Daily Closing, plus narrow viewport checks for Live Floor and Cafe POS.
- A3 follow-up candidate: `frontend/src/components/Header.jsx`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg`, and `frontend/public/icons.svg` appear to be dead/template assets. Keep removal separate from the scoped A3 icon replacement commit.
- A3 CLOSED: scoped icon replacements passed lint/build/source checks and browser click verification for the waitlist cancel icon, booking cancel icon, and Cafe POS cart-line remove icon.
- A4 CLOSED: static and browser light/dark regression checks are complete. The Analytics stat-card dark-mode regression was fixed by migrating Reports stats to the shared `ui-metric-card`; browser contrast verification passed in light and dark mode. The live ClubSuite stat helper was also migrated to `ui-metric-card` and verified through Notification Center in both themes.
- B1 CLOSED: notification/toast system audit passed in-browser. Toasts stack with a stable 10px gap, each toast keeps its independent timer, and success/error toasts now include status icons plus distinct persistence/color treatment. The topbar bell is wired to the real Notification Center, which is populated from maintenance, waitlist, missed-booking, and audit-log data, so the original notification-system item is satisfied without additional bell wiring.
- B2 CLOSED: custom skeleton-first loading state for Food & Cafe POS (`FoodPosSkeleton`) verified in-browser across light and dark modes. Layout matches the live page structure (4 top tabs, search toolbar, 8 category pills, 4-column menu card grid with media/name/price/category lines, and right-hand order panel with cart placeholder). Shimmer animation (`skeleton-pulse`) verified with full contrast against background in both themes. Transition to loaded content occurs seamlessly with no layout shift, and generic `PageSkeleton` was verified on other tabs without regression. API and menu data fetch logic remain intact.
- B3 CLOSED: keyboard navigation verified in-browser. Escape closes modal/panel surfaces while preserving typed draft values on the first Escape from filled inputs, Enter opens the focused Live Floor table card, arrow keys move focus through the rendered table grid, and tab-order scans passed on Live Floor, Bookings, and Inventory without keyboard traps.
- C1 CLOSED: inline editing for Live Floor table hourly rates is implemented and browser-verified. Editing a rate shows the affected grouped-rate note, saves on Enter or blur, cancels with Escape, re-fetches current server rates before merging the edited group, rejects invalid values in-place with inline/toast feedback, rolls back on API failure, and preserves the existing Settings rate form as a fallback. T5 was temporarily changed to ₹171/₹172 during verification and restored to ₹170; the settings database ended clean at wr=320, pr=170, sr=270.
- C2 CLOSED: Inventory bulk actions are scoped to multi-select menu rows only and are browser/database verified. Selection count updates on select/deselect, bulk stock changes produce summarized success/failure results, partial failures report exact succeeded/failed counts while keeping failed names visible for follow-up, and bulk delete intentionally reuses the existing per-item undo toast behavior. Five simultaneous delete toasts stacked cleanly without overlap, single-row edit/stock/delete actions still worked afterward, and temporary QA menu rows were cleaned up from the database.
- C3 CLOSED: command palette search now covers existing live-data results, customers, menu items, and live table cards. Customer search was verified with a temporary QA customer, menu item search was verified against a real menu item and always navigates to Inventory, and table search was verified with `T1`/`Wiraka` plus status/rate hints. Static command aliases now cover operator terms such as food, reservation, bill, EOD, inventory, and dashboard. Bill/transaction search remains intentionally scoped out until there is a specific bill-detail/filter/highlight destination.
- C4 CLOSED: Cafe POS add-item-to-cart already behaves optimistically by design. Browser timing confirmed a menu item appears in the cart with updated subtotal/total immediately after click, and the database check confirmed zero persisted rows from cart-add alone because it is local React state only with no API call. Checkout/order placement via `placeOrder` / `Collect Cash` was not modified and remains non-optimistic, which is the safer behavior for money/persistence. Optimistic checkout is explicitly out of scope unless a future pass adds dedicated persistence rollback semantics.
- Routing Phase 1 PILOT: Dashboard has been migrated to a protected real client-side route at `/dashboard` using `react-router-dom`, while non-Dashboard pages remain on the legacy page-state path at `/` for the pilot. Verified passing: direct `/dashboard` while logged in, refresh-preserves-Dashboard, logged-out direct `/dashboard` guard to login, login return to `/dashboard`, active nav derived from URL, and old-page coexistence/back-forward between Dashboard and Cafe POS. The sidebar-click navigation check is intentionally still OPEN in this commit because a pre-existing sidebar bug makes the collapsed rail expand/mis-target and leaves `.cf-collapse-btn` invisible; that sidebar bug is tracked as the next separate fix before Phase 1 can be fully closed.
- Routing Phase 1 SIDEBAR FIX: removed the hover/focus-triggered collapsed sidebar expansion from both React state and CSS, and restored the explicit collapse/expand control by removing the stale collapsed `.cf-collapse-btn` hide rule. Browser verification passed in the available app viewport: collapsed rail stays compact, the explicit navigation toggle expands/collapses cleanly, and the previously blocked sidebar click from Analytics back to Executive Overview now lands on `/dashboard` with the correct active nav. Desktop `.cf-collapse-btn` render path was also checked against the active CSS rules; the only remaining hidden state is the intentional mobile breakpoint where `.sb-mobile-toggle` replaces it.
- Routing Phase 1 CLOSED: the previously blocked sidebar Dashboard navigation check now passes after the separate sidebar fix. Clicking Executive Overview/Dashboard from the sidebar updates the browser URL to `/dashboard` and leaves the correct nav item highlighted, so the Dashboard pilot is fully verified and ready for the Phase 2 rollout batch.
- Routing Phase 2 BATCH 1 CLOSED: Live Floor and Inventory & Stocks now have real protected client-side routes at `/live-floor` and `/inventory`. Verified in-browser: fresh direct entry to both routes hydrates the correct page, sidebar navigation between `/inventory` and `/live-floor` lands on the correct URL and active nav item, routed-to-legacy navigation from Inventory to Cafe POS still lands on `/` with Cafe POS active, logged-out direct entry to both new routes redirects to `/login?from=...`, and login returns to the requested protected route.
- Routing Phase 2 PRE-BATCH-2 CHECKS: browser refresh-key checks after sidebar navigation kept `/live-floor` and `/inventory` on their routed pages in working state. Cmd-K navigation was rechecked: Live Floor already used `/live-floor`; Inventory initially resolved to Settings through a stale alias, so Inventory & Stocks now has its own command-palette entry that navigates to `/inventory`, with Settings aliases narrowed to configuration/auth terms. Quick regression checks passed for Live Floor inline rate editing on the routed page (T5 changed to ₹171 and restored to ₹170) and Inventory bulk selection on the routed page (2 selected with contextual actions visible).
- Routing Phase 2 BATCH 2 CLOSED WITH HISTORY TOOLING CAVEAT: Bookings and Customers now have real protected client-side routes at `/bookings` and `/customers`. Verified in-browser: sidebar navigation lands on the correct URL and active nav item for both pages; fresh direct entry while logged in hydrates each page; refresh-key checks after page interaction keep each route in working state; logged-out direct entry redirects to `/login?from=...`; login returns to the originally requested route; Cmd-K reservation/booking terms route to `/bookings`; Cmd-K member/customer terms route to `/customers`; command aliases were scanned with no Inventory-style ambiguity; Bookings cancel action still removes a temporary QA booking and shows an undo toast on the routed page; Customers add/delete still works and shows the undo toast on the routed page. The requested Dashboard → Bookings → Customers → Live Floor forward sequence produced the exact route sequence, but browser Back verification remains a tooling caveat because the in-app browser ignored both `Alt+ArrowLeft` and `Meta+[` and native Chrome capture failed at the OS screen-capture layer. Temporary QA booking/customer records were cleaned; no active QA Routing records remained.
- Routing Back/Forward MANUAL CHECK OPEN: automated verification could not trigger browser back in the available in-app browser. The forward sequence was re-run and produced `/dashboard` → `/bookings` → `/customers` → `/live-floor`, but `history.back()` is unavailable in the CUA page sandbox (`history` is undefined), `Alt+ArrowLeft` and `Meta+[` were ignored, and native Chrome capture failed. Before Phase 2 Batch 3, manually verify in a normal browser: open `/dashboard`, click sidebar Bookings, click sidebar Customers, click sidebar Live Floor, then press browser Back three times one at a time. Expected sequence: `/customers` with Customers rendered, `/bookings` with Bookings rendered, `/dashboard` with Executive Overview rendered. Then press browser Forward three times. Expected sequence: `/bookings`, `/customers`, `/live-floor`, each rendering correctly and never landing on `about:blank`, `/`, login, or a broken page.

## Verification Debt Checklist

Lane A verification debt is closed. The checklist below is retained as the browser-verified evidence trail before starting Lane B.

### A1 Undo Toast Rollout

- Booking cancel undo: create a temporary booking, cancel it, confirm the undo toast appears immediately, click Undo, confirm the same booking returns with the same table/time/customer details, then cancel it again for cleanup.
- Food order cancel undo: create a temporary counter food order, cancel it from Cafe POS/Billing, confirm the undo toast appears immediately, click Undo, confirm the same food order returns with the same items/amount/payment context, then cancel it again for cleanup.
- Menu item delete undo: create a temporary menu item, delete it from Inventory/Settings, confirm the undo toast appears immediately, click Undo, confirm the same item returns with the same name/category/price/availability, then delete it again for cleanup.
- Customer delete undo: create a temporary customer, delete it from Customers, confirm the undo toast appears immediately, click Undo, confirm the same customer returns with the same ID/details/tier/spend fields, then delete it again for cleanup.
- For each A1 flow, also let one toast expire without clicking Undo and confirm the record stays cancelled/deleted.

### A2 Outcome-Oriented Copy

- Table Floor: check `Start Table`, `Add Food`, `Open Checkout`, `Reset Table`, `Save Notes`, `Reserve Table`, and `Cancel Reservation` fit without clipping or awkward wrapping on desktop and a narrow/mobile viewport.
- Cafe POS: check `Add Cigarette`, `Clear Order`, `Add to running table`, `Cancel Food Order`, and cart action labels fit and remain clear.
- Customers: check `Add Customer`, `Merge Profiles`, `Upgrade Tier`, `Downgrade Tier`, and `Delete Customer` fit inside cards/drawer actions.
- Inventory/Settings: check `Save Table Rates`, `Save Minimum Session`, `Save Grace Period`, `Save Item`, `Mark Out of Stock`, `Delete Item`, and `Add Menu Item` fit in table rows and forms.
- Bookings/Reservations and Daily Closing: check `Discard Booking`, `Cancel Booking`, `Close Day`, and `Close Tables First` fit and match the action outcome.

### A3 Icon Replacement Click Behavior

- Table Floor waitlist queue: click the `ti-x` icon button for a temporary queue entry and confirm it still cancels the queue entry.
- Table Floor booking panel: click the `ti-x` icon button for a temporary booking and confirm it still cancels the booking.
- Cafe POS cart: add an item to the cart, click the `ti-x` icon button on the line item, and confirm that exact cart item is removed.

### A4 Light/Dark Theme Regression

- Table Floor in light and dark mode: confirm primary session/action buttons have readable text, running/selected cards are readable, and no text disappears on accent/dark surfaces.
- Tournament Hub in light and dark mode: select a tournament card and confirm selected/unselected cards have readable text and visible borders.
- Operations/Pricing in light and dark mode: confirm health-ring/cockpit surfaces render correctly and no text token is being used as an unreadable fill.
- Dashboard charts in light and dark mode: confirm chart swatches/fills use the theme-aware chart tokens and remain visible against the page background.
- Global spot-check: toggle light/dark mode from the topbar and scan the current page for invisible, low-contrast, or clipped text before marking A4 closed.

### B1 Notification/Toast System

- Toast stack: trigger multiple toasts quickly and confirm each toast stacks cleanly without overlap.
- Toast timers: confirm success and error toasts dismiss independently, with success using the shorter routine timer and error persisting longer.
- Toast distinction: confirm success and error toasts are differentiated by icon, semantic color, border treatment, and persistence.
- Bell wiring: confirm the topbar bell opens the real Notification Center rather than a decorative placeholder.
- Notification data: confirm Notification Center content is sourced from operational signals such as maintenance, waitlist, missed bookings, and audit logs.

### B2 Food & Cafe POS Skeleton Loading

- Cafe POS loading surface: confirm the loading state uses the same structural layout as the real POS view, including top tabs, toolbar/search area, category rail, menu-card grid, and order panel.
- Light/dark skeleton contrast: confirm shimmer and placeholder blocks remain visible in both themes.
- Loaded-state replacement: confirm real menu data replaces the skeleton without layout jump or stale loading UI.
- Fetch/API constraint: confirm no menu-fetching or order API behavior changed as part of the presentation-only skeleton pass.
- Generic skeleton regression: spot-check an existing page using the generic skeleton and confirm it still renders normally.

### B3 Keyboard Navigation

- Escape closes surfaces: verify Escape closes the Live Floor start-session panel, Bookings modal, Cafe POS cigarette MRP dialog, Inventory add-menu-item modal, and Live Floor session workspace panel.
- Input preservation: while a filled text input is focused inside a modal, press Escape once and confirm the modal stays open, the draft value remains intact, and focus leaves the field. Press Escape from the panel/dialog afterward and confirm it closes.
- Focused-card Enter: tab to a Live Floor table card, confirm the focus treatment is visible, press Enter, and confirm the matching table workspace opens.
- Table-card arrows: from a focused table card, press right/down/left/up and confirm focus moves according to the rendered grid arrangement. Press Enter after arrow navigation and confirm the focused table opens.
- Tab-order sanity: tab through Live Floor, Bookings, and Inventory and confirm focus order follows sidebar, topbar, page actions, then page content without traps or newly unreachable controls.

### C1 Inline Table Rate Editing

- Grouped-rate signal: click the T1/T2/T3/T4 inline rate editor and confirm the note names the paired table that will also update. Click T5 and confirm it communicates the Pool table rate.
- Success path: edit T5 from ₹170 to another valid whole-number rate and save with Enter. Confirm the card updates, a single success toast appears, and the `settings` table persists the new `pr` value.
- Blur save: edit T5 to a valid rate, click inert page content, and confirm blur saves once with no duplicate toast.
- Restore cleanup: restore T5 to ₹170 and confirm the database is back to `wr=320, pr=170, sr=270`.
- Invalid recovery: submit negative, non-numeric, empty, and above-5000 values. Confirm the editor stays open with the invalid value visible, inline error text appears, an error toast fires, and the database does not change.
- Escape cancel: type a different valid value, press Escape, and confirm the editor closes without saving.
- Failure path: with the editor already open, force the rate-save request to fail. Confirm the UI rolls back to the previous displayed rate and shows the backend-unreachable error toast without leaving stale optimistic state.

### C2 Inventory Bulk Actions

- Selection: select three or more Inventory rows, deselect one before applying, and confirm the contextual action bar count updates correctly.
- Bulk stock success: apply `Mark Out of Stock` to selected temporary QA items, confirm a summary toast/result appears, and directly verify each selected item changed in the database.
- Bulk stock restore: apply `Mark In Stock` to the same items and directly verify the database returns to the expected available state.
- Partial failure: with multiple selected rows, force one item operation to fail and confirm the UI reports the exact success/failure count. Failed names must remain selected/visible in the result area so the operator knows which items need attention.
- Bulk delete: select five temporary QA items and trigger `Delete Items`; confirm five individual undo toasts stack cleanly without overlap, then verify the items are deleted from the database.
- Regression: after bulk actions, confirm single-row `Edit Item`, stock toggle, and `Delete Item` actions still fire normally.
