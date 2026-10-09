import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getLiveFloor, getRates, saveRates, startSession, pauseSession } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { Modal, Drawer } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import SessionWorkspace from "../sessions/SessionWorkspace.jsx";
import TableGrid from "./TableGrid.jsx";
import TariffSelector from "../sessions/TariffSelector.jsx";
import ProductSelector from "../orders/ProductSelector.jsx";
import CheckoutPanel from "../checkout/CheckoutPanel.jsx";

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

function rateGroupForTable(tableId) {
  const normalized = String(tableId || "").toLowerCase();
  if (normalized === "t1" || normalized === "t2") return "wr";
  if (normalized === "t3" || normalized === "t4") return "sr";
  if (normalized === "t5") return "pr";
  return "";
}

function normalizeRate(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function NewSessionModal({ tables, initialTableId, onClose, onCreated }) {
  const { showToast } = useToast();
  const availableTables = useMemo(() => tables.filter((table) => table.status_key === "available" || (table.id === initialTableId && table.status_key === "reserved")), [tables, initialTableId]);
  const defaultTableId = initialTableId || availableTables[0]?.id || "";
  const [customer, setCustomer] = useState(tables.find((table) => table.id === initialTableId)?.booking?.customer_name || "");
  const [tableId, setTableId] = useState(defaultTableId);
  const [mode, setMode] = useState("single");
  const [tariff, setTariff] = useState({ tariff_mode: "hourly", package_id: "" });
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    if (!tableId && defaultTableId) setTableId(defaultTableId);
  }, [defaultTableId, tableId]);

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = formRef.current?.closest('[role="dialog"]');
    formRef.current?.querySelector("input")?.focus();
    function trapFocus(event) {
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    dialog?.addEventListener("keydown", trapFocus);
    return () => { dialog?.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, []);

  const selectedTable = availableTables.find((table) => table.id === tableId);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedTable) {
      showToast("Select an available table.", "error");
      return;
    }
    setSaving(true);
    try {
      const name = customer.trim() || "Walk-in";
      await startSession(tableId, name, selectedTable?.rate || 0, mode !== "single", "", mode, name ? [name] : [], tariff);
      showToast(`${String(tableId).toUpperCase()} session started`, "success");
      setCustomer("");
      setMode("single");
      setTariff({ tariff_mode: "hourly", package_id: "" });
      await onCreated?.(tableId);
      onClose?.();
    } catch (err) {
      showToast(err.userMessage || "Could not start session.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open portal title="Start Session" onClose={saving ? undefined : onClose} className="lf-start-modal">
      <form ref={formRef} className="lf-new-session" onSubmit={handleSubmit}>
        <fieldset disabled={saving}>
        <label className="lf-field">
          <span>Customer</span>
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Walk-in or customer name" />
        </label>
        <label className="lf-field">
          <span>Table</span>
          <select value={tableId} onChange={(event) => { setTableId(event.target.value); setTariff({ tariff_mode: "hourly", package_id: "" }); }}>
            {availableTables.map((table) => (
              <option key={table.id} value={table.id}>
                {String(table.id).toUpperCase()} · {table.type} · ₹{table.rate}/hr
              </option>
            ))}
          </select>
        </label>
        <TariffSelector tableId={tableId} value={tariff} onChange={setTariff} catalog={selectedTable?.tariffs} />
        <div className="lf-mode-grid" role="group" aria-label="Who pays">
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
        <div className="lf-modal-actions">
          <button type="button" className="lf-secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="lf-primary-button" disabled={!selectedTable}>
            {saving ? "Starting..." : "Start Session"}
          </button>
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export default function LiveFloor({ role = "admin", onNavigate, newSessionRequest = 0 }) {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedTable = searchParams.get("table") || "";
  const requestedAction = searchParams.get("action") || "";
  const [floor, setFloor] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(requestedAction ? "" : requestedTable);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [newSessionOpen, setNewSessionOpen] = useState(requestedAction === "start");
  const [newSessionTableId, setNewSessionTableId] = useState(requestedTable);
  const [checkoutTableId, setCheckoutTableId] = useState(requestedAction === "checkout" ? requestedTable : "");
  const [foodTableId, setFoodTableId] = useState("");
  const [busyTables, setBusyTables] = useState({});
  const pendingTablesRef = useRef(new Set());
  const floorRefreshTimerRef = useRef(null);

  const openNewSession = useCallback((tableId = "") => {
    setNewSessionTableId(tableId);
    setNewSessionOpen(true);
  }, []);

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
        return "";
      });
      setTick(0);
    } catch (err) {
      setError(err.userMessage || "Unable to load table status.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const scheduleFloorRefresh = useCallback(() => {
    window.clearTimeout(floorRefreshTimerRef.current);
    floorRefreshTimerRef.current = window.setTimeout(loadFloor, 150);
  }, [loadFloor]);

  const realtimeState = useRealtimeSubscription({
    topics: ["floor"],
    onEvent: (event) => {
      if (
        event.type === "table.updated" ||
        event.type === "table.maintenance_changed" ||
        event.type === "system.sync_required"
      ) {
        scheduleFloorRefresh();
      }
    },
    onFallbackPoll: loadFloor,
    fallbackPollMs: 15000,
  });

  useEffect(() => {
    loadFloor({ showLoading: true });
    const onDataChanged = () => scheduleFloorRefresh();
    window.addEventListener("hsr:data-changed", onDataChanged);
    return () => {
      window.removeEventListener("hsr:data-changed", onDataChanged);
    };
  }, [loadFloor, scheduleFloorRefresh]);

  useEffect(() => {
    if (realtimeState !== "connected") return undefined;
    const safetyPoll = window.setInterval(loadFloor, 60000);
    return () => window.clearInterval(safetyPoll);
  }, [loadFloor, realtimeState]);

  useEffect(() => () => window.clearTimeout(floorRefreshTimerRef.current), []);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (newSessionRequest > 0) openNewSession();
  }, [newSessionRequest, openNewSession]);

  useEffect(() => {
    function handleNewSessionRequest() {
      openNewSession();
    }
    window.addEventListener("live-floor:new-session", handleNewSessionRequest);
    return () => window.removeEventListener("live-floor:new-session", handleNewSessionRequest);
  }, [openNewSession]);

  const saveInlineRate = useCallback(async (table, nextRate) => {
    const rateGroup = rateGroupForTable(table?.id);
    if (!rateGroup) {
      showToast("This table rate group is not editable.", "error");
      return { ok: false };
    }

    try {
      const current = await getRates();
      const serverRates = {
        wr: normalizeRate(current.data?.wr, 320),
        pr: normalizeRate(current.data?.pr, 170),
        sr: normalizeRate(current.data?.sr, 270),
      };
      const mergedRates = { ...serverRates, [rateGroup]: nextRate };
      await saveRates(mergedRates.wr, mergedRates.pr, mergedRates.sr);
      showToast(`${String(table.id || "").toUpperCase()} rate saved`, "success");
      await loadFloor();
      return { ok: true };
    } catch (err) {
      showToast(err.userMessage || err.response?.data?.detail || "Rate could not be saved.", "error");
      return { ok: false };
    }
  }, [loadFloor, showToast]);

  const tables = useMemo(() => floor?.tables || [], [floor]);
  const summary = floor?.summary || {};
  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [tables, selectedTableId],
  );
  const checkoutTable = tables.find((table) => table.id === checkoutTableId);
  const foodTable = tables.find((table) => table.id === foodTableId);

  async function togglePause(table) {
    if (pendingTablesRef.current.has(table.id)) return;
    pendingTablesRef.current.add(table.id);
    setBusyTables((current) => ({ ...current, [table.id]: true }));
    try {
      await pauseSession(table.id);
      showToast(table.session?.paused ? "Session resumed" : "Session paused", "success");
      await loadFloor();
    } catch (err) {
      showToast(err.userMessage || "Could not update session.", "error");
    } finally {
      pendingTablesRef.current.delete(table.id);
      setBusyTables((current) => ({ ...current, [table.id]: false }));
    }
  }
  const upcomingBookings = tables.filter((table) => table.booking).length;
  const reservedTables = tables.filter((table) => table.status_key === "reserved").length;
  const pausedTables = tables.filter((table) => table.status_key === "paused").length;
  const attentionCount = floor?.attention?.length || 0;

  return (
    <section className="live-floor-page" data-realtime-state={realtimeState}>
      <div className="lf-hero">
        <div>
          <span className="lf-date">{todayLabel()} · {role === "staff" ? "Staff console" : "Admin console"}</span>
          <h1>Command Center</h1>
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
            New Booking
          </button>
          <button type="button" className="lf-secondary-button" onClick={() => onNavigate?.("members")}>
            <i className="ti ti-user-plus" aria-hidden="true" />
            Add Customer
          </button>
          <button type="button" className="lf-primary-button" onClick={() => openNewSession()}>
            <i className="ti ti-plus" aria-hidden="true" />
            Start Table
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
                onSelectTable={(table) => {
                  setCheckoutTableId("");
                  setSelectedTableId(table.id);
                }}
                onStartSession={openNewSession}
                onCheckout={(table) => {
                  setSelectedTableId("");
                  setCheckoutTableId(table.id);
                }}
                onPause={togglePause}
                onFood={(table) => setFoodTableId(table.id)}
                busyTables={busyTables}
                onReviewBooking={(table) => openNewSession(table.id)}
                onSaveRate={saveInlineRate}
                onInvalidRate={(message) => showToast(message, "error")}
              />
            </div>

          </div>

          <Drawer open={!!selectedTable} portal title={`Session details · ${String(selectedTable?.id || "").toUpperCase()}`} onClose={() => setSelectedTableId("")} className="lf-detail-drawer">
            <SessionWorkspace
              key={selectedTable?.id || "none"}
              table={selectedTable}
              tables={tables}
              tick={tick}
              onRefresh={() => loadFloor()}
            />
          </Drawer>
        </>
      )}

      {newSessionOpen && <NewSessionModal
        tables={tables}
        initialTableId={newSessionTableId}
        onClose={() => setNewSessionOpen(false)}
        onCreated={async () => {
          await loadFloor();
          setSelectedTableId("");
        }}
      />}
      <Modal open={!!foodTable?.session} portal title={`Session food · ${String(foodTableId).toUpperCase()}`} onClose={() => setFoodTableId("")} className="lf-food-modal" size="lg">
        <ProductSelector tableId={foodTableId} players={foodTable?.session?.players || []} onClose={() => setFoodTableId("")} onAdded={async () => { await loadFloor(); setFoodTableId(""); }} />
      </Modal>
      <CheckoutPanel table={checkoutTable} open={!!checkoutTable} onClose={() => setCheckoutTableId("")} onComplete={loadFloor} />
    </section>
  );
}
