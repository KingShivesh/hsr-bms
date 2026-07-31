import { useEffect, useMemo, useState } from "react";
import { getNotifications } from "../../api/index.js";

const ICONS = {
  inventory: "ti-package",
  billing: "ti-receipt",
  booking: "ti-calendar",
  system: "ti-shield",
};

export default function NotificationsTab() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNotifications()
      .then((res) => setItems(res.data))
      .finally(() => setLoading(false));
  }, []);

  const filters = useMemo(
    () => ["All", ...Array.from(new Set(items.map((item) => item.type)))],
    [items],
  );
  const filtered = filter === "All" ? items : items.filter((item) => item.type === filter);

  if (loading) return <div className="loading-state-title">Loading notifications...</div>;

  return (
    <div className="ops-page">
      <div className="ops-hero">
        <div>
          <div className="quick-session-eyebrow">Live alerts</div>
          <h2>Notifications</h2>
          <p>Stock warnings, long sessions, reservations, and sensitive system actions.</p>
        </div>
      </div>
      <div className="table-discount-options notification-filters">
        {filters.map((option) => (
          <button key={option} type="button" className={filter === option ? "active" : ""} onClick={() => setFilter(option)}>
            {option}
          </button>
        ))}
      </div>
      <div className="notification-list">
        {filtered.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-title">No alerts right now</div>
            <div className="empty-state-detail">The system will show stock, booking, billing, and audit alerts here.</div>
          </div>
        ) : (
          filtered.map((item) => (
            <div className={`notification-row ${item.severity || "info"}`} key={item.id}>
              <i className={`ti ${ICONS[item.type] || "ti-bell"}`} aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.message}</span>
              </div>
              <em>{item.time || item.type}</em>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
