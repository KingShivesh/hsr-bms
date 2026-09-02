import { useMemo, useState } from "react";
import { pauseSession, transferSession } from "../../api/index.js";
import { useToast } from "../../components/toastContext.js";
import { useEscapeKey } from "../../components/ui/index.js";
import CheckoutPanel from "../checkout/CheckoutPanel.jsx";
import ProductSelector from "../orders/ProductSelector.jsx";
import TableStatusBadge from "../live-floor/TableStatusBadge.jsx";

function formatTimer(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatClock(ms) {
  if (!ms) return "-";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function sessionPlayers(session) {
  const players = Array.isArray(session?.players) ? session.players : [];
  return players.filter(Boolean);
}

export default function SessionWorkspace({
  table,
  tables = [],
  tick = 0,
  onClose,
  onRefresh,
  onStartSession,
}) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [showOrders, setShowOrders] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  useEscapeKey(onClose, !!table && !showOrders && !checkoutOpen);
  const session = table?.session;
  const elapsed = session && !session.paused ? (session.elapsed_seconds || 0) + tick : session?.elapsed_seconds || 0;
  const players = useMemo(() => sessionPlayers(session), [session]);
  const availableTargets = tables.filter((row) => row.id !== table?.id && row.status_key === "available");
  const tabs = session ? ["overview", "orders", "customer", "activity"] : ["overview"];

  async function runAction(key, action, success) {
    setBusy(key);
    try {
      await action();
      showToast(success, "success");
      await onRefresh?.();
    } catch (err) {
      showToast(err.userMessage || "Action failed. Please retry.", "error");
    } finally {
      setBusy("");
    }
  }

  if (!table) return null;

  return (
    <aside className="session-workspace" aria-label="Session workspace">
      <div className="session-workspace-head">
        <div>
          <span className="lf-eyebrow">Session workspace</span>
          <h2>{String(table.id || "").toUpperCase()} · {table.type || table.label}</h2>
        </div>
        <button type="button" className="lf-icon-button" onClick={onClose} aria-label="Close session workspace">
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>

      <div className="session-hero">
        <div>
          <TableStatusBadge statusKey={table.status_key} label={table.status_label} />
          <strong>{session?.customer_name || table.booking?.customer_name || "No active customer"}</strong>
          <span>{session ? "Backend-authoritative billing" : "Ready for a new session"}</span>
        </div>
        <div>
          <span>{session ? formatTimer(elapsed) : "00:00:00"}</span>
          <b>₹{Number(session?.running_total || table.running_total || 0).toLocaleString("en-IN")}</b>
        </div>
      </div>

      {!session && (
        <div className="session-empty-panel">
          <i className="ti ti-player-play" aria-hidden="true" />
          <h3>{table.status_key === "maintenance" ? "Table unavailable" : "Start from this table"}</h3>
          <p>{table.status_key === "maintenance" ? table.maintenance?.reason || "Maintenance is active." : "Create a walk-in or customer session without leaving the floor."}</p>
          <button
            type="button"
            className="lf-primary-button"
            onClick={() => onStartSession?.(table.id)}
            disabled={table.status_key !== "available"}
          >
            Start Table
          </button>
        </div>
      )}

      {session && (
        <>
          <div className="session-tabs" role="tablist" aria-label="Session sections">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab}
                className={activeTab === tab ? "is-active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="session-panel-grid">
              <div className="session-money-card">
                <span>Table charges</span>
                <strong>₹{Number(session.play_estimate || 0).toLocaleString("en-IN")}</strong>
              </div>
              <div className="session-money-card">
                <span>Food charges</span>
                <strong>₹{Number(session.food_total || 0).toLocaleString("en-IN")}</strong>
              </div>
              <div className="session-money-card">
                <span>Discount</span>
                <strong>₹0</strong>
              </div>
              <div className="session-money-card is-total">
                <span>Current total</span>
                <strong>₹{Number(session.running_total || 0).toLocaleString("en-IN")}</strong>
              </div>
              <dl className="session-facts">
                <div><dt>Started</dt><dd>{formatClock(session.start_time)}</dd></div>
                <div><dt>Elapsed</dt><dd>{formatTimer(elapsed)}</dd></div>
                <div><dt>Rate</dt><dd>₹{Number(session.rate || table.rate || 0).toLocaleString("en-IN")}/hr</dd></div>
                <div><dt>Mode</dt><dd>{String(session.billing_mode || "single").toUpperCase()}</dd></div>
              </dl>
            </div>
          )}

          {activeTab === "orders" && (
            <div className="session-list-panel">
              <div className="session-list-head">
                <h3>Session orders</h3>
                <button type="button" className="lf-secondary-button" onClick={() => setShowOrders(true)}>
                  <i className="ti ti-plus" aria-hidden="true" />
                  Add Food
                </button>
              </div>
              {(session.food_items || []).length ? (
                <div className="session-order-list">
                  {session.food_items.map((item, index) => (
                    <div key={`${item.item}-${index}`}>
                      <span>{item.item}</span>
                      <b>Qty {item.qty}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="lf-muted-copy">No food attached to this session yet.</p>
              )}
            </div>
          )}

          {activeTab === "customer" && (
            <div className="session-list-panel">
              <h3>Customer</h3>
              <dl className="session-facts">
                <div><dt>Name</dt><dd>{session.customer_name || "Walk-in"}</dd></div>
                <div><dt>Players</dt><dd>{players.length ? players.join(", ") : "Not recorded"}</dd></div>
                <div><dt>Split</dt><dd>{session.split ? session.split_name || "Sharing" : "Single payer"}</dd></div>
              </dl>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="session-list-panel">
              <h3>Activity</h3>
              <div className="session-activity-list">
                <div><i className="ti ti-player-play" aria-hidden="true" /><span>Session started at {formatClock(session.start_time)}</span></div>
                {session.paused && <div><i className="ti ti-player-pause" aria-hidden="true" /><span>Session currently paused</span></div>}
                {(session.food_items || []).map((item, index) => (
                  <div key={`${item.item}-activity-${index}`}><i className="ti ti-tools-kitchen-2" aria-hidden="true" /><span>{item.item} added · Qty {item.qty}</span></div>
                ))}
              </div>
            </div>
          )}

          <div className="session-action-bar">
            <button type="button" className="lf-primary-button" onClick={() => setShowOrders(true)}>
              <i className="ti ti-tools-kitchen-2" aria-hidden="true" />
              Add Food
            </button>
            <button
              type="button"
              className="lf-secondary-button"
              disabled={busy === "pause"}
              onClick={() => runAction("pause", () => pauseSession(table.id), session.paused ? "Session resumed" : "Session paused")}
            >
              {busy === "pause" ? "Working..." : session.paused ? "Resume" : "Pause"}
            </button>
            <label className="session-transfer">
              <span>Transfer</span>
              <select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)}>
                <option value="">Select table</option>
                {availableTargets.map((row) => (
                  <option key={row.id} value={row.id}>{String(row.id).toUpperCase()} · {row.type}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!transferTarget || busy === "transfer"}
                onClick={() => runAction("transfer", () => transferSession(table.id, transferTarget), "Session transferred")}
              >
                {busy === "transfer" ? "Moving..." : "Move Session"}
              </button>
            </label>
            <button type="button" className="lf-danger-button" onClick={() => setCheckoutOpen(true)}>
              <i className="ti ti-receipt" aria-hidden="true" />
              Open Checkout
            </button>
          </div>
        </>
      )}

      {showOrders && (
        <div className="order-drawer-shell">
          <ProductSelector
            tableId={table.id}
            players={players}
            onClose={() => setShowOrders(false)}
            onAdded={async () => {
              await onRefresh?.();
              setShowOrders(false);
            }}
          />
        </div>
      )}

      <CheckoutPanel
        table={table}
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onComplete={onRefresh}
      />
    </aside>
  );
}
