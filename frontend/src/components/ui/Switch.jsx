import { Input } from "./Field.jsx";

export default function Switch({ label, checked, onChange, disabled, className = "", ...props }) {
  return <label className={`ui-switch ${className}`}>
    <Input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange?.(event.target.checked)} {...props} />
    <span className="ui-switch-track" aria-hidden="true"><span /></span>
    <span>{label}</span>
  </label>;
}
