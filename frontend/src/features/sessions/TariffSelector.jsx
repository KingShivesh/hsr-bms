import { useEffect, useState } from "react";
import { getTariffs } from "../../api/index.js";
import { tableRateGroup } from "./tariffs.js";

export default function TariffSelector({ tableId, value, onChange, catalog }) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (catalog) return;
    let active = true;
    getTariffs().then(response => { if (active) setLoaded(response.data); })
      .catch(() => { if (active) setError("Frame and package prices unavailable. Hourly remains available."); });
    return () => { active = false; };
  }, [catalog]);
  const data = catalog || loaded;
  const group = tableRateGroup(tableId);
  const framePrice = data?.frame_rates?.[group] || 0;
  const packages = (data?.packages || []).filter(row => ["any", group].includes(row.table_group));
  const packageAvailable = packages.some(row => row.id === value.package_id);
  return (
    <div className="tariff-selector">
      <label className="lf-field">
        <span>Tariff</span>
        <select aria-label="Tariff" value={value.tariff_mode} onChange={event => onChange({ tariff_mode: event.target.value, package_id: "" })}>
          <option value="hourly">Hourly</option>
          <option value="frame" disabled={!framePrice}>Per frame{framePrice ? ` · ₹${framePrice}` : " · Not configured"}</option>
          <option value="package" disabled={!packages.length}>Fixed package{packages.length ? "" : " · Not configured"}</option>
        </select>
      </label>
      {value.tariff_mode === "package" && (
        <label className="lf-field">
          <span>Package</span>
          <select aria-label="Package" required value={packageAvailable ? value.package_id : ""} onChange={event => onChange({ ...value, package_id: event.target.value })}>
            <option value="">Select package</option>
            {packages.map(row => <option key={row.id} value={row.id}>{row.name} · ₹{row.price}</option>)}
          </select>
        </label>
      )}
      {error && <p role="status" className="lf-muted-copy">{error}</p>}
    </div>
  );
}
