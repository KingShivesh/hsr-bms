import { Children, forwardRef, isValidElement, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

function textLabel(children) {
  return Children.toArray(children).map(child => isValidElement(child) ? textLabel(child.props.children) : typeof child === "string" || typeof child === "number" ? child : "").join(" ").trim();
}

function usePendingButton(ref, loading, onClick, disabled) {
  const node = useRef(null);
  const pending = useRef(false);
  const size = useRef(null);
  const [working, setWorking] = useState(false);
  useImperativeHandle(ref, () => node.current);
  const busy = loading || working;
  useLayoutEffect(() => {
    const button = node.current;
    if (!button) return;
    if (busy && size.current) {
      button.style.width = `${size.current.width}px`;
      button.style.height = `${size.current.height}px`;
    }
    return () => {
      if (size.current) {
        button.style.width = size.current.originalWidth;
        button.style.height = size.current.originalHeight;
      }
    };
  }, [busy]);
  function click(event) {
    if (pending.current || loading || disabled) { event.preventDefault(); return; }
    const button = event.currentTarget;
    button.style.setProperty("--button-busy-ink", getComputedStyle(button).color);
    size.current = { ...button.getBoundingClientRect().toJSON(), originalWidth: button.style.width, originalHeight: button.style.height };
    pending.current = true;
    setWorking(true);
    let result;
    try { result = onClick?.(event); }
    catch (error) { pending.current = false; setWorking(false); throw error; }
    if (!result || typeof result.then !== "function") { pending.current = false; setWorking(false); return result; }
    return Promise.resolve(result).catch(error => {
      window.dispatchEvent(new CustomEvent("hsr:action-failed", { detail: error.userMessage || "The action could not complete. Please try again." }));
    }).finally(() => { pending.current = false; setWorking(false); });
  }
  return { node, busy, click };
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
  onClick,
  ...props
}, ref) {
  const { node, busy, click } = usePendingButton(ref, loading, onClick, disabled);
  const classes = [
    "ui-button",
    "ui-button-icon",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    busy ? "is-loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      ref={node}
      className={classes}
      disabled={disabled || busy}
      aria-label={label}
      aria-busy={busy || undefined}
      data-loading={busy || undefined}
      onClick={click}
      title={props.title || label}
      data-tooltip={props.title || label}
      {...props}
    >
      <Icon className={`ti ${busy ? "ti-loader-2 ui-button-spinner" : icon}`} />
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
  onClick,
  ...props
}, ref) {
  const { node, busy, click } = usePendingButton(ref, loading, onClick, disabled);
  const classes = [
    "ui-button",
    native ? "ui-button-native" : `ui-button-${variant}`,
    `ui-button-${size}`,
    busy ? "is-loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type ?? (native ? undefined : "button")}
      ref={node}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={props["aria-label"] || textLabel(children) || undefined}
      data-loading={busy || undefined}
      onClick={click}
      data-tooltip={props.title || props["aria-label"]}
      {...props}
    >
      {native ? children : <span className="ui-button-content">
        {icon && <Icon className={`ti ${icon}`} />}
        {children && <span>{children}</span>}
        {iconRight && <Icon className={`ti ${iconRight}`} />}
      </span>}
      {busy && <Icon className="ti ti-loader-2 ui-button-spinner" />}
    </button>
  );
});

export default Button;
