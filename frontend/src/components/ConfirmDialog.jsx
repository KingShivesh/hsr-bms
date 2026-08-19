import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmContext } from "./confirmContext.js";

const DEFAULT_CONFIRM = {
  title: "Confirm action",
  message: "Are you sure you want to continue?",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  tone: "danger",
};

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const openerRef = useRef(null);

  const requestConfirm = useCallback((options = {}) => (
    new Promise((resolve) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDialog({
        ...DEFAULT_CONFIRM,
        ...(typeof options === "string" ? { message: options } : options),
        resolve,
      });
    })
  ), []);

  const closeDialog = useCallback((result) => {
    setDialog((current) => {
      current?.resolve?.(result);
      return null;
    });
    window.setTimeout(() => openerRef.current?.focus?.(), 0);
  }, []);

  const value = useMemo(() => ({ requestConfirm }), [requestConfirm]);

  useEffect(() => {
    if (!dialog) return;
    window.requestAnimationFrame(() => cancelRef.current?.focus());
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, closeDialog]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="app-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog(false);
          }}
        >
          <div
            ref={dialogRef}
            className={`app-confirm-dialog ${dialog.tone || "danger"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-confirm-title"
            aria-describedby="app-confirm-message"
          >
            <div className="app-confirm-icon" aria-hidden="true">
              <i className={`ti ${dialog.tone === "warning" ? "ti-alert-triangle" : "ti-trash"}`} />
            </div>
            <div className="app-confirm-copy">
              <h3 id="app-confirm-title">{dialog.title}</h3>
              <p id="app-confirm-message">{dialog.message}</p>
            </div>
            <div className="app-confirm-actions">
              <button
                ref={cancelRef}
                type="button"
                className="btn"
                onClick={() => closeDialog(false)}
              >
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn ${dialog.tone === "danger" ? "btn-danger-sm" : "btn-primary-sm"}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
