import { useState } from "react";
import { APP_NAME } from "../config/hsrTables.js";

export default function Sidebar({ page, setPage, onLogout, activeTables, role = "admin" }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navGroups = [
    {
      title: "Core Operational",
      items: [
        { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
        { id: "tables", icon: "ti-layout-grid", label: "Table Management", badge: activeTables > 0 ? `${activeTables} Active` : "" },
        { id: "waitlist", icon: "ti-clock", label: "Waitlist Queue" },
        { id: "reservations", icon: "ti-calendar", label: "Reservations" },
        { id: "food", icon: "ti-tools-kitchen-2", label: "Food & Cafe POS" },
        { id: "billing", icon: "ti-receipt", label: "Billing & Invoices", adminOnly: true },
      ],
    },
    {
      title: "Management",
      items: [
        { id: "members", icon: "ti-users", label: "Club Members", adminOnly: true },
        { id: "tournaments", icon: "ti-trophy", label: "Tournaments" },
        { id: "closing", icon: "ti-lock-check", label: "Shift EOD Closing" },
        { id: "plans", icon: "ti-award", label: "Membership Plans", adminOnly: true },
        { id: "reports", icon: "ti-chart-bar", label: "Analytics & Reports", adminOnly: true },
        { id: "staff", icon: "ti-user-check", label: "Staff & Roster", adminOnly: true },
        { id: "inventory", icon: "ti-package", label: "Inventory & Stocks", adminOnly: true },
      ],
    },
    {
      title: "System",
      items: [
        { id: "notifications", icon: "ti-bell", label: "Notifications" },
        { id: "settings", icon: "ti-settings", label: "Club Settings" },
      ],
    },
  ].map((group) => ({
    ...group,
    items: group.items.filter((item) => role === "admin" || !item.adminOnly),
  }));

  function navigate(nextPage) {
    setPage(nextPage);
    setMobileOpen(false);
  }

  return (
    <div className={`sidebar clubflow-sidebar ${mobileOpen ? "mobile-open" : ""} ${collapsed ? "is-collapsed" : ""}`}>
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
          H
        </div>
        <div>
          <div className="sb-logo-name">{APP_NAME}</div>
          <div className="sb-logo-sub">Bengaluru Pro Edition</div>
        </div>
        <button
          type="button"
          className="sb-collapse-btn"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <i className={`ti ti-chevron-right ${collapsed ? "" : "rotate"}`} aria-hidden="true" />
        </button>
      </div>

      <div className="sb-quick-wrap">
        <button type="button" className="sb-quick-action" onClick={() => navigate("tables")}>
          <i className="ti ti-bolt" aria-hidden="true" />
          <span className="sb-label">Quick Operations</span>
        </button>
      </div>

      <div className="sb-nav-scroll">
        {navGroups.map((group) => (
          <div className="sb-group" key={group.title}>
            <div className="sb-section">{group.title}</div>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`sb-item ${page === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <i className={`ti ${item.icon}`} aria-hidden="true" />
                <span className="sb-label">{item.label}</span>
                {item.badge && <span className="sb-badge">{item.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="sb-bottom">
        <div className="sb-user">
          <div className="sb-avatar">{role === "staff" ? "ST" : "AD"}</div>
          <div className="sb-user-meta">
            <strong>{role === "staff" ? "Staff" : "Admin"}</strong>
            <span>{role === "staff" ? "Floor operator" : "Club manager"}</span>
          </div>
        </div>
        <button type="button" className="sb-item sb-logout" onClick={onLogout}>
          <i className="ti ti-logout" aria-hidden="true" />
          <span className="sb-label">Logout</span>
        </button>
      </div>
    </div>
  );
}
