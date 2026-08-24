export default function Checkbox({
  checked = false,
  disabled = false,
  label,
  hint,
  className = "",
  onChange,
  ...props
}) {
  return (
    <label className={["ui-checkbox", checked ? "is-checked" : "", disabled ? "is-disabled" : "", className].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked, event)}
        {...props}
      />
      <span className="ui-checkbox-box" aria-hidden="true" />
      <span className="ui-checkbox-copy">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
