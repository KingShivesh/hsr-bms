import { useEffect, useState } from "react";
import { getTariffs, saveTariffs } from "../../api/index.js";
import { useToast } from "../../components/toastContext.js";

const groups = [["wr", "Wiraka T1/T2"], ["sr", "English T3/T4"], ["pr", "Pool T5"]];

export default function TariffSettings() {
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { setCatalog((await getTariffs()).data); }
    catch { setError("Could not load tariff settings."); }
  }
  useEffect(() => { load(); }, []);
  function updatePackage(id, changes) {
    setCatalog(current => ({ ...current, packages: current.packages.map(row => row.id === id ? { ...row, ...changes } : row) }));
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await saveTariffs({ frame_rates: Object.fromEntries(Object.entries(catalog.frame_rates).map(([key, value]) => [key, Number(value)])),
        packages: catalog.packages.map(row => ({ ...row, price: Number(row.price) })) });
      showToast("Tariffs saved", "success");
    } catch (failure) {
      const detail = failure.response?.data?.detail;
      showToast(typeof detail === "string" ? detail : "Check package names and prices before saving.", "error");
    } finally { setBusy(false); }
  }
  return (
    <section className="settings-panel" aria-label="Frame and package tariffs">
      <div className="settings-card-heading"><div className="settings-panel-title">Frame & Package Tariffs</div></div>
      {!catalog ? <div role="status">{error || "Loading tariffs..."}{error && <button type="button" className="btn btn-outline" onClick={load}>Retry</button>}</div> : (
        <form onSubmit={save}>
          <fieldset disabled={busy} className="tariff-fieldset">
            <div className="settings-form-grid">
              {groups.map(([key, name]) => <label key={key}><span className="form-label">{name} (₹/frame; 0 = disabled)</span><input className="input-field" type="number" min="0" max="5000" step="1" required value={catalog.frame_rates[key] || 0} onChange={event => setCatalog(current => ({ ...current, frame_rates: { ...current.frame_rates, [key]: event.target.value } }))} /></label>)}
            </div>
            {catalog.packages.map((row, index) => (
              <div key={row.id} className="tariff-package-row">
                <label><span className="form-label">Package {index + 1}</span><input className="input-field" required maxLength="60" aria-label={`Package ${index + 1} name`} value={row.name} onChange={event => updatePackage(row.id, { name: event.target.value })} /></label>
                <label><span className="form-label">Fixed price (₹)</span><input className="input-field" type="number" min="1" max="100000" step="1" required aria-label={`Package ${index + 1} price`} value={row.price} onChange={event => updatePackage(row.id, { price: event.target.value })} /></label>
                <label><span className="form-label">Tables</span><select className="input-field" aria-label={`Package ${index + 1} tables`} value={row.table_group} onChange={event => updatePackage(row.id, { table_group: event.target.value })}><option value="any">All tables</option>{groups.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                <button type="button" className="lf-icon-button" aria-label={`Remove package ${index + 1}`} title="Remove package" onClick={() => { if (window.confirm(`Remove ${row.name || "this package"} from the catalog? Active sessions keep their agreed price.`)) setCatalog(current => ({ ...current, packages: current.packages.filter(item => item.id !== row.id) })); }}><i className="ti ti-trash" aria-hidden="true" /></button>
              </div>
            ))}
            <div className="tariff-settings-actions">
              <button type="button" className="btn btn-outline" disabled={catalog.packages.length >= 20} onClick={() => setCatalog(current => ({ ...current, packages: [...current.packages, { id: crypto.randomUUID(), name: "", price: "", table_group: "any" }] }))}><i className="ti ti-plus" aria-hidden="true" />Add Package</button>
              <button type="submit" className="btn btn-primary-sm">{busy ? "Saving..." : "Save Tariffs"}</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
