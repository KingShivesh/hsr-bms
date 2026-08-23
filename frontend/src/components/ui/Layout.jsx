export function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <div className={["ui-page-header", className].filter(Boolean).join(" ")}>
      <div>
        {eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <div className={["ui-section-header", className].filter(Boolean).join(" ")}>
      <div>
        {eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-section-actions">{actions}</div>}
    </div>
  );
}
