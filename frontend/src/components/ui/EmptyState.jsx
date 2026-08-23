export default function EmptyState({
  icon = "ti-circle-check",
  title = "Nothing here yet",
  description,
  action,
  className = "",
}) {
  return (
    <div className={["ui-empty-state", className].filter(Boolean).join(" ")}>
      <span className="ui-empty-icon" aria-hidden="true">
        <i className={`ti ${icon}`} />
      </span>
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
