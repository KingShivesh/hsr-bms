import { useState } from "react";
import { APP_NAME } from "../config/hsrTables.js";

export default function Sidebar({ page, setPage, onLogout, activeTables, role = "admin" }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  function setCollapsedPersisted(next) {
    setCollapsed(next);
    localStorage.setItem("sidebarCollapsed", String(next));
  }

  const groups = [
    {
      title: "Core operational",
      tone: "core",
      items: [
        { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
        {
          id: "tables",
          icon: "ti-layout-grid",
          label: "Table Management",
          badge: activeTables > 0 ? `${activeTables} Active` : "",
          badgeTone: "success",
        },
        { id: "waitlist", icon: "ti-clock", label: "Waitlist Queue" },
        { id: "reservations", icon: "ti-calendar-event", label: "Reservations" },
        { id: "food", icon: "ti-tools-kitchen-2", label: "Food & Cafe POS" },
        { id: "billing", icon: "ti-receipt", label: "Billing & Invoices", staffHidden: true },
      ],
    },
    {
      title: "Management",
      tone: "manage",
      items: [
        { id: "members", icon: "ti-users", label: "Club Members", adminOnly: true },
        { id: "tournaments", icon: "ti-trophy", label: "Tournaments", staffHidden: true },
        { id: "closing", icon: "ti-lock-check", label: "Shift EOD Closing" },
        { id: "reports", icon: "ti-chart-bar", label: "Analytics & Reports", adminOnly: true },
        { id: "operations", icon: "ti-adjustments", label: "Operations Control", adminOnly: true },
        { id: "staff", icon: "ti-user-check", label: "Activity Log", adminOnly: true },
        { id: "inventory", icon: "ti-package", label: "Inventory & Stocks", staffHidden: true },
      ],
    },
    {
      title: "System",
      tone: "system",
      items: [
        { id: "notifications", icon: "ti-bell", label: "Notifications", staffHidden: true },
        { id: "settings", icon: "ti-settings", label: "Club Settings", adminOnly: true },
      ],
    },
  ].map((group) => ({
    ...group,
    items: group.items.filter((item) => role === "admin" || (!item.adminOnly && !item.staffHidden)),
  }));

  function navigate(nextPage) {
    setPage(nextPage);
    setMobileOpen(false);
  }

  const compact = collapsed && !mobileOpen && !railOpen;

  return (
    <aside
      className={`sidebar cf-sidebar ${compact ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
      onMouseEnter={() => setRailOpen(true)}
      onMouseLeave={() => setRailOpen(false)}
      onFocusCapture={() => setRailOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setRailOpen(false);
        }
      }}
    >
      <div className="cf-sidebar-head">
        <div className="sb-logo">
          <div className="sb-logo-mark">HSR</div>
          <div>
            <div className="sb-logo-name">{APP_NAME}</div>
            <div className="sb-logo-sub">Bengaluru Pro Edition</div>
          </div>
        </div>
        <button
          type="button"
          className="cf-collapse-btn"
          onClick={() => setCollapsedPersisted(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <i className={`ti ${collapsed ? "ti-chevron-right" : "ti-chevron-left"}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sb-mobile-toggle"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Collapse navigation" : "Expand navigation"}
        >
          <i className={`ti ${mobileOpen ? "ti-x" : "ti-menu-2"}`} aria-hidden="true" />
        </button>
      </div>

      <div className="cf-quick-shell">
        <div className="cf-role-scope">
          <i className={`ti ${role === "admin" ? "ti-shield-check" : "ti-user-check"}`} aria-hidden="true" />
          <span>{role === "admin" ? "Admin access" : "Staff access"}</span>
        </div>
        <button type="button" className="cf-quick-btn" onClick={() => navigate("tables")}>
          <i className="ti ti-bolt" aria-hidden="true" />
          <span>Quick Operations</span>
        </button>
      </div>

      <nav className="cf-nav" aria-label="Main navigation">
        {groups.map((group) => (
          <div className="cf-nav-group" key={group.title}>
            <div className="sb-section">{group.title}</div>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`sb-item ${page === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
              >
                <i className={`ti ${item.icon}`} aria-hidden="true" />
                <span className="sb-label">{item.label}</span>
                {item.badge && <span className="sb-badge" data-tone={item.badgeTone || "success"}>{item.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sb-bottom">
        <div className="cf-user-mini">
          <div>{role === "staff" ? "ST" : "AD"}</div>
          <span>
            <b>{role === "staff" ? "Staff" : "Admin"}</b>
            <small>Signed in</small>
          </span>
        </div>
        <button
          type="button"
          className="sb-item"
          onClick={onLogout}
          aria-label="Logout"
        >
          <i className="ti ti-logout" aria-hidden="true" />
          <span className="sb-label">Logout</span>
        </button>
      </div>
    </aside>
  );
}
