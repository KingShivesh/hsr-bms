import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAuditLogs,
  getBookings,
  getFoodOrders,
  getMembers,
  getMenu,
  getTableState,
  getWaitlist,
} from "../api/index.js";
import { HSR_TABLES, getTableLabel } from "../config/hsrTables.js";

export default function CommandBar({ page, setPage, onNewSession, role = "admin" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const paletteRef = useRef(null);
  const openerRef = useRef(null);
  const [searchData, setSearchData] = useState({
    sessions: [],
    tables: [],
    waitlist: [],
    bookings: [],
    foodOrders: [],
    auditLogs: [],
    members: [],
    menuItems: [],
  });
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function loadSearchData() {
      setLoadingData(true);
      const results = await Promise.allSettled([
        getTableState(),
        getWaitlist(),
        getBookings(),
        getFoodOrders(),
        role === "admin" ? getAuditLogs(8) : Promise.resolve({ data: [] }),
        role === "admin" ? getMembers() : Promise.resolve({ data: [] }),
        role === "admin" ? getMenu() : Promise.resolve({ data: {} }),
      ]);
      if (!alive) return;
      const menuData = results[6].status === "fulfilled" ? results[6].value.data || {} : {};
      const tableData = results[0].status === "fulfilled" ? results[0].value.data || {} : {};
      setSearchData({
        sessions: tableData.active_sessions || [],
        tables: tableData.tables || [],
        waitlist: results[1].status === "fulfilled" ? results[1].value.data || [] : [],
        bookings: results[2].status === "fulfilled" ? results[2].value.data || [] : [],
        foodOrders: results[3].status === "fulfilled" ? results[3].value.data || [] : [],
        auditLogs: results[4].status === "fulfilled" ? results[4].value.data || [] : [],
        members: results[5].status === "fulfilled" ? results[5].value.data || [] : [],
        menuItems: Array.isArray(menuData)
          ? menuData
          : Object.entries(menuData).map(([name, item]) => ({
            name,
            price: item?.price || 0,
            category: item?.category || "Menu",
            available: item?.available !== false,
          })),
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
        hint: "Start from Live Floor",
        icon: "ti-plus",
        action: () => onNewSession(),
      },
      {
        id: "live-floor",
        label: "Live Floor",
        hint: "Floor status and sessions",
        icon: "ti-circle-dot",
        action: () => setPage("live-floor"),
      },
      {
        id: "tables",
        label: "Legacy table controls",
        hint: "Legacy checkout controls",
        icon: "ti-layout-board",
        action: () => setPage("tables"),
      },
      {
        id: "bookings",
        label: "Bookings",
        hint: "Reservations and no-shows",
        icon: "ti-calendar-event",
        action: () => setPage("reservations"),
      },
      {
        id: "customers",
        label: "Customers",
        hint: "Members and spend",
        icon: "ti-users",
        action: () => setPage("members"),
        adminOnly: true,
      },
      {
        id: "food",
        label: "Cafe POS",
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
        label: "Analytics",
        hint: "Revenue and table performance",
        icon: "ti-chart-bar",
        action: () => setPage("reports"),
        adminOnly: true,
      },
      {
        id: "sales",
        label: "Sales",
        hint: "Transactions and receipts",
        icon: "ti-receipt",
        action: () => setPage("billing"),
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
      {
        id: "dashboard",
        label: "Executive overview",
        hint: "Owner dashboard",
        icon: "ti-layout-dashboard",
        action: () => setPage("dashboard"),
        adminOnly: true,
      },
    ],
    [onNewSession, setPage],
  );

  const dynamicCommands = useMemo(() => {
    const sessionCommands = searchData.sessions.map((session) => ({
      id: `session-${session.table_id}`,
      label: `${String(session.table_id || "").toUpperCase()} running table`,
      hint: `${session.customer_name || "Player"} · ${getTableLabel(HSR_TABLES.find((table) => table.id === String(session.table_id || "").toLowerCase())) || "Table"} · open workspace`,
      icon: "ti-player-play",
      action: () => setPage("live-floor"),
    }));
    const tableCommands = searchData.tables.map((table) => ({
      id: `table-${table.id}`,
      label: `${String(table.id || "").toUpperCase()} · ${table.label || "Table"}`,
      hint: `${table.status_label || "Available"} · ₹${Number(table.rate || 0).toLocaleString("en-IN")}/hr · Live Floor`,
      icon: table.status_key === "running" ? "ti-player-play" : "ti-layout-board",
      action: () => setPage("live-floor"),
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
    const memberCommands = searchData.members.slice(0, 10).map((member) => ({
      id: `member-${member.id}`,
      label: member.nm || "Customer",
      hint: `${member.id || "Customer"} · ${member.typ || "Regular"} · ${Number(member.vis || 0).toLocaleString("en-IN")} visits · ₹${Number(member.spt || 0).toLocaleString("en-IN")} spent`,
      icon: "ti-user-circle",
      action: () => setPage("members"),
      adminOnly: true,
    }));
    const menuCommands = searchData.menuItems.slice(0, 24).map((item) => ({
      id: `menu-${item.name}`,
      label: item.name || "Menu item",
      hint: `${item.category || "Menu"} · ₹${Number(item.price || 0).toLocaleString("en-IN")} · ${item.available === false ? "Out of stock" : "In stock"} · Inventory`,
      icon: "ti-tools-kitchen-2",
      action: () => setPage("inventory"),
      adminOnly: true,
    }));
    return [...sessionCommands, ...tableCommands, ...waitlistCommands, ...bookingCommands, ...foodCommands, ...auditCommands, ...memberCommands, ...menuCommands];
  }, [searchData, setPage]);

  const allowedCommands = [...commands, ...dynamicCommands].filter((cmd) => role === "admin" || !cmd.adminOnly);
  const filtered = allowedCommands.filter((cmd) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${cmd.label} ${cmd.hint}`.toLowerCase().includes(q);
  });

  function openCommandPalette() {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }

  function closeCommandPalette({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => openerRef.current?.focus?.(), 0);
    }
  }

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
        openCommandPalette();
      }
      if (e.key === "Escape") closeCommandPalette();
    }
    function onOpenCommand() {
      openCommandPalette();
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
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        paletteRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(cmd) {
    cmd.action();
    closeCommandPalette({ restoreFocus: false });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="command-overlay" role="presentation" onMouseDown={() => closeCommandPalette()}>
      <div
        ref={paletteRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        aria-describedby="command-palette-help"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <p id="command-palette-help" className="sr-only">
          Search pages, live sessions, waitlist entries and actions. Use arrow keys to move and Enter to open.
        </p>
        <div className="command-input-wrap">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={filtered[activeIndex] ? `command-result-${filtered[activeIndex].id}` : undefined}
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
        <div id="command-results" className="command-list" role="listbox" aria-label="Command results">
          {loadingData && !query.trim() ? (
            <div className="command-empty">Loading live results...</div>
          ) : filtered.length === 0 ? (
            <div className="command-empty">No matching command</div>
          ) : (
            filtered.map((cmd, index) => (
              <button
                id={`command-result-${cmd.id}`}
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
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
