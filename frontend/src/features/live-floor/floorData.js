import { TABLE_STATUS } from "../../config/tableStatus.js";

export function readableFloorSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.tables)) throw new Error("Table status is incomplete. Reload the floor to try again.");
  return {
    ...snapshot,
    tables: snapshot.tables.filter(table => table && table.id != null).map(table => {
      if (!Object.hasOwn(TABLE_STATUS, table.status_key)) throw new Error("Table availability is incomplete. Reload the floor to try again.");
      if (!table.session) return table;
      return { ...table, session: { ...table.session, food_items: Array.isArray(table.session.food_items) ? table.session.food_items.filter(item => item && typeof item === "object") : [] } };
    }),
  };
}
