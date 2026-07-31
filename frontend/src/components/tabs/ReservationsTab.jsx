import { useState } from "react";

const INITIAL_RESERVATIONS = [
  {
    id: "RSV-401",
    customerName: "Arjun Nair",
    customerPhone: "+91 98451 90234",
    tableName: "T1 - Wiraka",
    date: "Today",
    timeSlot: "07:30 PM - 08:30 PM",
    guestCount: 2,
    status: "Confirmed",
    advancePaid: 200,
    specialRequests: "Keep table near counter.",
  },
  {
    id: "RSV-402",
    customerName: "Maya Rao",
    customerPhone: "+91 99118 45021",
    tableName: "T5 - Pool",
    date: "Today",
    timeSlot: "09:00 PM - 10:00 PM",
    guestCount: 4,
    status: "Pending",
    advancePaid: 0,
    specialRequests: "Birthday group.",
  },
  {
    id: "RSV-403",
    customerName: "Rohit Menon",
    customerPhone: "+91 98861 11109",
    tableName: "T3 - English",
    date: "Tomorrow",
    timeSlot: "06:00 PM - 07:30 PM",
    guestCount: 2,
    status: "Confirmed",
    advancePaid: 300,
    specialRequests: "",
  },
];

export default function ReservationsTab() {
  const [reservations, setReservations] = useState(INITIAL_RESERVATIONS);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    tableName: "T1 - Wiraka",
    timeSlot: "",
    guestCount: 2,
    advancePaid: 0,
  });

  function addReservation(event) {
    event.preventDefault();
    if (!form.customerName.trim() || !form.timeSlot.trim()) return;
    setReservations((items) => [
      {
        id: `RSV-${Date.now().toString().slice(-5)}`,
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || "-",
        tableName: form.tableName,
        date: "Today",
        timeSlot: form.timeSlot.trim(),
        guestCount: Number(form.guestCount) || 1,
        status: "Confirmed",
        advancePaid: Number(form.advancePaid) || 0,
        specialRequests: "",
      },
      ...items,
    ]);
    setForm({
      customerName: "",
      customerPhone: "",
      tableName: "T1 - Wiraka",
      timeSlot: "",
      guestCount: 2,
      advancePaid: 0,
    });
  }

  function setStatus(id, status) {
    setReservations((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  const confirmed = reservations.filter((r) => r.status === "Confirmed").length;
  const pending = reservations.filter((r) => r.status === "Pending").length;
  const advance = reservations.reduce((sum, r) => sum + r.advancePaid, 0);

  return (
    <div className="clubflow-page">
      <section className="clubflow-hero">
        <div>
          <span className="clubflow-eyebrow">Reservations</span>
          <h2>Bookings & Slots</h2>
          <p>Manage future table slots, walk-in promises, advances and customer notes.</p>
        </div>
        <div className="clubflow-hero-stats">
          <div>
            <strong>{confirmed}</strong>
            <span>Confirmed</span>
          </div>
          <div>
            <strong>₹{advance}</strong>
            <span>Advance</span>
          </div>
        </div>
      </section>

      <div className="clubflow-grid two">
        <form className="clubflow-panel" onSubmit={addReservation}>
          <div className="clubflow-panel-head">
            <div>
              <h3>New Reservation</h3>
              <p>Book a table in under a minute.</p>
            </div>
            <i className="ti ti-calendar-plus" aria-hidden="true" />
          </div>
          <div className="clubflow-form-grid">
            <label>
              Customer
              <input
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                placeholder="Customer name"
              />
            </label>
            <label>
              Phone
              <input
                value={form.customerPhone}
                onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                placeholder="+91 ..."
              />
            </label>
            <label>
              Table
              <select
                value={form.tableName}
                onChange={(e) => setForm((f) => ({ ...f, tableName: e.target.value }))}
              >
                <option>T1 - Wiraka</option>
                <option>T2 - Wiraka</option>
                <option>T3 - English</option>
                <option>T4 - English</option>
                <option>T5 - Pool</option>
              </select>
            </label>
            <label>
              Time slot
              <input
                value={form.timeSlot}
                onChange={(e) => setForm((f) => ({ ...f, timeSlot: e.target.value }))}
                placeholder="08:00 PM - 09:00 PM"
              />
            </label>
            <label>
              Guests
              <input
                type="number"
                min="1"
                value={form.guestCount}
                onChange={(e) => setForm((f) => ({ ...f, guestCount: e.target.value }))}
              />
            </label>
            <label>
              Advance
              <input
                type="number"
                min="0"
                value={form.advancePaid}
                onChange={(e) => setForm((f) => ({ ...f, advancePaid: e.target.value }))}
              />
            </label>
          </div>
          <button className="clubflow-primary" type="submit">
            <i className="ti ti-calendar-plus" aria-hidden="true" />
            Create booking
          </button>
        </form>

        <div className="clubflow-panel">
          <div className="clubflow-panel-head">
            <div>
              <h3>Slot Summary</h3>
              <p>Reception-ready booking overview.</p>
            </div>
            <i className="ti ti-calendar-stats" aria-hidden="true" />
          </div>
          <div className="clubflow-mini-grid">
            <div>
              <span>Total bookings</span>
              <strong>{reservations.length}</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong>{pending}</strong>
            </div>
            <div>
              <span>Next slot</span>
              <strong>{reservations[0]?.timeSlot || "-"}</strong>
            </div>
          </div>
        </div>
      </div>

      <section className="clubflow-panel">
        <div className="clubflow-panel-head">
          <div>
            <h3>Reservation Timeline</h3>
            <p>Upcoming bookings sorted for quick desk action.</p>
          </div>
          <span className="clubflow-chip blue">Today</span>
        </div>
        <div className="clubflow-card-grid">
          {reservations.map((item) => (
            <article className="clubflow-card" key={item.id}>
              <div className="clubflow-card-top">
                <span className={`clubflow-chip ${item.status === "Confirmed" ? "green" : item.status === "Pending" ? "amber" : "slate"}`}>
                  {item.status}
                </span>
                <strong>{item.timeSlot}</strong>
              </div>
              <h3>{item.customerName}</h3>
              <p>{item.customerPhone} · {item.guestCount} guests</p>
              <div className="clubflow-card-meta">
                <span>{item.tableName}</span>
                <span>Advance ₹{item.advancePaid}</span>
              </div>
              {item.specialRequests && <p className="clubflow-note">{item.specialRequests}</p>}
              <div className="clubflow-actions">
                <button type="button" onClick={() => setStatus(item.id, "Completed")}>Complete</button>
                <button type="button" onClick={() => setStatus(item.id, "Cancelled")}>Cancel</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
