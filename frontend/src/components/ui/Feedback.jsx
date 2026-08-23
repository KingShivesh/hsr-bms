export function Alert({ tone = "neutral", icon, title, children, className = "" }) {
  const fallbackIcon = {
    success: "ti-circle-check",
    warning: "ti-alert-triangle",
    danger: "ti-alert-circle",
    neutral: "ti-info-circle",
  }[tone] || "ti-info-circle";

  return (
    <div className={["ui-alert", `ui-alert-${tone}`, className].filter(Boolean).join(" ")} role={tone === "danger" ? "alert" : "status"}>
      <i className={`ti ${icon || fallbackIcon}`} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function SkeletonBlock({ rows = 3, className = "", label = "Loading" }) {
  return (
    <div className={["ui-skeleton-stack", className].filter(Boolean).join(" ")} role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 4, className = "", label = "Loading content" }) {
  return (
    <div className={["ui-skeleton-grid", className].filter(Boolean).join(" ")} role="status" aria-label={label}>
      {Array.from({ length: count }).map((_, index) => (
        <article key={index}>
          <span />
          <span />
          <span />
        </article>
      ))}
    </div>
  );
}
