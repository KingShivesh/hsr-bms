import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelBooking,
  createBooking,
  getBookings,
  getTableState,
  startSession,
} from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useConfirm } from "../../components/confirmContext.js";
import { useToast } from "../../components/toastContext.js";
import { HSR_TABLES, getTableRate } from "../../config/hsrTables.js";
import { getTableStatus } from "../../config/tableStatus.js";

function isoLocalNowPlus(minutes = 30) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.bookings)) return value.bookings;
  return [];
}

function defaultForm() {
  return {
    customer_name: "",
    phone: "",
    table_id: "ANY",
    table_type: "ANY",
    booking_time: isoLocalNowPlus(30),
    duration_mins: 60,
    notes: "",
  };
}

function BookingSkeleton() {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading bookings">
      <div className="page-skeleton-status">
        <i className="ti ti-loader-2" aria-hidden="true" />
        <span>Loading bookings...</span>
      </div>
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-panel" />
    </div>
  );
}

function BookingModal({ form, setForm, saving, onClose, onSubmit }) {
  return (
    <div className="lf-modal-backdrop" role="presentation">
      <form className="op2-modal" onSubmit={onSubmit}>
        <div className="order-selector-head">
          <div>
            <span className="lf-eyebrow">Booking</span>
            <h3>Reserve a table</h3>
          </div>
          <button type="button" className="lf-icon-button" onClick={onClose} aria-label="Close booking form">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <label className="lf-field">
          <span>Customer name</span>
          <input
            required
            value={form.customer_name}
            onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
            placeholder="Walk-in or regular customer"
          />
        </label>

        <label className="lf-field">
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            placeholder="Optional"
          />
        </label>

        <div className="op2-form-grid">
          <label className="lf-field">
            <span>Table</span>
            <select
              value={form.table_id}
              onChange={(event) => {
                const table = HSR_TABLES.find((row) => row.id.toUpperCase() === event.target.value);
                setForm((prev) => ({
                  ...prev,
                  table_id: event.target.value,
                  table_type: table?.type || prev.table_type,
                }));
              }}
            >
              <option value="ANY">Any table</option>
              {HSR_TABLES.map((table) => (
                <option value={table.id.toUpperCase()} key={table.id}>
                  T{table.num} · {table.label}
                </option>
              ))}
            </select>
          </label>
          <label className="lf-field">
            <span>Table type</span>
            <select
              value={form.table_type}
              onChange={(event) => setForm((prev) => ({ ...prev, table_type: event.target.value }))}
            >
              <option value="ANY">Any</option>
              <option value="SNOOKER">Snooker</option>
              <option value="POOL">Pool</option>
            </select>
          </label>
        </div>

        <div className="op2-form-grid">
          <label className="lf-field">
            <span>Date and time</span>
            <input
              required
              type="datetime-local"
              value={form.booking_time}
              onChange={(event) => setForm((prev) => ({ ...prev, booking_time: event.target.value }))}
            />
          </label>
          <label className="lf-field">
            <span>Duration</span>
            <input
              type="number"
              min="30"
              step="15"
              value={form.duration_mins}
              onChange={(event) => setForm((prev) => ({ ...prev, duration_mins: Number(event.target.value) || 60 }))}
            />
          </label>
        </div>

        <label className="lf-field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Advance paid, preferred table, reminder note"
          />
        </label>

        <div className="op2-modal-actions">
          <button type="button" className="lf-secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="lf-primary-button" disabled={saving}>
            <i className="ti ti-calendar-plus" aria-hidden="true" />
            {saving ? "Creating..." : "Create booking"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function BookingsPage() {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [bookings, setBookings] = useState([]);
  const [tableState, setTableState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("booked");
  const [query, setQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState("");

  const loadBookings = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [bookingRes, tableRes] = await Promise.all([getBookings(), getTableState()]);
      setBookings(asArray(bookingRes.data));
      setTableState(asArray(tableRes.data?.tables || tableRes.data));
    } catch (err) {
      setError(err.userMessage || "Bookings could not load.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBookings({ showLoading: true });
  }, [loadBookings]);

  const booked = bookings.filter((booking) => booking.status === "booked");
  const missed = bookings.filter((booking) => booking.status === "missed");
  const nextHour = booked.filter((booking) => {
    const time = new Date(booking.booking_time).getTime();
    return Number.isFinite(time) && time >= Date.now() && time <= Date.now() + 60 * 60 * 1000;
  });
  const visibleBookings = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return bookings
      .filter((booking) => filter === "all" || booking.status === filter)
      .filter((booking) => {
        if (!cleanQuery) return true;
        return [booking.customer_name, booking.phone, booking.table_id, booking.table_type]
          .some((value) => String(value || "").toLowerCase().includes(cleanQuery));
      })
      .sort((a, b) => new Date(a.booking_time).getTime() - new Date(b.booking_time).getTime());
  }, [bookings, filter, query]);

  const tableBookings = HSR_TABLES.map((table) => ({
    table,
    state: tableState.find((row) => String(row.id || row.table_id || "").toLowerCase() === table.id),
    bookings: booked.filter((booking) => String(booking.table_id || "").toLowerCase() === table.id),
  }));

  function tableAvailability(table, state) {
    return getTableStatus({
      session: state?.session,
      maintenance: state?.maintenance,
    });
  }

  function targetForBooking(booking) {
    const requestedId = String(booking.table_id || "").toLowerCase();
    const requestedType = String(booking.table_type || "ANY").toUpperCase();
    const candidates = HSR_TABLES
      .filter((table) => requestedId && requestedId !== "any" ? table.id === requestedId : true)
      .filter((table) => requestedType === "ANY" || table.type === requestedType)
      .map((table) => ({
        table,
        state: tableState.find((row) => String(row.id || row.table_id || "").toLowerCase() === table.id),
      }));
    return candidates.find(({ table, state }) => tableAvailability(table, state).key === "available") || null;
  }

  async function submitBooking(event) {
    event.preventDefault();
    setBusy("create");
    try {
      await createBooking(form);
      showToast("Booking created", "success");
      setForm(defaultForm());
      setShowModal(false);
      await loadBookings();
    } catch (err) {
      showToast(err.response?.data?.detail || err.userMessage || "Could not create booking", "error");
    } finally {
      setBusy("");
    }
  }

  async function cancelExistingBooking(booking) {
    const confirmed = await requestConfirm({
      title: "Cancel booking?",
      message: `Cancel booking for ${booking.customer_name}?`,
      confirmLabel: "Cancel booking",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(`cancel-${booking.id}`);
    try {
      await cancelBooking(booking.id);
      showToast("Booking cancelled", "success");
      await loadBookings();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not cancel booking", "error");
    } finally {
      setBusy("");
    }
  }

  async function checkInBooking(booking) {
    const target = targetForBooking(booking);
    if (!target) {
      showToast("No available matching table for this booking.", "error");
      return;
    }
    setBusy(`checkin-${booking.id}`);
    try {
      await startSession(
        target.table.id,
        booking.customer_name,
        target.state?.rate || getTableRate(target.table),
        false,
        "",
        "single",
        [booking.customer_name],
      );
      showToast(`${booking.customer_name} checked in to T${target.table.num}`, "success");
      await loadBookings();
    } catch (err) {
      showToast(err.response?.data?.detail || err.userMessage || "Could not check in booking", "error");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <BookingSkeleton />;

  return (
    <section className="op2-page">
      {error && <RetryNotice message={error} detail="Booking data may be stale until this loads." onRetry={() => loadBookings({ showLoading: true })} />}

      <div className="op2-hero">
        <div>
          <span className="lf-eyebrow">Bookings</span>
          <h1>Reservation desk</h1>
          <p>Plan table commitments, protect peak hours and spot no-shows before they become counter confusion.</p>
        </div>
        <button type="button" className="lf-primary-button" onClick={() => setShowModal(true)}>
          <i className="ti ti-calendar-plus" aria-hidden="true" />
          New booking
        </button>
      </div>

      <div className="op2-metric-grid">
        <div><span>Active bookings</span><strong>{booked.length}</strong><em>{nextHour.length} due within 1 hour</em></div>
        <div><span>Tables covered</span><strong>{tableBookings.filter((row) => row.bookings.length).length}</strong><em>of {HSR_TABLES.length} tables</em></div>
        <div><span>Missed bookings</span><strong>{missed.length}</strong><em>needs review before close</em></div>
      </div>

      <div className="op2-board">
        {tableBookings.map(({ table, state, bookings: rows }) => {
          const status = getTableStatus({
            session: state?.session,
            booking: state?.booking || rows[0],
            maintenance: state?.maintenance,
          });
          return (
            <article className="op2-table-booking-card" key={table.id}>
              <div>
                <strong>T{table.num}</strong>
                <span>{table.label}</span>
              </div>
              <em className={`lf-status-badge lf-status-${status.tone}`}>
                <span />{status.label}
              </em>
              {rows.length ? (
                rows.slice(0, 2).map((booking) => (
                  <p key={booking.id}>
                    <b>{booking.customer_name}</b>
                    <small>{shortDate(booking.booking_time)}</small>
                  </p>
                ))
              ) : (
                <p><b>No booking</b><small>Available for walk-ins</small></p>
              )}
            </article>
          );
        })}
      </div>

      <section className="op2-panel">
        <div className="op2-panel-head">
          <div>
            <span className="lf-eyebrow">Register</span>
            <h2>Booking list</h2>
          </div>
          <div className="op2-controls">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search booking..." />
            {["booked", "missed", "all"].map((status) => (
              <button type="button" key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>
                {status}
              </button>
            ))}
          </div>
        </div>

        {visibleBookings.length ? (
          <div className="op2-register-list">
            {visibleBookings.map((booking) => {
              const target = targetForBooking(booking);
              return (
                <article key={booking.id} className="op2-register-row">
                  <div>
                    <strong>{booking.customer_name}</strong>
                    <span>{booking.phone || "No phone"} · {booking.table_id || "ANY"} · {booking.duration_mins || 60} min</span>
                    <small>{target ? `Can seat at T${target.table.num} now` : "No matching free table right now"}</small>
                  </div>
                  <time>{shortDate(booking.booking_time)}</time>
                  <em data-status={booking.status}>{booking.status}</em>
                  <div className="op2-row-actions">
                    <button
                      type="button"
                      className="lf-primary-button"
                      disabled={busy === `checkin-${booking.id}` || booking.status !== "booked" || !target}
                      onClick={() => checkInBooking(booking)}
                    >
                      {busy === `checkin-${booking.id}` ? "Checking in..." : target ? `Check in T${target.table.num}` : "No table"}
                    </button>
                    <button
                      type="button"
                      className="lf-danger-button"
                      disabled={busy === `cancel-${booking.id}` || booking.status !== "booked"}
                      onClick={() => cancelExistingBooking(booking)}
                    >
                      {busy === `cancel-${booking.id}` ? "Cancelling..." : "Cancel"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="op2-empty">
            <i className="ti ti-calendar-check" aria-hidden="true" />
            <strong>No bookings found</strong>
            <span>Create a reservation or adjust the filter.</span>
          </div>
        )}
      </section>

      {showModal && (
        <BookingModal
          form={form}
          setForm={setForm}
          saving={busy === "create"}
          onClose={() => setShowModal(false)}
          onSubmit={submitBooking}
        />
      )}
    </section>
  );
}
