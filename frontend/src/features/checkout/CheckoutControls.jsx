import { useEffect, useState } from "react";
import { Button, Input, Select, Alert } from "../../components/ui/index.js";
import { getRecentMembers, searchMembers } from "../../api/index.js";
import { formatCurrency } from "../../utils/format.js";
import ContextHelp from "../../product/ContextHelp.jsx";

const REASONS = [
  ["correction", "Correction", [["staff_forgot_to_start", "Staff forgot to start"], ["staff_started_too_early", "Staff started too early"], ["pause_not_logged", "Pause not logged"]]],
  ["adjustment", "Adjustment (commercial)", [["customer_dispute", "Customer dispute (courtesy)"], ["promotional", "Promotional / VIP"], ["other", "Other (specify)"]]],
];

function localDateTime(ms) {
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

export function CustomerAtClose({ value, onChange, onDraftChange, disabled }) {
  const [path, setPath] = useState(value?.member_id ? "member" : value?.name ? "name" : "skip");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (path !== "member") return;
    let active = true;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      const request = query.trim().length >= 3 ? searchMembers(query.trim()) : getRecentMembers();
      request.then(({ data }) => { if (active) setRows(data); })
        .catch(err => { if (active) { setRows([]); setError(err.userMessage || "Member lookup failed."); } })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, path]);
  function choosePath(next) {
    setPath(next); setQuery("");
    onChange({ name: next === "name" ? "" : null, recalculate_rate: false });
  }
  return <section className="checkout-section">
    <h4>Customer (optional)</h4>
    <div className="checkout-button-grid checkout-customer-paths" role="group" aria-label="Customer at close">
      {[["member", "Search LP Member"], ["name", "Add name"], ["skip", "Skip"]].map(([key, label]) => <Button key={key} variant="secondary" disabled={disabled} aria-pressed={path === key} onClick={() => choosePath(key)}>{label}</Button>)}
    </div>
    {path === "member" && <>
      <label className="checkout-field"><span>Search by phone or name</span><Input autoFocus value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></label>
      <p role="status">{loading ? "Loading members..." : error || (query.length < 3 ? "Recent members" : !rows.length ? "No matching members" : "")}</p>
      {rows.map(member => <Button key={member.id} variant="secondary" className="session-choice" disabled={disabled} aria-pressed={value?.member_id === member.id} onClick={() => onChange({ member_id: member.id, recalculate_rate: true })}>
        <strong>{member.nm || member.phone || "Member"}</strong><span>{member.phone || "No phone on file"} · {member.typ}</span><span>{member.hourly_rate ? `${formatCurrency(member.hourly_rate)}/hr` : "Club standard rate"}</span>
      </Button>)}
    </>}
    {path === "name" && <>
      <label className="checkout-field"><span>Name (optional)</span><Input maxLength={80} disabled={disabled} value={value?.name || ""} onChange={event => (onDraftChange || onChange)({ ...value, name: event.target.value })} onBlur={() => onChange(value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    </>}
  </section>;
}

export function AdjustSessionTime({ quote, value, onChange, disabled }) {
  const [started, setStarted] = useState(() => localDateTime(quote.session_started_at));
  const [paused, setPaused] = useState(String(quote.paused_minutes || 0));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  function apply() {
    onChange({ started_at_ms: new Date(started).getTime(), total_paused_minutes: Number(paused), reason, notes, manager_pin: value?.manager_pin || "" });
  }
  return <details className="checkout-section checkout-time-adjust">
    <summary>Adjust Time</summary>
    <ContextHelp label="Help with time corrections">Enter the actual start and paused time, select a reason, then review the recalculated bill before closing. The original and corrected values are audited. Large changes require the configured manager PIN.</ContextHelp>
    <label className="checkout-field"><span>Started at</span><Input type="datetime-local" step="1" value={started} disabled={disabled} onChange={event => setStarted(event.target.value)} /></label>
    <label className="checkout-field"><span>Ended at (frozen)</span><Input type="datetime-local" step="1" readOnly value={localDateTime(quote.session_ended_at)} /></label>
    <label className="checkout-field"><span>Total paused minutes</span><Input type="number" min={0} step="any" disabled={disabled} value={paused} onChange={event => setPaused(event.target.value)} /></label>
    <label className="checkout-field"><span>Reason</span><Select aria-label="Time adjustment reason" value={reason} disabled={disabled} onChange={event => setReason(event.target.value)}>
      <option value="">Select reason</option>{REASONS.map(([key, label, rows]) => <optgroup key={key} label={label}>{rows.map(([id, text]) => <option value={id} key={id}>{text}</option>)}</optgroup>)}
    </Select></label>
    <label className="checkout-field"><span>Notes{reason === "other" ? " (required)" : " (optional)"}</span><Input maxLength={500} value={notes} disabled={disabled} onChange={event => setNotes(event.target.value)} /></label>
    {quote.time_edit && <Alert tone="warning">{quote.time_edit.original_duration} → {quote.time_edit.new_duration} min · Amount change {formatCurrency(quote.time_edit.delta)}{quote.time_edit.late_edit ? " · Late Edit" : ""}</Alert>}
    {quote.pin_required && <label className="checkout-field"><span>Manager PIN required</span><Input type="password" autoComplete="off" value={value?.manager_pin || ""} disabled={disabled} onChange={event => onChange({ ...value, manager_pin: event.target.value })} /></label>}
    <div className="checkout-actions"><Button variant="secondary" disabled={disabled} onClick={() => { onChange(null); setStarted(localDateTime(quote.time_edit?.original_started_at || quote.session_started_at)); setPaused(String((quote.time_edit?.original_paused_ms ?? quote.paused_minutes * 60000) / 60000)); }}>Reset</Button><Button variant="secondary" loading={disabled} onClick={apply} disabled={!reason || !started || paused === "" || (reason === "other" && !notes.trim())}>Apply Change</Button></div>
  </details>;
}
