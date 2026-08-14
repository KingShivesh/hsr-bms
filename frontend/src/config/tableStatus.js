export const TABLE_STATUS = {
  available: {
    key: "available",
    label: "Available",
    tone: "idle",
    className: "available",
    colorVar: "var(--text-muted)",
  },
  running: {
    key: "running",
    label: "Running",
    tone: "running",
    className: "running",
    colorVar: "var(--success)",
  },
  paused: {
    key: "paused",
    label: "Paused",
    tone: "paused",
    className: "paused",
    colorVar: "var(--warning)",
  },
  reserved: {
    key: "reserved",
    label: "Reserved",
    tone: "booked",
    className: "reserved",
    colorVar: "var(--warning)",
  },
  maintenance: {
    key: "maintenance",
    label: "Maintenance",
    tone: "maintenance",
    className: "maintenance",
    colorVar: "var(--danger)",
  },
};

export function getTableStatus({ session, booking, maintenance } = {}) {
  if (maintenance) return TABLE_STATUS.maintenance;
  if (session?.paused) return TABLE_STATUS.paused;
  if (session) return TABLE_STATUS.running;
  if (booking) return TABLE_STATUS.reserved;
  return TABLE_STATUS.available;
}
