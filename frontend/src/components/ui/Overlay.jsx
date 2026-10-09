import Button, { IconButton } from "./Button.jsx";
import { createPortal } from "react-dom";
import { useEscapeKey } from "./useEscapeKey.js";

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className = "",
  size = "md",
  portal = false,
}) {
  useEscapeKey(onClose, open);

  if (!open) return null;

  const content = (
    <div
      className="ui-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
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
  return portal ? createPortal(content, document.body) : content;
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
  portal = false,
}) {
  useEscapeKey(onClose, open);

  if (!open) return null;

  const content = (
    <div
      className="ui-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
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
  return portal ? createPortal(content, document.body) : content;
}

export function ConfirmActions({ cancelLabel = "Cancel", confirmLabel = "Confirm Action", loading, onCancel, onConfirm, tone = "danger" }) {
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
