import { useState, useEffect } from "react";
import {
  getMenu,
  placeFoodOrder,
  getFoodOrders,
  getFoodStats,
} from "../../api/index.js";

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
  const [menu, setMenu] = useState({});
  const [stats, setStats] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [activeTab, setActiveTab] = useState("order");
  const [activeCat, setActiveCat] = useState("All");
  const [placing, setPlacing] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [mRes, sRes, oRes] = await Promise.all([
        getMenu(),
        getFoodStats(),
        getFoodOrders(),
      ]);
      setMenu(mRes.data);
      setStats(sRes.data);
      setOrders(oRes.data);
    } catch (e) {
      console.error(e);
    }
  }

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
    if (isCigarette(item.item)) return item.mrp || 0;
    return getItemPrice(menu[item.item]);
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

  function cartTotal() {
    return cart.reduce((sum, i) => {
      return sum + getCartUnitPrice(i) * i.qty;
    }, 0);
  }

  async function placeOrder() {
    if (!customerName.trim()) {
      alert("Enter customer name");
      return;
    }
    if (cart.length === 0) {
      alert("Add items to cart");
      return;
    }
    setPlacing(true);
    try {
      const res = await placeFoodOrder(customerName.trim(), cart, paymentMethod);
      setLastOrder({
        customer: customerName,
        items: res.data.items,
        total: res.data.total,
        paymentMethod: res.data.payment_method,
      });
      setCart([]);
      setCustomerName("");
      fetchAll();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }

  const filteredMenu = Object.entries(menu).filter(
    ([, v]) =>
      getItemAvail(v) && (activeCat === "All" || getItemCat(v) === activeCat),
  );

  return (
    <div>
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

              <input
                className="input-field"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />

              <div className="food-payment-toggle" aria-label="Payment method">
                {["Cash", "UPI"].map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={paymentMethod === method ? "active" : ""}
                    onClick={() => setPaymentMethod(method)}
                  >
                    <i className={`ti ${method === "Cash" ? "ti-cash" : "ti-qrcode"}`} aria-hidden="true" />
                    {method}
                  </button>
                ))}
              </div>

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
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span className="cart-line-price">
                            ₹{price * i.qty}
                          </span>
                          <button
                            onClick={() => removeFromCart(i)}
                            className="icon-danger-btn"
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
                      fontWeight: 700,
                      fontSize: "15px",
                    }}
                  >
                    <span>Total</span>
                    <span style={{ color: "#16a34a" }}>₹{cartTotal()}</span>
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
                        <td style={{ color: "#bbb", fontSize: "12px" }}>
                          #{i + 1}
                        </td>
                        <td style={{ fontWeight: 500 }}>{s.name}</td>
                        <td style={{ color: "#2563eb", fontWeight: 600 }}>
                          {s.qty}
                        </td>
                        <td style={{ color: "#16a34a", fontWeight: 600 }}>
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
                                background: "#f0f0f0",
                                borderRadius: "3px",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "6px",
                                  background:
                                    i === 0
                                      ? "#16a34a"
                                      : i === stats.length - 1
                                        ? "#e11d48"
                                        : "#2563eb",
                                  borderRadius: "3px",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#bbb",
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
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={i}>
                      <td style={{ color: "#bbb", fontSize: "12px" }}>
                        {o.date}
                      </td>
                      <td style={{ fontWeight: 500 }}>{o.customer_name}</td>
                      <td style={{ fontSize: "12px", color: "#888" }}>
                        {o.items.map((x) => `${x.item} x${x.qty}`).join(", ")}
                      </td>
                      <td style={{ fontWeight: 700, color: o.payment_method === "UPI" ? "#2563eb" : "#16a34a" }}>
                        {o.payment_method || "Cash"}
                      </td>
                      <td style={{ fontWeight: 600, color: "#16a34a" }}>
                        ₹{o.total}
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
