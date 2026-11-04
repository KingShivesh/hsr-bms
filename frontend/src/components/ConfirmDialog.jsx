import { Icon as HsrIcon, Modal } from "./ui/index.js";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ConfirmContext } from "./confirmContext.js";
import Button from "./ui/Button.jsx";

const DEFAULT_CONFIRM = {
  title: "Review action",
  message: "Review the details before confirming this action.",
  confirmLabel: "Confirm Action",
  cancelLabel: "Cancel",
  tone: "danger",
};

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const cancelRef = useRef(null);
  const resolver = useRef(null);
  const messageId = useId();

  const requestConfirm = useCallback((options = {}) => (
    new Promise((resolve) => {
      resolver.current = resolve;
      setDialog({
        ...DEFAULT_CONFIRM,
        ...(typeof options === "string" ? { message: options } : options),
      });
    })
  ), []);

  const closeDialog = useCallback((result) => {
    const resolve = resolver.current;
    resolver.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  const value = useMemo(() => ({ requestConfirm }), [requestConfirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <Modal open portal size="sm" title={dialog.title}
          className={`ui-confirm ${dialog.tone || "danger"}`}
          overlayClassName="ui-confirm-overlay"
          initialFocusRef={cancelRef}
          onClose={() => closeDialog(false)}
          aria-describedby={messageId}
          footer={<>
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
          </>}
        >
          <div className="ui-confirm-message">
            <span className="ui-confirm-icon" aria-hidden="true">
              <HsrIcon className={`ti ${dialog.tone === "warning" ? "ti-alert-triangle" : "ti-trash"}`} />
            </span>
            <p id={messageId}>{dialog.message}</p>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
