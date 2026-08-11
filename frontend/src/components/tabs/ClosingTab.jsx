import { useEffect, useState } from "react";
import { closeDay, getClosingInsights, getClosingReport } from "../../api/index.js";

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function ClosingMetric({ label, value, icon, tone = "neutral" }) {
  return (
    <div className={`closing-metric ${tone}`}>
      <i className={`ti ${icon}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ChecklistRow({ ok, label, detail }) {
  return (
    <div className={`closing-check-row ${ok ? "ok" : "warn"}`}>
      <i className={`ti ${ok ? "ti-circle-check" : "ti-alert-circle"}`} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

export default function ClosingTab() {
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closedDay, setClosedDay] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");

  useEffect(() => {
    async function fetchClosing() {
      try {
        const [reportRes, insightsRes] = await Promise.all([
          getClosingReport(),
          getClosingInsights(),
        ]);
        setData(reportRes.data);
        setInsights(insightsRes.data);
        const closeRecord = reportRes.data.day_close || {};
        setClosedDay(!!closeRecord.closed);
        setOpeningFloat(closeRecord.opened_float ? String(closeRecord.opened_float) : "");
        setCountedCash(closeRecord.counted_cash ? String(closeRecord.counted_cash) : "");
        setClosingNotes(closeRecord.notes || "");
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchClosing();
  }, []);

  async function markDayClosed() {
    if (!data?.can_close_day) {
      alert("Close all running tables before closing the day.");
      return;
    }
    if (!confirm("Mark today as closed after verifying Cash, UPI, and Card totals?")) return;
    try {
      const res = await closeDay(
        parseInt(openingFloat, 10) || 0,
        parseInt(countedCash, 10) || 0,
        closingNotes,
      );
      setClosedDay(true);
      setData((prev) => ({
        ...prev,
        day_close: {
          closed: true,
          ...res.data,
          notes: closingNotes,
        },
      }));
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to close day.");
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-state-icon">
          <i className="ti ti-loader-2" aria-hidden="true" />
        </div>
        <div className="loading-state-title">Loading closing checklist...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <i className="ti ti-clipboard-text" aria-hidden="true" />
        </div>
        <div className="empty-state-title">Closing report unavailable</div>
        <div className="empty-state-detail">Try again after the backend is running.</div>
      </div>
    );
  }

  const foodOnlyTotal = data.food_only_revenue || 0;
  const totalSales = (data.total_revenue || 0) + foodOnlyTotal;
  const totalFoodSales = (data.food_revenue || 0) + foodOnlyTotal;
  const hasFoodOnly = foodOnlyTotal > 0;
  const counterCash = data.food_only_payment_breakdown?.Cash || 0;
  const counterUpi = data.food_only_payment_breakdown?.UPI || 0;
  const counterCard = data.food_only_payment_breakdown?.Card || 0;
  const corrections = data.corrections_today || [];

  return (
    <div className="closing-page">
      <div className="closing-hero">
        <div>
          <div className="closing-eyebrow">Shift end</div>
          <strong className="closing-date">{data.date}</strong>
          <p>Verify cash, active tables and exceptions before locking the day.</p>
        </div>
        <div className="closing-actions">
          <button className="btn" type="button" onClick={() => window.print()}>
            <i className="ti ti-printer" aria-hidden="true" />
            Print
          </button>
          <button
            className={`btn ${closedDay ? "btn-success-sm" : "btn-primary-sm"}`}
            type="button"
            disabled={closedDay}
            onClick={markDayClosed}
          >
            <i className={`ti ${closedDay ? "ti-circle-check" : "ti-lock-check"}`} aria-hidden="true" />
            {closedDay ? "Day closed" : "Close day"}
          </button>
        </div>
      </div>

      <div className="closing-metric-grid">
        <ClosingMetric label="Total sales" value={money(totalSales)} icon="ti-report-money" tone="total" />
        <ClosingMetric label="Cash" value={money(data.cash_total)} icon="ti-cash" tone="cash" />
        <ClosingMetric label="UPI" value={money(data.upi_total)} icon="ti-qrcode" tone="upi" />
        <ClosingMetric label="Card" value={money(data.card_total || 0)} icon="ti-credit-card" tone="upi" />
        <ClosingMetric label="Table sales" value={money(data.total_revenue)} icon="ti-billiard" />
        <ClosingMetric label="Food sales" value={money(totalFoodSales)} icon="ti-tools-kitchen-2" />
        <ClosingMetric label="Sessions" value={data.total_sessions} icon="ti-receipt" />
      </div>

      <div className="closing-layout">
        <div className="history-section closing-checklist">
          <div className="section-heading">Close Checklist</div>
          <ChecklistRow
            ok={data.active_tables === 0}
            label="All tables closed"
            detail={
              data.active_tables === 0
                ? "No running sessions remain."
                : `${data.active_tables} table(s) still running: ${data.open_tables.map((t) => t.table_id).join(", ")}`
            }
          />
          <ChecklistRow
            ok
            label="Counter food sales"
            detail={
              hasFoodOnly
                ? `${money(foodOnlyTotal)} recorded: Cash ${money(counterCash)}, UPI ${money(counterUpi)}, Card ${money(counterCard)}.`
                : "No counter-only food sales today."
            }
          />
          <ChecklistRow
            ok={corrections.length === 0}
            label="Corrections reviewed"
            detail={
              corrections.length
                ? `${corrections.length} reset/clear action(s) need owner review.`
                : "No reset or clear actions today."
            }
          />
          <ChecklistRow
            ok={data.total_sessions > 0}
            label="Transactions recorded"
            detail={
              data.total_sessions
                ? `${data.total_sessions} table transaction(s) closed today.`
                : "No table sessions closed today."
            }
          />
          <ChecklistRow
            ok={closedDay}
            label="Owner reviewed"
            detail={closedDay ? `Closed by ${data.day_close?.closed_by || "admin"}.` : "Enter cash count, then close the day."}
          />
        </div>

        <div className="history-section">
          <div className="section-heading">Cash Close</div>
          <div className="closing-cash-grid">
            <label className="table-field-stack">
              <span>Opening float</span>
              <input
                className="table-mini-input"
                type="number"
                min="0"
                value={openingFloat}
                disabled={closedDay}
                onChange={(event) => setOpeningFloat(event.target.value)}
              />
            </label>
            <label className="table-field-stack">
              <span>Counted cash</span>
              <input
                className="table-mini-input"
                type="number"
                min="0"
                value={countedCash}
                disabled={closedDay}
                onChange={(event) => setCountedCash(event.target.value)}
              />
            </label>
          </div>
          <div className={`closing-variance ${data.day_close?.variance === 0 ? "ok" : "warn"}`}>
            Expected cash {money((data.cash_total || 0) + (parseInt(openingFloat, 10) || 0))}
            {closedDay && ` · Variance ${money(data.day_close?.variance || 0)}`}
          </div>
          <textarea
            className="table-notes-textarea closing-notes-input"
            rows={2}
            placeholder="Closing notes"
            value={closingNotes}
            disabled={closedDay}
            onChange={(event) => setClosingNotes(event.target.value)}
          />
        </div>
      </div>

      <div className="closing-layout">
        <div className="history-section">
          <div className="section-heading">Open Tables</div>
          {data.open_tables.length === 0 ? (
            <div className="closing-empty-line">
              <i className="ti ti-circle-check" aria-hidden="true" />
              No active tables.
            </div>
          ) : (
            data.open_tables.map((table) => (
              <div className="risk-row" key={table.table_id}>
                <span>{table.table_id} · {table.customer_name}</span>
                <strong>{money(table.food_total)} food</strong>
              </div>
            ))
          )}
          <div className="closing-idle-line">
            Idle: {data.idle_tables.length ? data.idle_tables.join(", ") : "None"}
          </div>
        </div>
      </div>

      <div className="closing-layout">
        <div className="history-section">
          <div className="section-heading">Table Breakdown</div>
          {Object.keys(data.table_breakdown).length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-state-title">No table sessions today</div>
            </div>
          ) : (
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
                  .map(([table, stats]) => (
                    <tr key={table}>
                      <td style={{ fontWeight: 800 }}>{table}</td>
                      <td>{stats.sessions}</td>
                      <td style={{ color: "#16a34a", fontWeight: 800 }}>{money(stats.revenue)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="history-section">
          <div className="section-heading">Food Sold</div>
          {Object.keys(data.food_breakdown).length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-state-title">No table food today</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.food_breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([item, qty]) => (
                    <tr key={item}>
                      <td>{item}</td>
                      <td style={{ fontWeight: 800 }}>{qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="history-section">
        <div className="section-heading">Corrections Today</div>
        {corrections.length === 0 ? (
          <div className="closing-empty-line">
            <i className="ti ti-circle-check" aria-hidden="true" />
            No resets, daily clears, or full data clears today.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Detail</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((row, index) => (
                <tr key={`${row.action}-${row.date}-${index}`}>
                  <td style={{ color: "#64748b", fontSize: "12px" }}>{row.date}</td>
                  <td style={{ color: "#e11d48", fontWeight: 800 }}>{row.action.replaceAll("_", " ")}</td>
                  <td>{row.detail}</td>
                  <td style={{ fontWeight: 800 }}>{row.amount || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="history-section">
        <div className="section-heading">Closing Insights</div>
        {(insights?.insights || []).map((insight, index) => (
          <div className={`closing-insight ${insight.type || "info"}`} key={`${insight.title}-${index}`}>
            <strong>{insight.title}</strong>
            <span>{insight.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
