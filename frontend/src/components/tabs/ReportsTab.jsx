import { useCallback, useEffect, useState } from "react";
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
import { useToast } from "../toastContext.js";
import RetryNotice from "../RetryNotice.jsx";

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "all", label: "All Time" },
];
const REPORT_TABS = [
  { id: "history", label: "Bills" },
  { id: "tables", label: "Table Performance" },
  { id: "customers", label: "Regular Customers" },
];
const DEFAULT_REPORT_TAB = "history";
const BILL_DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatBillDate(row) {
  const ts = Number(row?.ts);
  if (Number.isFinite(ts) && ts > 0) {
    return BILL_DATE_FORMATTER.format(new Date(ts));
  }
  return row?.date || "-";
}

function billCustomerName(row) {
  return row?.payer_name || row?.nm || row?.customer_name || "Walk-in";
}

function billTotal(row) {
  return Number(row?.tot ?? row?.total ?? 0);
}

function isSuspiciousBill(row) {
  return billTotal(row) <= 0 && Number(row?.dur || 0) > 0;
}

function billDateKey(row) {
  const ts = Number(row?.ts);
  if (Number.isFinite(ts) && ts > 0) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const match = String(row?.date || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-tab-btn ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, color }) {
  const statColor = color === "var(--text-primary)" ? "var(--venue-text, var(--text))" : color;
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
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label={title}>
      <div className="page-skeleton-status">
        <i className="ti ti-loader-2" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-panel" />
    </div>
  );
}

// ── Bills ──
function HistoryView({ history, period, onPeriodChange, selectedDate, onDateChange, onExport, exporting = false }) {
  const [search, setSearch] = useState("");
  const labelBillingMode = (mode) => {
    if (mode === "sharing") return "Sharing";
    if (mode === "lp") return "LP";
    return "Single";
  };

  const filtered = history.filter((r) => {
    const customer = billCustomerName(r).toLowerCase();
    const table = String(r.tbl || r.table_id || "").toLowerCase();
    const matchSearch =
      customer.includes(search.toLowerCase()) ||
      table.includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (period === "date" && selectedDate) {
      return billDateKey(r) === selectedDate;
    }
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
  const suspiciousCount = filtered.filter(isSuspiciousBill).length;

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
        <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--venue-text, var(--text))" }}>
          Bills
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
          <input
            className="reports-date-filter"
            type="date"
            value={selectedDate}
            onChange={(e) => {
              onDateChange(e.target.value);
              onPeriodChange(e.target.value ? "date" : "today");
            }}
          />
          <button
            onClick={onExport}
            disabled={exporting}
            style={{
              fontSize: "var(--text-sm)",
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              cursor: exporting ? "wait" : "pointer",
              background: "var(--success-bg)",
              color: "var(--success)",
              border: "1px solid color-mix(in srgb, var(--success) 28%, var(--border))",
              fontWeight: "var(--weight-medium)",
            }}
          >
            {exporting ? "Exporting..." : "Export CSV"}
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
      {suspiciousCount > 0 && (
        <div className="report-integrity-banner" role="status">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            {suspiciousCount} table bill{suspiciousCount > 1 ? "s" : ""} need review because the amount is ₹0 despite recorded play time.
          </span>
        </div>
      )}
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
                <tr key={i} className={isSuspiciousBill(r) ? "data-row-warning" : ""}>
                  <td style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{formatBillDate(r)}</td>
                  <td>
                    <span
                      style={{
                        background: "var(--surface-muted)",
                        color: "var(--text-primary)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-semibold)",
                      }}
                    >
                      {r.tbl || r.table_id}
                    </span>
                  </td>
                  <td style={{ fontWeight: "var(--weight-medium)" }}>{billCustomerName(r)}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>
                    {labelBillingMode(r.billing_mode)}
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{r.dur}m</td>
                  <td style={{ color: "var(--success)", fontWeight: "var(--weight-medium)" }}>
                    ₹{r.ply}
                  </td>
                  <td style={{ color: "var(--warning)" }}>₹{r.famt || 0}</td>
                  <td style={{ fontWeight: "var(--weight-bold)" }}>₹{billTotal(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Regular Customers ──
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
        <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--venue-text, var(--text))" }}>
          Regular Customers{" "}
          {data && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: "var(--weight-regular)" }}>
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
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-bold)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background:
                          i === 0
                            ? "var(--warning-bg)"
                            : i === 1
                              ? "var(--surface-muted)"
                              : i === 2
                                ? "var(--warning-bg)"
                                : "var(--surface-muted)",
                        color:
                          i === 0
                            ? "var(--warning)"
                            : i === 1
                              ? "var(--text-secondary)"
                              : i === 2
                                ? "var(--warning)"
                                : "var(--text-secondary)",
                      }}
                    >
                      #{i + 1}
                    </span>
                  </td>
                  <td style={{ fontWeight: "var(--weight-medium)" }}>{c.name}</td>
                  <td style={{ color: "var(--accent)", fontWeight: "var(--weight-medium)" }}>
                    {c.visits}
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    ₹{c.play.toLocaleString("en-IN")}
                  </td>
                  <td style={{ color: "var(--warning)" }}>
                    ₹{c.food.toLocaleString("en-IN")}
                  </td>
                  <td style={{ fontWeight: "var(--weight-bold)", color: "var(--success)" }}>
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

// ── Table Performance ──
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
          fontSize: "var(--text-base)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-primary)",
          marginBottom: "16px",
        }}
      >
        Table Performance
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
          color="var(--accent)"
        />
        <StatCard
          label="Total Revenue"
          value={`₹${data.reduce((a, d) => a + d.revenue, 0).toLocaleString("en-IN")}`}
          color="var(--success)"
        />
        <StatCard
          label="Best Table"
          value={data[0]?.table || "—"}
          color="var(--warning)"
        />
        <StatCard
          label="Avg Duration"
          value={`${Math.round(data.reduce((a, d) => a + (d.avg_dur || 0), 0) / Math.max(data.filter((d) => d.sessions > 0).length, 1))}m`}
          color="var(--text-primary)"
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
                <td style={{ fontWeight: "var(--weight-semibold)" }}>{d.table}</td>
                <td>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-semibold)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: d.type === "POOL" ? "var(--success-bg)" : "var(--danger-bg)",
                      color: d.type === "POOL" ? "var(--success)" : "var(--danger)",
                      border: `1px solid ${d.type === "POOL" ? "color-mix(in srgb, var(--success) 28%, var(--border))" : "color-mix(in srgb, var(--danger) 24%, var(--border))"}`,
                    }}
                  >
                    {d.type}
                  </span>
                </td>
                <td style={{ color: "var(--accent)", fontWeight: "var(--weight-medium)" }}>
                  {d.sessions}
                </td>
                <td style={{ color: "var(--text-secondary)" }}>{d.avg_dur}m</td>
                <td style={{ color: "var(--warning)" }}>
                  ₹{d.food_rev.toLocaleString("en-IN")}
                </td>
                <td style={{ fontWeight: "var(--weight-bold)", color: "var(--success)" }}>
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
                        background: "var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round((d.revenue / maxRevenue) * 100)}%`,
                          height: "6px",
                          background: "var(--success)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      />
                    </div>
                    <span
                      style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", width: "36px" }}
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
function ClosingReportView({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getClosingReport()
      .then((r) => {
        setData(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function printReport() {
    window.print();
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
          <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--venue-text, var(--text))" }}>
            Daily Closing Report
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "2px" }}>
            {data.date}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="btn btn-primary-sm" onClick={printReport}>
            Print Report
          </button>
          <button
            className="btn btn-primary-sm"
            onClick={() => onNavigate?.("closing")}
          >
            Open Daily Closing
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
          color="var(--success)"
        />
        <StatCard
          label="Sessions"
          value={data.total_sessions}
          color="var(--accent)"
        />
        <StatCard
          label="Avg Duration"
          value={`${data.avg_duration}m`}
          color="var(--text-primary)"
        />
        <StatCard
          label="Play Revenue"
          value={`₹${data.play_revenue.toLocaleString("en-IN")}`}
          color="var(--text-primary)"
        />
        <StatCard
          label="Food Revenue"
          value={`₹${data.food_revenue.toLocaleString("en-IN")}`}
          color="var(--warning)"
        />
        <StatCard label="Peak Hour" value={data.peak_hour} color="var(--danger)" />
      </div>

      {/* Table breakdown */}
      {Object.keys(data.table_breakdown).length > 0 && (
        <div className="history-section" style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
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
                    <td style={{ fontWeight: "var(--weight-semibold)" }}>{tbl}</td>
                    <td style={{ color: "var(--accent)" }}>{stats.sessions}</td>
                    <td style={{ fontWeight: "var(--weight-semibold)", color: "var(--success)" }}>
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
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
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
                    <td style={{ fontWeight: "var(--weight-medium)" }}>{item}</td>
                    <td style={{ color: "var(--warning)", fontWeight: "var(--weight-semibold)" }}>{qty}</td>
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
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
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
                  <td style={{ fontWeight: "var(--weight-semibold)" }}>{t.tbl}</td>
                  <td style={{ fontWeight: "var(--weight-medium)" }}>{t.nm}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{t.dur}m</td>
                  <td style={{ color: "var(--success)" }}>₹{t.ply}</td>
                  <td style={{ color: "var(--warning)" }}>₹{t.famt}</td>
                  <td style={{ fontWeight: "var(--weight-bold)" }}>₹{t.tot}</td>
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
    positive: ["var(--success-bg)", "var(--success)", "color-mix(in srgb, var(--success) 28%, var(--border))"],
    warning: ["var(--warning-bg)", "var(--warning)", "color-mix(in srgb, var(--warning) 28%, var(--border))"],
    critical: ["var(--danger-bg)", "var(--danger)", "color-mix(in srgb, var(--danger) 24%, var(--border))"],
    info: ["var(--accent-bg)", "var(--accent)", "color-mix(in srgb, var(--accent) 28%, var(--border))"],
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
        <StatCard label="Revenue" value={`₹${data.metrics.revenue.toLocaleString("en-IN")}`} color="var(--success)" />
        <StatCard label="Sessions" value={data.metrics.sessions} color="var(--accent)" />
        <StatCard label="Food" value={`₹${data.metrics.food.toLocaleString("en-IN")}`} color="var(--warning)" />
      </div>

      <div className="history-section">
        <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", marginBottom: "14px" }}>
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
                borderRadius: "var(--radius-sm)",
                padding: "12px 14px",
                marginBottom: "10px",
              }}
            >
              <div style={{ fontWeight: "var(--weight-heavy)", fontSize: "var(--text-sm)", marginBottom: "4px" }}>
                {insight.title}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{insight.detail}</div>
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
      <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", marginBottom: "14px" }}>
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
                <td style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{r.date}</td>
                <td style={{ fontWeight: "var(--weight-bold)", color: r.severity === "critical" ? "var(--danger)" : r.severity === "warning" ? "var(--warning)" : "var(--accent)" }}>
                  {r.severity}
                </td>
                <td style={{ fontWeight: "var(--weight-semibold)" }}>{r.action}</td>
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
        <StatCard label="Retention" value={`${data.retention_rate}%`} color="var(--accent)" />
        <StatCard label="Repeat Customers" value={`${data.repeat_customers}/${data.total_customers}`} color="var(--success)" />
        <StatCard label="Food Attachment" value={`${data.food_attachment_rate}%`} color="var(--warning)" />
        <StatCard label="Avg Spend / Customer" value={`₹${data.avg_spend_per_customer.toLocaleString("en-IN")}`} color="var(--text-primary)" />
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
                    <td style={{ fontWeight: "var(--weight-bold)" }}>{row.table}</td>
                    <td>{row.sessions}</td>
                    <td style={{ color: "var(--success)", fontWeight: "var(--weight-bold)" }}>₹{row.revenue.toLocaleString("en-IN")}</td>
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
export default function ReportsTab({ onNavigate }) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState(
    () => {
      const savedTab = localStorage.getItem("reportsDefaultTab");
      return REPORT_TABS.some((tab) => tab.id === savedTab)
        ? savedTab
        : DEFAULT_REPORT_TAB;
    },
  );
  const [period, setPeriod] = useState("today");
  const [selectedDate, setSelectedDate] = useState("");
  const [summary, setSummary] = useState({
    sale: 0,
    sessions: 0,
    avg_time: 0,
    top_table: "-",
  });
  const [history, setHistory] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const fetchSummary = useCallback(async () => {
    try {
      const res = await getSummary();
      setSummary(res.data);
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Report summary could not load.");
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getHistory();
      setHistory(res.data);
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Bill history could not load.");
    }
  }, []);

  const refreshReports = useCallback(async () => {
    setLoadError("");
    await Promise.all([fetchSummary(), fetchHistory()]);
  }, [fetchHistory, fetchSummary]);

  useEffect(() => {
    refreshReports();
    localStorage.removeItem("reportsDefaultTab");
  }, [refreshReports]);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await exportCSV(period);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${CSV_PREFIX}_${period}_${Date.now()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast("CSV export downloaded", "success");
    } catch {
      showToast("Failed to export CSV", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {loadError && (
        <RetryNotice
          message={loadError}
          detail="Reports may be stale until the latest data loads."
          onRetry={refreshReports}
        />
      )}
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
          color="var(--success)"
        />
        <StatCard
          label="Sessions Today"
          value={summary.sessions}
          color="var(--accent)"
        />
        <StatCard
          label="Avg Duration"
          value={`${summary.avg_time}m`}
          color="var(--text-primary)"
        />
        <StatCard label="Top Table" value={summary.top_table} color="var(--warning)" />
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
	          selectedDate={selectedDate}
	          onDateChange={setSelectedDate}
	          onExport={handleExport}
	          exporting={exporting}
	        />
      )}
      {activeTab === "customers" && <TopCustomersView />}
      {activeTab === "tables" && <UtilizationView />}
      {activeTab === "closing" && <ClosingReportView onNavigate={onNavigate} />}
      {activeTab === "insights" && <ClosingInsightsView />}
      {activeTab === "advanced" && <AdvancedAnalyticsView />}
      {activeTab === "audit" && <AuditLogView />}
    </div>
  );
}
