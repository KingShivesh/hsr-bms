import { Icon as HsrIcon, Button as HsrButton } from "./ui/index.js";
import { getTableStatusByKey } from "../config/tableStatus.js";

export function TableStateBadge({ statusKey = "available", label = "" }) {
  const status = getTableStatusByKey(statusKey);
  return (
    <span className="table-state-badge" data-state={status.key} data-tone={status.tone}>
      <span className="table-state-dot" data-dot={status.dotStyle} aria-hidden="true" />
      <HsrIcon className={`ti ${status.icon}`} aria-hidden="true" />
      <span>{label || status.label}</span>
    </span>
  );
}

export function TableAttentionBadge({ attention }) {
  if (!attention) return null;
  return (
    <span className="table-state-attention">
      <HsrIcon className={`ti ${attention.icon}`} aria-hidden="true" />
      {attention.label}
    </span>
  );
}

export function TablePrimaryAction({ statusKey = "available", onClick, label = "", disabled = false, loading = false }) {
  const status = getTableStatusByKey(statusKey);
  const action = status.primaryAction;
  return (
    <HsrButton native
      type="button"
      className="table-state-primary"
      onClick={onClick}
      disabled={disabled || action.disabled}
      loading={loading}
    >
      <HsrIcon className={`ti ${action.icon}`} aria-hidden="true" />
      {label || action.label}
    </HsrButton>
  );
}
