import { Card as HsrCard } from "./ui/index.js";
import { formatDuration as polishDuration } from "../utils/format.js";
import { TableAttentionBadge, TablePrimaryAction, TableStateBadge } from "./TableStateUI.jsx";
import { getTableLabel, getTableRate } from "../config/hsrTables.js";
import { tableStateAttributes, getTableAttention, getTableStatus, getTableStatusByKey } from "../config/tableStatus.js";

function formatTimer(seconds = 0) { return polishDuration(seconds); }

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
  onAction,
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
  const statusLabel = tableState?.status_label || status.label;
  const tableRate = tableState?.rate ?? getTableRate(table, rates);
  const rateLabel = `₹${tableRate}/hr · ${table.type === "POOL" ? "Pool" : "Snooker"}`;
  const elapsedSeconds = tableState?.elapsed_seconds || resolvedSession?.elapsed_seconds || 0;
  const attention = getTableAttention({ session: resolvedSession, elapsedSeconds });

  return (
    <HsrCard as="article" className="table-status-card table-state-card" {...tableStateAttributes(status.key)} data-attention={attention ? "true" : "false"}>
      <div className="table-status-card-head">
        <div className="table-status-card-index">T{table.num}</div>
        <div className="table-state-card-flags">
          <TableAttentionBadge attention={attention} />
          <TableStateBadge statusKey={status.key} label={statusLabel} />
        </div>
      </div>
      <div className="table-status-card-main">
        <strong title={`T${table.num} · ${getTableLabel(table)}`}>
          T{table.num} · {getTableLabel(table)}
        </strong>
        <span title={rateLabel}>{rateLabel}</span>
      </div>
      <strong className={resolvedSession ? "table-state-timer" : "table-state-rate"} data-timer={status.timerStyle}>
        {resolvedSession ? formatTimer(elapsedSeconds)
          : resolvedBooking ? new Date(resolvedBooking.booking_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
          : `₹${tableRate}/hr`}
      </strong>
      <div className="table-status-card-detail">
        {resolvedBooking ? `${resolvedBooking.customer_name} · Reserved` : detail || tableState?.detail || (recommended ? recommendedLabel : "Backup table")}
      </div>
      <TablePrimaryAction statusKey={status.key} onClick={onAction} />
    </HsrCard>
  );
}
