import { Icon as HsrIcon, Button as HsrButton } from "../../components/ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getLiveFloor, getRates, saveRates, pauseSession, startGuestSession } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { Modal, Drawer } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import SessionWorkspace from "../sessions/SessionWorkspace.jsx";
import TableGrid from "./TableGrid.jsx";
import StartSessionModal from "../sessions/StartSessionModal.jsx";
import ProductSelector from "../orders/ProductSelector.jsx";
import SessionOrders from "../orders/SessionOrders.jsx";
import CheckoutPanel from "../checkout/CheckoutPanel.jsx";
import { useCachedState, hasCachedState } from "../../hooks/useCachedState.js";
import { changeFood, pauseTable } from "./optimistic.js";

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

export default function LiveFloor({ role = "admin", onNavigate, newSessionRequest = 0 }) {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedTable = searchParams.get("table") || "";
  const requestedAction = searchParams.get("action") || "";
  const [floor, setFloor] = useCachedState("floor", null);
  const [optimistic, setOptimistic] = useState({});
  const [selectedTableId, setSelectedTableId] = useState(requestedAction ? "" : requestedTable);
  const [loading, setLoading] = useState(() => !hasCachedState("floor"));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [newSessionOpen, setNewSessionOpen] = useState(requestedAction === "start");
  const [newSessionTableId, setNewSessionTableId] = useState(requestedTable);
  const [checkoutTableId, setCheckoutTableId] = useState(requestedAction === "checkout" ? requestedTable : "");
  const [foodTableId, setFoodTableId] = useState("");
  const [ordersTableId, setOrdersTableId] = useState("");
  const [busyTables, setBusyTables] = useState({});
  const pendingTablesRef = useRef(new Set());
  const floorRefreshTimerRef = useRef(null);
  const loadVersion = useRef(0);
  const tickRef = useRef(0);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  const openNewSession = useCallback((tableId = "") => {
    setNewSessionTableId(tableId);
    setNewSessionOpen(true);
  }, []);

  const loadFloor = useCallback(async ({ showLoading = false } = {}) => {
    const version = ++loadVersion.current;
    if (showLoading && !hasCachedState("floor")) setLoading(true);
    setError("");
    try {
      const res = await getLiveFloor();
      if (version !== loadVersion.current) return;
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
      if (version !== loadVersion.current) return;
      setError(err.userMessage || "Unable to load table status.");
    } finally {
      if (showLoading && version === loadVersion.current) setLoading(false);
    }
  }, [setFloor]);

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
        event.type === "session.orders.updated" ||
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
    const onDataChanged = event => { if (!event.detail?.path || /sessions|bookings|settings\/(rates|tariffs)|waitlist/.test(event.detail.path)) scheduleFloorRefresh(); };
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

  const tables = useMemo(() => (floor?.tables || []).map(table => Object.values(optimistic).reduce((current, change) => change.tableId === table.id && (!change.sessionKey || change.sessionKey === current.session?.session_key) ? change.apply(current) : current, table)), [floor, optimistic]);
  const beginChange = useCallback((key, tableId, sessionKey, apply) => {
    loadVersion.current += 1;
    setOptimistic(current => ({ ...current, [key]: { tableId, sessionKey, apply } }));
    return () => setOptimistic(current => { const next = { ...current }; delete next[key]; return next; });
  }, []);
  const beginFoodChange = useCallback((tableId, sessionKey, key, update) => beginChange(key, tableId, sessionKey, table => changeFood(table, update)), [beginChange]);
  const summary = floor?.summary || {};
  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [tables, selectedTableId],
  );
  const checkoutTable = tables.find((table) => table.id === checkoutTableId);
  const foodTable = tables.find((table) => table.id === foodTableId);
  const ordersTable = tables.find((table) => table.id === ordersTableId);

  const togglePause = useCallback(async (table) => {
    const tick = tickRef.current;
    if (pendingTablesRef.current.has(table.id)) return;
    pendingTablesRef.current.add(table.id);
    setBusyTables((current) => ({ ...current, [table.id]: true }));
    const elapsed = table.session?.paused ? table.elapsed_seconds || 0 : (table.session?.elapsed_seconds || 0) + tick;
    const undo = beginChange(`pause:${table.id}`, table.id, table.session?.session_key, row => pauseTable(row, !table.session?.paused, elapsed, tick));
    try {
      await pauseSession(table.id);
      showToast(table.session?.paused ? "Session resumed" : "Session paused", "success");
      await loadFloor();
    } catch (err) {
      showToast(err.userMessage || "Could not update session.", "error");
    } finally {
      undo();
      pendingTablesRef.current.delete(table.id);
      setBusyTables((current) => ({ ...current, [table.id]: false }));
    }
  }, [beginChange, loadFloor, showToast]);
  const quickStart = useCallback(async (tableId) => {
    const tick = tickRef.current;
    if (pendingTablesRef.current.has(tableId)) return;
    pendingTablesRef.current.add(tableId);
    setBusyTables(current => ({ ...current, [tableId]: true }));
    const undo = beginChange(`start:${tableId}`, tableId, null, row => row.session ? row : ({ ...row, status_key: "running", status_label: "Starting…", pending_label: "Starting session…", session: { paused: false, elapsed_seconds: -tick, food_items: [], customer_name: "Guest", pending: true } }));
    try {
      await startGuestSession(tableId);
      showToast(`${tableId.toUpperCase()} session started`, "success");
      await loadFloor();
    } catch (err) { showToast(err.userMessage || "Could not start session.", "error"); }
    finally {
      undo();
      pendingTablesRef.current.delete(tableId);
      setBusyTables(current => ({ ...current, [tableId]: false }));
    }
  }, [beginChange, loadFloor, showToast]);
  const selectTable = useCallback(table => { setCheckoutTableId(""); setSelectedTableId(table.id); }, []);
  const checkout = useCallback(table => { setSelectedTableId(""); setCheckoutTableId(table.id); }, []);
  const food = useCallback(table => setFoodTableId(table.id), []);
  const orders = useCallback(table => setOrdersTableId(table.id), []);
  const booking = useCallback(table => openNewSession(table.id), [openNewSession]);
  const invalidRate = useCallback(message => showToast(message, "error"), [showToast]);
  const closing = useCallback((tableId, pending) => {
    setBusyTables(current => ({ ...current, [tableId]: pending }));
    setOptimistic(current => {
      const next = { ...current };
      if (pending) next[`close:${tableId}`] = { tableId, apply: table => ({ ...table, pending_label: "Closing…" }) };
      else delete next[`close:${tableId}`];
      return next;
    });
  }, []);
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
            <span><HsrIcon className="ti ti-player-play" aria-hidden="true" /> {summary.active_tables || 0} active</span>
            <span><HsrIcon className="ti ti-circle" aria-hidden="true" /> {summary.idle_tables || 0} available</span>
            <span><HsrIcon className="ti ti-calendar-event" aria-hidden="true" /> {reservedTables} reserved</span>
            <span><HsrIcon className="ti ti-alert-circle" aria-hidden="true" /> {attentionCount} attention</span>
          </div>
        </div>
        <div className="lf-hero-actions">
          <HsrButton native type="button" className="lf-secondary-button" onClick={() => onNavigate?.("reservations")}>
            <HsrIcon className="ti ti-calendar-plus" aria-hidden="true" />
            New Booking
          </HsrButton>
          <HsrButton native type="button" className="lf-secondary-button" onClick={() => onNavigate?.("members")}>
            <HsrIcon className="ti ti-user-plus" aria-hidden="true" />
            Add Customer
          </HsrButton>
          <HsrButton native type="button" className="lf-primary-button" onClick={() => openNewSession()}>
            <HsrIcon className="ti ti-plus" aria-hidden="true" />
            Start Table
          </HsrButton>
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
                <HsrButton native type="button" key={`${item.type}-${item.table_id}`} onClick={() => setSelectedTableId(item.table_id)}>
                  <HsrIcon className={`ti ${item.tone === "danger" ? "ti-alert-triangle" : "ti-alert-circle"}`} aria-hidden="true" />
                  <span>{item.title}</span>
                </HsrButton>
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
                <HsrButton native type="button" className="lf-text-link" onClick={() => onNavigate?.("tables")}>Advanced controls</HsrButton>
              </div>
              <TableGrid
                tables={tables}
                selectedTableId={selectedTable?.id}
                tick={tick}
                onSelectTable={selectTable}
                onStartSession={quickStart}
                onCheckout={checkout}
                onPause={togglePause}
                onFood={food}
                onOrders={orders}
                busyTables={busyTables}
                onReviewBooking={booking}
                onSaveRate={saveInlineRate}
                onInvalidRate={invalidRate}
                onReload={() => loadFloor({ showLoading: true })}
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

      {newSessionOpen && <StartSessionModal
        tables={tables}
        onStart={quickStart}
        initialTableId={newSessionTableId}
        onClose={() => setNewSessionOpen(false)}
        onCreated={async () => {
          await loadFloor();
          setSelectedTableId("");
        }}
      />}
      <Modal open={!!foodTable?.session} portal title={`Session food · ${String(foodTableId).toUpperCase()}`} onClose={() => setFoodTableId("")} className="lf-food-modal" size="lg">
        <ProductSelector tableId={foodTableId} sessionKey={foodTable?.session?.session_key} players={foodTable?.session?.players || []} onOptimistic={beginFoodChange} onClose={() => setFoodTableId("")} onAdded={data => {
          if (data?.item) setFloor(current => ({ ...current, tables: current.tables.map(row => row.id !== foodTableId || row.session?.session_key !== foodTable?.session?.session_key ? row : ({ ...row, session: { ...row.session, food_items: [...(row.session.food_items || []).filter(item => item.id !== data.item.id), data.item], food_total: data.food_total } })) }));
          setFoodTableId(""); scheduleFloorRefresh();
        }} />
      </Modal>
      <CheckoutPanel table={checkoutTable} open={!!checkoutTable} onClose={() => setCheckoutTableId("")} onComplete={loadFloor} onPendingChange={closing} />
      <Drawer portal open={!!ordersTable?.session} title={`Canteen orders · ${String(ordersTableId).toUpperCase()}`} onClose={() => setOrdersTableId("")}>
        {ordersTable?.session && <SessionOrders table={ordersTable} onOptimistic={beginFoodChange} onChanged={loadFloor} onAdd={() => { setOrdersTableId(""); setFoodTableId(ordersTableId); }} />}
      </Drawer>
    </section>
  );
}
