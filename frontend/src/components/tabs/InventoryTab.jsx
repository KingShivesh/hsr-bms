import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addInventoryItem,
  adjustInventoryItem,
  deleteInventoryItem,
  getInventory,
  getInventorySummary,
  updateInventoryItem,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";

const EMPTY_ITEM = {
  name: "",
  category: "Equipment",
  quantity: 0,
  unit: "pcs",
  min_alert_threshold: 0,
  supplier: "",
  unit_cost: 0,
  notes: "",
};

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function InventoryTab() {
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [loading, setLoading] = useState(true);

  const fetchInventory = useCallback(async () => {
    try {
      const [itemsRes, summaryRes] = await Promise.all([
        getInventory(),
        getInventorySummary(),
      ]);
      setItems(itemsRes.data);
      setSummary(summaryRes.data);
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to load inventory", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  function startEdit(item = null) {
    setEditing(item);
    setForm(item ? { ...item } : EMPTY_ITEM);
    setFormOpen(true);
  }

  async function saveItem(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      showToast("Enter item name", "error");
      return;
    }
    try {
      const payload = {
        ...form,
        quantity: parseInt(form.quantity, 10) || 0,
        min_alert_threshold: parseInt(form.min_alert_threshold, 10) || 0,
        unit_cost: parseInt(form.unit_cost, 10) || 0,
      };
      if (editing?.id) {
        await updateInventoryItem(editing.id, payload);
        showToast("Inventory item updated", "success");
      } else {
        await addInventoryItem(payload);
        showToast("Inventory item added", "success");
      }
      closeForm();
      fetchInventory();
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to save inventory item", "error");
    }
  }

  function closeForm() {
    setEditing(null);
    setForm(EMPTY_ITEM);
    setFormOpen(false);
  }

  async function adjust(item, delta) {
    try {
      await adjustInventoryItem(item.id, delta, delta > 0 ? "Restocked" : "Used");
      fetchInventory();
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to adjust stock", "error");
    }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      await deleteInventoryItem(item.id);
      showToast("Inventory item deleted", "success");
      fetchInventory();
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to delete item", "error");
    }
  }

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((item) => item.category || "Supplies")))],
    [items],
  );
  const filtered = items.filter((item) => {
    const text = `${item.name} ${item.supplier} ${item.category}`.toLowerCase();
    return (
      (category === "All" || item.category === category) &&
      text.includes(query.toLowerCase())
    );
  });

  if (loading) {
    return <div className="loading-state-title">Loading inventory...</div>;
  }

  return (
    <div className="ops-page">
      <div className="ops-hero">
        <div>
          <div className="quick-session-eyebrow">Stock control</div>
          <h2>Inventory</h2>
          <p>Track supplies, equipment, beverages, and low-stock alerts.</p>
        </div>
        <button type="button" className="btn btn-primary-sm" onClick={() => startEdit()}>
          <i className="ti ti-plus" aria-hidden="true" />
          Add item
        </button>
      </div>

      <div className="closing-metric-grid">
        <div className="closing-metric total"><span>Total items</span><strong>{summary?.total_items || 0}</strong></div>
        <div className="closing-metric warn"><span>Low stock</span><strong>{summary?.low_stock || 0}</strong></div>
        <div className="closing-metric cash"><span>Stock value</span><strong>{money(summary?.stock_value)}</strong></div>
      </div>

      <div className="inventory-toolbar">
        <input
          className="table-mini-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search item or supplier"
        />
        <select className="table-mini-input" value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div>

      {formOpen && (
        <form className="inventory-form history-section" onSubmit={saveItem}>
          <div className="section-heading">{editing?.id ? "Edit item" : "Add stock item"}</div>
          {["name", "category", "quantity", "unit", "min_alert_threshold", "supplier", "unit_cost"].map((field) => (
            <label className="table-field-stack" key={field}>
              <span>{field.replaceAll("_", " ")}</span>
              <input
                className="table-mini-input"
                type={["quantity", "min_alert_threshold", "unit_cost"].includes(field) ? "number" : "text"}
                min="0"
                value={form[field] ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))}
              />
            </label>
          ))}
          <label className="table-field-stack full">
            <span>Notes</span>
            <textarea
              className="table-notes-textarea"
              rows={2}
              value={form.notes || ""}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </label>
          <div className="inventory-form-actions">
            <button type="button" className="btn checkout-cancel-btn" onClick={closeForm}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary-sm">Save item</button>
          </div>
        </form>
      )}

      <div className="inventory-grid">
        {filtered.map((item) => (
          <div className={`inventory-card ${item.status !== "In Stock" ? "alert" : ""}`} key={item.id}>
            <div className="inventory-card-head">
              <div>
                <span>{item.category}</span>
                <strong>{item.name}</strong>
              </div>
              <em>{item.status}</em>
            </div>
            <div className="inventory-qty">
              <strong>{item.quantity}</strong>
              <span>{item.unit}</span>
            </div>
            <div className="inventory-meta">
              <span>Alert at {item.min_alert_threshold}</span>
              <span>{item.supplier || "No supplier"}</span>
              <span>{money(item.stock_value)}</span>
            </div>
            <div className="inventory-actions">
              <button type="button" onClick={() => adjust(item, -1)}>-1</button>
              <button type="button" onClick={() => adjust(item, 5)}>+5</button>
              <button type="button" onClick={() => startEdit(item)}>Edit</button>
              <button type="button" className="danger" onClick={() => remove(item)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
