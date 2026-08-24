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

export default function TableCard({ table, selected, tick = 0, onSelect, onStart }) {
  const statusKey = table.status_key || "available";
  const session = table.session;
  const elapsed = session && !session.paused ? (session.elapsed_seconds || 0) + tick : table.elapsed_seconds || 0;
  const isAvailable = statusKey === "available";
  const customer = session?.customer_name || table.booking?.customer_name || "";
  const actionLabel = isAvailable ? "Start" : statusKey === "reserved" ? "Review" : "Open session";
  const runningTotal = Number(session?.running_total || table.running_total || 0);
  const foodTotal = Number(session?.food_total || 0);

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
          <b title={session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${table.rate || 0}/hr`}>
            {session ? formatTimer(elapsed) : statusKey === "reserved" ? customer || "Reserved guest" : `₹${table.rate || 0}/hr`}
          </b>
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
