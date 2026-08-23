import { getTableStatusByKey } from "../../config/tableStatus.js";
import Badge from "../../components/ui/Badge.jsx";

export default function TableStatusBadge({ statusKey = "available", label = "" }) {
  const status = getTableStatusByKey(statusKey);
  return (
    <Badge tone={status.key} dot title={label || status.label} className="lf-status-badge">
      {label || status.label}
    </Badge>
  );
}
