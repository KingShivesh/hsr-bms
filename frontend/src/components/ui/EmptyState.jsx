import Icon from "./Icon.jsx";
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
        <Icon className={`ti ${icon}`} />
      </span>
      <div className="ui-empty-copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
