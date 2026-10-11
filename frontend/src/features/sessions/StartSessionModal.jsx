import { useEffect, useRef, useState } from "react";
import { CalendarDays, User, Users } from "lucide-react";
import { getSessionBookings, searchMembers, startSession } from "../../api/index.js";
import { Modal } from "../../components/ui/index.js";
import { useToast } from "../../components/toastContext.js";
import TariffSelector from "./TariffSelector.jsx";
import "./start-session.css";

export default function StartSessionModal({ tables, initialTableId = "", onCreated, onClose }) {
  const { showToast } = useToast();
  const available = tables.filter(table => ["available", "reserved"].includes(table.status_key));
  const [tableId, setTableId] = useState(available.find(table => table.id === initialTableId)?.id || available[0]?.id || "");
  const [playerType, setPlayerType] = useState("guest");
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(2);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState([]);
  const [member, setMember] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [booking, setBooking] = useState(null);
  const [lookup, setLookup] = useState({ busy: false, error: "" });
  const [bookingError, setBookingError] = useState("");
  const [mode, setMode] = useState("single");
  const [otherPlayers, setOtherPlayers] = useState("");
  const [tariff, setTariff] = useState({ tariff_mode: "hourly", package_id: "" });
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const formRef = useRef(null);
  const selectedTable = available.find(table => table.id === tableId);
  const firstAvailableId = available.find(table => table.id === initialTableId)?.id || available[0]?.id || "";

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = formRef.current?.closest('[role="dialog"]');
    formRef.current?.querySelector("select")?.focus();
    function trapFocus(event) {
      if (event.key !== "Tab") return;
      const items = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(item => item.tabIndex !== -1);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
    dialog?.addEventListener("keydown", trapFocus);
    return () => { dialog?.removeEventListener("keydown", trapFocus); if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    if (!tableId && firstAvailableId) setTableId(firstAvailableId);
  }, [tableId, firstAvailableId]);

  useEffect(() => {
    let active = true;
    setBookings([]); setBooking(null); setBookingError("");
    if (tableId) getSessionBookings(tableId).then(({ data }) => {
      if (active) setBookings(data);
    }).catch(error => { if (active) setBookingError(error.userMessage || "Could not load bookings."); });
    return () => { active = false; };
  }, [tableId]);

  useEffect(() => {
    let active = true;
    if (playerType !== "member" || query.trim().length < 3) {
      setMembers([]); setLookup({ busy: false, error: "" });
      return;
    }
    setLookup({ busy: true, error: "" });
    setMembers([]);
    const timer = setTimeout(() => {
      searchMembers(query.trim()).then(({ data }) => {
        if (active) { setMembers(data); setLookup({ busy: false, error: "" }); }
      }).catch(error => {
        if (active) { setMembers([]); setLookup({ busy: false, error: error.userMessage || "Member search failed." }); }
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, playerType]);

  async function submit(event) {
    event.preventDefault();
    if (pending.current || !selectedTable || (playerType === "member" && !member) || (playerType === "booking" && !booking)) return;
    pending.current = true; setSaving(true);
    try {
      const customer = playerType === "guest" ? name.trim() || null : null;
      const players = mode === "single" ? [] : otherPlayers.split(",").map(value => value.trim()).filter(Boolean);
      if (mode !== "single" && players.length < 2) {
        showToast("Enter at least two payer names for Sharing or LP.", "error");
        return;
      }
      await startSession(tableId, customer, selectedTable.rate, mode !== "single", "", mode, players, {
        ...tariff, player_type: playerType, player_count: playerCount || 2,
        member_id: playerType === "member" ? member.id : null,
        booking_id: playerType === "booking" ? booking.id : null,
      });
      showToast(`${tableId.toUpperCase()} session started`, "success");
      await onCreated?.(tableId);
      onClose?.();
    } catch (error) { showToast(error.userMessage || "Could not start session.", "error"); }
    finally { pending.current = false; setSaving(false); }
  }

  const tabs = [["guest", "Guest", <User size={16} aria-hidden="true" />], ["member", "Member", <Users size={16} aria-hidden="true" />], ...(bookings.length ? [["booking", "From Booking", <CalendarDays size={16} aria-hidden="true" />]] : [])];
  return <Modal open portal title="Start Session" onClose={saving ? undefined : onClose} className="lf-start-modal">
    <form ref={formRef} className="lf-new-session" onSubmit={submit}>
      <fieldset disabled={saving}>
        <label className="lf-field"><span>Table</span>
          <select value={tableId} onChange={event => { setTableId(event.target.value); setPlayerType("guest"); setTariff({ tariff_mode: "hourly", package_id: "" }); }}>
            {available.map(table => <option key={table.id} value={table.id}>{table.id.toUpperCase()} · {table.type} · ₹{table.rate}/hr</option>)}
          </select>
        </label>
        <div className="session-identity-tabs" role="tablist" aria-label="Session customer">
          {tabs.map(([value, label, icon]) => <button key={value} type="button" role="tab" id={`session-tab-${value}`} aria-selected={playerType === value} aria-controls="session-identity-panel" onClick={() => setPlayerType(value)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); const index = tabs.findIndex(tab => tab[0] === value);
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            setPlayerType(tabs[next][0]); document.getElementById(`session-tab-${tabs[next][0]}`)?.focus();
          }} tabIndex={playerType === value ? 0 : -1}>{icon}{label}</button>)}
        </div>
        <div id="session-identity-panel" role="tabpanel" aria-labelledby={`session-tab-${playerType}`} className="session-identity-panel">
          {playerType === "guest" && <>
            <label className="lf-field"><span>Session Name (optional)</span><input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="Leave blank for anonymous walk-in" /></label>
            <label className="lf-field"><span>Players count</span><input type="number" min={1} max={20} value={playerCount} onChange={event => setPlayerCount(event.target.value === "" ? "" : Number(event.target.value))} /></label>
          </>}
          {playerType === "member" && <>
            <label className="lf-field"><span>Search by phone or name</span><input value={query} onChange={event => { setQuery(event.target.value); setMember(null); }} autoComplete="off" /></label>
            <div role="status" className="session-lookup-status">{lookup.busy ? "Searching..." : lookup.error || (query.trim().length < 3 ? "Enter at least 3 characters" : !member && !members.length ? "No matching members" : "")}</div>
            {!member && members.map(result => <button type="button" className="session-choice" key={result.id} onClick={() => setMember(result)}><strong>{result.nm}</strong><b>{result.phone || "No phone on file"}</b><span>{result.vis} sessions · {result.typ}</span></button>)}
            {member && <div className="session-choice is-selected"><strong>{member.nm}</strong><b>{member.phone || "No phone on file"}</b><span>{member.vis} sessions · {member.typ}</span><button type="button" className="lf-secondary-button" onClick={() => setMember(null)}>Change Member</button></div>}
          </>}
          {playerType === "booking" && bookings.map(result => <button type="button" className="session-choice" aria-pressed={booking?.id === result.id} key={result.id} onClick={() => setBooking(result)}><strong>{result.customer_name}</strong><b>{new Date(result.booking_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {result.phone || "No phone on file"}</b><span>{result.has_saved_price ? `₹${result.start_price?.rate || selectedTable?.rate}/hr · Booking-time tariff` : "Current tariff (no saved booking price)"} · Pay at venue</span></button>)}
        </div>
        {bookingError && <p role="alert" className="session-lookup-status">{bookingError}</p>}
        {playerType !== "booking" && <TariffSelector tableId={tableId} value={tariff} onChange={setTariff} catalog={selectedTable?.tariffs} />}
        <div className="lf-mode-grid" role="group" aria-label="Who pays">
          {[["single", "Single", "One payer"], ["sharing", "Sharing", "Split payment"], ["lp", "LP", "Loser pays"]].map(([value, label, detail]) => <button type="button" key={value} className={mode === value ? "is-selected" : ""} aria-pressed={mode === value} onClick={() => setMode(value)}><strong>{label}</strong><span>{detail}</span></button>)}
        </div>
        {mode !== "single" && <label className="lf-field"><span>Payer names (comma separated)</span><input value={otherPlayers} onChange={event => setOtherPlayers(event.target.value)} placeholder="Rahul, Vikram" /></label>}
        <div className="lf-modal-actions"><button type="button" className="lf-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="lf-primary-button" disabled={!selectedTable || (playerType === "member" && !member) || (playerType === "booking" && !booking)}>{saving ? "Starting..." : "Start Session"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
