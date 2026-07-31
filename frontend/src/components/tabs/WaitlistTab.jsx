import { useMemo, useState } from "react";

const INITIAL_WAITLIST = [
  {
    id: "WL-101",
    customerName: "Karan Patel",
    phone: "+91 98112 33445",
    partySize: 2,
    preferredTableType: "Wiraka",
    addedAt: "10 mins ago",
    estimatedWaitMins: 15,
    status: "Waiting",
  },
  {
    id: "WL-102",
    customerName: "Neha Kapoor",
    phone: "+91 97223 44556",
    partySize: 4,
    preferredTableType: "English",
    addedAt: "18 mins ago",
    estimatedWaitMins: 25,
    status: "Waiting",
  },
  {
    id: "WL-103",
    customerName: "Sanjay Dutt",
    phone: "+91 99334 55667",
    partySize: 2,
    preferredTableType: "Pool",
    addedAt: "25 mins ago",
    estimatedWaitMins: 35,
    status: "Waiting",
  },
];

export default function WaitlistTab() {
  const [queue, setQueue] = useState(INITIAL_WAITLIST);
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    partySize: 2,
    preferredTableType: "Any table",
  });

  const waiting = useMemo(() => queue.filter((q) => q.status === "Waiting"), [queue]);
  const avgWait = waiting.length
    ? Math.round(waiting.reduce((sum, item) => sum + item.estimatedWaitMins, 0) / waiting.length)
    : 0;

  function addToQueue(event) {
    event.preventDefault();
    const name = form.customerName.trim();
    if (!name) return;
    setQueue((items) => [
      {
        id: `WL-${Date.now().toString().slice(-5)}`,
        customerName: name,
        phone: form.phone.trim() || "-",
        partySize: Number(form.partySize) || 1,
        preferredTableType: form.preferredTableType,
        addedAt: "Just now",
        estimatedWaitMins: Math.max(10, waiting.length * 8 + 10),
        status: "Waiting",
      },
      ...items,
    ]);
    setForm({ customerName: "", phone: "", partySize: 2, preferredTableType: "Any table" });
  }

  function updateStatus(id, status) {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  return (
    <div className="clubflow-page">
      <section className="clubflow-hero">
        <div>
          <span className="clubflow-eyebrow">Smart queue</span>
          <h2>Waitlist Queue</h2>
          <p>Manage walk-ins, party sizes, expected wait and quick seating decisions.</p>
        </div>
        <div className="clubflow-hero-stats">
          <div>
            <strong>{waiting.length}</strong>
            <span>Waiting</span>
          </div>
          <div>
            <strong>{avgWait}m</strong>
            <span>Avg wait</span>
          </div>
        </div>
      </section>

      <div className="clubflow-grid two">
        <form className="clubflow-panel" onSubmit={addToQueue}>
          <div className="clubflow-panel-head">
            <div>
              <h3>Add Walk-In</h3>
              <p>Fast capture for reception.</p>
            </div>
            <i className="ti ti-clock-plus" aria-hidden="true" />
          </div>
          <div className="clubflow-form-grid">
            <label>
              Customer name
              <input
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                placeholder="Customer name"
              />
            </label>
            <label>
              Phone optional
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+91 ..."
              />
            </label>
            <label>
              Party size
              <input
                type="number"
                min="1"
                value={form.partySize}
                onChange={(e) => setForm((f) => ({ ...f, partySize: e.target.value }))}
              />
            </label>
            <label>
              Preferred table
              <select
                value={form.preferredTableType}
                onChange={(e) => setForm((f) => ({ ...f, preferredTableType: e.target.value }))}
              >
                <option>Any table</option>
                <option>Wiraka</option>
                <option>English</option>
                <option>Pool</option>
              </select>
            </label>
          </div>
          <button className="clubflow-primary" type="submit">
            <i className="ti ti-plus" aria-hidden="true" />
            Add to queue
          </button>
        </form>

        <div className="clubflow-panel">
          <div className="clubflow-panel-head">
            <div>
              <h3>Queue Health</h3>
              <p>Use this to avoid front-desk confusion.</p>
            </div>
            <i className="ti ti-activity" aria-hidden="true" />
          </div>
          <div className="clubflow-mini-grid">
            <div>
              <span>Longest wait</span>
              <strong>{Math.max(0, ...waiting.map((q) => q.estimatedWaitMins))}m</strong>
            </div>
            <div>
              <span>Next party</span>
              <strong>{waiting[0]?.customerName || "Clear"}</strong>
            </div>
            <div>
              <span>Capacity cue</span>
              <strong>{waiting.length > 3 ? "Slow" : "Healthy"}</strong>
            </div>
          </div>
        </div>
      </div>

      <section className="clubflow-panel">
        <div className="clubflow-panel-head">
          <div>
            <h3>Live Queue</h3>
            <p>Seat, cancel, or keep a customer waiting.</p>
          </div>
          <span className="clubflow-chip blue">{queue.length} total</span>
        </div>
        <div className="clubflow-list">
          {queue.map((item) => (
            <div className="clubflow-row" key={item.id}>
              <div>
                <strong>{item.customerName}</strong>
                <span>{item.phone} · {item.partySize} guests · {item.preferredTableType}</span>
              </div>
              <div className="clubflow-row-meta">
                <span className={`clubflow-chip ${item.status === "Waiting" ? "amber" : item.status === "Seated" ? "green" : "slate"}`}>
                  {item.status}
                </span>
                <span>{item.addedAt} · {item.estimatedWaitMins}m wait</span>
              </div>
              <div className="clubflow-actions">
                <button type="button" onClick={() => updateStatus(item.id, "Seated")}>Seat</button>
                <button type="button" onClick={() => updateStatus(item.id, "Cancelled")}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
