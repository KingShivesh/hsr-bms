import { useEffect, useState } from "react";
import { APP_NAME } from "../config/hsrTables.js";

export default function Header({ metrics, onLogout }) {
  const [datetime, setDatetime] = useState("");

  useEffect(() => {
    function tick() {
      const d = new Date();
      setDatetime(
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

  return (
    <div className="header">
      <div className="container-fluid">
        <div className="d-flex justify-content-between align-items-center">
          <div className="logo">
            <span className="logo-icon">🎱</span>
            {APP_NAME}
          </div>
          <div className="header-right">
            <div className="datetime">{datetime}</div>
            <button
              className="btn-logout"
              onClick={onLogout}
              data-testid="logout-button"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="metrics">
          <div className="metric-card revenue">
            <div className="metric-icon">💰</div>
            <div className="metric-label">Today's Revenue</div>
            <div className="metric-value">₹{metrics.sale}</div>
          </div>
          <div className="metric-card tables">
            <div className="metric-icon">🎯</div>
            <div className="metric-label">Active Tables</div>
            <div className="metric-value">{metrics.active_tables}</div>
          </div>
          <div className="metric-card">
            <div className="metric-icon">👥</div>
            <div className="metric-label">Total Customers</div>
            <div className="metric-value">{metrics.cust}</div>
          </div>
          <div className="metric-card food">
            <div className="metric-icon">🍔</div>
            <div className="metric-label">Food Sales</div>
            <div className="metric-value">₹{metrics.food}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
