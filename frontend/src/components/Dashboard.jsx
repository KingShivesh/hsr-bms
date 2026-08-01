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
  getClosingInsights,
  getClosingReport,
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

    fetchActive();
    const deferredLoad = window.setTimeout(() => {
      fetchDigest();
      fetchAnalytics();
    }, 200);
    const activeInterval = window.setInterval(fetchActive, 20000);
    return () => {
      window.clearTimeout(deferredLoad);
      window.clearInterval(activeInterval);
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
  const avgTableMinutes = runningTables.length
    ? Math.round(runningTables.reduce((sum, row) => sum + row.elapsedSecs / 60, 0) / runningTables.length)
    : 0;

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
          sub={`${Math.max(TOTAL_TABLES - runningTables.length, 0)} tables idle now`}
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

      <Charts analytics={analytics} pieData={pieData} />
    </div>
  );
}
