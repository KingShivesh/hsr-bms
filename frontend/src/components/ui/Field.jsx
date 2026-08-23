export function Field({ label, hint, error, children, className = "", htmlFor }) {
  return (
    <label className={["ui-field", error ? "has-error" : "", className].filter(Boolean).join(" ")} htmlFor={htmlFor}>
      {label && <span className="ui-field-label">{label}</span>}
      {children}
      {error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }) {
  return <input className={["ui-input", className].filter(Boolean).join(" ")} {...props} />;
}

export function Select({ className = "", children, ...props }) {
  return (
    <select className={["ui-select", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </select>
  );
}

export function SearchInput({ className = "", icon = "ti-search", ...props }) {
  return (
    <div className={["ui-search", className].filter(Boolean).join(" ")}>
      <i className={`ti ${icon}`} aria-hidden="true" />
      <input {...props} />
    </div>
  );
}
