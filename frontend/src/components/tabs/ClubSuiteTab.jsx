import { Panel as HsrPanel } from "../ui/index.js";
import { formatCurrency as polishCurrency } from "../../utils/format.js";
import { Icon as HsrIcon, Button as HsrButton, Select as HsrSelect, Input as HsrInput, Textarea as HsrTextarea, EmptyState, Button, Modal as SharedModal } from "../ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedState, hasCachedState } from "../../hooks/useCachedState.js";
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
  restoreFoodOrder,
  restoreMenuItem,
  updateMenuItem,
} from "../../api/index.js";
import { HSR_TABLES } from "../../config/hsrTables.js";
import { getTableStatus, TABLE_STATUS } from "../../config/tableStatus.js";
import { MetricCard } from "../ui/index.js";
import { useToast } from "../toastContext.js";
import { useConfirm } from "../confirmContext.js";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import RetryNotice from "../RetryNotice.jsx";
import { readableFloorSnapshot } from "../../features/live-floor/floorData.js";

function money(value = 0) { return polishCurrency(value); }

function asArray(value) {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (!value || typeof value !== "object") return [];
  if (Object.hasOwn(value, "items")) return asArray(value.items);
  if (Object.hasOwn(value, "menu")) return asArray(value.menu);
  if (Object.hasOwn(value, "data")) return asArray(value.data);
  return Object.entries(value).filter(([, item]) => item != null).map(([name, item]) => (
    item && typeof item === "object"
      ? { name, ...item }
      : { name, price: Number(item || 0), available: true }
  ));
}

function asMaintenanceRows(value) {
  if (Array.isArray(value)) return asArray(value);
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

function foodOrderRestorePayload(order = {}) {
  return {
    date: order.date || "",
    ts: order.ts || null,
    customer_name: order.customer_name || "",
    items: Array.isArray(order.items) ? order.items : [],
    total: Number(order.total || 0),
    payment_method: order.payment_method || "Cash",
  };
}

function menuItemRestorePayload(item = {}) {
  return {
    name: item.name || "",
    price: Number(item.price || 0),
    category: item.category || "Snacks",
    available: item.available !== false,
  };
}

function Section({ eyebrow, title, action, children }) {
  return (
    <HsrPanel as="section" className="cf-panel">
      <div className="cf-section-head">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </HsrPanel>
  );
}

function emptyWorkspaceData() {
  return {
    known: {},
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
  staff: [
    { label: "audit logs", key: "auditLogs", request: () => getAuditLogs(50) },
  ],
};

function WorkspaceLoading() {
  return (
    <div className="cf-page">
      <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading workspace data">
        <div className="page-skeleton-status">
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
      <HsrIcon className="ti ti-alert-circle" aria-hidden="true" />
      <span>{message}</span>
      <HsrButton native type="button" onClick={onRetry}>
        Retry
      </HsrButton>
    </div>
  );
}

function ActionButton({ tone = "default", icon, children, className = "", ...props }) {
  return (
    <HsrButton native type="button" className={["cf-action-btn", tone, className].filter(Boolean).join(" ")} {...props}>
      {icon && <HsrIcon className={`ti ${icon}`} aria-hidden="true" />}
      <span>{children}</span>
    </HsrButton>
  );
}

function Modal({ title, onClose, children, busy = false }) {
  function close() {
    const active = document.activeElement;
    if (active?.matches("input,textarea,select") && String(active.value || "").trim()) {
      active.blur();
      return;
    }
    onClose();
  }
  return <SharedModal open portal title={title} onClose={onClose} onEscape={close} closeDisabled={busy} dismissOnBackdrop={false} className="cf-modal">{children}</SharedModal>;
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
  return <MetricCard label={label} value={value} className="cf-stat" />;
}

function RowList({ rows, emptyTitle = "Nothing pending", emptyDetail = "New activity will appear here automatically.", emptyIcon = "ti-circle-check", emptyAction }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDetail}
        action={emptyAction}
      />
    );
  }
  return (
    <div className="cf-row-list">
      {rows.map((row) => (
        <div className={`cf-row ${row.tone || ""}`} key={row.id}>
          <HsrIcon className={`ti ${row.icon}`} aria-hidden="true" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong title={row.title} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</strong>
            <span title={row.detail} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.detail}</span>
          </div>
          {row.amount && <em>{row.amount}</em>}
          {row.action}
        </div>
      ))}
    </div>
  );
}

function WaitlistView({ waitlist, bookings, tableState, known, onRetry, actions, busy, activeAction, showToast }) {
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
  const tableDataComplete = HSR_TABLES.every((table) => tableState.some((row) => String(row.id).toLowerCase() === table.id && Object.hasOwn(TABLE_STATUS, row.status_key)));
  const availableTables = tableDataComplete ? HSR_TABLES.filter(
    (table) => tableState.some(row => String(row.id).toLowerCase() === table.id && row.status_key === "available"),
  ) : [];

  async function submitWaitlist(event) {
    event.preventDefault();
    const success = await actions.addWaitlist(form);
    if (!success) return;
    setForm({ customer_name: "", phone: "", party_size: 2, preferred_type: "ANY", notes: "" });
    setShowAdd(false);
  }

  async function seatEntry(entry) {
    const recommended = availableTables.find(table => table.id === entry.recommended_table?.id);
    const tableId = seatTarget[entry.id] || recommended?.id || availableTables[0]?.id || "";
    if (!availableTables.some(table => table.id === tableId)) {
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
          <span>{tableDataComplete ? `${availableTables.length} tables available for seating` : "Table availability unavailable"}</span>
        </div>
        <ActionButton tone="primary" icon="ti-user-plus" onClick={() => setShowAdd(true)}>
          Add Walk-in Guest
        </ActionButton>
      </div>
      <div className="cf-stat-grid">
        <Stat label="Waiting" value={waitlist.length} />
        <Stat label="Upcoming Bookings" value={known.bookings ? upcoming.length : "—"} />
        <Stat label="Missed Bookings" value={known.bookings ? missed.length : "—"} />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Queue" title="Walk-ins Waiting">
          <RowList
            emptyIcon="ti-clock"
            emptyTitle="Ready for the next walk-in"
            emptyDetail="Add a waiting guest to keep their place in the queue."
            emptyAction={<Button icon="ti-user-plus" disabled={busy} onClick={() => setShowAdd(true)}>Add Walk-in Guest</Button>}
            rows={waitlist.map((entry) => ({
              id: `wait-${entry.id}`,
              icon: "ti-clock",
              title: `${entry.position == null ? "" : `${entry.position}. `}${entry.customer_name || "Name unavailable"}${entry.pending ? " · Saving…" : ""}`,
              detail: `${entry.party_size ?? "—"} player(s) · ${entry.preferred_type || "Any table"} · ${entry.wait_mins ?? "—"} min wait`,
              action: (
                <div className="cf-row-actions">
                  <HsrSelect
                    aria-label={`Table for ${entry.customer_name || "waiting guest"}`}
                    value={seatTarget[entry.id] || availableTables.find(table => table.id === entry.recommended_table?.id)?.id || availableTables[0]?.id || ""}
                    onChange={(event) => setSeatTarget((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                    disabled={busy}
                  >
                    <option value="">Select table</option>
                    {availableTables.map((table) => (
                      <option value={table.id} key={table.id}>
                        T{table.num} · {table.label}
                      </option>
                    ))}
                  </HsrSelect>
                  <ActionButton tone="success" icon="ti-armchair" onClick={() => seatEntry(entry)} disabled={busy || !availableTables.length}>
                    {activeAction === `wait-seat-${entry.id}` ? "Seating..." : "Seat"}
                  </ActionButton>
                  <ActionButton tone="danger" icon="ti-x" onClick={() => actions.cancelWaitlist(entry.id)} disabled={busy}>
                    {activeAction === `wait-cancel-${entry.id}` ? "Cancelling..." : "Cancel Queue Entry"}
                  </ActionButton>
                </div>
              ),
            }))}
          />
        </Section>
        <Section eyebrow="Bookings" title="Upcoming / Missed">
          {!known.bookings ? <RetryNotice message="Booking details are unavailable." onRetry={onRetry} /> : <RowList
            emptyTitle="No bookings to review"
            emptyDetail="Upcoming and missed bookings will appear here."
            rows={[...upcoming, ...missed].slice(0, 10).map((booking) => ({
              id: `booking-${booking.id}`,
              icon: booking.status === "missed" ? "ti-alert-triangle" : "ti-calendar",
              title: booking.customer_name,
              detail: `${booking.table_id || "ANY"} · ${shortDate(booking.booking_time)} · ${booking.status}`,
            }))}
          />}
        </Section>
      </div>
      {showAdd && (
        <Modal title="Add Walk-in Guest" onClose={() => setShowAdd(false)} busy={busy}>
          <form className="cf-form" onSubmit={submitWaitlist}>
            <FormField label="Customer full name">
              <HsrInput
                required
                value={form.customer_name}
                onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                placeholder="First and last name"
              />
            </FormField>
            <FormField label="Phone">
              <HsrInput
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Optional"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Players">
                <HsrInput
                  type="number"
                  min="1"
                  value={form.party_size}
                  onChange={(event) => setForm((prev) => ({ ...prev, party_size: Number(event.target.value) || 1 }))}
                />
              </FormField>
              <FormField label="Preferred table">
                <HsrSelect
                  value={form.preferred_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, preferred_type: event.target.value }))}
                >
                  <option value="ANY">Any</option>
                  <option value="SNOOKER">Snooker</option>
                  <option value="POOL">Pool</option>
                </HsrSelect>
              </FormField>
            </div>
            <FormField label="Notes">
              <HsrTextarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Preference, regular customer, callback note"
              />
            </FormField>
            <div className="cf-modal-actions">
              <ActionButton disabled={busy} onClick={() => setShowAdd(false)}>Discard Walk-in</ActionButton>
              <HsrButton native className="cf-action-btn primary" type="submit" loading={busy}>
                <HsrIcon className="ti ti-user-plus" aria-hidden="true" />
                <span>{activeAction === "wait-add" ? "Adding..." : "Add Walk-in"}</span>
              </HsrButton>
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
            <HsrButton native
              type="button"
              key={status}
              className={filter === status ? "active" : ""}
              onClick={() => setFilter(status)}
            >
              {status}
            </HsrButton>
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
                  {activeAction === `booking-cancel-${booking.id}` ? "Cancelling..." : "Cancel Booking"}
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
              <HsrInput
                required
                value={form.customer_name}
                onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                placeholder="First and last name"
              />
            </FormField>
            <FormField label="Phone">
              <HsrInput
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Optional"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Table">
                <HsrSelect
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
                </HsrSelect>
              </FormField>
              <FormField label="Table type">
                <HsrSelect
                  value={form.table_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, table_type: event.target.value }))}
                >
                  <option value="ANY">Any</option>
                  <option value="SNOOKER">Snooker</option>
                  <option value="POOL">Pool</option>
                </HsrSelect>
              </FormField>
            </div>
            <div className="cf-form-grid">
              <FormField label="Date and time">
                <HsrInput
                  required
                  type="datetime-local"
                  value={form.booking_time}
                  onChange={(event) => setForm((prev) => ({ ...prev, booking_time: event.target.value }))}
                />
              </FormField>
              <FormField label="Duration">
                <HsrInput
                  type="number"
                  min="30"
                  step="15"
                  value={form.duration_mins}
                  onChange={(event) => setForm((prev) => ({ ...prev, duration_mins: Number(event.target.value) || 60 }))}
                />
              </FormField>
            </div>
            <FormField label="Notes">
              <HsrTextarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Advance, preference, phone reminder"
              />
            </FormField>
            <div className="cf-modal-actions">
              <ActionButton onClick={() => setShowAdd(false)}>Discard Booking</ActionButton>
              <HsrButton native className="cf-action-btn primary" type="submit" loading={busy}>
                <HsrIcon className="ti ti-calendar-plus" aria-hidden="true" />
                <span>{activeAction === "booking-create" ? "Creating..." : "Create Booking"}</span>
              </HsrButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BillingView({ history, foodOrders, actions, busy, activeAction }) {
  const tableTotal = history.reduce((sum, bill) => sum + Number(bill.tot ?? bill.total ?? bill.amount ?? 0), 0);
  const foodTotal = foodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const recentBills = history.slice(0, 12).map((bill) => ({
    id: `bill-${bill.id || bill.date}-${bill.tbl || bill.table_id}`,
    icon: "ti-receipt",
    title: `${bill.tbl || bill.table_id || "Table"} · ${bill.payer_name || bill.nm || bill.customer_name || "Walk-in"}`,
    detail: `${bill.payment_method || "Cash"} · ${bill.date || ""}`,
    amount: money(bill.tot ?? bill.total ?? bill.amount ?? 0),
    tone: Number(bill.tot ?? bill.total ?? bill.amount ?? 0) <= 0 ? "warning" : "",
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
          onClick={() => actions.cancelFoodOrder(order)}
          disabled={busy}
        >
          {activeAction === `food-cancel-${order.id}` ? "Cancelling..." : "Cancel Food Order"}
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

function inventoryDetail(item) {
  const price = typeof item.price === "number" && Number.isFinite(item.price) ? money(item.price) : "—";
  const stock = typeof item.available !== "boolean" ? "Stock unavailable" : item.available ? "In stock" : "Out of stock";
  return `${item.category || "Menu"} · ${price} · ${stock}`;
}

function restorableMenuItem(item) {
  return typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0 && typeof item.available === "boolean";
}

function InventoryView({ menu, maintenance, known, onRetry, actions, busy, activeAction, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const [bulkResult, setBulkResult] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState({ table_id: "t1", reason: "Under maintenance" });
  const [menuForm, setMenuForm] = useState({
    name: "",
    price: "",
    category: "Veg Snacks",
  });
  const unavailable = menu.filter((item) => item.available === false);
  const stockComplete = menu.every(item => typeof item.available === "boolean");
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
  const failedItemNames = useMemo(
    () => new Set((bulkResult?.failed || []).map((item) => item.name)),
    [bulkResult],
  );
  const visibleMenu = menu;
  const selectedVisibleItems = visibleMenu.filter((item) => selectedItems.has(item.name));
  const selectedCount = selectedItems.size;
  const selectedDetailsComplete = selectedVisibleItems.every(restorableMenuItem);
  const allVisibleSelected = visibleMenu.length > 0 && visibleMenu.every((item) => selectedItems.has(item.name));

  function toggleItemSelection(name, checked) {
    setBulkResult(null);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }

  function toggleAllVisible(checked) {
    setBulkResult(null);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      visibleMenu.forEach((item) => {
        if (checked) {
          next.add(item.name);
        } else {
          next.delete(item.name);
        }
      });
      return next;
    });
  }

  function clearBulkSelection() {
    setSelectedItems(new Set());
    setBulkResult(null);
  }

  function keepFailedSelected(result) {
    const failedNames = new Set((result.failed || []).map((entry) => entry.name));
    setSelectedItems(failedNames);
    setBulkResult(result);
  }

  async function runBulkAvailability(available) {
    if (!selectedVisibleItems.length) {
      showToast("Select at least one visible menu item.", "error");
      return;
    }
    const result = await actions.bulkSetItemAvailability(selectedVisibleItems, available);
    keepFailedSelected({
      ...result,
      label: available ? "Mark in stock" : "Mark out of stock",
      failed: result.failed.map((entry) => entry.item || entry),
    });
  }

  async function runBulkDelete() {
    if (!selectedVisibleItems.length) {
      showToast("Select at least one visible menu item.", "error");
      return;
    }
    if (!selectedDetailsComplete) {
      showToast("Reload the selected item details before deleting.", "error");
      return;
    }
    const succeeded = [];
    const failed = [];
    for (const item of selectedVisibleItems) {
      const ok = await actions.deleteMenuItem(item);
      if (ok) {
        succeeded.push(item);
      } else {
        failed.push(item);
      }
    }
    keepFailedSelected({
      label: "Delete items",
      succeeded,
      failed,
    });
  }

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
        <Stat label="Out of Stock" value={stockComplete ? unavailable.length : "—"} />
        <Stat label="Cigarette Items" value={cigarettes.length} />
      </div>
      <div className="cf-inventory-grid">
        <Section eyebrow="Menu CRUD" title="Food Menu & Availability">
          {!stockComplete && <RetryNotice message="Some stock statuses are unavailable." onRetry={onRetry} />}
          {menu.length > 0 && (
            <div className={`cf-bulk-bar${selectedCount || bulkResult ? " is-active" : ""}`} aria-live="polite">
              <label className="cf-select-all">
                <HsrInput
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                />
                <span>{selectedCount ? `${selectedCount} selected` : "Select all items"}</span>
              </label>
              {(selectedCount > 0 || bulkResult) && (
                <>
                  {selectedCount > 0 && (
                    <div className="cf-bulk-actions">
                      <ActionButton
                        tone="warning"
                        icon="ti-package-off"
                        onClick={() => runBulkAvailability(false)}
                        disabled={busy || !selectedVisibleItems.length}
                      >
                        Mark Out of Stock
                      </ActionButton>
                      <ActionButton
                        tone="success"
                        icon="ti-check"
                        onClick={() => runBulkAvailability(true)}
                        disabled={busy || !selectedVisibleItems.length}
                      >
                        Mark In Stock
                      </ActionButton>
                      <ActionButton
                        tone="danger"
                        icon="ti-trash"
                        onClick={runBulkDelete}
                        disabled={busy || !selectedVisibleItems.length || !selectedDetailsComplete}
                        title={!selectedDetailsComplete ? "Reload item details before deleting" : undefined}
                      >
                        Delete Items
                      </ActionButton>
                      <ActionButton onClick={clearBulkSelection} disabled={busy}>
                        Clear Selection
                      </ActionButton>
                    </div>
                  )}
                  {bulkResult && (
                    <div className={`cf-bulk-result${bulkResult.failed.length ? " has-failures" : ""}`}>
                      <strong>
                        {bulkResult.succeeded.length} succeeded, {bulkResult.failed.length} failed
                      </strong>
                      {bulkResult.failed.length > 0 && (
                        <span className="cf-bulk-failed-list">
                          Failed:
                          {bulkResult.failed.map((item) => (
                            <b key={item.name} title={item.name} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</b>
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div className="cf-data-table">
            {visibleMenu.map((item) => (
              <div
                className={`cf-data-row cf-inventory-row${selectedItems.has(item.name) ? " is-selected" : ""}${failedItemNames.has(item.name) ? " has-bulk-error" : ""}`}
                key={item.name}
              >
                <label className="cf-row-select">
                  <HsrInput
                    type="checkbox"
                    checked={selectedItems.has(item.name)}
                    onChange={(event) => toggleItemSelection(item.name, event.target.checked)}
                    aria-label={`Select ${item.name}`}
                  />
                </label>
                <div style={{ minWidth: 0 }}>
                  <strong title={item.name} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong>
                  <span title={inventoryDetail(item)} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inventoryDetail(item)}</span>
                </div>
                <div className="cf-row-actions">
                  <ActionButton
                    className="cf-icon-action"
                    icon="ti-pencil"
                    aria-label={`Edit ${item.name}`}
                    title="Edit item"
                    onClick={() => setEditing({
                      oldName: item.name,
                      newName: item.name,
                      price: item.price ?? "",
                      category: item.category || "Veg Snacks",
                    })}
                  >
                    Edit
                  </ActionButton>
                  <ActionButton
                    className="cf-icon-action"
                    tone={typeof item.available !== "boolean" ? "default" : item.available === false ? "success" : "warning"}
                    icon={activeAction === `stock-${item.name}` ? "ti-loader-2" : item.available === false ? "ti-check" : "ti-package-off"}
                    aria-label={typeof item.available !== "boolean" ? `Stock status unavailable for ${item.name}` : activeAction === `stock-${item.name}` ? `Saving ${item.name}` : item.available === false ? `Mark ${item.name} in stock` : `Mark ${item.name} out of stock`}
                    title={typeof item.available !== "boolean" ? "Stock status unavailable" : item.available === false ? "Mark in stock" : "Mark out of stock"}
                    onClick={() => actions.setItemAvailability(item.name, item.available === false)}
                    disabled={busy || typeof item.available !== "boolean"}
                  >
                    {activeAction === `stock-${item.name}` ? "Saving" : item.available === false ? "In stock" : "Out of stock"}
                  </ActionButton>
                  <ActionButton
                    className="cf-icon-action"
                    tone="danger"
                    icon={activeAction === `menu-delete-${item.name}` ? "ti-loader-2" : "ti-trash"}
                    aria-label={activeAction === `menu-delete-${item.name}` ? `Deleting ${item.name}` : `Delete ${item.name}`}
                    title={restorableMenuItem(item) ? "Delete item" : "Reload item details before deleting"}
                    onClick={() => actions.deleteMenuItem(item)}
                    disabled={busy || !restorableMenuItem(item)}
                  >
                    {activeAction === `menu-delete-${item.name}` ? "Deleting" : "Delete"}
                  </ActionButton>
                </div>
              </div>
            ))}
            {!menu.length && (
              <EmptyState
                icon="ti-package"
                title="No menu items"
                description="Add snacks, drinks or cigarettes to start building the menu."
                action={<Button icon="ti-plus" onClick={() => setShowAdd(true)}>Add menu item</Button>}
              />
            )}
          </div>
        </Section>

        <Section
          eyebrow="Floor"
          title="Table Maintenance"
          action={
            <form className="cf-inline-form" onSubmit={submitMaintenance}>
              <HsrSelect
                aria-label="Table for maintenance"
                disabled={busy || !known.tableState}
                value={maintenanceForm.table_id}
                onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, table_id: event.target.value }))}
              >
                {HSR_TABLES.map((table) => (
                  <option value={table.id} key={table.id}>
                    T{table.num}
                  </option>
                ))}
              </HsrSelect>
              <HsrInput
                aria-label="Maintenance reason"
                disabled={busy || !known.tableState}
                value={maintenanceForm.reason}
                onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Reason"
              />
              <HsrButton native className="cf-action-btn warning" type="submit" loading={busy} disabled={!known.tableState}>
                <HsrIcon className="ti ti-tool" aria-hidden="true" />
                <span>{activeAction === "maintenance-set" ? "Saving..." : "Mark"}</span>
              </HsrButton>
            </form>
          }
        >
          {!known.tableState ? <RetryNotice message="Table maintenance details are unavailable." onRetry={onRetry} /> : <RowList
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
                    {activeAction === `maintenance-clear-${row.table_id}` ? "Clearing..." : "Mark Table Available"}
                  </ActionButton>
                </div>
              ),
            }))}
          />}
        </Section>
      </div>
      {showAdd && (
        <Modal title="Add Menu Item" onClose={() => setShowAdd(false)} busy={busy}>
          <form className="cf-form" onSubmit={submitMenuItem}>
            <FormField label="Item name">
              <HsrInput
                required
                value={menuForm.name}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Coffee, fries, cigarette pack"
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Price">
                <HsrInput
                  required
                  type="number"
                  min="0"
                  value={menuForm.price}
                  onChange={(event) => setMenuForm((prev) => ({ ...prev, price: event.target.value }))}
                />
              </FormField>
              <FormField label="Category">
                <HsrSelect
                  value={menuForm.category}
                  onChange={(event) => setMenuForm((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {categories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </HsrSelect>
              </FormField>
            </div>
            <div className="cf-modal-actions">
              <ActionButton disabled={busy} onClick={() => setShowAdd(false)}>Discard Menu Item</ActionButton>
              <HsrButton native className="cf-action-btn primary" type="submit" loading={busy}>
                <HsrIcon className="ti ti-package-plus" aria-hidden="true" />
                <span>{activeAction === "menu-add" ? "Adding..." : "Add Menu Item"}</span>
              </HsrButton>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title="Edit Menu Item" onClose={() => setEditing(null)} busy={busy}>
          <form className="cf-form" onSubmit={submitEdit}>
            <FormField label="Item name">
              <HsrInput
                required
                value={editing.newName}
                onChange={(event) => setEditing((prev) => ({ ...prev, newName: event.target.value }))}
              />
            </FormField>
            <div className="cf-form-grid">
              <FormField label="Price">
                <HsrInput
                  required
                  type="number"
                  min="0"
                  value={editing.price}
                  onChange={(event) => setEditing((prev) => ({ ...prev, price: event.target.value }))}
                />
              </FormField>
              <FormField label="Category">
                <HsrSelect
                  value={editing.category}
                  onChange={(event) => setEditing((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {categories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </HsrSelect>
              </FormField>
            </div>
            <div className="cf-modal-actions">
              <ActionButton disabled={busy} onClick={() => setEditing(null)}>Discard Changes</ActionButton>
              <HsrButton native className="cf-action-btn primary" type="submit" loading={busy}>
                <HsrIcon className="ti ti-device-floppy" aria-hidden="true" />
                <span>{activeAction === `menu-edit-${editing.oldName}` ? "Saving..." : "Save Menu Item"}</span>
              </HsrButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function StaffView({ auditLogs, onRetry }) {
  const actorsKnown = auditLogs.every(log => typeof log.staff === "string" && log.staff.trim());
  const severitiesKnown = auditLogs.every(log => ["info", "warning", "danger", "critical"].includes(log.severity));
  const staffMap = auditLogs.reduce((acc, log) => {
    const key = log.staff || "Unknown actor";
    acc[key] = acc[key] || { actions: 0, risk: 0, riskKnown: true };
    acc[key].actions += 1;
    if (!["info", "warning", "danger", "critical"].includes(log.severity)) acc[key].riskKnown = false;
    if (["danger", "critical"].includes(log.severity)) acc[key].risk += 1;
    return acc;
  }, Object.create(null));
  const rows = Object.entries(staffMap).map(([staff, value]) => ({
    id: staff,
    icon: "ti-user-check",
    title: staff,
    tone: value.risk > 0 ? "warning" : "",
    detail: `${value.actions} logged action(s) · ${value.riskKnown ? value.risk : "—"} risk action(s)`,
  }));
  return (
    <div className="cf-page cf-page-staff">
      <div className="cf-stat-grid">
        <Stat label="Staff/System Actors" value={actorsKnown ? rows.length : "—"} />
        <Stat label="Logged Actions" value={auditLogs.length} />
        <Stat label="Risk Actions" value={severitiesKnown ? Object.values(staffMap).reduce((sum, row) => sum + row.risk, 0) : "—"} />
      </div>
      <Section eyebrow="Activity" title="Staff Action Summary">
        {(!actorsKnown || !severitiesKnown) && <RetryNotice message="Some audit details are unavailable." onRetry={onRetry} />}
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
  const [data, setData] = useCachedState(`workspace:${view}`, () => emptyWorkspaceData());
  const [optimistic, setOptimistic] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [loading, setLoading] = useState(() => !hasCachedState(`workspace:${view}`));
  const [loadError, setLoadError] = useState("");
  const realtimeRefreshTimerRef = useRef(null);

  const loadData = useCallback(async (shouldCommit = () => true, { showLoading = false } = {}) => {
    if (showLoading && !hasCachedState(`workspace:${view}`)) setLoading(true);
    setLoadError("");
    try {
      const loaders = WORKSPACE_LOADERS[view] || WORKSPACE_LOADERS.waitlist;
      const results = await Promise.allSettled(loaders.map((loader) => loader.request()));
      if (!shouldCommit()) return;
      const failed = results
        .map((result, index) => (result.status === "rejected" ? loaders[index].label : ""))
        .filter(Boolean);
      const nextData = { known: {} };
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const key = loaders[index].key;
        const payload = result.value.data;
        if (!payload || typeof payload !== "object") { failed.push(loaders[index].label); return; }
        if (!["tableState", "menu"].includes(key) && !Array.isArray(payload)) { failed.push(loaders[index].label); return; }
        if (key === "tableState") {
          if (!Array.isArray(payload.tables)) {
            failed.push(loaders[index].label);
            return;
          }
          let snapshot;
          try { snapshot = readableFloorSnapshot(payload); }
          catch { failed.push(loaders[index].label); return; }
          nextData.activeSessions = asArray(payload.active_sessions);
          nextData.tableState = snapshot.tables;
          nextData.maintenance = asMaintenanceRows(payload.maintenance);
          nextData.known.tableState = true;
          return;
        }
        nextData[key] = asArray(payload);
        nextData.known[key] = true;
      });
      setData(current => ({ ...current, ...nextData, known: { ...current.known, ...nextData.known } }));
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
  }, [view, setData]);

  const scheduleRealtimeRefresh = useCallback(() => {
    window.clearTimeout(realtimeRefreshTimerRef.current);
    realtimeRefreshTimerRef.current = window.setTimeout(loadData, 150);
  }, [loadData]);

  const realtimeTopic = view === "waitlist" ? "waitlist" : view === "inventory" ? "inventory" : "";

  const realtimeState = useRealtimeSubscription({
    topics: realtimeTopic ? [realtimeTopic] : [],
    enabled: Boolean(realtimeTopic),
    onEvent: (event) => {
      if (
        event.type === "system.sync_required" ||
        (view === "waitlist" && event.type === "waitlist.changed") ||
        (view === "inventory" && event.type === "inventory.updated")
      ) {
        scheduleRealtimeRefresh();
      }
    },
    onFallbackPoll: loadData,
    fallbackPollMs: 15000,
  });

  useEffect(() => {
    let alive = true;
    loadData(() => alive, { showLoading: true });
    return () => {
      alive = false;
    };
  }, [view, loadData]);

  useEffect(() => {
    if (!realtimeTopic || realtimeState !== "connected") return undefined;
    const safetyPoll = window.setInterval(loadData, 60000);
    return () => window.clearInterval(safetyPoll);
  }, [loadData, realtimeState, realtimeTopic]);

  useEffect(() => () => window.clearTimeout(realtimeRefreshTimerRef.current), []);

  const runAction = useCallback(async (action, {
    confirmText = "",
    confirmTitle = "Review action",
    confirmLabel = "Confirm Action",
    actionKey = "action",
    successMessage = "",
    undoLabel = "",
    onUndo,
    optimisticUpdate,
  } = {}) => {
    if (confirmText) {
      const confirmed = await requestConfirm({
        title: confirmTitle,
        message: confirmText,
        confirmLabel,
        tone: "warning",
      });
      if (!confirmed) return false;
    }
    setBusy(true);
    setActiveAction(actionKey);
    if (optimisticUpdate) setOptimistic(() => optimisticUpdate);
    try {
      await action();
      await loadData();
      if (successMessage && onUndo) {
        showToast(successMessage, "success", {
          actionLabel: undoLabel || "Undo",
          duration: 5000,
          onAction: async () => {
            setBusy(true);
            setActiveAction(`${actionKey}-undo`);
            try {
              await onUndo();
              await loadData();
              showToast("Action restored", "success");
            } catch (error) {
              showToast(error.response?.data?.detail || "Could not restore action", "error");
            } finally {
              setBusy(false);
              setActiveAction("");
            }
          },
        });
      } else if (successMessage) {
        showToast(successMessage, "success");
      }
      return true;
    } catch (error) {
      showToast(error.response?.data?.detail || "Action failed", "error");
      return false;
    } finally {
      setOptimistic(null);
      setBusy(false);
      setActiveAction("");
    }
  }, [loadData, requestConfirm, showToast]);

  const actions = useMemo(() => ({
    addWaitlist: (body) => runAction(() => addWaitlistEntry(body), {
      actionKey: "wait-add",
      successMessage: "Guest added to queue",
      optimisticUpdate: current => ({ ...current, waitlist: [...current.waitlist, { ...body, id: "pending-walk-in", position: current.waitlist.length + 1, wait_mins: 0, pending: true }] }),
    }),
    seatWaitlist: (entryId, tableId) => runAction(() => seatWaitlistEntry(entryId, tableId), {
      actionKey: `wait-seat-${entryId}`,
      successMessage: "Guest seated",
      optimisticUpdate: current => ({ ...current, waitlist: current.waitlist.filter(row => row.id !== entryId) }),
    }),
    cancelWaitlist: (entryId) => runAction(
      () => cancelWaitlistEntry(entryId),
      {
        confirmText: "Cancel this waitlist entry?",
        confirmTitle: "Cancel queue entry?",
        confirmLabel: "Cancel Queue Entry",
        actionKey: `wait-cancel-${entryId}`,
        successMessage: "Waitlist entry cancelled",
        optimisticUpdate: current => ({ ...current, waitlist: current.waitlist.filter(row => row.id !== entryId) }),
      },
    ),
    createBooking: (body) => runAction(() => createBooking(body), {
      actionKey: "booking-create",
      successMessage: "Booking created",
      optimisticUpdate: current => ({ ...current, bookings: [...current.bookings, { ...body, id: "pending-booking", status: "booked", pending: true }] }),
    }),
    cancelBooking: (bookingId) => runAction(
      () => cancelBooking(bookingId),
      {
        confirmText: "Cancel this reservation?",
        confirmTitle: "Cancel booking?",
        confirmLabel: "Cancel Booking",
        actionKey: `booking-cancel-${bookingId}`,
        successMessage: "Reservation cancelled",
        optimisticUpdate: current => ({ ...current, bookings: current.bookings.map(row => row.id === bookingId ? { ...row, status: "cancelled" } : row) }),
      },
    ),
    cancelFoodOrder: (order) => runAction(
      () => cancelFoodOrder(order.id),
      {
        actionKey: `food-cancel-${order.id}`,
        successMessage: "Food order cancelled",
        optimisticUpdate: current => ({ ...current, foodOrders: current.foodOrders.filter(row => row.id !== order.id) }),
        undoLabel: "Undo",
        onUndo: () => restoreFoodOrder(order.id, foodOrderRestorePayload(order)),
      },
    ),
    addMenuItem: (name, price, category) => runAction(() => addMenuItem(name, price, category), {
      actionKey: "menu-add",
      successMessage: "Menu item added",
      optimisticUpdate: current => ({ ...current, menu: [...current.menu, { name, price, category, available: true, pending: true }] }),
    }),
    updateMenuItem: (oldName, newName, price, category) => runAction(
      () => updateMenuItem(oldName, newName, price, category),
      {
        actionKey: `menu-edit-${oldName}`,
        successMessage: "Menu item saved",
        optimisticUpdate: current => ({ ...current, menu: current.menu.map(row => row.name === oldName ? { ...row, name: newName, price, category, pending: true } : row) }),
      },
    ),
    deleteMenuItem: (item) => runAction(
      () => deleteMenuItem(item.name),
      {
        actionKey: `menu-delete-${item.name}`,
        successMessage: "Menu item deleted",
        optimisticUpdate: current => ({ ...current, menu: current.menu.filter(row => row.name !== item.name) }),
        undoLabel: "Undo",
        onUndo: () => restoreMenuItem(menuItemRestorePayload(item)),
      },
    ),
    setItemAvailability: (name, available) => runAction(() => setItemAvailability(name, available), {
      actionKey: `stock-${name}`,
      successMessage: available ? "Item marked in stock" : "Item marked out of stock",
      optimisticUpdate: current => ({ ...current, menu: current.menu.map(row => row.name === name ? { ...row, available, pending: true } : row) }),
    }),
    bulkSetItemAvailability: async (items, available) => {
      setBusy(true);
      setActiveAction(`bulk-stock-${available ? "in" : "out"}`);
      const succeeded = [];
      const failed = [];
      try {
        for (const item of items) {
          try {
            await setItemAvailability(item.name, available);
            succeeded.push(item);
          } catch (error) {
            failed.push({ item, error });
          }
        }
        await loadData();
        const actionLabel = available ? "marked in stock" : "marked out of stock";
        showToast(
          `${succeeded.length} ${succeeded.length === 1 ? "item" : "items"} ${actionLabel}${failed.length ? `, ${failed.length} failed` : ""}`,
          failed.length ? "error" : "success",
        );
        return { succeeded, failed };
      } finally {
        setBusy(false);
        setActiveAction(null);
      }
    },
    setMaintenance: (tableId, reason) => runAction(() => setMaintenance(tableId, reason), {
      actionKey: "maintenance-set",
      successMessage: "Maintenance saved",
    }),
    clearMaintenance: (tableId) => runAction(() => clearMaintenance(tableId), {
      actionKey: `maintenance-clear-${tableId}`,
      successMessage: "Maintenance cleared",
    }),
  }), [loadData, runAction, showToast]);

  const props = useMemo(() => {
    const rows = Object.fromEntries(Object.keys(emptyWorkspaceData()).filter(key => key !== "known").map((key) => [key, asArray(data?.[key])]));
    return { ...(optimistic ? optimistic(rows) : rows), known: data.known || {}, onRetry: () => loadData(), actions, busy, activeAction, showToast };
  }, [data, optimistic, loadData, actions, busy, activeAction, showToast]);

  if (loading) {
    return <div data-realtime-state={realtimeState}><WorkspaceLoading /></div>;
  }

  const primaryKey = { reservations: "bookings", billing: "history", inventory: "menu", staff: "auditLogs", waitlist: "waitlist" }[view] || "waitlist";
  if (!data.known?.[primaryKey]) return <RetryNotice message={loadError || "Workspace data is unavailable."} onRetry={() => loadData(() => true, { showLoading: true })} />;

  const content =
    view === "reservations" ? <ReservationsView {...props} /> :
    view === "billing" ? <BillingView {...props} /> :
    view === "inventory" ? <InventoryView {...props} /> :
    view === "staff" ? <StaffView {...props} /> :
    <WaitlistView {...props} />;

  return (
    <div data-realtime-state={realtimeState}>
      <LoadErrorBanner message={loadError} onRetry={() => loadData(() => true, { showLoading: true })} />
      {content}
    </div>
  );
}
