import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMenu,
  getLiveFloor,
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

export default function FoodTab({ onNavigate, role = "admin", orderContext, onOrderContextHandled }) {
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
  const [menuSearch, setMenuSearch] = useState("");
  const [placing, setPlacing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState(null);
  const busyActionRef = useRef("");
  const [lastOrder, setLastOrder] = useState(null);
  const [cigaretteDraft, setCigaretteDraft] = useState({ name: "", mrp: "" });

  const fetchAll = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const requests = [
        getMenu(),
        getFoodStats(),
        getFoodOrders(),
        getLiveFloor(),
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
        const sessions =
          activeRes.value.data?.floor?.sessions ||
          activeRes.value.data?.active_sessions ||
          [];
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

  function addCartItem(name, mrp = null) {
    setCart((prev) => {
      const existing = prev.find((i) => i.item === name && i.mrp === mrp);
      if (existing)
        return prev.map((i) =>
          i.item === name && i.mrp === mrp ? { ...i, qty: i.qty + 1 } : i,
        );
      return [...prev, { item: name, qty: 1, mrp }];
    });
  }

  function addToCart(name) {
    if (isCigarette(name)) {
      setCigaretteDraft({ name, mrp: "" });
      return;
    }
    addCartItem(name);
  }

  function handleCigarettePriceSubmit(event) {
    event.preventDefault();
    const mrp = parseInt(cigaretteDraft.mrp, 10);
    if (!mrp || mrp <= 0) {
      showToast("Enter the cigarette MRP before adding it.", "error");
      return;
    }
    addCartItem(cigaretteDraft.name, mrp);
    setCigaretteDraft({ name: "", mrp: "" });
    showToast(`${cigaretteDraft.name} added at ₹${mrp} MRP + ₹3`, "success");
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

  const normalizedMenuSearch = menuSearch.trim().toLowerCase();
  const filteredMenu = Object.entries(menu).filter(([name, v]) => {
    if (!getItemAvail(v)) return false;
    const category = getItemCat(v);
    const matchesCategory = activeCat === "All" || category === activeCat;
    const matchesSearch =
      !normalizedMenuSearch ||
      name.toLowerCase().includes(normalizedMenuSearch) ||
      category.toLowerCase().includes(normalizedMenuSearch);
    return matchesCategory && matchesSearch;
  });
  const selectedSession = activeSessions.find((session) => session.table_id === tableKey(selectedTable));
  const selectedSessionPlayers =
    selectedSession?.players?.length
      ? selectedSession.players
      : [selectedSession?.customer_name, selectedSession?.split_name]
          .filter(Boolean)
          .flatMap((name) => String(name).split(",").map((part) => part.trim()).filter(Boolean));

  useEffect(() => {
    if (!orderContext?.tableId) return;
    if (loading) return;
    const nextTable = tableKey(orderContext.tableId);
    setActiveTab("order");
    setOrderTarget("table");
    setSelectedTable(nextTable);

    const session = activeSessions.find((item) => item.table_id === nextTable);
    const players = session?.players?.length
      ? session.players
      : [session?.customer_name, session?.split_name]
          .filter(Boolean)
          .flatMap((name) => String(name).split(",").map((part) => part.trim()).filter(Boolean));
    const preferredPlayer =
      orderContext.playerName && players.includes(orderContext.playerName)
        ? orderContext.playerName
        : players[0] || "";
    setSelectedPlayer(preferredPlayer);
    onOrderContextHandled?.();
  }, [orderContext, activeSessions, loading, onOrderContextHandled]);

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
      {cigaretteDraft.name && (
        <div className="app-confirm-backdrop" role="presentation">
          <form
            className="app-confirm-dialog food-price-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="food-price-dialog-title"
            onSubmit={handleCigarettePriceSubmit}
          >
            <div className="app-confirm-copy">
              <h3 id="food-price-dialog-title">
                Enter cigarette MRP
              </h3>
              <p className="app-confirm-message">
                {cigaretteDraft.name} will be billed at MRP plus ₹3.
              </p>
            </div>
            <label className="food-price-field">
              <span>MRP</span>
              <input
                className="input-field"
                type="number"
                min="1"
                inputMode="numeric"
                autoFocus
                value={cigaretteDraft.mrp}
                onChange={(event) =>
                  setCigaretteDraft((current) => ({
                    ...current,
                    mrp: event.target.value,
                  }))
                }
              />
            </label>
            <div className="app-confirm-actions">
              <button
                type="button"
                className="app-confirm-btn secondary"
                onClick={() => setCigaretteDraft({ name: "", mrp: "" })}
              >
                Cancel
              </button>
              <button type="submit" className="app-confirm-btn primary">
                Add item
              </button>
            </div>
          </form>
        </div>
      )}

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
        {role === "admin" && (
          <button type="button" onClick={() => onNavigate?.("inventory")}>
            Manage Menu
          </button>
        )}
      </div>

      {/* ── New Order ── */}
      {activeTab === "order" && (
        <div className="food-order-layout">
          {/* Menu grid */}
          <div>
            <div className="food-menu-toolbar">
              <label className="food-menu-search">
                <i className="ti ti-search" aria-hidden="true" />
                <input
                  type="search"
                  value={menuSearch}
                  onChange={(event) => setMenuSearch(event.target.value)}
                  placeholder="Search menu items"
                  aria-label="Search menu items"
                />
              </label>
              <span className="food-menu-count">
                {filteredMenu.length} item{filteredMenu.length === 1 ? "" : "s"}
              </span>
            </div>
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
                    title={menuSearch.trim() ? "No matching items" : "No items in this category"}
                    detail={menuSearch.trim() ? "Clear the search or try a shorter item name." : role === "admin" ? "Try another category or manage menu items from Inventory & Stocks." : "Try another category or ask an admin to update the menu."}
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
                  {selectedTable && (
                    <div className="food-session-context">
                      <div>
                        <span>Adding to table bill</span>
                        <strong>
                          {selectedTable.toUpperCase()}
                          {selectedPlayer ? ` · ${selectedPlayer}` : ""}
                        </strong>
                      </div>
                      <button type="button" onClick={() => onNavigate?.("tables")}>
                        Back to table
                      </button>
                    </div>
                  )}
                  <div className="food-table-target-note">
                    {activeSessions.length
                      ? `${activeSessions.length} running table${activeSessions.length === 1 ? "" : "s"} available for food billing`
                      : "No running table sessions. Use Counter order or start a table first."}
                  </div>
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
                            aria-label={`Remove ${i.item || "item"} from cart`}
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
