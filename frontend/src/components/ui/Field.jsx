import { forwardRef } from "react";
import Icon from "./Icon.jsx";

export function Field({ label, hint, error, children, className = "", htmlFor }) {
  return (
    <label className={["ui-field", error ? "has-error" : "", className].filter(Boolean).join(" ")} htmlFor={htmlFor}>
      {label && <span className="ui-field-label">{label}</span>}
      {children}
      {error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef(function Input({ className = "", type = "text", ...props }, ref) {
  if (["checkbox", "radio", "range", "file", "hidden", "color"].includes(type)) return <input ref={ref} type={type} className={className} {...props} />;
  return <input ref={ref} type={type} className={["ui-input", className].filter(Boolean).join(" ")} {...props} />;
});

export const Select = forwardRef(function Select({ className = "", children, ...props }, ref) {
  return (
    <select ref={ref} className={["ui-select", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={["ui-textarea", className].filter(Boolean).join(" ")} {...props} />;
});

export function SearchInput({ className = "", icon = "ti-search", ...props }) {
  return (
    <div className={["ui-search", className].filter(Boolean).join(" ")}>
      <Icon className={`ti ${icon}`} />
      <Input {...props} />
    </div>
  );
}
