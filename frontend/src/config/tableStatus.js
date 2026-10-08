export const TABLE_STATUS = {
  available: {
    key: "available",
    label: "Available",
    icon: "ti-check",
    tone: "idle",
    className: "available",
    colorVar: "var(--text-muted)",
    borderStyle: "solid",
    tint: "neutral",
    dotStyle: "hollow",
    timerStyle: "rate",
    primaryAction: { label: "Start Table", icon: "ti-player-play", disabled: false },
  },
  running: {
    key: "running",
    label: "Running",
    icon: "ti-player-play",
    tone: "running",
    className: "running",
    colorVar: "var(--success)",
    borderStyle: "accent",
    tint: "accent",
    dotStyle: "pulse",
    timerStyle: "elapsed",
    primaryAction: { label: "Checkout / Close", icon: "ti-receipt", disabled: false },
  },
  paused: {
    key: "paused",
    label: "Paused",
    icon: "ti-player-pause",
    tone: "paused",
    className: "paused",
    colorVar: "var(--warning)",
    borderStyle: "warning",
    tint: "warning",
    dotStyle: "filled",
    timerStyle: "frozen",
    primaryAction: { label: "Checkout / Close", icon: "ti-receipt", disabled: false },
  },
  reserved: {
    key: "reserved",
    label: "Reserved",
    icon: "ti-clock",
    tone: "booked",
    className: "reserved",
    colorVar: "var(--warning)",
    borderStyle: "dashed",
    tint: "neutral",
    dotStyle: "filled",
    timerStyle: "booking",
    primaryAction: { label: "Review Booking", icon: "ti-calendar-event", disabled: false },
  },
  maintenance: {
    key: "maintenance",
    label: "Maintenance",
    icon: "ti-tool",
    tone: "maintenance",
    className: "maintenance",
    colorVar: "var(--danger)",
    borderStyle: "muted",
    tint: "hatched",
    dotStyle: "muted",
    timerStyle: "none",
    primaryAction: { label: "Unavailable", icon: "ti-lock", disabled: true },
  },
};

export const TABLE_ATTENTION = {
  overdue: { key: "overdue", label: "Overdue", icon: "ti-alert-triangle" },
  frame: { key: "frame", label: "Frame open", icon: "ti-flag" },
};

export function getTableStatus({ session, booking, maintenance } = {}) {
  const backendKey = session?.status_key || booking?.status_key || maintenance?.status_key;
  if (backendKey && TABLE_STATUS[backendKey]) return TABLE_STATUS[backendKey];
  if (maintenance) return TABLE_STATUS.maintenance;
  if (session?.paused) return TABLE_STATUS.paused;
  if (session) return TABLE_STATUS.running;
  if (booking) return TABLE_STATUS.reserved;
  return TABLE_STATUS.available;
}

export function getTableStatusByKey(key = "available") {
  return TABLE_STATUS[key] || TABLE_STATUS.available;
}

export function tableStateAttributes(key = "available") {
  const status = getTableStatusByKey(key);
  return {
    "data-table-state": status.key,
    "data-border": status.borderStyle,
    "data-tint": status.tint,
    "data-tone": status.tone,
  };
}

export function tableActionNavigation(tableId, statusKey) {
  if (statusKey === "reserved") return ["reservations"];
  return ["live-floor", {
    tableId,
    tableAction: statusKey === "available" ? "start" : ["running", "paused"].includes(statusKey) ? "checkout" : "overview",
  }];
}

export function getTableAttention({ session, elapsedSeconds = 0 } = {}) {
  if (session?.current_frame || session?.frames?.some((frame) => frame.status === "open")) {
    return TABLE_ATTENTION.frame;
  }
  if (session?.leakage_alert || Number(elapsedSeconds || session?.elapsed_seconds || 0) >= 90 * 60) {
    return TABLE_ATTENTION.overdue;
  }
  return null;
}
