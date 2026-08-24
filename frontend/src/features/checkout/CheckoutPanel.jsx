import { useEffect, useMemo, useState } from "react";
import { quoteSession, stopSession } from "../../api/index.js";
import { Alert, Badge, Button, Drawer } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";

const PAYMENT_METHODS = [
  { id: "Cash", label: "Cash", icon: "ti-cash" },
  { id: "UPI", label: "UPI", icon: "ti-qrcode" },
  { id: "Card", label: "Card", icon: "ti-credit-card" },
];

const DISCOUNT_OPTIONS = [
  { id: "none", label: "No discount" },
  { id: "percent_5", label: "5%" },
  { id: "percent_10", label: "10%" },
  { id: "rupee", label: "₹ off" },
];

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function sanitizeRupeeDiscount(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(parseInt(digits, 10), 50));
}

function formatDateTime(ms) {
  if (!ms) return "-";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

  const tableId = table?.id || "";
  const sessionKey = quote?.session_key || table?.session?.session_key || "";
  const discountAmount = Number(quote?.discount_amount || 0);
  const finalTotal = Number(quote?.tot ?? quote?.total ?? 0);
  const rawTotal = Number(quote?.raw_total ?? finalTotal);
  const splitRows = useMemo(() => splitSummary(quote), [quote]);

  useEffect(() => {
    if (!open || !tableId) return;
    setPaymentMethod("Cash");
    setDiscountType("none");
    setDiscountValue("");
    setDiscountReason("");
    setReceipt(null);
    setError("");
    const frozenAt = Date.now();
    setClosedAtMs(frozenAt);
    loadQuote({
      nextPaymentMethod: "Cash",
      nextDiscountType: "none",
      nextDiscountValue: 0,
      nextClosedAtMs: frozenAt,
    });
  }, [open, tableId]);

  async function loadQuote({
    nextPaymentMethod = paymentMethod,
    nextDiscountType = discountType,
    nextDiscountValue = discountValue,
    nextClosedAtMs = closedAtMs,
  } = {}) {
    if (!tableId) return;
    setLoading(true);
    setError("");
    try {
      const res = await quoteSession(
        tableId,
        nextPaymentMethod,
        nextDiscountType,
        nextDiscountType === "rupee" ? parseInt(sanitizeRupeeDiscount(nextDiscountValue), 10) || 0 : 0,
        nextClosedAtMs,
      );
      setQuote(res.data || {});
    } catch (err) {
      setError(err.userMessage || err.response?.data?.detail || "Could not prepare checkout.");
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentChange(method) {
    setPaymentMethod(method);
    loadQuote({ nextPaymentMethod: method });
  }

  function handleDiscountType(nextType) {
    const nextValue = nextType === "rupee" ? discountValue : "";
    setDiscountType(nextType);
    if (nextType === "none") setDiscountReason("");
    setDiscountValue(nextValue);
    loadQuote({ nextDiscountType: nextType, nextDiscountValue: nextValue });
  }

  function handleRupeeApply() {
    const nextValue = sanitizeRupeeDiscount(discountValue);
    setDiscountValue(nextValue);
    loadQuote({ nextDiscountType: "rupee", nextDiscountValue: nextValue });
  }

  async function handleFinalize() {
    if (!quote) return;
    if (discountAmount > 0 && !discountReason.trim()) {
      setError("Enter a reason for the discount before closing.");
      return;
    }
    setFinalizing(true);
    setError("");
    try {
      const res = await stopSession(
        tableId,
        paymentMethod,
        quote.payer_name || "",
        discountType,
        discountType === "rupee" ? parseInt(sanitizeRupeeDiscount(discountValue), 10) || 0 : 0,
        closedAtMs,
        discountReason.trim(),
        [],
        sessionKey,
      );
      setReceipt(res.data || {});
      showToast(`${String(tableId).toUpperCase()} closed via ${paymentMethod}`, "success");
      await onComplete?.();
    } catch (err) {
      setError(err.userMessage || err.response?.data?.detail || "Could not close table.");
    } finally {
      setFinalizing(false);
    }
  }

  function handleDone() {
    setReceipt(null);
    onClose?.();
  }

  return (
    <Drawer
      open={open}
      title={receipt ? "Payment Complete" : `Checkout ${String(tableId).toUpperCase()}`}
      description={receipt ? "Receipt is ready for staff handoff." : "Bill is frozen while payment is collected."}
      onClose={receipt ? handleDone : onClose}
      className="checkout-panel"
    >
      {receipt ? (
        <div className="checkout-success">
          <div className="checkout-success-mark">
            <i className="ti ti-circle-check" aria-hidden="true" />
          </div>
          <div>
            <span className="lf-eyebrow">Receipt</span>
            <h3>{receipt.tbl || String(tableId).toUpperCase()} · {money(receipt.tot)}</h3>
            <p>{receipt.payment_method || paymentMethod} · {receipt.dur || 0} min · {receipt.nm || "Customer"}</p>
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
          <div className="checkout-actions">
            <Button variant="secondary" icon="ti-printer" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="primary" onClick={handleDone}>
              Done
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
                  <p>{quote.nm || "Customer"} · {quote.dur || 0} billable min</p>
                </div>
                <div className="checkout-freeze-pill">
                  <i className="ti ti-snowflake" aria-hidden="true" />
                  Frozen {formatDateTime(quote.session_ended_at || closedAtMs)}
                </div>
              </div>

              <div className="checkout-summary-grid">
                <div><span>Table</span><strong>{money(quote.ply)}</strong></div>
                <div><span>Food</span><strong>{money(quote.famt)}</strong></div>
                <div><span>Before discount</span><strong>{money(rawTotal)}</strong></div>
                <div><span>Discount</span><strong>{money(discountAmount)}</strong></div>
              </div>

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
                    <button
                      key={option.id}
                      type="button"
                      className={discountType === option.id ? "is-active" : ""}
                      onClick={() => handleDiscountType(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {discountType === "rupee" && (
                  <div className="checkout-inline-form">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={discountValue}
                      onChange={(event) => setDiscountValue(sanitizeRupeeDiscount(event.target.value))}
                      placeholder="Max ₹50"
                    />
                    <Button variant="secondary" loading={loading} onClick={handleRupeeApply} disabled={!discountValue}>
                      Apply
                    </Button>
                  </div>
                )}
                {discountType !== "none" && (
                  <label className="checkout-field">
                    <span>Reason</span>
                    <input
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
                    <button
                      key={method.id}
                      type="button"
                      className={paymentMethod === method.id ? "is-active" : ""}
                      onClick={() => handlePaymentChange(method.id)}
                    >
                      <i className={`ti ${method.icon}`} aria-hidden="true" />
                      <span>{method.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <div className="checkout-actions checkout-actions-sticky">
                <Button variant="secondary" onClick={onClose} disabled={finalizing}>
                  Keep open
                </Button>
                <Button variant="primary" loading={finalizing || loading} onClick={handleFinalize}>
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
