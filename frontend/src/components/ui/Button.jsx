import { forwardRef } from "react";

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
      {...props}
    >
      <i className={`ti ${loading ? "ti-loader-2 ui-button-spinner" : icon}`} aria-hidden="true" />
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
  type = "button",
  ...props
}, ref) {
  const classes = [
    "ui-button",
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
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <i className="ti ti-loader-2 ui-button-spinner" aria-hidden="true" />
      ) : icon ? (
        <i className={`ti ${icon}`} aria-hidden="true" />
      ) : null}
      {children && <span>{children}</span>}
      {iconRight && !loading ? <i className={`ti ${iconRight}`} aria-hidden="true" /> : null}
    </button>
  );
});

export default Button;
