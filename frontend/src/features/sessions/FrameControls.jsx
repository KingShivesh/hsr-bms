import { useState } from "react";
import { startFrame, closeFrame } from "../../api/index.js";
import { useToast } from "../../components/toastContext.js";

export default function FrameControls({ tableId, session, onRefresh }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [loser, setLoser] = useState("");
  if (session?.tariff_mode !== "frame" && session?.billing_mode !== "lp") return null;
  const frames = session.frames || [];
  const open = frames.find(frame => frame.status === "open");
  const lp = session.billing_mode === "lp";
  async function mutate() {
    setBusy(true);
    try {
      if (open) await closeFrame(tableId, loser.trim(), open.id);
      else await startFrame(tableId);
      setLoser("");
      await onRefresh?.();
      showToast(open ? "Frame completed" : "Frame started", "success");
    } catch (error) {
      showToast(error.response?.data?.detail || "Could not update frame", "error");
    } finally { setBusy(false); }
  }
  return (
    <section className="session-list-panel" aria-label="Session frames">
      <div className="session-list-head"><h3>{open ? `Frame ${open.frame_no} in progress` : `${frames.filter(row => row.status === "closed").length} completed frames`}</h3></div>
      {open && lp && <label className="lf-field"><span>Loser name</span><input value={loser} onChange={event => setLoser(event.target.value)} list={`frame-players-${tableId}`} /><datalist id={`frame-players-${tableId}`}>{(session.players || []).map(name => <option key={name} value={name} />)}</datalist></label>}
      <button type="button" className="lf-secondary-button" onClick={mutate} disabled={busy || session.paused || (open && lp && !loser.trim())}>{busy ? "Saving..." : open ? "Complete Frame" : "Start Frame"}</button>
      {frames.some(row => row.status === "closed") && <div className="session-order-list">{frames.filter(row => row.status === "closed").map(frame => <div key={frame.id}><span>Frame {frame.frame_no}</span><b>{frame.loser_name ? `${frame.loser_name} lost` : "Completed"}</b></div>)}</div>}
    </section>
  );
}
