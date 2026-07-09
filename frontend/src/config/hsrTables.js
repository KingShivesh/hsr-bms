export const VENUE_NAME = "HSR Snooker Cafe";
export const APP_NAME = "HSR Snooker Cafe BMS";
export const CSV_PREFIX = "hsr_snooker_cafe";

export const HSR_TABLES = [
  { id: "t1", type: "SNOOKER", label: "Wiraka", num: 1, rateKey: "wr", defaultRate: 320 },
  { id: "t2", type: "SNOOKER", label: "Wiraka", num: 2, rateKey: "wr", defaultRate: 320 },
  { id: "t3", type: "SNOOKER", label: "English", num: 3, rateKey: "sr", defaultRate: 270 },
  { id: "t4", type: "SNOOKER", label: "English", num: 4, rateKey: "sr", defaultRate: 270 },
  { id: "t5", type: "POOL", label: "Pool", num: 5, rateKey: "pr", defaultRate: 170 },
];

export const TOTAL_TABLES = HSR_TABLES.length;
export const TABLE_RANGE = `T${HSR_TABLES[0].num}-T${HSR_TABLES[HSR_TABLES.length - 1].num}`;

export function getTableRate(table, fallbackRates = {}) {
  if (!table) return 0;
  if (table.rateKey && fallbackRates[table.rateKey] != null) {
    return fallbackRates[table.rateKey];
  }
  if (table.defaultRate) return table.defaultRate;
  return table.type === "POOL" ? fallbackRates.pr : fallbackRates.sr;
}

export function getTableLabel(table) {
  return table?.label || table?.type || "";
}
