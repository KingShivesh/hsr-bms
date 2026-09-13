import { useEffect, useMemo, useRef, useState } from "react";
import { getAuditLogs, getBookings, getTableState, getWaitlist } from "../api/index.js";

const PAGE_DESCRIPTIONS = {
  "Executive Overview": "For owners: see today's revenue, floor pressure and what needs attention first.",
  "Live Floor": "For counter staff: start tables, manage running sessions and move guests through checkout.",
  "Advanced Table Controls": "For managers: handle table exceptions, queue pressure and detailed operating controls.",
  "Smart Waitlist": "For the front desk: manage walk-ins, seating pressure and booking conflicts.",
  "Bookings": "For reservations: create table commitments, check guests in and catch no-shows early.",
  "Food & Cafe POS": "For cafe staff: build orders, attach food to tables and collect counter payments.",
  "Sales": "For cashiers: settle bills and review today's completed transactions.",
  "Customers": "For relationship tracking: manage profiles, visits, spend and duplicate customer records.",
  "Tournament Hub": "For events: build knockouts, manage entries and track prize flow.",
  "Daily Closing": "For shift leads: verify cash, exceptions and table closure before locking the day.",
  "Analytics & Reports": "For owners: analyze performance trends and export reporting data.",
  "Pricing & Rules": "For admins: adjust peak rates, GST rules and operating guardrails.",
  "Inventory & Stocks": "For stock control: update menu availability, bulk stock state and table maintenance.",
  "Audit Log": "For accountability: review staff and system activity from the audit trail.",
  "Club Settings": "For admins: maintain rates, credentials and protected system configuration.",
};

const PAGE_PRIMARY_ACTIONS = {
  "Executive Overview": { label: "Open Live Floor", icon: "ti-layout-grid", page: "live-floor" },
  "Live Floor": { label: "Start Table", icon: "ti-player-play", event: "live-floor:new-session" },
  "Advanced Table Controls": { label: "Start Table", icon: "ti-player-play", page: "tables" },
  "Smart Waitlist": { label: "Open Bookings", icon: "ti-calendar-plus", page: "reservations" },
  "Bookings": { label: "New Booking", icon: "ti-calendar-plus", event: "bookings:new" },
  "Food & Cafe POS": { label: "Place Order", icon: "ti-tools-kitchen-2", page: "food" },
  "Sales": { label: "Print Register", icon: "ti-printer", action: "print" },
  "Customers": { label: "Add Customer", icon: "ti-user-plus", event: "customers:add-focus" },
  "Tournament Hub": { label: "Create Bracket", icon: "ti-trophy", page: "tournaments" },
  "Daily Closing": { label: "Review Close", icon: "ti-lock-check", page: "closing" },
  "Analytics & Reports": { label: "Export Reports", icon: "ti-download", page: "reports" },
  "Pricing & Rules": { label: "Add Rate Rule", icon: "ti-plus", page: "operations" },
  "Inventory & Stocks": { label: "Add Item", icon: "ti-package", page: "inventory" },
  "Audit Log": { label: "Refresh Audit", icon: "ti-refresh", page: "staff" },
  "Club Settings": { label: "Save Settings", icon: "ti-device-floppy", page: "settings" },
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  return Object.entries(value).map(([id, item]) => ({ id, ...(item || {}) }));
}

function asMaintenanceRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([table_id, item]) => ({ table_id, ...(item || {}) }));
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildNotificationRows({ auditLogs = [], waitlist = [], bookings = [], maintenance = [] }) {
  return [
    ...maintenance.map((row) => ({
      id: `maint-${row.table_id}`,
      icon: "ti-tool",
      title: `${String(row.table_id || "Table").toUpperCase()} in maintenance`,
      detail: row.reason || "Needs owner review",
      tone: "warning",
      page: "inventory",
    })),
    ...waitlist.map((entry) => ({
      id: `wait-${entry.id}`,
      icon: "ti-user-clock",
      title: `${entry.customer_name || "Guest"} waiting`,
      detail: `${entry.wait_mins || 0} min in queue`,
      tone: "info",
      page: "waitlist",
    })),
    ...bookings.filter((booking) => booking.status === "missed").map((booking) => ({
      id: `missed-${booking.id}`,
      icon: "ti-alert-triangle",
      title: `Missed booking: ${booking.customer_name || "Guest"}`,
      detail: shortDate(booking.booking_time),
      tone: "danger",
      page: "reservations",
    })),
    ...auditLogs.slice(0, 8).map((log) => ({
      id: `audit-${log.id}`,
      icon: log.severity === "danger" || log.severity === "critical" ? "ti-alert-triangle" : "ti-activity",
      title: log.action?.replaceAll("_", " ") || "System activity",
      detail: log.detail || log.date || "",
      tone: log.severity === "danger" || log.severity === "critical" ? "danger" : "info",
      page: "staff",
    })),
  ];
}

export default function Topbar({
  title,
  role = "admin",
  username = "",
  onNavigate,
}) {
  const notificationRef = useRef(null);
  const [dt, setDt] = useState("");
  const [clock, setClock] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationData, setNotificationData] = useState({
    auditLogs: [],
    waitlist: [],
    bookings: [],
    maintenance: [],
  });
  const [dark, setDark] = useState(
    () => localStorage.getItem("darkMode") !== "false",
  );
  const displayName = username || role;
  const displayLabel =
    displayName.charAt(0).toUpperCase() + displayName.slice(1).toLowerCase();

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

  const notificationRows = useMemo(() => buildNotificationRows(notificationData), [notificationData]);
  const primaryAction = PAGE_PRIMARY_ACTIONS[title];

  function runPrimaryAction() {
    if (!primaryAction) return;
    if (primaryAction.action === "print") {
      window.print();
      return;
    }
    if (primaryAction.event) {
      window.dispatchEvent(new Event(primaryAction.event));
      return;
    }
    if (primaryAction.page) {
      onNavigate?.(primaryAction.page);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const [auditRes, waitlistRes, bookingRes, tableRes] = await Promise.all([
        getAuditLogs(50),
        getWaitlist(),
        getBookings(),
        getTableState(),
      ]);
      const tablePayload = tableRes.data || {};
      setNotificationData({
        auditLogs: asArray(auditRes.data),
        waitlist: asArray(waitlistRes.data),
        bookings: asArray(bookingRes.data),
        maintenance: asMaintenanceRows(tablePayload.maintenance),
      });
    } catch (error) {
      setNotificationsError(error.userMessage || "Notifications could not load.");
    } finally {
      setNotificationsLoading(false);
    }
  }

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    loadNotifications();
    function handleOutsideInteraction(event) {
      if (!notificationRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    }
    function handleDataChanged() {
      loadNotifications();
    }
    document.addEventListener("pointerdown", handleOutsideInteraction);
    document.addEventListener("click", handleOutsideInteraction);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("hsr:data-changed", handleDataChanged);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideInteraction);
      document.removeEventListener("click", handleOutsideInteraction);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("hsr:data-changed", handleDataChanged);
    };
  }, [notificationsOpen]);

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
        {primaryAction && (
          <button
            type="button"
            className="cf-page-primary-action"
            onClick={runPrimaryAction}
          >
            <i className={`ti ${primaryAction.icon}`} aria-hidden="true" />
            <span>{primaryAction.label}</span>
          </button>
        )}
        <button
          type="button"
          className="cf-command-pill"
          onClick={() => window.dispatchEvent(new Event("command:open"))}
        >
          <i className="ti ti-command" aria-hidden="true" />
          <span>Search Actions</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="cf-notification-wrap" ref={notificationRef}>
          <button
            type="button"
            className="topbar-icon-btn cf-notification-btn"
            onClick={() => setNotificationsOpen((open) => !open)}
            title="Open notifications"
            aria-label="Open notifications"
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
          >
            <i className="ti ti-bell" aria-hidden="true" />
            {notificationRows.length > 0 && <span className="cf-notification-dot">{notificationRows.length}</span>}
          </button>
          {notificationsOpen && (
            <div className="cf-notification-popover" role="dialog" aria-label="Notifications">
              <div className="cf-notification-head">
                <div>
                  <strong>Notifications</strong>
                  <span>Maintenance, waitlist, missed bookings and audit activity</span>
                </div>
                <button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications">
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
              <div className="cf-notification-stats">
                <div><span>Alerts</span><strong>{notificationRows.length}</strong></div>
                <div><span>Audit</span><strong>{notificationData.auditLogs.length}</strong></div>
                <div><span>Maint.</span><strong>{notificationData.maintenance.length}</strong></div>
              </div>
              {notificationsLoading && (
                <div className="cf-notification-state">
                  <i className="ti ti-loader-2" aria-hidden="true" />
                  <span>Loading notifications...</span>
                </div>
              )}
              {notificationsError && (
                <div className="cf-notification-state error">
                  <i className="ti ti-alert-triangle" aria-hidden="true" />
                  <span>{notificationsError}</span>
                </div>
              )}
              {!notificationsLoading && !notificationsError && (
                <div className="cf-notification-list">
                  {notificationRows.length ? notificationRows.map((item) => (
                    <button
                      type="button"
                      className={`cf-notification-row ${item.tone}`}
                      key={item.id}
                      onClick={() => {
                        setNotificationsOpen(false);
                        onNavigate?.(item.page);
                      }}
                    >
                      <i className={`ti ${item.icon}`} aria-hidden="true" />
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.detail || "No detail"}</span>
                      </div>
                    </button>
                  )) : (
                    <div className="cf-notification-empty">
                      <i className="ti ti-shield-check" aria-hidden="true" />
                      <strong>No live notifications</strong>
                      <span>Waitlist, booking, maintenance and audit alerts will appear here.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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
