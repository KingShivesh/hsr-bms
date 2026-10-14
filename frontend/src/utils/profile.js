// Opt-in local React Profiler evidence; no collection in production.
export function recordProfile(id, phase, actualDuration, baseDuration, startTime, commitTime) {
  if (!import.meta.env.DEV || sessionStorage.getItem("hsr:profile") !== "1") return;
  const rows = window.__hsrProfile ||= [];
  rows.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
  if (rows.length > 2000) rows.shift();
}
