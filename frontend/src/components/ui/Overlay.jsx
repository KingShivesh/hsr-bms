import Button, { IconButton } from "./Button.jsx";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { useEscapeKey } from "./useEscapeKey.js";
import { useDialogFocus } from "./useDialogFocus.js";

function usePresence(open) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), 120);
    return () => clearTimeout(timer);
  }, [open]);
  return open || present;
}

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
  dismissOnBackdrop = true,
  closeDisabled = false,
  initialFocusRef,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const present = usePresence(open);
  useDialogFocus(dialogRef, open, initialFocusRef);
  useEscapeKey(closeDisabled ? undefined : onClose, open, dialogRef);

  if (!present) return null;

  const content = (
    <div
      className="ui-overlay"
      data-exiting={!open || undefined}
      aria-hidden={!open || undefined}
      inert={!open ? true : undefined}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissOnBackdrop && !closeDisabled && onClose) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={["ui-modal", `ui-modal-${size}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
      >
        <div className="ui-overlay-head">
          <div>
            {title && <h2 id={titleId} title={title}>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {onClose && <IconButton label="Close dialog" icon="ti-x" variant="ghost" disabled={closeDisabled} onClick={onClose} />}
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
  const titleId = useId();
  const dialogRef = useRef(null);
  const present = usePresence(open);
  useDialogFocus(dialogRef, open);
  useEscapeKey(onClose, open, dialogRef);

  if (!present) return null;

  const content = (
    <div
      className="ui-overlay"
      data-exiting={!open || undefined}
      aria-hidden={!open || undefined}
      inert={!open ? true : undefined}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className={["ui-drawer", `ui-drawer-${side}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
      >
        <div className="ui-overlay-head">
          <div>
            {title && <h2 id={titleId} title={title}>{title}</h2>}
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
