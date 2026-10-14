const loaders = {
  dashboard: () => import("./components/Dashboard.jsx"),
  "live-floor": () => import("./features/live-floor/LiveFloor.jsx"),
  reservations: () => import("./features/bookings/BookingsPage.jsx"),
  members: () => import("./features/customers/CustomersPage.jsx"),
  billing: () => import("./features/sales/SalesPage.jsx"),
  tables: () => import("./components/tabs/TablesTab.jsx"),
  reports: () => import("./components/tabs/ReportsTab.jsx"),
  closing: () => import("./components/tabs/ClosingTab.jsx"),
  settings: () => import("./components/tabs/SettingsTab.jsx"),
  food: () => import("./components/tabs/FoodTab.jsx"),
  tournaments: () => import("./components/tabs/TournamentTab.jsx"),
  operations: () => import("./components/tabs/OperationsTab.jsx"),
  inventory: () => import("./components/tabs/ClubSuiteTab.jsx"),
};
const pending = new Map();
export function loadPage(page) {
  const key = ["waitlist", "staff"].includes(page) ? "inventory" : page;
  if (!loaders[key]) return Promise.resolve();
  if (!pending.has(key)) pending.set(key, loaders[key]().catch(error => { pending.delete(key); throw error; }));
  return pending.get(key);
}
export function prefetchPage(page) { loadPage(page).catch(() => {}); }
