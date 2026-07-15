import { useState } from "react";
import { APP_NAME } from "../config/hsrTables.js";

export default function Sidebar({ page, setPage, onLogout, activeTables, role = "admin" }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = [
    { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
    { id: "tables", icon: "ti-circle-dot", label: "Tables" },
    { id: "food", icon: "ti-tools-kitchen-2", label: "Food Orders" },
    { id: "tournaments", icon: "ti-trophy", label: "Tournaments" },
    { id: "reports", icon: "ti-chart-bar", label: "Reports" },
    { id: "closing", icon: "ti-clipboard-check", label: "Closing" },
  ].filter((item) => role === "admin" || item.id !== "reports");

  function navigate(nextPage) {
    setPage(nextPage);
    setMobileOpen(false);
  }

  return (
    <div className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <button
        type="button"
        className="sb-mobile-toggle"
        onClick={() => setMobileOpen((open) => !open)}
        aria-label={mobileOpen ? "Collapse navigation" : "Expand navigation"}
      >
        <i className={`ti ${mobileOpen ? "ti-x" : "ti-menu-2"}`} aria-hidden="true" />
      </button>
      <div className="sb-logo">
        <div className="sb-logo-mark">
          <i className="ti ti-circle-dot" aria-hidden="true" />
        </div>
        <div>
          <div className="sb-logo-name">{APP_NAME}</div>
          <div className="sb-logo-sub">Venue Control</div>
        </div>
      </div>

      <div className="sb-section">Main</div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`sb-item ${page === item.id ? "active" : ""}`}
          onClick={() => navigate(item.id)}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          <span className="sb-label">{item.label}</span>

          {/* Active tables badge next to Tables */}
          {item.id === "tables" && activeTables > 0 && (
            <span className="sb-badge">
              {activeTables}
            </span>
          )}
        </div>
      ))}

      <div className="sb-section">System</div>
      <div
        className={`sb-item ${page === "settings" ? "active" : ""}`}
        onClick={() => navigate("settings")}
      >
        <i className="ti ti-settings" aria-hidden="true" />
        <span className="sb-label">Settings</span>
      </div>

      <div className="sb-bottom">
        <div className="sb-item" onClick={onLogout}>
          <i className="ti ti-logout" aria-hidden="true" />
          <span className="sb-label">Logout</span>
        </div>
      </div>
    </div>
  );
}
