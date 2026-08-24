import { useCallback, useEffect, useMemo, useState } from "react";
import { getLiveFloor, startSession } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useToast } from "../../components/toastContext.js";
import SessionWorkspace from "../sessions/SessionWorkspace.jsx";
import TableGrid from "./TableGrid.jsx";

function todayLabel() {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

function metricValue(value, prefix = "") {
  return `${prefix}${Number(value || 0).toLocaleString("en-IN")}`;
}

function LiveFloorSkeleton() {
  return (
    <div className="lf-skeleton" role="status" aria-label="Loading live floor">
      <div />
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}

function NewSessionPanel({ open, tables, initialTableId, onClose, onCreated }) {
  const { showToast } = useToast();
  const availableTables = tables.filter((table) => table.status_key === "available");
  const [customer, setCustomer] = useState("");
  const [tableId, setTableId] = useState(initialTableId || availableTables[0]?.id || "");
  const [mode, setMode] = useState("single");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setTableId(initialTableId || availableTables[0]?.id || "");
  }, [open, initialTableId, availableTables[0]?.id]);

  if (!open) return null;

  const selectedTable = availableTables.find((table) => table.id === tableId);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!tableId) {
      showToast("Select an available table.", "error");
      return;
    }
    setSaving(true);
    try {
      const name = customer.trim() || "Walk-in";
      await startSession(tableId, name, selectedTable?.rate || 0, mode !== "single", "", mode, name ? [name] : []);
      showToast(`${String(tableId).toUpperCase()} session started`, "success");
      setCustomer("");
      setMode("single");
      await onCreated?.(tableId);
      onClose?.();
    } catch (err) {
      showToast(err.userMessage || "Could not start session.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lf-modal-backdrop" role="presentation">
      <form className="lf-new-session" onSubmit={handleSubmit}>
        <div className="order-selector-head">
          <div>
            <span className="lf-eyebrow">New session</span>
            <h3>Start table quickly</h3>
          </div>
          <button type="button" className="lf-icon-button" onClick={onClose} aria-label="Close new session">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <label className="lf-field">
          <span>Customer</span>
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Walk-in or customer name" />
        </label>
        <label className="lf-field">
          <span>Available table</span>
          <select value={tableId} onChange={(event) => setTableId(event.target.value)}>
            {availableTables.map((table) => (
              <option key={table.id} value={table.id}>
                {String(table.id).toUpperCase()} · {table.type} · ₹{table.rate}/hr
              </option>
            ))}
          </select>
        </label>
        <div className="lf-mode-grid" role="group" aria-label="Billing mode">
          {[
            ["single", "Single", "One payer"],
            ["sharing", "Sharing", "Split payment"],
            ["lp", "LP", "Loser pays"],
          ].map(([value, label, detail]) => (
            <button
              type="button"
              key={value}
              className={mode === value ? "is-selected" : ""}
              onClick={() => setMode(value)}
            >
              <strong>{label}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
        <button type="submit" className="lf-primary-button" disabled={saving || !availableTables.length}>
          {saving ? "Starting..." : "Start session"}
        </button>
      </form>
    </div>
  );
}

export default function LiveFloor({ username = "", role = "admin", onNavigate, newSessionRequest = 0 }) {
  const [floor, setFloor] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionTableId, setNewSessionTableId] = useState("");

  const loadFloor = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const res = await getLiveFloor();
      const nextFloor = res.data?.floor || {
        tables: res.data?.tables || [],
        sessions: res.data?.active_sessions || [],
        summary: {
          total_tables: res.data?.tables?.length || 0,
          active_tables: res.data?.active_tables || 0,
          idle_tables: res.data?.idle_tables || 0,
          live_value: 0,
        },
        attention: [],
      };
      setFloor(nextFloor);
      setSelectedTableId((current) => {
        if (current && nextFloor.tables?.some((table) => table.id === current)) return current;
        return nextFloor.tables?.[0]?.id || "";
      });
      setTick(0);
    } catch (err) {
      setError(err.userMessage || "Unable to load table status.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFloor({ showLoading: true });
    const refresh = setInterval(() => loadFloor(), 15000);
    const onDataChanged = () => loadFloor();
    window.addEventListener("hsr:data-changed", onDataChanged);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("hsr:data-changed", onDataChanged);
    };
  }, [loadFloor]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (newSessionRequest > 0) openNewSession();
  }, [newSessionRequest]);

  const tables = floor?.tables || [];
  const summary = floor?.summary || {};
  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || tables[0],
    [tables, selectedTableId],
  );
  const upcomingBookings = tables.filter((table) => table.booking).length;
  const reservedTables = tables.filter((table) => table.status_key === "reserved").length;
  const pausedTables = tables.filter((table) => table.status_key === "paused").length;
  const attentionCount = floor?.attention?.length || 0;

  function openNewSession(tableId = "") {
    setNewSessionTableId(tableId);
    setNewSessionOpen(true);
  }

  return (
    <section className="live-floor-page">
      <div className="lf-hero">
        <div>
          <span className="lf-date">{todayLabel()} · {role === "staff" ? "Staff console" : "Admin console"}</span>
          <h1>Live Floor Command Center</h1>
          <p>Start tables, monitor running value, attach orders and checkout from the same operating view.</p>
          <div className="lf-state-row" aria-label="Live floor summary">
            <span><i className="ti ti-player-play" aria-hidden="true" /> {summary.active_tables || 0} active</span>
            <span><i className="ti ti-circle" aria-hidden="true" /> {summary.idle_tables || 0} available</span>
            <span><i className="ti ti-calendar-event" aria-hidden="true" /> {reservedTables} reserved</span>
            <span><i className="ti ti-alert-circle" aria-hidden="true" /> {attentionCount} attention</span>
          </div>
        </div>
        <div className="lf-hero-actions">
          <button type="button" className="lf-secondary-button" onClick={() => onNavigate?.("reservations")}>
            <i className="ti ti-calendar-plus" aria-hidden="true" />
            Booking
          </button>
          <button type="button" className="lf-secondary-button" onClick={() => onNavigate?.("members")}>
            <i className="ti ti-user-plus" aria-hidden="true" />
            Customer
          </button>
          <button type="button" className="lf-primary-button" onClick={() => openNewSession()}>
            <i className="ti ti-plus" aria-hidden="true" />
            New session
          </button>
        </div>
      </div>

      {loading && <LiveFloorSkeleton />}
      {error && <RetryNotice message="Unable to load table status" detail={error} onRetry={() => loadFloor({ showLoading: true })} />}

      {!loading && !error && (
        <>
          <div className="lf-metrics">
            <div><span>Running now</span><strong>{summary.active_tables || 0}</strong><small>{pausedTables ? `${pausedTables} paused` : "No paused sessions"}</small></div>
            <div><span>Live floor value</span><strong>{metricValue(summary.live_value, "₹")}</strong><small>Estimated from open sessions</small></div>
            <div><span>Open tables</span><strong>{summary.idle_tables || 0}</strong><small>Ready to seat guests</small></div>
            <div><span>Bookings today</span><strong>{upcomingBookings}</strong><small>{reservedTables} currently reserved</small></div>
          </div>

          {!!floor?.attention?.length && (
            <div className="lf-attention-strip">
              {floor.attention.slice(0, 3).map((item) => (
                <button type="button" key={`${item.type}-${item.table_id}`} onClick={() => setSelectedTableId(item.table_id)}>
                  <i className={`ti ${item.tone === "danger" ? "ti-alert-triangle" : "ti-alert-circle"}`} aria-hidden="true" />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="lf-workbench">
            <div className="lf-floor-panel">
              <div className="lf-section-head">
                <div>
                  <span className="lf-eyebrow">Command board</span>
                  <h2>{summary.active_tables ? `${summary.active_tables} running · ${summary.idle_tables} ready` : `${summary.idle_tables || tables.length} tables ready`}</h2>
                </div>
                <button type="button" className="lf-text-link" onClick={() => onNavigate?.("tables")}>Advanced controls</button>
              </div>
              <TableGrid
                tables={tables}
                selectedTableId={selectedTable?.id}
                tick={tick}
                onSelectTable={(table) => setSelectedTableId(table.id)}
                onStartSession={openNewSession}
              />
            </div>

            <SessionWorkspace
              table={selectedTable}
              tables={tables}
              tick={tick}
              onClose={() => setSelectedTableId("")}
              onRefresh={() => loadFloor()}
              onStartSession={openNewSession}
            />
          </div>
        </>
      )}

      <NewSessionPanel
        open={newSessionOpen}
        tables={tables}
        initialTableId={newSessionTableId}
        onClose={() => setNewSessionOpen(false)}
        onCreated={async (tableId) => {
          await loadFloor();
          setSelectedTableId(tableId);
        }}
      />
    </section>
  );
}
