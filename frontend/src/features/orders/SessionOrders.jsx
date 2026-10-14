import { useEffect, useRef, useState } from "react";
import { Button, Input, Alert } from "../../components/ui/index.js";
import { updateSessionFood, cancelSessionFood } from "../../api/index.js";
import { formatCurrency } from "../../utils/format.js";
import "./session-orders.css";

function OrderLine({ row, table, onChanged }) {
  const [quantity, setQuantity] = useState(row.qty);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => setQuantity(row.qty), [row.qty]);
  async function change(changes, cancel = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (cancel) await cancelSessionFood(table.id, row.id, table.session.session_key);
      else await updateSessionFood(table.id, row.id, table.session.session_key, changes);
      await onChanged(); setConfirmCancel(false);
    } catch (err) { setError(err.userMessage || "The order could not update."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="session-order-line" aria-label={row.item} aria-busy={busy}>
    <div className="session-order-line-head"><strong>{row.item}</strong><b>{formatCurrency(row.price)}</b></div>
    <p>{row.served ? "Served" : "Pending"}{row.player_name ? ` · ${row.player_name}` : ""}</p>
    {error && <Alert tone="danger">{error}</Alert>}
    <div className="session-order-edit">
      <label>Quantity<Input aria-label={`Quantity for ${row.item}`} type="number" min={1} max={100} step={1} value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)} /></label>
      <Button variant="secondary" loading={busy} disabled={Number(quantity) === row.qty || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 100} onClick={() => change({ quantity: Number(quantity) })}>Update</Button>
      <Button variant="secondary" disabled={busy || row.served} onClick={() => change({ served: true })}>{row.served ? "Served" : "Mark served"}</Button>
    </div>
    <div className="session-order-cancel">
      {confirmCancel ? <><span>Remove this item from the bill?</span><Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep item</Button><Button variant="danger" loading={busy} onClick={() => change({}, true)}>Confirm cancel</Button></> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel item</Button>}
    </div>
  </section>;
}

export default function SessionOrders({ table, onChanged, onAdd }) {
  const rows = table.session.food_items || [];
  return <div className="session-orders">
    <div className="session-order-line-head"><strong>Canteen total</strong><b>{formatCurrency(table.session.food_total)}</b></div>
    {!rows.length && <p className="lf-muted-copy">No canteen orders</p>}
    {rows.map(row => <OrderLine key={row.id} row={row} table={table} onChanged={onChanged} />)}
    <Button onClick={onAdd} icon="ti-plus">Add item</Button>
  </div>;
}
