import { useCallback, useEffect, useState } from "react";

const entries = new Map();
let identity = "";
function scopedEntries() {
  const next = `${localStorage.getItem("token") || ""}:${localStorage.getItem("role") || ""}`;
  if (next !== identity) { entries.clear(); identity = next; }
  return entries;
}
export function hasCachedState(key) {
  const row = scopedEntries().get(key);
  if (!row || row.value == null || Date.now() - row.at > 30000) return false;
  return true;
}
export function clearPageCache() { entries.clear(); }

// Data only: never persist credentials, form drafts, checkout quotes or receipts.
export function useCachedState(key, initial) {
  const scope = `${localStorage.getItem("token") || ""}:${localStorage.getItem("role") || ""}`;
  const [record, setRecord] = useState(() => ({ loaded: hasCachedState(key), value: hasCachedState(key) ? scopedEntries().get(key).value : typeof initial === "function" ? initial() : initial }));
  const { value, loaded } = record;
  const setValue = useCallback(next => setRecord(current => ({ loaded: true, value: typeof next === "function" ? next(current.value) : next })), []);
  useEffect(() => {
    if (!loaded) return;
    if (scope !== `${localStorage.getItem("token") || ""}:${localStorage.getItem("role") || ""}`) return;
    const cache = scopedEntries();
    cache.set(key, { value, at: Date.now() });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }, [key, scope, value, loaded]);
  return [value, setValue];
}
