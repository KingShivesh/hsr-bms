import { formatCurrency as polishCurrency, formatDateTime } from "../../utils/format.js";
import { Icon as HsrIcon, Button as HsrButton, Input as HsrInput, Table as HsrTable } from "../../components/ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedState, hasCachedState } from "../../hooks/useCachedState.js";
import { getFoodOrders, getHistory } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { Button, Drawer, MetricValue } from "../../components/ui/index.js";
import Pagination from "../../components/ui/Pagination.jsx";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import { tariffDescription } from "../sessions/tariffs.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function money(value = 0) { return polishCurrency(value); }

function billTotal(row) {
  return Number(row?.tot ?? row?.total ?? row?.amount ?? 0);
}

function billTableCharge(row) {
  return Number(row?.ply ?? row?.play_charge ?? 0);
}

function billFoodCharge(row) {
  return Number(row?.famt ?? row?.food_charge ?? 0);
}

function billCustomer(row) {
  return row?.payer_name || row?.nm || row?.customer_name || "Guest";
}

function billDate(row) {
  const ts = Number(row?.ts);
  if (Number.isFinite(ts) && ts > 0) return formatDateTime(ts, { includeYear: true });
  return row?.date || "-";
}

function paymentMethod(row) {
  return String(row?.payment_method || "Cash");
}

function SalesSkeleton() {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading sales">
      <div className="page-skeleton-status">
        <span>Loading sales register...</span>
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

export default function SalesPage() {
  const [history, setHistory] = useCachedState("sales-history", []);
  const [foodOrders, setFoodOrders] = useCachedState("sales-food", []);
  const [loading, setLoading] = useState(() => !hasCachedState("sales-history"));
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const salesRefreshTimerRef = useRef(null);

  const loadSales = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading && !hasCachedState("sales-history")) setLoading(true);
    setError("");
    try {
      const [historyRes, foodRes] = await Promise.all([getHistory(), getFoodOrders()]);
      setHistory(asArray(historyRes.data));
      setFoodOrders(asArray(foodRes.data));
    } catch (err) {
      setError(err.userMessage || "Sales register could not load.");
    } finally {
      setLoading(false);
    }
  }, [setHistory, setFoodOrders]);

  const scheduleSalesRefresh = useCallback(() => {
    window.clearTimeout(salesRefreshTimerRef.current);
    salesRefreshTimerRef.current = window.setTimeout(loadSales, 150);
  }, [loadSales]);

  const realtimeState = useRealtimeSubscription({
    topics: ["orders"],
    onEvent: (event) => {
      if (
        event.type === "order.placed" ||
        event.type === "order.cancelled" ||
        event.type === "order.restored" ||
        event.type === "system.sync_required"
      ) {
        scheduleSalesRefresh();
      }
    },
    onFallbackPoll: loadSales,
    fallbackPollMs: 15000,
  });

  useEffect(() => {
    loadSales({ showLoading: true });
    const onDataChanged = () => scheduleSalesRefresh();
    window.addEventListener("hsr:data-changed", onDataChanged);
    return () => {
      window.removeEventListener("hsr:data-changed", onDataChanged);
    };
  }, [loadSales, scheduleSalesRefresh]);

  useEffect(() => {
    if (realtimeState !== "connected") return undefined;
    const safetyPoll = window.setInterval(loadSales, 60000);
    return () => window.clearInterval(safetyPoll);
  }, [loadSales, realtimeState]);

  useEffect(() => () => window.clearTimeout(salesRefreshTimerRef.current), []);

  const summary = useMemo(() => {
    const tableRevenue = history.reduce((sum, row) => sum + billTableCharge(row), 0);
    const attachedFood = history.reduce((sum, row) => sum + billFoodCharge(row), 0);
    const counterFood = foodOrders.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const payment = { Cash: 0, UPI: 0, Card: 0, Credit: 0 };
    history.forEach((row) => {
      const method = paymentMethod(row);
      payment[method in payment ? method : "Cash"] += billTotal(row);
    });
    foodOrders.forEach((row) => {
      const method = paymentMethod(row);
      payment[method in payment ? method : "Cash"] += Number(row.total || 0);
    });
    return {
      total: tableRevenue + attachedFood + counterFood,
      tableRevenue,
      foodRevenue: attachedFood + counterFood,
      sessions: history.length,
      foodOrders: foodOrders.length,
      payment,
    };
  }, [history, foodOrders]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history
      .filter((row) => {
        if (!needle) return true;
        return [
          row.tbl,
          billCustomer(row),
          paymentMethod(row),
          row.billing_mode,
          row.session_key,
        ].some((value) => String(value || "").toLowerCase().includes(needle));
      });
  }, [history, query]);
  const pageSize = 25;
  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredRows.length / pageSize)));
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (loading && !history.length && !foodOrders.length && !error) {
    return <div data-realtime-state={realtimeState}><SalesSkeleton /></div>;
  }

  return (
    <section className="op2-page sales-page" data-realtime-state={realtimeState}>
      <div className="op2-hero">
        <div>
          <span className="lf-eyebrow">Business</span>
          <h1>Sales register</h1>
          <p>Completed table sessions, counter orders, payment mix and receipt-level detail.</p>
        </div>
        <HsrButton native type="button" className="lf-secondary-button" onClick={() => window.print()}>
          <HsrIcon className="ti ti-printer" aria-hidden="true" />
          Print register
        </HsrButton>
      </div>

      {error && (
        <RetryNotice
          message="Unable to load sales"
          detail={error}
          onRetry={() => loadSales({ showLoading: true })}
        />
      )}

      <div className="op2-metric-grid sales-metrics">
        <div><span>Total sales</span><MetricValue>{money(summary.total)}</MetricValue><em>{summary.sessions} table session(s)</em></div>
        <div><span>Table revenue</span><MetricValue>{money(summary.tableRevenue)}</MetricValue><em>Time-based sales</em></div>
        <div><span>Food revenue</span><MetricValue>{money(summary.foodRevenue)}</MetricValue><em>{summary.foodOrders} counter order(s)</em></div>
        <div><span>Cash</span><MetricValue>{money(summary.payment.Cash)}</MetricValue><em>Collected in cash</em></div>
        <div><span>UPI</span><MetricValue>{money(summary.payment.UPI)}</MetricValue><em>Digital payments</em></div>
        <div><span>Card</span><MetricValue>{money(summary.payment.Card)}</MetricValue><em>Card payments</em></div>
        <div><span>Credit</span><MetricValue>{money(summary.payment.Credit)}</MetricValue><em>Outstanding, not collected</em></div>
      </div>

      <div className="op2-panel">
        <div className="op2-panel-head">
          <div>
            <span>Transactions</span>
            <h2>Recent sales</h2>
          </div>
          <div className="op2-controls">
            <HsrInput
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Search customer, table, payment..."
              aria-label="Search sales"
            />
          </div>
        </div>

        {rows.length ? (
          <div className="sales-table-wrap">
            <HsrTable className="sales-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>Table</th>
                  <th>Payment</th>
                  <th>Duration</th>
                  <th>Table</th>
                  <th data-type="number">Food</th>
                  <th data-type="number">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr data-receipt-id={row.id} key={row.id || `${row.ts}-${row.tbl}`} onClick={() => setSelected(row)}>
                    <td>
                      <HsrButton native className="sales-receipt-trigger" aria-label={`Open receipt ${row.id || "details"}`} onClick={() => setSelected(row)}>#{row.id || "-"}</HsrButton>
                      <span>{billDate(row)}</span>
                    </td>
                    <td className="sales-customer-cell" title={billCustomer(row)}>{billCustomer(row)}</td>
                    <td>{String(row.tbl || "-").toUpperCase()}</td>
                    <td><em>{paymentMethod(row)}</em></td>
                    <td>{Number(row.dur || 0)}m</td>
                    <td data-type="number">{money(billTableCharge(row))}</td>
                    <td data-type="number">{money(billFoodCharge(row))}</td>
                    <td data-type="number"><strong>{money(billTotal(row))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </HsrTable>
          </div>
        ) : (
          <div className="op2-empty">
            <HsrIcon className="ti ti-receipt" aria-hidden="true" />
            <strong>No sales found</strong>
            <span>Completed sessions and food orders will appear here after checkout.</span>
          </div>
        )}
        <Pagination total={filteredRows.length} page={safePage} pageSize={pageSize} onPageChange={setPage} label="Sales" />
      </div>

      <Drawer
        portal
        open={!!selected}
        title={selected ? `Receipt #${selected.id || "-"}` : "Receipt"}
        description={selected ? `${billCustomer(selected)} · ${paymentMethod(selected)}` : ""}
        onClose={() => setSelected(null)}
        className="sales-detail-drawer"
      >
        {selected && (
          <div className="sales-detail">
            <dl className="sales-detail-grid">
              <div><dt>Date</dt><dd>{billDate(selected)}</dd></div>
              <div><dt>Table</dt><dd>{String(selected.tbl || "-").toUpperCase()}</dd></div>
              <div><dt>Payment</dt><dd>{paymentMethod(selected)}</dd></div>
              <div><dt>Duration</dt><dd>{Number(selected.dur || 0)} min</dd></div>
              {selected.tbl !== "CAFE" && <div><dt>Tariff</dt><dd>{tariffDescription(selected)}</dd></div>}
              <div><dt>Table charge</dt><dd>{money(billTableCharge(selected))}</dd></div>
              <div><dt>Food</dt><dd>{money(billFoodCharge(selected))}</dd></div>
              <div><dt>Total</dt><dd>{money(billTotal(selected))}</dd></div>
            </dl>
            {selected.notes && <p className="sales-notes">{selected.notes}</p>}
            <div className="checkout-actions">
              <Button variant="secondary" icon="ti-printer" onClick={() => window.print()}>
                Print receipt
              </Button>
              <Button variant="primary" onClick={() => setSelected(null)}>
                Close Receipt
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
