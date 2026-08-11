import { useEffect, useMemo, useState } from "react";
import {
  getActive,
  getAuditLogs,
  getBookings,
  getFoodOrders,
  getWaitlist,
} from "../api/index.js";
import { HSR_TABLES, getTableLabel } from "../config/hsrTables.js";

export default function CommandBar({ page, setPage, onNewSession, role = "admin" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchData, setSearchData] = useState({
    sessions: [],
    waitlist: [],
    bookings: [],
    foodOrders: [],
    auditLogs: [],
  });
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function loadSearchData() {
      setLoadingData(true);
      const results = await Promise.allSettled([
        getActive(),
        getWaitlist(),
        getBookings(),
        getFoodOrders(),
        role === "admin" ? getAuditLogs(8) : Promise.resolve({ data: [] }),
      ]);
      if (!alive) return;
      setSearchData({
        sessions: results[0].status === "fulfilled" ? results[0].value.data || [] : [],
        waitlist: results[1].status === "fulfilled" ? results[1].value.data || [] : [],
        bookings: results[2].status === "fulfilled" ? results[2].value.data || [] : [],
        foodOrders: results[3].status === "fulfilled" ? results[3].value.data || [] : [],
        auditLogs: results[4].status === "fulfilled" ? results[4].value.data || [] : [],
      });
      setLoadingData(false);
    }
    loadSearchData();
    return () => {
      alive = false;
    };
  }, [open, role]);

  const commands = useMemo(
    () => [
      {
        id: "new-session",
        label: "New session",
        hint: "Open Tables",
        icon: "ti-plus",
        action: () => onNewSession(),
      },
      {
        id: "queue",
        label: "Smart table queue",
        hint: "Tables",
        icon: "ti-list-check",
        action: () => setPage("tables"),
      },
      {
        id: "dashboard",
        label: "Dashboard",
        hint: "Owner glance",
        icon: "ti-layout-dashboard",
        action: () => setPage("dashboard"),
      },
      {
        id: "tables",
        label: "Tables",
        hint: "Floor view",
        icon: "ti-circle-dot",
        action: () => setPage("tables"),
      },
      {
        id: "food",
        label: "Food orders",
        hint: "Menu and cart",
        icon: "ti-tools-kitchen-2",
        action: () => setPage("food"),
      },
      {
        id: "tournaments",
        label: "Tournaments",
        hint: "Matches and winners",
        icon: "ti-trophy",
        action: () => setPage("tournaments"),
      },
      {
        id: "reports",
        label: "Reports",
        hint: "Bills and table performance",
        icon: "ti-chart-bar",
        action: () => setPage("reports"),
        adminOnly: true,
      },
      {
        id: "closing",
        label: "Daily closing",
        hint: "Cash, UPI and open tables",
        icon: "ti-clipboard-check",
        action: () => setPage("closing"),
      },
      {
        id: "settings",
        label: "Settings",
        hint: "Pricing and controls",
        icon: "ti-settings",
        action: () => setPage("settings"),
        adminOnly: true,
      },
    ],
    [onNewSession, setPage],
  );

  const dynamicCommands = useMemo(() => {
    const sessionCommands = searchData.sessions.map((session) => ({
      id: `session-${session.table_id}`,
      label: `${String(session.table_id || "").toUpperCase()} running table`,
      hint: `${session.customer_name || "Player"} · ${getTableLabel(HSR_TABLES.find((table) => table.id === String(session.table_id || "").toLowerCase())) || "Table"} · open controls`,
      icon: "ti-player-play",
      action: () => setPage("tables"),
    }));
    const waitlistCommands = searchData.waitlist.slice(0, 8).map((entry) => ({
      id: `wait-${entry.id}`,
      label: entry.customer_name || "Waiting guest",
      hint: `Waitlist #${entry.position || "-"} · ${entry.preferred_type || "Any table"}`,
      icon: "ti-user-clock",
      action: () => setPage("waitlist"),
    }));
    const bookingCommands = searchData.bookings.slice(0, 8).map((booking) => ({
      id: `booking-${booking.id}`,
      label: booking.customer_name || "Booking",
      hint: `${booking.table_id || "ANY"} · ${booking.status || "booked"} reservation`,
      icon: "ti-calendar-event",
      action: () => setPage("reservations"),
    }));
    const foodCommands = searchData.foodOrders.slice(0, 6).map((order) => ({
      id: `food-${order.id}`,
      label: `${order.customer_name || "Counter"} food order`,
      hint: `₹${Number(order.total || 0).toLocaleString("en-IN")} · ${order.payment_method || "Cash"}`,
      icon: "ti-tools-kitchen-2",
      action: () => setPage("food"),
    }));
    const auditCommands = searchData.auditLogs.slice(0, 6).map((log) => ({
      id: `audit-${log.id}`,
      label: log.action?.replaceAll("_", " ") || "Audit event",
      hint: `${log.staff || "system"} · ${log.detail || log.date || ""}`,
      icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
      action: () => setPage("reports"),
      adminOnly: true,
    }));
    return [...sessionCommands, ...waitlistCommands, ...bookingCommands, ...foodCommands, ...auditCommands];
  }, [searchData, setPage]);

  const allowedCommands = [...commands, ...dynamicCommands].filter((cmd) => role === "admin" || !cmd.adminOnly);
  const filtered = allowedCommands.filter((cmd) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${cmd.label} ${cmd.hint}`.toLowerCase().includes(q);
  });

  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onOpenCommand() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("command:open", onOpenCommand);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("command:open", onOpenCommand);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(cmd) {
    cmd.action();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="command-fab"
        onClick={() => setOpen(true)}
        title="Open command bar"
      >
        <i className="ti ti-command" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="command-overlay" onMouseDown={() => setOpen(false)}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-input-wrap">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[activeIndex]) {
                e.preventDefault();
                runCommand(filtered[activeIndex]);
              }
            }}
            placeholder="Search actions, pages, reports..."
          />
          <span>Esc</span>
        </div>
        <div className="command-list">
          {loadingData && !query.trim() ? (
            <div className="command-empty">Loading live results...</div>
          ) : filtered.length === 0 ? (
            <div className="command-empty">No matching command</div>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                type="button"
                className={`${index === activeIndex ? "active" : ""} ${page === cmd.id ? "current" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(cmd)}
              >
                <i className={`ti ${cmd.icon}`} aria-hidden="true" />
                <span>{cmd.label}</span>
                <small>{cmd.hint}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
