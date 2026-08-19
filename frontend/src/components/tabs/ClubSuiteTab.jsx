import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMenuItem,
  addWaitlistEntry,
  cancelBooking,
  cancelFoodOrder,
  cancelWaitlistEntry,
  clearMaintenance,
  createBooking,
  deleteMenuItem,
  getAuditLogs,
  getBookings,
  getFoodOrders,
  getHistory,
  getMenuFull,
  getTableState,
  getWaitlist,
  seatWaitlistEntry,
  setItemAvailability,
  setMaintenance,
  updateMenuItem,
} from "../../api/index.js";
import { HSR_TABLES } from "../../config/hsrTables.js";
import { getTableStatus } from "../../config/tableStatus.js";
import { useToast } from "../toastContext.js";
import { useConfirm } from "../confirmContext.js";

function money(value = 0) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.menu)) return value.menu;
  if (Array.isArray(value.data)) return value.data;
  return Object.entries(value).map(([name, item]) => (
    item && typeof item === "object"
      ? { name, ...item }
      : { name, price: Number(item || 0), available: true }
  ));
}

function asMaintenanceRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([table_id, item]) => ({ table_id, ...(item || {}) }));
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

function isoLocalNowPlus(minutes = 30) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Section({ eyebrow, title, action, children }) {
  return (
    <section className="cf-panel">
      <div className="cf-section-head">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function emptyWorkspaceData() {
  return {
    waitlist: [],
    bookings: [],
    activeSessions: [],
    tableState: [],
    history: [],
    foodOrders: [],
    menu: [],
    maintenance: [],
    auditLogs: [],
  };
}

const WORKSPACE_LOADERS = {
  waitlist: [
    { label: "waitlist", key: "waitlist", request: getWaitlist },
    { label: "reservations", key: "bookings", request: getBookings },
    { label: "table state", key: "tableState", request: getTableState },
  ],
  reservations: [
    { label: "reservations", key: "bookings", request: getBookings },
    { label: "table state", key: "tableState", request: getTableState },
  ],
  billing: [
    { label: "billing history", key: "history", request: getHistory },
    { label: "food orders", key: "foodOrders", request: getFoodOrders },
  ],
  inventory: [
    { label: "menu", key: "menu", request: getMenuFull },
    { label: "table state", key: "tableState", request: getTableState },
  ],
  notifications: [
    { label: "audit logs", key: "auditLogs", request: () => getAuditLogs(50) },
    { label: "waitlist", key: "waitlist", request: getWaitlist },
    { label: "reservations", key: "bookings", request: getBookings },
    { label: "table state", key: "tableState", request: getTableState },
  ],
  staff: [
    { label: "audit logs", key: "auditLogs", request: () => getAuditLogs(50) },
  ],
};

function WorkspaceLoading() {
  return (
    <div className="cf-page">
      <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading workspace data">
        <div className="page-skeleton-status">
          <i className="ti ti-loader-2" aria-hidden="true" />
          <span>Loading workspace data...</span>
        </div>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
        <div className="skeleton-panel" />
      </div>
    </div>
  );
}

function LoadErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="load-error-banner" role="alert">
      <i className="ti ti-alert-circle" aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function ActionButton({ tone = "default", icon, children, ...props }) {
  return (
    <button type="button" className={`cf-action-btn ${tone}`} {...props}>
      {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = `cf-modal-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    function closeAndRestore() {
      onCloseRef.current?.();
      window.setTimeout(() => openerRef.current?.focus?.(), 0);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestore();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="cf-modal-backdrop" role="presentation">
      <div
        ref={modalRef}
        className="cf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="cf-modal-head">
          <h3 id={titleId}>{title}</h3>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <label className="cf-form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <article className="cf-stat">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function EmptyState({ icon = "ti-info-circle", title, detail }) {
  return (
    <div className="cf-empty">
      <i className={`ti ${icon}`} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function RowList({ rows, emptyTitle = "Nothing pending", emptyDetail = "New activity will appear here automatically." }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon="ti-circle-check"
        title={emptyTitle}
        detail={emptyDetail}
      />
    );
  }
  return (
    <div className="cf-row-list">
      {rows.map((row) => (
        <div className="cf-row" key={row.id}>
          <i className={`ti ${row.icon}`} aria-hidden="true" />
          <div>
            <strong>{row.title}</strong>
            <span>{row.detail}</span>
          </div>
          {row.amount && <em>{row.amount}</em>}
          {row.action}
        </div>
      ))}
    </div>
  );
}

function WaitlistView({ waitlist, bookings, activeSessions, maintenance, actions, busy, activeAction, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [seatTarget, setSeatTarget] = useState({});
  const [form, setForm] = useState({
    customer_name: "",
    phone: "",
    party_size: 2,
    preferred_type: "ANY",
    notes: "",
  });
  const missed = bookings.filter((booking) => booking.status === "missed");
  const upcoming = bookings.filter((booking) => booking.status === "booked");
  const activeIds = new Set(activeSessions.map((session) => String(session.table_id || "").toLowerCase()));
  const maintenanceIds = new Set(maintenance.map((row) => String(row.table_id || "").toLowerCase()));
  const availableTables = HSR_TABLES.filter(
    (table) => !activeIds.has(table.id) && !maintenanceIds.has(table.id),
  );

  async function submitWaitlist(event) {
    event.preventDefault();
    const success = await actions.addWaitlist(form);
    if (!success) return;
    setForm({ customer_name: "", phone: "", party_size: 2, preferred_type: "ANY", notes: "" });
    setShowAdd(false);
  }

  async function seatEntry(entry) {
    const tableId = seatTarget[entry.id] || entry.recommended_table?.id || availableTables[0]?.id || "";
    if (!tableId) {
      showToast("No available table to seat this customer.", "error");
      return;
    }
    await actions.seatWaitlist(entry.id, tableId);
  }

  return (
    <div className="cf-page cf-page-queue">
      <div className="cf-toolbar">
        <div>
          <strong>Queue desk</strong>
          <span>{availableTables.length} tables available for seating</span>
        </div>
        <ActionButton tone="primary" icon="ti-user-plus" onClick={() => setShowAdd(true)}>
          Add Walk-in Guest
        </ActionButton>
      </div>
      <div className="cf-stat-grid">
        <Stat label="Waiting" value={waitlist.length} />
        <Stat label="Upcoming Bookings" value={upcoming.length} />
        <Stat label="Missed Bookings" value={missed.length} />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Queue" title="Walk-ins Waiting">
          <RowList
            emptyTitle="No guests waiting"
            emptyDetail="Walk-in customers added from the queue desk will show here."
            rows={waitlist.map((entry) => ({
              id: `wait-${entry.id}`,
              icon: "ti-clock",
              title: `${entry.position}. ${entry.customer_name}`,
              detail: `${entry.party_size} player(s) · ${entry.preferred_type || "Any table"} · ${entry.wait_mins || 0} min wait`,
              action: (
                <div className="cf-row-actions">
                  <select
                    value={seatTarget[entry.id] || entry.recommended_table?.id || availableTables[0]?.id || ""}
                    onChange={(event) => setSeatTarget((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                    disabled={busy}
                  >
                    <option value="">Select table</option>
                    {availableTables.map((table) => (
                      <option value={table.id} key={table.id}>
                        T{table.num} · {table.label}
                      </option>
                    ))}
                  </select>
                  <ActionButton tone="success" icon="ti-armchair" onClick={() => seatEntry(entry)} disabled={busy}>
                    {activeAction === `wait-seat-${entry.id}` ? "Seating..." : "Seat"}
                  </ActionButton>
                  <ActionButton tone="danger" icon="ti-x" onClick={() => actions.cancelWaitlist(entry.id)} disabled={busy}>
                    {activeAction === `wait-cancel-${entry.id}` ? "Cancelling..." : "Cancel"}
                  </ActionButton>
                </div>
              ),
            }))}
          />
        </Section>
        <Section eyebrow="Bookings" title="Upcoming / Missed">
          <RowList
            emptyTitle="No bookings to review"
            emptyDetail="Upcoming and missed bookings will appear here."
            rows={[...upcoming, ...missed].slice(0, 10).map((booking) => ({
              id: `booking-${booking.id}`,
              icon: booking.status === "missed" ? "ti-alert-triangle" : "ti-calendar",
              title: booking.customer_name,
              detail: `${booking.table_id || "ANY"} · ${shortDate(booking.booking_time)} · ${booking.status}`,
            }))}
          />
        </Section>
      </div>
      {showAdd && (
        <Modal title="Add Walk-in Guest" onClose={() => setShowAdd(false)}>
          <form className="cf-form" onSubmit={submitWaitlist}>
            <FormField label="Customer full name">
              <input
                required
                value={form.customer_name}
                onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                placeholder="First and last name"
              />
            </FormField>
            <FormField label="Phone">
              <input
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Optional"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Players">
                <input
                  type="number"
                  min="1"
                  value={form.party_size}
                  onChange={(event) => setForm((prev) => ({ ...prev, party_size: Number(event.target.value) || 1 }))}
                />
              </FormField>
              <FormField label="Preferred table">
                <select
                  value={form.preferred_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, preferred_type: event.target.value }))}
                >
                  <option value="ANY">Any</option>
                  <option value="SNOOKER">Snooker</option>
                  <option value="POOL">Pool</option>
                </select>
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Preference, regular customer, callback note"
              />
            </FormField>
            <div className="cf-modal-actions">
              <ActionButton onClick={() => setShowAdd(false)}>Cancel</ActionButton>
              <button className="cf-action-btn primary" type="submit" disabled={busy}>
                <i className="ti ti-user-plus" aria-hidden="true" />
                <span>{activeAction === "wait-add" ? "Adding..." : "Add to Queue"}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ReservationsView({ bookings, tableState, actions, busy, activeAction }) {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({
    customer_name: "",
    phone: "",
    table_id: "ANY",
    table_type: "ANY",
    booking_time: isoLocalNowPlus(30),
    duration_mins: 60,
    notes: "",
  });
  const booked = bookings.filter((booking) => booking.status === "booked");
  const visibleBookings = bookings.filter((booking) => filter === "all" || booking.status === filter);
  const tableBookings = HSR_TABLES.map((table) => ({
    table,
    bookings: booked.filter((booking) => String(booking.table_id).toLowerCase() === table.id),
    state: tableState.find((row) => String(row.id).toLowerCase() === table.id),
  }));

  async function submitBooking(event) {
    event.preventDefault();
    const success = await actions.createBooking(form);
    if (!success) return;
    setForm({
      customer_name: "",
      phone: "",
      table_id: "ANY",
      table_type: "ANY",
      booking_time: isoLocalNowPlus(30),
      duration_mins: 60,
      notes: "",
    });
    setShowAdd(false);
  }

  return (
    <div className="cf-page cf-page-reservations">
      <div className="cf-toolbar">
        <div>
          <strong>Reservation board</strong>
          <span>Create bookings, spot conflicts and cancel no-shows.</span>
        </div>
        <div className="cf-toolbar-actions">
          {["all", "booked", "missed"].map((status) => (
            <button
              type="button"
              key={status}
              className={filter === status ? "active" : ""}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
          <ActionButton tone="primary" icon="ti-calendar-plus" onClick={() => setShowAdd(true)}>
            New Reservation
          </ActionButton>
        </div>
      </div>
      <div className="cf-stat-grid">
        <Stat label="Active Bookings" value={booked.length} />
        <Stat label="Tables Covered" value={tableBookings.filter((row) => row.bookings.length).length} />
        <Stat label="Missed Bookings" value={bookings.filter((booking) => booking.status === "missed").length} />
      </div>
      <div className="cf-calendar-grid">
        {tableBookings.map(({ table, bookings: rows, state }) => {
          const tableStatus = getTableStatus({
            session: state?.session,
            booking: state?.booking || rows[0],
            maintenance: state?.maintenance,
          });
          return (
            <section className="cf-table-slot" key={table.id}>
              <div className="cf-table-slot-head">
                <strong>T{table.num}</strong>
                <span>{table.label || table.type || table.id}</span>
              </div>
              {rows.length ? (
                <>
                  <em className={`cf-table-slot-status ${tableStatus.tone}`}>{tableStatus.label}</em>
                  {rows.slice(0, 3).map((booking) => (
                    <p key={booking.id}>
                      <b>{booking.customer_name}</b>
                      <small>{shortDate(booking.booking_time)}</small>
                    </p>
                  ))}
                </>
              ) : (
                <div className="cf-table-slot-empty">
                  <em>{tableStatus.label}</em>
                  <small>No reservations scheduled</small>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <Section eyebrow="Bookings" title="Reservation Register">
        <RowList
          emptyTitle="No reservations found"
          emptyDetail="Create a reservation to start filling the register."
          rows={visibleBookings.slice(0, 14).map((booking) => ({
            id: `booking-row-${booking.id}`,
            icon: booking.status === "missed" ? "ti-alert-triangle" : "ti-calendar-event",
            title: booking.customer_name,
            detail: `${booking.table_id || "ANY"} · ${shortDate(booking.booking_time)} · ${booking.duration_mins || 60} min · ${booking.phone || "No phone"}`,
            action: (
              <div className="cf-row-actions">
                <ActionButton
                  tone="danger"
                  icon="ti-calendar-x"
                  onClick={() => actions.cancelBooking(booking.id)}
                  disabled={busy || booking.status !== "booked"}
                >
                  {activeAction === `booking-cancel-${booking.id}` ? "Cancelling..." : "Cancel"}
                </ActionButton>
              </div>
            ),
          }))}
        />
      </Section>
      {showAdd && (
        <Modal title="New Reservation" onClose={() => setShowAdd(false)}>
          <form className="cf-form" onSubmit={submitBooking}>
            <FormField label="Customer full name">
              <input
                required
                value={form.customer_name}
                onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                placeholder="First and last name"
              />
            </FormField>
            <FormField label="Phone">
              <input
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Optional"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Table">
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
              </FormField>
              <FormField label="Table type">
                <select
                  value={form.table_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, table_type: event.target.value }))}
                >
                  <option value="ANY">Any</option>
                  <option value="SNOOKER">Snooker</option>
                  <option value="POOL">Pool</option>
                </select>
              </FormField>
            </div>
            <div className="cf-form-grid">
              <FormField label="Date and time">
                <input
                  required
                  type="datetime-local"
                  value={form.booking_time}
                  onChange={(event) => setForm((prev) => ({ ...prev, booking_time: event.target.value }))}
                />
              </FormField>
              <FormField label="Duration">
                <input
                  type="number"
                  min="30"
                  step="15"
                  value={form.duration_mins}
                  onChange={(event) => setForm((prev) => ({ ...prev, duration_mins: Number(event.target.value) || 60 }))}
                />
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Advance, preference, phone reminder"
              />
            </FormField>
            <div className="cf-modal-actions">
              <ActionButton onClick={() => setShowAdd(false)}>Cancel</ActionButton>
              <button className="cf-action-btn primary" type="submit" disabled={busy}>
                <i className="ti ti-calendar-plus" aria-hidden="true" />
                <span>{activeAction === "booking-create" ? "Creating..." : "Create Booking"}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BillingView({ history, foodOrders, actions, busy, activeAction }) {
  const tableTotal = history.reduce((sum, bill) => sum + Number(bill.total || bill.amount || 0), 0);
  const foodTotal = foodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const recentBills = history.slice(0, 12).map((bill) => ({
    id: `bill-${bill.id || bill.date}-${bill.table_id}`,
    icon: "ti-receipt",
    title: `${bill.table_id || "Table"} · ${bill.customer_name || "Customer"}`,
    detail: `${bill.payment_method || "Cash"} · ${bill.date || ""}`,
    amount: money(bill.total || bill.amount || 0),
  }));
  const foodRows = foodOrders.slice(0, 6).map((order) => ({
    id: `food-${order.id}`,
    icon: "ti-tools-kitchen-2",
    title: order.customer_name || "Counter order",
    detail: `${order.payment_method || "Cash"} · ${order.items?.length || 0} item(s)`,
    amount: money(order.total),
    action: (
      <div className="cf-row-actions">
        <ActionButton
          tone="danger"
          icon="ti-receipt-refund"
          onClick={() => actions.cancelFoodOrder(order.id)}
          disabled={busy}
        >
          {activeAction === `food-cancel-${order.id}` ? "Cancelling..." : "Cancel"}
        </ActionButton>
      </div>
    ),
  }));
  return (
    <div className="cf-page cf-page-billing">
      <div className="cf-toolbar">
        <div>
          <strong>Cashier register</strong>
          <span>Review table settlements and cancel incorrect food-only orders.</span>
        </div>
      </div>
      <div className="cf-stat-grid">
        <Stat label="Table Bill Value" value={money(tableTotal)} />
        <Stat label="Food Bill Value" value={money(foodTotal)} />
        <Stat label="Food Orders" value={foodOrders.length} />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Tables" title="Recent Table Bills">
          <RowList
            emptyTitle="No table bills yet"
            emptyDetail="Closed table sessions will appear in this register."
            rows={recentBills}
          />
        </Section>
        <Section eyebrow="Cafe" title="Recent Food Bills">
          <RowList
            emptyTitle="No food bills yet"
            emptyDetail="Food-only orders will appear here after checkout."
            rows={foodRows}
          />
        </Section>
      </div>
    </div>
  );
}

function InventoryView({ menu, maintenance, actions, busy, activeAction, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState({ table_id: "t1", reason: "Under maintenance" });
  const [menuForm, setMenuForm] = useState({
    name: "",
    price: "",
    category: "Veg Snacks",
  });
  const unavailable = menu.filter((item) => item.available === false);
  const cigarettes = menu.filter((item) => /cig|cigg|cigarette/i.test(item.name));
  const categories = [
    "Veg Snacks",
    "Non Veg Snacks",
    "Egg",
    "Maggie",
    "Hot Beverages",
    "Cold Beverages",
    "Cigarettes",
  ];

  async function submitMenuItem(event) {
    event.preventDefault();
    const price = Number(menuForm.price);
    if (!menuForm.name.trim() || price < 0) {
      showToast("Enter item name and valid price.", "error");
      return;
    }
    const success = await actions.addMenuItem(menuForm.name, price, menuForm.category);
    if (!success) return;
    setMenuForm({ name: "", price: "", category: menuForm.category });
    setShowAdd(false);
  }

  async function submitEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const price = Number(editing.price);
    if (!editing.newName.trim() || price < 0) {
      showToast("Enter item name and valid price.", "error");
      return;
    }
    const success = await actions.updateMenuItem(editing.oldName, editing.newName, price, editing.category);
    if (!success) return;
    setEditing(null);
  }

  async function submitMaintenance(event) {
    event.preventDefault();
    const success = await actions.setMaintenance(maintenanceForm.table_id, maintenanceForm.reason);
    if (!success) return;
    setMaintenanceForm({ table_id: maintenanceForm.table_id, reason: "Under maintenance" });
  }

  return (
    <div className="cf-page cf-page-inventory">
      <div className="cf-toolbar">
        <div>
          <strong>Inventory command</strong>
          <span>Edit cafe menu stock and manage tables under maintenance.</span>
        </div>
        <ActionButton tone="primary" icon="ti-package-plus" onClick={() => setShowAdd(true)}>
          Add Menu Item
        </ActionButton>
      </div>
      <div className="cf-stat-grid">
        <Stat label="Menu Items" value={menu.length} />
        <Stat label="Out of Stock" value={unavailable.length} />
        <Stat label="Cigarette Items" value={cigarettes.length} />
      </div>
      <div className="cf-inventory-grid">
        <Section eyebrow="Menu CRUD" title="Food Menu & Availability">
          <div className="cf-data-table">
            {menu.slice(0, 18).map((item) => (
              <div className="cf-data-row" key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.category || "Menu"} · {money(item.price)} · {item.available === false ? "Out of stock" : "In stock"}</span>
                </div>
                <div className="cf-row-actions">
                  <ActionButton
                    icon="ti-pencil"
                    onClick={() => setEditing({
                      oldName: item.name,
                      newName: item.name,
                      price: item.price,
                      category: item.category || "Veg Snacks",
                    })}
                  >
                    Edit
                  </ActionButton>
                  <ActionButton
                    tone={item.available === false ? "success" : "warning"}
                    icon={item.available === false ? "ti-check" : "ti-package-off"}
                    onClick={() => actions.setItemAvailability(item.name, item.available === false)}
                    disabled={busy}
                  >
                    {activeAction === `stock-${item.name}` ? "Saving..." : item.available === false ? "In stock" : "Out"}
                  </ActionButton>
                  <ActionButton
                    tone="danger"
                    icon="ti-trash"
                    onClick={() => actions.deleteMenuItem(item.name)}
                    disabled={busy}
                  >
                    {activeAction === `menu-delete-${item.name}` ? "Deleting..." : "Delete"}
                  </ActionButton>
                </div>
              </div>
            ))}
            {!menu.length && (
              <EmptyState
                icon="ti-package"
                title="No menu items"
                detail="Add snacks, drinks or cigarettes to start building the menu."
              />
            )}
          </div>
        </Section>

        <Section
          eyebrow="Floor"
          title="Table Maintenance"
          action={
            <form className="cf-inline-form" onSubmit={submitMaintenance}>
              <select
                value={maintenanceForm.table_id}
                onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, table_id: event.target.value }))}
              >
                {HSR_TABLES.map((table) => (
                  <option value={table.id} key={table.id}>
                    T{table.num}
                  </option>
                ))}
              </select>
              <input
                value={maintenanceForm.reason}
                onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Reason"
              />
              <button className="cf-action-btn warning" type="submit" disabled={busy}>
                <i className="ti ti-tool" aria-hidden="true" />
                <span>{activeAction === "maintenance-set" ? "Saving..." : "Mark"}</span>
              </button>
            </form>
          }
        >
          <RowList
            emptyTitle="No tables in maintenance"
            emptyDetail="Tables marked unavailable will show here until cleared."
            rows={maintenance.map((row) => ({
              id: `maint-${row.table_id}`,
              icon: "ti-tool",
              title: String(row.table_id || "").toUpperCase(),
              detail: `${row.reason || "Marked for maintenance"} · ${row.since || "No time"}`,
              action: (
                <div className="cf-row-actions">
                  <ActionButton
                    tone="success"
                    icon="ti-tool-off"
                    onClick={() => actions.clearMaintenance(row.table_id)}
                    disabled={busy}
                  >
                    {activeAction === `maintenance-clear-${row.table_id}` ? "Clearing..." : "Clear"}
                  </ActionButton>
                </div>
              ),
            }))}
          />
        </Section>
      </div>
      {showAdd && (
        <Modal title="Add Menu Item" onClose={() => setShowAdd(false)}>
          <form className="cf-form" onSubmit={submitMenuItem}>
            <FormField label="Item name">
              <input
                required
                value={menuForm.name}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Coffee, fries, cigarette pack"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Price">
                <input
                  required
                  type="number"
                  min="0"
                  value={menuForm.price}
                  onChange={(event) => setMenuForm((prev) => ({ ...prev, price: event.target.value }))}
                />
              </FormField>
              <FormField label="Category">
                <select
                  value={menuForm.category}
                  onChange={(event) => setMenuForm((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {categories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="cf-modal-actions">
              <ActionButton onClick={() => setShowAdd(false)}>Cancel</ActionButton>
              <button className="cf-action-btn primary" type="submit" disabled={busy}>
                <i className="ti ti-package-plus" aria-hidden="true" />
                <span>{activeAction === "menu-add" ? "Adding..." : "Add Item"}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title="Edit Menu Item" onClose={() => setEditing(null)}>
          <form className="cf-form" onSubmit={submitEdit}>
            <FormField label="Item name">
              <input
                required
                value={editing.newName}
                onChange={(event) => setEditing((prev) => ({ ...prev, newName: event.target.value }))}
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Price">
                <input
                  required
                  type="number"
                  min="0"
                  value={editing.price}
                  onChange={(event) => setEditing((prev) => ({ ...prev, price: event.target.value }))}
                />
              </FormField>
              <FormField label="Category">
                <select
                  value={editing.category}
                  onChange={(event) => setEditing((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {categories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="cf-modal-actions">
              <ActionButton onClick={() => setEditing(null)}>Cancel</ActionButton>
              <button className="cf-action-btn primary" type="submit" disabled={busy}>
                <i className="ti ti-device-floppy" aria-hidden="true" />
                <span>{activeAction === `menu-edit-${editing.oldName}` ? "Saving..." : "Save Changes"}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function NotificationsView({ auditLogs, waitlist, bookings, maintenance }) {
  const notifications = [
    ...maintenance.map((row) => ({
      id: `maint-${row.table_id}`,
      icon: "ti-tool",
      title: `${String(row.table_id).toUpperCase()} in maintenance`,
      detail: row.reason || "Needs owner review",
    })),
    ...waitlist.map((entry) => ({
      id: `wait-${entry.id}`,
      icon: "ti-user-clock",
      title: `${entry.customer_name} waiting`,
      detail: `${entry.wait_mins || 0} min in queue`,
    })),
    ...bookings.filter((booking) => booking.status === "missed").map((booking) => ({
      id: `missed-${booking.id}`,
      icon: "ti-alert-triangle",
      title: `Missed booking: ${booking.customer_name}`,
      detail: shortDate(booking.booking_time),
    })),
    ...auditLogs.slice(0, 8).map((log) => ({
      id: `audit-${log.id}`,
      icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
      title: log.action?.replaceAll("_", " ") || "System activity",
      detail: log.detail || log.date || "",
    })),
  ];
  return (
    <div className="cf-page cf-page-notifications">
      <div className="cf-stat-grid">
        <Stat label="Alerts" value={notifications.length} />
        <Stat label="Audit Events" value={auditLogs.length} />
        <Stat label="Maintenance" value={maintenance.length} />
      </div>
      <Section eyebrow="Alerts" title="Live Notifications">
        <RowList
          emptyTitle="No live notifications"
          emptyDetail="Waitlist, booking, maintenance and audit alerts will appear here."
          rows={notifications}
        />
      </Section>
    </div>
  );
}

function StaffView({ auditLogs }) {
  const staffMap = auditLogs.reduce((acc, log) => {
    const key = log.staff || "system";
    acc[key] = acc[key] || { actions: 0, risk: 0 };
    acc[key].actions += 1;
    if (log.severity === "danger") acc[key].risk += 1;
    return acc;
  }, {});
  const rows = Object.entries(staffMap).map(([staff, value]) => ({
    id: staff,
    icon: "ti-user-check",
    title: staff,
    detail: `${value.actions} logged action(s) · ${value.risk} risk action(s)`,
  }));
  return (
    <div className="cf-page cf-page-staff">
      <div className="cf-stat-grid">
        <Stat label="Staff/System Actors" value={rows.length} />
        <Stat label="Logged Actions" value={auditLogs.length} />
        <Stat label="Risk Actions" value={rows.reduce((sum, row) => {
          const match = row.detail.match(/(\d+) risk/);
          return sum + (match ? Number(match[1]) : 0);
        }, 0)} />
      </div>
      <Section eyebrow="Activity" title="Staff Action Summary">
        <RowList
          emptyTitle="No staff activity yet"
          emptyDetail="Staff and system actions will appear as the venue is used."
          rows={rows}
        />
      </Section>
    </div>
  );
}

export default function ClubSuiteTab({ view }) {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [data, setData] = useState(() => emptyWorkspaceData());
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async (shouldCommit = () => true, { showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const loaders = WORKSPACE_LOADERS[view] || WORKSPACE_LOADERS.waitlist;
      const results = await Promise.allSettled(loaders.map((loader) => loader.request()));
      if (!shouldCommit()) return;
      const failed = results
        .map((result, index) => (result.status === "rejected" ? loaders[index].label : ""))
        .filter(Boolean);
      const nextData = emptyWorkspaceData();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const key = loaders[index].key;
        const payload = result.value.data || {};
        if (key === "tableState") {
          nextData.activeSessions = asArray(payload.active_sessions);
          nextData.tableState = asArray(payload.tables);
          nextData.maintenance = asMaintenanceRows(payload.maintenance);
          return;
        }
        nextData[key] = asArray(payload);
      });
      setData(nextData);
      setLoadError(
        failed.length
          ? `Could not load ${failed.join(", ")}. Retry once the backend responds.`
          : "",
      );
    } catch (error) {
      if (!shouldCommit()) return;
      setLoadError(error.userMessage || "Workspace data could not load. Check the backend connection and retry.");
    } finally {
      if (shouldCommit()) setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    let alive = true;
    loadData(() => alive, { showLoading: true });
    return () => {
      alive = false;
    };
  }, [view, loadData]);

  const runAction = useCallback(async (action, {
    confirmText = "",
    actionKey = "action",
    successMessage = "",
  } = {}) => {
    if (confirmText) {
      const confirmed = await requestConfirm({
        title: "Confirm action",
        message: confirmText,
        confirmLabel: "Continue",
        tone: "warning",
      });
      if (!confirmed) return false;
    }
    setBusy(true);
    setActiveAction(actionKey);
    try {
      await action();
      await loadData();
      if (successMessage) showToast(successMessage, "success");
      return true;
    } catch (error) {
      showToast(error.response?.data?.detail || "Action failed", "error");
      return false;
    } finally {
      setBusy(false);
      setActiveAction("");
    }
  }, [loadData, requestConfirm, showToast]);

  const actions = useMemo(() => ({
    addWaitlist: (body) => runAction(() => addWaitlistEntry(body), {
      actionKey: "wait-add",
      successMessage: "Guest added to queue",
    }),
    seatWaitlist: (entryId, tableId) => runAction(() => seatWaitlistEntry(entryId, tableId), {
      actionKey: `wait-seat-${entryId}`,
      successMessage: "Guest seated",
    }),
    cancelWaitlist: (entryId) => runAction(
      () => cancelWaitlistEntry(entryId),
      {
        confirmText: "Cancel this waitlist entry?",
        actionKey: `wait-cancel-${entryId}`,
        successMessage: "Waitlist entry cancelled",
      },
    ),
    createBooking: (body) => runAction(() => createBooking(body), {
      actionKey: "booking-create",
      successMessage: "Booking created",
    }),
    cancelBooking: (bookingId) => runAction(
      () => cancelBooking(bookingId),
      {
        confirmText: "Cancel this reservation?",
        actionKey: `booking-cancel-${bookingId}`,
        successMessage: "Reservation cancelled",
      },
    ),
    cancelFoodOrder: (orderId) => runAction(
      () => cancelFoodOrder(orderId),
      {
        confirmText: "Cancel this food order?",
        actionKey: `food-cancel-${orderId}`,
        successMessage: "Food order cancelled",
      },
    ),
    addMenuItem: (name, price, category) => runAction(() => addMenuItem(name, price, category), {
      actionKey: "menu-add",
      successMessage: "Menu item added",
    }),
    updateMenuItem: (oldName, newName, price, category) => runAction(
      () => updateMenuItem(oldName, newName, price, category),
      {
        actionKey: `menu-edit-${oldName}`,
        successMessage: "Menu item saved",
      },
    ),
    deleteMenuItem: (name) => runAction(
      () => deleteMenuItem(name),
      {
        confirmText: `Delete ${name}?`,
        actionKey: `menu-delete-${name}`,
        successMessage: "Menu item deleted",
      },
    ),
    setItemAvailability: (name, available) => runAction(() => setItemAvailability(name, available), {
      actionKey: `stock-${name}`,
      successMessage: available ? "Item marked in stock" : "Item marked out of stock",
    }),
    setMaintenance: (tableId, reason) => runAction(() => setMaintenance(tableId, reason), {
      actionKey: "maintenance-set",
      successMessage: "Maintenance saved",
    }),
    clearMaintenance: (tableId) => runAction(() => clearMaintenance(tableId), {
      actionKey: `maintenance-clear-${tableId}`,
      successMessage: "Maintenance cleared",
    }),
  }), [runAction]);

  const props = useMemo(
    () => ({ ...data, actions, busy, activeAction, showToast }),
    [data, actions, busy, activeAction, showToast],
  );

  if (loading) {
    return <WorkspaceLoading />;
  }

  const content =
    view === "reservations" ? <ReservationsView {...props} /> :
    view === "billing" ? <BillingView {...props} /> :
    view === "inventory" ? <InventoryView {...props} /> :
    view === "notifications" ? <NotificationsView {...props} /> :
    view === "staff" ? <StaffView {...props} /> :
    <WaitlistView {...props} />;

  return (
    <>
      <LoadErrorBanner message={loadError} onRetry={() => loadData(() => true, { showLoading: true })} />
      {content}
    </>
  );
}
