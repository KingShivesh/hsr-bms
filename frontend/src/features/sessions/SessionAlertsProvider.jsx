import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acknowledgeSessionAlert, getSessionAlerts, acknowledgeWeeklySummary } from "../../api/index.js";
import { useToast } from "../../components/toastContext.js";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import { SessionAlertsContext } from "./alertsContext.js";
import { formatCurrency } from "../../utils/format.js";
import "./start-session.css";

function readSeenAlerts() {
  try {
    const ids = JSON.parse(sessionStorage.getItem(`hsr:seen-alerts:${localStorage.getItem("username")}`) || "[]");
    return new Set(Array.isArray(ids) ? ids.filter(Number.isInteger) : []);
  } catch { return new Set(); }
}

export default function SessionAlertsProvider({ children, onNavigate }) {
  const { showToast, dismissToast } = useToast();
  const [alerts, setAlerts] = useState([]);
  const [urgentKeys, setUrgentKeys] = useState(new Set());
  const [ownerSummaries, setOwnerSummaries] = useState([]);
  const seen = useRef(readSeenAlerts());
  const toastIds = useRef(new Map());
  const audio = useRef(null);
  const version = useRef(0);
  const refreshTimer = useRef(null);
  const pulseTimer = useRef(null);
  const config = useRef({});
  const navigate = useRef(onNavigate);
  const pendingAcks = useRef(new Set());
  const alertsRef = useRef([]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  useEffect(() => { navigate.current = onNavigate; }, [onNavigate]);

  const acknowledge = useCallback(async id => {
    if (pendingAcks.current.has(id)) return;
    pendingAcks.current.add(id);
    const previous = alertsRef.current.find(row => row.id === id);
    version.current += 1;
    setAlerts(current => current.filter(row => row.id !== id));
    dismissToast(toastIds.current.get(id));
    toastIds.current.delete(id);
    try {
      await acknowledgeSessionAlert(id);
      version.current += 1;
      setAlerts(current => current.filter(row => row.id !== id));
      dismissToast(toastIds.current.get(id));
      toastIds.current.delete(id);
    } catch (error) {
      version.current += 1;
      if (previous) setAlerts(current => current.some(row => row.id === id) ? current : [...current, previous]);
      showToast(error.userMessage || "Could not acknowledge reminder.", "error");
    } finally { pendingAcks.current.delete(id); }
  }, [dismissToast, showToast]);

  const load = useCallback(async () => {
    const request = ++version.current;
    try {
      const { data } = await getSessionAlerts();
      if (request !== version.current) return;
      config.current = data.config;
      const rows = (data.alerts || []).filter(row => !pendingAcks.current.has(row.id));
      setAlerts(current => JSON.stringify(current) === JSON.stringify(rows) ? current : rows);
      setOwnerSummaries(current => JSON.stringify(current) === JSON.stringify(data.owner_summaries || []) ? current : data.owner_summaries || []);
      const activeIds = new Set(rows.map(row => row.id));
      for (const [id, toastId] of toastIds.current) {
        if (!activeIds.has(id)) { dismissToast(toastId); toastIds.current.delete(id); }
      }
      const latest = new Map();
      for (const row of rows) if (!row.paused && (!seen.current.has(row.id) || (row.intensity === "urgent" && !toastIds.current.has(row.id)))) latest.set(row.session_key, row);
      for (const row of latest.values()) {
        const firstDelivery = !seen.current.has(row.id);
        for (const item of rows.filter(item => item.session_key === row.session_key)) seen.current.add(item.id);
        if (firstDelivery && data.config.soundEnabled && audio.current?.state === "running") {
          const oscillator = audio.current.createOscillator();
          const gain = audio.current.createGain();
          oscillator.frequency.value = row.intensity === "urgent" ? 660 : 440;
          gain.gain.setValueAtTime(row.intensity === "urgent" ? 0.12 : 0.04, audio.current.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + 0.4);
          oscillator.connect(gain); gain.connect(audio.current.destination);
          oscillator.start(); oscillator.stop(audio.current.currentTime + 0.4);
        }
        if (row.intensity === "subtle") continue;
        const id = showToast(`${row.table_id.toUpperCase()} — ${row.threshold_minutes} min played · ${formatCurrency(row.accrued_amount)} accrued${row.intensity === "urgent" ? " · Check table now" : ""}`, "warning", {
          duration: row.intensity === "urgent" ? null : 10000,
          actionLabel: "View", onAction: () => { navigate.current?.("live-floor", { tableId: row.table_id }); return acknowledge(row.id); },
          secondaryActionLabel: "Dismiss", onSecondaryAction: () => acknowledge(row.id),
        });
        toastIds.current.set(row.id, id);
        if (row.intensity === "urgent" && firstDelivery) {
          setUrgentKeys(current => new Set([...current, row.session_key]));
          window.clearTimeout(pulseTimer.current);
          pulseTimer.current = window.setTimeout(() => setUrgentKeys(new Set()), 5000);
        }
      }
      seen.current = new Set([...seen.current].filter(id => activeIds.has(id)));
      try { sessionStorage.setItem(`hsr:seen-alerts:${localStorage.getItem("username")}`, JSON.stringify([...seen.current])); } catch { /* Reminders still work without browser storage. */ }
    } catch {
      // A transient reminder read must never interrupt table operation.
    }
  }, [acknowledge, dismissToast, showToast]);
  const scheduleLoad = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(load, 150);
  }, [load]);
  const state = useRealtimeSubscription({ topics: ["floor"], onEvent: scheduleLoad });
  useEffect(() => {
    load();
    const timer = window.setInterval(load, state === "connected" ? 60000 : 15000);
    const changed = event => { if (!event.detail?.path || /sessions|settings\/session-controls/.test(event.detail.path)) scheduleLoad(); };
    window.addEventListener("hsr:data-changed", changed);
    return () => { version.current += 1; window.clearInterval(timer); window.removeEventListener("hsr:data-changed", changed); window.clearTimeout(refreshTimer.current); };
  }, [load, scheduleLoad, state]);
  useEffect(() => {
    function enableSound() {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio.current ||= new Context();
      audio.current.resume().catch(() => {});
    }
    window.addEventListener("pointerdown", enableSound);
    window.addEventListener("keydown", enableSound);
    return () => { window.removeEventListener("pointerdown", enableSound); window.removeEventListener("keydown", enableSound); audio.current?.close(); window.clearTimeout(pulseTimer.current); };
  }, []);
  const acknowledgeSummary = useCallback(async (week) => {
    try { await acknowledgeWeeklySummary(week); setOwnerSummaries(current => current.filter(row => row.week_start !== week)); }
    catch (error) { showToast(error.userMessage || "Could not acknowledge summary.", "error"); }
  }, [showToast]);
  const context = useMemo(() => ({ alerts, acknowledge, urgentKeys, ownerSummaries, acknowledgeSummary }), [alerts, acknowledge, urgentKeys, ownerSummaries, acknowledgeSummary]);
  return <SessionAlertsContext.Provider value={context}>{children}</SessionAlertsContext.Provider>;
}
