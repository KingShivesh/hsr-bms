import { useCallback, useEffect, useMemo, useState } from "react";
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
  getActive,
  getBookings,
  getFoodOrders,
  getFoodStats,
  getHistory,
  getMaintenance,
  getMenuFull,
  getTableUtilization,
  getTopCustomers,
  getWaitlist,
  seatWaitlistEntry,
  setItemAvailability,
  setMaintenance,
  updateMenuItem,
} from "../../api/index.js";
import { HSR_TABLES } from "../../config/hsrTables.js";
import { useToast } from "../toastContext.js";

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

function ActionButton({ tone = "default", icon, children, ...props }) {
  return (
    <button type="button" className={`cf-action-btn ${tone}`} {...props}>
      {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="cf-modal-backdrop" role="presentation">
      <div className="cf-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="cf-modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
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

function Stat({ label, value, icon, tone = "blue" }) {
  return (
    <article className={`cf-stat ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i className={`ti ${icon}`} aria-hidden="true" />
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

function SuiteHero({ eyebrow, title, detail, tone = "blue", metrics = [] }) {
  return (
    <div className={`cf-hero cf-hero-${tone}`}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {!!metrics.length && (
        <div className="cf-hero-metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <strong>{metric.value}</strong>
              <small>{metric.label}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RowList({ rows }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon="ti-circle-check"
        title="Nothing pending"
        detail="This area will populate automatically as staff use the system."
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

function WaitlistView({ waitlist, bookings, activeSessions, maintenance, actions, busy, activeAction }) {
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
      alert("No available table to seat this customer.");
      return;
    }
    await actions.seatWaitlist(entry.id, tableId);
  }

  return (
    <div className="cf-page cf-page-queue">
      <SuiteHero
        tone="amber"
        eyebrow="Reception flow"
        title="Smart Waitlist Queue"
        detail="Track walk-ins, queue pressure and booking conflicts before they become front-desk confusion."
        metrics={[
          { label: "waiting", value: waitlist.length },
          { label: "booked", value: upcoming.length },
          { label: "missed", value: missed.length },
        ]}
      />
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
        <Stat label="Waiting" value={waitlist.length} icon="ti-user-clock" tone="purple" />
        <Stat label="Upcoming Bookings" value={upcoming.length} icon="ti-calendar-event" />
        <Stat label="Missed Bookings" value={missed.length} icon="ti-alert-circle" tone="amber" />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Queue" title="Walk-ins Waiting">
          <RowList
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

function ReservationsView({ bookings, actions, busy, activeAction }) {
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
      <SuiteHero
        tone="purple"
        eyebrow="Reservation desk"
        title="Reservations & Slots"
        detail="See table-wise commitments and no-show risk without digging into the table floor."
        metrics={[
          { label: "active bookings", value: booked.length },
          { label: "tables covered", value: tableBookings.filter((row) => row.bookings.length).length },
        ]}
      />
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
      <div className="cf-calendar-grid">
        {tableBookings.map(({ table, bookings: rows }) => (
          <section className="cf-table-slot" key={table.id}>
            <div>
              <strong>T{table.num}</strong>
              <span>{table.label || table.type || table.id}</span>
            </div>
            {rows.length ? (
              rows.slice(0, 3).map((booking) => (
                <p key={booking.id}>
                  <b>{booking.customer_name}</b>
                  <small>{shortDate(booking.booking_time)}</small>
                </p>
              ))
            ) : (
              <em>Open slots</em>
            )}
          </section>
        ))}
      </div>
      <Section eyebrow="Bookings" title="Reservation Register">
        <RowList
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
      <SuiteHero
        tone="blue"
        eyebrow="Money desk"
        title="Billing & Invoices"
        detail="Fast view of table settlements and cafe bills, designed for cashier reconciliation."
        metrics={[
          { label: "table bill value", value: money(tableTotal) },
          { label: "food bill value", value: money(foodTotal) },
        ]}
      />
      <div className="cf-toolbar">
        <div>
          <strong>Cashier register</strong>
          <span>Review table settlements and cancel incorrect food-only orders.</span>
        </div>
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Tables" title="Recent Table Bills">
          <RowList rows={recentBills} />
        </Section>
        <Section eyebrow="Cafe" title="Recent Food Bills">
          <RowList rows={foodRows} />
        </Section>
      </div>
    </div>
  );
}

function InventoryView({ menu, maintenance, actions, busy, activeAction }) {
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
      alert("Enter item name and valid price.");
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
      alert("Enter item name and valid price.");
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
      <SuiteHero
        tone="green"
        eyebrow="Stock control"
        title="Inventory & Stocks"
        detail="Operational stock visibility for cafe availability, cigarettes and table maintenance."
        metrics={[
          { label: "menu items", value: menu.length },
          { label: "out of stock", value: unavailable.length },
          { label: "maintenance", value: maintenance.length },
        ]}
      />
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
        <Stat label="Menu Items" value={menu.length} icon="ti-package" />
        <Stat label="Out of Stock" value={unavailable.length} icon="ti-alert-circle" tone="amber" />
        <Stat label="Cigarette Items" value={cigarettes.length} icon="ti-smoking" tone="purple" />
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
      <SuiteHero
        tone="red"
        eyebrow="Control alerts"
        title="Notification Center"
        detail="One place for missed bookings, waitlist pressure, maintenance and sensitive audit events."
        metrics={[
          { label: "alerts", value: notifications.length },
          { label: "audit events", value: auditLogs.length },
        ]}
      />
      <Section eyebrow="Alerts" title="Live Notifications">
        <RowList rows={notifications} />
      </Section>
    </div>
  );
}

function MembershipPlansView({ topCustomers }) {
  const plans = [
    { name: "Silver", price: 499, benefit: "Basic profile, visit tracking and 5% courtesy discount marker." },
    { name: "Gold", price: 999, benefit: "Priority booking marker, higher spend visibility and 10% discount marker." },
    { name: "Premium VIP", price: 1999, benefit: "VIP tag, best customer tracking and preferred table history." },
  ];
  return (
    <div className="cf-page cf-page-memberships">
      <SuiteHero
        tone="purple"
        eyebrow="Loyalty"
        title="Membership Plans"
        detail="A simple membership surface for repeat players, VIPs and owner-level customer focus."
        metrics={[
          { label: "plans", value: plans.length },
          { label: "targets", value: topCustomers.length },
        ]}
      />
      <div className="cf-plan-grid">
        {plans.map((plan) => (
          <section className="cf-plan" key={plan.name}>
            <span>{plan.name}</span>
            <strong>{money(plan.price)}<small>/mo</small></strong>
            <p>{plan.benefit}</p>
          </section>
        ))}
      </div>
      <Section eyebrow="Customers" title="Top Customer Targets">
        <RowList
          rows={topCustomers.slice(0, 8).map((customer, index) => ({
            id: customer.customer_id || `${customer.name}-${index}`,
            icon: "ti-user-star",
            title: customer.name || customer.customer_name || "Customer",
            detail: `${customer.visits || customer.sessions || 0} visits`,
            amount: money(customer.spent || customer.total || customer.revenue || 0),
          }))}
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
      <SuiteHero
        tone="slate"
        eyebrow="Team overview"
        title="Staff & Roster"
        detail="Lightweight staff activity view using the audit trail, without adding heavy HR complexity."
        metrics={[
          { label: "staff/system actors", value: rows.length },
          { label: "logged actions", value: auditLogs.length },
        ]}
      />
      <Section eyebrow="Activity" title="Staff Action Summary">
        <RowList rows={rows} />
      </Section>
    </div>
  );
}

export default function ClubSuiteTab({ view }) {
  const { showToast } = useToast();
  const [data, setData] = useState({
    waitlist: [],
    bookings: [],
    activeSessions: [],
    history: [],
    foodOrders: [],
    foodStats: [],
    menu: [],
    maintenance: [],
    auditLogs: [],
    topCustomers: [],
    utilization: [],
  });
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState("");

  const loadData = useCallback(async (shouldCommit = () => true) => {
    const results = await Promise.allSettled([
      getWaitlist(),
      getBookings(),
      getActive(),
      getHistory(),
      getFoodOrders(),
      getFoodStats(),
      getMenuFull(),
      getMaintenance(),
      getAuditLogs(50),
      getTopCustomers("all"),
      getTableUtilization(),
    ]);
    if (!shouldCommit()) return;
    setData({
      waitlist: results[0].status === "fulfilled" ? asArray(results[0].value.data) : [],
      bookings: results[1].status === "fulfilled" ? asArray(results[1].value.data) : [],
      activeSessions: results[2].status === "fulfilled" ? asArray(results[2].value.data) : [],
      history: results[3].status === "fulfilled" ? asArray(results[3].value.data) : [],
      foodOrders: results[4].status === "fulfilled" ? asArray(results[4].value.data) : [],
      foodStats: results[5].status === "fulfilled" ? asArray(results[5].value.data) : [],
      menu: results[6].status === "fulfilled" ? asArray(results[6].value.data) : [],
      maintenance: results[7].status === "fulfilled" ? asMaintenanceRows(results[7].value.data) : [],
      auditLogs: results[8].status === "fulfilled" ? asArray(results[8].value.data) : [],
      topCustomers: results[9].status === "fulfilled" ? asArray(results[9].value.data) : [],
      utilization: results[10].status === "fulfilled" ? asArray(results[10].value.data) : [],
    });
  }, []);

  useEffect(() => {
    let alive = true;
    loadData(() => alive);
    return () => {
      alive = false;
    };
  }, [view, loadData]);

  const runAction = useCallback(async (action, {
    confirmText = "",
    actionKey = "action",
    successMessage = "",
  } = {}) => {
    if (confirmText && !confirm(confirmText)) return false;
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
  }, [loadData, showToast]);

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

  const props = useMemo(() => ({ ...data, actions, busy, activeAction }), [data, actions, busy, activeAction]);

  if (view === "waitlist") return <WaitlistView {...props} />;
  if (view === "reservations") return <ReservationsView {...props} />;
  if (view === "billing") return <BillingView {...props} />;
  if (view === "inventory") return <InventoryView {...props} />;
  if (view === "notifications") return <NotificationsView {...props} />;
  if (view === "memberships") return <MembershipPlansView {...props} />;
  if (view === "staff") return <StaffView {...props} />;
  return <WaitlistView {...props} />;
}
