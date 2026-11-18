import { Button as HsrButton, Input as HsrInput, Select as HsrSelect, EmptyState, SkeletonBlock } from "../../components/ui/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { addFood, getMenu } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useToast } from "../../components/toastContext.js";

function readableItem(value) {
  const price = typeof value === "number" ? value : value?.price;
  return price != null && price !== "" && Number.isFinite(Number(price)) && Number(price) >= 0 && (typeof value === "number" || typeof value?.available === "boolean");
}

export default function ProductSelector({ tableId, sessionKey, players = [], onAdded, onOptimistic, onSavingChange }) {
  const { showToast } = useToast();
  const [menu, setMenu] = useState({});
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [qty, setQty] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");

  async function loadMenu() {
    setLoading(true);
    setError("");
    try {
      const res = await getMenu();
      if (!res.data || typeof res.data !== "object" || Array.isArray(res.data)) throw new Error("Menu data is unavailable.");
      setMenu(Object.fromEntries(Object.entries(res.data).filter(([, value]) => readableItem(value))));
      if (Object.values(res.data).some(value => !readableItem(value))) setError("Some menu details are unavailable. Reload before ordering those items.");
    } catch (err) {
      setError(err.userMessage || "Unable to load menu items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMenu();
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(menu)
      .map(([name, value]) => ({
        name,
        price: typeof value === "number" ? value : Number(value.price),
        category: value.category || "Snacks",
        available: typeof value === "number" || value.available === true,
      }))
      .filter((item) => item.available)
      .filter((item) => !q || `${item.name} ${item.category}`.toLowerCase().includes(q));
  }, [menu, query]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending.current) return;
    if (!selectedItem) {
      showToast("Select an item first.", "error");
      return;
    }
    setSaving(true);
    setError("");
    onSavingChange?.(true);
    pending.current = true;
    const optimisticRow = { id: crypto.randomUUID(), item: selectedItem.name, qty, price: selectedItem.price * qty, unit_price: selectedItem.price, served: false, pending: true, player_name: playerName };
    const undo = onOptimistic?.(tableId, sessionKey, optimisticRow.id, rows => [...rows, optimisticRow]);
    try {
      const response = await addFood(tableId, selectedItem.name, qty, null, playerName, sessionKey);
      showToast(`${selectedItem.name} added to ${String(tableId).toUpperCase()}`, "success");
      await onAdded?.(response.data);
      setSelectedItem(null);
      setQty(1);
      setPlayerName("");
    } catch (err) {
      const message = err.userMessage || "Could not add food to session.";
      setError(message);
      showToast(message, "error");
    } finally {
      undo?.();
      setSaving(false);
      onSavingChange?.(false);
      pending.current = false;
    }
  }

  return (
    <div className="order-selector">
      {loading && <SkeletonBlock rows={4} label="Loading menu" />}
      {error && <RetryNotice message="Order could not complete" detail={error} onRetry={loadMenu} />}

      {!loading && (
        <>
          <label className="lf-field">
            <span>Search menu</span>
            <HsrInput disabled={saving} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Fries, tea, cigarettes..." />
          </label>

          <div className="order-item-grid">
            {items.slice(0, 24).map((item) => (
              <HsrButton native
                type="button"
                key={item.name}
                className={`order-item ${selectedItem?.name === item.name ? "is-selected" : ""}`}
                onClick={() => setSelectedItem(item)}
                title={item.name}
                disabled={saving}
              >
                <strong>{item.name}</strong>
                <span>₹{item.price.toLocaleString("en-IN")} · {item.category}</span>
              </HsrButton>
            ))}
          </div>
          {!items.length && !error && <EmptyState icon="ti-package" title="No available items" description="Reload stock availability before adding an order." secondaryAction={false} action={<HsrButton icon="ti-refresh" onClick={loadMenu}>Refresh menu</HsrButton>} />}

          <form className="order-add-row" onSubmit={handleSubmit}>
            <label className="lf-field">
              <span>Quantity</span>
              <HsrInput disabled={saving} type="number" min="1" value={qty} onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            {!!players.length && (
              <label className="lf-field">
                <span>Attach to player</span>
                <HsrSelect disabled={saving} value={playerName} onChange={(event) => setPlayerName(event.target.value)}>
                  <option value="">Session tab</option>
                  {players.map((player) => (
                    <option key={player} value={player}>{player}</option>
                  ))}
                </HsrSelect>
              </label>
            )}
            <HsrButton native type="submit" className="lf-primary-button" loading={saving} disabled={!selectedItem || !Object.hasOwn(menu, selectedItem.name)}>
              {saving ? "Adding..." : "Add Food to Session"}
            </HsrButton>
          </form>
        </>
      )}
    </div>
  );
}
