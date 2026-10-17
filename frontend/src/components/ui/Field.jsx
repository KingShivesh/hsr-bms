import { cloneElement, forwardRef, isValidElement, useId } from "react";
import Icon from "./Icon.jsx";

export function Field({ label, hint, error, children, className = "", htmlFor }) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const helpId = `${fieldId}-help`;
  const control = isValidElement(children) ? cloneElement(children, {
    ...(label && !children.props["aria-label"] ? { "aria-labelledby": labelId } : {}),
    ...((hint || error) ? { "aria-describedby": [children.props["aria-describedby"], helpId].filter(Boolean).join(" ") } : {}),
    ...(error ? { "aria-invalid": true } : {}),
  }) : children;
  return (
    <label className={["ui-field", error ? "has-error" : "", className].filter(Boolean).join(" ")} htmlFor={htmlFor}>
      {label && <span id={labelId} className="ui-field-label">{label}</span>}
      {control}
      {error ? <span id={helpId} className="ui-field-error">{error}</span> : hint ? <span id={helpId} className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef(function Input({ className = "", type = "text", ...props }, ref) {
  if (["checkbox", "radio", "range", "file", "hidden", "color"].includes(type)) return <input ref={ref} type={type} className={className} {...props} />;
  return <input ref={ref} type={type} className={["ui-input", className].filter(Boolean).join(" ")} {...props} />;
});

export const Select = forwardRef(function Select({ className = "", children, ...props }, ref) {
  if (props.multiple || props.size > 1) return <select ref={ref} className={`ui-select ${className}`} {...props}>{children}</select>;
  return (
    <span className="ui-select-wrap">
    <select ref={ref} className={["ui-select", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </select>
    <Icon name="chevron-down" className="ui-select-chevron" />
    </span>
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
