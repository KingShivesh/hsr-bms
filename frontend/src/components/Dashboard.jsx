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
  getDashboardLive,
} from "../api/index.js";
import { HSR_TABLES, TOTAL_TABLES, getTableLabel } from "../config/hsrTables.js";
import { getTableStatusByKey } from "../config/tableStatus.js";

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

function fmtSyncAge(value) {
  if (!value) return "Not synced yet";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 5) return "Just updated";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function pct(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function trendFromComparison(current, previous, label) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (previousValue <= 0 && currentValue <= 0) {
    return { tone: "neutral", icon: "ti-minus", label: "same as yesterday" };
  }
  if (previousValue <= 0) {
    return { tone: "up", icon: "ti-arrow-up-right", label: `new ${label} vs yesterday` };
  }
  const delta = Math.round(((currentValue - previousValue) / previousValue) * 100);
  if (delta === 0) return { tone: "neutral", icon: "ti-minus", label: "same as yesterday" };
  return {
    tone: delta > 0 ? "up" : "down",
    icon: delta > 0 ? "ti-arrow-up-right" : "ti-arrow-down-right",
    label: `${delta > 0 ? "+" : ""}${delta}% vs yesterday`,
  };
}

function normalizeTrend(trend, fallback) {
  if (!trend) return fallback || { tone: "neutral", icon: "ti-minus", label: "same as usual" };
  const direction = trend.direction || trend.tone || "flat";
  return {
    tone: direction === "up" ? "up" : direction === "down" ? "down" : "neutral",
    icon: direction === "up" ? "ti-arrow-up-right" : direction === "down" ? "ti-arrow-down-right" : "ti-minus",
    label: trend.label || fallback?.label || "same as usual",
  };
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

function DashboardRangeFilter({ dateRange, onDateRangeChange }) {
  return (
    <label className="ops-range-filter">
      <i className="ti ti-calendar" aria-hidden="true" />
      <span>Register Range</span>
      <select value={dateRange} onChange={(event) => onDateRangeChange(event.target.value)}>
        <option value="today">Today</option>
        <option value="week">Last 7 days</option>
        <option value="all">All time</option>
      </select>
    </label>
  );
}

function DashboardSyncStatus({ syncing, lastFetchedAt, loadError }) {
  const tone = loadError ? "error" : syncing ? "syncing" : "ok";
  return (
    <span className={`ops-sync-status ${tone}`} role="status" aria-live="polite">
      <i
        className={`ti ${loadError ? "ti-wifi-off" : syncing ? "ti-loader-2" : "ti-refresh"}`}
        aria-hidden="true"
      />
      {loadError ? "Sync issue" : syncing ? "Syncing..." : fmtSyncAge(lastFetchedAt)}
    </span>
  );
}

function QuickOperations({ onNavigate }) {
  const actions = [
    {
      label: "Start Table",
      icon: "ti-player-play",
      page: "tables",
    },
    {
      label: "Food POS",
      icon: "ti-tools-kitchen-2",
      page: "food",
    },
    {
      label: "Bookings",
      icon: "ti-calendar-plus",
      page: "reservations",
    },
    {
      label: "Queue",
      icon: "ti-clock",
      page: "waitlist",
    },
    {
      label: "Closing",
      icon: "ti-lock-check",
      page: "closing",
    },
  ];

  return (
    <section className="ops-quick-section" aria-label="Quick actions">
      <div className="ops-quick-actions">
        {actions.map((action) => (
          <button
            type="button"
            key={action.label}
            className="ops-quick-action"
            onClick={() => onNavigate(action.page)}
          >
            <i className={`ti ${action.icon}`} aria-hidden="true" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function KpiCard({ label, value, sub, icon, trend }) {
  return (
    <article className="ops-kpi">
      <div className="ops-kpi-top">
        <span>{label}</span>
        <i className={`ti ${icon}`} aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      {trend && (
        <em className={`ops-kpi-trend ${trend.tone || "neutral"}`}>
          <i className={`ti ${trend.icon || "ti-minus"}`} aria-hidden="true" />
          {trend.label}
        </em>
      )}
      <p>{sub}</p>
    </article>
  );
}

function KeyMetricsSection({
  dateRange,
  onDateRangeChange,
  periodLabel,
  syncing,
  lastFetchedAt,
  loadError,
  ownerTotal,
  sessionCount,
  liveTableTotal,
  activeCount,
  occupancyPercent,
  foodAttachment,
  foodRevenue,
  yesterday,
  trends,
}) {
  const yesterdayData = yesterday || {};
  const liveTrend = normalizeTrend(trends?.live_floor_value, { tone: "neutral", icon: "ti-minus", label: "live estimate now" });
  const activeTrend = normalizeTrend(trends?.active_tables, { tone: "neutral", icon: "ti-minus", label: `${TOTAL_TABLES - activeCount} idle now` });
  return (
    <section className="ops-metrics-section" aria-label="Key metrics">
      <div className="ops-metrics-head">
        <div>
          <h3>Key Metrics</h3>
          <p>{periodLabel || "Today"} register performance</p>
        </div>
        <div className="ops-metrics-actions">
          <DashboardSyncStatus syncing={syncing} lastFetchedAt={lastFetchedAt} loadError={loadError} />
          <DashboardRangeFilter dateRange={dateRange} onDateRangeChange={onDateRangeChange} />
        </div>
      </div>
      <div className="ops-kpi-grid four">
        {/* F-pattern rule: Today Revenue stays first/top-left unless the owner deliberately changes priority. */}
        <KpiCard
          label={dateRange === "today" ? "Today Revenue" : `${periodLabel} Revenue`}
          value={money(ownerTotal)}
          sub={`${sessionCount || 0} sessions closed in range`}
          icon="ti-cash"
          trend={normalizeTrend(trends?.today_revenue, trendFromComparison(ownerTotal, yesterdayData.total_revenue ?? yesterdayData.sale, "revenue"))}
        />
        <KpiCard
          label="Live Floor Value"
          value={money(liveTableTotal)}
          sub="Estimated value still running"
          icon="ti-live-view"
          trend={liveTrend}
        />
        <KpiCard
          label="Active Tables"
          value={`${activeCount}/${TOTAL_TABLES}`}
          sub={`${occupancyPercent}% occupancy right now`}
          icon="ti-layout-grid"
          trend={activeTrend}
        />
        <KpiCard
          label="Food Attach"
          value={`${foodAttachment}%`}
          sub={`${money(foodRevenue)} food revenue`}
          icon="ti-tools-kitchen-2"
          trend={normalizeTrend(trends?.food_attach, trendFromComparison(foodAttachment, yesterdayData.food_attach, "food attach"))}
        />
      </div>
    </section>
  );
}

function LiveFloor({ tables, elapsed, onNavigate }) {
  const activeCount = tables.filter((table) => Boolean(table.session)).length;
  const idleCount = Math.max(TOTAL_TABLES - activeCount, 0);
  const pausedCount = tables.filter((table) => table.session?.paused).length;
  const longRunningCount = tables.filter((table) => (elapsed[table.id] ?? table.elapsed_seconds ?? 0) >= 90 * 60).length;
  const floorSignal = pausedCount
      ? `${pausedCount} paused`
      : longRunningCount
        ? `${longRunningCount} long running`
        : activeCount
          ? "Floor active"
          : "Ready";
  return (
    <section className="ops-panel ops-floor-panel">
      <SectionHead
        title={`Live Floor — ${activeCount ? `${activeCount} running / ${idleCount} idle` : `${idleCount} idle`}`}
        action={
          <div className="ops-floor-actions">
            <span className={`ops-floor-health-pill ${pausedCount || longRunningCount ? "warning" : "ok"}`}>
              {floorSignal}
            </span>
            <button type="button" className="ops-link-btn" onClick={() => onNavigate("tables")}>
              Manage tables
            </button>
          </div>
        }
      />
      <div className="ops-floor-grid">
        {tables.map((table) => {
          const session = table.session;
          const elapsedSecs = elapsed[table.id] ?? table.elapsed_seconds ?? 0;
          const active = Boolean(session);
          const busy = elapsedSecs >= 3600;
          const status = getTableStatusByKey(table.status_key);
          const runningTotal = table.running_total || session?.running_total || 0;
          return (
            <button
              type="button"
              key={table.id}
              className={`ops-table-card ${active ? "active" : "idle"} ${busy ? "busy" : ""} ${status.className}`}
              onClick={() => onNavigate("tables")}
            >
              <div className="ops-table-top">
                <strong>T{table.num}</strong>
                <span>{getTableLabel(table)}</span>
              </div>
              <div className="ops-table-status">
                <i className="ti ti-circle-filled" aria-hidden="true" />
                {status.label}
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

function AttentionPanel({ actions, onNavigate }) {
  const uniqueItems = actions.filter((item, index, list) => (
    list.findIndex((candidate) => candidate.title === item.title) === index
  )).slice(0, 6);

  if (!uniqueItems.length || uniqueItems.every((item) => item.tone === "positive")) {
    const readyItem = uniqueItems[0] || {
      title: "Everything's on track",
      detail: "No urgent owner actions right now.",
    };
    return (
      <button type="button" className="ops-attention-inline" onClick={() => onNavigate("closing")}>
        <i className="ti ti-circle-check" aria-hidden="true" />
        <span>
          <b>{readyItem.title}</b>
          {readyItem.detail && <small>{readyItem.detail}</small>}
        </span>
      </button>
    );
  }

  return (
    <section className="ops-panel ops-attention-panel">
      <SectionHead title="Attention" />
      <div className="ops-attention-list">
        {uniqueItems.map((item) => (
          <button
            type="button"
            className={`ops-attention-row ${item.tone || item.type || "info"}`}
            key={item.title}
            onClick={() => onNavigate(item.page || "tables")}
          >
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            <span>
              <b>{item.title}</b>
              {item.detail && <small>{item.detail}</small>}
            </span>
          </button>
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
              <XAxis dataKey="date" tick={{ fontSize: "var(--text-sm)", fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: "var(--text-sm)", fill: "var(--text-secondary)" }}
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
  const [liveData, setLiveData] = useState(null);
  const [elapsed, setElapsed] = useState({});
  const [loadError, setLoadError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(0);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      setSyncing(true);
      try {
        const res = await getDashboardLive(dateRange);
        const payload = res.data || {};
        const nextElapsed = {};
        (payload.tables || []).forEach((table) => {
          const id = tableKey(table.id);
          if (table.session) {
            nextElapsed[id] = Number(table.session.elapsed_seconds || table.elapsed_seconds || 0);
          }
        });
        setLiveData(payload);
        setElapsed(nextElapsed);
        setLastFetchedAt(Date.now());
        setLoadError("");
      } catch (err) {
        console.error(err);
        setLoadError(err.userMessage || "Dashboard data could not load. Retrying...");
      } finally {
        setSyncing(false);
      }
    }

    fetchDashboard();
    const activeInterval = window.setInterval(fetchDashboard, 15000);
    const handleStorageChange = (event) => {
      if (event.key === "hsr:last-data-change") fetchDashboard();
    };
    window.addEventListener("hsr:data-changed", fetchDashboard);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.clearInterval(activeInterval);
      window.removeEventListener("hsr:data-changed", fetchDashboard);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [role, dateRange]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsed((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          const table = liveData?.tables?.find((row) => tableKey(row.id) === id);
          if (!table?.session?.paused) next[id] += 1;
        });
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [liveData]);

  const liveTables = liveData?.tables || TABLES.map((table) => ({
    ...table,
    status_key: "available",
    status_label: "Available",
    status_tone: "idle",
    running_total: 0,
    elapsed_seconds: 0,
  }));

  const runningTables = useMemo(
    () =>
      liveTables
        .filter((table) => table.session)
        .map((table) => ({
          table,
          session: table.session,
          elapsedSecs: elapsed[table.id] || 0,
        })),
    [liveTables, elapsed],
  );

  const canonicalMetrics = liveData?.metrics || metrics;
  const ownerTotal = canonicalMetrics.total_revenue ?? canonicalMetrics.sale ?? 0;
  const liveTableTotal = canonicalMetrics.live_floor_value || 0;
  const foodAttachment = canonicalMetrics.food_attach ?? (ownerTotal > 0 ? Math.round(((canonicalMetrics.food || 0) / ownerTotal) * 100) : 0);
  const occupancyPercent = canonicalMetrics.occupancy ?? pct(runningTables.length, TOTAL_TABLES);

  const actionItems = useMemo(() => {
    const items = (liveData?.attention || []).map((item) => ({
        title: item.title,
        detail: item.detail,
        tone: item.type || item.tone || "info",
        icon:
          item.type === "critical"
            ? "ti-alert-triangle"
            : item.type === "warning"
              ? "ti-alert-circle"
              : "ti-info-circle",
        page: item.page || "tables",
    }));
    const paused = runningTables.filter((row) => row.session.paused);
    const longRunning = runningTables.filter((row) => row.elapsedSecs >= 90 * 60);
    if (!liveData?.attention?.length && paused.length) {
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
    if (runningTables.length) {
      items.push({
        title: `${runningTables.length} table${runningTables.length > 1 ? "s" : ""} still running`,
        detail: "Settle active sessions before daily closing.",
        tone: "info",
        icon: "ti-lock-check",
        page: "closing",
      });
    } else if (!items.length) {
      items.push({
        title: "Shift can be closed",
        detail: "No active table sessions remain. Verify payments in Daily Closing.",
        tone: "positive",
        icon: "ti-lock-check",
        page: "closing",
      });
    }
    return items.slice(0, 5);
  }, [runningTables, foodAttachment, liveData]);

  return (
    <div className="ops-dashboard ops-dashboard-minimal">
      <KeyMetricsSection
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        periodLabel={liveData?.period_label || (dateRange === "week" ? "Last 7 days" : dateRange === "all" ? "All time" : "Today")}
        syncing={syncing}
        lastFetchedAt={lastFetchedAt}
        loadError={loadError}
        ownerTotal={ownerTotal}
        sessionCount={canonicalMetrics.sessions}
        liveTableTotal={liveTableTotal}
        activeCount={runningTables.length}
        occupancyPercent={occupancyPercent}
        foodAttachment={foodAttachment}
        foodRevenue={canonicalMetrics.food}
        yesterday={liveData?.yesterday || metrics.yesterday}
        trends={liveData?.trends || metrics.trends}
      />

      <QuickOperations onNavigate={onNavigate} />

      {loadError && (
        <div className="ops-dashboard-error" role="status">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      <LiveFloor tables={liveTables} elapsed={elapsed} onNavigate={onNavigate} />

      <AttentionPanel
        actions={actionItems}
        onNavigate={onNavigate}
      />
    </div>
  );
}
