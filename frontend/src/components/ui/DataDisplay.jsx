import { Icon as HsrIcon } from "./index.js";
import { formatCurrency } from "../../utils/format.js";
import Card from "./Card.jsx";
import { createElement } from "react";
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

export function MetricValue({ children, as = "strong", className = "", ...props }) {
  return createElement(as, { className: ["ui-metric-value", className].filter(Boolean).join(" "), "data-dense": String(children ?? "").length > 12, ...props }, children);
}

export function MetricCard({ label, value, context, icon, delta, className = "", style, variant = "default", children }) {
  const comparison = delta && <small className={`ui-metric-delta ${delta.tone || "neutral"}`}>
    {delta.icon && <HsrIcon className={`ti ${delta.icon}`} aria-hidden="true" />}<span className="ui-metric-delta-label" title={delta.label}>{delta.label}</span>
  </small>;
  return (
    <Card as="article" className={["ui-metric-card", `ui-metric-card-${variant}`, className].filter(Boolean).join(" ")} style={style}>
      <div className="ui-metric-head">
        <span>{label}</span>
        {icon && <HsrIcon className={`ti ${icon}`} aria-hidden="true" />}
      </div>
      {variant === "lead" ? <div className="ui-metric-value-row"><MetricValue>{value}</MetricValue>{comparison}</div> : <><MetricValue>{value}</MetricValue>{comparison}</>}
      {context && <p>{context}</p>}
      {children}
    </Card>
  );
}
