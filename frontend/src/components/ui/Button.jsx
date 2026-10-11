import { Children, forwardRef, isValidElement } from "react";
import Icon from "./Icon.jsx";

function textLabel(children) {
  return Children.toArray(children).map(child => isValidElement(child) ? textLabel(child.props.children) : typeof child === "string" || typeof child === "number" ? child : "").join(" ").trim();
}

export const IconButton = forwardRef(function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  loading = false,
  className = "",
  disabled,
  type = "button",
  children,
  ...props
}, ref) {
  const classes = [
    "ui-button",
    "ui-button-icon",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    loading ? "is-loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      title={props.title || label}
      data-tooltip={props.title || label}
      {...props}
    >
      <Icon className={`ti ${loading ? "ti-loader-2 ui-button-spinner" : icon}`} />
      {children}
    </button>
  );
});

const Button = forwardRef(function Button({
  children,
  icon,
  iconRight,
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  type,
  native = false,
  ...props
}, ref) {
  const classes = [
    "ui-button",
    native ? "ui-button-native" : `ui-button-${variant}`,
    `ui-button-${size}`,
    loading ? "is-loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type ?? (native ? undefined : "button")}
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={props["aria-label"] || (loading ? textLabel(children) : undefined)}
      data-loading={loading || undefined}
      data-tooltip={props.title || props["aria-label"]}
      {...props}
    >
      {native ? children : <span className="ui-button-content">
        {icon && <Icon className={`ti ${icon}`} />}
        {children && <span>{children}</span>}
        {iconRight && <Icon className={`ti ${iconRight}`} />}
      </span>}
      {loading && <Icon className="ti ti-loader-2 ui-button-spinner" />}
    </button>
  );
});

export default Button;
