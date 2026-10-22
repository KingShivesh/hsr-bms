import { formatCurrency as polishCurrency, formatDateTime as polishDateTime } from "../../utils/format.js";
import { Icon as HsrIcon, Button as HsrButton, Input as HsrInput } from "../../components/ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quoteSession, stopSession, previewCheckout, closeWithProposal } from "../../api/index.js";
import { Alert, Badge, Button, Drawer, Card, Panel, MetricCard, MetricValue, SkeletonBlock } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import { tariffDescription } from "../sessions/tariffs.js";
import { CustomerAtClose, AdjustSessionTime } from "./CheckoutControls.jsx";
import ContextHelp from "../../product/ContextHelp.jsx";
import { useConfirm } from "../../components/confirmContext.js";

const PAYMENT_METHODS = [
  { id: "UPI", label: "UPI", icon: "ti-qrcode" },
  { id: "Cash", label: "Cash", icon: "ti-cash" },
  { id: "Credit", label: "Credit", icon: "ti-credit-card" },
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

export default function CheckoutPanel({ table, open, onClose, onComplete, onPendingChange }) {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
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
  const [paymentReference, setPaymentReference] = useState("");
  const [proposal, setProposal] = useState({ customer: null, time_override: null });
  const proposalRef = useRef(proposal);
  const requestVersion = useRef(0);
  const quoteRef = useRef(null);
  const finalizingRef = useRef(false);
  const initialCustomerRef = useRef(null);
  const dismissPending = useRef(false);
  const [timeDraftDirty, setTimeDraftDirty] = useState(false);

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
      if (!current && res.data.can_edit_time != null) {
        proposalRef.current = { ...proposalRef.current, customer: res.data.member_id ? { member_id: res.data.member_id, recalculate_rate: false } : { name: res.data.nm || null, recalculate_rate: false } };
        setProposal(proposalRef.current);
        initialCustomerRef.current = proposalRef.current.customer;
      }
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
    setPaymentReference("");
    setTimeDraftDirty(false);
    initialCustomerRef.current = null;
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
    const previousMember = proposalRef.current.customer?.member_id;
    const next = { ...proposalRef.current, [key]: value };
    proposalRef.current = next;
    setProposal(next);
    const nextMethod = key === "customer" && !value?.member_id && paymentMethod === "Credit" ? "Cash" : paymentMethod;
    setPaymentMethod(nextMethod);
    if (key === "customer" && !previousMember && !value?.member_id) return;
    loadQuote({ nextPaymentMethod: nextMethod, nextDiscountType: discountType,
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
    if (paymentMethod === "Credit" && (!proposalRef.current.customer?.member_id || !quote.payment_methods?.includes("Credit"))) {
      setError("Link a member to charge to credit."); return;
    }
    setFinalizing(true);
    onPendingChange?.(tableId, true);
    finalizingRef.current = true;
    setError("");
    try {
      const res = quote.can_edit_time == null ? await stopSession(tableId, paymentMethod, quote.payer_name || "", discountType,
        discountType === "rupee" ? Number(discountValue) || 0 : 0, closedAtMs, discountReason.trim(), [], sessionKey, quote.checkout_token) : await closeWithProposal(tableId, {
        ...proposalRef.current, payment_method: paymentMethod, discount_type: discountType,
        discount_value: discountType === "rupee" ? Number(discountValue) || 0 : 0,
        closed_at_ms: closedAtMs, checkout_token_value: quote.checkout_token, session_key: sessionKey,
        ...(quote.payment_methods ? { payment_reference: paymentReference, expected_total: finalTotal } : {}),
      }, discountReason.trim());
      setReceipt(res.data || {});
      showToast(`${String(tableId).toUpperCase()} closed via ${paymentMethod}`, "success");
      if (res.data.time_edit && res.data.edit_count_today === res.data.edit_soft_cap) showToast(`You've edited ${res.data.edit_count_today} sessions today. Is the timer working correctly?`, "warning", { duration: 10000 });
      await onComplete?.();
    } catch (err) {
      setError(err.userMessage || err.response?.data?.detail || "Could not close table.");
    } finally {
      setFinalizing(false);
      onPendingChange?.(tableId, false);
      finalizingRef.current = false;
    }
  }

  function handleDone() {
    setReceipt(null);
    onClose?.();
  }

  async function requestDismiss() {
    if (finalizingRef.current || dismissPending.current) return;
    const customerChanged = JSON.stringify(proposalRef.current.customer) !== JSON.stringify(initialCustomerRef.current);
    const dirty = timeDraftDirty || proposalRef.current.time_override || customerChanged ||
      discountType !== "none" || discountValue || discountReason || paymentReference || paymentMethod !== "Cash";
    if (!dirty) { onClose?.(); return; }
    dismissPending.current = true;
    try {
      const discard = await requestConfirm({ title: "Discard checkout edits?", message: "Your customer, time and payment edits have not been saved. The table will stay open.", confirmLabel: "Discard edits", cancelLabel: "Keep editing", tone: "warning" });
      if (discard && !finalizingRef.current) onClose?.();
    } finally { dismissPending.current = false; }
  }

  return (
    <Drawer
      portal
      open={open}
      title={receipt ? receipt.payment_status === "credit" ? "Charged to Credit" : "Payment Complete" : `Close Session · Table ${String(tableId).replace(/^t/i, "")}`}
      description={receipt ? "Receipt is ready for staff handoff." : "Bill is frozen while payment is collected."}
      onClose={finalizing ? undefined : receipt ? handleDone : requestDismiss}
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
          <ContextHelp label="Help with checkout">Review the frozen quote before confirming. Cash and UPI record a payment; verify the transfer before confirming UPI. Credit requires a linked member and leaves the bill outstanding in their ledger. A time correction needs a reason and remains in the audit trail.</ContextHelp>
          {loading && !quote && <div className="page-skeleton compact" role="status" aria-label="Preparing frozen bill"><div className="skeleton-line skeleton-title" /><div className="skeleton-panel" /></div>}
          {loading && quote && <SkeletonBlock rows={1} label="Recalculating bill" />}
          {finalizing && <p role="status">Closing table…</p>}
          {error && <Alert tone="danger" title="Checkout needs attention">{error}
            {!quote && <Button variant="secondary" loading={loading} onClick={() => loadQuote({ nextPaymentMethod: paymentMethod, nextDiscountType: discountType, nextDiscountValue: discountValue, nextClosedAtMs: closedAtMs })}>Retry quote</Button>}
          </Alert>}
          {quote && (
            <>
              <Card tone="accent" className="checkout-total-card">
                <div>
                  <Badge tone="running" dot>{String(quote.billing_mode || "single").toUpperCase()}</Badge>
                  <MetricValue as="h3">{money(finalTotal)}</MetricValue>
                  <p>{quote.nm || `${quote.tbl || tableId.toUpperCase()} · Guest`} · {quote.tariff_mode && quote.tariff_mode !== "hourly" ? tariffDescription(quote) : `${quote.dur || 0} billable min`}</p>
                </div>
                <div className="checkout-freeze-pill">
                  <HsrIcon className="ti ti-snowflake" aria-hidden="true" />
                  Frozen {formatDateTime(quote.session_ended_at || closedAtMs)}
                </div>
              </Card>

              {quote.checkout_blocked && <Alert tone="warning">Close the open frame before checkout.</Alert>}
              {quote.time_edit && <Alert tone="warning" title="Duration adjusted">{quote.dur} min (adjusted from {quote.time_edit.original_duration} min) · {quote.time_edit.reason_label} · {quote.time_edit.staff}</Alert>}
              {Number.isFinite(quote.rate_delta) && quote.rate_delta !== 0 && <Alert tone="info">Member rate {money(quote.original_rate)}/hr → {money(quote.rate)}/hr · Bill change {money(quote.rate_delta)}</Alert>}
              <div className="checkout-summary-grid">
                <MetricCard variant="compact" label="Table" value={money(quote.ply)} />
                <MetricCard variant="compact" label="Food" value={money(quote.famt)} />
                <MetricCard variant="compact" label="Before discount" value={money(rawTotal)} />
                <MetricCard variant="compact" label="Discount" value={money(discountAmount)} />
              </div>

              {quote.can_edit_time && <AdjustSessionTime quote={quote} value={proposal.time_override} onDirtyChange={setTimeDraftDirty} onChange={value => updateProposal("time_override", value)} disabled={finalizing || loading} />}
              {quote.can_edit_time != null && <CustomerAtClose value={proposal.customer} onDraftChange={value => { proposalRef.current = { ...proposalRef.current, customer: value }; setProposal(proposalRef.current); }} onChange={value => updateProposal("customer", value)} disabled={finalizing} />}

              {!!splitRows.length && (
                <Panel className="checkout-section">
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
                </Panel>
              )}

              <Panel className="checkout-section">
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
                      aria-pressed={discountType === option.id}
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
                      aria-label="Discount amount in rupees"
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
              </Panel>

              <Panel className="checkout-section">
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
                      aria-pressed={paymentMethod === method.id}
                      title={method.id === "Credit" && !proposal.customer?.member_id ? "Link a member to charge to credit." : method.id === "Credit" && !quote.payment_methods?.includes("Credit") ? "Credit is not available yet." : method.label}
                      onClick={() => handlePaymentChange(method.id)}
                      disabled={finalizing || (method.id === "Credit" && (!proposal.customer?.member_id || !quote.payment_methods?.includes("Credit")))}
                    >
                      <HsrIcon className={`ti ${method.icon}`} aria-hidden="true" />
                      <span>{method.label}</span>
                    </HsrButton>
                  ))}
                </div>
                {paymentMethod === "UPI" && <div className="checkout-upi">
                  {quote.upi_id ? <p>Club UPI ID <strong>{quote.upi_id}</strong></p> : <p>Collect payment using the club's counter QR.</p>}
                  {quote.payment_methods && <label className="checkout-field"><span>UPI reference (optional)</span><HsrInput maxLength={120} value={paymentReference} disabled={finalizing} onChange={event => setPaymentReference(event.target.value)} /></label>}
                </div>}
                {paymentMethod === "Credit" && <p>Charge {money(finalTotal)} to {quote.nm || "the linked member"}. Payment remains outstanding.</p>}
              </Panel>

              <div className="checkout-actions checkout-actions-sticky">
                <Button variant="ghost" onClick={requestDismiss} disabled={finalizing}>
                  Cancel
                </Button>
                <Button variant="primary" loading={finalizing || loading} disabled={quote.checkout_blocked || !!error || (quote.pin_required && !proposal.time_override?.manager_pin)} onClick={handleFinalize}>
                  Confirm &amp; Close · {money(finalTotal)}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
