import Button, { IconButton } from "./Button.jsx";

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className = "",
  size = "md",
}) {
  if (!open) return null;

  return (
    <div className="ui-overlay" role="presentation">
      <section
        className={["ui-modal", `ui-modal-${size}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "ui-modal-title" : undefined}
      >
        <div className="ui-overlay-head">
          <div>
            {title && <h2 id="ui-modal-title">{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {onClose && <IconButton label="Close dialog" icon="ti-x" variant="ghost" onClick={onClose} />}
        </div>
        <div className="ui-overlay-body">{children}</div>
        {footer && <div className="ui-overlay-footer">{footer}</div>}
      </section>
    </div>
  );
}

export function Drawer({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className = "",
  side = "right",
}) {
  if (!open) return null;

  return (
    <div className="ui-overlay" role="presentation">
      <aside
        className={["ui-drawer", `ui-drawer-${side}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "ui-drawer-title" : undefined}
      >
        <div className="ui-overlay-head">
          <div>
            {title && <h2 id="ui-drawer-title">{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {onClose && <IconButton label="Close panel" icon="ti-x" variant="ghost" onClick={onClose} />}
        </div>
        <div className="ui-overlay-body">{children}</div>
        {footer && <div className="ui-overlay-footer">{footer}</div>}
      </aside>
    </div>
  );
}

export function ConfirmActions({ cancelLabel = "Cancel", confirmLabel = "Confirm", loading, onCancel, onConfirm, tone = "danger" }) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
      <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
        {confirmLabel}
      </Button>
    </>
  );
}
