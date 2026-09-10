export function CurrencyAmount({ value = 0, className = "" }) {
  return (
    <span className={["ui-currency", className].filter(Boolean).join(" ")}>
      ₹{Number(value || 0).toLocaleString("en-IN")}
    </span>
  );
}

export function Timer({ value = "00:00", className = "" }) {
  return <span className={["ui-timer", className].filter(Boolean).join(" ")}>{value}</span>;
}

export function MetricCard({ label, value, context, icon, delta, className = "", style }) {
  return (
    <article className={["ui-metric-card", className].filter(Boolean).join(" ")} style={style}>
      <div className="ui-metric-head">
        <span>{label}</span>
        {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
      </div>
      <strong>{value}</strong>
      {delta && <small className={`ui-metric-delta ${delta.tone || "neutral"}`}>{delta.label}</small>}
      {context && <p>{context}</p>}
    </article>
  );
}
