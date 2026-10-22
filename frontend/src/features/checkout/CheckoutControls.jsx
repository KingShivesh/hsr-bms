import { useEffect, useState } from "react";
import { Button, Input, Select, Textarea, Alert, Disclosure, SkeletonBlock, EmptyState, Panel } from "../../components/ui/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
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
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (path !== "member") return;
    let active = true;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      const request = query.trim().length >= 3 ? searchMembers(query.trim()) : getRecentMembers();
      request.then(({ data }) => {
        if (!Array.isArray(data)) throw new Error("Member lookup returned incomplete data.");
        if (active) setRows(data.filter(member => member && member.id != null));
      })
        .catch(err => { if (active) { setRows([]); setError(err.userMessage || "Member lookup failed."); } })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, path, retry]);
  function choosePath(next) {
    setPath(next); setQuery("");
    onChange({ name: next === "name" ? "" : null, recalculate_rate: false });
  }
  return <Panel className="checkout-section">
    <h4>Customer (optional)</h4>
    <div className="checkout-button-grid checkout-customer-paths" role="group" aria-label="Customer at close">
      {[["member", "Search LP Member"], ["name", "Add name"], ["skip", "Skip"]].map(([key, label]) => <Button key={key} variant="secondary" className={path === key ? "is-active" : ""} disabled={disabled} aria-pressed={path === key} onClick={() => choosePath(key)}>{label}</Button>)}
    </div>
    {path === "member" && <>
      <label className="checkout-field"><span>Search by phone or name</span><Input autoFocus value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></label>
      {loading ? <SkeletonBlock rows={2} label="Loading members" /> : error ? <RetryNotice message={error} onRetry={() => { setLoading(true); setError(""); setRetry(value => value + 1); }} /> : !rows.length ? <EmptyState icon="ti-users" title={query.trim().length >= 3 ? "No matching members" : "No recent members"} description="Search for another member, or continue with a guest name." secondaryAction={false} action={<Button disabled={disabled} onClick={() => choosePath("name")}>Use guest name</Button>} /> : <p role="status">{query.trim().length < 3 ? "Recent members" : "Matching members"}</p>}
      {!loading && !error && rows.map(member => <Button key={member.id} variant="secondary" className="session-choice" disabled={disabled} aria-pressed={value?.member_id === member.id} onClick={() => onChange({ member_id: member.id, recalculate_rate: true })}>
        <strong>{member.nm || member.phone || "Member"}</strong><span>{member.phone || "No phone on file"} · {member.typ}</span><span>{member.hourly_rate ? `${formatCurrency(member.hourly_rate)}/hr` : "Club standard rate"}</span>
      </Button>)}
    </>}
    {path === "name" && <>
      <label className="checkout-field"><span>Name (optional)</span><Input maxLength={80} disabled={disabled} value={value?.name || ""} onChange={event => (onDraftChange || onChange)({ ...value, name: event.target.value })} onBlur={() => onChange(value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    </>}
  </Panel>;
}

export function AdjustSessionTime({ quote, value, onChange, onDirtyChange, disabled }) {
  const [started, setStarted] = useState(() => localDateTime(quote.session_started_at));
  const [paused, setPaused] = useState(String(quote.paused_minutes || 0));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const originalStarted = localDateTime(quote.time_edit?.original_started_at || quote.session_started_at);
  const originalPaused = String((quote.time_edit?.original_paused_ms ?? quote.paused_minutes * 60000) / 60000);
  const dirty = started !== originalStarted || paused !== originalPaused || !!reason || !!notes;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  function apply() {
    onChange({ started_at_ms: new Date(started).getTime(), total_paused_minutes: Number(paused), reason, notes, manager_pin: value?.manager_pin || "" });
  }
  return <Disclosure className="checkout-time-adjust" headerClassName="checkout-adjust-toggle" title="Adjust Time" icon="clock" disabled={disabled}>
    <ContextHelp label="Help with time corrections">Enter the actual start and paused time, select a reason, then review the recalculated bill before closing. The original and corrected values are audited. Large changes require the configured manager PIN.</ContextHelp>
    <div className="checkout-time-fields">
    <label className="checkout-field"><span>Started at</span><Input type="datetime-local" step="1" value={started} disabled={disabled} onChange={event => setStarted(event.target.value)} /></label>
    <label className="checkout-field"><span>Ended at (frozen)</span><Input type="datetime-local" step="1" readOnly value={localDateTime(quote.session_ended_at)} /></label>
    <label className="checkout-field"><span>Total paused minutes</span><Input type="number" min={0} step="any" disabled={disabled} value={paused} onChange={event => setPaused(event.target.value)} /></label>
    <div className="checkout-adjust-preview"><span>Current billable time</span><strong>{quote.dur} min</strong><span>Table charge {formatCurrency(quote.ply)}</span></div>
    </div>
    <label className="checkout-field"><span>Reason</span><Select aria-label="Time adjustment reason" value={reason} disabled={disabled} onChange={event => setReason(event.target.value)}>
      <option value="">Select reason</option>{REASONS.map(([key, label, rows]) => <optgroup key={key} label={label}>{rows.map(([id, text]) => <option value={id} key={id}>{text}</option>)}</optgroup>)}
    </Select></label>
    <label className="checkout-field"><span>Notes{reason === "other" ? " (required)" : " (optional)"}</span><Textarea rows={3} maxLength={500} value={notes} disabled={disabled} onChange={event => setNotes(event.target.value)} /></label>
    {quote.time_edit && <Alert tone="warning">{quote.time_edit.original_duration} → {quote.time_edit.new_duration} min · Amount change {formatCurrency(quote.time_edit.delta)}{quote.time_edit.late_edit ? " · Late Edit" : ""}</Alert>}
    {quote.pin_required && <label className="checkout-field"><span>Manager PIN required</span><Input type="password" autoComplete="off" value={value?.manager_pin || ""} disabled={disabled} onChange={event => onChange({ ...value, manager_pin: event.target.value })} /></label>}
    <div className="checkout-actions checkout-adjust-actions"><Button variant="ghost" disabled={disabled || (!dirty && !value)} onClick={() => { onChange(null); setStarted(originalStarted); setPaused(originalPaused); setReason(""); setNotes(""); }}>Reset</Button><Button variant="primary" loading={disabled} onClick={apply} disabled={!reason || !started || paused === "" || (reason === "other" && !notes.trim())}>Apply Change</Button></div>
  </Disclosure>;
}
