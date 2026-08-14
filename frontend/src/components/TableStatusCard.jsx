import { getTableLabel, getTableRate } from "../config/hsrTables.js";
import { getTableStatus } from "../config/tableStatus.js";

export default function TableStatusCard({
  table,
  session,
  booking,
  maintenance,
  rates,
  recommended = false,
  recommendedLabel = "",
  detail,
}) {
  const status = getTableStatus({ session, booking, maintenance });
  const rateLabel = `₹${getTableRate(table, rates)}/hr · ${table.type === "POOL" ? "Pool" : "Snooker"}`;

  return (
    <article className={`table-status-card ${status.className} ${recommended ? "recommended" : ""}`}>
      <div className="table-status-card-head">
        <div className="table-status-card-index">T{table.num}</div>
        <span className={`table-status-badge ${status.tone}`}>{status.label}</span>
      </div>
      <div className="table-status-card-main">
        <strong title={`T${table.num} · ${getTableLabel(table)}`}>
          T{table.num} · {getTableLabel(table)}
        </strong>
        <span title={rateLabel}>{rateLabel}</span>
      </div>
      <div className="table-status-card-detail">
        {detail || (recommended ? recommendedLabel : "Backup table")}
      </div>
    </article>
  );
}
