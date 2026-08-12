import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getActive,
  getAnalytics,
  getAuditLogs,
  getBookings,
  getClosingInsights,
  getClosingReport,
  getFoodOrders,
  getFoodStats,
  getWaitlist,
} from "../api/index.js";
import { HSR_TABLES, TOTAL_TABLES, getTableLabel } from "../config/hsrTables.js";

const TABLES = HSR_TABLES;
const tableKey = (tableId) => String(tableId || "").trim().toLowerCase();
const PIE_COLORS = ["var(--accent)", "var(--success)", "var(--warning)"];

function money(value = 0) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function fmtTime(secs = 0) {
  if (!secs || secs <= 0) return "00:00";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(secs % 60)).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function fmtShortDateTime(value) {
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

function parseDateLoose(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.getTime();
  const match = String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:.*?(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, rawYear, hour = "0", minute = "0"] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function isInDashboardRange(timestamp, range) {
  if (range === "all" || !timestamp) return true;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "today") return timestamp >= today;
  const weekStart = today - 6 * 24 * 60 * 60 * 1000;
  return timestamp >= weekStart;
}

function pct(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function estimateTableCharge(session, elapsedSecs) {
  if (!session) return 0;
  const minutes = Math.max(1, Math.ceil((elapsedSecs || 0) / 60));
  return Math.ceil((minutes * (session.rate || 0)) / 60);
}

function SectionHead({ eyebrow, title, action }) {
  return (
    <div className="ops-section-head">
      <div>
        {eyebrow && <span>{eyebrow}</span>}
        <h3>{title}</h3>
      </div>
      {action}
    </div>
  );
}

function BusinessPulse({
  ownerTotal,
  liveTableTotal,
  activeCount,
  foodAttachment,
  waitlistCount,
  openTables,
  longRunningCount,
  onNavigate,
}) {
  const riskScore = openTables * 14 + longRunningCount * 10 + waitlistCount * 6 + (foodAttachment < 10 ? 8 : 0);
  const healthScore = Math.max(52, Math.min(99, 96 - riskScore));
  const status =
    openTables > 0
      ? "Close blockers"
      : longRunningCount > 0
        ? "Review long tables"
        : waitlistCount > 0
          ? "Seat queue"
          : "Under control";
  const statusTone = openTables || longRunningCount ? "warning" : "good";

  return (
    <section className="ops-cockpit">
      <div className="ops-cockpit-main">
        <div className="ops-cockpit-copy">
          <span className="ops-eyebrow">Owner command cockpit</span>
          <h2>Business health is {healthScore}%</h2>
          <p>
            {status}. Today has {money(ownerTotal)} closed revenue and {money(liveTableTotal)} still
            running on the floor.
          </p>
        </div>
        <div className={`ops-health-ring ${statusTone}`} style={{ "--score": `${healthScore}%` }}>
          <strong>{healthScore}</strong>
          <span>Health</span>
        </div>
      </div>

      <div className="ops-command-deck">
        <button type="button" className="primary" onClick={() => onNavigate("tables")}>
          <i className="ti ti-player-play" aria-hidden="true" />
          <span>
            <b>Open Floor</b>
            <small>{activeCount}/{TOTAL_TABLES} active tables</small>
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("food")}>
          <i className="ti ti-tools-kitchen-2" aria-hidden="true" />
          <span>
            <b>Cafe POS</b>
            <small>{foodAttachment}% food attachment</small>
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("waitlist")}>
          <i className="ti ti-user-clock" aria-hidden="true" />
          <span>
            <b>Waitlist</b>
            <small>{waitlistCount} waiting now</small>
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("reservations")}>
          <i className="ti ti-calendar-event" aria-hidden="true" />
          <span>
            <b>Bookings</b>
            <small>Manage table slots</small>
          </span>
        </button>
        <button type="button" className="danger" onClick={() => onNavigate("closing")}>
          <i className="ti ti-lock-check" aria-hidden="true" />
          <span>
            <b>Close Shift</b>
            <small>{openTables ? `${openTables} blockers` : "Ready check"}</small>
          </span>
        </button>
      </div>
    </section>
  );
}

function QuickOperations({ onNavigate, activeCount, waitingCount, bookingCount }) {
  const actions = [
    {
      label: "Start Table",
      sub: "",
      icon: "ti-player-play",
      page: "tables",
      tone: "primary",
    },
    {
      label: "Food POS",
      sub: "Counter order",
      icon: "ti-tools-kitchen-2",
      page: "food",
      tone: "food",
    },
    {
      label: "Bookings",
      sub: `${bookingCount} active`,
      icon: "ti-calendar-plus",
      page: "reservations",
      tone: "booking",
    },
    {
      label: "Queue",
      sub: `${waitingCount} waiting`,
      icon: "ti-clock",
      page: "waitlist",
      tone: "queue",
    },
    {
      label: "Closing",
      sub: activeCount ? `${activeCount} open` : "Ready",
      icon: "ti-lock-check",
      page: "closing",
      tone: "closing",
    },
  ];

  return (
    <div className="ops-quick-actions">
      {actions.map((action) => (
        <button
          type="button"
          key={action.label}
          className={`ops-quick-action ${action.tone}`}
          onClick={() => onNavigate(action.page)}
        >
          <i className={`ti ${action.icon}`} aria-hidden="true" />
          <span>
            <b>{action.label}</b>
            {action.sub && <small>{action.sub}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

function DashboardControlStrip({
  dateRange,
  onDateRangeChange,
  search,
  onSearchChange,
  role,
  onNavigate,
  activeCount,
  waitingCount,
  bookingCount,
}) {
  return (
    <section className="ops-control-strip" aria-label="Dashboard controls">
      <div className="ops-control-primary">
        <div>
          <span className="ops-eyebrow">{role === "staff" ? "Operator view" : "Executive view"}</span>
          <strong>{role === "staff" ? "Live floor control" : "Venue performance dashboard"}</strong>
        </div>
        <div className="ops-control-actions">
          <label>
            <i className="ti ti-calendar" aria-hidden="true" />
            <span>Register range</span>
            <select value={dateRange} onChange={(event) => onDateRangeChange(event.target.value)}>
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label className="ops-dashboard-search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search tables, orders, bookings..."
            />
          </label>
        </div>
      </div>
      <QuickOperations
        onNavigate={onNavigate}
        activeCount={activeCount}
        waitingCount={waitingCount}
        bookingCount={bookingCount}
      />
    </section>
  );
}

function KpiCard({ label, value, sub, tone = "neutral", icon, trend = "0%", direction = "neutral" }) {
  return (
    <article className={`ops-kpi ${tone}`}>
      <div className="ops-kpi-top">
        <span>{label}</span>
        <i className={`ti ${icon}`} aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <p>
        <em className={`ops-kpi-trend ${direction}`}>
          <i className={`ti ${direction === "down" ? "ti-trending-down" : direction === "up" ? "ti-trending-up" : "ti-minus"}`} aria-hidden="true" />
          {trend}
        </em>
        <span>{sub}</span>
      </p>
    </article>
  );
}

function LiveFloor({ sessions, elapsed, onNavigate }) {
  const activeCount = TABLES.filter((table) => Boolean(sessions[table.id])).length;
  return (
    <section className="ops-panel ops-floor-panel">
      <SectionHead
        title="Live Table Floor"
        action={
          <div className="ops-section-actions">
            <span className="ops-live-pill">{activeCount} running now</span>
            <button type="button" className="ops-link-btn" onClick={() => onNavigate("tables")}>
              Manage tables
            </button>
          </div>
        }
      />
      <div className="ops-floor-grid">
        {TABLES.map((table) => {
          const session = sessions[table.id];
          const elapsedSecs = elapsed[table.id] || 0;
          const active = Boolean(session);
          const busy = elapsedSecs >= 3600;
          const paused = session?.paused;
          const runningTotal = active
            ? estimateTableCharge(session, elapsedSecs) + (session.food_total || 0)
            : 0;
          return (
            <button
              type="button"
              key={table.id}
              className={`ops-table-card ${active ? "active" : "idle"} ${busy ? "busy" : ""} ${paused ? "paused" : ""}`}
              onClick={() => onNavigate("tables")}
            >
              <div className="ops-table-top">
                <strong>T{table.num}</strong>
                <span>{getTableLabel(table)}</span>
              </div>
              <div className="ops-table-status">
                <i className="ti ti-circle-filled" aria-hidden="true" />
                {paused ? "Paused" : active ? "Running" : "Available"}
              </div>
              <div className="ops-table-main">
                <span>{active ? fmtTime(elapsedSecs) : "--:--"}</span>
                <strong>{money(runningTotal)}</strong>
              </div>
              <div className="ops-table-meta">
                {active ? (
                  <>
                    <span>{session.customer_name || "Player"}</span>
                    <span>{session.billing_mode || "single"} · Food {money(session.food_total || 0)}</span>
                  </>
                ) : (
                  <>
                    <span>Ready to start</span>
                    <span>Tap to open table controls</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ActionQueue({ actions }) {
  const compact = actions.length === 1 && actions[0]?.tone === "positive";
  return (
    <section className={`ops-panel ${compact ? "ops-status-panel" : ""}`}>
      <SectionHead title="Action Queue" />
      <div className={`ops-action-list ${compact ? "compact" : ""}`}>
        {actions.map((item) => (
          <div className={`ops-action-row ${item.tone}`} key={item.title}>
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CloseReadiness({ digest, activeCount, onNavigate }) {
  const report = digest?.report;
  const openTables = report?.open_tables?.length ?? activeCount;
  const closed = Boolean(report?.day_close?.closed);
  const ready = !openTables && !closed;
  return (
    <section className={`ops-panel ops-close-card ${closed ? "closed" : ready ? "ready" : "blocked"}`}>
      <SectionHead
        eyebrow="End of day"
        title={closed ? "Day Already Closed" : ready ? "Ready To Close" : "Closing Blocked"}
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate("closing")}>
            View closing
          </button>
        }
      />
      <div className="ops-close-grid">
        <div>
          <span>Open tables</span>
          <strong>{openTables}</strong>
        </div>
        <div>
          <span>Expected cash</span>
          <strong>{money(report?.day_close?.expected_cash ?? report?.cash_total ?? 0)}</strong>
        </div>
        <div>
          <span>Peak hour</span>
          <strong>{report?.peak_hour || "-"}</strong>
        </div>
      </div>
      <p>
        {closed
          ? `Closed at ${report?.day_close?.closed_at || "-"} by ${report?.day_close?.closed_by || "-"}`
          : ready
            ? "All tables are clear. Count cash and lock the shift."
            : "Close running tables first, then complete cash and payment reconciliation."}
      </p>
    </section>
  );
}

function PaymentMix({ cashTotal, upiTotal, cardTotal }) {
  const rows = [
    { label: "Cash", value: cashTotal, tone: "cash" },
    { label: "UPI", value: upiTotal, tone: "upi" },
    { label: "Card", value: cardTotal, tone: "card" },
  ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <section className="ops-panel">
      <SectionHead eyebrow="Collection" title="Payment Mix" />
      <div className="ops-payment-list">
        {rows.map((row) => {
          const pct = total ? Math.round((row.value / total) * 100) : 0;
          return (
            <div className="ops-payment-row" key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <span>{pct}% of collected revenue</span>
              </div>
              <em>{money(row.value)}</em>
              <div className="ops-payment-track">
                <span className={row.tone} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Insights({ digest }) {
  const insights = digest?.insights?.insights?.slice(0, 3) || [];
  return (
    <section className="ops-panel">
      <SectionHead eyebrow="Owner digest" title="Smart Checks" />
      <div className="ops-insights">
        {insights.length ? (
          insights.map((insight, index) => (
            <div className={`ops-insight ${insight.type || "info"}`} key={`${insight.title}-${index}`}>
              <i className="ti ti-bulb" aria-hidden="true" />
              <div>
                <strong>{insight.title}</strong>
                <span>{insight.detail}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="ops-insight positive">
            <i className="ti ti-check" aria-hidden="true" />
            <div>
              <strong>No unusual activity</strong>
              <span>Run a few sessions and insights will populate here.</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function QueueBookings({ waitlist, bookings, onNavigate }) {
  const nextBookings = bookings
    .filter((booking) => booking.status === "booked")
    .slice(0, 3);
  const missedCount = bookings.filter((booking) => booking.status === "missed").length;

  return (
    <section className="ops-panel">
      <SectionHead
        eyebrow="Reception"
        title="Queue & Bookings"
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate("tables")}>
            Manage
          </button>
        }
      />
      <div className="ops-mini-metrics">
        <div>
          <span>Waiting</span>
          <strong>{waitlist.length}</strong>
        </div>
        <div>
          <span>Bookings</span>
          <strong>{nextBookings.length}</strong>
        </div>
        <div className={missedCount ? "warning" : ""}>
          <span>Missed</span>
          <strong>{missedCount}</strong>
        </div>
      </div>
      <div className="ops-compact-list">
        {waitlist.slice(0, 2).map((entry) => (
          <div key={`queue-${entry.id}`}>
            <i className="ti ti-user-clock" aria-hidden="true" />
            <span>
              <b>{entry.customer_name}</b>
              <small>
                Queue #{entry.position} · {entry.preferred_type || "Any"} · {entry.wait_mins || 0}m
              </small>
            </span>
          </div>
        ))}
        {nextBookings.map((booking) => (
          <div key={`booking-${booking.id}`}>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>
              <b>{booking.customer_name}</b>
              <small>
                {booking.table_id || "ANY"} · {fmtShortDateTime(booking.booking_time)}
              </small>
            </span>
          </div>
        ))}
        {!waitlist.length && !nextBookings.length && (
          <div className="ops-empty-line">
            <i className="ti ti-circle-check" aria-hidden="true" />
            <span>
              <b>No queue pressure</b>
              <small>Walk-ins can be seated directly.</small>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function PopularFood({ foodStats, foodOrders, onNavigate }) {
  const topItems = foodStats.slice(0, 5);
  const recentOrders = foodOrders.slice(0, 2);
  return (
    <section className="ops-panel">
      <SectionHead
        eyebrow="Cafe"
        title="Food Demand"
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate("food")}>
            POS
          </button>
        }
      />
      {topItems.length ? (
        <div className="ops-food-demand">
          {topItems.map((item, index) => {
            const maxQty = topItems[0]?.qty || 1;
            return (
              <div key={item.name}>
                <span>
                  <b>{index + 1}. {item.name}</b>
                  <small>{item.qty} sold · {money(item.revenue)}</small>
                </span>
                <em style={{ width: `${pct(item.qty, maxQty)}%` }} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ops-empty-line">
          <i className="ti ti-tools-kitchen-2" aria-hidden="true" />
          <span>
            <b>No food trend yet</b>
            <small>Orders will create a top-sellers list here.</small>
          </span>
        </div>
      )}
      {recentOrders.length > 0 && (
        <div className="ops-recent-orders">
          {recentOrders.map((order) => (
            <div key={order.id}>
              <span>{order.customer_name || "Counter"}</span>
              <strong>{money(order.total)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentActivity({ auditLogs, runningTables, foodOrders }) {
  const liveRows = runningTables.map(({ table, session, elapsedSecs }) => ({
    id: `live-${table.id}`,
    icon: "ti-player-play",
    title: `T${table.num} running`,
    detail: `${session.customer_name || "Player"} · ${fmtTime(elapsedSecs)} · ${money(estimateTableCharge(session, elapsedSecs))}`,
    tone: "positive",
  }));
  const orderRows = foodOrders.slice(0, 2).map((order) => ({
    id: `order-${order.id}`,
    icon: "ti-tools-kitchen-2",
    title: `Food order ${money(order.total)}`,
    detail: `${order.customer_name || "Counter"} · ${order.payment_method || "Cash"}`,
    tone: "info",
  }));
  const auditRows = auditLogs.slice(0, 4).map((log) => ({
    id: `audit-${log.id}`,
    icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
    title: log.action?.replaceAll("_", " ") || "Activity",
    detail: `${log.staff || "system"} · ${log.detail || log.date || ""}`,
    tone: log.severity === "danger" ? "critical" : "info",
  }));
  const rows = [...liveRows, ...orderRows, ...auditRows].slice(0, 6);

  return (
    <section className="ops-panel">
      <SectionHead eyebrow="Audit trail" title="Recent Activity" />
      <div className="ops-timeline">
        {rows.length ? (
          rows.map((row) => (
            <div className={row.tone} key={row.id}>
              <i className={`ti ${row.icon}`} aria-hidden="true" />
              <span>
                <b>{row.title}</b>
                <small>{row.detail}</small>
              </span>
            </div>
          ))
        ) : (
          <div className="ops-empty-line">
            <i className="ti ti-history" aria-hidden="true" />
            <span>
              <b>No recent activity</b>
              <small>Session and checkout activity will appear here.</small>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function TodayTimeline({ runningTables, foodOrders, bookings, auditLogs, onNavigate, role = "admin" }) {
  const rows = [
    ...runningTables.map(({ table, session, elapsedSecs }) => ({
      id: `live-${table.id}`,
      time: "Live now",
      title: `T${table.num} running`,
      detail: `${session.customer_name || "Player"} · ${fmtTime(elapsedSecs)} · ${money(estimateTableCharge(session, elapsedSecs) + (session.food_total || 0))}`,
      icon: "ti-player-play",
      tone: "active",
      page: "tables",
    })),
    ...foodOrders.slice(0, 4).map((order) => ({
      id: `food-${order.id}`,
      time: order.date || "Food",
      title: `${order.customer_name || "Counter"} food order`,
      detail: `${money(order.total)} · ${order.payment_method || "Cash"} · ${order.items?.length || 0} item(s)`,
      icon: "ti-tools-kitchen-2",
      tone: "food",
      page: "food",
    })),
    ...bookings.slice(0, 4).map((booking) => ({
      id: `booking-${booking.id}`,
      time: fmtShortDateTime(booking.booking_time),
      title: `${booking.customer_name || "Guest"} booking`,
      detail: `${booking.table_id || "ANY"} · ${booking.status || "booked"} · ${booking.duration_mins || 60} min`,
      icon: booking.status === "missed" ? "ti-alert-triangle" : "ti-calendar-event",
      tone: booking.status === "missed" ? "warning" : "booking",
      page: "reservations",
    })),
    ...auditLogs.slice(0, 5).map((log) => ({
      id: `audit-${log.id}`,
      time: log.date || "Audit",
      title: log.action?.replaceAll("_", " ") || "System activity",
      detail: `${log.staff || "system"} · ${log.detail || ""}`,
      icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
      tone: log.severity === "danger" || log.severity === "critical" ? "critical" : "audit",
      page: "reports",
      adminOnly: true,
    })),
  ].filter((row) => role === "admin" || !row.adminOnly).slice(0, 9);

  return (
    <section className="ops-panel ops-today-panel">
      <SectionHead
        eyebrow="Today timeline"
        title="Live Activity Feed"
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate(role === "admin" ? "reports" : "tables")}>
            Full history
          </button>
        }
      />
      <div className="ops-today-list">
        {rows.length ? (
          rows.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`ops-today-row ${row.tone}`}
              onClick={() => onNavigate(row.page)}
            >
              <i className={`ti ${row.icon}`} aria-hidden="true" />
              <span>
                <b>{row.title}</b>
                <small>{row.detail}</small>
              </span>
              <time>{row.time}</time>
            </button>
          ))
        ) : (
          <div className="ops-empty-line">
            <i className="ti ti-history" aria-hidden="true" />
            <span>
              <b>No activity yet</b>
              <small>Start a table or place an order to build the day timeline.</small>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function StaffOpsHeader({ runningTables, waitlist, bookings, foodOrders, onNavigate }) {
  const openBookings = bookings.filter((booking) => booking.status === "booked").length;
  const urgent = [
    runningTables.length ? `${runningTables.length} table${runningTables.length > 1 ? "s" : ""} live` : "Floor idle",
    waitlist.length ? `${waitlist.length} waiting` : "No waitlist",
    foodOrders.length ? `${foodOrders.length} food order${foodOrders.length > 1 ? "s" : ""}` : "No food queue",
    openBookings ? `${openBookings} booking${openBookings > 1 ? "s" : ""}` : "No bookings",
  ];
  return (
    <section className="ops-staff-header">
      <div>
        <span className="ops-eyebrow">Staff operations desk</span>
        <h2>Run the floor from here</h2>
        <p>{urgent.join(" · ")}</p>
      </div>
      <div className="ops-staff-actions">
        <button type="button" className="ops-action primary" onClick={() => onNavigate("tables")}>
          <i className="ti ti-player-play" aria-hidden="true" />
          Tables
        </button>
        <button type="button" className="ops-action" onClick={() => onNavigate("food")}>
          <i className="ti ti-tools-kitchen-2" aria-hidden="true" />
          Food
        </button>
        <button type="button" className="ops-action" onClick={() => onNavigate("closing")}>
          <i className="ti ti-lock-check" aria-hidden="true" />
          Closing
        </button>
      </div>
    </section>
  );
}

function StaffDashboard({
  dateRange,
  onDateRangeChange,
  dashboardSearch,
  onDashboardSearchChange,
  runningTables,
  sessions,
  elapsed,
  waitlist,
  bookings,
  foodOrders,
  actionItems,
  workRows,
  tableSort,
  onTableSortChange,
  tablePage,
  onTablePageChange,
  onNavigate,
}) {
  const upcomingBookings = bookings.filter((booking) => booking.status === "booked");
  return (
    <div className="ops-dashboard staff-mode">
      <DashboardControlStrip
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        search={dashboardSearch}
        onSearchChange={onDashboardSearchChange}
        role="staff"
        onNavigate={onNavigate}
        activeCount={runningTables.length}
        waitingCount={waitlist.length}
        bookingCount={upcomingBookings.length}
      />
      <StaffOpsHeader
        runningTables={runningTables}
        waitlist={waitlist}
        bookings={bookings}
        foodOrders={foodOrders}
        onNavigate={onNavigate}
      />
      <div className="ops-kpi-grid four">
        <KpiCard
          label="Active Tables"
          value={`${runningTables.length}/${TOTAL_TABLES}`}
          sub="tables live right now"
          trend={`${Math.max(TOTAL_TABLES - runningTables.length, 0)} idle`}
          direction={runningTables.length ? "up" : "neutral"}
          tone="green"
          icon="ti-layout-grid"
        />
        <KpiCard
          label="Live Floor Value"
          value={money(runningTables.reduce((sum, row) => sum + estimateTableCharge(row.session, row.elapsedSecs) + (row.session.food_total || 0), 0))}
          sub="estimated running bill"
          trend="live"
          direction="up"
          tone="blue"
          icon="ti-live-view"
        />
        <KpiCard
          label="Waitlist"
          value={waitlist.length}
          sub="guests waiting"
          trend={waitlist.length ? "seat now" : "clear"}
          direction={waitlist.length ? "down" : "neutral"}
          tone={waitlist.length ? "amber" : "neutral"}
          icon="ti-user-clock"
        />
        <KpiCard
          label="Food Orders"
          value={foodOrders.length}
          sub="recent food bills"
          trend="POS"
          direction="neutral"
          icon="ti-tools-kitchen-2"
        />
      </div>
      <div className="ops-staff-grid">
        <LiveFloor sessions={sessions} elapsed={elapsed} onNavigate={onNavigate} />
        <div className="ops-side-stack">
          <ActionQueue actions={actionItems} />
          <QueueBookings waitlist={waitlist} bookings={bookings} onNavigate={onNavigate} />
        </div>
      </div>
      <DashboardDataTable
        rows={workRows}
        sort={tableSort}
        onSortChange={onTableSortChange}
        page={tablePage}
        onPageChange={onTablePageChange}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function OwnerIntelligence({ utilization, foodAttachment, longRunningCount, waitlistCount, ownerTotal, liveTableTotal, onNavigate }) {
  const topTable = utilization
    .filter((row) => Number(row.revenue || 0) > 0)
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))[0];
  const recommendations = [
    topTable
      ? {
          title: `${topTable.table} is the revenue leader`,
          detail: `${money(topTable.revenue)} from ${topTable.sessions || 0} session(s). Keep this table visible in staff handover.`,
          icon: "ti-chart-bar",
          tone: "positive",
        }
      : {
          title: "Revenue pattern still building",
          detail: "Close a few sessions and this panel will surface table-level recommendations.",
          icon: "ti-chart-dots",
          tone: "neutral",
        },
    foodAttachment < 15
      ? {
          title: "Food attach can improve",
          detail: `Food is ${foodAttachment}% of revenue. Prompt tea, fries, cold drinks, or cigarettes during long frames.`,
          icon: "ti-tools-kitchen-2",
          tone: "warning",
        }
      : {
          title: "Food attachment is healthy",
          detail: `${foodAttachment}% of revenue includes food. Keep best sellers easy to add.`,
          icon: "ti-circle-check",
          tone: "positive",
        },
    longRunningCount
      ? {
          title: "Review long-running tables",
          detail: `${longRunningCount} active table(s) have crossed 90 minutes. Confirm frames, pause state, and running total.`,
          icon: "ti-clock-exclamation",
          tone: "critical",
        }
      : {
          title: "No long-session risk",
          detail: "Current sessions are within normal operating range.",
          icon: "ti-shield-check",
          tone: "positive",
        },
    waitlistCount
      ? {
          title: "Queue needs seating",
          detail: `${waitlistCount} guest(s) waiting. Move them before they churn.`,
          icon: "ti-user-clock",
          tone: "warning",
        }
      : {
          title: "Reception pressure is low",
          detail: "No one is waiting right now.",
          icon: "ti-users",
          tone: "neutral",
        },
  ];

  return (
    <section className="ops-panel ops-owner-intel">
      <SectionHead
        eyebrow="Owner intelligence"
        title="What To Act On"
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate("reports")}>
            Reports
          </button>
        }
      />
      <div className="ops-intel-summary">
        <div>
          <span>Closed</span>
          <strong>{money(ownerTotal)}</strong>
        </div>
        <div>
          <span>Still running</span>
          <strong>{money(liveTableTotal)}</strong>
        </div>
      </div>
      <div className="ops-intel-list">
        {recommendations.map((item) => (
          <div className={`ops-intel-row ${item.tone}`} key={item.title}>
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            <span>
              <b>{item.title}</b>
              <small>{item.detail}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardDataTable({ rows, sort, onSortChange, page, onPageChange, pageSize = 6, onNavigate }) {
  const columns = [
    { id: "type", label: "Type" },
    { id: "name", label: "Item" },
    { id: "status", label: "Status" },
    { id: "amount", label: "Amount" },
    { id: "time", label: "Time" },
  ];
  const sorted = [...rows].sort((a, b) => {
    const dir = sort.direction === "asc" ? 1 : -1;
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === "number" || typeof bv === "number") {
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
    }
    return String(av || "").localeCompare(String(bv || "")) * dir;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function changeSort(key) {
    onSortChange((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  }

  return (
    <section className="ops-panel ops-data-table-panel">
      <SectionHead eyebrow="Operations table" title="Live Work Register" />
      <div className="ops-data-table-wrap">
        <table className="ops-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id}>
                  <button type="button" onClick={() => changeSort(column.id)}>
                    {column.label}
                    <i
                      className={`ti ${
                        sort.key === column.id
                          ? sort.direction === "asc"
                            ? "ti-chevron-up"
                            : "ti-chevron-down"
                          : "ti-selector"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((row) => (
                <tr key={row.id} onClick={() => onNavigate(row.page)}>
                  <td><span className={`ops-table-pill ${row.tone}`}>{row.type}</span></td>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.detail}</small>
                  </td>
                  <td>{row.status}</td>
                  <td>{row.amountLabel}</td>
                  <td>{row.time}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <div className="ops-empty-line">
                    <i className="ti ti-search" aria-hidden="true" />
                    <span>
                      <b>No matching records</b>
                      <small>Clear the search field or wait for live activity.</small>
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ops-table-pagination">
        <span>{sorted.length} records · page {safePage} of {totalPages}</span>
        <div>
          <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
            Previous
          </button>
          <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function Charts({ analytics, pieData }) {
  return (
    <div className="ops-chart-grid">
      <section className="ops-panel">
        <SectionHead eyebrow="Trend" title="Revenue Last 7 Days" />
        {analytics ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={analytics.weekly}>
              <defs>
                <linearGradient id="dashRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.18} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#7b8794" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#7b8794" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)}
              />
              <Tooltip formatter={(v) => [money(v), "Revenue"]} />
              <Area type="monotone" dataKey="revenue" stroke="var(--accent)" fill="url(#dashRevenue)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="ops-empty-chart">Loading chart...</div>
        )}
      </section>

      <section className="ops-panel">
        <SectionHead eyebrow="Source" title="Revenue Split" />
        {pieData.length ? (
          <div className="ops-breakdown">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [money(v), ""]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="ops-breakdown-list">
              {pieData.map((row, index) => (
                <div key={row.name}>
                  <span style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                  <strong>{row.name}</strong>
                  <em>{money(row.value)}</em>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ops-empty-chart">No revenue split yet</div>
        )}
      </section>
    </div>
  );
}

export default function Dashboard({ metrics, onNavigate, role = "admin" }) {
  const [dateRange, setDateRange] = useState("today");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [tableSort, setTableSort] = useState({ key: "time", direction: "desc" });
  const [tablePage, setTablePage] = useState(1);
  const [sessions, setSessions] = useState({});
  const [elapsed, setElapsed] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [digest, setDigest] = useState(null);
  const [waitlist, setWaitlist] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [foodStats, setFoodStats] = useState([]);
  const [foodOrders, setFoodOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await getActive();
        const nextSessions = {};
        const nextElapsed = {};
        res.data.forEach((session) => {
          const id = tableKey(session.table_id);
          nextSessions[id] = { ...session, table_id: id };
          nextElapsed[id] = Math.floor(
            (session.paused ? session.elapsed_ms : Date.now() - session.start_time) / 1000,
          );
        });
        setSessions(nextSessions);
        setElapsed(nextElapsed);
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchAnalytics() {
      try {
        const res = await getAnalytics();
        setAnalytics(res.data);
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchDigest() {
      try {
        const [reportRes, insightRes] = await Promise.all([
          getClosingReport(),
          getClosingInsights(),
        ]);
        setDigest({ report: reportRes.data, insights: insightRes.data });
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchOperations() {
      const results = await Promise.allSettled([
        getWaitlist(),
        getBookings(),
        getFoodStats(),
        getFoodOrders(),
        getAuditLogs(12),
      ]);
      if (results[0].status === "fulfilled") setWaitlist(results[0].value.data || []);
      if (results[1].status === "fulfilled") setBookings(results[1].value.data || []);
      if (results[2].status === "fulfilled") setFoodStats(results[2].value.data || []);
      if (results[3].status === "fulfilled") setFoodOrders(results[3].value.data || []);
      if (results[4].status === "fulfilled") setAuditLogs(results[4].value.data || []);
    }

    fetchActive();
    const deferredLoad = window.setTimeout(() => {
      if (role === "admin") {
        fetchDigest();
        fetchAnalytics();
      }
      fetchOperations();
    }, 200);
    const activeInterval = window.setInterval(fetchActive, 20000);
    const operationsInterval = window.setInterval(fetchOperations, 45000);
    return () => {
      window.clearTimeout(deferredLoad);
      window.clearInterval(activeInterval);
      window.clearInterval(operationsInterval);
    };
  }, [role]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsed((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          if (!sessions[id]?.paused) next[id] += 1;
        });
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [sessions]);

  const runningTables = useMemo(
    () =>
      TABLES
        .filter((table) => sessions[table.id])
        .map((table) => ({
          table,
          session: sessions[table.id],
          elapsedSecs: elapsed[table.id] || 0,
        })),
    [sessions, elapsed],
  );

  const ownerReport = digest?.report;
  const cashTotal = ownerReport?.cash_total || 0;
  const upiTotal = ownerReport?.upi_total || 0;
  const cardTotal = ownerReport?.card_total || 0;
  const ownerTotal = ownerReport
    ? (ownerReport.total_revenue || 0) + (ownerReport.food_only_revenue || 0)
    : metrics.sale;
  const liveTableTotal = runningTables.reduce(
    (sum, { session, elapsedSecs }) => sum + estimateTableCharge(session, elapsedSecs) + (session.food_total || 0),
    0,
  );
  const foodAttachment = ownerTotal > 0 ? Math.round(((metrics.food || 0) / ownerTotal) * 100) : 0;
  const occupancyPercent = pct(runningTables.length, TOTAL_TABLES);
  const upcomingBookings = bookings.filter((booking) => booking.status === "booked");

  const actionItems = useMemo(() => {
    const items = [];
    const paused = runningTables.filter((row) => row.session.paused);
    const longRunning = runningTables.filter((row) => row.elapsedSecs >= 90 * 60);
    const openFrames = runningTables.filter((row) => row.session.current_frame);
    if (openFrames.length) {
      items.push({
        title: `${openFrames.length} live frame${openFrames.length > 1 ? "s" : ""} blocking checkout`,
        detail: "End the running frame before closing LP tables so billing stays correct.",
        tone: "critical",
        icon: "ti-alert-triangle",
      });
    }
    if (paused.length) {
      items.push({
        title: `${paused.length} table${paused.length > 1 ? "s" : ""} paused`,
        detail: "Resume or close paused tables before the shift gets confusing.",
        tone: "warning",
        icon: "ti-player-pause",
      });
    }
    if (longRunning.length) {
      items.push({
        title: `${longRunning.length} long session${longRunning.length > 1 ? "s" : ""}`,
        detail: "Check if players need a frame close, food prompt, or checkout.",
        tone: "critical",
        icon: "ti-clock-exclamation",
      });
    }
    if (runningTables.length && foodAttachment < 10) {
      items.push({
        title: "Food attachment is low",
        detail: "Prompt tea, fries, cold drinks or cigarettes during checkout.",
        tone: "info",
        icon: "ti-tools-kitchen-2",
      });
    }
    if (ownerReport?.open_tables?.length) {
      items.push({
        title: "Closing has open tables",
        detail: `${ownerReport.open_tables.length} table(s) must be closed before EOD.`,
        tone: "warning",
        icon: "ti-lock-open",
      });
    }
    if (!items.length) {
      items.push({
        title: "Floor is under control",
        detail: "No stuck tables or urgent owner actions right now.",
        tone: "positive",
        icon: "ti-circle-check",
      });
    }
    return items.slice(0, 4);
  }, [runningTables, foodAttachment, ownerReport]);

  const workRows = useMemo(() => {
    const query = dashboardSearch.trim().toLowerCase();
    const rows = [
      ...runningTables.map(({ table, session, elapsedSecs }) => {
        const amount = estimateTableCharge(session, elapsedSecs) + (session.food_total || 0);
        return {
          id: `table-${table.id}`,
          type: "Table",
          tone: session.paused ? "warning" : "active",
          name: `T${table.num} · ${getTableLabel(table)}`,
          detail: `${session.customer_name || "Player"} · ${session.billing_mode || "single"}`,
          status: session.paused ? "Paused" : "Running",
          amount,
          amountLabel: money(amount),
          time: fmtTime(elapsedSecs),
          dateMs: Date.now(),
          page: "tables",
        };
      }),
      ...foodOrders.slice(0, 12).map((order) => {
        const dateMs = parseDateLoose(order.created_at || order.timestamp || order.date);
        return {
          id: `food-${order.id}`,
          type: "Food",
          tone: "food",
          name: order.customer_name || "Counter order",
          detail: `${order.items?.length || 0} item(s) · ${order.payment_method || "Cash"}`,
          status: "Billed",
          amount: Number(order.total || 0),
          amountLabel: money(order.total),
          time: order.date || "-",
          dateMs,
          page: "food",
        };
      }),
      ...bookings.slice(0, 12).map((booking) => {
        const dateMs = parseDateLoose(booking.booking_time);
        return {
          id: `booking-${booking.id}`,
          type: "Booking",
          tone: booking.status === "missed" ? "warning" : "booking",
          name: booking.customer_name || "Guest booking",
          detail: `${booking.table_id || "ANY"} · ${booking.duration_mins || 60} min`,
          status: booking.status || "booked",
          amount: 0,
          amountLabel: "-",
          time: fmtShortDateTime(booking.booking_time),
          dateMs,
          page: "reservations",
        };
      }),
      ...auditLogs.slice(0, 10).map((log) => {
        const dateMs = parseDateLoose(log.created_at || log.timestamp || log.date);
        return {
          id: `audit-${log.id}`,
          type: "Audit",
          tone: log.severity === "danger" || log.severity === "critical" ? "critical" : "audit",
          name: log.action?.replaceAll("_", " ") || "System activity",
          detail: `${log.staff || "system"} · ${log.detail || ""}`,
          status: log.severity || "info",
          amount: Number(log.amount || 0),
          amountLabel: log.amount ? money(log.amount) : "-",
          time: log.date || "-",
          dateMs,
          page: "reports",
          adminOnly: true,
        };
      }),
    ].filter((row) => role === "admin" || !row.adminOnly);
    return rows.filter((row) => (
      isInDashboardRange(row.dateMs, dateRange)
      && (!query || `${row.type} ${row.name} ${row.detail} ${row.status} ${row.time}`.toLowerCase().includes(query))
    ));
  }, [runningTables, foodOrders, bookings, auditLogs, dashboardSearch, dateRange, role]);

  useEffect(() => {
    setTablePage(1);
  }, [dashboardSearch, tableSort, dateRange]);

  const pieData = analytics
    ? [
        { name: "Snooker", value: analytics.breakdown.snooker },
        { name: "Pool", value: analytics.breakdown.pool },
        { name: "Food", value: analytics.breakdown.food },
      ].filter((row) => row.value > 0)
    : [];

  if (role === "staff") {
    return (
      <StaffDashboard
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        dashboardSearch={dashboardSearch}
        onDashboardSearchChange={setDashboardSearch}
        runningTables={runningTables}
        sessions={sessions}
        elapsed={elapsed}
        waitlist={waitlist}
        bookings={bookings}
        foodOrders={foodOrders}
        actionItems={actionItems}
        workRows={workRows}
        tableSort={tableSort}
        onTableSortChange={setTableSort}
        tablePage={tablePage}
        onTablePageChange={setTablePage}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="ops-dashboard">
      <DashboardControlStrip
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        search={dashboardSearch}
        onSearchChange={setDashboardSearch}
        role={role}
        onNavigate={onNavigate}
        activeCount={runningTables.length}
        waitingCount={waitlist.length}
        bookingCount={upcomingBookings.length}
      />

      <div className="ops-kpi-grid four">
        <KpiCard
          label="Today Revenue"
          value={money(ownerTotal)}
          sub={`${metrics.sessions || 0} sessions closed today`}
          trend={metrics.sessions ? `${metrics.sessions} bills` : "0 bills"}
          direction={ownerTotal ? "up" : "neutral"}
          tone="green"
          icon="ti-cash"
        />
        <KpiCard
          label="Live Floor Value"
          value={money(liveTableTotal)}
          sub="Estimated value still running"
          trend={`${runningTables.length} live`}
          direction={liveTableTotal ? "up" : "neutral"}
          tone="blue"
          icon="ti-live-view"
        />
        <KpiCard
          label="Active Tables"
          value={`${runningTables.length}/${TOTAL_TABLES}`}
          sub={`${occupancyPercent}% occupancy right now`}
          trend={`${Math.max(TOTAL_TABLES - runningTables.length, 0)} idle`}
          direction={runningTables.length ? "up" : "neutral"}
          tone="amber"
          icon="ti-layout-grid"
        />
        <KpiCard
          label="Food Attach"
          value={`${foodAttachment}%`}
          sub={`${money(metrics.food)} food revenue`}
          trend={foodAttachment >= 15 ? "healthy" : "low"}
          direction={foodAttachment >= 15 ? "up" : "down"}
          tone={foodAttachment >= 15 ? "green" : "amber"}
          icon="ti-tools-kitchen-2"
        />
      </div>

      <div className="ops-main-grid">
        <LiveFloor sessions={sessions} elapsed={elapsed} onNavigate={onNavigate} />
        <div className="ops-side-stack">
          <ActionQueue actions={actionItems} />
          <CloseReadiness digest={digest} activeCount={runningTables.length} onNavigate={onNavigate} />
        </div>
      </div>

      <Charts analytics={analytics} pieData={pieData} />

      <div className="ops-clubflow-grid">
        <QueueBookings waitlist={waitlist} bookings={bookings} onNavigate={onNavigate} />
        <PopularFood foodStats={foodStats} foodOrders={foodOrders} onNavigate={onNavigate} />
        <PaymentMix cashTotal={cashTotal} upiTotal={upiTotal} cardTotal={cardTotal} />
      </div>

      <DashboardDataTable
        rows={workRows}
        sort={tableSort}
        onSortChange={setTableSort}
        page={tablePage}
        onPageChange={setTablePage}
        onNavigate={onNavigate}
      />
    </div>
  );
}
