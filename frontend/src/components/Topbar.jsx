import { useState, useEffect } from "react";
import { TOTAL_TABLES } from "../config/hsrTables.js";

const PAGE_META = {
  dashboard: "Real-time club performance and revenue monitoring",
  tables: "Live 5-table floor grid, sessions, LP frames and checkout",
  waitlist: "Manage walk-in queue, party sizes, and auto-seating",
  reservations: "Manage table bookings and schedule timelines",
  food: "Snacks, beverages and table order billing",
  tournaments: "Tournament tables, recommendations and brackets",
  members: "Member records, loyalty points and spending history",
  plans: "Silver, Gold and VIP member tier configurations",
  billing: "Invoice archive, receipts and payment breakdowns",
  inventory: "Equipment, cafe stock and low-stock alerts",
  staff: "Shift schedules, performance metrics and attendance",
  notifications: "System alerts, bookings, stock and billing reminders",
  reports: "Revenue charts, peak hours and closing analytics",
  closing: "Cash drawer tally, payment split and end-of-day audit",
  settings: "Rates, credentials, menu and operating preferences",
};

export default function Topbar({
  title,
  page = "tables",
  role = "admin",
  username = "",
  activeTables = 0,
  onNavigate,
}) {
  const [dt, setDt] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("darkMode") === "true",
  );
  const displayName = username || role;
  const displayLabel =
    displayName.charAt(0).toUpperCase() + displayName.slice(1).toLowerCase();
  const occupancyPct = Math.round((Number(activeTables || 0) / TOTAL_TABLES) * 100);

  useEffect(() => {
    function tick() {
      const d = new Date();
      setDt(
        d.toLocaleDateString("en-IN", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        }) +
          " • " +
          d.toLocaleTimeString("en-IN"),
      );
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (dark) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
    localStorage.setItem("darkMode", dark);
  }, [dark]);

  return (
    <div className="topbar">
      <div className="topbar-heading">
        <div className="topbar-title-row">
          <div className="topbar-title">{title}</div>
          <span className="topbar-location">
            <i className="ti ti-map-pin" aria-hidden="true" />
            HSR Layout
          </span>
        </div>
        <div className="topbar-subtitle">{PAGE_META[page] || "Management console"}</div>
      </div>
      <div className="topbar-right">
        <div className="topbar-occupancy">
          <span className="live-dot" />
          <strong>{activeTables}/{TOTAL_TABLES} Tables Active</strong>
          <em>{occupancyPct}% Occupied</em>
        </div>
        <button
          className="topbar-command"
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("command:open"));
            onNavigate?.(page);
          }}
          title="Open command palette"
        >
          <i className="ti ti-command" aria-hidden="true" />
          <span>Search or Command</span>
          <kbd>⌘K</kbd>
        </button>
        <div className={`topbar-user-chip ${role === "staff" ? "staff" : "admin"}`}>
          <i className={`ti ${role === "staff" ? "ti-user" : "ti-shield-lock"}`} aria-hidden="true" />
          <span>Role</span>
          <strong>{displayLabel}</strong>
        </div>
        <div className="topbar-date">{dt}</div>

        {/* Dark mode toggle */}
        <button
          className="topbar-icon-btn"
          onClick={() => setDark((p) => !p)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <i className={`ti ${dark ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
        </button>

      </div>
    </div>
  );
}
