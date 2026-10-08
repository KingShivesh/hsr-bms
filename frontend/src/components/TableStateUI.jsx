import { getTableStatusByKey } from "../config/tableStatus.js";

export function TableStateBadge({ statusKey = "available", label = "" }) {
  const status = getTableStatusByKey(statusKey);
  return (
    <span className="table-state-badge" data-state={status.key} data-tone={status.tone}>
      <span className="table-state-dot" data-dot={status.dotStyle} aria-hidden="true" />
      <i className={`ti ${status.icon}`} aria-hidden="true" />
      <span>{label || status.label}</span>
    </span>
  );
}

export function TableAttentionBadge({ attention }) {
  if (!attention) return null;
  return (
    <span className="table-state-attention">
      <i className={`ti ${attention.icon}`} aria-hidden="true" />
      {attention.label}
    </span>
  );
}

export function TablePrimaryAction({ statusKey = "available", onClick, label = "", disabled = false }) {
  const status = getTableStatusByKey(statusKey);
  const action = status.primaryAction;
  return (
    <button
      type="button"
      className="table-state-primary"
      onClick={onClick}
      disabled={disabled || action.disabled}
    >
      <i className={`ti ${action.icon}`} aria-hidden="true" />
      {label || action.label}
    </button>
  );
}
