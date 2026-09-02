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
