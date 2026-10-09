export function tableRateGroup(tableId) {
  return ({ t1: "wr", t2: "wr", t3: "sr", t4: "sr", t5: "pr" })[String(tableId || "").toLowerCase()];
}

export function tariffDescription(session) {
  if (session?.tariff_mode === "frame") return `${session.frame_count || 0} frames x ₹${session.tariff_price || 0}`;
  if (session?.tariff_mode === "package") return `${session.tariff_label || "Package"} · ₹${session.tariff_price || 0} fixed`;
  return "Hourly";
}
