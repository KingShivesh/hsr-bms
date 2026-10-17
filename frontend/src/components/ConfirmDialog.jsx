import { Icon as HsrIcon } from "./ui/index.js";
import { useCallback, useMemo, useRef, useState } from "react";
import { ConfirmContext } from "./confirmContext.js";
import Button from "./ui/Button.jsx";
import { useDialogFocus } from "./ui/useDialogFocus.js";
import { useEscapeKey } from "./ui/useEscapeKey.js";

const DEFAULT_CONFIRM = {
  title: "Review action",
  message: "Review the details before confirming this action.",
  confirmLabel: "Confirm Action",
  cancelLabel: "Cancel",
  tone: "danger",
};

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  useDialogFocus(dialogRef, !!dialog, cancelRef);

  const requestConfirm = useCallback((options = {}) => (
    new Promise((resolve) => {
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
  }, []);

  const value = useMemo(() => ({ requestConfirm }), [requestConfirm]);

  useEscapeKey(() => closeDialog(false), !!dialog, dialogRef);

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
            tabIndex={-1}
            aria-labelledby="app-confirm-title"
            aria-describedby="app-confirm-message"
          >
            <div className="app-confirm-icon" aria-hidden="true">
              <HsrIcon className={`ti ${dialog.tone === "warning" ? "ti-alert-triangle" : "ti-trash"}`} />
            </div>
            <div className="app-confirm-copy">
              <h3 id="app-confirm-title">{dialog.title}</h3>
              <p id="app-confirm-message">{dialog.message}</p>
            </div>
            <div className="app-confirm-actions">
              <Button
                ref={cancelRef}
                variant="secondary"
                onClick={() => closeDialog(false)}
              >
                {dialog.cancelLabel}
              </Button>
              <Button
                variant={dialog.tone === "danger" ? "danger" : "primary"}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
