import { Panel as HsrPanel, Card as HsrCard } from "../ui/index.js";
import { formatCurrency as polishCurrency, formatDuration as polishDuration, formatDateTime as polishDateTime } from "../../utils/format.js";
import { SkeletonBlock, EmptyState } from "../ui/index.js";
import RetryNotice from "../RetryNotice.jsx";
import { Icon as HsrIcon, Input as HsrInput, Select as HsrSelect, Button as HsrButton, Textarea as HsrTextarea } from "../ui/index.js";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  startSession,
  startGuestSession,
  pauseSession,
  resetSession,
  getLiveFloor,
  getRates,
  updateNotes,
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
  transferSession,
} from "../../api/index.js";
import { searchMembers } from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { HistoryModal, ResetConfirmModal } from "./TableDialogs.jsx";
import { TableAttentionBadge, TablePrimaryAction, TableStateBadge } from "../TableStateUI.jsx";
import { HSR_TABLES, getTableLabel, getTableRate } from "../../config/hsrTables.js";
import { tableStateAttributes, getTableAttention, getTableStatus } from "../../config/tableStatus.js";
import { readableFloorSnapshot } from "../../features/live-floor/floorData.js";
import StartSessionModal from "../../features/sessions/StartSessionModal.jsx";
import FrameControls from "../../features/sessions/FrameControls.jsx";
import { tariffDescription } from "../../features/sessions/tariffs.js";

const TABLES = HSR_TABLES;
const tableKey = (tableId) => String(tableId || "").trim().toLowerCase();

function fmt(secs) { return polishDuration(secs); }

function fmtClock(ms) {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isFullName(name) {
  return name.trim().length > 0;
}

function splitPlayerNames(value) {
  return (value || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
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
  if (Number.isFinite(session.running_total)) return session.running_total;
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
    <div className="table-player-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setShow(false); }}>
      <HsrIcon className="ti ti-user table-player-icon" aria-hidden="true" />
      <HsrInput
        placeholder={placeholder || undefined}
        aria-label={placeholder || "Player name"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length && setShow(true)}
        autoComplete="off"
        className="table-player-input polish-margin-0"

      />
      {show && (
        <div
          className="polish-position-absolute polish-top-100 polish-left-0 polish-right-0 polish-z-index-300 polish-background-surface polish-border-1px-solid-border polish-border-radius-radius-sm polish-margin-top-4px polish-box-shadow-shadow-md polish-overflow-hidden"
        >
          {suggestions.map((m) => (
            <HsrButton native className="table-player-suggestion"
              key={m.id}
              onClick={() => {
                onChange(m.nm);
                setShow(false);
              }}
            >
              <span className="polish-color-text-primary polish-font-weight-weight-medium" >{m.nm}</span>
              <span className="type-xs polish-color-accent-text polish-background-accent-bg polish-border-1px-solid-color-mix-in-srgb-accent-28-border polish-padding-0px-4px polish-border-radius-radius-sm"

              >
                {m.id}
              </span>
            </HsrButton>
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
  loading = false,
  error = "",
  onRetry,
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
    <HsrPanel as="div" className="queue-panel">
      <div className="queue-head">
        <div>
          <div className="queue-title">Smart table queue</div>
          <div className="queue-sub">
            {queue.length} waiting · {TABLES.length - activeCount} table{TABLES.length - activeCount === 1 ? "" : "s"} idle
          </div>
        </div>
        <HsrIcon className="ti ti-list-check" aria-hidden="true" />
      </div>

      <form className="queue-form" onSubmit={submit}>
        <HsrInput
          className="table-mini-input"
          placeholder="Customer name"
          aria-label="Walk-in customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
        <HsrInput
          className="table-mini-input"
          placeholder="Phone optional"
          aria-label="Walk-in phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <HsrInput
          className="table-mini-input"
          type="number"
          min="1"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          aria-label="Party size"
        />
        <HsrSelect
          className="table-mini-input"
          value={preferredType}
          aria-label="Preferred table type"
          onChange={(e) => setPreferredType(e.target.value)}
        >
          <option value="ANY">Any table</option>
          <option value="POOL">Pool</option>
          <option value="SNOOKER">Snooker</option>
        </HsrSelect>
        <HsrInput
          className="table-mini-input queue-notes-input"
          aria-label="Walk-in notes"
          placeholder="Notes optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <HsrButton native className="primary-action-btn" type="submit" disabled={!!busyActions["queue-add"]}>
          {busyActions["queue-add"] ? "Adding..." : "Add Walk-in"}
        </HsrButton>
      </form>

      <div className="queue-list">
        {loading ? <SkeletonBlock rows={3} label="Loading walk-in queue" /> : error ? <RetryNotice message={error} onRetry={onRetry} /> : queue.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-icon">
              <HsrIcon className="ti ti-users-plus" aria-hidden="true" />
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
                  <div className="queue-name" title={entry.customer_name}>{entry.customer_name}</div>
                  <div className="queue-meta">
                    {entry.preferred_type === "ANY" ? "Any table" : entry.preferred_type} · {entry.party_size} player{entry.party_size === 1 ? "" : "s"} · {entry.wait_mins}m
                  </div>
                  {entry.notes && <div className="queue-note">{entry.notes}</div>}
                </div>
                <div className="queue-actions">
                  <HsrButton native
                    type="button"
                    className="queue-seat-btn"
                    disabled={!table || !!busyActions[`seat-queue:${entry.id}`]}
                    onClick={() => table && onSeat(entry, table.id)}
                  >
                    {busyActions[`seat-queue:${entry.id}`] ? "Seating..." : table ? `Seat T${table.num}` : "Waiting"}
                  </HsrButton>
                  <HsrButton native
                    type="button"
                    className="icon-danger-btn"
                    onClick={() => onCancel(entry.id)}
                    disabled={!!busyActions[`cancel-queue:${entry.id}`]}
                    aria-label={`Cancel queue entry for ${entry.customer_name}`}
                  >
                    {busyActions[`cancel-queue:${entry.id}`] ? "..." : <HsrIcon className="ti ti-x" aria-hidden="true" />}
                  </HsrButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </HsrPanel>
  );
}

function BookingPanel({ bookings, onCreate, onCancel, busyActions = {}, showToast, loading = false, error = "", onRetry }) {
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
    <HsrPanel as="div" className="booking-panel">
      <div className="queue-head">
        <div>
          <div className="queue-title">Booking calendar</div>
          <div className="queue-sub">
            {activeBookings.length} active · {missedBookings.length} missed
          </div>
        </div>
        <HsrIcon className="ti ti-calendar" aria-hidden="true" />
      </div>
      <div className="booking-grace-note">
        <HsrIcon className="ti ti-clock-exclamation" aria-hidden="true" />
        <span>
          No-shows are auto-released after the grace period.
        </span>
      </div>
      <form className="booking-form" onSubmit={submit}>
        <HsrInput
          className="table-mini-input"
          placeholder="Full customer name"
          aria-label="Booking customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
        <HsrInput
          className="table-mini-input"
          placeholder="Phone optional"
          aria-label="Booking phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <HsrSelect
          className="table-mini-input"
          value={tableId}
          aria-label="Booking table"
          onChange={(e) => setTableId(e.target.value)}
        >
          <option value="ANY">Any table</option>
          {TABLES.map((t) => (
            <option key={t.id} value={t.id.toUpperCase()}>
              T{t.num} · {t.type}
            </option>
          ))}
        </HsrSelect>
        <HsrInput
          className="table-mini-input"
          type="datetime-local"
          aria-label="Booking date and time"
          value={bookingTime}
          onChange={(e) => setBookingTime(e.target.value)}
          required
        />
        <HsrInput
          className="table-mini-input"
          type="number"
          min="30"
          step="30"
          value={durationMins}
          onChange={(e) => setDurationMins(e.target.value)}
          aria-label="Duration minutes"
        />
        <HsrInput
          className="table-mini-input booking-notes-input"
          aria-label="Booking notes"
          placeholder="Notes optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <HsrButton native className="primary-action-btn" type="submit" disabled={!!busyActions["booking-create"]}>
          {busyActions["booking-create"] ? "Booking..." : "Book table"}
        </HsrButton>
      </form>
      <div className="booking-list">
        {loading ? <SkeletonBlock rows={3} label="Loading table bookings" /> : error ? <RetryNotice message={error} onRetry={onRetry} /> : bookings.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-icon"><HsrIcon className="ti ti-calendar-plus" aria-hidden="true" /></div>
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
                  <div className="queue-name" title={booking.customer_name}>
                    {booking.customer_name}
                    {missed && (
                      <span className="booking-status-pill">Missed</span>
                    )}
                  </div>
                  <div className="queue-meta">
                    {polishDateTime(booking.booking_time)} ·{" "}
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
                  <HsrButton native
                    className="icon-danger-btn"
                    type="button"
                    onClick={() => onCancel(booking.id)}
                    disabled={!!busyActions[`cancel-booking:${booking.id}`]}
                    aria-label="Cancel booking"
                  >
                    {busyActions[`cancel-booking:${booking.id}`] ? "..." : <HsrIcon className="ti ti-x" aria-hidden="true" />}
                  </HsrButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </HsrPanel>
  );
}














function TableFloorTile({
  table,
  tableState,
  session,
  booking,
  rates,
  maintenance,
  selected,
  onSelect,
  onQuickStart,
  onCheckout,
  onReviewBooking,
  checkoutBusy = false,
  peakRate,
  gstPercent,
}) {
  const occupied = !!session;
  const rate = getTableRate(table, rates);
  const total = runningTotalForSession(session, peakRate, gstPercent);
  const bookingTime = booking ? bookingDisplayTime(booking) : "";

  const status = getTableStatus({ session, booking, maintenance });
  const statusKey = tableState?.status_key || status.key;
  const statusLabel = tableState?.status_label || status.label;
  const elapsedSeconds = Number(session?.elapsed || tableState?.elapsed_seconds || 0);
  const attention = getTableAttention({ session: tableState?.session || session, elapsedSeconds });
  const disabled = statusKey === "maintenance";

  function handlePrimary(event) {
    event.stopPropagation();
    if (disabled) return;
    onSelect();
    if (statusKey === "available") onQuickStart?.();
    else if (statusKey === "running" || statusKey === "paused") onCheckout?.();
    else if (statusKey === "reserved") onReviewBooking?.();
  }

  return (
    <HsrCard as="article"
      className={`table-floor-tile table-state-card ${selected ? "selected" : ""}`}
      {...tableStateAttributes(statusKey)}
      data-attention={attention ? "true" : "false"}
      onClick={() => !disabled && onSelect()}
      aria-current={selected ? "true" : undefined}
      role="button"
      aria-label={`T${table.num} ${statusLabel}`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if ((event.key === "Enter" || event.key === " ") && !disabled) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="table-floor-index">
        <strong>T{table.num}</strong>
        <span>{getTableLabel(table)}</span>
        <TableAttentionBadge attention={attention} />
      </div>

      <div className="table-floor-body">
        <div className="table-floor-topline">
          <TableStateBadge statusKey={statusKey} label={statusLabel} />
          <strong>{polishCurrency(rate)}/hr</strong>
        </div>
        <div className="table-floor-summary">
          <strong className={occupied ? "table-state-timer" : ""} data-timer={status.timerStyle}>
            {occupied ? fmt(session.elapsed) : booking ? bookingTime : `${polishCurrency(rate)}/hr`}
          </strong>
          <span title={occupied ? `${polishCurrency(total)} running` : maintenance?.reason || booking?.customer_name || undefined}>
            {occupied
              ? `${polishCurrency(total)} running`
              : maintenance
                ? maintenance.reason
                : booking
                  ? `${booking.customer_name} reserved`
                  : "Ready to start"}
          </span>
        </div>
        <div className="table-floor-meta">
          {occupied ? (
            <>
              <span>Started {fmtClock(session.startTime)}</span>
              <span>{billingModeLabel(session.billingMode)}</span>
            </>
          ) : maintenance ? (
            <span>Marked since {maintenance.since || "now"}</span>
          ) : booking ? (
            <span title={booking.customer_name}>{booking.customer_name} · {booking.duration_mins || 60} min</span>
          ) : (
            <span>Tap to start or reserve</span>
          )}
        </div>
      </div>
      <TablePrimaryAction statusKey={statusKey} onClick={handlePrimary} disabled={checkoutBusy} loading={checkoutBusy} />
    </HsrCard>
  );
}

function LiveFloorCommand({
  tables,
  tableStates,
  sessions,
  maintenance,
  bookings,
  selectedTableId,
  onSelect,
  onQuickStart,
  compact,
  viewMode,
  onViewModeChange,
  peakRate,
  gstPercent,
}) {
  const activeTables = tables.filter((table) => sessions[table.id]);
  const pausedTables = activeTables.filter((table) => sessions[table.id]?.paused);
  const reservedTables = tables.filter((table) => bookings[table.id] && !sessions[table.id]);
  const maintenanceTables = tables.filter((table) => maintenance[table.id]);
  const liveValue = activeTables.reduce(
    (sum, table) => sum + runningTotalForSession(sessions[table.id], peakRate, gstPercent),
    0,
  );
  const selectedTable = tables.find((table) => table.id === selectedTableId);
  const selectedState = tableStates[selectedTableId];
  const selectedStatus = selectedState?.status_label || (
    selectedTable
      ? getTableStatus({
          session: sessions[selectedTable.id],
          booking: bookings[selectedTable.id],
          maintenance: maintenance[selectedTable.id],
        }).label
      : "Available"
  );

  return (
    <section className="live-floor-command" aria-label="Live floor command">
      <div className="live-floor-command-main">
        <div>
          <div className="tables-view-title">Live Floor Control</div>
          <div className="tables-view-sub">
            {activeTables.length
              ? `${activeTables.length} running · ${polishCurrency(liveValue)} live value`
              : "All tables idle. Start from the floor or quick session."}
          </div>
        </div>
        <HsrButton native type="button" className="live-floor-primary" onClick={onQuickStart}>
          <HsrIcon className="ti ti-player-play" aria-hidden="true" />
          Start Table
        </HsrButton>
      </div>

      <div className="live-floor-stats" aria-label="Floor status summary">
        {[
          ["Running", activeTables.length],
          ["Paused", pausedTables.length],
          ["Reserved", reservedTables.length],
          ["Maintenance", maintenanceTables.length],
          ["Idle", Math.max(tables.length - activeTables.length - reservedTables.length - maintenanceTables.length, 0)],
        ].map(([label, value]) => (
          <div className="live-floor-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="live-floor-session-row">
        <div className="live-floor-selected">
          <span>Selected</span>
          <strong>
            {selectedTable ? `T${selectedTable.num} · ${getTableLabel(selectedTable)}` : "No table"} · {selectedStatus}
          </strong>
        </div>
        <div className="live-floor-running-list">
          {activeTables.length === 0 ? (
            <span className="live-floor-empty-chip">No active sessions</span>
          ) : (
            activeTables.map((table) => {
              const session = sessions[table.id];
              return (
                <HsrButton native
                  type="button"
                  key={table.id}
                  className={`live-session-chip ${selectedTableId === table.id ? "active" : ""}`}
                  onClick={() => onSelect(table.id)}
                >
                  <strong>T{table.num}</strong>
                  <span>{fmt(session?.elapsed)} · {polishCurrency(runningTotalForSession(session, peakRate, gstPercent))}</span>
                  <em>{billingModeLabel(session?.billingMode)}</em>
                </HsrButton>
              );
            })
          )}
        </div>
        <div className="segmented-control" aria-label="Table card density">
          {[
            ["detailed", "Detailed", "ti-layout-grid"],
            ["compact", "Compact", "ti-layout-list"],
          ].map(([mode, label, icon]) => (
            <HsrButton native
              key={mode}
              type="button"
              className={viewMode === mode ? "active" : ""}
              onClick={() => onViewModeChange(mode)}
              aria-pressed={viewMode === mode}
            >
              <HsrIcon className={`ti ${icon}`} aria-hidden="true" />
              <span>{compact && mode === "detailed" ? "Detail" : label}</span>
            </HsrButton>
          ))}
        </div>
      </div>
    </section>
  );
}

function SessionWorkspace({
  table,
  tableState,
  session,
  booking,
  maintenance,
  rates,
  peakRate,
  gstPercent,
  onPause,
  onStop,
  onAddFood,
  busyActions = {},
}) {
  const status = tableState?.status_label || getTableStatus({ session, booking, maintenance }).label;
  const statusTone = tableState?.status_tone || getTableStatus({ session, booking, maintenance }).tone;
  const rate = tableState?.rate ?? getTableRate(table, rates);
  const total = runningTotalForSession(session, peakRate, gstPercent);
  const players = visiblePlayerNames(session?.players || []);
  const foodItems = session?.foodItems || [];
  const pauseBusy = !!busyActions[`pause:${table.id}`];
  const quoteBusy = !!busyActions[`quote:${table.id}`];
  const foodPlayer = session?.players?.[0] || session?.customer_name || "";
  const nextBooking = booking
    ? `${booking.customer_name} · ${bookingDisplayTime(booking)}`
    : "No upcoming booking";

  return (
    <section className={`session-workspace ${session ? "active" : ""}`} aria-label={`T${table.num} session workspace`}>
      <div className="session-workspace-head">
        <div>
          <span className={`session-status-pill ${statusTone}`}>{status}</span>
          <h3>T{table.num} · {getTableLabel(table)}</h3>
          <p>{polishCurrency(rate)}/hr · {table.type === "POOL" ? "Pool" : "Snooker"}</p>
        </div>
        <div className="session-workspace-total">
          <span>{session ? "Running total" : "Current total"}</span>
          <strong>{polishCurrency(total)}</strong>
        </div>
      </div>

      <div className="session-workspace-grid">
        <div className="session-workspace-stat">
          <span>Timer</span>
          <strong>{fmt(session?.elapsed)}</strong>
          <em>{session ? `Started ${fmtClock(session.startTime)}` : "Ready to start"}</em>
        </div>
        <div className="session-workspace-stat">
          <span>Players</span>
          <strong>{players.length || "-"}</strong>
          <em title={players.join(", ")}>{players.length ? players.join(", ") : "Walk-in names optional"}</em>
        </div>
        <div className="session-workspace-stat">
          <span>Food tab</span>
          <strong>{polishCurrency(session?.foodTotal)}</strong>
          <em>{foodItems.length ? `${foodItems.length} item${foodItems.length === 1 ? "" : "s"}` : "No food added"}</em>
        </div>
      </div>

      <div className="session-workspace-context">
        <div>
          <span>Booking</span>
          <strong>{nextBooking}</strong>
        </div>
        <div>
          <span>Billing mode</span>
          <strong>{session ? billingModeLabel(session.billingMode) : "Choose below"}</strong>
        </div>
      </div>

      {session && (
        <div className="session-workspace-actions">
          <HsrButton native
            type="button"
            className="session-action secondary"
            onClick={() => onAddFood?.({
              tableId: table.id,
              playerName: foodPlayer,
            })}
          >
            <HsrIcon className="ti ti-tools-kitchen-2" aria-hidden="true" />
            Add Food
          </HsrButton>
          <HsrButton native
            type="button"
            className="session-action secondary"
            onClick={() => onPause(table.id)}
            disabled={pauseBusy}
          >
            <HsrIcon className={`ti ${session.paused ? "ti-player-play" : "ti-player-pause"}`} aria-hidden="true" />
            {pauseBusy ? "Saving..." : session.paused ? "Resume Session" : "Pause Session"}
          </HsrButton>
          <HsrButton native
            type="button"
            className="session-action primary"
            onClick={() => onStop(table.id)}
            disabled={quoteBusy}
            title="Open checkout"
          >
            <HsrIcon className="ti ti-receipt-refund" aria-hidden="true" />
            {quoteBusy ? "Loading..." : "Open Checkout"}
          </HsrButton>
        </div>
      )}
    </section>
  );
}

function TableCard({
  table,
  session,
  booking,
  onStart,
  onPause,
  onReset,
  onStop,
  onTransfer,
  transferTargets = [],
  onReserve,
  onCancelReserve,
  onReviewBooking,
  rates,
  maintenance,
  onMaintenance,
  onClearMaintenance,
  onSaveNotes,
  onRefresh,
  peakRate,
  gstPercent,
  busyActions = {},
  compact = false,
}) {
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

  const occupied = !!session;
  const paused = session?.paused || false;
  const rate = getTableRate(table, rates);
  const status = getTableStatus({ session, booking, maintenance });

  const mins = session ? Math.max(1, Math.round(session.elapsed / 60)) : 0;
  const basePlay = session ? Math.round((mins / 60) * session.rate) : 0;
  const multiplier = peakRate?.multiplier || 1;
  const play = session ? Math.round(basePlay * multiplier) : 0;
  const subtotal = play + (session?.foodTotal || 0);
  const gstAmt =
    gstPercent > 0 && subtotal > 0 ? Math.round((subtotal * gstPercent) / 100) : 0;
  const total = session?.running_total ?? (subtotal + gstAmt);
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
  const shareCount = activeBillingMode === "sharing" ? Math.max(1, activePlayers.length) : 1;
  const shareAmount = shareCount > 1 ? Math.ceil(total / shareCount) : total;
  const startBusy = !!busyActions[`start:${table.id}`];
  const quoteBusy = !!busyActions[`quote:${table.id}`];
  const pauseBusy = !!busyActions[`pause:${table.id}`];
  const resetBusy = !!busyActions[`reset:${table.id}`];
  const maintenanceBusy = !!busyActions[`maintenance:${table.id}`];
  const notesBusy = !!busyActions[`notes:${table.id}`];
  const transferBusy = !!busyActions[`transfer:${table.id}`];
  const reserveBusy = !!busyActions[`reserve:${table.id}`];
  const cancelReserveBusy = !!busyActions[`cancel-reserve:${table.id}`];

  if (maintenance) {
    return (
      <HsrCard as="div"
        className={[`table-maintenance-card table-state-card ${compact ? "compact" : ""}`, "polish-background-surface polish-border-radius-radius-md polish-padding-12px polish-border-2px-solid-warning"].filter(Boolean).join(" ")}
        {...tableStateAttributes(status.key)}

      >
        <div className="polish-text-align-center polish-padding-16px-0" >
          <TableStateBadge statusKey={status.key} />
          <div className="type-3xl polish-font-weight-weight-heavy polish-color-text-muted polish-margin-bottom-8px"

          >
            {String(table.num).padStart(2, "0")}
          </div>
          <div className="type-sm polish-color-text-secondary polish-margin-bottom-4px" >
            {maintenance.reason}
          </div>
          <div className="type-xs polish-color-text-muted polish-margin-bottom-16px"

          >
            Since {maintenance.since}
          </div>
          <HsrButton native className="type-sm polish-background-accent polish-color-text-on-accent polish-border-none polish-border-radius-radius-sm polish-padding-8px-16px polish-font-weight-weight-semibold"
            onClick={() => onClearMaintenance(table.id)}
            disabled={clearMaintenanceBusy}
            style={{ cursor: clearMaintenanceBusy ? "wait" : "pointer" }}
          >
            {clearMaintenanceBusy ? "Saving..." : "Mark Available"}
          </HsrButton>
        </div>
      </HsrCard>
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

      {resetOpen && (
        <ResetConfirmModal
          tableId={table.id}
          loading={resetBusy}
          onClose={() => setResetOpen(false)}
          onConfirm={(pin) => onReset(table.id, pin)}
        />
      )}

      <HsrCard as="div"
        className={`table-session-card table-state-card ${compact ? "compact" : ""} ${occupied ? "occupied" : ""}`}
        {...tableStateAttributes(status.key)}
      >
        <div className="table-session-state-summary">
          <div className="table-state-card-flags">
            <TableAttentionBadge attention={getTableAttention({ session: { ...session, leakage_alert: session?.leakageAlert }, elapsedSeconds: session?.elapsed })} />
            <TableStateBadge statusKey={status.key} />
          </div>
          <strong>T{table.num} · {getTableLabel(table)}</strong>
          {occupied ? (
            <>
              <span className="table-state-timer" data-timer={status.timerStyle}>{fmt(session.elapsed)}</span>
              <span title={activePlayers.join(", ") || session.customer_name || "Guest"}>{activePlayers.join(", ") || session.customer_name || "Guest"} · {polishCurrency(total)} running</span>
            </>
          ) : (
            <>
              <span className="table-state-rate">{polishCurrency(rate)}/hr</span>
              {booking && <span title={booking.customer_name}>{bookingDisplayTime(booking)} · {booking.customer_name}</span>}
            </>
          )}
        </div>

        {/* ── CONTROLS PANEL BELOW TABLE ── */}
        <div className="table-control-panel">
          {/* Top row — rate, history, maintenance */}
          <div className="table-control-top">
            <span className="table-rate-line">
              {polishCurrency(rate)}/hr · {getTableLabel(table)}
            </span>
            <div className="table-utility-cluster">
              <HsrButton native
                type="button"
                onClick={() => setShowHistory(true)}
                title="History"
                aria-label={`Open T${table.num} history`}
                className="table-utility-btn"
              >
                <HsrIcon className="ti ti-clock" aria-hidden="true" />
              </HsrButton>
              <HsrButton native
                type="button"
                onClick={() => setMaintOpen((p) => !p)}
                title="Maintenance"
                aria-label={`Toggle T${table.num} maintenance controls`}
                className={`table-utility-btn ${maintOpen ? "active" : ""}`}
              >
                <HsrIcon className="ti ti-tool" aria-hidden="true" />
              </HsrButton>
            </div>
          </div>

          {/* Maintenance panel */}
          {maintOpen && (
            <div className="table-inline-panel maintenance">
              <HsrInput
                placeholder="Reason"
                aria-label={`T${table.num} maintenance reason`}
                value={maintReason}
                onChange={(e) => setMaintReason(e.target.value)}
                className="table-mini-input"
              />
              <HsrButton native
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
                </HsrButton>
              </div>
            )}

          {occupied && (
            <div className="active-billing-summary">
              <span>{billingModeLabel(activeBillingMode)} · {tariffDescription(session)}</span>
              <strong>Session started {fmtClock(session.startTime)}</strong>
              <strong>Session end {paused ? "Paused" : "Running"}</strong>
              {activeBillingMode === "sharing" && shareCount > 1 && (
                <strong>{polishCurrency(shareAmount)} each</strong>
              )}
              {activeBillingMode === "lp" && <strong>LP session</strong>}
            </div>
          )}

          {occupied && <FrameControls tableId={table.id} session={session} onRefresh={onRefresh} />}
          {occupied && (
            <div className="table-session-actions">
              <HsrButton native
                onClick={() => onPause(table.id)}
                data-testid={`pause-${table.id}`}
                className={`table-control-btn ${paused ? "resume" : "pause"}`}
                disabled={pauseBusy}
              >
                <HsrIcon className={`ti ${paused ? "ti-player-play" : "ti-player-pause"}`} aria-hidden="true" />
                <span>{pauseBusy ? "Saving..." : paused ? "Resume" : "Pause"}</span>
              </HsrButton>
              <HsrButton native
                onClick={() => setResetOpen(true)}
                data-testid={`reset-${table.id}`}
                className="table-control-btn reset"
                disabled={resetBusy}
              >
                <HsrIcon className="ti ti-refresh" aria-hidden="true" />
                <span>{resetBusy ? "Resetting..." : "Reset Table"}</span>
              </HsrButton>
            </div>
          )}

          {occupied && (
            <>
              <HsrButton native
                onClick={() => setTransferOpen((prev) => !prev)}
                className={`table-notes-btn ${transferOpen ? "active" : ""}`}
              >
                <HsrIcon className="ti ti-arrows-exchange" aria-hidden="true" />
                <span>{transferOpen ? "Close transfer" : "Transfer table"}</span>
              </HsrButton>
              {transferOpen && (
                <div className="table-inline-panel">
                  <label className="table-field-stack">
                    <span>Move to</span>
                    <HsrSelect
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
                    </HsrSelect>
                  </label>
                  <HsrButton native
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
                  </HsrButton>
                </div>
              )}
              <HsrButton native
                onClick={() => setNotesOpen((p) => !p)}
                className={`table-notes-btn ${notesOpen || session?.notes ? "active" : ""}`}
              >
                <HsrIcon className="ti ti-note" aria-hidden="true" />
                <span>{notesOpen ? "Close notes" : "Notes"}</span>
                {session?.notes && <span className="notes-dot">Saved</span>}
              </HsrButton>
              {notesOpen && (
                <div className="table-notes-panel">
                  <HsrTextarea
                    placeholder="e.g. Tournament match..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="table-notes-textarea"
                  />
                  <HsrButton native
                    onClick={async () => {
                      const success = await onSaveNotes(table.id, notes);
                      if (success) {
                        setNotesOpen(false);
                      }
                    }}
                    className="table-notes-save"
                    disabled={notesBusy}
                  >
                    {notesBusy ? "Saving..." : "Save Notes"}
                  </HsrButton>
                </div>
              )}
            </>
          )}

          {/* Reserve */}
          {!occupied && !booking && (
            <>
              <HsrButton native
                onClick={() => setReserveOpen((p) => !p)}
                data-testid={`reserve-${table.id}`}
                className={`table-secondary-btn reserve ${reserveOpen ? "active" : ""}`}
              >
                <HsrIcon className="ti ti-calendar-plus" aria-hidden="true" />
                <span>{reserveOpen ? "Close reservation" : "Reserve table"}</span>
              </HsrButton>
              {reserveOpen && (
                <div className="table-inline-panel">
                  <label className="table-field-stack">
                    <span>Reservation name</span>
                    <HsrInput
                      type="text"
                      value={resvName}
                      onChange={(e) => setResvName(e.target.value)}
                      className="table-mini-input"
                    />
                  </label>
                  <label className="table-field-stack">
                    <span>Time</span>
                    <HsrInput
                      type="time"
                      value={resvTime}
                      onChange={(e) => setResvTime(e.target.value)}
                      className="table-mini-input"
                    />
                  </label>
                  <HsrButton native
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
                    {reserveBusy ? "Reserving..." : "Reserve Table"}
                  </HsrButton>
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
              <HsrButton native
                onClick={() => onCancelReserve(table.id)}
                className="table-reservation-cancel"
                disabled={cancelReserveBusy}
              >
                {cancelReserveBusy ? "Cancelling..." : "Cancel Reservation"}
              </HsrButton>
            </div>
          )}
          <TablePrimaryAction
            statusKey={status.key}
            disabled={startBusy || quoteBusy || pauseBusy}
            loading={startBusy || quoteBusy}
            onClick={() => {
              if (occupied) onStop(table.id);
              else if (booking) onReviewBooking?.();
              else onStart(table);
            }}
          />
        </div>
      </HsrCard>
    </>
  );
}

export default function TablesTab({ onSessionEnd, newSessionRequest = 0, onOpenFoodOrder, onNavigate }) {
  const { showToast } = useToast();
  const [initialLoading, setInitialLoading] = useState(true);
  const [floorReady, setFloorReady] = useState(false);
  const [readErrors, setReadErrors] = useState({});
  const [queueLoading, setQueueLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [sessions, setSessions] = useState({});
  const [tableStates, setTableStates] = useState({});
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
  const [selectedTableId, setSelectedTableId] = useState(TABLES[0]?.id || "t1");
  const [busyActions, setBusyActions] = useState({});
  const busyActionsRef = useRef({});
  const detailPanelRef = useRef(null);
  const tableGridRef = useRef(null);

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
    refreshControls();
    const pricingIv = setInterval(fetchPricing, 60000);
    return () => clearInterval(pricingIv);
    // Initial reads use imported API helpers and stable setters; actions explicitly refresh later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const res = await getLiveFloor();
      const floor = res.data?.floor || {};
      const payload = floor.tables || res.data?.tables;
      if (!Array.isArray(payload)) throw new Error("Floor data unavailable");
      const tableRows = readableFloorSnapshot({ tables: payload }).tables;
      const floorResources = floor.resources || {};
      const s = {},
        n = {};
      const nextTableStates = {};
      tableRows.forEach((tableState) => {
        const stateId = tableKey(tableState.id);
        if (stateId) {
          nextTableStates[stateId] = tableState;
        }
        const x = tableState.session;
        if (!x) return;
        const id = tableKey(x.table_id || tableState.id);
        const billingMode = x.billing_mode || (x.split ? "lp" : "single");
        const players = x.players?.length
          ? x.players
          : [x.customer_name, ...(x.split_name ? splitPlayerNames(x.split_name) : [])].filter(Boolean);
        s[id] = {
          ...x,
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
          loserPays: billingMode === "lp",
          player1: players[0] || x.customer_name,
          player2: players.slice(1).join(", "),
          leakageAlert: x.leakage_alert || false,
        };
        n[id] = x.customer_name;
      });
      setSessions(s);
      setTableStates(nextTableStates);
      setNames(n);
      setFloorReady(true);
      clearReadError("floor");
      if (floorResources.rates || res.data.rates) setRates(floorResources.rates || res.data.rates);
      if (floorResources.maintenance || res.data.maintenance) {
        setMaintenance(floorResources.maintenance || res.data.maintenance);
      }
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, floor: e.userMessage || "Table statuses could not load." }));
    } finally {
      setInitialLoading(false);
    }
  }

  async function fetchRates() {
    try {
      const rRes = await getRates();
      if (!rRes.data || typeof rRes.data !== "object") throw new Error("Rates unavailable");
      setRates(rRes.data);
      clearReadError("rates");
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, rates: e.userMessage || "Table rates could not load." }));
    }
  }

  async function fetchMaintenance() {
    try {
      const res = await getMaintenance();
      setMaintenance(res.data || {});
      clearReadError("maintenance");
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, maintenance: e.userMessage || "Maintenance statuses could not load." }));
    }
  }

  async function fetchPricing() {
    try {
      const [peakRes, gstRes] = await Promise.all([getCurrentRate(), getGST()]);
      if (!peakRes.data || !gstRes.data) throw new Error("Pricing unavailable");
      setPeakRate(peakRes.data);
      setGstPercent(gstRes.data.gst_percent || 0);
      clearReadError("pricing");
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, pricing: e.userMessage || "Pricing details could not load." }));
    }
  }

  async function fetchQueue() {
    try {
      const res = await getWaitlist();
      if (!Array.isArray(res.data)) throw new Error("Queue unavailable");
      setQueue(res.data.filter(Boolean));
      clearReadError("queue");
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, queue: e.userMessage || "Waitlist could not load." }));
    } finally {
      setQueueLoading(false);
    }
  }

  async function fetchBookings() {
    try {
      const res = await getBookings();
      if (!Array.isArray(res.data)) throw new Error("Bookings unavailable");
      setBookings(res.data.filter(Boolean));
      clearReadError("bookings");
    } catch (e) {
      console.error(e);
      setReadErrors(current => ({ ...current, bookings: e.userMessage || "Bookings could not load." }));
    } finally {
      setBookingsLoading(false);
    }
  }

  function clearReadError(key) {
    setReadErrors(current => {
      if (!current[key]) return current;
      const next = { ...current }; delete next[key]; return next;
    });
  }

  function refreshControls() {
    return Promise.all([fetchActive(), fetchRates(), fetchMaintenance(), fetchPricing(), fetchQueue(), fetchBookings()]);
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
        await startSession(table.id, entry.customer_name, rate, false, "", "single", players);
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


  async function handlePause(id) {
    if (!sessions[id]) return false;
    return runBusyAction(`pause:${id}`, async () => {
      try {
        const res = await pauseSession(id, !sessions[id].paused, sessions[id].session_key);
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

  function handleStop(id) {
    onNavigate("live-floor", { tableId: id, tableAction: "checkout" });
    return true;
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

  function handleTableGridKeyDown(event) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;

    const grid = tableGridRef.current;
    if (!grid) return;

    const tiles = Array.from(grid.querySelectorAll('.table-floor-tile:not([aria-disabled="true"])'));
    const activeTile = document.activeElement?.closest?.(".table-floor-tile");
    const activeIndex = activeTile ? tiles.indexOf(activeTile) : -1;
    if (activeIndex === -1) return;

    const rows = [];
    tiles.forEach((tile, index) => {
      const rect = tile.getBoundingClientRect();
      const row = rows.find((item) => Math.abs(item.top - rect.top) < 12);
      if (row) {
        row.items.push({ index, left: rect.left, center: rect.left + rect.width / 2 });
      } else {
        rows.push({ top: rect.top, items: [{ index, left: rect.left, center: rect.left + rect.width / 2 }] });
      }
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach((row) => row.items.sort((a, b) => a.left - b.left));

    const rowIndex = rows.findIndex((row) => row.items.some((item) => item.index === activeIndex));
    if (rowIndex === -1) return;
    const columnIndex = rows[rowIndex].items.findIndex((item) => item.index === activeIndex);
    const activeCenter = rows[rowIndex].items[columnIndex].center;
    let targetIndex = activeIndex;

    if (event.key === "ArrowRight") {
      targetIndex = rows[rowIndex].items[columnIndex + 1]?.index ?? rows[rowIndex + 1]?.items[0]?.index ?? activeIndex;
    } else if (event.key === "ArrowLeft") {
      targetIndex = rows[rowIndex].items[columnIndex - 1]?.index ?? rows[rowIndex - 1]?.items.at(-1)?.index ?? activeIndex;
    } else if (event.key === "ArrowDown") {
      const nextRow = rows[rowIndex + 1]?.items;
      if (nextRow) {
        targetIndex = nextRow.reduce((closest, item) => (
          Math.abs(item.center - activeCenter) < Math.abs(closest.center - activeCenter) ? item : closest
        ), nextRow[0]).index;
      }
    } else if (event.key === "ArrowUp") {
      const previousRow = rows[rowIndex - 1]?.items;
      if (previousRow) {
        targetIndex = previousRow.reduce((closest, item) => (
          Math.abs(item.center - activeCenter) < Math.abs(closest.center - activeCenter) ? item : closest
        ), previousRow[0]).index;
      }
    }

    if (targetIndex !== activeIndex && tiles[targetIndex]) {
      event.preventDefault();
      tiles[targetIndex].focus();
    }
  }

  if (initialLoading) return <SkeletonBlock rows={6} label="Loading table controls" />;
  if (!floorReady) return <RetryNotice message={readErrors.floor || "Table statuses are unavailable"} onRetry={refreshControls} />;
  if (!TABLES.every(table => tableStates[table.id])) return <EmptyState title="Some table statuses are unavailable" description="Reload the floor before starting or closing a table." action={<HsrButton icon="ti-refresh" onClick={refreshControls}>Reload tables</HsrButton>} />;

  return (
    <>
      {quickSessionOpen && <StartSessionModal
        onClose={() => setQuickSessionOpen(false)}
        tables={TABLES.map(table => ({ ...table, rate: getTableRate(table, rates), status_key: maintenance[table.id] ? "maintenance" : sessions[table.id] ? "running" : "available" }))}
        onCreated={async () => { await fetchActive(); await fetchBookings(); onSessionEnd?.(); }}
        initialTableId={selectedTableId}
      />}

      <div className="advanced-table-controls-page">
        {!!Object.keys(readErrors).length && <RetryNotice message="Some table controls could not load" detail={Object.values(readErrors).join(" ")} onRetry={refreshControls} />}
        <LiveFloorCommand
          tables={TABLES}
          tableStates={tableStates}
          sessions={sessions}
          maintenance={maintenance}
          bookings={nextBookingByTable}
          selectedTableId={selectedTable?.id}
          onSelect={selectTable}
          onQuickStart={() => setQuickSessionOpen(true)}
          compact={compact}
          viewMode={viewMode}
          onViewModeChange={changeViewMode}
          peakRate={peakRate}
          gstPercent={gstPercent}
        />

        <div className="table-floor-layout">
          <div
            ref={tableGridRef}
            className={`tables-grid table-floor-grid ${compact ? "compact" : ""}`}
            role="region"
            aria-label="Table floor cards"
            onKeyDown={handleTableGridKeyDown}
          >
            {TABLES.map((table) => (
              <TableFloorTile
                key={table.id}
                table={table}
                tableState={tableStates[table.id]}
                session={sessions[table.id]}
                booking={nextBookingByTable[table.id] || null}
                rates={rates}
                maintenance={maintenance[table.id] || null}
                selected={selectedTable?.id === table.id}
                onSelect={() => selectTable(table.id)}
                onQuickStart={() => setQuickSessionOpen(true)}
                onCheckout={() => handleStop(table.id)}
                onReviewBooking={() => onNavigate?.("reservations")}
                checkoutBusy={!!busyActions[`quote:${table.id}`]}
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
                    {polishCurrency(runningTotalForSession(
                      sessions[selectedTable.id],
                      peakRate,
                      gstPercent,
                    ))}
                  </strong>
                </div>
              </div>

              <SessionWorkspace
                table={selectedTable}
                tableState={tableStates[selectedTable.id]}
                session={sessions[selectedTable.id]}
                booking={nextBookingByTable[selectedTable.id] || null}
                maintenance={maintenance[selectedTable.id] || null}
                rates={rates}
                peakRate={peakRate}
                gstPercent={gstPercent}
                onPause={handlePause}
                onStop={handleStop}
                onAddFood={onOpenFoodOrder}
                busyActions={busyActions}
              />

              <TableCard
                onReviewBooking={() => onNavigate?.("reservations")}
                key={selectedTable.id}
                table={selectedTable}
                session={sessions[selectedTable.id]}
                booking={nextBookingByTable[selectedTable.id] || null}
                name={names[selectedTable.id]}
                onNameChange={(val) =>
                  setNames((prev) => ({ ...prev, [selectedTable.id]: val }))
                }
                onStart={table => runBusyAction(`start:${table.id}`, async () => {
                  try {
                    await startGuestSession(table.id);
                    showToast(`${table.id.toUpperCase()} session started`, "success");
                    await fetchActive();
                  } catch (error) { showToast(error.userMessage || "Could not start session.", "error"); }
                })}
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
                onRefresh={fetchActive}
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
            loading={queueLoading}
            error={readErrors.queue}
            onRetry={fetchQueue}
            activeCount={Object.keys(sessions).length}
            onAdd={handleAddToQueue}
            onSeat={handleSeatQueue}
            onCancel={handleCancelQueue}
            busyActions={busyActions}
            showToast={showToast}
          />

          <BookingPanel
            bookings={bookings}
            loading={bookingsLoading}
            error={readErrors.bookings}
            onRetry={fetchBookings}
            onCreate={handleCreateBooking}
            onCancel={handleCancelBooking}
            busyActions={busyActions}
            showToast={showToast}
          />
        </div>
      </div>
    </>
  );
}
