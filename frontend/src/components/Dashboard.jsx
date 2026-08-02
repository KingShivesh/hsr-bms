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
const PIE_COLORS = ["#1f7a4f", "#2563eb", "#d97706"];

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

function HeroCommand({ metrics, ownerTotal, activeCount, onNavigate }) {
  const idleCount = Math.max(TOTAL_TABLES - activeCount, 0);
  return (
    <section className="ops-hero">
      <div className="ops-hero-copy">
        <span className="ops-eyebrow">Live command center</span>
        <h2>Today is at {money(ownerTotal)}</h2>
        <p>
          {activeCount} tables running, {idleCount} idle, {metrics.sessions || 0} closed sessions.
          Use this screen to spot stuck tables, food misses and closing risk.
        </p>
      </div>
      <div className="ops-hero-actions">
        <button type="button" className="ops-action primary" onClick={() => onNavigate("tables")}>
          <i className="ti ti-player-play" aria-hidden="true" />
          Open Floor
        </button>
        <button type="button" className="ops-action" onClick={() => onNavigate("food")}>
          <i className="ti ti-tools-kitchen-2" aria-hidden="true" />
          Food POS
        </button>
        <button type="button" className="ops-action warning" onClick={() => onNavigate("closing")}>
          <i className="ti ti-lock-check" aria-hidden="true" />
          Closing
        </button>
      </div>
    </section>
  );
}

function KpiCard({ label, value, sub, tone = "neutral", icon }) {
  return (
    <article className={`ops-kpi ${tone}`}>
      <div className="ops-kpi-top">
        <span>{label}</span>
        <i className={`ti ${icon}`} aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <p>{sub}</p>
    </article>
  );
}

function QuickOperations({ onNavigate, activeCount, waitingCount, bookingCount }) {
  const actions = [
    {
      label: "Start Table",
      sub: `${Math.max(TOTAL_TABLES - activeCount, 0)} idle`,
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
      page: "tables",
      tone: "booking",
    },
    {
      label: "Queue",
      sub: `${waitingCount} waiting`,
      icon: "ti-clock",
      page: "tables",
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
    <section className="ops-quickbar" aria-label="Quick operations">
      <div>
        <span className="ops-eyebrow">Quick operations</span>
        <strong>Front desk actions</strong>
      </div>
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
              <small>{action.sub}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RunningStrip({ runningTables, onNavigate }) {
  return (
    <button className="ops-running-strip" type="button" onClick={() => onNavigate("tables")}>
      <div>
        <span>{runningTables.length} running now</span>
        <strong>{runningTables.length ? "Monitor active tables" : "All tables idle"}</strong>
      </div>
      <div className="ops-running-chips">
        {runningTables.length === 0 ? (
          <em>No active sessions</em>
        ) : (
          runningTables.map(({ table, session, elapsedSecs }) => (
            <span key={table.id}>
              T{table.num}
              <b>{fmtTime(elapsedSecs)}</b>
              <small>{money(estimateTableCharge(session, elapsedSecs) + (session.food_total || 0))}</small>
            </span>
          ))
        )}
      </div>
      <i className="ti ti-chevron-right" aria-hidden="true" />
    </button>
  );
}

function LiveFloor({ sessions, elapsed, onNavigate }) {
  return (
    <section className="ops-panel ops-floor-panel">
      <SectionHead
        eyebrow="Floor control"
        title="Live Table Floor"
        action={
          <button type="button" className="ops-link-btn" onClick={() => onNavigate("tables")}>
            Manage tables
          </button>
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
  return (
    <section className="ops-panel">
      <SectionHead eyebrow="Needs attention" title="Action Queue" />
      <div className="ops-action-list">
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
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
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
              <Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#dashRevenue)" strokeWidth={3} />
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

export default function Dashboard({ metrics, onNavigate }) {
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
      fetchDigest();
      fetchAnalytics();
      fetchOperations();
    }, 200);
    const activeInterval = window.setInterval(fetchActive, 20000);
    const operationsInterval = window.setInterval(fetchOperations, 45000);
    return () => {
      window.clearTimeout(deferredLoad);
      window.clearInterval(activeInterval);
      window.clearInterval(operationsInterval);
    };
  }, []);

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
  const avgTableMinutes = runningTables.length
    ? Math.round(runningTables.reduce((sum, row) => sum + row.elapsedSecs / 60, 0) / runningTables.length)
    : 0;
  const upcomingBookings = bookings.filter((booking) => booking.status === "booked");

  const actionItems = useMemo(() => {
    const items = [];
    const paused = runningTables.filter((row) => row.session.paused);
    const longRunning = runningTables.filter((row) => row.elapsedSecs >= 90 * 60);
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

  const pieData = analytics
    ? [
        { name: "Snooker", value: analytics.breakdown.snooker },
        { name: "Pool", value: analytics.breakdown.pool },
        { name: "Food", value: analytics.breakdown.food },
      ].filter((row) => row.value > 0)
    : [];

  return (
    <div className="ops-dashboard">
      <HeroCommand
        metrics={metrics}
        ownerTotal={ownerTotal}
        activeCount={runningTables.length}
        onNavigate={onNavigate}
      />

      <QuickOperations
        onNavigate={onNavigate}
        activeCount={runningTables.length}
        waitingCount={waitlist.length}
        bookingCount={upcomingBookings.length}
      />

      <RunningStrip runningTables={runningTables} onNavigate={onNavigate} />

      <div className="ops-kpi-grid">
        <KpiCard
          label="Today Revenue"
          value={money(ownerTotal)}
          sub={`${metrics.sessions || 0} sessions closed today`}
          tone="green"
          icon="ti-cash"
        />
        <KpiCard
          label="Live Floor Value"
          value={money(liveTableTotal)}
          sub="Estimated value still running"
          tone="blue"
          icon="ti-live-view"
        />
        <KpiCard
          label="Active Tables"
          value={`${runningTables.length}/${TOTAL_TABLES}`}
          sub={`${occupancyPercent}% occupancy right now`}
          tone="amber"
          icon="ti-layout-grid"
        />
        <KpiCard
          label="Avg Live Time"
          value={`${avgTableMinutes}m`}
          sub="Average active session age"
          icon="ti-clock"
        />
        <KpiCard
          label="Food Revenue"
          value={money(metrics.food)}
          sub={`${foodAttachment}% of today's revenue`}
          tone="blue"
          icon="ti-tools-kitchen-2"
        />
        <KpiCard
          label="Queue / Booking"
          value={`${waitlist.length}/${upcomingBookings.length}`}
          sub={`${waitlist.length} waiting, ${upcomingBookings.length} upcoming`}
          tone={waitlist.length ? "amber" : "neutral"}
          icon="ti-calendar-clock"
        />
      </div>

      <div className="ops-main-grid">
        <LiveFloor sessions={sessions} elapsed={elapsed} onNavigate={onNavigate} />
        <div className="ops-side-stack">
          <ActionQueue actions={actionItems} />
          <CloseReadiness digest={digest} activeCount={runningTables.length} onNavigate={onNavigate} />
        </div>
      </div>

      <div className="ops-lower-grid">
        <PaymentMix cashTotal={cashTotal} upiTotal={upiTotal} cardTotal={cardTotal} />
        <Insights digest={digest} />
      </div>

      <div className="ops-clubflow-grid">
        <QueueBookings waitlist={waitlist} bookings={bookings} onNavigate={onNavigate} />
        <PopularFood foodStats={foodStats} foodOrders={foodOrders} onNavigate={onNavigate} />
        <RecentActivity auditLogs={auditLogs} runningTables={runningTables} foodOrders={foodOrders} />
      </div>

      <Charts analytics={analytics} pieData={pieData} />
    </div>
  );
}
