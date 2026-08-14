import { useEffect, useState } from "react";

const PAGE_DESCRIPTIONS = {
  "Executive Overview": "Real-time venue performance, revenue, queue and closing health",
  "Live Table Floor": "Manage active sessions, frames, reservations and table controls",
  "Smart Waitlist": "Walk-in queue, seating pressure and booking conflicts",
  "Reservations & Slots": "Table-wise booking commitments and no-show risk",
  "Food & Cafe POS": "Snacks, beverages, cigarettes and counter billing",
  "Billing & Invoices": "Recent settlements, food-only bills and payment checks",
  "Club Members": "Customer profiles, visits, spend and merge tools",
  "Tournament Hub": "Knockouts, entries and prize tracking",
  "Daily Closing": "End-of-day audit, cash tally and shift lock",
  "Analytics & Reports": "Revenue, history and operational reporting",
  "Operations Control": "Peak rates, GST and operational rules",
  "Inventory & Stocks": "Menu availability, stock risk and table maintenance",
  "Activity Log": "Staff and system actions from audit logs",
  "Notification Center": "System alerts, booking misses and sensitive events",
  "Club Settings": "Rates, credentials and system configuration",
};

export default function Topbar({
  title,
  role = "admin",
  username = "",
  activeTables = 0,
  totalTables = 5,
  onNavigate,
}) {
  const [dt, setDt] = useState("");
  const [clock, setClock] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("darkMode") === "true",
  );
  const displayName = username || role;
  const displayLabel =
    displayName.charAt(0).toUpperCase() + displayName.slice(1).toLowerCase();
  const occupancy = totalTables ? Math.round((activeTables / totalTables) * 100) : 0;

  useEffect(() => {
    function tick() {
      const d = new Date();
      setDt(
        d.toLocaleDateString("en-IN", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      );
      setClock(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
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
    <header className="topbar cf-topbar">
      <div className="cf-title-block">
        <div className="topbar-breadcrumb">
          <button type="button" onClick={() => onNavigate?.("dashboard")}>
            Dashboard
          </button>
          {title !== "Executive Overview" && (
            <>
              <i className="ti ti-chevron-right" aria-hidden="true" />
              <span>{title}</span>
            </>
          )}
        </div>
        <div className="topbar-title">{title}</div>
        <p>{PAGE_DESCRIPTIONS[title] || "HSR Snooker Cafe management console"}</p>
      </div>
      <div className="topbar-right">
        <div className="cf-occupancy-pill">
          <span />
          <strong>{activeTables}/{totalTables} Tables Active</strong>
          <em>{occupancy}% occupied</em>
        </div>
        <button
          type="button"
          className="cf-command-pill"
          onClick={() => window.dispatchEvent(new Event("command:open"))}
        >
          <i className="ti ti-command" aria-hidden="true" />
          <span>Search Actions</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="topbar-icon-btn cf-notification-btn"
          onClick={() => onNavigate?.("notifications")}
          title="Open notifications"
          aria-label="Open notifications"
        >
          <i className="ti ti-bell" aria-hidden="true" />
        </button>
        <div className={`topbar-user-chip ${role === "staff" ? "staff" : "admin"}`}>
          <i className={`ti ${role === "staff" ? "ti-user" : "ti-shield-lock"}`} aria-hidden="true" />
          <strong>{displayLabel}</strong>
        </div>
        <div className="topbar-date">
          <i className="ti ti-clock" aria-hidden="true" />
          <span>{dt} · {clock}</span>
        </div>
        <button
          className="topbar-icon-btn"
          onClick={() => setDark((p) => !p)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <i className={`ti ${dark ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
