import { useEffect, useState } from "react";
import { Button, Input, Select, Table, EmptyState } from "../../components/ui/index.js";
import { getSessionEdits } from "../../api/index.js";
import { formatCurrency } from "../../utils/format.js";

export default function SessionEditsReport() {
  const [filters, setFilters] = useState({ from_date: "", to_date: "", staff: "", reason: "", category: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    getSessionEdits(filters).then(({ data }) => { if (active) setRows(data); })
      .catch(err => { if (active) setError(err.userMessage || "Session edits could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, retry]);
  async function exportRows() {
    setExporting(true);
    try {
      const { data } = await getSessionEdits({ ...filters, export: true });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const link = document.createElement("a"); link.href = url; link.download = "session-edits.csv"; link.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.userMessage || "Export failed."); }
    finally { setExporting(false); }
  }
  function update(key, value) { setFilters(current => ({ ...current, [key]: value })); }
  return <section className="session-edits-report">
    <div className="section-header"><h3>Session Edits</h3><Button variant="secondary" icon="ti-download" loading={exporting} disabled={loading || !!error} onClick={exportRows}>Export CSV</Button></div>
    <div className="session-edit-filters">
      <label>From<Input type="date" value={filters.from_date} onChange={event => update("from_date", event.target.value)} /></label>
      <label>To<Input type="date" value={filters.to_date} onChange={event => update("to_date", event.target.value)} /></label>
      <label>Staff<Input value={filters.staff} onChange={event => update("staff", event.target.value)} /></label>
      <label>Category<Select value={filters.category} onChange={event => update("category", event.target.value)}><option value="">All</option><option value="correction">Correction</option><option value="adjustment">Adjustment</option></Select></label>
      <label>Reason<Select value={filters.reason} onChange={event => update("reason", event.target.value)}><option value="">All</option>{[["staff_forgot_to_start", "Forgot to start"], ["staff_started_too_early", "Started too early"], ["pause_not_logged", "Pause not logged"], ["customer_dispute", "Customer dispute"], ["promotional", "Promotional / VIP"], ["other", "Other"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    </div>
    {loading ? <p role="status">Loading session edits...</p> : error ? <div role="alert"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : rows.length ? <div className="ui-table-wrap"><Table><thead><tr>{["Date", "Table", "Staff", "Original", "Edited", "Reason", "Category", "Notes", "Δ Amount"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.date}{row.late_edit ? " · Late Edit" : ""}</td><td>{row.table}</td><td>{row.staff}</td><td>{row.original_duration}m</td><td>{row.new_duration}m</td><td>{row.reason_label}</td><td>{row.category}</td><td>{row.notes || "—"}</td><td>{formatCurrency(row.delta)}</td></tr>)}</tbody></Table></div> : <EmptyState title="No session edits" description="No recorded corrections or adjustments match these filters." icon="ti-clock" />}
  </section>;
}
