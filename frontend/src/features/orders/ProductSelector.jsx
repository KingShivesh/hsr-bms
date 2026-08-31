import { useEffect, useMemo, useState } from "react";
import { addFood, getMenu } from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useToast } from "../../components/toastContext.js";

function itemPrice(value) {
  return typeof value === "object" ? Number(value.price || 0) : Number(value || 0);
}

function itemCategory(value) {
  return typeof value === "object" ? value.category || "Snacks" : "Snacks";
}

function itemAvailable(value) {
  return typeof value === "object" ? value.available !== false : true;
}

export default function ProductSelector({ tableId, players = [], onAdded, onClose }) {
  const { showToast } = useToast();
  const [menu, setMenu] = useState({});
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [qty, setQty] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadMenu() {
    setLoading(true);
    setError("");
    try {
      const res = await getMenu();
      setMenu(res.data || {});
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
        price: itemPrice(value),
        category: itemCategory(value),
        available: itemAvailable(value),
      }))
      .filter((item) => item.available)
      .filter((item) => !q || `${item.name} ${item.category}`.toLowerCase().includes(q));
  }, [menu, query]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedItem) {
      showToast("Select an item first.", "error");
      return;
    }
    setSaving(true);
    try {
      await addFood(tableId, selectedItem.name, qty, null, playerName);
      showToast(`${selectedItem.name} added to ${String(tableId).toUpperCase()}`, "success");
      onAdded?.();
      setSelectedItem(null);
      setQty(1);
      setPlayerName("");
    } catch (err) {
      showToast(err.userMessage || "Could not add food to session.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="order-selector">
      <div className="order-selector-head">
        <div>
          <span className="lf-eyebrow">Session order</span>
          <h3>Add food to {String(tableId || "").toUpperCase()}</h3>
        </div>
        <button type="button" className="lf-icon-button" onClick={onClose} aria-label="Close order selector">
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>

      {loading && (
        <div className="order-skeleton" role="status" aria-label="Loading menu">
          <span />
          <span />
          <span />
        </div>
      )}
      {error && <RetryNotice message="Unable to load menu" detail={error} onRetry={loadMenu} />}

      {!loading && !error && (
        <>
          <label className="lf-field">
            <span>Search menu</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Fries, tea, cigarettes..." />
          </label>

          <div className="order-item-grid">
            {items.slice(0, 24).map((item) => (
              <button
                type="button"
                key={item.name}
                className={`order-item ${selectedItem?.name === item.name ? "is-selected" : ""}`}
                onClick={() => setSelectedItem(item)}
                title={item.name}
              >
                <strong>{item.name}</strong>
                <span>₹{item.price.toLocaleString("en-IN")} · {item.category}</span>
              </button>
            ))}
          </div>

          <form className="order-add-row" onSubmit={handleSubmit}>
            <label className="lf-field">
              <span>Quantity</span>
              <input type="number" min="1" value={qty} onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            {!!players.length && (
              <label className="lf-field">
                <span>Attach to player</span>
                <select value={playerName} onChange={(event) => setPlayerName(event.target.value)}>
                  <option value="">Session tab</option>
                  {players.map((player) => (
                    <option key={player} value={player}>{player}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className="lf-primary-button" disabled={saving || !selectedItem}>
              {saving ? "Adding..." : "Add Food to Session"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
