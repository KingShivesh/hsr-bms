import { Icon as HsrIcon, Button as HsrButton, IconButton } from "./ui/index.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { topDialog } from "./ui/useDialogFocus.js";
import { ToastContext } from "./toastContext.js";

const TOAST_ICONS = {
  success: "ti-circle-check-filled",
  error: "ti-alert-circle-filled",
};

function ToastStack({ toasts, stackRef, className = "", onAction, onSecondaryAction, onDismiss, onPause, onResume }) {
  return <div ref={stackRef} className={`app-toast-container ${className}`} aria-live="polite">
    {toasts.map(t => <div key={t.id} className={`app-toast app-toast-${t.type} ${t.exiting ? "is-exiting" : ""}`}
      onPointerEnter={() => onPause(t.id, "pointer")} onPointerLeave={() => onResume(t.id, "pointer")}
      onFocus={() => onPause(t.id, "focus")} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onResume(t.id, "focus"); }}>
      <HsrIcon className={`app-toast-icon ti ${TOAST_ICONS[t.type] || "ti-info-circle-filled"}`} aria-hidden="true" />
      <span className="app-toast-message">{t.message}</span>
      {t.actionLabel && <HsrButton native type="button" className="app-toast-action" onClick={() => onAction(t)}>{t.actionLabel}</HsrButton>}
      {t.secondaryActionLabel && <HsrButton native type="button" className="app-toast-action" onClick={() => onSecondaryAction(t)}>{t.secondaryActionLabel}</HsrButton>}
      {t.type !== "warning" && <IconButton label="Dismiss notification" icon="ti-x" className="app-toast-close" onClick={() => onDismiss(t.id)} />}
    </div>)}
  </div>;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const feedbackRef = useRef(null);
  const warningRef = useRef(null);
  const [dialogHost, setDialogHost] = useState(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const properties = ["--toast-feedback-offset", "--toast-page-clearance"];
    const previous = properties.map(name => [name, root.style.getPropertyValue(name)]);
    const occupiedHeight = node => node?.children.length ? Math.max(0, window.innerHeight - node.getBoundingClientRect().top) : 0;
    function measure() {
      const gap = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-2")) || 0;
      const warning = occupiedHeight(warningRef.current);
      root.style.setProperty("--toast-feedback-offset", `${warning ? Math.ceil(warning + gap) : 0}px`);
      const covered = Math.max(warning, dialogHost ? 0 : occupiedHeight(feedbackRef.current));
      root.style.setProperty("--toast-page-clearance", `${covered ? Math.ceil(covered + gap) : 0}px`);
    }
    // Only the occupied area is reserved; clearing the last toast removes it.
    const observer = new ResizeObserver(measure);
    for (const node of [feedbackRef.current, warningRef.current]) if (node) observer.observe(node);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      for (const [name, value] of previous) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
    };
  }, [dialogHost, toasts.length]);
  useEffect(() => {
    const observer = new MutationObserver(() => setDialogHost(topDialog() || null));
    observer.observe(document.body, { childList: true, subtree: true });
    setDialogHost(topDialog() || null);
    return () => observer.disconnect();
  }, []);
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
    const duration = options.duration === null ? null : options.duration ?? (type === "error" ? null : type === "success" ? 4000 : 6000);
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
    timers.current.set(id, { exitTimer, remaining: duration, started: Date.now(), paused: new Set() });
    return id;
  }, [removeToast]);

  const pauseToast = useCallback((id, reason) => {
    const timer = timers.current.get(id);
    if (!timer || timer.remaining == null || timer.removeTimer) return;
    if (!timer.paused.size) {
      clearTimeout(timer.exitTimer);
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
    }
    timer.paused.add(reason);
  }, []);
  const resumeToast = useCallback((id, reason) => {
    const timer = timers.current.get(id);
    if (!timer?.paused?.delete(reason) || timer.paused.size || timer.removeTimer) return;
    timer.started = Date.now();
    timer.exitTimer = setTimeout(() => removeToast(id), timer.remaining);
  }, [removeToast]);

  useEffect(() => {
    for (const [id, timer] of timers.current) {
      for (const reason of [...(timer.paused || [])]) resumeToast(id, reason);
    }
  }, [dialogHost, resumeToast]);

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

  const feedback = <ToastStack stackRef={feedbackRef} className={dialogHost ? "app-dialog-feedback" : ""} toasts={toasts.filter(t => t.type !== "warning")} onAction={handleAction} onSecondaryAction={t => { removeToast(t.id, 120); t.onSecondaryAction?.(); }} onDismiss={removeToast} onPause={pauseToast} onResume={resumeToast} />;
  return (
    <ToastContext.Provider value={context}>
      {children}
      {dialogHost ? createPortal(feedback, dialogHost) : feedback}
      <ToastStack stackRef={warningRef} className="app-session-alert-container" toasts={toasts.filter(t => t.type === "warning")} onAction={handleAction} onSecondaryAction={t => { removeToast(t.id, 120); t.onSecondaryAction?.(); }} onDismiss={removeToast} onPause={pauseToast} onResume={resumeToast} />
    </ToastContext.Provider>
  );
}
