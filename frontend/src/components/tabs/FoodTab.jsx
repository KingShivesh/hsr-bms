import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setItemAvailability,
  getTableState,
  addFood,
  placeFoodOrder,
  getFoodOrders,
  cancelFoodOrder,
  getFoodStats,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";

const CATEGORIES = [
  "All",
  "Veg Snacks",
  "Non Veg Snacks",
  "Egg",
  "Maggie",
  "Hot Beverages",
  "Cold Beverages",
  "Cigarettes",
];

const tableKey = (tableId) => String(tableId || "").trim().toLowerCase();

function EmptyState({ icon = "ti-info-circle", title, detail }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <i className={`ti ${icon}`} aria-hidden="true" />
      </div>
      <div className="empty-state-title">{title}</div>
      {detail && <div className="empty-state-detail">{detail}</div>}
    </div>
  );
}

export default function FoodTab() {
  const { showToast } = useToast();
  const [menu, setMenu] = useState({});
  const [stats, setStats] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [orderTarget, setOrderTarget] = useState("standalone");
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [activeTab, setActiveTab] = useState("order");
  const [activeCat, setActiveCat] = useState("All");
  const [placing, setPlacing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState(null);
  const busyActionRef = useRef("");
  const [lastOrder, setLastOrder] = useState(null);
  const [newItem, setNewItem] = useState({
    name: "",
    price: "",
    category: "Veg Snacks",
  });
  const [editingItem, setEditingItem] = useState(null);

  const fetchAll = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const requests = [
        getMenu(),
        getFoodStats(),
        getFoodOrders(),
        getTableState(),
      ];
      const labels = ["menu items", "food stats", "order history", "active tables"];
      const [menuRes, statsRes, ordersRes, activeRes] = await Promise.allSettled(requests);
      const failed = [menuRes, statsRes, ordersRes, activeRes]
        .map((result, index) => (result.status === "rejected" ? labels[index] : ""))
        .filter(Boolean);

      if (menuRes.status === "fulfilled") setMenu(menuRes.value.data || {});
      if (statsRes.status === "fulfilled") setStats(Array.isArray(statsRes.value.data) ? statsRes.value.data : []);
      if (ordersRes.status === "fulfilled") setOrders(Array.isArray(ordersRes.value.data) ? ordersRes.value.data : []);
      if (activeRes.status === "fulfilled") {
        const sessions = activeRes.value.data?.active_sessions || [];
        setActiveSessions((Array.isArray(sessions) ? sessions : []).map((session) => ({
          ...session,
          table_id: tableKey(session.table_id),
        })));
      }

      if (failed.length) {
        const message = `Could not load ${failed.join(", ")}. Retry once the backend responds.`;
        setLoadError(message);
        if (!showLoading) showToast(message, "error");
      }
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Food POS could not load. Check the backend connection and retry.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAll({ showLoading: true });
  }, [fetchAll]);

  function getItemPrice(v) {
    return typeof v === "object" ? v.price : v;
  }
  function getItemCat(v) {
    return typeof v === "object" ? v.category || "Snacks" : "Snacks";
  }
  function getItemAvail(v) {
    return typeof v === "object" ? v.available !== false : true;
  }
  function isCigarette(name) {
    return /cigarette|cigg/i.test(name);
  }
  function getCartUnitPrice(item) {
    if (isCigarette(item.item)) return (item.mrp || 0) + 3;
    return getItemPrice(menu[item.item]);
  }

  async function handleAddMenuItem(e) {
    e.preventDefault();
    const name = newItem.name.trim();
    const price = parseInt(newItem.price, 10);
    if (!name || !price || price <= 0) {
      showToast("Enter item name and valid price", "error");
      return;
    }
    if (busyActionRef.current) return;
    busyActionRef.current = "menu-add";
    setBusyAction("menu-add");
    try {
      await addMenuItem(name, price, newItem.category);
      setNewItem({ name: "", price: "", category: newItem.category });
      await fetchAll();
      showToast("Menu item added", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to add item", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  }

  async function handleUpdateMenuItem() {
    if (!editingItem) return;
    const name = editingItem.newName.trim();
    const price = parseInt(editingItem.price, 10);
    if (!name || !price || price <= 0) {
      showToast("Enter item name and valid price", "error");
      return;
    }
    if (busyActionRef.current) return;
    busyActionRef.current = `menu-edit-${editingItem.oldName}`;
    setBusyAction(`menu-edit-${editingItem.oldName}`);
    try {
      await updateMenuItem(
        editingItem.oldName,
        name,
        price,
        editingItem.category,
      );
      setEditingItem(null);
      await fetchAll();
      showToast("Menu item saved", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to update item", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  }

  async function handleDeleteMenuItem(name) {
    if (!confirm(`Delete ${name}?`)) return;
    if (busyActionRef.current) return;
    busyActionRef.current = `menu-delete-${name}`;
    setBusyAction(`menu-delete-${name}`);
    try {
      await deleteMenuItem(name);
      await fetchAll();
      showToast("Menu item deleted", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to delete item", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  }

  async function handleToggleAvailability(name, value) {
    if (busyActionRef.current) return;
    busyActionRef.current = `stock-${name}`;
    setBusyAction(`stock-${name}`);
    try {
      await setItemAvailability(name, value);
      await fetchAll();
      showToast(value ? "Item shown in stock" : "Item hidden from menu", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to update stock", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  }

  function addToCart(name) {
    const mrp = isCigarette(name)
      ? parseInt(prompt("Enter cigarette price:") || "0", 10)
      : null;
    if (isCigarette(name) && (!mrp || mrp <= 0)) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.item === name && i.mrp === mrp);
      if (existing)
        return prev.map((i) =>
          i.item === name && i.mrp === mrp ? { ...i, qty: i.qty + 1 } : i,
        );
      return [...prev, { item: name, qty: 1, mrp }];
    });
  }

  function removeFromCart(item) {
    setCart((prev) =>
      prev.filter((i) => !(i.item === item.item && i.mrp === item.mrp)),
    );
  }

  function updateCartQty(item, qtyValue) {
    const qty = Math.max(1, parseInt(qtyValue, 10) || 1);
    setCart((prev) =>
      prev.map((i) =>
        i.item === item.item && i.mrp === item.mrp ? { ...i, qty } : i,
      ),
    );
  }

  function cartTotal() {
    return cart.reduce((sum, i) => {
      return sum + getCartUnitPrice(i) * i.qty;
    }, 0);
  }

  async function placeOrder() {
    if (orderTarget === "standalone" && !customerName.trim()) {
      showToast("Enter customer name", "error");
      return;
    }
    if (orderTarget === "table" && (!selectedTable || !selectedPlayer)) {
      showToast("Select table and player", "error");
      return;
    }
    if (cart.length === 0) {
      showToast("Add items to cart", "error");
      return;
    }
    setPlacing(true);
    try {
      if (orderTarget === "table") {
        const placedItems = [];
        for (const item of cart) {
          const res = await addFood(
            selectedTable,
            item.item,
            item.qty,
            item.mrp,
            selectedPlayer,
          );
          placedItems.push({
            item: item.mrp ? `${item.item} (MRP ₹${item.mrp} + ₹3)` : item.item,
            qty: item.qty,
            price: getCartUnitPrice(item) * item.qty,
            foodTotal: res.data.food_total,
          });
        }
        setLastOrder({
          customer: `${selectedPlayer} · ${selectedTable.toUpperCase()}`,
          items: placedItems,
          total: placedItems.reduce((sum, item) => sum + item.price, 0),
          paymentMethod: "Added to table bill",
        });
      } else {
        const res = await placeFoodOrder(customerName.trim(), cart, paymentMethod);
        setLastOrder({
          customer: customerName,
          items: res.data.items,
          total: res.data.total,
          paymentMethod: res.data.payment_method,
        });
      }
      setCart([]);
      setCustomerName("");
      fetchAll();
      showToast("Food order placed", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to place order", "error");
    } finally {
      setPlacing(false);
    }
  }

  async function handleCancelFoodOrder(orderId) {
    if (confirmCancelOrderId !== orderId) {
      setConfirmCancelOrderId(orderId);
      showToast("Tap Confirm cancel to remove this food order", "info");
      return;
    }
    if (busyActionRef.current) return;
    busyActionRef.current = `order-cancel-${orderId}`;
    setBusyAction(`order-cancel-${orderId}`);
    try {
      await cancelFoodOrder(orderId);
      await fetchAll();
      setConfirmCancelOrderId(null);
      showToast("Food order cancelled", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to cancel food order", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  }

  const filteredMenu = Object.entries(menu).filter(
    ([, v]) =>
      getItemAvail(v) && (activeCat === "All" || getItemCat(v) === activeCat),
  );
  const selectedSession = activeSessions.find((session) => session.table_id === tableKey(selectedTable));
  const selectedSessionPlayers =
    selectedSession?.players?.length
      ? selectedSession.players
      : [selectedSession?.customer_name, selectedSession?.split_name]
          .filter(Boolean)
          .flatMap((name) => String(name).split(",").map((part) => part.trim()).filter(Boolean));

  if (loading) {
    return (
      <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading Food and Cafe POS">
        <div className="page-skeleton-status">
          <i className="ti ti-loader-2" aria-hidden="true" />
          <span>Loading Food & Cafe POS...</span>
        </div>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
        <div className="skeleton-panel" />
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <div className="load-error-banner" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" onClick={() => fetchAll({ showLoading: true })}>
            Retry
          </button>
        </div>
      )}

      {/* Tab switcher */}
      <div className="segmented-control page-tabs">
        {[
          ["order", "New Order"],
          ["menu", "Edit Menu"],
          ["stats", "Food Stats"],
          ["history", "Order History"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={activeTab === id ? "active" : ""}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── New Order ── */}
      {activeTab === "order" && (
        <div className="food-order-layout">
          {/* Menu grid */}
          <div>
            <div className="segmented-control category-tabs">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCat(cat)}
                  className={activeCat === cat ? "active" : ""}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="food-menu-grid">
              {filteredMenu.map(([name, v]) => {
                const inCart = cart.find((i) => i.item === name);
                return (
                  <div
                    key={name}
                    onClick={() => addToCart(name)}
                    className={`food-menu-card ${inCart ? "active" : ""}`}
                  >
                    <div className="food-menu-name">
                      {name}
                    </div>
                    <div className="food-menu-price">
                      {isCigarette(name) ? "Manual price" : `₹${getItemPrice(v)}`}
                    </div>
                    <div className="food-menu-category">
                      {getItemCat(v)}
                    </div>
                    {inCart && (
                      <div className="food-menu-cart-note">
                        × {inCart.qty} in cart
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredMenu.length === 0 && (
                <div style={{ gridColumn: "1/-1" }}>
                  <EmptyState
                    icon="ti-tools-kitchen-2"
                    title="No items in this category"
                    detail="Try another category or add menu items from Settings."
                  />
                </div>
              )}
            </div>
          </div>

          {/* Cart */}
          <div>
            <div className="panel food-cart-panel">
              <div className="section-heading">
                Order Summary
              </div>

              <div className="food-payment-toggle" aria-label="Order target">
                {[
                  ["standalone", "Counter"],
                  ["table", "Table"],
                ].map(([target, label]) => (
                  <button
                    key={target}
                    type="button"
                    className={orderTarget === target ? "active" : ""}
                    onClick={() => setOrderTarget(target)}
                  >
                    <i className={`ti ${target === "table" ? "ti-billiard" : "ti-shopping-bag"}`} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              {orderTarget === "table" ? (
                <div className="food-table-target">
                  <select
                    className="input-field"
                    value={selectedTable}
                    onChange={(e) => {
                      setSelectedTable(e.target.value);
                      setSelectedPlayer("");
                    }}
                  >
                    <option value="">Select table</option>
                    {activeSessions.map((session) => (
                      <option key={session.table_id} value={session.table_id}>
                        {session.table_id.toUpperCase()} · {session.customer_name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input-field"
                    value={selectedPlayer}
                    onChange={(e) => setSelectedPlayer(e.target.value)}
                    disabled={!selectedTable}
                  >
                    <option value="">Select player</option>
                    {selectedSessionPlayers.map((player) => (
                      <option key={player} value={player}>
                        {player}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <input
                    className="input-field"
                    placeholder="Customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />

                  <div className="food-payment-toggle" aria-label="Payment method">
                    {["Cash", "UPI", "Card"].map((method) => (
                      <button
                        key={method}
                        type="button"
                        className={paymentMethod === method ? "active" : ""}
                        onClick={() => setPaymentMethod(method)}
                      >
                        <i
                          className={`ti ${
                            method === "Cash"
                              ? "ti-cash"
                              : method === "UPI"
                                ? "ti-qrcode"
                                : "ti-credit-card"
                          }`}
                          aria-hidden="true"
                        />
                        {method}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {cart.length === 0 ? (
                <EmptyState
                  icon="ti-shopping-cart-plus"
                  title="Cart is empty"
                  detail="Click menu items to add them to this order."
                />
              ) : (
                <>
                  {cart.map((i) => {
                    const price = getCartUnitPrice(i);
                    return (
                      <div
                        key={`${i.item}-${i.mrp || "fixed"}`}
                        className="cart-line"
                      >
                        <div>
                          <div className="cart-line-name">
                            {isCigarette(i.item) && i.mrp
                              ? `${i.item} (₹${i.mrp})`
                              : i.item}
                          </div>
                          <div className="cart-line-meta">
                            ₹{price} × {i.qty}
                          </div>
                        </div>
                        <div
                          className="cart-line-actions"
                        >
                          <label className="cart-qty-control">
                            <span>Qty</span>
                            <input
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={i.qty}
                              onChange={(e) => updateCartQty(i, e.target.value)}
                            />
                          </label>
                          <span className="cart-line-price">
                            ₹{price * i.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromCart(i)}
                            className="icon-danger-btn"
                            aria-label={`Remove ${i.name || "item"} from cart`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "12px 0 8px",
                      fontWeight: "var(--weight-bold)",
                      fontSize: "var(--text-base)",
                    }}
                  >
                    <span>Total</span>
                    <span style={{ color: "var(--success)" }}>₹{cartTotal()}</span>
                  </div>

                  <button
                    onClick={placeOrder}
                    disabled={placing}
                    className="primary-action-btn"
                  >
                    {placing ? "Placing..." : "Place Order"}
                  </button>
                </>
              )}

              {/* Last order confirmation */}
              {lastOrder && (
                <div className="success-callout">
                  <div className="success-callout-title">
                    Order placed for {lastOrder.customer}
                  </div>
                  {lastOrder.items.map((i, idx) => (
                    <div
                      key={idx}
                      className="success-callout-row"
                    >
                      <span>
                        {i.item} x{i.qty}
                      </span>
                      <span>₹{i.price}</span>
                    </div>
                  ))}
                  <div className="success-callout-total">
                    Total: ₹{lastOrder.total} · {lastOrder.paymentMethod || "Cash"}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Menu ── */}
      {activeTab === "menu" && (
        <div className="history-section">
          <div className="section-heading">Food Menu</div>
          <form className="food-menu-edit-form" onSubmit={handleAddMenuItem}>
            <input
              className="input-field"
              placeholder="Item name"
              value={newItem.name}
              onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="input-field"
              type="number"
              min="1"
              placeholder="Price"
              value={newItem.price}
              onChange={(e) => setNewItem((prev) => ({ ...prev, price: e.target.value }))}
            />
            <select
              className="input-field"
              value={newItem.category}
              onChange={(e) => setNewItem((prev) => ({ ...prev, category: e.target.value }))}
            >
              {CATEGORIES.filter((cat) => cat !== "All").map((cat) => (
                <option key={cat}>{cat}</option>
              ))}
            </select>
            <button className="primary-action-btn" type="submit" disabled={busyAction === "menu-add"}>
              {busyAction === "menu-add" ? "Adding..." : "Add item"}
            </button>
          </form>

          <div className="food-menu-edit-list">
            {Object.entries(menu).map(([name, value]) => {
              const editing = editingItem?.oldName === name;
              return (
                <div key={name} className="food-menu-edit-row">
                  {editing ? (
                    <>
                      <input
                        className="input-field"
                        value={editingItem.newName}
                        onChange={(e) =>
                          setEditingItem((prev) => ({ ...prev, newName: e.target.value }))
                        }
                      />
                      <input
                        className="input-field"
                        type="number"
                        min="1"
                        value={editingItem.price}
                        onChange={(e) =>
                          setEditingItem((prev) => ({ ...prev, price: e.target.value }))
                        }
                      />
                      <select
                        className="input-field"
                        value={editingItem.category}
                        onChange={(e) =>
                          setEditingItem((prev) => ({ ...prev, category: e.target.value }))
                        }
                      >
                        {CATEGORIES.filter((cat) => cat !== "All").map((cat) => (
                          <option key={cat}>{cat}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-success-sm food-action-save"
                        type="button"
                        onClick={handleUpdateMenuItem}
                        disabled={busyAction === `menu-edit-${name}`}
                      >
                        {busyAction === `menu-edit-${name}` ? "Saving..." : "Save"}
                      </button>
                      <button className="btn food-action-neutral" type="button" onClick={() => setEditingItem(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="food-menu-edit-main">
                        <strong>{name}</strong>
                        <span>{getItemCat(value)} · ₹{getItemPrice(value)}</span>
                      </div>
                      <button
                        className={`btn food-action-stock ${getItemAvail(value) ? "is-visible" : "is-hidden"}`}
                        type="button"
	                        onClick={() => handleToggleAvailability(name, !getItemAvail(value))}
	                        disabled={busyAction === `stock-${name}`}
	                      >
	                        {busyAction === `stock-${name}` ? "Saving..." : getItemAvail(value) ? "Hide" : "Show"}
	                      </button>
                      <button
                        className="btn food-action-neutral"
                        type="button"
                        onClick={() =>
                          setEditingItem({
                            oldName: name,
                            newName: name,
                            price: getItemPrice(value),
                            category: getItemCat(value),
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
	                        className="btn btn-danger-sm food-action-delete"
	                        type="button"
	                        onClick={() => handleDeleteMenuItem(name)}
	                        disabled={busyAction === `menu-delete-${name}`}
	                      >
	                        {busyAction === `menu-delete-${name}` ? "Deleting..." : "Delete"}
	                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Food Stats ── */}
      {activeTab === "stats" && (
        <div>
          <div
              className="section-heading"
            >
            Food Item Performance
          </div>
          {stats.length === 0 ? (
            <EmptyState
              icon="ti-chart-bar"
              title="No food orders yet"
              detail="Food performance will appear after the first order."
            />
          ) : (
            <div className="history-section">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Item</th>
                    <th>Units Sold</th>
                    <th>Revenue</th>
                    <th>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => {
                    const maxQty = stats[0]?.qty || 1;
                    const pct = Math.round((s.qty / maxQty) * 100);
                    return (
                      <tr key={i}>
                        <td style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                          #{i + 1}
                        </td>
                        <td style={{ fontWeight: "var(--weight-medium)" }}>{s.name}</td>
                        <td style={{ color: "var(--accent)", fontWeight: "var(--weight-semibold)" }}>
                          {s.qty}
                        </td>
                        <td style={{ color: "var(--success)", fontWeight: "var(--weight-semibold)" }}>
                          ₹{s.revenue.toLocaleString("en-IN")}
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                height: "6px",
                                background: "var(--border)",
                                borderRadius: "var(--radius-sm)",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "6px",
                                  background:
                                    i === 0
                                      ? "var(--success)"
                                      : i === stats.length - 1
                                        ? "var(--danger)"
                                        : "var(--accent)",
                                  borderRadius: "var(--radius-sm)",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--text-muted)",
                                width: "32px",
                              }}
                            >
                              {pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Order History ── */}
      {activeTab === "history" && (
        <div>
          <div
              className="section-heading"
            >
            Food-Only Orders
          </div>
          {orders.length === 0 ? (
            <EmptyState
              icon="ti-receipt"
              title="No standalone food orders yet"
              detail="Orders placed without a table session will show here."
            />
          ) : (
            <div className="history-section">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Payment</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={o.id || i}>
                      <td style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                        {o.date}
                      </td>
                      <td style={{ fontWeight: "var(--weight-medium)" }}>{o.customer_name}</td>
                      <td style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                        {o.items.map((x) => `${x.item} x${x.qty}`).join(", ")}
                      </td>
                      <td style={{ fontWeight: "var(--weight-bold)", color: o.payment_method === "UPI" ? "var(--accent)" : "var(--success)" }}>
                        {o.payment_method || "Cash"}
                      </td>
                      <td style={{ fontWeight: "var(--weight-semibold)", color: "var(--success)" }}>
                        ₹{o.total}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-sm food-order-cancel"
	                          onClick={() => handleCancelFoodOrder(o.id)}
	                          disabled={!o.id || busyAction === `order-cancel-${o.id}`}
	                        >
	                          {busyAction === `order-cancel-${o.id}`
                              ? "Cancelling..."
                              : confirmCancelOrderId === o.id
                                ? "Confirm cancel"
                                : "Cancel"}
	                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
