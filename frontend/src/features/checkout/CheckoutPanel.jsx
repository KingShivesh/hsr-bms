import { formatCurrency as polishCurrency, formatDateTime as polishDateTime } from "../../utils/format.js";
import { Icon as HsrIcon, Button as HsrButton, Input as HsrInput } from "../../components/ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quoteSession, stopSession, previewCheckout, closeWithProposal } from "../../api/index.js";
import { Alert, Badge, Button, Drawer } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import { tariffDescription } from "../sessions/tariffs.js";
import { CustomerAtClose, AdjustSessionTime } from "./CheckoutControls.jsx";

const PAYMENT_METHODS = [
  { id: "Cash", label: "Cash", icon: "ti-cash" },
  { id: "UPI", label: "UPI", icon: "ti-qrcode" },
  { id: "Card", label: "Card", icon: "ti-credit-card" },
  { id: "Split", label: "Split", icon: "ti-arrows-split" },
];

const DISCOUNT_OPTIONS = [
  { id: "none", label: "No discount" },
  { id: "percent_5", label: "5%" },
  { id: "percent_10", label: "10%" },
  { id: "rupee", label: "₹ off" },
];

function money(value) { return polishCurrency(value); }

function sanitizeRupeeDiscount(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(parseInt(digits, 10), 50));
}

function formatDateTime(ms) { return polishDateTime(ms); }

function splitSummary(rec) {
  const rows = Array.isArray(rec?.player_breakdown) ? rec.player_breakdown : [];
  return rows.filter((row) => row?.name);
}

export default function CheckoutPanel({ table, open, onClose, onComplete }) {
  const { showToast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [closedAtMs, setClosedAtMs] = useState("");
  const [quote, setQuote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [paymentSplit, setPaymentSplit] = useState({ Cash: "", UPI: "", Card: "" });
  const [proposal, setProposal] = useState({ customer: null, time_override: null });
  const proposalRef = useRef(proposal);
  const requestVersion = useRef(0);
  const quoteRef = useRef(null);
  const finalizingRef = useRef(false);

  const tableId = table?.id || "";
  const sessionKey = quote?.session_key || table?.session?.session_key || "";
  const discountAmount = Number(quote?.discount_amount || 0);
  const finalTotal = Number(quote?.tot ?? quote?.total ?? 0);
  const rawTotal = Number(quote?.raw_total ?? finalTotal);
  const splitRows = useMemo(() => splitSummary(quote), [quote]);

  const loadQuote = useCallback(async ({
    nextPaymentMethod,
    nextDiscountType,
    nextDiscountValue,
    nextClosedAtMs,
    nextCheckoutToken = "",
  }) => {
    if (!tableId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const current = quoteRef.current;
      const res = current?.can_edit_time != null ? await previewCheckout(tableId, {
        ...proposalRef.current, session_key: current.session_key,
        closed_at_ms: nextClosedAtMs || current.session_ended_at,
        checkout_token_value: nextCheckoutToken || current.checkout_token,
        payment_method: nextPaymentMethod, discount_type: nextDiscountType,
        discount_value: nextDiscountType === "rupee" ? Number(nextDiscountValue) || 0 : 0,
      }) : await quoteSession(
        tableId,
        nextPaymentMethod,
        nextDiscountType,
        nextDiscountType === "rupee" ? parseInt(sanitizeRupeeDiscount(nextDiscountValue), 10) || 0 : 0,
        nextClosedAtMs,
        nextCheckoutToken,
      );
      if (version !== requestVersion.current) return;
      quoteRef.current = res.data;
      setQuote(res.data || {});
      setClosedAtMs(res.data.session_ended_at);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setError(err.userMessage || err.response?.data?.detail || "Could not prepare checkout.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    if (!open || !tableId) return;
    setPaymentMethod("Cash");
    setDiscountType("none");
    setDiscountValue("");
    setDiscountReason("");
    setReceipt(null);
    setError("");
    setClosedAtMs("");
    setPaymentSplit({ Cash: "", UPI: "", Card: "" });
    quoteRef.current = null;
    setQuote(null);
    proposalRef.current = { customer: null, time_override: null };
    setProposal(proposalRef.current);
    loadQuote({
      nextPaymentMethod: "Cash",
      nextDiscountType: "none",
      nextDiscountValue: 0,
      nextClosedAtMs: "",
    });
    return () => { requestVersion.current += 1; };
  }, [open, tableId, loadQuote]);

  function updateProposal(key, value) {
    const next = { ...proposalRef.current, [key]: value };
    proposalRef.current = next;
    setProposal(next);
    if (next.customer?.phone && next.customer.phone.length !== 10) {
      requestVersion.current += 1;
      setLoading(false);
      setError("Enter a 10-digit phone number, or choose Skip.");
      return;
    }
    loadQuote({ nextPaymentMethod: paymentMethod, nextDiscountType: discountType,
      nextDiscountValue: discountValue, nextClosedAtMs: closedAtMs, nextCheckoutToken: quote?.checkout_token });
  }

  function handlePaymentChange(method) {
    setPaymentMethod(method);
    loadQuote({
      nextPaymentMethod: method,
      nextDiscountType: discountType,
      nextDiscountValue: discountValue,
      nextClosedAtMs: closedAtMs,
      nextCheckoutToken: quote?.checkout_token,
    });
  }

  function handleDiscountType(nextType) {
    const nextValue = nextType === "rupee" ? discountValue : "";
    setDiscountType(nextType);
    if (nextType === "none") setDiscountReason("");
    setDiscountValue(nextValue);
    loadQuote({
      nextPaymentMethod: paymentMethod,
      nextDiscountType: nextType,
      nextDiscountValue: nextValue,
      nextClosedAtMs: closedAtMs,
      nextCheckoutToken: quote?.checkout_token,
    });
  }

  function handleRupeeApply() {
    const nextValue = sanitizeRupeeDiscount(discountValue);
    setDiscountValue(nextValue);
    loadQuote({
      nextPaymentMethod: paymentMethod,
      nextDiscountType: "rupee",
      nextDiscountValue: nextValue,
      nextClosedAtMs: closedAtMs,
      nextCheckoutToken: quote?.checkout_token,
    });
  }

  async function handleFinalize() {
    if (!quote || quote.checkout_blocked || loading || error || finalizingRef.current) return;
    if (discountAmount > 0 && !discountReason.trim()) {
      setError("Enter a reason for the discount before closing.");
      return;
    }
    if (paymentMethod === "Split" && Object.values(paymentSplit).reduce((sum, value) => sum + (Number(value) || 0), 0) !== finalTotal) {
      setError("Split payments must match the final bill."); return;
    }
    setFinalizing(true);
    finalizingRef.current = true;
    setError("");
    const splitParts = paymentMethod === "Split" ? Object.entries(paymentSplit).filter(([, amount]) => Number(amount) > 0).map(([method, amount]) => ({ method, amount: Number(amount) })) : [];
    try {
      const res = quote.can_edit_time == null ? await stopSession(tableId, paymentMethod, quote.payer_name || "", discountType,
        discountType === "rupee" ? Number(discountValue) || 0 : 0, closedAtMs, discountReason.trim(), splitParts, sessionKey, quote.checkout_token) : await closeWithProposal(tableId, {
        ...proposalRef.current, payment_method: paymentMethod, discount_type: discountType,
        discount_value: discountType === "rupee" ? Number(discountValue) || 0 : 0,
        closed_at_ms: closedAtMs, checkout_token_value: quote.checkout_token, session_key: sessionKey,
        payment_split: splitParts,
      }, discountReason.trim());
      setReceipt(res.data || {});
      showToast(`${String(tableId).toUpperCase()} closed via ${paymentMethod}`, "success");
      if (res.data.time_edit && res.data.edit_count_today === res.data.edit_soft_cap) showToast(`You've edited ${res.data.edit_count_today} sessions today. Is the timer working correctly?`, "warning", { duration: 10000 });
      await onComplete?.();
    } catch (err) {
      setError(err.userMessage || err.response?.data?.detail || "Could not close table.");
    } finally {
      setFinalizing(false);
      finalizingRef.current = false;
    }
  }

  function handleDone() {
    setReceipt(null);
    onClose?.();
  }

  return (
    <Drawer
      portal
      open={open}
      title={receipt ? "Payment Complete" : `Checkout ${String(tableId).toUpperCase()}`}
      description={receipt ? "Receipt is ready for staff handoff." : "Bill is frozen while payment is collected."}
      onClose={finalizing ? undefined : receipt ? handleDone : onClose}
      className="checkout-panel"
    >
      {receipt ? (
        <div className="checkout-success">
          <div className="checkout-success-mark">
            <HsrIcon className="ti ti-circle-check" aria-hidden="true" />
          </div>
          <div>
            <span className="lf-eyebrow">Receipt</span>
            <h3>{receipt.tbl || String(tableId).toUpperCase()} · {money(receipt.tot)}</h3>
            <p>{receipt.payment_method || paymentMethod} · {tariffDescription(receipt)} · {receipt.nm || `${receipt.tbl || tableId.toUpperCase()} · Guest`}</p>
          </div>
          <div className="checkout-summary-grid">
            <div><span>Table</span><strong>{money(receipt.ply)}</strong></div>
            <div><span>Food</span><strong>{money(receipt.famt)}</strong></div>
            <div><span>Discount</span><strong>{money(receipt.discount_amount)}</strong></div>
            <div><span>Total</span><strong>{money(receipt.tot)}</strong></div>
          </div>
          <div className="checkout-time-row">
            <span>Started {formatDateTime(receipt.session_started_at)}</span>
            <span>Ended {formatDateTime(receipt.session_ended_at)}</span>
          </div>
          {receipt.time_edit?.receipt_warning && <p>Session time adjusted.{receipt.time_edit.category === "correction" ? ` Reason: ${receipt.time_edit.reason_label}.` : ""}</p>}
          <div className="checkout-actions">
            <Button variant="secondary" icon="ti-printer" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="primary" onClick={handleDone}>
              Close Receipt
            </Button>
          </div>
        </div>
      ) : (
        <div className="checkout-flow">
          {loading && !quote && <div className="checkout-loading">Preparing frozen bill...</div>}
          {error && <Alert tone="danger" title="Checkout needs attention">{error}</Alert>}
          {quote && (
            <>
              <div className="checkout-total-card">
                <div>
                  <Badge tone="running" dot>{String(quote.billing_mode || "single").toUpperCase()}</Badge>
                  <h3>{money(finalTotal)}</h3>
                  <p>{quote.nm || `${quote.tbl || tableId.toUpperCase()} · Guest`} · {quote.tariff_mode && quote.tariff_mode !== "hourly" ? tariffDescription(quote) : `${quote.dur || 0} billable min`}</p>
                </div>
                <div className="checkout-freeze-pill">
                  <HsrIcon className="ti ti-snowflake" aria-hidden="true" />
                  Frozen {formatDateTime(quote.session_ended_at || closedAtMs)}
                </div>
              </div>

              {quote.checkout_blocked && <Alert tone="warning">Close the open frame before checkout.</Alert>}
              {quote.time_edit && <Alert tone="warning" title="Duration adjusted">{quote.dur} min (adjusted from {quote.time_edit.original_duration} min) · {quote.time_edit.reason_label} · {quote.time_edit.staff}</Alert>}
              {Number.isFinite(quote.rate_delta) && quote.rate_delta !== 0 && <Alert tone="info">Member rate {money(quote.original_rate)}/hr → {money(quote.rate)}/hr · Bill change {money(quote.rate_delta)}</Alert>}
              <div className="checkout-summary-grid">
                <div><span>Table</span><strong>{money(quote.ply)}</strong></div>
                <div><span>Food</span><strong>{money(quote.famt)}</strong></div>
                <div><span>Before discount</span><strong>{money(rawTotal)}</strong></div>
                <div><span>Discount</span><strong>{money(discountAmount)}</strong></div>
              </div>

              {quote.can_edit_time && <AdjustSessionTime quote={quote} value={proposal.time_override} onChange={value => updateProposal("time_override", value)} disabled={finalizing || loading} />}
              {quote.can_edit_time != null && <CustomerAtClose value={proposal.customer} onChange={value => updateProposal("customer", value)} disabled={finalizing} />}

              {!!splitRows.length && (
                <section className="checkout-section">
                  <div className="checkout-section-head">
                    <h4>Who pays what</h4>
                    <span>{splitRows.length} customer{splitRows.length > 1 ? "s" : ""}</span>
                  </div>
                  <div className="checkout-split-list">
                    {splitRows.map((row) => (
                      <div key={row.name} className="checkout-split-row">
                        <div>
                          <strong>{row.name}</strong>
                          <span>
                            Table {money(row.table ?? row.play)} · Food {money(row.food)}
                            {Array.isArray(row.lost_frames) && row.lost_frames.length ? ` · Lost ${row.lost_frames.join(", ")}` : ""}
                          </span>
                        </div>
                        <b>{money(row.total)}</b>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="checkout-section">
                <div className="checkout-section-head">
                  <h4>Discount</h4>
                  <span>Admin controlled</span>
                </div>
                <div className="checkout-button-grid">
                  {DISCOUNT_OPTIONS.map((option) => (
                    <HsrButton native
                      key={option.id}
                      type="button"
                      className={discountType === option.id ? "is-active" : ""}
                      disabled={finalizing || (quote.can_discount === false && option.id !== "none")}
                      onClick={() => handleDiscountType(option.id)}
                    >
                      {option.label}
                    </HsrButton>
                  ))}
                </div>
                {discountType === "rupee" && (
                  <div className="checkout-inline-form">
                    <HsrInput
                      type="text"
                      inputMode="numeric"
                      value={discountValue}
                      onChange={(event) => setDiscountValue(sanitizeRupeeDiscount(event.target.value))}
                      placeholder="Max ₹50"
                    />
                    <Button variant="secondary" loading={loading} onClick={handleRupeeApply} disabled={!discountValue}>
                      Apply Discount
                    </Button>
                  </div>
                )}
                {discountType !== "none" && (
                  <label className="checkout-field">
                    <span>Reason</span>
                    <HsrInput
                      value={discountReason}
                      onChange={(event) => setDiscountReason(event.target.value)}
                      placeholder="Owner approved / service issue"
                    />
                  </label>
                )}
              </section>

              <section className="checkout-section">
                <div className="checkout-section-head">
                  <h4>Payment method</h4>
                  <span>{paymentMethod}</span>
                </div>
                <div className="checkout-payment-grid">
                  {PAYMENT_METHODS.map((method) => (
                    <HsrButton native
                      key={method.id}
                      type="button"
                      className={paymentMethod === method.id ? "is-active" : ""}
                      onClick={() => handlePaymentChange(method.id)}
                      disabled={finalizing}
                    >
                      <HsrIcon className={`ti ${method.icon}`} aria-hidden="true" />
                      <span>{method.label}</span>
                    </HsrButton>
                  ))}
                </div>
                {paymentMethod === "Split" && <div className="checkout-summary-grid">{["Cash", "UPI", "Card"].map(method => <label className="checkout-field" key={method}><span>{method} amount</span><HsrInput type="number" min={0} step={1} value={paymentSplit[method]} disabled={finalizing} onChange={event => { setPaymentSplit(current => ({ ...current, [method]: event.target.value })); setError(""); }} /></label>)}</div>}
              </section>

              <div className="checkout-actions checkout-actions-sticky">
                <Button variant="secondary" onClick={onClose} disabled={finalizing}>
                  Keep Table Open
                </Button>
                <Button variant="primary" loading={finalizing || loading} disabled={quote.checkout_blocked || !!error || (quote.pin_required && !proposal.time_override?.manager_pin)} onClick={handleFinalize}>
                  Close table · {money(finalTotal)}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
