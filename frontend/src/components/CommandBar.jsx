import { Icon as HsrIcon, Input as HsrInput, Button as HsrButton, SkeletonBlock, EmptyState, Modal } from "./ui/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import RetryNotice from "./RetryNotice.jsx";
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
import { formatCurrency } from "../utils/format.js";

const numberText = value => value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN") : "-";
const moneyText = value => numberText(value) === "-" ? "-" : formatCurrency(value);

export default function CommandBar({ page, setPage, onNewSession, role = "admin" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const restoreFocusRef = useRef(true);
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
  const [searchError, setSearchError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function loadSearchData() {
      setLoadingData(true);
      setSearchError("");
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
      const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === "object") : [];
      const responseRows = index => results[index].status === "fulfilled" ? rows(results[index].value.data) : [];
      setSearchData({
        sessions: rows(tableData.active_sessions),
        tables: rows(tableData.tables),
        waitlist: responseRows(1),
        bookings: responseRows(2),
        foodOrders: responseRows(3),
        auditLogs: responseRows(4),
        members: responseRows(5),
        menuItems: Array.isArray(menuData)
          ? rows(menuData)
          : Object.entries(menuData).filter(([, item]) => item && typeof item === "object").map(([name, item]) => ({
            name,
            price: item.price,
            category: item?.category || "Menu",
            available: typeof item.available === "boolean" ? item.available : null,
          })),
      });
      if (results.some(result => result.status === "rejected") || results.slice(1, 6).some(result => result.status === "fulfilled" && !Array.isArray(result.value.data)) || !Array.isArray(tableData.tables) || !Array.isArray(tableData.active_sessions)) setSearchError("Some live results could not load.");
      setLoadingData(false);
    }
    loadSearchData();
    return () => {
      alive = false;
    };
  }, [open, role, retry]);

  const commands = useMemo(
    () => [
      {
        id: "new-session",
        label: "New session",
        hint: "Start from Live Floor",
        aliases: "start table walk in open table",
        icon: "ti-plus",
        action: () => onNewSession(),
      },
      {
        id: "live-floor",
        label: "Live Floor",
        hint: "Floor status and sessions",
        aliases: "tables table floor active running timer",
        icon: "ti-circle-dot",
        action: () => setPage("live-floor"),
      },
      {
        id: "tables",
        label: "Advanced table controls",
        hint: "Detailed checkout, booking and exception controls",
        aliases: "advanced table controls checkout legacy exceptions",
        icon: "ti-layout-board",
        action: () => setPage("tables"),
      },
      {
        id: "bookings",
        label: "Bookings",
        hint: "Reservations and no-shows",
        aliases: "reservation reserve booking slots slot",
        icon: "ti-calendar-event",
        action: () => setPage("reservations"),
      },
      {
        id: "customers",
        label: "Customers",
        hint: "Members and spend",
        aliases: "customer member members crm loyalty profiles",
        icon: "ti-users",
        action: () => setPage("members"),
        adminOnly: true,
      },
      {
        id: "food",
        label: "Cafe POS",
        hint: "Menu and cart",
        aliases: "food cafe pos snacks beverage beverages order counter",
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
        id: "waitlist",
        label: "Waitlist",
        hint: "Walk-in queue and seating pressure",
        aliases: "queue wait waiting walk in walk-in guest guests",
        icon: "ti-clock",
        action: () => setPage("waitlist"),
      },
      {
        id: "reports",
        label: "Analytics",
        hint: "Revenue and table performance",
        aliases: "report reports analytics performance revenue",
        icon: "ti-chart-bar",
        action: () => setPage("reports"),
        adminOnly: true,
      },
      {
        id: "sales",
        label: "Sales",
        hint: "Transactions and receipts",
        aliases: "bill bills billing invoice invoices transaction transactions receipt receipts",
        icon: "ti-receipt",
        action: () => setPage("billing"),
        adminOnly: true,
      },
      {
        id: "closing",
        label: "Daily closing",
        hint: "Cash, UPI and open tables",
        aliases: "close day eod shift end closing cash tally",
        icon: "ti-clipboard-check",
        action: () => setPage("closing"),
      },
      {
        id: "settings",
        label: "Settings",
        hint: "Club configuration and staff credentials",
        aliases: "configuration credentials auth login staff admin controls",
        icon: "ti-settings",
        action: () => setPage("settings"),
        adminOnly: true,
      },
      {
        id: "inventory",
        label: "Inventory & Stocks",
        hint: "Menu items, stock and maintenance",
        aliases: "inventory stock stocks menu items item availability out of stock maintenance",
        icon: "ti-package",
        action: () => setPage("inventory"),
        adminOnly: true,
      },
      {
        id: "operations",
        label: "Pricing & Rules",
        hint: "Peak-hour rates, tax and operational controls",
        aliases: "pricing price rates rate rules gst tax operations controls peak hour",
        icon: "ti-adjustments",
        action: () => setPage("operations"),
        adminOnly: true,
      },
      {
        id: "audit-log",
        label: "Audit Log",
        hint: "Staff and system activity history",
        aliases: "audit log staff activity system history events",
        icon: "ti-user-check",
        action: () => setPage("staff"),
        adminOnly: true,
      },
      {
        id: "dashboard",
        label: "Executive overview",
        hint: "Owner dashboard",
        aliases: "dashboard overview owner home",
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
      hint: `${session.customer_name || "Guest"} · ${getTableLabel(HSR_TABLES.find((table) => table.id === String(session.table_id || "").toLowerCase())) || "Table"} · open workspace`,
      icon: "ti-player-play",
      action: () => setPage("live-floor"),
    }));
    const tableCommands = searchData.tables.map((table) => ({
      id: `table-${table.id}`,
      label: `${String(table.id || "").toUpperCase()} · ${table.label || "Table"}`,
      hint: `${table.status_label || "Status unavailable"} · ${moneyText(table.rate)}/hr · Live Floor`,
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
      hint: `${moneyText(order.total)} · ${order.payment_method || "Payment method unavailable"}`,
      icon: "ti-tools-kitchen-2",
      action: () => setPage("food"),
    }));
    const auditCommands = searchData.auditLogs.slice(0, 6).map((log) => ({
      id: `audit-${log.id}`,
      label: log.action?.replaceAll("_", " ") || "Audit event",
      hint: `${log.staff || "Unknown actor"} · ${log.detail || log.date || ""}`,
      icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
      action: () => setPage("reports"),
      adminOnly: true,
    }));
    const memberCommands = searchData.members.slice(0, 10).map((member) => ({
      id: `member-${member.id}`,
      label: member.name || member.nm || "Unknown customer",
      hint: `${member.customer_id || member.id || "Customer"} · ${numberText(member.visits ?? member.vis)} visits · ${moneyText(member.spent ?? member.spt)} spent`,
      icon: "ti-user-circle",
      action: () => setPage("members"),
      adminOnly: true,
    }));
    const menuCommands = searchData.menuItems.slice(0, 24).map((item) => ({
      id: `menu-${item.name}`,
      label: item.name || "Menu item",
      hint: `${item.category || "Menu"} · ${moneyText(item.price)} · ${item.available === false ? "Out of stock" : item.available === true ? "In stock" : "Stock unavailable"} · Inventory`,
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
    return `${cmd.label} ${cmd.hint} ${cmd.aliases || ""}`.toLowerCase().includes(q);
  });
  const activeCommandId = filtered[activeIndex]?.id;
  useEffect(() => {
    if (open && activeCommandId) document.getElementById(`command-result-${activeCommandId}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeCommandId]);

  function openCommandPalette() {
    if (inputRef.current) { inputRef.current.focus(); return; }
    restoreFocusRef.current = true;
    setLoadingData(true);
    setOpen(true);
  }

  function closeCommandPalette({ restoreFocus = true } = {}) {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
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
        if (document.querySelector('[aria-modal="true"]:not(.command-palette)')) return;
        e.preventDefault();
        openCommandPalette();
      }
    }
    function onOpenCommand() {
      if (document.querySelector('[aria-modal="true"]:not(.command-palette)')) return;
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
    }
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
    <Modal open portal showHeader={false} title="Command palette"
        onClose={() => closeCommandPalette()}
        initialFocusRef={inputRef} restoreFocusRef={restoreFocusRef}
        overlayClassName="command-overlay"
        className="command-palette"
        aria-describedby="command-palette-help"
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <p id="command-palette-help" className="sr-only">
          Search pages, live sessions, waitlist entries and actions. Use arrow keys to move and Enter to open.
        </p>
        <div className="command-input-wrap">
          <HsrIcon className="ti ti-search" aria-hidden="true" />
          <HsrInput
            ref={inputRef}
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={filtered[activeIndex] ? `command-result-${filtered[activeIndex].id}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)));
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
          {searchError && <RetryNotice message={searchError} detail="Page shortcuts remain available." onRetry={() => setRetry(value => value + 1)} />}
          {filtered.length === 0 && !loadingData ? (
            <EmptyState icon="ti-search" title="No matching commands" description="No pages or live records match this search." secondaryAction={false} action={<HsrButton onClick={() => { setQuery(""); inputRef.current?.focus(); }}>Clear search</HsrButton>} />
          ) : (
            filtered.map((cmd, index) => (
              <HsrButton native
                id={`command-result-${cmd.id}`}
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`${index === activeIndex ? "active" : ""} ${page === cmd.id ? "current" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(cmd)}
              >
                <HsrIcon className={`ti ${cmd.icon}`} aria-hidden="true" />
                <span>{cmd.label}</span>
                <small>{cmd.hint}</small>
              </HsrButton>
            ))
          )}
          {loadingData && <SkeletonBlock rows={3} label="Loading live command results" />}
        </div>
    </Modal>
  );
}
