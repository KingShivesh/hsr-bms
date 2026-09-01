# Interaction Design Progress

## Current Verification Notes

- A1 CLOSED: browser/API/database verification passed for booking cancel, food-order cancel, menu-item deletion, customer deletion, and toast-expiry undo paths. Temporary QA records were cleaned up; only inert cancelled history rows remain.
- `frontend/src/components/tabs/MembersTab.jsx` is currently dead code: the `members` route renders `CustomersPage`, and `MembersTab` is not imported by the app shell.
- A2 micro-copy rule: use "Delete" for permanent record deletion and "Discard" only for unsaved modal/form drafts. Reversible business actions keep "Cancel" plus the object name.
- A2 CLOSED: outcome-oriented copy has been applied across the reachable app surfaces. Browser label-fit scans passed on desktop for Live Floor, Cafe POS, Customers, Settings, Bookings, and Daily Closing, plus narrow viewport checks for Live Floor and Cafe POS.
- A3 follow-up candidate: `frontend/src/components/Header.jsx`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg`, and `frontend/public/icons.svg` appear to be dead/template assets. Keep removal separate from the scoped A3 icon replacement commit.
- A3 CLOSED: scoped icon replacements passed lint/build/source checks and browser click verification for the waitlist cancel icon, booking cancel icon, and Cafe POS cart-line remove icon.
- A4 CLOSED: static and browser light/dark regression checks are complete. The Analytics stat-card dark-mode regression was fixed by migrating Reports stats to the shared `ui-metric-card`; browser contrast verification passed in light and dark mode. The live ClubSuite stat helper was also migrated to `ui-metric-card` and verified through Notification Center in both themes.

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
