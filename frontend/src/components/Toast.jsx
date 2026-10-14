import { Icon as HsrIcon, Button as HsrButton } from "./ui/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastContext } from "./toastContext.js";

const TOAST_ICONS = {
  success: "ti-circle-check-filled",
  error: "ti-alert-circle-filled",
};

function ToastStack({ toasts, className = "", onAction, onSecondaryAction }) {
  return <div className={`app-toast-container ${className}`} aria-live="polite">
    {toasts.map(t => <div key={t.id} className={`app-toast app-toast-${t.type} ${t.exiting ? "is-exiting" : ""}`}>
      <HsrIcon className={`app-toast-icon ti ${TOAST_ICONS[t.type] || "ti-info-circle-filled"}`} aria-hidden="true" />
      <span className="app-toast-message">{t.message}</span>
      {t.actionLabel && <HsrButton native type="button" className="app-toast-action" onClick={() => onAction(t)}>{t.actionLabel}</HsrButton>}
      {t.secondaryActionLabel && <HsrButton native type="button" className="app-toast-action" onClick={() => onSecondaryAction(t)}>{t.secondaryActionLabel}</HsrButton>}
    </div>)}
  </div>;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  useEffect(() => {
    const activeTimers = timers.current;
    return () => { for (const timer of activeTimers.values()) { clearTimeout(timer.exitTimer); clearTimeout(timer.removeTimer); } activeTimers.clear(); };
  }, []);

  const removeToast = useCallback((id, delay = 120) => {
    const timerSet = timers.current.get(id);
    if (timerSet) {
      clearTimeout(timerSet.exitTimer);
      clearTimeout(timerSet.removeTimer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      timers.current.delete(id);
    }, delay);
    timers.current.set(id, { removeTimer });
  }, []);

  const showToast = useCallback((message, type = "success", options = {}) => {
    const id = Date.now() + Math.random();
    const duration = options.duration === null ? null : options.duration ?? (type === "error" ? 5000 : 3000);
    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        secondaryActionLabel: options.secondaryActionLabel,
        onSecondaryAction: options.onSecondaryAction,
        exiting: false,
      },
    ]);
    const exitTimer = duration === null ? null : setTimeout(() => removeToast(id), duration);
    timers.current.set(id, { exitTimer });
    return id;
  }, [removeToast]);

  useEffect(() => {
    const failed = event => showToast(event.detail, "error");
    window.addEventListener("hsr:action-failed", failed);
    return () => window.removeEventListener("hsr:action-failed", failed);
  }, [showToast]);
  const context = useMemo(() => ({ showToast, dismissToast: removeToast }), [showToast, removeToast]);

  const handleAction = useCallback(async (toast) => {
    removeToast(toast.id, 120);
    await toast.onAction?.();
  }, [removeToast]);

  return (
    <ToastContext.Provider value={context}>
      {children}
      <ToastStack toasts={toasts.filter(t => t.type !== "warning")} onAction={handleAction} onSecondaryAction={t => { removeToast(t.id, 120); t.onSecondaryAction?.(); }} />
      <ToastStack className="app-session-alert-container" toasts={toasts.filter(t => t.type === "warning")} onAction={handleAction} onSecondaryAction={t => { removeToast(t.id, 120); t.onSecondaryAction?.(); }} />
    </ToastContext.Provider>
  );
}
