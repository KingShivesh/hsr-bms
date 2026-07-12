import { APP_NAME } from "../config/hsrTables.js";

export default function Sidebar({ page, setPage, onLogout, activeTables }) {
  const items = [
    { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
    { id: "tables", icon: "ti-circle-dot", label: "Tables" },
    { id: "food", icon: "ti-tools-kitchen-2", label: "Food Orders" },
    { id: "reports", icon: "ti-chart-bar", label: "Reports" },
    { id: "closing", icon: "ti-clipboard-check", label: "Closing" },
  ];

  return (
    <div className="sidebar">
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
          onClick={() => setPage(item.id)}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          <span style={{ flex: 1 }}>{item.label}</span>

          {/* Active tables badge next to Tables */}
          {item.id === "tables" && activeTables > 0 && (
            <span
              style={{
                background: "#16a34a",
                color: "#fff",
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: "10px",
                minWidth: "18px",
                textAlign: "center",
              }}
            >
              {activeTables}
            </span>
          )}
        </div>
      ))}

      <div className="sb-section">System</div>
      <div
        className={`sb-item ${page === "settings" ? "active" : ""}`}
        onClick={() => setPage("settings")}
      >
        <i className="ti ti-settings" aria-hidden="true" />
        Settings
      </div>

      <div className="sb-bottom">
        <div className="sb-item" onClick={onLogout}>
          <i className="ti ti-logout" aria-hidden="true" />
          Logout
        </div>
      </div>
    </div>
  );
}
