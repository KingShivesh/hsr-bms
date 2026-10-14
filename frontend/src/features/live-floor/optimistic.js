export function changeFood(table, update) {
  if (!table.session) return table;
  const items = update(table.session.food_items || []);
  const total = items.reduce((sum, row) => sum + Number(row.price || 0), 0);
  const delta = total - Number(table.session.food_total || 0);
  return { ...table, pending_label: "Order syncing…", session: { ...table.session, food_items: items, food_total: total,
    // Financial totals remain authoritative; pending food is labelled until reconciliation.
    pending_food_delta: delta } };
}
export function pauseTable(table, paused, elapsed, tick) {
  return { ...table, status_key: paused ? "paused" : "running", status_label: paused ? "Paused" : "Running", elapsed_seconds: elapsed, pending_label: paused ? "Pausing…" : "Resuming…",
    session: { ...table.session, paused, elapsed_seconds: paused ? elapsed : elapsed - tick } };
}
