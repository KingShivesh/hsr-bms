const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const historicalDateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

export const formatCurrency = value => currency.format(Number(value) || 0);
export const formatCount = value => count.format(Number(value) || 0);
export function formatDuration(seconds = 0) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60];
  return (parts[0] ? parts : parts.slice(1)).map(part => String(part).padStart(2, "0")).join(":");
}
export function formatDateTime(value, { includeYear = false } = {}) {
  if (value === null || value === undefined || value === "") return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return (includeYear ? historicalDateTime : dateTime).format(date).replace(/\bam\b/, "AM").replace(/\bpm\b/, "PM");
}
