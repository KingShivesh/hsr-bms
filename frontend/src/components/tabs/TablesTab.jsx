import { useState, useEffect, useRef, useMemo } from "react";
import {
  startSession,
  pauseSession,
  stopSession,
  quoteSession,
  resetSession,
  getTableState,
  getRates,
  updateNotes,
  getTableHistory,
  getTableAudit,
  getMaintenance,
  setMaintenance as saveMaintenance,
  clearMaintenance,
  getCurrentRate,
  getGST,
  getWaitlist,
  addWaitlistEntry,
  seatWaitlistEntry,
  cancelWaitlistEntry,
  getBookings,
  createBooking,
  cancelBooking,
  startFrame,
  closeFrame,
  transferSession,
} from "../../api/index.js";
import { searchMembers } from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { HSR_TABLES, getTableLabel, getTableRate } from "../../config/hsrTables.js";
import { getTableStatus } from "../../config/tableStatus.js";

const TABLES = HSR_TABLES;
const tableKey = (tableId) => String(tableId || "").trim().toLowerCase();

const THEME = {
  POOL: {
    felt: "var(--accent)",
    feltDark: "var(--accent-hover)",
    cushion: "var(--success)",
    rail: "var(--venue-rail)",
    accent: "var(--accent)",
  },
  SNOOKER: {
    felt: "var(--accent)",
    feltDark: "var(--accent-hover)",
    cushion: "var(--success)",
    rail: "var(--venue-rail)",
    accent: "var(--accent)",
  },
};

function fmt(secs) {
  if (!secs) return "00:00";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function fmtClock(ms) {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(ms) {
  if (!ms) return "--";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isFullName(name) {
  return name.trim().length > 0;
}

const BILLING_MODES = [
  { id: "single", label: "Single", hint: "One payer" },
  { id: "sharing", label: "Sharing", hint: "Split payment" },
  { id: "lp", label: "LP", hint: "Loser pays" },
];
const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Split"];
const DISCOUNT_OPTIONS = [
  { id: "none", label: "No discount" },
  { id: "percent_5", label: "5%" },
  { id: "percent_10", label: "10%" },
  { id: "rupee", label: "₹ off" },
];

function sanitizeRupeeDiscount(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(parseInt(digits, 10), 50));
}

function defaultBillingModeForTable(table) {
  return table?.type === "POOL" ? "single" : "lp";
}

function splitPlayerNames(value) {
  return (value || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function defaultPlayersForMode(billingMode) {
  if (billingMode === "single") return ["Walk In Customer"];
  return ["Player One", "Player Two"];
}

const GENERIC_PLAYER_NAMES = new Set([
  "player one",
  "player two",
  "walk in customer",
]);

function isGenericPlayerName(name) {
  return GENERIC_PLAYER_NAMES.has((name || "").trim().toLowerCase());
}

function visiblePlayerNames(players = []) {
  return players.filter((name) => name && !isGenericPlayerName(name));
}

function buildPlayers(primaryName, extraNames, billingMode) {
  const defaults = defaultPlayersForMode(billingMode);
  const primary = (primaryName || "").trim() || defaults[0];
  const extras = splitPlayerNames(extraNames);
  const players = billingMode === "single"
    ? [primary]
    : [primary, ...(extras.length ? extras : defaults.slice(1))];
  const seen = new Set();
  return players.filter((name) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateBillingPlayers(players, billingMode) {
  if (!players[0]) return "Please enter the customer name.";
  const invalid = players.find((name) => !isFullName(name));
  if (invalid) return `Please enter a name for "${invalid}".`;
  if (billingMode !== "single" && players.length < 2) {
    return "Please enter at least two players for Sharing or LP.";
  }
  return "";
}

function billingModeLabel(mode) {
  if (mode === "sharing") return "Sharing";
  if (mode === "lp") return "LP";
  return "Single";
}

function formatLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function bookingDateTimeFromClock(clockValue) {
  const [hours, minutes] = String(clockValue || "").split(":").map(Number);
  const date = new Date();
  date.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (date < new Date(Date.now() - 5 * 60 * 1000)) {
    date.setDate(date.getDate() + 1);
  }
  return formatLocalDateTimeInput(date);
}

function bookingDisplayTime(booking) {
  if (!booking?.booking_time) return "";
  return new Date(booking.booking_time).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function runningTotalForSession(session, peakRate, gstPercent) {
  if (!session) return 0;
  const mins = Math.max(1, Math.round(session.elapsed / 60));
  const basePlay = Math.round((mins / 60) * session.rate);
  const play = Math.round(basePlay * (peakRate?.multiplier || 1));
  const subtotal = play + (session.foodTotal || 0);
  const gstAmt =
    gstPercent > 0 && subtotal > 0 ? Math.round((subtotal * gstPercent) / 100) : 0;
  return subtotal + gstAmt;
}

function CustomerInput({ value, onChange, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setShow(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await searchMembers(value);
        setSuggestions(res.data);
        setShow(res.data.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="table-player-field">
      <i className="ti ti-user table-player-icon" aria-hidden="true" />
      <input
        placeholder={placeholder || undefined}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        onFocus={() => suggestions.length && setShow(true)}
        autoComplete="off"
        className="table-player-input"
        style={{ margin: 0 }}
      />
      {show && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 300,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            marginTop: "3px",
            boxShadow: "var(--shadow-md)",
            overflow: "hidden",
          }}
        >
          {suggestions.map((m, i) => (
            <div
              key={i}
              onMouseDown={() => {
                onChange(m.nm);
                setShow(false);
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: "var(--text-sm)",
                borderBottom:
                  i < suggestions.length - 1 ? "1px solid var(--border)" : "none",
                background: "var(--surface)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--surface-muted)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
            >
              <span style={{ color: "var(--text-primary)", fontWeight: "var(--weight-medium)" }}>{m.nm}</span>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--accent-text)",
                  background: "var(--accent-bg)",
                  border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {m.id}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueuePanel({
  queue,
  onAdd,
  onSeat,
  onCancel,
  activeCount,
  busyActions = {},
  showToast,
}) {
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [preferredType, setPreferredType] = useState("ANY");
  const [notes, setNotes] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!isFullName(customerName)) {
      showToast?.("Please enter the customer name.", "error");
      return;
    }
    const success = await onAdd({
      customer_name: customerName,
      phone,
      party_size: Number(partySize) || 1,
      preferred_type: preferredType,
      notes,
    });
    if (!success) return;
    setCustomerName("");
    setPhone("");
    setPartySize(1);
    setPreferredType("ANY");
    setNotes("");
  }

  return (
    <div className="queue-panel">
      <div className="queue-head">
        <div>
          <div className="queue-title">Smart table queue</div>
          <div className="queue-sub">
            {queue.length} waiting · {TABLES.length - activeCount} table{TABLES.length - activeCount === 1 ? "" : "s"} idle
          </div>
        </div>
        <i className="ti ti-list-check" aria-hidden="true" />
      </div>

      <form className="queue-form" onSubmit={submit}>
        <input
          className="table-mini-input"
          placeholder="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
        <input
          className="table-mini-input"
          placeholder="Phone optional"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className="table-mini-input"
          type="number"
          min="1"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          aria-label="Party size"
        />
        <select
          className="table-mini-input"
          value={preferredType}
          onChange={(e) => setPreferredType(e.target.value)}
        >
          <option value="ANY">Any table</option>
          <option value="POOL">Pool</option>
          <option value="SNOOKER">Snooker</option>
        </select>
        <input
          className="table-mini-input queue-notes-input"
          placeholder="Notes optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="primary-action-btn" type="submit" disabled={!!busyActions["queue-add"]}>
          {busyActions["queue-add"] ? "Adding..." : "Add to queue"}
        </button>
      </form>

      <div className="queue-list">
        {queue.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-icon">
              <i className="ti ti-users-plus" aria-hidden="true" />
            </div>
            <div className="empty-state-title">No one waiting</div>
            <div className="empty-state-detail">
              Add walk-ins here when all preferred tables are busy.
            </div>
          </div>
        ) : (
          queue.map((entry) => {
            const table = entry.recommended_table;
            return (
              <div key={entry.id} className="queue-row">
                <div className="queue-position">#{entry.position}</div>
                <div className="queue-main">
                  <div className="queue-name">{entry.customer_name}</div>
                  <div className="queue-meta">
                    {entry.preferred_type === "ANY" ? "Any table" : entry.preferred_type} · {entry.party_size} player{entry.party_size === 1 ? "" : "s"} · {entry.wait_mins}m
                  </div>
                  {entry.notes && <div className="queue-note">{entry.notes}</div>}
                </div>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="queue-seat-btn"
                    disabled={!table || !!busyActions[`seat-queue:${entry.id}`]}
                    onClick={() => table && onSeat(entry, table.id)}
                  >
                    {busyActions[`seat-queue:${entry.id}`] ? "Seating..." : table ? `Seat T${table.num}` : "Waiting"}
                  </button>
                  <button
                    type="button"
                    className="icon-danger-btn"
                    onClick={() => onCancel(entry.id)}
                    disabled={!!busyActions[`cancel-queue:${entry.id}`]}
                    aria-label={`Remove ${entry.customer_name} from queue`}
                  >
                    {busyActions[`cancel-queue:${entry.id}`] ? "..." : "×"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function BookingPanel({ bookings, onCreate, onCancel, busyActions = {}, showToast }) {
  const defaultTime = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (value) => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [tableId, setTableId] = useState("ANY");
  const [bookingTime, setBookingTime] = useState(defaultTime);
  const [durationMins, setDurationMins] = useState(60);
  const [notes, setNotes] = useState("");
  const activeBookings = bookings.filter(
    (booking) => booking.status !== "missed",
  );
  const missedBookings = bookings.filter(
    (booking) => booking.status === "missed",
  );

  async function submit(e) {
    e.preventDefault();
    if (!isFullName(customerName)) {
      showToast?.("Please enter the customer name.", "error");
      return;
    }
    const selected = TABLES.find((t) => t.id.toUpperCase() === tableId);
    const success = await onCreate({
      customer_name: customerName,
      phone,
      table_id: tableId,
      table_type: selected?.type || "ANY",
      booking_time: bookingTime,
      duration_mins: Number(durationMins) || 60,
      notes,
    });
    if (!success) return;
    setCustomerName("");
    setPhone("");
    setTableId("ANY");
    setBookingTime(defaultTime());
    setDurationMins(60);
    setNotes("");
  }

  return (
    <div className="booking-panel">
      <div className="queue-head">
        <div>
          <div className="queue-title">Booking calendar</div>
          <div className="queue-sub">
            {activeBookings.length} active · {missedBookings.length} missed
          </div>
        </div>
        <i className="ti ti-calendar" aria-hidden="true" />
      </div>
      <div className="booking-grace-note">
        <i className="ti ti-clock-exclamation" aria-hidden="true" />
        <span>
          No-shows are auto-released after the grace period.
        </span>
      </div>
      <form className="booking-form" onSubmit={submit}>
        <input
          className="table-mini-input"
          placeholder="Full customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
        <input
          className="table-mini-input"
          placeholder="Phone optional"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <select
          className="table-mini-input"
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
        >
          <option value="ANY">Any table</option>
          {TABLES.map((t) => (
            <option key={t.id} value={t.id.toUpperCase()}>
              T{t.num} · {t.type}
            </option>
          ))}
        </select>
        <input
          className="table-mini-input"
          type="datetime-local"
          value={bookingTime}
          onChange={(e) => setBookingTime(e.target.value)}
          required
        />
        <input
          className="table-mini-input"
          type="number"
          min="30"
          step="30"
          value={durationMins}
          onChange={(e) => setDurationMins(e.target.value)}
          aria-label="Duration minutes"
        />
        <input
          className="table-mini-input booking-notes-input"
          placeholder="Notes optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="primary-action-btn" type="submit" disabled={!!busyActions["booking-create"]}>
          {busyActions["booking-create"] ? "Booking..." : "Book table"}
        </button>
      </form>
      <div className="booking-list">
        {bookings.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-icon"><i className="ti ti-calendar-plus" aria-hidden="true" /></div>
            <div className="empty-state-title">No upcoming bookings</div>
            <div className="empty-state-detail">Future reservations and event blocks will appear here.</div>
          </div>
        ) : (
          bookings.slice(0, 8).map((booking) => {
            const missed = booking.status === "missed";
            return (
              <div
                key={booking.id}
                className={`booking-row ${missed ? "missed" : ""}`}
              >
                <div>
                  <div className="queue-name">
                    {booking.customer_name}
                    {missed && (
                      <span className="booking-status-pill">Missed</span>
                    )}
                  </div>
                  <div className="queue-meta">
                    {new Date(booking.booking_time).toLocaleString("en-IN")} ·{" "}
                    {booking.table_id === "ANY" ? "Any table" : booking.table_id} ·{" "}
                    {booking.duration_mins}m
                  </div>
                  {missed && (
                    <div className="booking-offer-line">
                      Released {booking.released_at || "after grace period"}
                    </div>
                  )}
                  {booking.notes && (
                    <div className="queue-note">{booking.notes}</div>
                  )}
                </div>
                <div className="booking-actions">
                  <button
                    className="icon-danger-btn"
                    type="button"
                    onClick={() => onCancel(booking.id)}
                    disabled={!!busyActions[`cancel-booking:${booking.id}`]}
                    aria-label="Cancel booking"
                  >
                    {busyActions[`cancel-booking:${booking.id}`] ? "..." : "×"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function QuickSessionModal({
  open,
  onClose,
  tables,
  sessions,
  maintenance,
  rates,
  onStart,
  busyActions = {},
  showToast,
}) {
  const [tableId, setTableId] = useState("");
  const [player1, setPlayer1] = useState("");
  const [otherPlayers, setOtherPlayers] = useState("");
  const [billingMode, setBillingMode] = useState("single");
  const initializedOpen = useRef(false);
  const availableTables = tables.filter(
    (table) => !sessions[table.id] && !maintenance[table.id],
  );
  const selectedTable =
    tables.find((table) => table.id === tableId) || availableTables[0] || null;
  const selectedRate = getTableRate(selectedTable, rates);
  const startBusy = selectedTable ? !!busyActions[`start:${selectedTable.id}`] : false;

  useEffect(() => {
    if (!open) {
      initializedOpen.current = false;
      return;
    }
    if (initializedOpen.current) return;
    const firstAvailable = availableTables[0];
    setTableId(firstAvailable?.id || "");
    setPlayer1("");
    setOtherPlayers("");
    setBillingMode(defaultBillingModeForTable(firstAvailable));
    initializedOpen.current = true;
  }, [open, availableTables]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (!selectedTable) {
      showToast?.("No available table to start.", "error");
      return;
    }
    const ok = await onStart({
      table: selectedTable,
      player1,
      otherPlayers,
      billingMode,
    });
    if (ok) onClose();
  }

  return (
    <div
      className="quick-session-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-session-title"
      onMouseDown={onClose}
    >
      <form
        className="quick-session-modal"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quick-session-head">
          <div>
            <div className="quick-session-eyebrow">New session</div>
            <div id="quick-session-title" className="quick-session-title">
              Start a table now
            </div>
          </div>
          <button
            type="button"
            className="quick-session-close"
            onClick={onClose}
            aria-label="Close new session"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="quick-session-table-grid">
          {tables.map((table) => {
            const occupied = !!sessions[table.id];
            const blocked = !!maintenance[table.id];
            const disabled = occupied || blocked;
            return (
              <button
                key={table.id}
                type="button"
                className={`quick-table-choice ${table.id === selectedTable?.id ? "active" : ""}`}
                disabled={disabled}
                onClick={() => {
                  setTableId(table.id);
                  setOtherPlayers("");
                  setBillingMode(defaultBillingModeForTable(table));
                }}
              >
                <strong>T{table.num}</strong>
                <span>{blocked ? "Maintenance" : occupied ? "Busy" : getTableLabel(table)}</span>
              </button>
            );
          })}
        </div>

        {selectedTable ? (
          <div className="quick-session-rate">
            T{selectedTable.num} · {getTableLabel(selectedTable)} · ₹{selectedRate}/hr
          </div>
        ) : (
          <div className="quick-session-rate warning">
            All tables are busy or under maintenance.
          </div>
        )}

        <div className="quick-session-fields">
          <div>
            <label className="form-label">
              {billingMode === "single" ? "Customer name (optional)" : "Customer names (optional)"}
            </label>
            <CustomerInput
              value={player1}
              onChange={setPlayer1}
              placeholder=""
            />
          </div>
          <div className="billing-mode-control quick" aria-label="Billing mode">
            {BILLING_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={billingMode === mode.id ? "active" : ""}
                onClick={() => setBillingMode(mode.id)}
              >
                <strong>{mode.label}</strong>
                <span>{mode.hint}</span>
              </button>
            ))}
          </div>
          {billingMode !== "single" && (
            <div>
              <label className="form-label">
                {billingMode === "lp" ? "Second name (optional)" : "Other names (optional)"}
              </label>
              {billingMode === "lp" ? (
                <CustomerInput
                  value={otherPlayers}
                  onChange={setOtherPlayers}
                  placeholder=""
                />
              ) : (
                <input
                  className="table-mini-input"
                  value={otherPlayers}
                  onChange={(e) => setOtherPlayers(e.target.value)}
                  aria-label="Other names"
                />
              )}
            </div>
          )}
        </div>

        <div className="quick-session-actions">
          <button type="button" className="quick-session-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-action-btn"
            disabled={!selectedTable || startBusy}
          >
            {startBusy ? "Starting..." : "Start session"}
          </button>
        </div>
      </form>
    </div>
  );
}

function HistoryModal({ tableId, tableNum, onClose }) {
  const [history, setHistory] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([getTableHistory(tableId), getTableAudit(tableId)])
      .then(([historyRes, auditRes]) => {
        if (historyRes.status === "fulfilled") setHistory(historyRes.value.data);
        if (auditRes.status === "fulfilled") setAudit(auditRes.value.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tableId]);

  return (
    <div className="modal-backdrop plain" onClick={onClose}>
      <div className="table-history-modal" onClick={(event) => event.stopPropagation()}>
        <div className="table-history-head">
          <div>
            <strong>Table {tableNum}</strong>
            <span>Sessions and audit trail</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close history">
            ×
          </button>
        </div>
        {loading ? (
          <div className="table-history-empty">Loading...</div>
        ) : (
          <>
            <div className="table-history-title">Last sessions</div>
            {history.length === 0 ? (
              <div className="table-history-empty">No sessions yet</div>
            ) : (
              <table className="data-table table-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Duration</th>
                    <th>Total</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, index) => (
                    <tr key={`${row.date}-${index}`}>
                      <td>{row.date?.split(",")[0]}</td>
                      <td>{row.nm}</td>
                      <td>{row.dur}m</td>
                      <td>₹{row.tot}</td>
                      <td>{row.payment_method || "Cash"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-history-title">Audit trail</div>
            {audit.length === 0 ? (
              <div className="table-history-empty">No table audit yet</div>
            ) : (
              <table className="data-table table-history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Detail</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row, index) => (
                    <tr key={`${row.ts}-${index}`}>
                      <td>{row.date}</td>
                      <td>{String(row.action || "").replaceAll("_", " ")}</td>
                      <td>{row.detail}</td>
                      <td>{row.amount ? `₹${row.amount}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FrameLoserModal({ frameNo, loading = false, onChoose, onClose }) {
  const [customerName, setCustomerName] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const cleanName = customerName.trim();
    if (!cleanName || loading) return;
    onChoose(cleanName);
  }

  return (
    <div className="frame-loser-backdrop" role="dialog" aria-modal="true">
      <form className="frame-loser-modal" onSubmit={handleSubmit}>
        <div className="frame-loser-head">
          <div>
            <div className="quick-session-eyebrow">End frame</div>
            <div className="frame-loser-title">Frame {frameNo} loser</div>
            <p className="frame-loser-copy">
              Enter the customer name who lost this frame.
            </p>
          </div>
          <button
            type="button"
            className="quick-session-close"
            onClick={onClose}
            aria-label="Close loser prompt"
            disabled={loading}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="frame-loser-form">
          <label className="form-label" htmlFor={`frame-loser-${frameNo}`}>
            Customer name
          </label>
          <input
            id={`frame-loser-${frameNo}`}
            className="frame-loser-input"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="frame-loser-submit"
            disabled={!customerName.trim() || loading}
          >
            {loading ? "Closing..." : "Close frame"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResetConfirmModal({ tableId, loading, onClose, onConfirm }) {
  const [pin, setPin] = useState("");

  return (
    <div className="frame-loser-backdrop" role="dialog" aria-modal="true">
      <form
        className="frame-loser-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          const success = await onConfirm(pin.trim());
          if (success) onClose();
        }}
      >
        <div className="frame-loser-head">
          <div>
            <div className="quick-session-eyebrow">Reset table</div>
            <div className="frame-loser-title">{tableId.toUpperCase()}</div>
            <p className="frame-loser-copy">
              This clears the running session without creating a bill.
            </p>
          </div>
          <button
            type="button"
            className="quick-session-close"
            onClick={onClose}
            aria-label="Close reset confirmation"
            disabled={loading}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="frame-loser-form">
          <label className="form-label" htmlFor={`reset-pin-${tableId}`}>
            Manager PIN, if required
          </label>
          <input
            id={`reset-pin-${tableId}`}
            className="frame-loser-input"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="frame-loser-submit"
            disabled={loading}
          >
            {loading ? "Resetting..." : "Reset table"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CheckoutQuoteScreen({
  quote,
  onClose,
  onPaymentChange,
  onDiscountChange,
  onFinalize,
}) {
  if (!quote) return null;
  const rec = quote.rec || {};
  const settlement = Array.isArray(rec.player_breakdown)
    ? rec.player_breakdown.filter((item) => item && item.name)
    : [];
  const total = rec.tot ?? rec.total ?? 0;
  const rawTotal = rec.raw_total ?? total;
  const discountAmount = rec.discount_amount || 0;
  const frames = Array.isArray(rec.frames) ? rec.frames : [];
  const splitRows = quote.paymentSplit || { Cash: "", UPI: "", Card: "" };
  const splitTotal = ["Cash", "UPI", "Card"].reduce(
    (sum, method) => sum + (parseInt(splitRows[method], 10) || 0),
    0,
  );
  const splitRemaining = total - splitTotal;

  return (
    <div className="checkout-bill-screen" role="dialog" aria-modal="true">
      <div className="checkout-bill-shell checkout-quote-shell">
        <div className="checkout-bill-head">
          <div>
            <div className="quick-session-eyebrow">Review bill</div>
            <div className="checkout-bill-title">
              {quote.tableId?.toUpperCase()} · ₹{total}
            </div>
            <div className="checkout-bill-sub">
              {quote.paymentMethod || rec.payment_method || "Cash"} · {rec.dur || 0} min
            </div>
            <div className="checkout-session-time">
              <span>Session started {fmtDateTime(rec.session_started_at)}</span>
              <span>Bill frozen {fmtDateTime(rec.session_ended_at)}</span>
            </div>
            {rec.duration_capped && (
              <div className="checkout-cap-warning">
                Long session capped at {rec.dur} min from {rec.actual_dur} min.
              </div>
            )}
          </div>
          <button type="button" className="checkout-bill-close secondary" onClick={onClose}>
            Back
          </button>
        </div>

        <div className="checkout-bill-summary">
          <div>
            <span>Table</span>
            <strong>₹{rec.ply || 0}</strong>
          </div>
          <div>
            <span>Food</span>
            <strong>₹{rec.famt || 0}</strong>
          </div>
          <div>
            <span>Before discount</span>
            <strong>₹{rawTotal}</strong>
          </div>
          <div>
            <span>Discount</span>
            <strong>₹{discountAmount}</strong>
          </div>
          <div className="checkout-final-total">
            <span>Final bill</span>
            <strong>₹{total}</strong>
          </div>
        </div>

        <div className="checkout-bill-section-title">Payment Method</div>
        <div className="table-payment-grid checkout-payment-grid">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={`table-payment-btn ${quote.paymentMethod === method ? "active" : ""}`}
              onClick={() => onPaymentChange(method)}
            >
              <i
                className={`ti ${
                  method === "Cash"
                    ? "ti-cash"
                    : method === "UPI"
                      ? "ti-qrcode"
                      : method === "Card"
                        ? "ti-credit-card"
                        : "ti-arrows-split"
                }`}
                aria-hidden="true"
              />
              <span>{method}</span>
            </button>
          ))}
        </div>
        {quote.paymentMethod === "Split" && (
          <div className="checkout-split-payment-box">
            {["Cash", "UPI", "Card"].map((method) => (
              <label className="table-field-stack" key={method}>
                <span>{method}</span>
                <input
                  className="table-mini-input"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={splitRows[method] || ""}
                  onChange={(event) =>
                    onPaymentChange("Split", {
                      ...splitRows,
                      [method]: event.target.value,
                    })
                  }
                />
              </label>
            ))}
            <div className={`checkout-split-payment-total ${splitRemaining === 0 ? "ok" : "warn"}`}>
              {splitRemaining === 0
                ? "Split matches final bill"
                : `Remaining ₹${splitRemaining}`}
            </div>
          </div>
        )}

        <div className="checkout-bill-section-title">Apply Discount</div>
        <div className="checkout-discount-box">
          <div className="table-discount-options">
            {DISCOUNT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={quote.discountType === option.id ? "active" : ""}
                onClick={() =>
                  onDiscountChange(
                    option.id,
                    option.id === "rupee" ? quote.discountValue : "",
                    true,
                  )
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          {quote.discountType === "rupee" && (
            <div className="checkout-rupee-discount">
              <div className="checkout-rupee-discount-row">
                <input
                  className="table-mini-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quote.discountValue}
                  onChange={(event) =>
                    onDiscountChange("rupee", sanitizeRupeeDiscount(event.target.value), false)
                  }
                  placeholder="Max ₹50"
                  aria-label="Rupee discount amount"
                />
                <button
                  type="button"
                  className="checkout-rupee-apply-btn"
                  disabled={quote.loading || !quote.discountValue}
                  onClick={() => onDiscountChange("rupee", quote.discountValue, true)}
                >
                  Apply
                </button>
              </div>
              <span className="checkout-rupee-hint">Enter the rupee amount, then apply.</span>
            </div>
          )}
          {quote.discountType !== "none" && (
            <label className="table-field-stack checkout-discount-reason">
              <span>Discount reason</span>
              <input
                className="table-mini-input"
                type="text"
                value={quote.discountReason || ""}
                onChange={(event) =>
                  onDiscountChange(quote.discountType, quote.discountValue, false, event.target.value)
                }
                placeholder="Owner approved / service issue"
              />
            </label>
          )}
          {quote.loading && <span className="checkout-quote-status">Updating bill...</span>}
          {quote.error && <span className="checkout-quote-error">{quote.error}</span>}
        </div>

        {settlement.length > 0 && (
          <>
            <div className="checkout-bill-section-title">Payment Split</div>
            <div className="checkout-split-list">
              {settlement.map((item) => {
                const losses = Array.isArray(item.lost_frames) ? item.lost_frames : [];
                return (
                  <div key={item.name} className="checkout-split-card">
                    <div className="checkout-split-main">
                      <div>
                        <div className="checkout-split-name">{item.name}</div>
                        <div className="checkout-split-meta">
                          {losses.length
                            ? `Lost frame ${losses.join(", ")}`
                            : "No recorded frame loss"}
                        </div>
                      </div>
                      <strong>₹{item.total ?? 0}</strong>
                    </div>
                    <div className="checkout-split-parts">
                      <span>Table ₹{item.table ?? item.play ?? 0}</span>
                      <span>Food ₹{item.food ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {frames.length > 0 && (
          <>
            <div className="checkout-bill-section-title">Frames</div>
            <div className="checkout-frame-list">
              {frames.map((frame) => (
                <div key={frame.id || frame.frame_no} className="checkout-frame-card">
                  <div>
                    <strong>Frame {frame.frame_no}</strong>
                    <span>{frame.loser_name || "No loser recorded"}</span>
                  </div>
                  <div className="checkout-frame-times">
                    <time dateTime={frame.started_at ? new Date(frame.started_at).toISOString() : undefined}>
                      Start {fmtClock(frame.started_at)}
                    </time>
                    <time dateTime={frame.ended_at ? new Date(frame.ended_at).toISOString() : undefined}>
                      End {frame.ended_at ? fmtClock(frame.ended_at) : "Running"}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="checkout-final-actions">
          <button type="button" className="btn checkout-cancel-btn" onClick={onClose}>
            Keep table open
          </button>
          <button
            type="button"
            className="checkout-bill-close"
            onClick={onFinalize}
            disabled={quote.loading || quote.finalizing}
          >
            {quote.finalizing ? "Closing..." : `Close table · ₹${total}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckoutBillScreen({ bill, onClose }) {
  if (!bill) return null;
  const rec = bill.rec || {};
  const settlement = Array.isArray(rec.player_breakdown)
    ? rec.player_breakdown.filter((item) => item && item.name)
    : [];
  const total = rec.tot ?? rec.total ?? 0;
  const frames = Array.isArray(rec.frames) ? rec.frames : [];
  const sessionStartedAt = rec.session_started_at || null;
  const sessionEndedAt = rec.session_ended_at || rec.ts || null;
  const paymentSplit = Array.isArray(rec.payment_split) ? rec.payment_split : [];

  return (
    <div className="checkout-bill-screen" role="dialog" aria-modal="true">
      <div className="checkout-bill-shell">
        <div className="checkout-bill-head">
          <div>
            <div className="quick-session-eyebrow">Table closed</div>
            <div className="checkout-bill-title">
              {bill.tableId?.toUpperCase()} · ₹{total}
            </div>
            <div className="checkout-bill-sub">
              {rec.payment_method || bill.paymentMethod || "Cash"} · {rec.dur || 0} min
            </div>
            <div className="checkout-session-time">
              <span>Session started {fmtDateTime(sessionStartedAt)}</span>
              <span>Session ended {fmtDateTime(sessionEndedAt)}</span>
            </div>
            {rec.duration_capped && (
              <div className="checkout-cap-warning">
                Long session capped at {rec.dur} min from {rec.actual_dur} min.
              </div>
            )}
          </div>
          <button type="button" className="checkout-bill-close" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="checkout-bill-summary">
          <div>
            <span>Table</span>
            <strong>₹{rec.ply || 0}</strong>
          </div>
          <div>
            <span>Food</span>
            <strong>₹{rec.famt || 0}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>₹{total}</strong>
          </div>
          {rec.discount_amount > 0 && (
            <div>
              <span>Discount</span>
              <strong>₹{rec.discount_amount}</strong>
            </div>
          )}
        </div>
        {rec.discount_amount > 0 && rec.discount_reason && (
          <div className="checkout-applied-note">
            Discount reason: {rec.discount_reason}
          </div>
        )}
        {paymentSplit.length > 0 && (
          <>
            <div className="checkout-bill-section-title">Payment Received</div>
            <div className="checkout-payment-received">
              {paymentSplit.map((row) => (
                <span key={row.method}>
                  {row.method} ₹{row.amount}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="checkout-bill-section-title">Payment Split</div>
        <div className="checkout-split-list">
          {settlement.map((item) => {
            const losses = Array.isArray(item.lost_frames) ? item.lost_frames : [];
            return (
              <div key={item.name} className="checkout-split-card">
                <div className="checkout-split-main">
                  <div>
                    <div className="checkout-split-name">{item.name}</div>
                    <div className="checkout-split-meta">
                      {losses.length
                        ? `Lost frame ${losses.join(", ")}`
                        : "No recorded frame loss"}
                    </div>
                  </div>
                  <strong>₹{item.total ?? 0}</strong>
                </div>
                <div className="checkout-split-parts">
                  <span>Table ₹{item.table ?? item.play ?? 0}</span>
                  <span>Food ₹{item.food ?? 0}</span>
                </div>
              </div>
            );
          })}
        </div>

        {frames.length > 0 && (
          <>
            <div className="checkout-bill-section-title">Frames</div>
            <div className="checkout-frame-list">
              {frames.map((frame) => (
                <div key={frame.id || frame.frame_no} className="checkout-frame-card">
                  <div>
                    <strong>Frame {frame.frame_no}</strong>
                    <span>{frame.loser_name || "No loser recorded"}</span>
                  </div>
                  <div className="checkout-frame-times">
                    <time dateTime={frame.started_at ? new Date(frame.started_at).toISOString() : undefined}>
                      Start {fmtClock(frame.started_at)}
                    </time>
                    <time dateTime={frame.ended_at ? new Date(frame.ended_at).toISOString() : undefined}>
                      End {frame.ended_at ? fmtClock(frame.ended_at) : "Running"}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TableFloorTile({
  table,
  session,
  booking,
  rates,
  maintenance,
  selected,
  onSelect,
  peakRate,
  gstPercent,
}) {
  const occupied = !!session;
  const T = THEME[table.type];
  const rate = getTableRate(table, rates);
  const total = runningTotalForSession(session, peakRate, gstPercent);
  const closedFrames = session?.frames?.filter((frame) => frame.status === "closed") || [];
  const openFrame = session?.frames?.find((frame) => frame.status === "open");
  const bookingTime = booking ? bookingDisplayTime(booking) : "";

  const status = getTableStatus({ session, booking, maintenance });
  const tone = status.tone;

  return (
    <button
      type="button"
      className={`table-floor-tile ${selected ? "selected" : ""} ${tone}`}
      onClick={onSelect}
      aria-pressed={selected}
      style={{ "--table-accent": T.accent, "--table-felt": occupied ? T.felt : T.feltDark }}
    >
      <div className="table-floor-felt">
        <div className="table-floor-cushion top" />
        <div className="table-floor-cushion bottom" />
        <div className="table-floor-pocket tl" />
        <div className="table-floor-pocket tr" />
        <div className="table-floor-pocket bl" />
        <div className="table-floor-pocket br" />
        <div className="table-floor-number">{String(table.num).padStart(2, "0")}</div>
        <div className="table-floor-timer">{fmt(session?.elapsed)}</div>
        {session?.leakageAlert && <div className="table-floor-alert">Review</div>}
      </div>

      <div className="table-floor-body">
        <div className="table-floor-topline">
          <span className={`table-floor-status ${tone}`}>{status.label}</span>
          <strong>₹{rate}/hr</strong>
        </div>
        <div className="table-floor-title">
          T{table.num} · {getTableLabel(table)}
        </div>
        <div className="table-floor-meta">
          {occupied ? (
            <>
              <span>Started {fmtClock(session.startTime)}</span>
              <span>₹{total} running</span>
              <span>
                {openFrame
                  ? `Frame ${openFrame.frame_no} live`
                  : closedFrames.length
                    ? `${closedFrames.length} frames`
                    : billingModeLabel(session.billingMode)}
              </span>
            </>
          ) : maintenance ? (
            <span>{maintenance.reason}</span>
          ) : booking ? (
            <span>{booking.customer_name} · {bookingTime}</span>
          ) : (
            <span>Tap to start or reserve</span>
          )}
        </div>
      </div>
    </button>
  );
}

function TableCard({
  table,
  session,
  booking,
  name,
  onNameChange,
  onStart,
  onPause,
  onReset,
  onStop,
  onTransfer,
  transferTargets = [],
  onReserve,
  onCancelReserve,
  rates,
  maintenance,
  onMaintenance,
  onClearMaintenance,
  onSaveNotes,
  onStartFrame,
  onCloseFrame,
  peakRate,
  gstPercent,
  showToast,
  busyActions = {},
  compact = false,
}) {
  const [billingMode, setBillingMode] = useState(() => defaultBillingModeForTable(table));
  const [otherPlayers, setOtherPlayers] = useState("");
  const [frameLoserOpen, setFrameLoserOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resvName, setResvName] = useState("");
  const [resvTime, setResvTime] = useState("");
  const [notes, setNotes] = useState("");
  const [maintReason, setMaintReason] = useState("Under maintenance");
  const clearMaintenanceBusy = !!busyActions[`clear-maintenance:${table.id}`];

  useEffect(() => {
    if (session?.notes !== undefined) setNotes(session.notes || "");
  }, [session?.notes]);

  const isPool = table.type === "POOL";
  const occupied = !!session;
  const paused = session?.paused || false;
  const rate = getTableRate(table, rates);
  const T = THEME[table.type];

  useEffect(() => {
    if (!occupied) {
      setBillingMode(defaultBillingModeForTable(table));
      setOtherPlayers("");
    }
  }, [occupied, table]);

  const mins = session ? Math.max(1, Math.round(session.elapsed / 60)) : 0;
  const basePlay = session ? Math.round((mins / 60) * session.rate) : 0;
  const multiplier = peakRate?.multiplier || 1;
  const play = session ? Math.round(basePlay * multiplier) : 0;
  const peakSurcharge = play - basePlay;
  const subtotal = play + (session?.foodTotal || 0);
  const gstAmt =
    gstPercent > 0 && subtotal > 0 ? Math.round((subtotal * gstPercent) / 100) : 0;
  const total = subtotal + gstAmt;
  const activeBillingMode = session?.billingMode || "single";
  const activePlayers = session?.players?.length
    ? session.players
    : [session?.player1, session?.player2].filter(Boolean);
  const reservation = session?.reservation || (booking
    ? {
        name: booking.customer_name,
        time: bookingDisplayTime(booking),
      }
    : null);
  const displayPlayers = visiblePlayerNames(activePlayers);
  const frames = session?.frames || [];
  const openFrame = frames.find((frame) => frame.status === "open");
  const closedFrames = frames.filter((frame) => frame.status === "closed");
  const recentFrames = closedFrames.slice(-3);
  const canTrackFrames = activeBillingMode === "lp" && activePlayers.length > 1;
  const nextFrameNo = (frames.reduce((max, frame) => Math.max(max, frame.frame_no || 0), 0) || 0) + 1;
  const framePanelState = paused ? "paused" : openFrame ? "running" : "waiting";
  const frameLossCounts = closedFrames.reduce((acc, frame) => {
    if (frame.loser_name) acc[frame.loser_name] = (acc[frame.loser_name] || 0) + 1;
    return acc;
  }, {});
  const scorePlayers = Array.from(new Set([...displayPlayers, ...Object.keys(frameLossCounts)]));
  const shareCount = activeBillingMode === "sharing" ? Math.max(1, activePlayers.length) : 1;
  const shareAmount = shareCount > 1 ? Math.ceil(total / shareCount) : total;
  const startBusy = !!busyActions[`start:${table.id}`];
  const quoteBusy = !!busyActions[`quote:${table.id}`];
  const pauseBusy = !!busyActions[`pause:${table.id}`];
  const resetBusy = !!busyActions[`reset:${table.id}`];
  const maintenanceBusy = !!busyActions[`maintenance:${table.id}`];
  const notesBusy = !!busyActions[`notes:${table.id}`];
  const startFrameBusy = !!busyActions[`start-frame:${table.id}`];
  const closeFrameBusy = !!busyActions[`close-frame:${table.id}`];
  const transferBusy = !!busyActions[`transfer:${table.id}`];
  const reserveBusy = !!busyActions[`reserve:${table.id}`];
  const cancelReserveBusy = !!busyActions[`cancel-reserve:${table.id}`];

  useEffect(() => {
    if (!session || !openFrame || paused) setFrameLoserOpen(false);
  }, [session, openFrame, paused]);

  const pocketStyle = {
    position: "absolute",
    width: "18px",
    height: "18px",
    background: "var(--text-primary)",
    borderRadius: "50%",
    border: "2px solid color-mix(in srgb, var(--text-primary) 90%, var(--surface))",
    boxShadow: "inset 0 2px 6px rgba(0,0,0,0.9), 0 0 0 1px var(--border)",
  };

  if (maintenance) {
    return (
      <div
        className={`table-maintenance-card ${compact ? "compact" : ""}`}
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-md)",
          padding: "12px",
          border: "2px solid var(--warning)",
        }}
      >
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-bold)",
              color: "var(--warning)",
              letterSpacing: "2px",
              marginBottom: "8px",
            }}
          >
            MAINTENANCE
          </div>
          <div
            style={{
              fontSize: "var(--text-3xl)",
              fontWeight: "var(--weight-heavy)",
              color: "var(--text-muted)",
              marginBottom: "8px",
            }}
          >
            {String(table.num).padStart(2, "0")}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: "4px" }}>
            {maintenance.reason}
          </div>
          <div
            style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "16px" }}
          >
            Since {maintenance.since}
          </div>
          <button
            onClick={() => onClearMaintenance(table.id)}
            disabled={clearMaintenanceBusy}
            style={{
              background: "var(--accent)",
              color: "var(--surface)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "8px 16px",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              cursor: clearMaintenanceBusy ? "wait" : "pointer",
            }}
          >
            {clearMaintenanceBusy ? "Saving..." : "Mark Available"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showHistory && (
        <HistoryModal
          tableId={table.id}
          tableNum={table.num}
          onClose={() => setShowHistory(false)}
        />
      )}

      {frameLoserOpen && openFrame && (
        <FrameLoserModal
          frameNo={openFrame.frame_no}
          loading={closeFrameBusy}
          onClose={() => setFrameLoserOpen(false)}
          onChoose={async (player) => {
            const success = await onCloseFrame(table.id, player);
            if (success) setFrameLoserOpen(false);
          }}
        />
      )}

      {resetOpen && (
        <ResetConfirmModal
          tableId={table.id}
          loading={resetBusy}
          onClose={() => setResetOpen(false)}
          onConfirm={(pin) => onReset(table.id, pin)}
        />
      )}

      <div
        className={`table-session-card ${compact ? "compact" : ""} ${occupied ? "occupied" : ""}`}
        style={{
          "--occupied-accent": T.accent,
          "--occupied-card-bg": "color-mix(in srgb, var(--accent-bg) 55%, var(--surface))",
          "--occupied-control-bg": "color-mix(in srgb, var(--accent-bg) 42%, var(--surface))",
          "--occupied-control-surface": "var(--surface)",
          "--occupied-control-border": "color-mix(in srgb, var(--accent) 24%, var(--border))",
          background: occupied ? "var(--occupied-card-bg)" : "var(--table-card-bg)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          border: `1px solid ${occupied ? T.accent : "var(--table-card-border)"}`,
          boxShadow: occupied
            ? "0 16px 34px color-mix(in srgb, var(--accent) 18%, transparent)"
            : "var(--shadow-sm)",
          transition: "all 0.3s",
        }}
      >
        {/* ── PORTRAIT TABLE VISUAL ── */}
        <div
          style={{ background: T.rail, padding: "8px", position: "relative" }}
        >
          <div
            style={{
              background: occupied ? T.felt : T.feltDark,
              borderRadius: "var(--radius-sm)",
              position: "relative",
              height: compact ? "160px" : "220px",
              overflow: "hidden",
              transition: "background 0.4s",
            }}
          >
            {/* Cushions */}
            <div
              style={{
                position: "absolute",
                top: "8px",
                left: "22px",
                right: "22px",
                height: "6px",
                background: T.cushion,
                borderRadius: "var(--radius-sm)",
                opacity: 0.8,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: "8px",
                left: "22px",
                right: "22px",
                height: "6px",
                background: T.cushion,
                borderRadius: "var(--radius-sm)",
                opacity: 0.8,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "8px",
                top: "22px",
                bottom: "22px",
                width: "6px",
                background: T.cushion,
                borderRadius: "var(--radius-sm)",
                opacity: 0.8,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: "8px",
                top: "22px",
                bottom: "22px",
                width: "6px",
                background: T.cushion,
                borderRadius: "var(--radius-sm)",
                opacity: 0.8,
              }}
            />

            {/* Corner pockets */}
            <div style={{ ...pocketStyle, top: "-1px", left: "-1px" }} />
            <div style={{ ...pocketStyle, top: "-1px", right: "-1px" }} />
            <div style={{ ...pocketStyle, bottom: "-1px", left: "-1px" }} />
            <div style={{ ...pocketStyle, bottom: "-1px", right: "-1px" }} />

            {/* Side pockets */}
            <div
              style={{
                ...pocketStyle,
                top: "50%",
                left: "-1px",
                transform: "translateY(-50%)",
              }}
            />
            <div
              style={{
                ...pocketStyle,
                top: "50%",
                right: "-1px",
                transform: "translateY(-50%)",
              }}
            />

            {/* Centre spot */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "rgba(255,255,255,0.15)",
              }}
            />

            {/* Big table number watermark */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                fontSize: compact ? "var(--text-3xl)" : "calc(var(--text-3xl) * 2.8)",
                fontWeight: "var(--weight-black)",
                color: occupied
                  ? "rgba(255,255,255,0.14)"
                  : "rgba(255,255,255,0.16)",
                fontVariantNumeric: "tabular-nums",
                userSelect: "none",
                lineHeight: 1,
                zIndex: 1,
              }}
            >
              {String(table.num).padStart(2, "0")}
            </div>

            {/* Timer */}
            <div
              style={{
                position: "absolute",
                top: "18px",
                left: 0,
                right: 0,
                textAlign: "center",
                fontSize: compact
                  ? session?.elapsed >= 3600
                    ? "var(--text-xl)"
                    : "var(--text-2xl)"
                  : session?.elapsed >= 3600
                    ? "var(--text-2xl)"
                    : "var(--text-3xl)",
                fontWeight: "var(--weight-black)",
                color: "var(--surface)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "0",
                textShadow: "0 2px 10px rgba(0,0,0,0.68)",
                zIndex: 2,
              }}
            >
              {fmt(session?.elapsed)}
            </div>

            {session?.leakageAlert && (
              <div
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "22px",
                  background: "var(--danger)",
                  color: "var(--surface)",
                  borderRadius: "999px",
                  padding: "3px 9px",
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--weight-heavy)",
                  letterSpacing: "0.5px",
                  zIndex: 3,
                }}
              >
                REVIEW
              </div>
            )}

            {/* Bill display */}
            <div
              style={{
                position: "absolute",
                bottom: compact ? "42px" : "52px",
                left: "50%",
                transform: "translateX(-50%)",
                minWidth: compact ? "132px" : "156px",
                padding: "7px 14px",
                borderRadius: "var(--radius-md)",
                background: "rgba(0,0,0,0.28)",
                boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
                backdropFilter: "blur(1px)",
                textAlign: "center",
                zIndex: 2,
              }}
            >
              {peakRate?.is_peak && occupied && (
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--warning)",
                    letterSpacing: "0.5px",
                    marginBottom: "2px",
                  }}
                >
                  {peakRate.label} ×{peakRate.multiplier}
                  {peakSurcharge > 0 ? ` (+₹${peakSurcharge})` : ""}
                </div>
              )}
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "rgba(255,255,255,0.86)",
                  letterSpacing: "1px",
                  fontWeight: "var(--weight-heavy)",
                  textShadow: "0 1px 5px rgba(0,0,0,0.45)",
                }}
              >
                RUNNING TOTAL{gstPercent > 0 ? " (incl. GST est.)" : ""}
              </div>
              <div
                style={{
                  fontSize: "var(--text-xl)",
                  lineHeight: 1.1,
                  fontWeight: "var(--weight-black)",
                  color: "var(--surface)",
                  textShadow: "0 2px 8px rgba(0,0,0,0.58)",
                }}
              >
                ₹{total}
              </div>
              {occupied && activeBillingMode === "sharing" && shareCount > 1 && (
                <div
                  style={{
                    marginTop: "2px",
                    color: "rgba(255,255,255,0.65)",
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-bold)",
                  }}
                >
                  ₹{shareAmount} each · {shareCount} players
                </div>
              )}
            </div>

            {/* STOP / START button on felt */}
            {occupied ? (
              <button
                onClick={() => {
                  if (openFrame) {
                    showToast?.("Close the running frame before closing the table.", "error");
                    return;
                  }
                  onStop(table.id);
                }}
                disabled={quoteBusy}
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--danger)",
                  color: "var(--surface)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 28px",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  cursor: quoteBusy ? "wait" : "pointer",
                  letterSpacing: "0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  zIndex: 3,
                }}
              >
                <i className="ti ti-receipt-refund" aria-hidden="true" />
                <span>{quoteBusy ? "LOADING..." : "CLOSE TABLE"}</span>
              </button>
            ) : (
              <button
                onClick={() => onStart(table, billingMode, otherPlayers)}
                disabled={startBusy}
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: T.accent,
                  color: isPool ? "var(--surface)" : "var(--text-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 28px",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  cursor: startBusy ? "wait" : "pointer",
                  letterSpacing: "0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  zIndex: 3,
                }}
              >
                <i className="ti ti-player-play" aria-hidden="true" />
                <span>{startBusy ? "STARTING..." : "START"}</span>
              </button>
            )}
          </div>
        </div>

        {/* ── CONTROLS PANEL BELOW TABLE ── */}
        <div className="table-control-panel">
          {/* Top row — rate, history, maintenance */}
          <div className="table-control-top">
            <span className="table-rate-line">
              ₹{rate}/hr · {getTableLabel(table)}
            </span>
            <div className="table-utility-cluster">
              {occupied && (
                <div className="table-live-dot" style={{ "--table-accent": T.accent }} />
              )}
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                title="History"
                aria-label={`Open T${table.num} history`}
                className="table-utility-btn"
              >
                <i className="ti ti-clock" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setMaintOpen((p) => !p)}
                title="Maintenance"
                aria-label={`Toggle T${table.num} maintenance controls`}
                className={`table-utility-btn ${maintOpen ? "active" : ""}`}
              >
                <i className="ti ti-tool" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Maintenance panel */}
          {maintOpen && (
            <div className="table-inline-panel maintenance">
              <input
                placeholder="Reason"
                value={maintReason}
                onChange={(e) => setMaintReason(e.target.value)}
                className="table-mini-input"
              />
              <button
                onClick={async () => {
                    const success = await onMaintenance(table.id, maintReason);
                    if (success) {
                      setMaintOpen(false);
                    }
                  }}
                  className="table-mini-primary maintenance"
                  disabled={maintenanceBusy}
                >
                  {maintenanceBusy ? "Saving..." : "Set maintenance"}
                </button>
              </div>
            )}

          {!occupied && (
            <div className="table-start-panel">
              <div className="billing-mode-control" aria-label="Billing mode">
                {BILLING_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={billingMode === mode.id ? "active" : ""}
                    onClick={() => setBillingMode(mode.id)}
                  >
                    <strong>{mode.label}</strong>
                    <span>{mode.hint}</span>
                  </button>
                ))}
              </div>

              <div className="table-start-fields">
                <div className="table-field-stack">
                  <span>
                    {billingMode === "single" ? "Customer name optional" : "Player 1 optional"}
                  </span>
                  <CustomerInput
                    value={name}
                    onChange={onNameChange}
                    placeholder=""
                  />
                </div>
                {billingMode !== "single" && (
                  <div className="table-field-stack">
                    <span>
                      {billingMode === "lp" ? "Player 2 optional" : "Other players optional"}
                    </span>
                    {billingMode === "lp" ? (
                      <CustomerInput
                        value={otherPlayers}
                        onChange={setOtherPlayers}
                        placeholder=""
                      />
                    ) : (
                      <input
                        className="table-mini-input"
                        value={otherPlayers}
                        onChange={(e) => setOtherPlayers(e.target.value)}
                        aria-label="Other names"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {occupied && (
            <div className="active-billing-summary">
              <span>{billingModeLabel(activeBillingMode)}</span>
              <strong>Session started {fmtClock(session.startTime)}</strong>
              <strong>Session end {paused ? "Paused" : "Running"}</strong>
              {activeBillingMode === "sharing" && shareCount > 1 && (
                <strong>₹{shareAmount} each</strong>
              )}
              {activeBillingMode === "lp" && <strong>frames decide split</strong>}
            </div>
          )}

          {occupied && openFrame && (
            <div className="table-blocker-banner">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>Frame {openFrame.frame_no} is live. End this frame before closing the table.</span>
            </div>
          )}

          {occupied && canTrackFrames && (
            <div className={`table-frame-panel ${framePanelState}`}>
              <div className="table-frame-head">
                <span>{openFrame ? `Frame ${openFrame.frame_no} live` : `Next: Frame ${nextFrameNo}`}</span>
                <strong>{closedFrames.length} done</strong>
              </div>
              {paused ? (
                <div className="table-frame-paused">
                  Resume table to continue frame play.
                </div>
              ) : openFrame ? (
                <>
                  <div className="table-frame-running">
                    Tap End frame when play stops.
                  </div>
                  <button
                    type="button"
                  className="table-frame-end"
                  data-testid={`end-frame-${table.id}`}
                  onClick={() => setFrameLoserOpen(true)}
                  disabled={closeFrameBusy}
                >
                  <i className="ti ti-flag-check" aria-hidden="true" />
                  {closeFrameBusy ? "Closing..." : "End frame"}
                </button>
              </>
            ) : (
                <button
                  type="button"
                  className="table-frame-start"
                  data-testid={`start-frame-${table.id}`}
                  onClick={() => onStartFrame(table.id)}
                  disabled={startFrameBusy}
                >
                  <i className="ti ti-player-play" aria-hidden="true" />
                  {startFrameBusy ? "Starting..." : `Start frame ${nextFrameNo}`}
                </button>
              )}
              {recentFrames.length > 0 && (
                <div className="table-frame-history">
                  {recentFrames.map((frame) => (
                    <span key={frame.id || frame.frame_no}>
                      F{frame.frame_no}: {frame.loser_name} · {fmtClock(frame.started_at)}-{fmtClock(frame.ended_at)}
                    </span>
                  ))}
                </div>
              )}
              {frames.length > 0 && (
                <div className="table-frame-timeline">
                  {frames.map((frame) => (
                    <div key={frame.id || frame.frame_no} className="table-frame-time-row">
                      <strong>F{frame.frame_no}</strong>
                      <span>Start {fmtClock(frame.started_at)}</span>
                      <span>End {frame.ended_at ? fmtClock(frame.ended_at) : "Running"}</span>
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(frameLossCounts).length > 0 && (
                <div className="table-frame-score">
                  {scorePlayers.map((player) => (
                    <span key={player}>
                      {player.split(" ")[0]} {frameLossCounts[player] || 0}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {occupied && (
            <div className="table-session-actions">
              <button
                onClick={() => onPause(table.id)}
                data-testid={`pause-${table.id}`}
                className={`table-control-btn ${paused ? "resume" : "pause"}`}
                disabled={pauseBusy}
              >
                <i className={`ti ${paused ? "ti-player-play" : "ti-player-pause"}`} aria-hidden="true" />
                <span>{pauseBusy ? "Saving..." : paused ? "Resume" : "Pause"}</span>
              </button>
              <button
                onClick={() => setResetOpen(true)}
                data-testid={`reset-${table.id}`}
                className="table-control-btn reset"
                disabled={resetBusy}
              >
                <i className="ti ti-refresh" aria-hidden="true" />
                <span>{resetBusy ? "Resetting..." : "Reset"}</span>
              </button>
            </div>
          )}

          {occupied && (
            <>
              <button
                onClick={() => setTransferOpen((prev) => !prev)}
                className={`table-notes-btn ${transferOpen ? "active" : ""}`}
              >
                <i className="ti ti-arrows-exchange" aria-hidden="true" />
                <span>{transferOpen ? "Close transfer" : "Transfer table"}</span>
              </button>
              {transferOpen && (
                <div className="table-inline-panel">
                  <label className="table-field-stack">
                    <span>Move to</span>
                    <select
                      className="table-mini-input"
                      value={transferTarget}
                      onChange={(event) => setTransferTarget(event.target.value)}
                    >
                      <option value="">Choose table</option>
                      {transferTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          T{target.num} · {getTableLabel(target)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="table-mini-primary reserve"
                    disabled={!transferTarget || transferBusy}
                    onClick={async () => {
                      const success = await onTransfer(table.id, transferTarget);
                      if (success) {
                        setTransferTarget("");
                        setTransferOpen(false);
                      }
                    }}
                  >
                    {transferBusy ? "Moving..." : "Transfer"}
                  </button>
                </div>
              )}
              <button
                onClick={() => setNotesOpen((p) => !p)}
                className={`table-notes-btn ${notesOpen || session?.notes ? "active" : ""}`}
              >
                <i className="ti ti-note" aria-hidden="true" />
                <span>{notesOpen ? "Close notes" : "Notes"}</span>
                {session?.notes && <span className="notes-dot">Saved</span>}
              </button>
              {notesOpen && (
                <div className="table-notes-panel">
                  <textarea
                    placeholder="e.g. Tournament match..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="table-notes-textarea"
                  />
                  <button
                    onClick={async () => {
                      const success = await onSaveNotes(table.id, notes);
                      if (success) {
                        setNotesOpen(false);
                      }
                    }}
                    className="table-notes-save"
                    disabled={notesBusy}
                  >
                    {notesBusy ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Reserve */}
          {!occupied && !booking && (
            <>
              <button
                onClick={() => setReserveOpen((p) => !p)}
                data-testid={`reserve-${table.id}`}
                className={`table-secondary-btn reserve ${reserveOpen ? "active" : ""}`}
              >
                <i className="ti ti-calendar-plus" aria-hidden="true" />
                <span>{reserveOpen ? "Close reservation" : "Reserve table"}</span>
              </button>
              {reserveOpen && (
                <div className="table-inline-panel">
                  <label className="table-field-stack">
                    <span>Reservation name</span>
                    <input
                      type="text"
                      value={resvName}
                      onChange={(e) => setResvName(e.target.value)}
                      className="table-mini-input"
                    />
                  </label>
                  <label className="table-field-stack">
                    <span>Time</span>
                    <input
                      type="time"
                      value={resvTime}
                      onChange={(e) => setResvTime(e.target.value)}
                      className="table-mini-input"
                    />
                  </label>
                  <button
                    onClick={async () => {
                      const success = await onReserve(table.id, resvName, resvTime);
                      if (success) {
                        setResvName("");
                        setResvTime("");
                        setReserveOpen(false);
                      }
                    }}
                    className="table-mini-primary reserve"
                    disabled={reserveBusy}
                  >
                    {reserveBusy ? "Reserving..." : "Confirm Reservation"}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Reservation info */}
          {reservation && (
            <div className="table-reservation-info">
              <div>
                <div className="table-reservation-name">
                  {reservation.name}
                </div>
                <div className="table-reservation-time">
                  {reservation.time}
                </div>
              </div>
              <button
                onClick={() => onCancelReserve(table.id)}
                className="table-reservation-cancel"
                disabled={cancelReserveBusy}
              >
                {cancelReserveBusy ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function TablesTab({ onSessionEnd, newSessionRequest = 0 }) {
  const { showToast } = useToast();
  const [sessions, setSessions] = useState({});
  const [names, setNames] = useState({});
  const [rates, setRates] = useState({ wr: 320, pr: 170, sr: 270 });
  const [maintenance, setMaintenance] = useState({});
  const [peakRate, setPeakRate] = useState({
    multiplier: 1,
    label: "Standard",
    is_peak: false,
  });
  const [gstPercent, setGstPercent] = useState(0);
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem("tablesViewMode") || "detailed",
  );
  const [queue, setQueue] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [quickSessionOpen, setQuickSessionOpen] = useState(false);
  const [checkoutQuote, setCheckoutQuote] = useState(null);
  const [checkoutBill, setCheckoutBill] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(TABLES[0]?.id || "t1");
  const [busyActions, setBusyActions] = useState({});
  const busyActionsRef = useRef({});
  const detailPanelRef = useRef(null);
  const checkoutQuoteSeqRef = useRef(0);

  async function runBusyAction(key, action) {
    if (busyActionsRef.current[key]) return false;
    busyActionsRef.current = { ...busyActionsRef.current, [key]: true };
    setBusyActions((prev) => ({ ...prev, [key]: true }));
    try {
      return await action();
    } finally {
      const nextRef = { ...busyActionsRef.current };
      delete nextRef[key];
      busyActionsRef.current = nextRef;
      setBusyActions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  const nextBookingByTable = useMemo(() => {
    const recentWindow = Date.now() - 2 * 60 * 60 * 1000;
    return bookings
      .filter((booking) => (
        booking.status !== "missed"
        && booking.table_id
        && booking.table_id !== "ANY"
        && new Date(booking.booking_time).getTime() >= recentWindow
      ))
      .sort((a, b) => new Date(a.booking_time) - new Date(b.booking_time))
      .reduce((acc, booking) => {
        const id = tableKey(booking.table_id);
        if (!acc[id]) acc[id] = booking;
        return acc;
      }, {});
  }, [bookings]);

  useEffect(() => {
    fetchActive();
    fetchRates();
    fetchMaintenance();
    fetchPricing();
    fetchQueue();
    fetchBookings();
    const pricingIv = setInterval(fetchPricing, 60000);
    return () => clearInterval(pricingIv);
  }, []);

  useEffect(() => {
    if (newSessionRequest > 0) {
      setQuickSessionOpen(true);
    }
  }, [newSessionRequest]);

  useEffect(() => {
    const iv = setInterval(() => {
      setSessions((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          if (!next[id].paused)
            next[id] = {
              ...next[id],
              elapsed: Math.floor((Date.now() - next[id].startTime) / 1000),
            };
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  async function fetchActive() {
    try {
      const res = await getTableState();
      const s = {},
        n = {};
      (res.data.tables || []).forEach((tableState) => {
        const x = tableState.session;
        if (!x) return;
        const id = tableKey(x.table_id || tableState.id);
        const billingMode = x.billing_mode || (x.split ? "lp" : "single");
        const players = x.players?.length
          ? x.players
          : [x.customer_name, ...(x.split_name ? splitPlayerNames(x.split_name) : [])].filter(Boolean);
        s[id] = {
          startTime: x.paused ? Date.now() - x.elapsed_ms : x.start_time,
          elapsed: Math.floor(
            (x.paused ? x.elapsed_ms : Date.now() - x.start_time) / 1000,
          ),
          rate: x.rate,
          paused: x.paused,
          foodTotal: x.food_total,
          foodItems: x.food_items,
          reservation: x.reservation || null,
          notes: x.notes || "",
          billingMode,
          players,
          frames: x.frames || [],
          currentFrame: x.current_frame || null,
          loserPays: billingMode === "lp",
          player1: players[0] || x.customer_name,
          player2: players.slice(1).join(", "),
          leakageAlert: x.leakage_alert || false,
        };
        n[id] = x.customer_name;
      });
      setSessions(s);
      setNames(n);
      if (res.data.rates) setRates(res.data.rates);
      if (res.data.maintenance) setMaintenance(res.data.maintenance);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchRates() {
    try {
      const rRes = await getRates();
      setRates(rRes.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchMaintenance() {
    try {
      const res = await getMaintenance();
      setMaintenance(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchPricing() {
    try {
      const [peakRes, gstRes] = await Promise.all([getCurrentRate(), getGST()]);
      setPeakRate(peakRes.data);
      setGstPercent(gstRes.data.gst_percent || 0);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchQueue() {
    try {
      const res = await getWaitlist();
      setQueue(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchBookings() {
    try {
      const res = await getBookings();
      setBookings(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateBooking(booking) {
    return runBusyAction("booking-create", async () => {
      try {
        await createBooking(booking);
        await fetchBookings();
        showToast(`${booking.customer_name} booked`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to create booking", "error");
        return false;
      }
    });
  }

  async function handleCancelBooking(bookingId) {
    return runBusyAction(`cancel-booking:${bookingId}`, async () => {
      try {
        await cancelBooking(bookingId);
        await fetchBookings();
        showToast("Booking cancelled", "success");
        return true;
      } catch {
        showToast("Failed to cancel booking", "error");
        return false;
      }
    });
  }

  async function handleAddToQueue(entry) {
    return runBusyAction("queue-add", async () => {
      try {
        await addWaitlistEntry(entry);
        await fetchQueue();
        showToast(`${entry.customer_name} added to queue`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to add to queue", "error");
        return false;
      }
    });
  }

  async function handleCancelQueue(entryId) {
    return runBusyAction(`cancel-queue:${entryId}`, async () => {
      try {
        await cancelWaitlistEntry(entryId);
        await fetchQueue();
        showToast("Queue entry removed", "success");
        return true;
      } catch {
        showToast("Failed to remove queue entry", "error");
        return false;
      }
    });
  }

  async function handleSeatQueue(entry, tableId) {
    const table = TABLES.find((t) => t.id === tableId);
    if (!table) return false;
    const rate = getTableRate(table, rates);
    const players = [entry.customer_name];
    return runBusyAction(`seat-queue:${entry.id}`, async () => {
      try {
        const res = await startSession(table.id, entry.customer_name, rate, false, "", "single", players);
        const frames = res.data.frames || [];
        await seatWaitlistEntry(entry.id, table.id);
        setSessions((prev) => ({
          ...prev,
          [table.id]: {
            startTime: Date.now(),
            elapsed: 0,
            rate,
            paused: false,
            foodTotal: 0,
            foodItems: [],
            reservation: null,
            notes: entry.notes || "",
            billingMode: "single",
            players,
            frames,
            currentFrame: frames.find((frame) => frame.status === "open") || null,
            loserPays: false,
            player1: entry.customer_name,
            player2: "",
          },
        }));
        setNames((prev) => ({ ...prev, [table.id]: entry.customer_name }));
        setSelectedTableId(table.id);
        await fetchQueue();
        await fetchBookings();
        await fetchActive();
        onSessionEnd?.();
        showToast(`${entry.customer_name} seated at T${table.num}`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to seat customer", "error");
        return false;
      }
    });
  }

  async function handleStart(table, billingMode, otherPlayers) {
    const name = (names[table.id] || "").trim();
    const players = buildPlayers(name, otherPlayers, billingMode);
    const primaryName = players[0];
    const validation = validateBillingPlayers(players, billingMode);
    if (validation) {
      showToast(validation, "error");
      return false;
    }
    if (sessions[table.id]) {
      showToast("Session already running", "error");
      return false;
    }
    const rate = getTableRate(table, rates);
    return runBusyAction(`start:${table.id}`, async () => {
      try {
        const res = await startSession(
          table.id,
          primaryName,
          rate,
          billingMode !== "single",
          players.slice(1).join(", "),
          billingMode,
          players,
        );
        const frames = res.data.frames || [];
        setSessions((prev) => ({
          ...prev,
          [table.id]: {
            startTime: Date.now(),
            elapsed: 0,
            rate,
            paused: false,
            foodTotal: 0,
            foodItems: [],
            reservation: null,
            notes: "",
            billingMode,
            players,
            frames,
            currentFrame: frames.find((frame) => frame.status === "open") || null,
            loserPays: billingMode === "lp",
            player1: players[0],
            player2: players.slice(1).join(", "),
          },
        }));
        setNames((prev) => ({ ...prev, [table.id]: primaryName }));
        setSelectedTableId(table.id);
        await fetchQueue();
        await fetchBookings();
        await fetchActive();
        onSessionEnd?.();
        showToast(`Session started on T${table.num}`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to start", "error");
        return false;
      }
    });
  }

  async function handleQuickStart({ table, player1, billingMode, otherPlayers }) {
    const name = (player1 || "").trim();
    const players = buildPlayers(name, otherPlayers, billingMode);
    const primaryName = players[0];
    const validation = validateBillingPlayers(players, billingMode);
    if (validation) {
      showToast(validation, "error");
      return false;
    }
    if (sessions[table.id]) {
      showToast("Session already running", "error");
      return false;
    }
    if (maintenance[table.id]) {
      showToast(`Table is under maintenance: ${maintenance[table.id].reason}`, "error");
      return false;
    }
    const rate = getTableRate(table, rates);
    return runBusyAction(`start:${table.id}`, async () => {
      try {
        const res = await startSession(
          table.id,
          primaryName,
          rate,
          billingMode !== "single",
          players.slice(1).join(", "),
          billingMode,
          players,
        );
        const frames = res.data.frames || [];
        setSessions((prev) => ({
          ...prev,
          [table.id]: {
            startTime: Date.now(),
            elapsed: 0,
            rate,
            paused: false,
            foodTotal: 0,
            foodItems: [],
            reservation: null,
            notes: "",
            billingMode,
            players,
            frames,
            currentFrame: frames.find((frame) => frame.status === "open") || null,
            loserPays: billingMode === "lp",
            player1: players[0],
            player2: players.slice(1).join(", "),
          },
        }));
        setNames((prev) => ({ ...prev, [table.id]: primaryName }));
        setSelectedTableId(table.id);
        await fetchQueue();
        await fetchBookings();
        await fetchActive();
        onSessionEnd?.();
        showToast(`Session started on T${table.num}`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to start session", "error");
        return false;
      }
    });
  }

  async function handlePause(id) {
    if (!sessions[id]) return false;
    return runBusyAction(`pause:${id}`, async () => {
      try {
        const res = await pauseSession(id);
        setSessions((prev) => {
          const sess = prev[id];
          const nowPaused = res.data.paused;
          return {
            ...prev,
            [id]: {
              ...sess,
              paused: nowPaused,
              startTime: nowPaused
                ? sess.startTime
                : Date.now() - sess.elapsed * 1000,
            },
          };
        });
        await fetchActive();
        onSessionEnd?.();
        showToast(res.data.paused ? "Table paused" : "Table resumed", "success");
        return true;
      } catch {
        showToast("Failed to pause", "error");
        return false;
      }
    });
  }

  async function handleReset(id, pin = "") {
    return runBusyAction(`reset:${id}`, async () => {
      try {
        await resetSession(id, pin);
        setSessions((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setNames((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        await fetchActive();
        onSessionEnd?.();
        showToast("Table reset", "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to reset", "error");
        return false;
      }
    });
  }

  async function handleStartFrame(id) {
    if (!sessions[id]) return false;
    return runBusyAction(`start-frame:${id}`, async () => {
      try {
        const res = await startFrame(id);
        setSessions((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            frames: res.data.frames || [],
            currentFrame: res.data.frame || null,
          },
        }));
        await fetchActive();
        showToast(`Frame ${res.data.frame?.frame_no || ""} started`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to start frame", "error");
        return false;
      }
    });
  }

  async function handleCloseFrame(id, loserName) {
    if (!sessions[id]) return false;
    return runBusyAction(`close-frame:${id}`, async () => {
      try {
        const res = await closeFrame(id, loserName);
        const frames = res.data.frames || [];
        const players = res.data.players || sessions[id].players || [];
        setSessions((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            frames,
            players,
            currentFrame: frames.find((frame) => frame.status === "open") || null,
          },
        }));
        await fetchActive();
        showToast(`Frame ${res.data.frame?.frame_no || ""} closed`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to close frame", "error");
        return false;
      }
    });
  }

  async function handleStop(id, paymentMethod = "Cash") {
    if (!sessions[id]) {
      showToast("No active session", "error");
      return false;
    }
    return runBusyAction(`quote:${id}`, async () => {
      try {
        checkoutQuoteSeqRef.current += 1;
        const res = await quoteSession(id, paymentMethod, "none", 0);
        setCheckoutQuote({
          tableId: id,
          paymentMethod,
          paymentSplit: { Cash: "", UPI: "", Card: "" },
          discountType: "none",
          discountValue: "",
          discountReason: "",
          closedAtMs: res.data.session_ended_at,
          rec: res.data,
          loading: false,
          finalizing: false,
          error: "",
        });
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to show bill", "error");
        return false;
      }
    });
  }

  async function handleTransfer(fromTableId, toTableId) {
    if (!fromTableId || !toTableId) return false;
    return runBusyAction(`transfer:${fromTableId}`, async () => {
      try {
        await transferSession(fromTableId, toTableId);
        setSelectedTableId(tableKey(toTableId));
        await fetchActive();
        showToast(`Moved ${fromTableId.toUpperCase()} to ${toTableId.toUpperCase()}`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to transfer table", "error");
        return false;
      }
    });
  }

  async function handleCheckoutDiscountChange(
    discountType,
    discountValue = "",
    shouldQuote = true,
    discountReason = checkoutQuote?.discountReason || "",
  ) {
    if (!checkoutQuote) return;
    const nextValue = discountType === "rupee" ? sanitizeRupeeDiscount(discountValue) : "";
    const nextQuote = {
      ...checkoutQuote,
      discountType,
      discountValue: nextValue,
      discountReason: discountType === "none" ? "" : discountReason,
      loading: shouldQuote,
      error: "",
    };
    setCheckoutQuote(nextQuote);
    const requestSeq = checkoutQuoteSeqRef.current + 1;
    checkoutQuoteSeqRef.current = requestSeq;
    if (!shouldQuote) return;
    try {
      const res = await quoteSession(
        checkoutQuote.tableId,
        checkoutQuote.paymentMethod,
        discountType,
        parseInt(nextValue, 10) || 0,
        checkoutQuote.closedAtMs,
      );
      if (checkoutQuoteSeqRef.current !== requestSeq) return;
      setCheckoutQuote((prev) => ({
        ...(prev || nextQuote),
        rec: res.data,
        discountType,
        discountValue: nextValue,
        discountReason: discountType === "none" ? "" : discountReason,
        loading: false,
        error: "",
      }));
    } catch (e) {
      if (checkoutQuoteSeqRef.current !== requestSeq) return;
      setCheckoutQuote((prev) => ({
        ...(prev || nextQuote),
        loading: false,
        error: e.response?.data?.detail || "Failed to update bill",
      }));
    }
  }

  async function handleCheckoutPaymentChange(paymentMethod, paymentSplit = null) {
    if (!checkoutQuote) return;
    const nextQuote = {
      ...checkoutQuote,
      paymentMethod,
      paymentSplit: paymentSplit || checkoutQuote.paymentSplit || { Cash: "", UPI: "", Card: "" },
      loading: true,
      error: "",
    };
    setCheckoutQuote(nextQuote);
    const requestSeq = checkoutQuoteSeqRef.current + 1;
    checkoutQuoteSeqRef.current = requestSeq;
    try {
      const res = await quoteSession(
        checkoutQuote.tableId,
        paymentMethod,
        checkoutQuote.discountType,
        parseInt(checkoutQuote.discountValue, 10) || 0,
        checkoutQuote.closedAtMs,
      );
      if (checkoutQuoteSeqRef.current !== requestSeq) return;
      setCheckoutQuote((prev) => ({
        ...(prev || nextQuote),
        rec: res.data,
        paymentMethod,
        paymentSplit: paymentSplit || prev?.paymentSplit || nextQuote.paymentSplit,
        loading: false,
        error: "",
      }));
    } catch (e) {
      if (checkoutQuoteSeqRef.current !== requestSeq) return;
      setCheckoutQuote((prev) => ({
        ...(prev || nextQuote),
        loading: false,
        error: e.response?.data?.detail || "Failed to update payment method",
      }));
    }
  }

  async function handleFinalizeCheckout() {
    if (!checkoutQuote) return;
    const {
      tableId,
      paymentMethod = "Cash",
      paymentSplit = { Cash: "", UPI: "", Card: "" },
      discountType = "none",
      discountValue = "",
      discountReason = "",
      closedAtMs = "",
    } = checkoutQuote;
    const total = checkoutQuote.rec?.tot ?? checkoutQuote.rec?.total ?? 0;
    const splitPayload = paymentMethod === "Split"
      ? ["Cash", "UPI", "Card"]
          .map((method) => ({ method, amount: parseInt(paymentSplit[method], 10) || 0 }))
          .filter((row) => row.amount > 0)
      : [];
    if (paymentMethod === "Split") {
      const splitTotal = splitPayload.reduce((sum, row) => sum + row.amount, 0);
      if (splitTotal !== total) {
        showToast(`Split payments must total ₹${total}`, "error");
        return;
      }
    }
    const hasDiscount =
      discountType !== "none" &&
      (checkoutQuote.rec?.discount_amount || discountType !== "rupee" || parseInt(discountValue, 10) > 0);
    if (hasDiscount && !discountReason.trim()) {
      showToast("Enter a reason for the discount", "error");
      return;
    }
    setCheckoutQuote((prev) => (prev ? { ...prev, finalizing: true } : prev));
    try {
      const res = await stopSession(
        tableId,
        paymentMethod,
        "",
        discountType,
        parseInt(sanitizeRupeeDiscount(discountValue), 10) || 0,
        closedAtMs,
        discountReason.trim(),
        splitPayload,
      );
      const rec = { ...res.data };
      setSessions((prev) => {
        const n = { ...prev };
        delete n[tableId];
        return n;
      });
      setNames((prev) => {
        const n = { ...prev };
        delete n[tableId];
        return n;
      });
      onSessionEnd();
      await fetchQueue();
      await fetchBookings();
      await fetchActive();
      setCheckoutQuote(null);
      showToast(`Table closed (${rec.payment_method || paymentMethod})`, "success");

      setCheckoutBill({ tableId, rec, paymentMethod });
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to close table", "error");
      setCheckoutQuote((prev) => (prev ? { ...prev, finalizing: false } : prev));
    }
  }

  async function handleReserve(id, name, time) {
    if (!name || !time) {
      showToast("Enter name and time", "error");
      return false;
    }
    const table = TABLES.find((item) => item.id === tableKey(id));
    return runBusyAction(`reserve:${tableKey(id)}`, async () => {
      try {
        await createBooking({
          customer_name: name,
          phone: "",
          table_id: tableKey(id).toUpperCase(),
          table_type: table?.type || "ANY",
          booking_time: bookingDateTimeFromClock(time),
          duration_mins: 60,
          notes: "Quick table reservation",
        });
        await fetchBookings();
        showToast(`${name} reserved ${tableKey(id).toUpperCase()}`, "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to reserve", "error");
        return false;
      }
    });
  }

  async function handleCancelReserve(id) {
    const booking = nextBookingByTable[tableKey(id)];
    return runBusyAction(`cancel-reserve:${tableKey(id)}`, async () => {
      try {
        if (booking?.id) {
          await cancelBooking(booking.id);
          await fetchBookings();
          showToast("Reservation cancelled", "success");
          return true;
        }
        setSessions((prev) => ({
          ...prev,
          [tableKey(id)]: { ...(prev[tableKey(id)] || {}), reservation: null },
        }));
        showToast("Reservation cleared", "success");
        return true;
      } catch (e) {
        showToast(e.response?.data?.detail || "Failed to cancel reservation", "error");
        return false;
      }
    });
  }

  async function handleSetMaintenance(tableId, reason) {
    return runBusyAction(`maintenance:${tableId}`, async () => {
      try {
        await saveMaintenance(tableId, reason);
        setMaintenance((prev) => ({
          ...prev,
          [tableId]: { reason, since: new Date().toLocaleString("en-IN") },
        }));
        showToast("Maintenance saved", "success");
        return true;
      } catch {
        showToast("Failed to save maintenance", "error");
        return false;
      }
    });
  }

  async function handleClearMaintenance(tableId) {
    return runBusyAction(`clear-maintenance:${tableId}`, async () => {
      try {
        await clearMaintenance(tableId);
        setMaintenance((prev) => {
          const n = { ...prev };
          delete n[tableId];
          return n;
        });
        showToast("Table marked available", "success");
        return true;
      } catch {
        showToast("Failed to clear maintenance", "error");
        return false;
      }
    });
  }

  async function handleSaveNotes(tableId, value) {
    return runBusyAction(`notes:${tableId}`, async () => {
      try {
        await updateNotes(tableId, value);
        setSessions((prev) => ({
          ...prev,
          [tableId]: { ...prev[tableId], notes: value },
        }));
        showToast("Notes saved", "success");
        return true;
      } catch {
        showToast("Failed to save notes", "error");
        return false;
      }
    });
  }

  const compact = viewMode === "compact";
  const selectedTable = TABLES.find((table) => table.id === selectedTableId) || TABLES[0];

  function selectTable(tableId) {
    setSelectedTableId(tableId);
    if (typeof window !== "undefined" && window.innerWidth <= 1180) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 0);
    }
  }

  function changeViewMode(mode) {
    setViewMode(mode);
    localStorage.setItem("tablesViewMode", mode);
  }

  return (
    <>
      <CheckoutQuoteScreen
        quote={checkoutQuote}
        onClose={() => setCheckoutQuote(null)}
        onPaymentChange={handleCheckoutPaymentChange}
        onDiscountChange={handleCheckoutDiscountChange}
        onFinalize={handleFinalizeCheckout}
      />

      <CheckoutBillScreen
        bill={checkoutBill}
        onClose={() => setCheckoutBill(null)}
      />

      <QuickSessionModal
        open={quickSessionOpen}
        onClose={() => setQuickSessionOpen(false)}
        tables={TABLES}
        sessions={sessions}
        maintenance={maintenance}
        rates={rates}
        onStart={handleQuickStart}
        busyActions={busyActions}
        showToast={showToast}
      />

      <div className="tables-view-toolbar">
        <div>
          <div className="tables-view-title">Table floor</div>
          <div className="tables-view-sub">
            {compact
              ? "Compact floor scan, tap any table for controls"
              : "Tap a table to view running total, frames and checkout"}
          </div>
        </div>
        <div className="segmented-control" aria-label="Table card density">
          {[
            ["detailed", "Detailed", "ti-layout-grid"],
            ["compact", "Compact", "ti-layout-list"],
          ].map(([mode, label, icon]) => (
            <button
              key={mode}
              type="button"
              className={viewMode === mode ? "active" : ""}
              onClick={() => changeViewMode(mode)}
            >
              <i className={`ti ${icon}`} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="table-floor-layout">
        <div className={`tables-grid table-floor-grid ${compact ? "compact" : ""}`}>
          {TABLES.map((table) => (
            <TableFloorTile
              key={table.id}
              table={table}
              session={sessions[table.id]}
              booking={nextBookingByTable[table.id] || null}
              rates={rates}
              maintenance={maintenance[table.id] || null}
              selected={selectedTable?.id === table.id}
              onSelect={() => selectTable(table.id)}
              peakRate={peakRate}
              gstPercent={gstPercent}
            />
          ))}
        </div>

        {selectedTable && (
          <aside
            ref={detailPanelRef}
            className="table-detail-panel"
            aria-label={`T${selectedTable.num} details`}
          >
            <div className="table-detail-header">
              <div>
                <span>Selected table</span>
                <strong>
                  T{selectedTable.num} · {getTableLabel(selectedTable)}
                </strong>
              </div>
              <div className="table-detail-total">
                <span>Running</span>
                <strong>
                  ₹{runningTotalForSession(
                    sessions[selectedTable.id],
                    peakRate,
                    gstPercent,
                  )}
                </strong>
              </div>
            </div>

            <TableCard
              key={selectedTable.id}
              table={selectedTable}
              session={sessions[selectedTable.id]}
              booking={nextBookingByTable[selectedTable.id] || null}
              name={names[selectedTable.id]}
              onNameChange={(val) =>
                setNames((prev) => ({ ...prev, [selectedTable.id]: val }))
              }
              onStart={handleStart}
              onPause={handlePause}
              onReset={handleReset}
              onStop={handleStop}
              onTransfer={handleTransfer}
              transferTargets={TABLES.filter(
                (table) =>
                  table.id !== selectedTable.id &&
                  !sessions[table.id] &&
                  !maintenance[table.id],
              )}
              onReserve={handleReserve}
              onCancelReserve={handleCancelReserve}
              rates={rates}
              maintenance={maintenance[selectedTable.id] || null}
              onMaintenance={handleSetMaintenance}
              onClearMaintenance={handleClearMaintenance}
              onSaveNotes={handleSaveNotes}
              onStartFrame={handleStartFrame}
              onCloseFrame={handleCloseFrame}
              peakRate={peakRate}
              gstPercent={gstPercent}
              showToast={showToast}
              busyActions={busyActions}
              compact={false}
            />
          </aside>
        )}
      </div>

      <div className="tables-support-tools">
        <QueuePanel
          queue={queue}
          activeCount={Object.keys(sessions).length}
          onAdd={handleAddToQueue}
          onSeat={handleSeatQueue}
          onCancel={handleCancelQueue}
          busyActions={busyActions}
          showToast={showToast}
        />

        <BookingPanel
          bookings={bookings}
          onCreate={handleCreateBooking}
          onCancel={handleCancelBooking}
          busyActions={busyActions}
          showToast={showToast}
        />
      </div>
    </>
  );
}
