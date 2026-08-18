import { getTableLabel, getTableRate } from "../config/hsrTables.js";
import { getTableStatus, getTableStatusByKey } from "../config/tableStatus.js";

export default function TableStatusCard({
  table,
  session,
  booking,
  maintenance,
  rates,
  recommended = false,
  recommendedLabel = "",
  detail,
  tableState,
}) {
  const resolvedSession = tableState?.session || session;
  const resolvedBooking = tableState?.booking || booking;
  const resolvedMaintenance = tableState?.maintenance || maintenance;
  const status = tableState?.status_key
    ? getTableStatusByKey(tableState.status_key)
    : getTableStatus({
        session: resolvedSession,
        booking: resolvedBooking,
        maintenance: resolvedMaintenance,
      });
  const tableRate = tableState?.rate ?? getTableRate(table, rates);
  const rateLabel = `₹${tableRate}/hr · ${table.type === "POOL" ? "Pool" : "Snooker"}`;

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
        {detail || tableState?.detail || (recommended ? recommendedLabel : "Backup table")}
      </div>
    </article>
  );
}
