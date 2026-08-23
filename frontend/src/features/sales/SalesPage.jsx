import { useEffect, useMemo, useState } from "react";
import { getFoodOrders, getHistory } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";

const BILL_DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function money(value = 0) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

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
  return row?.payer_name || row?.nm || row?.customer_name || "Walk-in";
}

function billDate(row) {
  const ts = Number(row?.ts);
  if (Number.isFinite(ts) && ts > 0) return BILL_DATE_FORMATTER.format(new Date(ts));
  return row?.date || "-";
}

function paymentMethod(row) {
  return String(row?.payment_method || "Cash");
}

function SalesSkeleton() {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading sales">
      <div className="page-skeleton-status">
        <i className="ti ti-loader-2" aria-hidden="true" />
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
  const [history, setHistory] = useState([]);
  const [foodOrders, setFoodOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  async function loadSales({ showLoading = false } = {}) {
    if (showLoading) setLoading(true);
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
  }

  useEffect(() => {
    loadSales({ showLoading: true });
    const onDataChanged = () => loadSales();
    window.addEventListener("hsr:data-changed", onDataChanged);
    return () => window.removeEventListener("hsr:data-changed", onDataChanged);
  }, []);

  const summary = useMemo(() => {
    const tableRevenue = history.reduce((sum, row) => sum + billTableCharge(row), 0);
    const attachedFood = history.reduce((sum, row) => sum + billFoodCharge(row), 0);
    const counterFood = foodOrders.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const payment = { Cash: 0, UPI: 0, Card: 0 };
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

  const rows = useMemo(() => {
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
      })
      .slice(0, 80);
  }, [history, query]);

  if (loading && !history.length && !foodOrders.length && !error) return <SalesSkeleton />;

  return (
    <section className="op2-page sales-page">
      <div className="op2-hero">
        <div>
          <span className="lf-eyebrow">Business</span>
          <h1>Sales register</h1>
          <p>Completed table sessions, counter orders, payment mix and receipt-level detail.</p>
        </div>
        <button type="button" className="lf-secondary-button" onClick={() => window.print()}>
          <i className="ti ti-printer" aria-hidden="true" />
          Print register
        </button>
      </div>

      {error && (
        <RetryNotice
          message="Unable to load sales"
          detail={error}
          onRetry={() => loadSales({ showLoading: true })}
        />
      )}

      <div className="op2-metric-grid sales-metrics">
        <div><span>Total sales</span><strong>{money(summary.total)}</strong><em>{summary.sessions} table session(s)</em></div>
        <div><span>Table revenue</span><strong>{money(summary.tableRevenue)}</strong><em>Time-based sales</em></div>
        <div><span>Food revenue</span><strong>{money(summary.foodRevenue)}</strong><em>{summary.foodOrders} counter order(s)</em></div>
        <div><span>Cash</span><strong>{money(summary.payment.Cash)}</strong><em>Collected in cash</em></div>
        <div><span>UPI</span><strong>{money(summary.payment.UPI)}</strong><em>Digital payments</em></div>
        <div><span>Card</span><strong>{money(summary.payment.Card)}</strong><em>Card payments</em></div>
      </div>

      <div className="op2-panel">
        <div className="op2-panel-head">
          <div>
            <span>Transactions</span>
            <h2>Recent sales</h2>
          </div>
          <div className="op2-controls">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer, table, payment..."
            />
          </div>
        </div>

        {rows.length ? (
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>Table</th>
                  <th>Payment</th>
                  <th>Duration</th>
                  <th>Table</th>
                  <th>Food</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id || `${row.ts}-${row.tbl}`} onClick={() => setSelected(row)}>
                    <td>
                      <strong>#{row.id || "-"}</strong>
                      <span>{billDate(row)}</span>
                    </td>
                    <td>{billCustomer(row)}</td>
                    <td>{String(row.tbl || "-").toUpperCase()}</td>
                    <td><em>{paymentMethod(row)}</em></td>
                    <td>{Number(row.dur || 0)}m</td>
                    <td>{money(billTableCharge(row))}</td>
                    <td>{money(billFoodCharge(row))}</td>
                    <td><strong>{money(billTotal(row))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="op2-empty">
            <i className="ti ti-receipt" aria-hidden="true" />
            <strong>No sales found</strong>
            <span>Completed sessions and food orders will appear here after checkout.</span>
          </div>
        )}
      </div>

      {selected && (
        <div className="lf-modal-backdrop" role="presentation">
          <div className="op2-modal sales-detail" role="dialog" aria-modal="true" aria-label="Transaction detail">
            <div className="order-selector-head">
              <div>
                <span className="lf-eyebrow">Receipt #{selected.id || "-"}</span>
                <h3>{billCustomer(selected)}</h3>
              </div>
              <button type="button" className="lf-icon-button" onClick={() => setSelected(null)} aria-label="Close transaction detail">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <dl className="sales-detail-grid">
              <div><dt>Date</dt><dd>{billDate(selected)}</dd></div>
              <div><dt>Table</dt><dd>{String(selected.tbl || "-").toUpperCase()}</dd></div>
              <div><dt>Payment</dt><dd>{paymentMethod(selected)}</dd></div>
              <div><dt>Duration</dt><dd>{Number(selected.dur || 0)} min</dd></div>
              <div><dt>Table charge</dt><dd>{money(billTableCharge(selected))}</dd></div>
              <div><dt>Food</dt><dd>{money(billFoodCharge(selected))}</dd></div>
              <div><dt>Total</dt><dd>{money(billTotal(selected))}</dd></div>
            </dl>
            {selected.notes && <p className="sales-notes">{selected.notes}</p>}
            <div className="op2-modal-actions">
              <button type="button" className="lf-secondary-button" onClick={() => window.print()}>
                <i className="ti ti-printer" aria-hidden="true" />
                Print receipt
              </button>
              <button type="button" className="lf-primary-button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
