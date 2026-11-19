import { formatCurrency as polishCurrency } from "../../utils/format.js";
import { Checkbox, Icon as HsrIcon, Input as HsrInput, Textarea as HsrTextarea, Table as HsrTable } from "../ui/index.js";
import { useEffect, useRef, useState } from "react";
import { closeDay, getClosingInsights, getClosingReport } from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { useConfirm } from "../confirmContext.js";
import RetryNotice from "../RetryNotice.jsx";
import { Button, MetricCard } from "../ui/index.js";

function money(value) { return polishCurrency(value); }
const clippedText = { minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function ClosingMetric({ label, value, icon, tone = "neutral" }) {
  return <MetricCard variant="inline" className={`closing-metric ${tone}`} label={label} value={value} icon={icon} />;
}

function ChecklistRow({ ok, label, detail }) {
  return (
    <div className={`closing-check-row ${ok ? "ok" : "warn"}`}>
      <HsrIcon className={`ti ${ok ? "ti-circle-check" : "ti-alert-circle"}`} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <strong>{label}</strong>
        {detail && <span style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{detail}</span>}
      </div>
    </div>
  );
}

function PaymentAudit({ cashTotal, upiTotal, cardTotal, openingFloat, countedCash, closedDay, variance }) {
  const floatValue = parseInt(openingFloat, 10) || 0;
  const countedValue = parseInt(countedCash, 10) || 0;
  const expectedCash = Number(cashTotal || 0) + floatValue;
  const varianceValue = closedDay ? Number(variance || 0) : countedValue - expectedCash;
  const hasCount = countedCash !== "";
  const varianceTone = !hasCount && !closedDay ? "pending" : varianceValue === 0 ? "ok" : "warn";

  return (
    <div className="closing-payment-audit">
      <div>
        <span>Cash payments</span>
        <strong>{money(cashTotal)}</strong>
      </div>
      <div>
        <span>UPI</span>
        <strong>{money(upiTotal)}</strong>
      </div>
      <div>
        <span>Card</span>
        <strong>{money(cardTotal)}</strong>
      </div>
      <div>
        <span>Expected cash</span>
        <strong>{money(expectedCash)}</strong>
      </div>
      <div className={varianceTone}>
        <span>{hasCount || closedDay ? "Variance" : "Count pending"}</span>
        <strong>{hasCount || closedDay ? money(varianceValue) : "—"}</strong>
      </div>
    </div>
  );
}

export default function ClosingTab() {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closedDay, setClosedDay] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closingBusy, setClosingBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [insightsError, setInsightsError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const reportDate = useRef("");
  const [legacyReviewed, setLegacyReviewed] = useState(false);

  async function fetchClosing() {
    setLoading(true);
    setLoadError("");
    setInsightsError("");
    try {
      const [reportResult, insightsResult] = await Promise.allSettled([
        getClosingReport(reportDate.current),
        getClosingInsights(),
      ]);
      if (reportResult.status === "rejected") throw reportResult.reason;
      const reportRes = reportResult.value;
      if (!reportRes.data || typeof reportRes.data !== "object" || Array.isArray(reportRes.data)) throw new Error("Invalid closing report");
      setData(reportRes.data);
      setSelectedDate(reportRes.data.date.split("/").reverse().join("-"));
      setLegacyReviewed(false);
      if (insightsResult.status === "fulfilled" && insightsResult.value.data?.date === reportRes.data.date && Array.isArray(insightsResult.value.data?.insights)) {
        setInsights(insightsResult.value.data);
      } else {
        setInsights(null);
        setInsightsError(reportDate.current ? "Insights are available for the current business day only." : "Closing insights could not load.");
      }
      const closeRecord = reportRes.data.day_close || {};
      setClosedDay(!!closeRecord.closed);
      setOpeningFloat(closeRecord.opened_float != null ? String(closeRecord.opened_float) : "");
      setCountedCash(closeRecord.counted_cash != null ? String(closeRecord.counted_cash) : "");
      setClosingNotes(closeRecord.notes || "");
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Daily Closing could not load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchClosing();
  }, []);

  async function markDayClosed() {
    if (!data?.can_close_day || loadError || reportIncomplete || (data.reconciliation?.legacy_review_required && !legacyReviewed)) {
      showToast(loadError || reportIncomplete ? "Reload the complete closing report before closing the day." : data.close_block_reason || "Review the ledger warnings before closing.", "error");
      return;
    }
    const confirmed = await requestConfirm({
      title: `Close ${data.date}?`,
      message: "Lock this 3 AM-to-3 AM IST business day after verifying collected payments and member credit?",
      confirmLabel: "Close Day",
      tone: "warning",
    });
    if (!confirmed) return;
    setClosingBusy(true);
    try {
      const res = await closeDay(
        parseInt(openingFloat, 10) || 0,
        parseInt(countedCash, 10) || 0,
        closingNotes,
        data.date,
        legacyReviewed,
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
      showToast("Day closed", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to close day.", "error");
    } finally {
      setClosingBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading closing checklist">
        <div className="page-skeleton-status">
          <span>Loading closing checklist...</span>
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

  if (!data) {
    return (
      <RetryNotice
        message={loadError || "Closing report unavailable"}
        detail="Try again after checking the backend connection."
        onRetry={fetchClosing}
      />
    );
  }

  const foodOnlyTotal = Number(data.food_only_revenue) || 0;
  const totalSales = (Number(data.total_revenue) || 0) + foodOnlyTotal;
  const totalFoodSales = (Number(data.food_revenue) || 0) + foodOnlyTotal;
  const hasFoodOnly = foodOnlyTotal > 0;
  const counterCash = data.food_only_payment_breakdown?.Cash || 0;
  const counterUpi = data.food_only_payment_breakdown?.UPI || 0;
  const counterCard = data.food_only_payment_breakdown?.Card || 0;
  const openTables = Array.isArray(data.open_tables) ? data.open_tables.filter(Boolean) : [];
  const idleTables = Array.isArray(data.idle_tables) ? data.idle_tables.filter(Boolean) : [];
  const corrections = Array.isArray(data.corrections_today) ? data.corrections_today.filter(Boolean) : [];
  const tableBreakdown = Object.entries(data.table_breakdown || {}).filter(([, stats]) => stats && typeof stats === "object");
  const foodBreakdown = Object.entries(data.food_breakdown || {});
  const insightRows = Array.isArray(insights?.insights) ? insights.insights.filter(Boolean) : [];
  const reportIncomplete = !Array.isArray(data.open_tables) || !Array.isArray(data.idle_tables) || !Array.isArray(data.corrections_today) || !data.table_breakdown || !data.food_breakdown || data.active_tables == null || (!closedDay && !data.reconciliation);
  const expectedCash = (Number(data.cash_total) || 0) + (parseInt(openingFloat, 10) || 0);
  const countedValue = parseInt(countedCash, 10) || 0;
  const variancePreview = countedCash === "" && !closedDay ? null : countedValue - expectedCash;

  return (
    <div className="closing-page">
      {loadError && (
        <RetryNotice
          message={loadError}
          detail="The closing report below may be stale until this reloads."
          onRetry={fetchClosing}
        />
      )}
      {!loadError && reportIncomplete && <RetryNotice message="Some closing details are unavailable" detail="Reload the report before closing the day." onRetry={fetchClosing} />}
      <div className="closing-hero">
        <div>
          <div className="closing-eyebrow">Shift end</div>
          <strong className="closing-date" title={data.date || undefined} style={{ ...clippedText, display: "block" }}>{data.date || "Date unavailable"}</strong>
          <p>Business day: 3 AM to 3 AM IST. Verify collected payments and unpaid member credit before locking.</p>
        </div>
        <div className="closing-actions">
          <label className="table-field-stack">
            <span>Business date</span>
            <HsrInput aria-label="Business date" type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} />
          </label>
          <Button variant="secondary" icon="ti-calendar" disabled={!selectedDate || closingBusy} onClick={() => {
            reportDate.current = selectedDate.split("-").reverse().join("/");
            fetchClosing();
          }}>Load date</Button>
          <Button variant="secondary" icon="ti-printer" onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant={closedDay ? "secondary" : "primary"}
            icon={closedDay ? "ti-circle-check" : "ti-lock-check"}
            disabled={closedDay || closingBusy || !data.can_close_day || !!loadError || reportIncomplete || (data.reconciliation?.legacy_review_required && !legacyReviewed)}
            loading={closingBusy}
            onClick={markDayClosed}
            title={data.close_block_reason || undefined}
          >
            {closedDay ? "Day Closed" : !data.can_close_day ? data.active_tables ? "Close Tables First" : "Review Ledger" : "Close Day"}
          </Button>
        </div>
      </div>

      <div className="closing-metric-grid">
        <ClosingMetric label="Total sales" value={money(totalSales)} icon="ti-report-money" tone="total" />
        <ClosingMetric label="Cash" value={money(data.cash_total)} icon="ti-cash" tone="cash" />
        <ClosingMetric label="UPI" value={money(data.upi_total)} icon="ti-qrcode" tone="upi" />
        <ClosingMetric label="Card" value={money(data.card_total || 0)} icon="ti-credit-card" tone="upi" />
        <ClosingMetric label="Member credit (unpaid)" value={money(data.credit_total || 0)} icon="ti-user" />
        <ClosingMetric label="Table sales" value={money(data.total_revenue)} icon="ti-billiard" />
        <ClosingMetric label="Food sales" value={money(totalFoodSales)} icon="ti-tools-kitchen-2" />
        <ClosingMetric label="Sessions" value={data.total_sessions ?? "—"} icon="ti-receipt" />
      </div>

      <div className="closing-layout">
        <div className="history-section closing-checklist">
          <div className="section-heading">Close Checklist</div>
          {data.reconciliation && <ChecklistRow ok={data.reconciliation.ok} label={data.reconciliation.ok ? "Ledger reconciled" : "Ledger discrepancies"}
            detail={`${data.reconciliation.transactions_checked} table receipts, ${data.reconciliation.counter_orders_checked} counter orders checked. Unpaid credit: ${money(data.reconciliation.credit_total)}.`} />}
          {[...(data.reconciliation?.errors || []), ...(data.reconciliation?.warnings || [])].map((issue, index) =>
            <ChecklistRow key={`${issue.code}-${issue.id}-${index}`} ok={false} label={`${issue.code} · ${issue.resource} ${issue.id ?? ""}`} detail={issue.message} />)}
          {!closedDay && data.reconciliation?.legacy_review_required && <Checkbox checked={legacyReviewed} onChange={setLegacyReviewed} label="I reviewed the legacy payment-ledger warnings" />}
          {data.legacy_close && <ChecklistRow ok={false} label="Legacy closing snapshot" detail="Saved under the earlier date policy; preserved without recalculation." />}
          <ChecklistRow
            ok={data.active_tables === 0}
            label="All tables closed"
            detail={
              data.active_tables === 0
                ? "No running sessions remain."
                : data.active_tables == null ? "Active table count unavailable."
                  : `${data.active_tables} table(s) still running: ${openTables.map((t) => t.table_id).join(", ") || "details unavailable"}`
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
            ok={Array.isArray(data.corrections_today) && corrections.length === 0}
            label="Corrections reviewed"
            detail={
              corrections.length
                ? `${corrections.length} reset/clear action(s) need owner review.`
                : Array.isArray(data.corrections_today) ? "No reset or clear actions today." : "Correction details unavailable."
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
          <PaymentAudit
            cashTotal={data.cash_total}
            upiTotal={data.upi_total}
            cardTotal={data.card_total || 0}
            openingFloat={openingFloat}
            countedCash={countedCash}
            closedDay={closedDay}
            variance={data.day_close?.variance || 0}
          />
          <div className="closing-cash-grid">
            <label className="table-field-stack">
              <span>Opening float</span>
              <HsrInput
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
              <HsrInput
                className="table-mini-input"
                type="number"
                min="0"
                value={countedCash}
                disabled={closedDay}
                onChange={(event) => setCountedCash(event.target.value)}
              />
            </label>
          </div>
          <div className={`closing-variance ${variancePreview === null || variancePreview === 0 ? "ok" : "warn"}`}>
            Expected cash {money(expectedCash)}
            {variancePreview !== null && ` · Variance ${money(variancePreview)}`}
          </div>
          <HsrTextarea
            aria-label="Closing notes"
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
          {openTables.length === 0 ? (
            <div className="closing-empty-line">
              <HsrIcon className="ti ti-circle-check" aria-hidden="true" />
              {Array.isArray(data.open_tables) ? "No active tables." : "Open table details unavailable."}
            </div>
          ) : (
            openTables.map((table) => (
              <div className="risk-row" key={table.table_id}>
                <span title={`${table.table_id || "Table"} · ${table.customer_name || "Guest"}`} style={clippedText}>{table.table_id} · {table.customer_name || "Guest"}</span>
                <strong>{money(table.food_total)} food</strong>
              </div>
            ))
          )}
          <div className="closing-idle-line">
            Idle: {idleTables.length ? idleTables.join(", ") : Array.isArray(data.idle_tables) ? "None" : "Unavailable"}
          </div>
        </div>
      </div>

      <div className="closing-layout">
        <div className="history-section">
          <div className="section-heading">Table Breakdown</div>
          {tableBreakdown.length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-state-title">{data.table_breakdown ? "No table sessions today" : "Table breakdown unavailable"}</div>
            </div>
          ) : (
            <HsrTable className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th data-type="number">Sessions</th>
                  <th data-type="number">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {tableBreakdown
                  .sort((a, b) => b[1].revenue - a[1].revenue)
                  .map(([table, stats]) => (
                    <tr key={table}>
                      <td className="polish-font-weight-weight-heavy" >{table}</td>
                      <td>{stats.sessions}</td>
                      <td data-type="number" className="polish-color-success polish-font-weight-weight-heavy" >{money(stats.revenue)}</td>
                    </tr>
                  ))}
              </tbody>
            </HsrTable>
          )}
        </div>

        <div className="history-section">
          <div className="section-heading">Food Sold</div>
          {foodBreakdown.length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-state-title">{data.food_breakdown ? "No table food today" : "Food breakdown unavailable"}</div>
            </div>
          ) : (
            <HsrTable className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th data-type="number">Qty</th>
                </tr>
              </thead>
              <tbody>
                {foodBreakdown
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([item, qty]) => (
                    <tr key={item}>
                      <td title={item} style={{ ...clippedText, maxWidth: 240 }}>{item}</td>
                      <td className="polish-font-weight-weight-heavy" >{qty}</td>
                    </tr>
                  ))}
              </tbody>
            </HsrTable>
          )}
        </div>
      </div>

      <div className="history-section">
        <div className="section-heading">Corrections Today</div>
        {corrections.length === 0 ? (
          <div className="closing-empty-line">
            <HsrIcon className="ti ti-circle-check" aria-hidden="true" />
            {Array.isArray(data.corrections_today) ? "No resets, daily clears, or full data clears today." : "Correction details unavailable."}
          </div>
        ) : (
          <HsrTable className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Detail</th>
                <th data-type="number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((row, index) => (
                <tr key={`${row.action}-${row.date}-${index}`}>
                  <td className="type-sm polish-color-text-secondary" >{row.date}</td>
                  <td className="polish-color-danger polish-font-weight-weight-heavy" >{String(row.action || "Unknown action").replaceAll("_", " ")}</td>
                  <td title={row.detail || ""} style={{ ...clippedText, maxWidth: 320 }}>{row.detail || "—"}</td>
                  <td className="polish-font-weight-weight-heavy" >{row.amount ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </HsrTable>
        )}
      </div>

      <div className="history-section">
        <div className="section-heading">Closing Insights</div>
        {insightsError && <RetryNotice message={insightsError} onRetry={fetchClosing} />}
        {!insightsError && !insightRows.length && <div className="closing-empty-line">No closing insights today.</div>}
        {insightRows.map((insight, index) => (
          <div className={`closing-insight ${insight.type || "info"}`} key={`${insight.title}-${index}`}>
            <strong>{insight.title}</strong>
            <span>{insight.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
