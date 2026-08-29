import { useCallback, useRef, useState } from "react";
import { ToastContext } from "./toastContext.js";

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const removeToast = useCallback((id, delay = 190) => {
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
    const duration = options.duration ?? (type === "error" ? 5000 : 3000);
    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        exiting: false,
      },
    ]);
    const exitTimer = setTimeout(() => removeToast(id), duration);
    timers.current.set(id, { exitTimer });
    return id;
  }, [removeToast]);

  const handleAction = useCallback(async (toast) => {
    removeToast(toast.id, 120);
    await toast.onAction?.();
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="app-toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`app-toast app-toast-${t.type} ${t.exiting ? "is-exiting" : ""}`}>
            <span>{t.message}</span>
            {t.actionLabel && (
              <button type="button" className="app-toast-action" onClick={() => handleAction(t)}>
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
