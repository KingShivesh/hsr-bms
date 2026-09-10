import { useEffect, useRef, useState } from "react";
import TableStatusBadge from "./TableStatusBadge.jsx";

function formatTimer(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function bookingTime(booking) {
  if (!booking?.booking_time) return "";
  const parsed = new Date(booking.booking_time);
  if (Number.isNaN(parsed.getTime())) return booking.booking_time;
  return parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function pairedRateNote(tableId) {
  const normalized = String(tableId || "").toLowerCase();
  if (normalized === "t1") return "Also updates T2";
  if (normalized === "t2") return "Also updates T1";
  if (normalized === "t3") return "Also updates T4";
  if (normalized === "t4") return "Also updates T3";
  if (normalized === "t5") return "Pool table rate";
  return "Updates this rate group";
}

export default function TableCard({
  table,
  selected,
  tick = 0,
  onSelect,
  onStart,
  onSaveRate,
  onInvalidRate,
}) {
  const statusKey = table.status_key || "available";
  const session = table.session;
  const elapsed = session && !session.paused ? (session.elapsed_seconds || 0) + tick : table.elapsed_seconds || 0;
  const isAvailable = statusKey === "available";
  const customer = session?.customer_name || table.booking?.customer_name || "";
  const actionLabel = isAvailable ? "Start Table" : statusKey === "reserved" ? "Review Booking" : "Open Session";
  const runningTotal = Number(session?.running_total || table.running_total || 0);
  const foodTotal = Number(session?.food_total || 0);
  const shownRate = Number(table.rate || 0);
  const canEditRate = !session && statusKey !== "reserved" && typeof onSaveRate === "function";
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
    if (isAvailable) onStart?.(table.id);
    else onSelect?.(table);
  }

  return (
    <article
      className={`lf-table-card ${selected ? "is-selected" : ""} is-${statusKey}`}
      onClick={() => onSelect?.(table)}
      tabIndex={0}
      role="button"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(table);
        }
      }}
      aria-label={`${table.label || table.id} ${table.status_label || statusKey}`}
    >
      <div className="lf-table-card-head">
        <div>
          <span className="lf-table-kicker">{table.type || table.label || "Table"}</span>
          <strong>{String(table.id || "").toUpperCase()}</strong>
        </div>
        <TableStatusBadge statusKey={statusKey} label={table.status_label} />
      </div>

      <div className="lf-table-card-body">
        <div>
          <span>{session ? "Customer" : statusKey === "reserved" ? "Booking time" : "Availability"}</span>
          <b title={statusKey === "reserved" ? bookingTime(table.booking) : customer || "Walk-in ready"}>
            {statusKey === "reserved" ? bookingTime(table.booking) : customer || "Walk-in ready"}
          </b>
        </div>
        <div>
          <span>{session ? "Live timer" : statusKey === "reserved" ? "Guest" : "Rate"}</span>
          {rateEditing ? (
            <div className="lf-rate-editor" onClick={(event) => event.stopPropagation()}>
              <label>
                <span className="sr-only">Hourly rate for {String(table.id || "").toUpperCase()}</span>
                <input
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
            <button
              type="button"
              className="lf-inline-rate"
              onClick={beginRateEdit}
              title={`Edit ₹${shownRate}/hr`}
            >
              ₹{shownRate}/hr
            </button>
          ) : (
            <b title={session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${shownRate}/hr`}>
              {session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${shownRate}/hr`}
            </b>
          )}
        </div>
      </div>

      {session && (
        <div className="lf-table-money">
          <div>
            <span>Running total</span>
            <strong>₹{runningTotal.toLocaleString("en-IN")}</strong>
          </div>
          <small>Food ₹{foodTotal.toLocaleString("en-IN")}</small>
        </div>
      )}

      {!session && isAvailable && (
        <div className="lf-table-ready">
          <i className="ti ti-circle-check" aria-hidden="true" />
          <span>Ready for next session</span>
        </div>
      )}

      {statusKey === "maintenance" && (
        <p className="lf-table-note">{table.maintenance?.reason || "Maintenance active"}</p>
      )}

      <button type="button" className={isAvailable ? "lf-card-primary" : "lf-card-secondary"} onClick={handleAction}>
        <i className={`ti ${isAvailable ? "ti-player-play" : "ti-layout-sidebar-right-expand"}`} aria-hidden="true" />
        {actionLabel}
      </button>
    </article>
  );
}
