import { formatCurrency as polishCurrency, formatDateTime } from "../../utils/format.js";
import { Button as HsrButton, Icon as HsrIcon, Input as HsrInput, Table as HsrTable } from "../ui/index.js";
import { useCallback, useEffect, useState } from "react";
import DataFreshness from "../../product/DataFreshness.jsx";
import { hasCachedState, useCachedState } from "../../hooks/useCachedState.js";
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
import { MetricCard, EmptyState } from "../ui/index.js";
import { useToast } from "../toastContext.js";
import RetryNotice from "../RetryNotice.jsx";
import Pagination from "../ui/Pagination.jsx";
import SessionEditsReport from "../../features/sessions/SessionEditsReport.jsx";

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "all", label: "All Time" },
];
const REPORT_TABS = [
  { id: "history", label: "Bills" },
  { id: "tables", label: "Table Performance" },
  { id: "customers", label: "Regular Customers" },
  { id: "advanced", label: "Analytics" },
  { id: "session-edits", label: "Session Edits" },
];
const DEFAULT_REPORT_TAB = "history";
const HISTORY_PAGE_SIZE = 25;
const DATE_PICKER_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatBillDate(row) {
  const ts = Number(row?.ts);
  if (Number.isFinite(ts) && ts > 0) {
    return formatDateTime(ts, { includeYear: true });
  }
  return row?.date || "-";
}

function billCustomerName(row) {
  return row?.payer_name || row?.nm || row?.customer_name || "Guest";
}

function billTotal(row) {
  return Number(row?.tot ?? row?.total ?? 0);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

function formatDatePickerLabel(value) {
  if (!value) return "Pick date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Pick date";
  return DATE_PICKER_FORMATTER.format(date);
}

function TabBtn({ active, onClick, children }) {
  return (
    <HsrButton native
      type="button"
      onClick={onClick}
      className={`ui-tab-btn ${active ? "active" : ""}`}
    >
      {children}
    </HsrButton>
  );
}

function StatCard({ label, value, color, context, empty = false }) {
  const statColor = color === "var(--text-primary)" ? "var(--border-strong)" : color;
  return (
    <MetricCard
      label={label}
      value={value}
      context={context}
      className={`report-metric-card ${empty ? "is-empty" : ""}`}
      style={{ "--metric-accent": statColor }}
    />
  );
}

function LoadingState({ title = "Loading report..." }) {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label={title}>
      <div className="page-skeleton-status">
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
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, period, selectedDate]);
  const labelBillingMode = (mode) => {
    if (mode === "sharing") return "Sharing";
    if (mode === "lp") return "LP";
    return "Single";
  };

  const filtered = (Array.isArray(history) ? history : []).filter((r) => {
    if (!r) return false;
    const customer = String(billCustomerName(r)).toLowerCase();
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
      return r.date?.startsWith(todayStr) || false;
    }
    if (period === "week") {
      return r.ts >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    return true;
  });
  const suspiciousCount = filtered.filter(isSuspiciousBill).length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(page, pageCount));
  const pageRows = filtered.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);
  useEffect(() => setPage(value => Math.max(1, Math.min(value, pageCount))), [pageCount]);

  return (
    <div className="history-section">
      <div
        className="polish-display-flex polish-justify-content-space-between polish-align-items-center polish-margin-bottom-12px polish-flex-wrap-wrap polish-gap-8px"
      >
        <div className="type-sm polish-font-weight-weight-semibold polish-color-var---venue-text-text" >
          Bills
        </div>
        <div className="polish-display-flex polish-gap-4px polish-flex-wrap-wrap" >
          {PERIODS.map((p) => (
            <TabBtn
              key={p.id}
              active={period === p.id}
              onClick={() => onPeriodChange(p.id)}
            >
              {p.label}
            </TabBtn>
          ))}
          <label className={`reports-date-picker ${selectedDate ? "has-value" : ""}`}>
            <HsrIcon className="ti ti-calendar" aria-hidden="true" />
            <span>{formatDatePickerLabel(selectedDate)}</span>
            <HsrInput
              className="reports-date-filter"
              type="date"
              value={selectedDate}
              aria-label="Choose report date"
              onChange={(e) => {
                onDateChange(e.target.value);
                onPeriodChange(e.target.value ? "date" : "today");
              }}
            />
          </label>
          <HsrButton native className="type-sm polish-padding-4px-12px polish-border-radius-radius-sm polish-background-success-bg polish-color-success-foreground polish-border-1px-solid-color-mix-in-srgb-success-28-border polish-font-weight-weight-medium"
            onClick={onExport}
            disabled={exporting}
            style={{ cursor: exporting ? "wait" : "pointer" }}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </HsrButton>
        </div>
      </div>
      <HsrInput
        type="text"
        className="input-field polish-margin-bottom-12px"
        placeholder="Search by customer or table..."
        aria-label="Search bills by customer or table"
        value={search}
        onChange={(e) => setSearch(e.target.value)}

        data-testid="search-transactions"
      />
      {suspiciousCount > 0 && (
        <div className="report-integrity-banner" role="status">
          <HsrIcon className="ti ti-alert-triangle" aria-hidden="true" />
          <span>
            {suspiciousCount} table bill{suspiciousCount > 1 ? "s" : ""} need review because the amount is ₹0 despite recorded play time.
          </span>
        </div>
      )}
      <div className="polish-overflow-x-auto" >
        <HsrTable className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Table</th>
              <th>Customer</th>
              <th>Billing</th>
              <th>Duration</th>
              <th data-type="number">Play</th>
              <th data-type="number">Food</th>
              <th data-type="number">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan="8"
                  className="polish-padding-16px"
                >
                  <EmptyState
                    icon="ti-receipt"
                    title="No transactions found"
                    description="Try a different period or search term."
                    action={(search || period !== "all") && <HsrButton variant="secondary" icon="ti-filter-off" onClick={() => { setSearch(""); onDateChange(""); onPeriodChange("all"); }}>Clear filters</HsrButton>}
                  />
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => (
                <tr key={r.id ?? i} data-receipt-id={r.id} className={isSuspiciousBill(r) ? "data-row-warning" : ""}>
                  <td className="type-sm polish-color-text-muted" >{formatBillDate(r)}</td>
                  <td>
                    <span className="type-sm polish-background-surface-muted polish-color-text-primary polish-padding-0px-8px polish-border-radius-radius-sm polish-font-weight-weight-semibold"

                    >
                      {r.tbl || r.table_id}
                    </span>
                  </td>
                  <td className="polish-font-weight-weight-medium" >{billCustomerName(r)}</td>
                  <td className="type-sm polish-color-text-secondary polish-font-weight-weight-bold" >
                    {labelBillingMode(r.billing_mode)}
                  </td>
                  <td className="polish-color-text-secondary" >{numberOrZero(r.dur)}m</td>
                  <td data-type="number" className="polish-color-success polish-font-weight-weight-medium" >
                    {polishCurrency(r.ply)}
                  </td>
                  <td data-type="number" className="polish-color-warning" >{polishCurrency(r.famt)}</td>
                  <td data-type="number" className="polish-font-weight-weight-bold" >{polishCurrency(billTotal(r))}</td>
                </tr>
              ))
            )}
          </tbody>
        </HsrTable>
      </div>
      <Pagination total={filtered.length} page={currentPage} pageSize={HISTORY_PAGE_SIZE} onPageChange={setPage} label="Bills" />
    </div>
  );
}

// ── Regular Customers ──
function TopCustomersView() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function fetchTopCustomers() {
      try {
        const res = await getTopCustomers(period);
        if (active) setData(res.data);
      } catch (e) {
        if (active) setError(e.userMessage || "Regular customers could not load.");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchTopCustomers();
    return () => { active = false; };
  }, [period, retry]);

  const customers = Array.isArray(data?.customers) ? data.customers.filter(Boolean) : [];

  return (
    <div className="reports-page-shell">
      <div
        className="polish-display-flex polish-justify-content-space-between polish-align-items-center polish-margin-bottom-16px"
      >
        <div className="type-base polish-font-weight-weight-semibold polish-color-var---venue-text-text" >
          Regular Customers{" "}
          {!loading && !error && data && (
            <span className="type-sm polish-color-text-muted polish-font-weight-weight-regular" >
              — {data.label}
            </span>
          )}
        </div>
        <div className="polish-display-flex polish-gap-4px" >
          {[
            ["month", "This Month"],
            ["week", "This Week"],
            ["all", "All Time"],
          ].map(([id, label]) => (
            <TabBtn
              key={id}
              active={period === id}
              onClick={() => { if (period !== id) { setLoading(true); setPeriod(id); } }}
            >
              {label}
            </TabBtn>
          ))}
        </div>
      </div>

      {loading ? <LoadingState title="Loading regular customers..." /> : error ? (
        <RetryNotice message={error} onRetry={() => setRetry(value => value + 1)} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon="ti-users"
          title="No customer data yet"
          description="Customer rankings will appear once sessions are completed."
          action={<HsrButton variant="secondary" icon="ti-refresh" onClick={() => setRetry(value => value + 1)}>Refresh</HsrButton>}
        />
      ) : (
        <div className="history-section">
          <HsrTable className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Customer</th>
                <th data-type="number">Visits</th>
                <th data-type="number">Play</th>
                <th data-type="number">Food</th>
                <th>Total Spent</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span className="type-sm polish-font-weight-weight-bold polish-padding-0px-8px polish-border-radius-radius-sm"
                      style={{ background: i === 0 ? "var(--warning-bg)" : i === 1 ? "var(--surface-muted)" : i === 2 ? "var(--warning-bg)" : "var(--surface-muted)", color: i === 0 ? "var(--warning)" : i === 1 ? "var(--text-secondary)" : i === 2 ? "var(--warning)" : "var(--text-secondary)" }}
                    >
                      #{i + 1}
                    </span>
                  </td>
                  <td className="polish-font-weight-weight-medium" >{c.name}</td>
                  <td className="polish-color-accent polish-font-weight-weight-medium" >
                    {numberOrZero(c.visits)}
                  </td>
                  <td data-type="number" className="polish-color-text-secondary" >
                    {polishCurrency(c.play)}
                  </td>
                  <td data-type="number" className="polish-color-warning" >
                    {polishCurrency(c.food)}
                  </td>
                  <td data-type="number" className="polish-font-weight-weight-bold polish-color-success" >
                    {polishCurrency(c.spent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </HsrTable>
        </div>
      )}
    </div>
  );
}

// ── Table Performance ──
function UtilizationView() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getTableUtilization()
      .then((r) => { if (active) setData(Array.isArray(r.data) ? r.data.filter(Boolean) : []); })
      .catch(e => { if (active) setError(e.userMessage || "Table performance could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  if (loading) return <LoadingState title="Loading table performance..." />;
  if (error) return <RetryNotice message={error} onRetry={() => setRetry(value => value + 1)} />;
  if (data.length === 0) return <EmptyState title="No table performance data" description="No table sessions are available in this report." action={<HsrButton variant="secondary" icon="ti-refresh" onClick={() => setRetry(value => value + 1)}>Refresh</HsrButton>} />;

  const maxRevenue = Math.max(...data.map((d) => numberOrZero(d.revenue)), 1);

  return (
    <div>
      <div className="type-base polish-font-weight-weight-semibold polish-color-text-primary polish-margin-bottom-16px"

      >
        Table Performance
      </div>

      {/* Summary cards */}
      <div
        className="polish-display-grid polish-grid-template-columns-repeat-4-1fr polish-gap-12px polish-margin-bottom-20px"
      >
        <StatCard
          label="Total Sessions"
          value={data.reduce((a, d) => a + numberOrZero(d.sessions), 0)}
          color="var(--accent)"
        />
        <StatCard
          label="Total Revenue"
          value={polishCurrency(data.reduce((a, d) => a + numberOrZero(d.revenue), 0))}
          color="var(--success)"
        />
        <StatCard
          label="Best Table"
          value={data[0]?.table || "—"}
          color="var(--warning)"
        />
        <StatCard
          label="Avg Duration"
          value={`${Math.round(data.reduce((a, d) => a + numberOrZero(d.avg_dur), 0) / Math.max(data.filter((d) => d.sessions > 0).length, 1))}m`}
          color="var(--text-primary)"
        />
      </div>

      <div className="history-section">
        <HsrTable className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Type</th>
              <th data-type="number">Sessions</th>
              <th>Avg Duration</th>
              <th>Food Revenue</th>
              <th>Total Revenue</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td className="polish-font-weight-weight-semibold" >{d.table}</td>
                <td>
                  <span className="type-xs polish-font-weight-weight-semibold polish-padding-0px-8px polish-border-radius-radius-sm"
                    style={{ background: d.type === "POOL" ? "var(--success-bg)" : "var(--danger-bg)", color: d.type === "POOL" ? "var(--success)" : "var(--danger)", border: `1px solid ${d.type === "POOL" ? "color-mix(in srgb, var(--success) 28%, var(--border))" : "color-mix(in srgb, var(--danger) 24%, var(--border))"}` }}
                  >
                    {d.type}
                  </span>
                </td>
                <td className="polish-color-accent polish-font-weight-weight-medium" >
                  {numberOrZero(d.sessions)}
                </td>
                <td className="polish-color-text-secondary" >{numberOrZero(d.avg_dur)}m</td>
                <td data-type="number" className="polish-color-warning" >
                  {polishCurrency(d.food_rev)}
                </td>
                <td data-type="number" className="polish-font-weight-weight-bold polish-color-success" >
                  {polishCurrency(d.revenue)}
                </td>
                <td>
                  <div
                    className="polish-display-flex polish-align-items-center polish-gap-8px"
                  >
                    <div
                      className="polish-flex-1 polish-height-6px polish-background-border polish-border-radius-radius-sm"
                    >
                      <div
                        className="polish-height-6px polish-background-success polish-border-radius-radius-sm" style={{ width: `${Math.round((numberOrZero(d.revenue) / maxRevenue) * 100)}%` }}
                      />
                    </div>
                    <span className="type-xs polish-color-text-muted polish-width-36px"

                    >
                      {numberOrZero(d.utilization_pct)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HsrTable>
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
        description="Run sessions today and the closing report will populate."
      />
    );

  return (
    <div className="polish-max-width-720px" >
      <div
        className="polish-display-flex polish-justify-content-space-between polish-align-items-center polish-margin-bottom-20px"
      >
        <div>
          <div className="type-base polish-font-weight-weight-semibold polish-color-var---venue-text-text" >
            Daily Closing Report
          </div>
          <div className="type-sm polish-color-text-muted polish-margin-top-0px" >
            {data.date}
          </div>
        </div>
        <div className="polish-display-flex polish-gap-8px polish-flex-wrap-wrap" >
          <HsrButton native className="btn btn-primary-sm" onClick={printReport}>
            Print Report
          </HsrButton>
          <HsrButton native
            className="btn btn-primary-sm"
            onClick={() => onNavigate?.("closing")}
          >
            Open Daily Closing
          </HsrButton>
        </div>
      </div>

      {/* Summary */}
      <div
        className="polish-display-grid polish-grid-template-columns-repeat-3-1fr polish-gap-12px polish-margin-bottom-16px"
      >
        <StatCard
          label="Total Revenue"
          value={polishCurrency(data.total_revenue)}
          color="var(--success)"
        />
        <StatCard
          label="Sessions"
          value={numberOrZero(data.total_sessions)}
          color="var(--accent)"
        />
        <StatCard
          label="Avg Duration"
          value={`${numberOrZero(data.avg_duration)}m`}
          color="var(--text-primary)"
        />
        <StatCard
          label="Play Revenue"
          value={polishCurrency(data.play_revenue)}
          color="var(--text-primary)"
        />
        <StatCard
          label="Food Revenue"
          value={polishCurrency(data.food_revenue)}
          color="var(--warning)"
        />
        <StatCard label="Peak Hour" value={data.peak_hour} color="var(--danger)" />
      </div>

      {/* Table breakdown */}
      {Object.keys(data.table_breakdown || {}).length > 0 && (
        <div className="history-section polish-margin-bottom-16px" >
          <div className="type-sm polish-font-weight-weight-semibold polish-color-text-primary polish-margin-bottom-12px"

          >
            Table Breakdown
          </div>
          <HsrTable className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th data-type="number">Sessions</th>
                <th data-type="number">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.table_breakdown || {})
                .sort((a, b) => numberOrZero(b[1]?.revenue) - numberOrZero(a[1]?.revenue))
                .map(([tbl, stats], i) => (
                  <tr key={i}>
                    <td className="polish-font-weight-weight-semibold" >{tbl}</td>
                    <td className="polish-color-accent" >{numberOrZero(stats?.sessions)}</td>
                    <td data-type="number" className="polish-font-weight-weight-semibold polish-color-success" >
                      {polishCurrency(stats?.revenue)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </HsrTable>
        </div>
      )}

      {/* Food breakdown */}
      {Object.keys(data.food_breakdown || {}).length > 0 && (
        <div className="history-section polish-margin-bottom-16px" >
          <div className="type-sm polish-font-weight-weight-semibold polish-color-text-primary polish-margin-bottom-12px"

          >
            Food Sold Today
          </div>
          <HsrTable className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Units Sold</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.food_breakdown || {})
                .sort((a, b) => b[1] - a[1])
                .map(([item, qty], i) => (
                  <tr key={i}>
                    <td className="polish-font-weight-weight-medium" >{item}</td>
                    <td className="polish-color-warning polish-font-weight-weight-semibold" >{numberOrZero(qty)}</td>
                  </tr>
                ))}
            </tbody>
          </HsrTable>
        </div>
      )}

      {/* All transactions today */}
      {Array.isArray(data.transactions) && data.transactions.some(Boolean) && (
        <div className="history-section">
          <div className="type-sm polish-font-weight-weight-semibold polish-color-text-primary polish-margin-bottom-12px"

          >
            All Sessions Today
          </div>
          <HsrTable className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Customer</th>
                <th>Duration</th>
                <th data-type="number">Play</th>
                <th data-type="number">Food</th>
                <th data-type="number">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.filter(Boolean).map((t, i) => (
                <tr key={i}>
                  <td className="polish-font-weight-weight-semibold" >{t.tbl}</td>
                  <td className="polish-font-weight-weight-medium" >{t.nm}</td>
                  <td className="polish-color-text-secondary" >{numberOrZero(t.dur)}m</td>
                  <td data-type="number" className="polish-color-success" >{polishCurrency(t.ply)}</td>
                  <td data-type="number" className="polish-color-warning" >{polishCurrency(t.famt)}</td>
                  <td data-type="number" className="polish-font-weight-weight-bold" >{polishCurrency(t.tot)}</td>
                </tr>
              ))}
            </tbody>
          </HsrTable>
        </div>
      )}

      {numberOrZero(data.total_sessions) === 0 && (
        <EmptyState
          icon="ti-clock-hour-4"
          title="No sessions recorded today"
          description="Today's table sessions will appear in this closing report."
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
    <div className="polish-max-width-760px" >
      <div
        className="polish-display-grid polish-grid-template-columns-repeat-3-1fr polish-gap-12px polish-margin-bottom-16px"
      >
        <StatCard label="Revenue" value={polishCurrency(data.metrics?.revenue)} color="var(--success)" />
        <StatCard label="Sessions" value={numberOrZero(data.metrics?.sessions)} color="var(--accent)" />
        <StatCard label="Food" value={polishCurrency(data.metrics?.food)} color="var(--warning)" />
      </div>

      <div className="history-section">
        <div className="type-base polish-font-weight-weight-bold polish-margin-bottom-12px" >
          Smart Closing Insights
        </div>
        {(Array.isArray(data.insights) ? data.insights.filter(Boolean) : []).map((insight, i) => {
          const [bg, fg, border] = colors[insight.type] || colors.info;
          return (
            <div
              key={i}
              className="polish-border-radius-radius-sm polish-padding-12px-12px polish-margin-bottom-8px" style={{ background: bg, color: fg, border: `1px solid ${border}` }}
            >
              <div className="type-sm polish-font-weight-weight-heavy polish-margin-bottom-4px" >
                {insight.title}
              </div>
              <div className="type-sm polish-color-text-secondary" >{insight.detail}</div>
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
      .then((r) => setRows(Array.isArray(r.data) ? r.data.filter(Boolean) : []))
      .catch(console.error);
  }, []);

  return (
    <div className="history-section">
      <div className="type-base polish-font-weight-weight-bold polish-margin-bottom-12px" >
        Anti-Leakage Audit Log
      </div>
      <HsrTable className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Severity</th>
            <th>Action</th>
            <th>Detail</th>
            <th data-type="number">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="5" className="polish-padding-16px" >
                <EmptyState
                  icon="ti-shield-check"
                  title="No audit events yet"
                  description="Sensitive actions and anti-leakage events will be tracked here."
                />
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td className="type-sm polish-color-text-secondary" >{formatBillDate(r)}</td>
                <td className="polish-font-weight-weight-bold" style={{ color: r.severity === "critical" ? "var(--danger)" : r.severity === "warning" ? "var(--warning)" : "var(--accent)" }}>
                  {r.severity}
                </td>
                <td className="polish-font-weight-weight-semibold" >{r.action}</td>
                <td>{r.detail}</td>
                <td data-type="number">{r.amount ? polishCurrency(r.amount) : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </HsrTable>
    </div>
  );
}

function AdvancedAnalyticsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getAdvancedAnalytics()
      .then((r) => { if (active) setData(r.data || {}); })
      .catch(e => { if (active) setError(e.userMessage || "Advanced analytics could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  if (loading) return <LoadingState title="Loading advanced analytics..." />;
  if (error) return <RetryNotice message={error} onRetry={() => setRetry(value => value + 1)} />;

  const tableProfitability = Array.isArray(data.table_profitability) ? data.table_profitability.filter(Boolean) : [];
  const quietHours = Array.isArray(data.quiet_hours) ? data.quiet_hours.filter(Boolean) : [];
  const hasQuietHourSignals = quietHours.some((row) => Number(row.sessions || 0) > 0);
  const hasCustomerData = Number(data.total_customers || 0) > 0;
  const hasSpendData = Number(data.avg_spend_per_customer || 0) > 0;
  const hasFoodAttachData = Number(data.food_attachment_rate || 0) > 0;

  return (
    <div>
      <div className="advanced-grid">
        <StatCard
          label="Retention"
          value={`${numberOrZero(data.retention_rate)}%`}
          color="var(--accent)"
          context={hasCustomerData ? "Returning customer share" : "Awaiting customer history"}
          empty={!hasCustomerData}
        />
        <StatCard
          label="Repeat Customers"
          value={`${numberOrZero(data.repeat_customers)}/${numberOrZero(data.total_customers)}`}
          color="var(--success)"
          context={hasCustomerData ? "Customers with repeat visits" : "No customer visits in range"}
          empty={!hasCustomerData}
        />
        <StatCard
          label="Food Attachment"
          value={`${numberOrZero(data.food_attachment_rate)}%`}
          color="var(--warning)"
          context={hasFoodAttachData ? "Orders attached to sessions" : "No food orders attached yet"}
          empty={!hasFoodAttachData}
        />
        <StatCard
          label="Avg Spend / Customer"
          value={polishCurrency(data.avg_spend_per_customer)}
          color="var(--text-primary)"
          context={hasSpendData ? "Closed spend per customer" : "Awaiting closed bills"}
          empty={!hasSpendData}
        />
      </div>

      <div className="analytics-panels">
        <div className="history-section">
          <div className="section-heading">Table profitability</div>
          {tableProfitability.length === 0 ? (
            <EmptyState
              icon="ti-chart-bar"
              title="No table profitability data yet"
              description="Completed sessions provide revenue and duration comparisons for each table."
              action={<HsrButton icon="ti-refresh" onClick={() => setRetry(value => value + 1)}>Refresh analytics</HsrButton>}
            />
          ) : (
            <HsrTable className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th data-type="number">Sessions</th>
                  <th data-type="number">Revenue</th>
                  <th>Avg Duration</th>
                  <th>Revenue / Session</th>
                </tr>
              </thead>
              <tbody>
                {tableProfitability.map((row) => (
                  <tr key={row.table}>
                    <td className="polish-font-weight-weight-bold" >{row.table}</td>
                    <td>{numberOrZero(row.sessions)}</td>
                    <td data-type="number" className="polish-color-success polish-font-weight-weight-bold" >{polishCurrency(row.revenue)}</td>
                    <td>{numberOrZero(row.avg_duration)}m</td>
                    <td data-type="number">{polishCurrency(row.revenue_per_session)}</td>
                  </tr>
                ))}
              </tbody>
            </HsrTable>
          )}
        </div>

        <div className="history-section">
          <div className="section-heading">Quiet hours</div>
          {!hasQuietHourSignals ? (
            <EmptyState
              icon="ti-clock"
              title="No quiet-hour pattern yet"
              description="Completed sessions reveal which hours have lower table traffic."
              action={<HsrButton icon="ti-refresh" onClick={() => setRetry(value => value + 1)}>Refresh analytics</HsrButton>}
            />
          ) : (
            <>
              {quietHours.map((row) => (
                <div key={row.hour} className="risk-row">
                  <span>{numberOrZero(row.hour)}:00 - {numberOrZero(row.hour) + 1}:00</span>
                  <strong>{numberOrZero(row.sessions)} sessions</strong>
                </div>
              ))}
              <div className="empty-state-detail polish-margin-top-8px" >
                These are lower-traffic slots based on recent checkout history.
              </div>
            </>
          )}
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
  const [summary, setSummary] = useCachedState("reports-summary", {
    sale: 0,
    sessions: 0,
    avg_time: 0,
    top_table: "-",
  });
  const [history, setHistory] = useCachedState("reports-history", []);
  const [summaryReady, setSummaryReady] = useState(() => hasCachedState("reports-summary"));
  const [historyReady, setHistoryReady] = useState(() => hasCachedState("reports-history"));
  const [exporting, setExporting] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchSummary = useCallback(async () => {
    try {
      const res = await getSummary();
      setSummary(res.data || {});
      setSummaryReady(true);
      return true;
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Report summary could not load.");
      return false;
    }
  }, [setSummary]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getHistory();
      setHistory(Array.isArray(res.data) ? res.data.filter(Boolean) : []);
      setHistoryReady(true);
      return true;
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Bill history could not load.");
      return false;
    }
  }, [setHistory]);

  const refreshReports = useCallback(async () => {
    setLoadError("");
    setRefreshing(true);
    const results = await Promise.all([fetchSummary(), fetchHistory()]);
    if (results.every(Boolean)) setRefreshedAt(Date.now());
    setRefreshing(false);
  }, [fetchHistory, fetchSummary]);

  useEffect(() => {
    refreshReports();
    localStorage.removeItem("reportsDefaultTab");
    const timer = setInterval(refreshReports, 60000);
    return () => clearInterval(timer);
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
          detail={summaryReady || historyReady ? "Reports may be stale until the latest data loads." : "Check your connection, then try again."}
          onRetry={refreshReports}
        />
      )}
      <DataFreshness at={refreshedAt} loading={refreshing} onRefresh={refreshReports} />
      {!summaryReady && refreshing && <LoadingState title="Loading report summary..." />}
      {summaryReady && (
        <div className="reports-summary-grid">
          <StatCard
            label="Today's Revenue"
            value={polishCurrency(summary?.sale)}
            color="var(--success)"
          />
          <StatCard
            label="Sessions Today"
            value={numberOrZero(summary?.sessions)}
            color="var(--accent)"
          />
          <StatCard
            label="Avg Duration"
            value={`${numberOrZero(summary?.avg_time)}m`}
            color="var(--text-primary)"
          />
          <StatCard label="Top Table" value={summary?.top_table || "-"} color="var(--warning)" />
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="segmented-control page-tabs reports-tabs">
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

      {activeTab === "history" && !historyReady && refreshing && <LoadingState title="Loading bills..." />}
      {activeTab === "history" && historyReady && (
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
      {activeTab === "session-edits" && <SessionEditsReport />}
      {activeTab === "audit" && <AuditLogView />}
    </div>
  );
}
