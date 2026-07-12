import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  getActive,
  getAnalytics,
  getClosingReport,
  getClosingInsights,
} from "../api/index.js";
import { HSR_TABLES, TOTAL_TABLES, getTableLabel } from "../config/hsrTables.js";

const TABLES = HSR_TABLES;

const PIE_COLORS = ["#16a34a", "#e11d48", "#d97706"];

function fmt(secs) {
  if (!secs || secs <= 0) return "--:--";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: "12px",
        color: "#999",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        fontWeight: 500,
        marginBottom: "14px",
      }}
    >
      {children}
    </div>
  );
}

function TableOccupancyPanel({ sessions, elapsed, onNavigate }) {
  const activeCount = TABLES.filter((t) => sessions[t.id]).length;
  const busyCount = TABLES.filter((t) => (elapsed[t.id] || 0) > 3600).length;
  const idleCount = Math.max(TABLES.length - activeCount, 0);

  return (
    <div className="panel dashboard-occupancy-panel">
      <div className="dashboard-panel-head">
        <div>
          <SectionTitle>Table occupancy</SectionTitle>
          <div className="dashboard-panel-sub">
            {activeCount} active · {idleCount} idle · {busyCount} over 1 hr
          </div>
        </div>
        <button
          className="dashboard-panel-action"
          type="button"
          onClick={() => onNavigate("tables")}
        >
          <i className="ti ti-layout-grid" aria-hidden="true" />
          Floor
        </button>
      </div>
      <div className="hm-legend">
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#16a34a" }} />
          Active
        </div>
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#e11d48" }} />
          Busy (&gt;1hr)
        </div>
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#e5e7eb" }} />
          Idle
        </div>
      </div>
      <div className="heatmap dashboard-occupancy-grid">
        {TABLES.map((t) => {
          const sess = sessions[t.id];
          const secs = elapsed[t.id] || 0;
          const state = !sess ? "idle" : secs > 3600 ? "busy" : "active";
          return (
            <div
              key={t.id}
              className={`hm-cell ${state}`}
              onClick={() => onNavigate("tables")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onNavigate("tables");
              }}
            >
              <div className="hm-num">T{t.num}</div>
              <div className="hm-type">{getTableLabel(t)}</div>
              {sess ? (
                <>
                  <div className="hm-player">
                    {sess.customer_name.split(" ")[0]}
                  </div>
                  <div className="hm-timer">{fmt(secs)}</div>
                </>
              ) : (
                <div className="hm-timer">--:--</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunningTablesBar({ sessions, elapsed, onNavigate }) {
  const running = TABLES
    .filter((table) => sessions[table.id])
    .map((table) => ({
      table,
      session: sessions[table.id],
      elapsed: elapsed[table.id] || 0,
    }));

  return (
    <button className="running-strip" type="button" onClick={() => onNavigate("tables")}>
      <div className="running-strip-head">
        <span>{running.length} running</span>
        <strong>{running.length ? "Open floor" : "All tables idle"}</strong>
      </div>
      <div className="running-strip-list">
        {running.length === 0 ? (
          <span className="running-chip idle">No active sessions</span>
        ) : (
          running.map(({ table, session, elapsed: secs }) => (
            <span className="running-chip" key={table.id}>
              T{table.num} <strong>{fmt(secs)}</strong>
              <em>{session.customer_name?.split(" ")[0] || "Player"}</em>
            </span>
          ))
        )}
      </div>
      <i className="ti ti-chevron-right" aria-hidden="true" />
    </button>
  );
}

export default function Dashboard({ metrics, onNavigate }) {
  const [sessions, setSessions] = useState({});
  const [elapsed, setElapsed] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [digest, setDigest] = useState(null);
  const [, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await getActive();
        const s = {},
          e = {};
        res.data.forEach((x) => {
          s[x.table_id] = x;
          e[x.table_id] = Math.floor(
            (x.paused ? x.elapsed_ms : Date.now() - x.start_time) / 1000,
          );
        });
        setSessions(s);
        setElapsed(e);
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
        setDigest({
          report: reportRes.data,
          insights: insightRes.data,
        });
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchAll() {
      await Promise.all([
        fetchActive(),
        fetchAnalytics(),
        fetchDigest(),
      ]);
      setLoading(false);
    }

    fetchAll();
    const iv = setInterval(fetchActive, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          if (!sessions[id]?.paused) next[id] = next[id] + 1;
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [sessions]);

  // Pie chart data
  const pieData = analytics
    ? [
        { name: "Pool", value: analytics.breakdown.pool },
        { name: "Snooker", value: analytics.breakdown.snooker },
        { name: "Food", value: analytics.breakdown.food },
      ].filter((d) => d.value > 0)
    : [];

  function openClosingReport() {
    onNavigate("closing");
  }

  const ownerReport = digest?.report;
  const cashTotal = ownerReport?.cash_total || 0;
  const upiTotal = ownerReport?.upi_total || 0;
  const ownerTotal = ownerReport
    ? (ownerReport.total_revenue || 0) + (ownerReport.food_only_revenue || 0)
    : metrics.sale;

  return (
    <div className="dashboard-home">
      <RunningTablesBar sessions={sessions} elapsed={elapsed} onNavigate={onNavigate} />

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card green">
          <div className="metric-label">Today Sales</div>
          <div className="metric-value">
            ₹{ownerTotal.toLocaleString("en-IN")}
          </div>
          <div className="metric-sub">{metrics.sessions} sessions today</div>
        </div>
        <div className="metric-card blue">
          <div className="metric-label">Active Tables</div>
          <div className="metric-value">
            {metrics.active_tables} / {TOTAL_TABLES}
          </div>
          <div className="metric-sub">
            {Math.max(TOTAL_TABLES - metrics.active_tables, 0)} idle right now
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cash</div>
          <div className="metric-value">₹{cashTotal.toLocaleString("en-IN")}</div>
          <div className="metric-sub">From closed tables</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">UPI</div>
          <div className="metric-value">₹{upiTotal.toLocaleString("en-IN")}</div>
          <div className="metric-sub">From closed tables</div>
        </div>
        <div className="metric-card amber">
          <div className="metric-label">Food Sales</div>
          <div className="metric-value">
            ₹{metrics.food.toLocaleString("en-IN")}
          </div>
          <div className="metric-sub">
            {metrics.sale > 0
              ? Math.round((metrics.food / metrics.sale) * 100)
              : 0}
            % of revenue
          </div>
        </div>
      </div>

      <div className="dashboard-at-glance">
        <TableOccupancyPanel
          sessions={sessions}
          elapsed={elapsed}
          onNavigate={onNavigate}
        />

        {digest && (
          <div className="owner-digest">
            <div className="owner-digest-head">
              <div>
                <div className="owner-digest-kicker">Daily owner digest</div>
                <div className="owner-digest-title">{digest.report.date}</div>
              </div>
              <button type="button" className="owner-close-day-btn" onClick={openClosingReport}>
                Close day
                <i className="ti ti-clipboard-check" aria-hidden="true" />
              </button>
            </div>
            <div className="owner-digest-grid">
              <div>
                <span>Revenue</span>
                <strong>₹{digest.report.total_revenue.toLocaleString("en-IN")}</strong>
              </div>
              <div>
                <span>Sessions</span>
                <strong>{digest.report.total_sessions}</strong>
              </div>
              <div>
                <span>Food</span>
                <strong>₹{digest.report.food_revenue.toLocaleString("en-IN")}</strong>
              </div>
              <div>
                <span>Peak hour</span>
                <strong>{digest.report.peak_hour}</strong>
              </div>
            </div>
            <div className="owner-digest-insight">
              <i className="ti ti-bulb" aria-hidden="true" />
              <div>
                <strong>{digest.insights.insights[0]?.title || "Clean close outlook"}</strong>
                <span>{digest.insights.insights[0]?.detail || "No unusual activity detected so far."}</span>
              </div>
            </div>
          </div>
        )}
        {!digest && (
          <div className="owner-digest owner-digest-loading">
            <div className="owner-digest-kicker">Daily owner digest</div>
            <div className="owner-digest-title">Loading...</div>
          </div>
        )}
      </div>

      <div className="dashboard-sales-grid">
        <div className="panel">
          <SectionTitle>Revenue — last 7 days</SectionTitle>
          {analytics ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={analytics.weekly} barSize={28}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#bbb" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#bbb" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                  }
                />
                <Tooltip
                  formatter={(v) => [
                    `₹${v.toLocaleString("en-IN")}`,
                    "Revenue",
                  ]}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #f0f0f0",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  cursor={{ fill: "#f5f5f5" }}
                />
                <Bar dataKey="revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              style={{
                height: 180,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#bbb",
                fontSize: "13px",
              }}
            >
              Loading chart...
            </div>
          )}
        </div>

        <div className="panel">
          <SectionTitle>Revenue breakdown</SectionTitle>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, ""]}
                    contentStyle={{
                      background: "#fff",
                      border: "1px solid #f0f0f0",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {pieData.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: PIE_COLORS[i],
                        }}
                      />
                      <span style={{ color: "#555" }}>{d.name}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: "#111" }}>
                      ₹{d.value.toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              style={{
                color: "#bbb",
                fontSize: "13px",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              No data yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
