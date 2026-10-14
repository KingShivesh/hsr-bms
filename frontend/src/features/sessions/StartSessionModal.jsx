import { useRef, useState } from "react";
import { startGuestSession } from "../../api/index.js";
import { Button, Modal } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import "./start-session.css";

// The global toolbar needs a table choice; the table card starts directly.
export default function StartSessionModal({ tables, onCreated, onClose, onStart }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState("");
  const pending = useRef(false);
  async function start(table) {
    if (pending.current) return;
    pending.current = true; setBusy(table.id);
    if (onStart) { onClose?.(); await onStart(table.id); return; }
    try {
      await startGuestSession(table.id);
      showToast(`${table.id.toUpperCase()} session started`, "success");
      await onCreated?.(table.id);
      onClose?.();
    } catch (error) { showToast(error.userMessage || "Could not start session.", "error"); }
    finally { pending.current = false; setBusy(""); }
  }
  const available = tables.filter(table => table.status_key === "available");
  return <Modal open portal title="Choose a table" onClose={busy ? undefined : onClose} className="lf-start-modal">
    <div className="session-identity-panel">
      {available.map(table => <Button key={table.id} variant="secondary" loading={busy === table.id} disabled={!!busy} onClick={() => start(table)}>{table.id.toUpperCase()} · {table.type} · ₹{table.rate}/hr</Button>)}
      {!available.length && <p>No available tables. Check bookings or finish a running session.</p>}
    </div>
  </Modal>;
}
