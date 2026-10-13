import { useEffect, useState } from "react";
import { Button, Input } from "../../components/ui/index.js";
import { getSessionControls, saveSessionControls } from "../../api/index.js";
import { useToast } from "../../components/toastContext.js";

const TOGGLES = [["halfHourAlertsEnabled", "Half-hour reminders"], ["soundEnabled", "Reminder sounds"], ["allowOwnerEditTime", "Owner may edit time"], ["allowStaffEditTime", "Staff may edit time"], ["showEditWarningOnReceipt", "Time-adjustment footnote on receipt"]];
const NUMBERS = [["halfHourAlertStartAt", "First reminder (minutes)", 30, 360, 30], ["overtimeThresholdMinutes", "Overtime (minutes)", 60, 1440, 1], ["amountChangeThreshold", "PIN threshold (₹)", 0, 100000, 1], ["dailyEditSoftCap", "Daily edit reminder count", 1, 100, 1], ["lateEditWindowHours", "Late edit window (hours)", 1, 168, 1]];

export default function SessionControlsSettings() {
  const { showToast } = useToast();
  const [values, setValues] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    getSessionControls().then(({ data }) => { if (active) { setValues(Object.fromEntries([...TOGGLES, ...NUMBERS].map(([key]) => [key, data[key]]))); setError(""); } })
      .catch(err => { if (active) setError(err.userMessage || "Session controls could not load."); });
    return () => { active = false; };
  }, [retry]);
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await saveSessionControls(values); showToast("Session controls saved", "success"); }
    catch (err) { setError(typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Check the reminder and guardrail values."); }
    finally { setBusy(false); }
  }
  return <section className="settings-panel">
    <h3>Session reminders & time corrections</h3>
    {error && <div role="alert"><p>{error}</p>{!values && <Button onClick={() => setRetry(value => value + 1)}>Retry</Button>}</div>}
    {!values && !error ? <p role="status">Loading session controls...</p> : values && <form onSubmit={save}><fieldset disabled={busy} className="session-controls-settings">
      {TOGGLES.map(([key, label]) => <label className="session-control-toggle" key={key}><input type="checkbox" checked={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
      {NUMBERS.map(([key, label, min, max, step]) => <label key={key}>{label}<Input type="number" required min={min} max={max} step={step} value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value === "" ? "" : Number(event.target.value) }))} /></label>)}
      <Button type="submit" loading={busy}>Save Session Controls</Button>
    </fieldset></form>}
  </section>;
}
