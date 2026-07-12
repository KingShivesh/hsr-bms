import { useState, useEffect } from "react";
import {
  getSummary,
  getHistory,
  exportCSV,
  getTopCustomers,
  getTableUtilization,
  getClosingReport,
  getClosingInsights,
  getAuditLogs,
  getAdvancedAnalytics,
} from "../../api/index.js";
import { CSV_PREFIX } from "../../config/hsrTables.js";

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "all", label: "All Time" },
];
const REPORT_TABS = [
  { id: "history", label: "Transaction History" },
  { id: "tables", label: "Table Utilization" },
  { id: "customers", label: "Top Customers" },
];
const DEFAULT_REPORT_TAB = "history";

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`ui-tab-btn ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, color }) {
  const statColor = color === "#111" ? "var(--venue-text, var(--text))" : color;
  return (
    <div
      className="report-stat-card"
      style={{ "--stat-color": statColor }}
    >
      <div className="report-stat-label">
        {label}
      </div>
      <div className="report-stat-value">{value}</div>
    </div>
  );
}

function EmptyState({ icon = "ti-chart-bar", title, detail }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <i className={`ti ${icon}`} aria-hidden="true" />
      </div>
      <div className="empty-state-title">{title}</div>
      {detail && <div className="empty-state-detail">{detail}</div>}
    </div>
  );
}

function LoadingState({ title = "Loading report..." }) {
  return (
    <div className="loading-state">
      <div className="loading-state-icon">
        <i className="ti ti-loader-2" aria-hidden="true" />
      </div>
      <div className="loading-state-title">{title}</div>
    </div>
  );
}

// ── Transaction History ──
function HistoryView({ history, period, onPeriodChange, onExport }) {
  const [search, setSearch] = useState("");
  const labelBillingMode = (mode) => {
    if (mode === "sharing") return "Sharing";
    if (mode === "lp") return "LP";
    return "Single";
  };

  const filtered = history.filter((r) => {
    const matchSearch =
      r.nm.toLowerCase().includes(search.toLowerCase()) ||
      r.tbl.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    const now = new Date();
    if (period === "today") {
      const d = now;
      const todayStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      return r.date.startsWith(todayStr);
    }
    if (period === "week") {
      return r.ts >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  return (
    <div className="history-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--venue-text, var(--text))" }}>
          Transaction History
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <TabBtn
              key={p.id}
              active={period === p.id}
              onClick={() => onPeriodChange(p.id)}
            >
              {p.label}
            </TabBtn>
          ))}
          <button
            onClick={onExport}
            style={{
              fontSize: "12px",
              padding: "6px 14px",
              borderRadius: "6px",
              cursor: "pointer",
              background: "#f0fdf4",
              color: "#16a34a",
              border: "1px solid #bbf7d0",
              fontWeight: 500,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>
      <input
        type="text"
        className="input-field"
        placeholder="Search by customer or table..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: "12px" }}
        data-testid="search-transactions"
      />
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Table</th>
              <th>Customer</th>
              <th>Billing</th>
              <th>Duration</th>
              <th>Play</th>
              <th>Food</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan="8"
                  style={{ padding: "18px" }}
                >
                  <EmptyState
                    icon="ti-receipt"
                    title="No transactions found"
                    detail="Try a different period or search term."
                  />
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: "#bbb", fontSize: "12px" }}>{r.date}</td>
                  <td>
                    <span
                      style={{
                        background: "#f5f5f5",
                        color: "#111",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {r.tbl}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{r.nm}</td>
                  <td style={{ color: "#64748b", fontSize: "12px", fontWeight: 700 }}>
                    {labelBillingMode(r.billing_mode)}
                  </td>
                  <td style={{ color: "#888" }}>{r.dur}m</td>
                  <td style={{ color: "#16a34a", fontWeight: 500 }}>
                    ₹{r.ply}
                  </td>
                  <td style={{ color: "#d97706" }}>₹{r.famt || 0}</td>
                  <td style={{ fontWeight: 700 }}>₹{r.tot}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Top Customers ──
function TopCustomersView() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("month");

  useEffect(() => {
    async function fetchTopCustomers() {
      try {
        const res = await getTopCustomers(period);
        setData(res.data);
      } catch (e) {
        console.error(e);
      }
    }
    fetchTopCustomers();
  }, [period]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--venue-text, var(--text))" }}>
          Top Customers{" "}
          {data && (
            <span style={{ fontSize: "12px", color: "#bbb", fontWeight: 400 }}>
              — {data.label}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {[
            ["month", "This Month"],
            ["week", "This Week"],
            ["all", "All Time"],
          ].map(([id, label]) => (
            <TabBtn
              key={id}
              active={period === id}
              onClick={() => setPeriod(id)}
            >
              {label}
            </TabBtn>
          ))}
        </div>
      </div>

      {!data || data.customers.length === 0 ? (
        <EmptyState
          icon="ti-users"
          title="No customer data yet"
          detail="Customer rankings will appear once sessions are completed."
        />
      ) : (
        <div className="history-section">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Customer</th>
                <th>Visits</th>
                <th>Play</th>
                <th>Food</th>
                <th>Total Spent</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background:
                          i === 0
                            ? "#fefce8"
                            : i === 1
                              ? "#f5f5f5"
                              : i === 2
                                ? "#fff7ed"
                                : "#fafafa",
                        color:
                          i === 0
                            ? "#854d0e"
                            : i === 1
                              ? "#555"
                              : i === 2
                                ? "#9a3412"
                                : "#888",
                      }}
                    >
                      #{i + 1}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td style={{ color: "#2563eb", fontWeight: 500 }}>
                    {c.visits}
                  </td>
                  <td style={{ color: "#888" }}>
                    ₹{c.play.toLocaleString("en-IN")}
                  </td>
                  <td style={{ color: "#d97706" }}>
                    ₹{c.food.toLocaleString("en-IN")}
                  </td>
                  <td style={{ fontWeight: 700, color: "#16a34a" }}>
                    ₹{c.spent.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Table Utilization ──
function UtilizationView() {
  const [data, setData] = useState([]);

  useEffect(() => {
    getTableUtilization()
      .then((r) => setData(r.data))
      .catch(console.error);
  }, []);

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "#111",
          marginBottom: "16px",
        }}
      >
        Table Utilization
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <StatCard
          label="Total Sessions"
          value={data.reduce((a, d) => a + d.sessions, 0)}
          color="#2563eb"
        />
        <StatCard
          label="Total Revenue"
          value={`₹${data.reduce((a, d) => a + d.revenue, 0).toLocaleString("en-IN")}`}
          color="#16a34a"
        />
        <StatCard
          label="Best Table"
          value={data[0]?.table || "—"}
          color="#d97706"
        />
        <StatCard
          label="Avg Duration"
          value={`${Math.round(data.reduce((a, d) => a + (d.avg_dur || 0), 0) / Math.max(data.filter((d) => d.sessions > 0).length, 1))}m`}
          color="#111"
        />
      </div>

      <div className="history-section">
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Type</th>
              <th>Sessions</th>
              <th>Avg Duration</th>
              <th>Food Revenue</th>
              <th>Total Revenue</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{d.table}</td>
                <td>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: d.type === "POOL" ? "#f0fdf4" : "#fff1f2",
                      color: d.type === "POOL" ? "#16a34a" : "#e11d48",
                      border: `1px solid ${d.type === "POOL" ? "#bbf7d0" : "#fecdd3"}`,
                    }}
                  >
                    {d.type}
                  </span>
                </td>
                <td style={{ color: "#2563eb", fontWeight: 500 }}>
                  {d.sessions}
                </td>
                <td style={{ color: "#888" }}>{d.avg_dur}m</td>
                <td style={{ color: "#d97706" }}>
                  ₹{d.food_rev.toLocaleString("en-IN")}
                </td>
                <td style={{ fontWeight: 700, color: "#16a34a" }}>
                  ₹{d.revenue.toLocaleString("en-IN")}
                </td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: "6px",
                        background: "#f0f0f0",
                        borderRadius: "3px",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round((d.revenue / maxRevenue) * 100)}%`,
                          height: "6px",
                          background: "#16a34a",
                          borderRadius: "3px",
                        }}
                      />
                    </div>
                    <span
                      style={{ fontSize: "11px", color: "#bbb", width: "36px" }}
                    >
                      {d.utilization_pct}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Daily Closing Report ──
function ClosingReportView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closedDay, setClosedDay] = useState(false);

  useEffect(() => {
    getClosingReport()
      .then((r) => {
        setData(r.data);
        setClosedDay(localStorage.getItem(`dayClosed:${r.data.date}`) === "true");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function printReport() {
    window.print();
  }

  function markDayClosed() {
    if (!confirm("Mark today as closed after reviewing the report summary?")) return;
    localStorage.setItem(`dayClosed:${data.date}`, "true");
    setClosedDay(true);
  }

  if (loading)
    return (
      <LoadingState title="Loading closing report..." />
    );
  if (!data)
    return (
      <EmptyState
        icon="ti-clipboard-text"
        title="No closing report data"
        detail="Run sessions today and the closing report will populate."
      />
    );

  return (
    <div style={{ maxWidth: "720px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--venue-text, var(--text))" }}>
            Daily Closing Report
          </div>
          <div style={{ fontSize: "12px", color: "#bbb", marginTop: "2px" }}>
            {data.date}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="btn btn-primary-sm" onClick={printReport}>
            Print Report
          </button>
          <button
            className={`btn ${closedDay ? "btn-success-sm" : "btn-warning-sm"}`}
            onClick={markDayClosed}
            disabled={closedDay}
          >
            {closedDay ? "Day Closed" : "Close Day"}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <StatCard
          label="Total Revenue"
          value={`₹${data.total_revenue.toLocaleString("en-IN")}`}
          color="#16a34a"
        />
        <StatCard
          label="Sessions"
          value={data.total_sessions}
          color="#2563eb"
        />
        <StatCard
          label="Avg Duration"
          value={`${data.avg_duration}m`}
          color="#111"
        />
        <StatCard
          label="Play Revenue"
          value={`₹${data.play_revenue.toLocaleString("en-IN")}`}
          color="#111"
        />
        <StatCard
          label="Food Revenue"
          value={`₹${data.food_revenue.toLocaleString("en-IN")}`}
          color="#d97706"
        />
        <StatCard label="Peak Hour" value={data.peak_hour} color="#e11d48" />
      </div>

      {/* Table breakdown */}
      {Object.keys(data.table_breakdown).length > 0 && (
        <div className="history-section" style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#111",
              marginBottom: "12px",
            }}
          >
            Table Breakdown
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Sessions</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.table_breakdown)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([tbl, stats], i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{tbl}</td>
                    <td style={{ color: "#2563eb" }}>{stats.sessions}</td>
                    <td style={{ fontWeight: 600, color: "#16a34a" }}>
                      ₹{stats.revenue.toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Food breakdown */}
      {Object.keys(data.food_breakdown).length > 0 && (
        <div className="history-section" style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#111",
              marginBottom: "12px",
            }}
          >
            Food Sold Today
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Units Sold</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.food_breakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([item, qty], i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{item}</td>
                    <td style={{ color: "#d97706", fontWeight: 600 }}>{qty}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All transactions today */}
      {data.transactions.length > 0 && (
        <div className="history-section">
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#111",
              marginBottom: "12px",
            }}
          >
            All Sessions Today
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Customer</th>
                <th>Duration</th>
                <th>Play</th>
                <th>Food</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{t.tbl}</td>
                  <td style={{ fontWeight: 500 }}>{t.nm}</td>
                  <td style={{ color: "#888" }}>{t.dur}m</td>
                  <td style={{ color: "#16a34a" }}>₹{t.ply}</td>
                  <td style={{ color: "#d97706" }}>₹{t.famt}</td>
                  <td style={{ fontWeight: 700 }}>₹{t.tot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total_sessions === 0 && (
        <EmptyState
          icon="ti-clock-hour-4"
          title="No sessions recorded today"
          detail="Today's table sessions will appear in this closing report."
        />
      )}
    </div>
  );
}

function ClosingInsightsView() {
  const [data, setData] = useState(null);

  useEffect(() => {
    getClosingInsights()
      .then((r) => setData(r.data))
      .catch(console.error);
  }, []);

  const colors = {
    positive: ["#f0fdf4", "#16a34a", "#bbf7d0"],
    warning: ["#fffbeb", "#d97706", "#fde68a"],
    critical: ["#fff1f2", "#e11d48", "#fecdd3"],
    info: ["#eff6ff", "#2563eb", "#bfdbfe"],
  };

  if (!data) {
    return (
      <LoadingState title="Loading insights..." />
    );
  }

  return (
    <div style={{ maxWidth: "760px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "12px",
          marginBottom: "18px",
        }}
      >
        <StatCard label="Revenue" value={`₹${data.metrics.revenue.toLocaleString("en-IN")}`} color="#16a34a" />
        <StatCard label="Sessions" value={data.metrics.sessions} color="#2563eb" />
        <StatCard label="Food" value={`₹${data.metrics.food.toLocaleString("en-IN")}`} color="#d97706" />
      </div>

      <div className="history-section">
        <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "14px" }}>
          Smart Closing Insights
        </div>
        {data.insights.map((insight, i) => {
          const [bg, fg, border] = colors[insight.type] || colors.info;
          return (
            <div
              key={i}
              style={{
                background: bg,
                color: fg,
                border: `1px solid ${border}`,
                borderRadius: "8px",
                padding: "12px 14px",
                marginBottom: "10px",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: "13px", marginBottom: "4px" }}>
                {insight.title}
              </div>
              <div style={{ fontSize: "12px", color: "#555" }}>{insight.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuditLogView() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    getAuditLogs(100)
      .then((r) => setRows(r.data))
      .catch(console.error);
  }, []);

  return (
    <div className="history-section">
      <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "14px" }}>
        Anti-Leakage Audit Log
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Severity</th>
            <th>Action</th>
            <th>Detail</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ padding: "18px" }}>
                <EmptyState
                  icon="ti-shield-check"
                  title="No audit events yet"
                  detail="Sensitive actions and anti-leakage events will be tracked here."
                />
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td style={{ color: "#999", fontSize: "12px" }}>{r.date}</td>
                <td style={{ fontWeight: 700, color: r.severity === "critical" ? "#e11d48" : r.severity === "warning" ? "#d97706" : "#2563eb" }}>
                  {r.severity}
                </td>
                <td style={{ fontWeight: 600 }}>{r.action}</td>
                <td>{r.detail}</td>
                <td>{r.amount ? `₹${r.amount.toLocaleString("en-IN")}` : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdvancedAnalyticsView() {
  const [data, setData] = useState(null);

  useEffect(() => {
    getAdvancedAnalytics()
      .then((r) => setData(r.data))
      .catch(console.error);
  }, []);

  if (!data) return <LoadingState title="Loading advanced analytics..." />;

  return (
    <div>
      <div className="advanced-grid">
        <StatCard label="Retention" value={`${data.retention_rate}%`} color="#2563eb" />
        <StatCard label="Repeat Customers" value={`${data.repeat_customers}/${data.total_customers}`} color="#16a34a" />
        <StatCard label="Food Attachment" value={`${data.food_attachment_rate}%`} color="#d97706" />
        <StatCard label="Avg Spend / Customer" value={`₹${data.avg_spend_per_customer.toLocaleString("en-IN")}`} color="#111" />
      </div>

      <div className="analytics-panels">
        <div className="history-section">
          <div className="section-heading">Table profitability</div>
          {data.table_profitability.length === 0 ? (
            <EmptyState title="No table profitability yet" detail="Completed sessions will populate this table." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Sessions</th>
                  <th>Revenue</th>
                  <th>Avg Duration</th>
                  <th>Revenue / Session</th>
                </tr>
              </thead>
              <tbody>
                {data.table_profitability.map((row) => (
                  <tr key={row.table}>
                    <td style={{ fontWeight: 700 }}>{row.table}</td>
                    <td>{row.sessions}</td>
                    <td style={{ color: "#16a34a", fontWeight: 700 }}>₹{row.revenue.toLocaleString("en-IN")}</td>
                    <td>{row.avg_duration}m</td>
                    <td>₹{row.revenue_per_session.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="history-section">
          <div className="section-heading">Quiet hours</div>
          {data.quiet_hours.map((row) => (
            <div key={row.hour} className="risk-row">
              <span>{row.hour}:00 - {row.hour + 1}:00</span>
              <strong>{row.sessions} sessions</strong>
            </div>
          ))}
          <div className="empty-state-detail" style={{ marginTop: "10px" }}>
            These are lower-traffic slots based on recent checkout history.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Reports Tab ──
export default function ReportsTab() {
  const [activeTab, setActiveTab] = useState(
    () => {
      const savedTab = localStorage.getItem("reportsDefaultTab");
      return REPORT_TABS.some((tab) => tab.id === savedTab)
        ? savedTab
        : DEFAULT_REPORT_TAB;
    },
  );
  const [period, setPeriod] = useState("today");
  const [summary, setSummary] = useState({
    sale: 0,
    sessions: 0,
    avg_time: 0,
    top_table: "-",
  });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetchSummary();
    fetchHistory();
    localStorage.removeItem("reportsDefaultTab");
  }, []);

  async function fetchSummary() {
    try {
      const res = await getSummary();
      setSummary(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchHistory() {
    try {
      const res = await getHistory();
      setHistory(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleExport() {
    try {
      const res = await exportCSV(period);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${CSV_PREFIX}_${period}_${Date.now()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export CSV");
    }
  }

  return (
    <div>
      {/* Summary cards — always visible */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <StatCard
          label="Today's Revenue"
          value={`₹${summary.sale.toLocaleString("en-IN")}`}
          color="#16a34a"
        />
        <StatCard
          label="Sessions Today"
          value={summary.sessions}
          color="#2563eb"
        />
        <StatCard
          label="Avg Duration"
          value={`${summary.avg_time}m`}
          color="#111"
        />
        <StatCard label="Top Table" value={summary.top_table} color="#d97706" />
      </div>

      {/* Sub-tab navigation */}
      <div className="segmented-control page-tabs">
        {REPORT_TABS.map((t) => (
          <TabBtn
            key={t.id}
            active={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </TabBtn>
        ))}
      </div>

      {activeTab === "history" && (
        <HistoryView
          history={history}
          period={period}
          onPeriodChange={setPeriod}
          onExport={handleExport}
        />
      )}
      {activeTab === "customers" && <TopCustomersView />}
      {activeTab === "tables" && <UtilizationView />}
      {activeTab === "closing" && <ClosingReportView />}
      {activeTab === "insights" && <ClosingInsightsView />}
      {activeTab === "advanced" && <AdvancedAnalyticsView />}
      {activeTab === "audit" && <AuditLogView />}
    </div>
  );
}
