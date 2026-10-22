import { Card as HsrCard } from "../../components/ui/index.js";
import { formatDuration as polishDuration } from "../../utils/format.js";
import { Input as HsrInput, Button as HsrButton, Icon as HsrIcon } from "../../components/ui/index.js";
import { memo, useEffect, useRef, useState } from "react";
import { TableAttentionBadge } from "../../components/TableStateUI.jsx";
import { tableStateAttributes, getTableAttention, getTableStatusByKey } from "../../config/tableStatus.js";
import TableStatusBadge from "./TableStatusBadge.jsx";
import { tariffDescription } from "../sessions/tariffs.js";
import SessionIdentity from "../sessions/SessionIdentity.jsx";
import { useSessionAlerts } from "../sessions/alertsContext.js";

function formatTimer(seconds = 0) { return polishDuration(seconds); }

function bookingTime(booking) {
  if (!booking?.booking_time) return "";
  const parsed = new Date(booking.booking_time);
  if (Number.isNaN(parsed.getTime())) return booking.booking_time;
  return parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default memo(TableCard);

function pairedRateNote(tableId) {
  const normalized = String(tableId || "").toLowerCase();
  if (normalized === "t1") return "Also updates T2";
  if (normalized === "t2") return "Also updates T1";
  if (normalized === "t3") return "Also updates T4";
  if (normalized === "t4") return "Also updates T3";
  if (normalized === "t5") return "Pool table rate";
  return "Updates this rate group";
}

function TableCard({
  table,
  selected,
  tick = 0,
  onSelect,
  onStart,
  onCheckout,
  onPause,
  onFood,
  onOrders,
  busy = false,
  onReviewBooking,
  onSaveRate,
  onInvalidRate,
}) {
  const statusKey = table.status_key || "available";
  const status = getTableStatusByKey(statusKey);
  const session = table.session;
  const { alerts, acknowledge, urgentKeys } = useSessionAlerts();
  const reminder = alerts.filter(row => row.session_key === session?.session_key).at(-1);
  const elapsed = session && !session.paused ? (session.elapsed_seconds || 0) + tick : table.elapsed_seconds || 0;
  const isAvailable = statusKey === "available";
  const isMaintenance = statusKey === "maintenance";
  const customer = session ? session.customer_name || "Guest" : table.booking?.customer_name || "";
  const runningTotal = Number(session?.running_total || table.running_total || 0);
  const foodTotal = Number(session?.food_total || 0);
  const foodItems = session?.food_items || [];
  const groupedItems = Array.from(foodItems.reduce((items, row) => {
    items.set(row.item, { name: row.item, quantity: (items.get(row.item)?.quantity || 0) + row.qty });
    return items;
  }, new Map()).values());
  const pendingItems = foodItems.filter(row => !row.served).length;
  const foodSummary = groupedItems.slice(0, 3).map(row => `${row.quantity}× ${row.name}`).join(" · ") + (groupedItems.length > 3 ? ` · +${groupedItems.length - 3} more` : "");
  const shownRate = Number(table.rate || 0);
  const canEditRate = isAvailable && typeof onSaveRate === "function";
  const attention = getTableAttention({ session, elapsedSeconds: elapsed });
  const [rateEditing, setRateEditing] = useState(false);
  const [rateDraft, setRateDraft] = useState(String(shownRate || ""));
  const [rateError, setRateError] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const skipNextBlur = useRef(false);

  useEffect(() => {
    if (!rateEditing) setRateDraft(String(shownRate || ""));
  }, [rateEditing, shownRate]);

  function beginRateEdit(event) {
    if (!canEditRate) return;
    event.stopPropagation();
    setRateDraft(String(shownRate || ""));
    setRateError("");
    setRateEditing(true);
  }

  function cancelRateEdit() {
    skipNextBlur.current = true;
    setRateDraft(String(shownRate || ""));
    setRateError("");
    setRateEditing(false);
  }

  async function commitRateEdit() {
    const trimmed = String(rateDraft || "").trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 5000) {
      skipNextBlur.current = false;
      const message = "Enter a whole number from 1 to 5000.";
      setRateError(message);
      onInvalidRate?.(message);
      return;
    }
    if (parsed === shownRate) {
      skipNextBlur.current = true;
      setRateEditing(false);
      setRateError("");
      return;
    }

    setRateSaving(true);
    setRateError("");
    const result = await onSaveRate(table, parsed);
    setRateSaving(false);
    if (result?.ok) {
      skipNextBlur.current = true;
      setRateEditing(false);
    } else {
      skipNextBlur.current = true;
      setRateDraft(String(shownRate || ""));
      setRateEditing(false);
    }
  }

  function handleAction(event) {
    event.stopPropagation();
    if (isMaintenance) return;
    if (isAvailable) return onStart?.(table.id);
    if (statusKey === "running" || statusKey === "paused") return onCheckout?.(table);
    if (statusKey === "reserved") return onReviewBooking?.(table);
    return onSelect?.(table);
  }

  return (
    <HsrCard as="article"
      className={`lf-table-card table-state-card ${selected ? "is-selected" : ""}`}
      {...tableStateAttributes(status.key)}
      data-attention={attention ? "true" : "false"}
      data-overtime-pulse={urgentKeys.has(session?.session_key) ? "true" : undefined}
      onClick={() => !isMaintenance && !busy && onSelect?.(table)}
      tabIndex={isMaintenance ? -1 : 0}
      role="group"
      aria-disabled={isMaintenance}
      onKeyDown={(event) => {
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest("input,textarea,select,[contenteditable=true]")) {
          const key = event.key.toLowerCase();
          const shortcut = key === "e" ? "end" : key === "o" ? "food" : key === "p" && !session?.paused ? "pause" : key === "r" && session?.paused ? "pause" : "";
          const action = shortcut ? event.currentTarget.querySelector(`[data-session-shortcut="${shortcut}"]:not(:disabled)`) : null;
          if (action) { event.preventDefault(); event.stopPropagation(); action.click(); return; }
        }
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!isMaintenance && !busy) onSelect?.(table);
        }
      }}
      aria-label={`${table.label || table.id} ${table.status_label || statusKey}`}
      aria-busy={busy || rateSaving}
    >
      <div className="lf-table-card-head">
        <div>
          <span className="lf-table-kicker">{table.type || table.label || "Table"}</span>
          <strong>{String(table.id || "").toUpperCase()}</strong>
        </div>
        <div className="table-state-card-flags">
          <TableAttentionBadge attention={attention} />
          {reminder && <HsrButton native type="button" className="session-reminder-badge" onClick={event => { event.stopPropagation(); acknowledge(reminder.id); }}>{reminder.intensity === "urgent" ? "Overtime" : `${reminder.threshold_minutes}m check-in`}</HsrButton>}
          <TableStatusBadge statusKey={statusKey} label={table.status_label} />
        </div>
      </div>

      <div className="lf-table-card-body">
        {table.pending_label && <p className="session-pending-note" role="status">{table.pending_label}</p>}
        <div>
          <span>{session ? "Customer" : statusKey === "reserved" ? "Booking time" : "Availability"}</span>
          <b title={statusKey === "reserved" ? bookingTime(table.booking) : customer || "Walk-in ready"}>
            {session ? <SessionIdentity session={session} /> : statusKey === "reserved" ? bookingTime(table.booking) : isMaintenance ? "Unavailable" : customer || "Walk-in ready"}
          </b>
        </div>
        <div>
          <span>{session ? (statusKey === "paused" ? "Frozen timer" : "Elapsed") : statusKey === "reserved" ? "Guest" : "Rate"}</span>
          {rateEditing ? (
            <div className="lf-rate-editor" onClick={(event) => event.stopPropagation()}>
              <label>
                <span className="sr-only">Hourly rate for {String(table.id || "").toUpperCase()}</span>
                <HsrInput
                  type="text"
                  inputMode="numeric"
                  value={rateDraft}
                  autoFocus
                  disabled={rateSaving}
                  onChange={(event) => {
                    setRateDraft(event.target.value);
                    if (rateError) setRateError("");
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      skipNextBlur.current = true;
                      commitRateEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRateEdit();
                    }
                  }}
                  onBlur={() => {
                    if (skipNextBlur.current) {
                      skipNextBlur.current = false;
                      return;
                    }
                    commitRateEdit();
                  }}
                  aria-invalid={rateError ? "true" : "false"}
                />
              </label>
              <small>{rateSaving ? "Saving..." : pairedRateNote(table.id)}</small>
              {rateError && <em>{rateError}</em>}
            </div>
          ) : canEditRate ? (
            <HsrButton variant="ghost"
              type="button"
              className="lf-inline-rate table-state-edit-action"
              onClick={beginRateEdit}
              title={`Edit ₹${shownRate}/hr`}
            >
              <HsrIcon name="pencil" />
              ₹{shownRate}/hr
            </HsrButton>
          ) : (
            <b className={session ? "table-state-timer" : ""} data-timer={status.timerStyle} title={session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${shownRate}/hr`}>
              {session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${shownRate}/hr`}
            </b>
          )}
        </div>
      </div>

      {session && (
        <div className="lf-table-money">
          <div className="session-charge-lines">
            <div><span>Table</span><b>₹{(Number(session.play_estimate || 0) + Number(session.peak_estimate || 0)).toLocaleString("en-IN")}</b></div>
            {!!foodTotal && <div><span>Canteen</span><b>₹{foodTotal.toLocaleString("en-IN")}</b></div>}
            {!!session.tax_estimate && <div><span>Tax</span><b>₹{Number(session.tax_estimate).toLocaleString("en-IN")}</b></div>}
          </div>
          <div>
            <span>Running total</span>
            <strong>₹{runningTotal.toLocaleString("en-IN")}</strong>
          </div>
          <small>{tariffDescription(session)}</small>
          <HsrButton native type="button" disabled={!!session.pending} className="session-canteen-summary" aria-label={`Canteen orders for ${String(table.id).toUpperCase()}`} onClick={event => { event.stopPropagation(); onOrders?.(table); }}>
            <span>{pendingItems > 0 && <span className="session-order-dot" aria-hidden="true" />}{foodSummary || "No canteen orders"}</span>
            {!!foodItems.length && <small>{pendingItems ? `${pendingItems} pending` : "All served"} · ₹{foodTotal.toLocaleString("en-IN")}</small>}
          </HsrButton>
        </div>
      )}

      {!session && isAvailable && (
        <div className="lf-table-ready">
          <HsrIcon className="ti ti-circle-check" aria-hidden="true" />
          <span>Ready for next session</span>
        </div>
      )}

      {statusKey === "maintenance" && (
        <p className="lf-table-note">{table.maintenance?.reason || "Maintenance active"}</p>
      )}

      <div className="lf-card-actions" onClick={(event) => event.stopPropagation()}>
        {session ? (
          <>
            <HsrButton native type="button" data-session-shortcut="pause" data-variant={session.paused ? "primary" : "secondary"} disabled={busy} onClick={() => onPause?.(table)}>
              <HsrIcon className={`ti ${session.paused ? "ti-player-play" : "ti-player-pause"}`} aria-hidden="true" />
              {busy ? "Working..." : session.paused ? "Resume" : "Pause"}
            </HsrButton>
            <HsrButton native type="button" data-session-shortcut="food" disabled={busy} onClick={() => onFood?.(table)}>
              <HsrIcon className="ti ti-tools-kitchen-2" aria-hidden="true" /> Food
            </HsrButton>
            <HsrButton native type="button" data-session-shortcut="end" data-variant="danger" disabled={busy} onClick={handleAction}>
              <HsrIcon className="ti ti-receipt" aria-hidden="true" /> End
            </HsrButton>
          </>
        ) : (
          <HsrButton native type="button" data-variant="primary" disabled={isMaintenance || busy} onClick={handleAction}>
            <HsrIcon className={`ti ${isAvailable ? "ti-player-play" : statusKey === "reserved" ? "ti-calendar-check" : "ti-lock"}`} aria-hidden="true" />
            {isAvailable ? "Start Session" : statusKey === "reserved" ? "Check In" : "Unavailable"}
          </HsrButton>
        )}
      </div>
    </HsrCard>
  );
}
