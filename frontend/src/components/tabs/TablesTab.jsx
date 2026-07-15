import { useState, useEffect, useRef, useMemo } from "react";
import {
  startSession,
  pauseSession,
  stopSession,
  resetSession,
  getActive,
  getRates,
  updateNotes,
  getTableHistory,
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
} from "../../api/index.js";
import { searchMembers } from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { HSR_TABLES, getTableLabel, getTableRate } from "../../config/hsrTables.js";

const TABLES = HSR_TABLES;
const tableKey = (tableId) => String(tableId || "").trim().toLowerCase();

const THEME = {
  POOL: {
    felt: "#1a6bb5",
    feltDark: "#1558a0",
    cushion: "#1e7fd4",
    rail: "#4a3000",
    accent: "#60b4ff",
  },
  SNOOKER: {
    felt: "#1a6b35",
    feltDark: "#155a2c",
    cushion: "#1e8040",
    rail: "#3a2000",
    accent: "#4ade80",
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
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

const BILLING_MODES = [
  { id: "single", label: "Single", hint: "One payer" },
  { id: "sharing", label: "Sharing", hint: "Split payment" },
  { id: "lp", label: "LP", hint: "Loser pays" },
];
const PAYMENT_METHODS = ["Cash", "UPI", "Card"];
const DISCOUNT_OPTIONS = [
  { id: "none", label: "No discount" },
  { id: "percent_5", label: "5%" },
  { id: "percent_10", label: "10%" },
  { id: "rupee", label: "₹ off" },
];

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
  if (!players[0]) return "Please enter the customer's full name.";
  const invalid = players.find((name) => !isFullName(name));
  if (invalid) return `Please enter full name for "${invalid}".`;
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
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: "6px",
            marginTop: "3px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
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
                fontSize: "12px",
                borderBottom:
                  i < suggestions.length - 1 ? "1px solid #f5f5f5" : "none",
                background: "#fff",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#fafafa")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              <span style={{ color: "#111", fontWeight: 500 }}>{m.nm}</span>
              <span
                style={{
                  fontSize: "10px",
                  color: "#2563eb",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  padding: "1px 6px",
                  borderRadius: "3px",
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
}) {
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [preferredType, setPreferredType] = useState("ANY");
  const [notes, setNotes] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!isFullName(customerName)) {
      alert("Please enter the customer's full name (first and last name).");
      return;
    }
    await onAdd({
      customer_name: customerName,
      phone,
      party_size: Number(partySize) || 1,
      preferred_type: preferredType,
      notes,
    });
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
        <button className="primary-action-btn" type="submit">
          Add to queue
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
                    disabled={!table}
                    onClick={() => table && onSeat(entry, table.id)}
                  >
                    {table ? `Seat T${table.num}` : "Waiting"}
                  </button>
                  <button
                    type="button"
                    className="icon-danger-btn"
                    onClick={() => onCancel(entry.id)}
                    aria-label={`Remove ${entry.customer_name} from queue`}
                  >
                    ×
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

function BookingPanel({ bookings, onCreate, onCancel }) {
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
      alert("Please enter the customer's full name (first and last name).");
      return;
    }
    const selected = TABLES.find((t) => t.id.toUpperCase() === tableId);
    await onCreate({
      customer_name: customerName,
      phone,
      table_id: tableId,
      table_type: selected?.type || "ANY",
      booking_time: bookingTime,
      duration_mins: Number(durationMins) || 60,
      notes,
    });
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
        <button className="primary-action-btn" type="submit">
          Book table
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
                    aria-label="Cancel booking"
                  >
                    ×
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
      alert("No available table to start.");
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
            disabled={!selectedTable}
          >
            Start session
          </button>
        </div>
      </form>
    </div>
  );
}

function HistoryModal({ tableId, tableNum, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTableHistory(tableId)
      .then((r) => {
        setHistory(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tableId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "24px",
          width: "500px",
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "15px", color: "#111" }}>
            Table {tableNum} — Last 10 Sessions
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "#bbb",
            }}
          >
            ×
          </button>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", color: "#bbb", padding: "20px" }}>
            Loading...
          </div>
        ) : history.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "#bbb",
              padding: "20px",
              fontSize: "13px",
            }}
          >
            No sessions yet
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Customer", "Duration", "Total", "Payment"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        fontSize: "11px",
                        color: "#999",
                        textTransform: "uppercase",
                        padding: "8px 10px",
                        textAlign: "left",
                        borderBottom: "1px solid #f0f0f0",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f9f9f9" }}>
                  <td
                    style={{
                      fontSize: "12px",
                      color: "#bbb",
                      padding: "8px 10px",
                    }}
                  >
                    {r.date.split(",")[0]}
                  </td>
                  <td
                    style={{
                      fontSize: "13px",
                      padding: "8px 10px",
                      fontWeight: 500,
                    }}
                  >
                    {r.nm}
                  </td>
                  <td
                    style={{
                      fontSize: "13px",
                      padding: "8px 10px",
                      color: "#888",
                    }}
                  >
                    {r.dur}m
                  </td>
                  <td
                    style={{
                      fontSize: "13px",
                      padding: "8px 10px",
                      fontWeight: 600,
                      color: "#16a34a",
                    }}
                  >
                    ₹{r.tot}
                  </td>
                  <td
                    style={{
                      fontSize: "12px",
                      padding: "8px 10px",
                      color: "#888",
                    }}
                  >
                    {r.payment_method || "Cash"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FrameLoserModal({ frameNo, onChoose, onClose }) {
  const [customerName, setCustomerName] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const cleanName = customerName.trim();
    if (!cleanName) return;
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
            disabled={!customerName.trim()}
          >
            Close frame
          </button>
        </div>
      </form>
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
  const paused = session?.paused || false;
  const T = THEME[table.type];
  const rate = getTableRate(table, rates);
  const total = runningTotalForSession(session, peakRate, gstPercent);
  const closedFrames = session?.frames?.filter((frame) => frame.status === "closed") || [];
  const openFrame = session?.frames?.find((frame) => frame.status === "open");
  const bookingTime = booking ? bookingDisplayTime(booking) : "";

  let status = "Available";
  let tone = "idle";
  if (maintenance) {
    status = "Maintenance";
    tone = "maintenance";
  } else if (occupied) {
    status = paused ? "Paused" : "Running";
    tone = paused ? "paused" : "running";
  } else if (booking) {
    status = "Booked";
    tone = "booked";
  }

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
          <span className={`table-floor-status ${tone}`}>{status}</span>
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
  onReserve,
  onCancelReserve,
  rates,
  maintenance,
  onMaintenance,
  onClearMaintenance,
  onStartFrame,
  onCloseFrame,
  peakRate,
  gstPercent,
  compact = false,
}) {
  const [billingMode, setBillingMode] = useState(() => defaultBillingModeForTable(table));
  const [otherPlayers, setOtherPlayers] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [frameLoserOpen, setFrameLoserOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [resvName, setResvName] = useState("");
  const [resvTime, setResvTime] = useState("");
  const [notes, setNotes] = useState("");
  const [maintReason, setMaintReason] = useState("Under maintenance");

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
      setDiscountType("none");
      setDiscountValue("");
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

  useEffect(() => {
    if (!session || !openFrame || paused) setFrameLoserOpen(false);
  }, [session, openFrame, paused]);

  const pocketStyle = {
    position: "absolute",
    width: "18px",
    height: "18px",
    background: "#050505",
    borderRadius: "50%",
    border: "2px solid #000",
    boxShadow: "inset 0 2px 6px rgba(0,0,0,0.9), 0 0 0 1px #222",
  };

  if (maintenance) {
    return (
      <div
        className={`table-maintenance-card ${compact ? "compact" : ""}`}
        style={{
          background: "#1a1a1a",
          borderRadius: "12px",
          padding: "12px",
          border: "2px solid #f59e0b",
        }}
      >
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#f59e0b",
              letterSpacing: "2px",
              marginBottom: "8px",
            }}
          >
            MAINTENANCE
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "rgba(255,255,255,0.1)",
              marginBottom: "8px",
            }}
          >
            {String(table.num).padStart(2, "0")}
          </div>
          <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>
            {maintenance.reason}
          </div>
          <div
            style={{ fontSize: "11px", color: "#555", marginBottom: "16px" }}
          >
            Since {maintenance.since}
          </div>
          <button
            onClick={() => onClearMaintenance(table.id)}
            style={{
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Mark Available
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
          onClose={() => setFrameLoserOpen(false)}
          onChoose={(player) => {
            setFrameLoserOpen(false);
            onCloseFrame(table.id, player);
          }}
        />
      )}

      <div
        className={`table-session-card ${compact ? "compact" : ""}`}
        style={{
          background: "var(--table-card-bg)",
          borderRadius: "10px",
          overflow: "hidden",
          border: `1px solid ${occupied ? T.accent : "var(--table-card-border)"}`,
          boxShadow: occupied ? `0 16px 34px ${T.accent}22` : "0 1px 2px rgba(15, 23, 42, 0.04)",
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
              borderRadius: "6px",
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
                borderRadius: "3px",
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
                borderRadius: "3px",
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
                borderRadius: "3px",
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
                borderRadius: "3px",
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
                fontSize: compact ? "58px" : "80px",
                fontWeight: 900,
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
                    ? "20px"
                    : "24px"
                  : session?.elapsed >= 3600
                    ? "25px"
                    : "32px",
                fontWeight: 900,
                color: "#ffffff",
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
                  background: "rgba(239,68,68,0.92)",
                  color: "#fff",
                  borderRadius: "999px",
                  padding: "3px 9px",
                  fontSize: "10px",
                  fontWeight: 800,
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
                borderRadius: "14px",
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
                    fontSize: "9px",
                    color: "#fbbf24",
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
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.86)",
                  letterSpacing: "1px",
                  fontWeight: 850,
                  textShadow: "0 1px 5px rgba(0,0,0,0.45)",
                }}
              >
                RUNNING TOTAL{gstPercent > 0 ? " (incl. GST est.)" : ""}
              </div>
              <div
                style={{
                  fontSize: "20px",
                  lineHeight: 1.1,
                  fontWeight: 900,
                  color: "#ffffff",
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
                    fontSize: "10px",
                    fontWeight: 700,
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
                    alert("Close the running frame before closing the table.");
                    return;
                  }
                  onStop(table.id, paymentMethod, discountType, discountValue);
                }}
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: "5px",
                  padding: "6px 28px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  zIndex: 3,
                }}
              >
                <i className="ti ti-receipt-refund" aria-hidden="true" />
                <span>CLOSE TABLE</span>
              </button>
            ) : (
              <button
                onClick={() => onStart(table, billingMode, otherPlayers)}
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: T.accent,
                  color: isPool ? "#fff" : "#000",
                  border: "none",
                  borderRadius: "5px",
                  padding: "6px 28px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  zIndex: 3,
                }}
              >
                <i className="ti ti-player-play" aria-hidden="true" />
                <span>START</span>
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
                onClick={() => setShowHistory(true)}
                title="History"
                className="table-utility-btn"
              >
                <i className="ti ti-clock" aria-hidden="true" />
              </button>
              <button
                onClick={() => setMaintOpen((p) => !p)}
                title="Maintenance"
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
                  try {
                    await onMaintenance(table.id, maintReason);
                    setMaintOpen(false);
                  } catch {
                    alert("Failed");
                  }
                }}
                className="table-mini-primary maintenance"
              >
                Set maintenance
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
                    {billingMode === "single" ? "Customer name" : "First name"}
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
                      {billingMode === "lp" ? "Second name" : "Other names"}
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
                >
                  <i className="ti ti-flag-check" aria-hidden="true" />
                  End frame
                </button>
              </>
            ) : (
                <button
                  type="button"
                  className="table-frame-start"
                  data-testid={`start-frame-${table.id}`}
                  onClick={() => onStartFrame(table.id)}
                >
                  <i className="ti ti-player-play" aria-hidden="true" />
                  Start frame {nextFrameNo}
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
              >
                <i className={`ti ${paused ? "ti-player-play" : "ti-player-pause"}`} aria-hidden="true" />
                <span>{paused ? "Resume" : "Pause"}</span>
              </button>
              <button
                onClick={() => onReset(table.id)}
                data-testid={`reset-${table.id}`}
                className="table-control-btn reset"
              >
                <i className="ti ti-refresh" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>
          )}

          {/* Payment method */}
          {occupied && (
            <div className="table-payment-grid">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`table-payment-btn ${paymentMethod === m ? "active" : ""}`}
                  style={{ "--table-accent": T.accent }}
                >
                  <i
                    className={`ti ${
                      m === "Cash"
                        ? "ti-cash"
                        : m === "UPI"
                          ? "ti-qrcode"
                          : "ti-credit-card"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{m}</span>
                </button>
              ))}
            </div>
          )}

          {occupied && (
            <div className="table-discount-panel">
              <div className="table-discount-options">
                {DISCOUNT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={discountType === option.id ? "active" : ""}
                    onClick={() => {
                      setDiscountType(option.id);
                      if (option.id !== "rupee") setDiscountValue("");
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {discountType === "rupee" && (
                <input
                  className="table-mini-input"
                  type="number"
                  min="0"
                  max="50"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="Max ₹50"
                />
              )}
            </div>
          )}

          {occupied && (
            <>
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
                      try {
                        await updateNotes(table.id, notes);
                        setNotesOpen(false);
                      } catch {
                        alert("Failed");
                      }
                    }}
                    className="table-notes-save"
                  >
                    Save
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
                    onClick={() => {
                      onReserve(table.id, resvName, resvTime);
                      setResvName("");
                      setResvTime("");
                      setReserveOpen(false);
                    }}
                    className="table-mini-primary reserve"
                  >
                    Confirm Reservation
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
              >
                Cancel
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
  const [checkoutBill, setCheckoutBill] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(TABLES[0]?.id || "t1");
  const detailPanelRef = useRef(null);

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
      const res = await getActive();
      const s = {},
        n = {};
      res.data.forEach((x) => {
        const id = tableKey(x.table_id);
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
    try {
      await createBooking(booking);
      await fetchBookings();
      showToast(`${booking.customer_name} booked`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to create booking", "error");
    }
  }

  async function handleCancelBooking(bookingId) {
    try {
      await cancelBooking(bookingId);
      await fetchBookings();
    } catch {
      showToast("Failed to cancel booking", "error");
    }
  }

  async function handleAddToQueue(entry) {
    try {
      await addWaitlistEntry(entry);
      await fetchQueue();
      showToast(`${entry.customer_name} added to queue`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to add to queue", "error");
    }
  }

  async function handleCancelQueue(entryId) {
    try {
      await cancelWaitlistEntry(entryId);
      await fetchQueue();
    } catch {
      showToast("Failed to remove queue entry", "error");
    }
  }

  async function handleSeatQueue(entry, tableId) {
    const table = TABLES.find((t) => t.id === tableId);
    if (!table) return;
    const rate = getTableRate(table, rates);
    const players = [entry.customer_name];
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
      showToast(`${entry.customer_name} seated at T${table.num}`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to seat customer", "error");
    }
  }

  async function handleStart(table, billingMode, otherPlayers) {
    const name = (names[table.id] || "").trim();
    const players = buildPlayers(name, otherPlayers, billingMode);
    const primaryName = players[0];
    const validation = validateBillingPlayers(players, billingMode);
    if (validation) {
      alert(validation);
      return;
    }
    if (sessions[table.id]) {
      alert("Session already running");
      return;
    }
    const rate = getTableRate(table, rates);
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
      fetchQueue();
      fetchBookings();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to start");
    }
  }

  async function handleQuickStart({ table, player1, billingMode, otherPlayers }) {
    const name = (player1 || "").trim();
    const players = buildPlayers(name, otherPlayers, billingMode);
    const primaryName = players[0];
    const validation = validateBillingPlayers(players, billingMode);
    if (validation) {
      alert(validation);
      return false;
    }
    if (sessions[table.id]) {
      alert("Session already running");
      return false;
    }
    if (maintenance[table.id]) {
      alert(`Table is under maintenance: ${maintenance[table.id].reason}`);
      return false;
    }
    const rate = getTableRate(table, rates);
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
      fetchQueue();
      fetchBookings();
      onSessionEnd?.();
      showToast(`Session started on T${table.num}`, "success");
      return true;
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to start session", "error");
      return false;
    }
  }

  async function handlePause(id) {
    if (!sessions[id]) return;
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
    } catch {
      alert("Failed to pause");
    }
  }

  async function handleReset(id) {
    if (!confirm("Reset this table?")) return;
    try {
      await resetSession(id);
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
    } catch (e) {
      if (e.response?.status === 403) {
        const pin = prompt("Manager PIN required:");
        if (!pin) return;
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
          return;
        } catch (retryErr) {
          alert(retryErr.response?.data?.detail || "Failed to reset");
          return;
        }
      }
      alert(e.response?.data?.detail || "Failed to reset");
    }
  }

  async function handleStartFrame(id) {
    if (!sessions[id]) return;
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
      showToast(`Frame ${res.data.frame?.frame_no || ""} started`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to start frame", "error");
    }
  }

  async function handleCloseFrame(id, loserName) {
    if (!sessions[id]) return;
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
      showToast(`Frame ${res.data.frame?.frame_no || ""} closed`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to close frame", "error");
    }
  }

  async function handleStop(
    id,
    paymentMethod = "Cash",
    discountType = "none",
    discountValue = "",
  ) {
    const name = (names[id] || "").trim();
    if (!name || !sessions[id]) {
      showToast("No active session", "error");
      return;
    }
    async function performCheckout() {
      const res = await stopSession(
        id,
        paymentMethod,
        "",
        discountType,
        parseInt(discountValue, 10) || 0,
      );
      const rec = { ...res.data };
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
      onSessionEnd();
      fetchQueue();
      showToast(`Table closed (${rec.payment_method || paymentMethod})`, "success");

      setCheckoutBill({ tableId: id, rec, paymentMethod });
    }

    try {
      await performCheckout();
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to close table", "error");
    }
  }

  async function handleReserve(id, name, time) {
    if (!name || !time) {
      alert("Enter name and time");
      return;
    }
    const table = TABLES.find((item) => item.id === tableKey(id));
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
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to reserve", "error");
    }
  }

  async function handleCancelReserve(id) {
    const booking = nextBookingByTable[tableKey(id)];
    try {
      if (booking?.id) {
        await cancelBooking(booking.id);
        await fetchBookings();
        showToast("Reservation cancelled", "success");
        return;
      }
      setSessions((prev) => ({
        ...prev,
        [tableKey(id)]: { ...(prev[tableKey(id)] || {}), reservation: null },
      }));
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to cancel reservation", "error");
    }
  }

  async function handleSetMaintenance(tableId, reason) {
    try {
      await saveMaintenance(tableId, reason);
      setMaintenance((prev) => ({
        ...prev,
        [tableId]: { reason, since: new Date().toLocaleString("en-IN") },
      }));
    } catch {
      alert("Failed");
    }
  }

  async function handleClearMaintenance(tableId) {
    try {
      await clearMaintenance(tableId);
      setMaintenance((prev) => {
        const n = { ...prev };
        delete n[tableId];
        return n;
      });
    } catch {
      alert("Failed");
    }
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
              onReserve={handleReserve}
              onCancelReserve={handleCancelReserve}
              rates={rates}
              maintenance={maintenance[selectedTable.id] || null}
              onMaintenance={handleSetMaintenance}
              onClearMaintenance={handleClearMaintenance}
              onStartFrame={handleStartFrame}
              onCloseFrame={handleCloseFrame}
              peakRate={peakRate}
              gstPercent={gstPercent}
              showToast={showToast}
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
        />

        <BookingPanel
          bookings={bookings}
          onCreate={handleCreateBooking}
          onCancel={handleCancelBooking}
        />
      </div>
    </>
  );
}
