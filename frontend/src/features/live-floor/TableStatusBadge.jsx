import { getTableStatusByKey } from "../../config/tableStatus.js";

export default function TableStatusBadge({ statusKey = "available", label = "" }) {
  const status = getTableStatusByKey(statusKey);
  return (
    <span className={`lf-status-badge lf-status-${status.key}`} title={label || status.label}>
      <span aria-hidden="true" />
      {label || status.label}
    </span>
  );
}
