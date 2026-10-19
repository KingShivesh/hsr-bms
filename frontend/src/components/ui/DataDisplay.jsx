import { Icon as HsrIcon } from "./index.js";
import { formatCurrency } from "../../utils/format.js";
export function CurrencyAmount({ value = 0, className = "" }) {
  return (
    <span className={["ui-currency", className].filter(Boolean).join(" ")}>
      {formatCurrency(value)}
    </span>
  );
}

export function Timer({ value = "00:00", className = "" }) {
  return <span className={["ui-timer", className].filter(Boolean).join(" ")}>{value}</span>;
}

export function MetricValue({ children, ...props }) {
  return <strong data-dense={String(children ?? "").length > 12} {...props}>{children}</strong>;
}

export function MetricCard({ label, value, context, icon, delta, className = "", style }) {
  return (
    <article className={["ui-metric-card", className].filter(Boolean).join(" ")} style={style}>
      <div className="ui-metric-head">
        <span>{label}</span>
        {icon && <HsrIcon className={`ti ${icon}`} aria-hidden="true" />}
      </div>
      <MetricValue>{value}</MetricValue>
      {delta && <small className={`ui-metric-delta ${delta.tone || "neutral"}`}>{delta.label}</small>}
      {context && <p>{context}</p>}
    </article>
  );
}
