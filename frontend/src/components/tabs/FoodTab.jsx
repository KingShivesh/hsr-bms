import { Card as HsrCard, Panel as HsrPanel } from "../ui/index.js";
import { Icon as HsrIcon, Input as HsrInput, Button as HsrButton, Select as HsrSelect, Table as HsrTable, MetricValue, EmptyState, SkeletonBlock, Modal, Button } from "../ui/index.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedState, hasCachedState } from "../../hooks/useCachedState.js";
import {
  getMenu,
  getLiveFloor,
  addFood,
  placeFoodOrder,
  getFoodOrders,
  cancelFoodOrder,
  restoreFoodOrder,
  getFoodStats,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { Checkbox } from "../ui/index.js";
import { useRealtimeSubscription } from "../../realtime/useRealtimeSubscription.js";
import { formatCurrency, formatDateTime } from "../../utils/format.js";
import Pagination from "../ui/Pagination.jsx";

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

function FoodPosSkeleton() {
  const menuCards = Array.from({ length: 10 });
  const categories = Array.from({ length: 8 });

  return (
    <div className="cafe-pos-page page-skeleton food-pos-skeleton" role="status" aria-live="polite" aria-label="Loading Food and Cafe POS">
      <div className="page-skeleton-status">
        <span>Loading Food & Cafe POS...</span>
      </div>
      <div className="food-order-layout">
        <div className="cafe-products-region">
          <div className="food-menu-toolbar skeleton-toolbar">
            <span className="skeleton-field skeleton-search-field" />
            <span className="skeleton-pill compact" />
          </div>
          <div className="segmented-control category-tabs skeleton-category-tabs">
            {categories.map((_, index) => (
              <span className={`skeleton-pill ${index % 3 === 0 ? "wide" : ""}`} key={index} />
            ))}
          </div>
          <div className="food-menu-grid">
            {menuCards.map((_, index) => (
              <HsrCard as="div" className="food-menu-card skeleton-menu-card" key={index}>
                <span className="skeleton-media" />
                <span className="skeleton-line skeleton-menu-name" />
                <span className="skeleton-line skeleton-menu-price" />
                <span className="skeleton-line skeleton-menu-category" />
              </HsrCard>
            ))}
          </div>
        </div>
        <aside className="cafe-order-region" aria-label="Loading current order">
          <HsrPanel as="div" className="panel food-cart-panel skeleton-order-panel">
            <div className="food-cart-head">
              <div className="skeleton-order-heading">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-subtitle" />
              </div>
              <span className="skeleton-pill compact" />
            </div>
            <span className="skeleton-pill wide" />
            <span className="skeleton-field" />
            <div className="food-payment-toggle skeleton-payment-toggle">
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
            </div>
            <div className="skeleton-cart-empty">
              <span className="skeleton-media" />
              <span className="skeleton-line skeleton-menu-name" />
              <span className="skeleton-line skeleton-subtitle" />
            </div>
          </HsrPanel>
        </aside>
      </div>
    </div>
  );
}

export default function FoodTab({ onNavigate, role = "admin", orderContext, onOrderContextHandled }) {
  const { showToast } = useToast();
  const [menu, setMenu] = useCachedState("cafe-menu", {});
  const [stats, setStats] = useCachedState("cafe-stats", []);
  const [orders, setOrders] = useCachedState("cafe-orders", []);
  const [activeSessions, setActiveSessions] = useCachedState("cafe-sessions", []);
  const [loading, setLoading] = useState(() => !hasCachedState("cafe-menu"));
  const [statsLoading, setStatsLoading] = useState(() => !hasCachedState("cafe-stats"));
  const [ordersLoading, setOrdersLoading] = useState(() => !hasCachedState("cafe-orders"));
  const [failedSections, setFailedSections] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [orderTarget, setOrderTarget] = useState("standalone");
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [activeTab, setActiveTab] = useState("order");
  const [statsPage, setStatsPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [activeCat, setActiveCat] = useState("All");
  const [menuSearch, setMenuSearch] = useState("");
  const [placing, setPlacing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const busyActionRef = useRef("");
  const menuRefreshTimerRef = useRef(null);
  const orderRefreshTimerRef = useRef(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [cigaretteDraft, setCigaretteDraft] = useState({ name: "", mrp: "" });
  const priceInputRef = useRef(null);

  const fetchAll = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading && !hasCachedState("cafe-menu")) setLoading(true);
    if (showLoading && !hasCachedState("cafe-stats")) setStatsLoading(true);
    if (showLoading && !hasCachedState("cafe-orders")) setOrdersLoading(true);
    setLoadError("");
    setFailedSections([]);
    try {
      const labels = ["menu items", "food stats", "order history", "active tables"];
      const requests = [
        getMenu().then(response => { setMenu(response.data || {}); return response; }),
        getFoodStats().then(response => { setStats(Array.isArray(response.data) ? response.data.filter(row => row && typeof row === "object") : []); return response; }).finally(() => setStatsLoading(false)),
        getFoodOrders().then(response => { setOrders(Array.isArray(response.data) ? response.data.filter(row => row && typeof row === "object") : []); return response; }).finally(() => setOrdersLoading(false)),
        getLiveFloor().then(response => {
          const sessions = response.data?.floor?.sessions || response.data?.active_sessions || [];
          setActiveSessions((Array.isArray(sessions) ? sessions : []).filter(session => session?.table_id).map(session => ({ ...session, table_id: tableKey(session.table_id) })));
          return response;
        }),
      ].map((request, index) => request.catch(error => {
        const label = labels[index];
        setFailedSections(current => current.includes(label) ? current : [...current, label]);
        setLoadError(`Could not load ${label}. Retry once the backend responds.`);
        throw error;
      }));
      // Counter readiness must not wait for the history and performance reads.
      Promise.allSettled([requests[0], requests[3]]).then(() => setLoading(false));
      const [menuRes, statsRes, ordersRes, activeRes] = await Promise.allSettled(requests);
      const failed = [menuRes, statsRes, ordersRes, activeRes]
        .map((result, index) => (result.status === "rejected" ? labels[index] : ""))
        .filter(Boolean);

      setFailedSections(failed);
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
  }, [showToast, setActiveSessions, setMenu, setOrders, setStats]);

  useEffect(() => {
    fetchAll({ showLoading: true });
  }, [fetchAll]);

  const refreshMenu = useCallback(async () => {
    try {
      const response = await getMenu();
      setMenu(response.data || {});
    } catch {
      // The realtime hook keeps polling while disconnected; the global API banner handles failures.
    }
  }, [setMenu]);

  const refreshOrders = useCallback(async () => {
    try {
      const [ordersRes, statsRes] = await Promise.all([getFoodOrders(), getFoodStats()]);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data.filter(row => row && typeof row === "object") : []);
      setStats(Array.isArray(statsRes.data) ? statsRes.data.filter(row => row && typeof row === "object") : []);
    } catch {
      // The realtime hook keeps polling while disconnected; the global API banner handles failures.
    }
  }, [setOrders, setStats]);

  const scheduleMenuRefresh = useCallback(() => {
    window.clearTimeout(menuRefreshTimerRef.current);
    menuRefreshTimerRef.current = window.setTimeout(refreshMenu, 100);
  }, [refreshMenu]);

  const scheduleOrderRefresh = useCallback(() => {
    window.clearTimeout(orderRefreshTimerRef.current);
    orderRefreshTimerRef.current = window.setTimeout(refreshOrders, 150);
  }, [refreshOrders]);

  const refreshRealtimeData = useCallback(() => {
    refreshMenu();
    refreshOrders();
  }, [refreshMenu, refreshOrders]);

  const realtimeState = useRealtimeSubscription({
    topics: ["inventory", "orders"],
    onEvent: (event) => {
      if (event.type === "system.sync_required") {
        scheduleMenuRefresh();
        scheduleOrderRefresh();
      } else if (event.type === "inventory.updated") {
        scheduleMenuRefresh();
      } else if (
        event.type === "order.placed" ||
        event.type === "order.cancelled" ||
        event.type === "order.restored"
      ) {
        scheduleOrderRefresh();
      }
    },
    onFallbackPoll: refreshRealtimeData,
    fallbackPollMs: 15000,
  });

  useEffect(() => {
    if (realtimeState !== "connected") return undefined;
    const safetyPoll = window.setInterval(refreshRealtimeData, 60000);
    return () => window.clearInterval(safetyPoll);
  }, [realtimeState, refreshRealtimeData]);

  useEffect(() => () => {
    window.clearTimeout(menuRefreshTimerRef.current);
    window.clearTimeout(orderRefreshTimerRef.current);
  }, []);

  function getItemPrice(v) {
    return Number(typeof v === "object" ? v?.price : v) || 0;
  }
  function getItemCat(v) {
    return typeof v === "object" ? v?.category || "Snacks" : "Snacks";
  }
  function getItemAvail(v) {
    return v != null && (typeof v !== "object" || v.available !== false);
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

  function adjustCartQty(item, delta) {
    const nextQty = Number(item.qty || 1) + delta;
    if (nextQty <= 0) {
      removeFromCart(item);
      return;
    }
    updateCartQty(item, nextQty);
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
    if (orderTarget === "table" && (!selectedSession || (selectedSessionPlayers.length > 0 && !selectedPlayer))) {
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
            selectedSession.session_key,
          );
          placedItems.push({
            item: item.mrp ? `${item.item} (MRP ₹${item.mrp} + ₹3)` : item.item,
            qty: item.qty,
            price: getCartUnitPrice(item) * item.qty,
            foodTotal: res.data.food_total,
          });
        }
        setLastOrder({
          customer: `${selectedPlayer || "Guest"} · ${selectedTable.toUpperCase()}`,
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

  async function handleCancelFoodOrder(order) {
    const orderId = order?.id;
    if (!orderId) return;
    if (busyActionRef.current) return;
    busyActionRef.current = `order-cancel-${orderId}`;
    setBusyAction(`order-cancel-${orderId}`);
    const restorePayload = {
      date: order.date || "",
      ts: order.ts || null,
      customer_name: order.customer_name || "",
      items: Array.isArray(order.items) ? order.items : [],
      total: Number(order.total || 0),
      payment_method: order.payment_method || "Cash",
    };
    setOrders(current => current.filter(row => row.id !== orderId));
    try {
      await cancelFoodOrder(orderId);
      fetchAll();
      showToast(`${order.customer_name || "Food"} order cancelled`, "success", {
        actionLabel: "Undo",
        duration: 5000,
        onAction: async () => {
          setBusyAction(`order-restore-${orderId}`);
          try {
            await restoreFoodOrder(orderId, restorePayload);
            await fetchAll();
            showToast("Food order restored", "success");
          } catch (e) {
            showToast(e.response?.data?.detail || "Failed to restore food order", "error");
          } finally {
            setBusyAction("");
          }
        },
      });
    } catch (e) {
      setOrders(current => current.some(row => row.id === orderId) ? current : [...current, order]);
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
  const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotalValue = cartTotal();
  const pageSize = 25;
  const safeStatsPage = Math.min(statsPage, Math.max(1, Math.ceil(stats.length / pageSize)));
  const safeHistoryPage = Math.min(historyPage, Math.max(1, Math.ceil(orders.length / pageSize)));
  const visibleStats = stats.slice((safeStatsPage - 1) * pageSize, safeStatsPage * pageSize);
  const visibleOrders = orders.slice((safeHistoryPage - 1) * pageSize, safeHistoryPage * pageSize);
  const canPlaceOrder =
    cart.length > 0 &&
    !placing &&
    (
      orderTarget === "standalone"
        ? !!customerName.trim()
        : !!selectedSession && (selectedSessionPlayers.length === 0 || !!selectedPlayer)
    );
  const placeOrderLabel =
    orderTarget === "table"
      ? `Add to table bill · ${formatCurrency(cartTotalValue)}`
      : `Collect ${paymentMethod} · ${formatCurrency(cartTotalValue)}`;

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

  useEffect(() => {
    if (orderTarget !== "table" || !selectedTable || selectedPlayer) return;
    if (selectedSessionPlayers.length) {
      setSelectedPlayer(selectedSessionPlayers[0]);
    }
  }, [orderTarget, selectedTable, selectedPlayer, selectedSessionPlayers]);

  return (
    <div className="cafe-pos-page" data-realtime-state={realtimeState}>
      {cigaretteDraft.name && (
        <Modal open portal title="Enter cigarette MRP" description={`${cigaretteDraft.name} will be billed at MRP plus ₹3.`}
          initialFocusRef={priceInputRef}
          onClose={() => setCigaretteDraft({ name: "", mrp: "" })}
          footer={<>
            <Button variant="secondary" onClick={() => setCigaretteDraft({ name: "", mrp: "" })}>Discard Item</Button>
            <Button variant="primary" type="submit" form="cafe-price-form">Add Cigarette</Button>
          </>}
        >
          <form id="cafe-price-form" onSubmit={handleCigarettePriceSubmit}>
            <label className="food-price-field">
              <span>MRP</span>
              <HsrInput
                ref={priceInputRef}
                className="input-field"
                type="number"
                min="1"
                inputMode="numeric"
                value={cigaretteDraft.mrp}
                onChange={(event) =>
                  setCigaretteDraft((current) => ({
                    ...current,
                    mrp: event.target.value,
                  }))
                }
              />
            </label>
          </form>
        </Modal>
      )}

      {loadError && (
        <div className="load-error-banner" role="alert">
          <HsrIcon className="ti ti-alert-circle" aria-hidden="true" />
          <span>{loadError}</span>
          <HsrButton native type="button" onClick={() => fetchAll({ showLoading: true })}>
            Retry
          </HsrButton>
        </div>
      )}

      {/* Tab switcher */}
      <div className="segmented-control page-tabs cafe-pos-tabs">
        {[
          ["order", "New Order"],
          ["stats", "Food Stats"],
          ["history", "Order History"],
        ].map(([id, label]) => (
          <HsrButton native
            key={id}
            onClick={() => setActiveTab(id)}
            className={activeTab === id ? "active" : ""}
          >
            {label}
          </HsrButton>
        ))}
        {role === "admin" && (
          <HsrButton native type="button" onClick={() => onNavigate?.("inventory")}>
            Manage Menu
          </HsrButton>
        )}
      </div>

      {/* ── New Order ── */}
      {activeTab === "order" && (loading ? <FoodPosSkeleton /> : (
        <div className="food-order-layout">
          {/* Menu grid */}
          <div className="cafe-products-region">
            <div className="food-menu-toolbar">
              <label className="food-menu-search">
                <HsrIcon className="ti ti-search" aria-hidden="true" />
                <HsrInput
                  type="search"
                  value={menuSearch}
                  onChange={(event) => setMenuSearch(event.target.value)}
                  placeholder="Search menu items"
                  aria-label="Search menu items"
                />
                {menuSearch.trim() && (
                  <HsrButton native
                    type="button"
                    className="food-search-clear"
                    onClick={() => setMenuSearch("")}
                    aria-label="Clear menu search"
                  >
                    <HsrIcon className="ti ti-x" aria-hidden="true" />
                  </HsrButton>
                )}
              </label>
              <span className="food-menu-count">
                {filteredMenu.length} item{filteredMenu.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="segmented-control category-tabs">
              {CATEGORIES.map((cat) => (
                <HsrButton native
                  key={cat}
                  onClick={() => setActiveCat(cat)}
                  className={activeCat === cat ? "active" : ""}
                  aria-pressed={activeCat === cat}
                >
                  {cat}
                </HsrButton>
              ))}
            </div>

            <div className="food-menu-grid">
              {filteredMenu.map(([name, v]) => {
                const inCart = cart.find((i) => i.item === name);
                return (
                  <HsrCard as={HsrButton} native
                    type="button"
                    key={name}
                    onClick={() => addToCart(name)}
                    className={`food-menu-card ${inCart ? "active" : ""}`}
                    aria-label={`Add ${name} to order`}
                  >
                    <span className="food-card-media" aria-hidden="true">
                      <HsrIcon className={`ti ${isCigarette(name) ? "ti-smoking" : "ti-tools-kitchen-2"}`} />
                    </span>
                    <div className="food-menu-name" title={name}>
                      {name}
                    </div>
                    <div className="food-menu-price">
                      {isCigarette(name) ? "Manual price" : formatCurrency(getItemPrice(v))}
                    </div>
                    <div className="food-menu-category">
                      {getItemCat(v)}
                    </div>
                    {inCart && (
                      <div className="food-menu-cart-note">
                        × {inCart.qty} in cart
                      </div>
                    )}
                  </HsrCard>
                );
              })}
              {filteredMenu.length === 0 && (
                <div className="polish-grid-column-1--1" >
                  <EmptyState
                    icon="ti-tools-kitchen-2"
                    title={menuSearch.trim() ? "No matching items" : "No items in this category"}
                    description={menuSearch.trim() ? "Clear the search or try a shorter item name." : role === "admin" ? "Try another category or manage menu items from Inventory & Stocks." : "Try another category or ask an admin to update the menu."}
                    action={menuSearch.trim() ? (
                      <HsrButton native type="button" className="lf-secondary-button empty-action-button" onClick={() => setMenuSearch("")}>
                        <HsrIcon className="ti ti-x" aria-hidden="true" />
                        Clear Search
                      </HsrButton>
                    ) : role === "admin" ? (
                      <HsrButton native type="button" className="lf-secondary-button empty-action-button" onClick={() => onNavigate?.("inventory")}>
                        <HsrIcon className="ti ti-package" aria-hidden="true" />
                        Manage Inventory
                      </HsrButton>
                    ) : null}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Cart */}
          <aside className="cafe-order-region" aria-label="Current order">
            <HsrPanel as="div" className="panel food-cart-panel">
              <div className="food-cart-head">
                <div>
                  <div className="section-heading">
                    Current Order
                  </div>
                  <p>
                    {orderTarget === "table"
                      ? selectedTable
                        ? `${selectedTable.toUpperCase()}${selectedPlayer ? ` · ${selectedPlayer}` : " · select player"}`
                        : "Attach food to a running table"
                      : customerName.trim()
                        ? `Counter · ${customerName.trim()}`
                        : "Counter order"}
                  </p>
                </div>
                {cart.length > 0 && (
                  <HsrButton native
                    type="button"
                    className="food-clear-cart"
                    onClick={() => setCart([])}
                    disabled={placing}
                  >
                    Clear Order
                  </HsrButton>
                )}
              </div>

              <div className="cafe-order-mode">
                <div className="cafe-counter-badge">
                  <HsrIcon className={`ti ${orderTarget === "table" ? "ti-billiard" : "ti-shopping-bag"}`} aria-hidden="true" />
                  <span>{orderTarget === "table" ? "Table / session order" : "Counter order"}</span>
                </div>
                <Checkbox
                  checked={orderTarget === "table"}
                  disabled={activeSessions.length === 0}
                  label="Add to running table"
                  hint={activeSessions.length ? "Food will be added to the selected player/session bill." : "Start a table session before attaching food."}
                  onChange={(checked) => {
                    setOrderTarget(checked ? "table" : "standalone");
                    if (!checked) {
                      setSelectedTable("");
                      setSelectedPlayer("");
                    }
                  }}
                />
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
                      <HsrButton native type="button" onClick={() => onNavigate?.("tables")}>
                        Back to table
                      </HsrButton>
                    </div>
                  )}
                  <div className="food-table-target-note">
                    {activeSessions.length
                      ? `${activeSessions.length} running table${activeSessions.length === 1 ? "" : "s"} available for food billing`
                      : "No running table sessions. Use Counter order or start a table first."}
                  </div>
                  <HsrSelect
                    className="input-field"
                    aria-label="Order table"
                    value={selectedTable}
                    onChange={(e) => {
                      setSelectedTable(e.target.value);
                      setSelectedPlayer("");
                    }}
                  >
                    <option value="">Select table</option>
                    {activeSessions.map((session) => (
                      <option key={session.table_id} value={session.table_id}>
                        {session.table_id.toUpperCase()} · {session.customer_name || "Guest"}
                      </option>
                    ))}
                  </HsrSelect>
                  {selectedSessionPlayers.length > 0 ? <HsrSelect
                    className="input-field"
                    aria-label="Order player"
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
                  </HsrSelect> : selectedSession ? <p className="food-table-target-note">Guest session · No player name recorded</p> : null}
                </div>
              ) : (
                <>
                  <HsrInput
                    className="input-field"
                    placeholder="Customer name"
                    aria-label="Counter customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />

                  <div className="food-payment-toggle" aria-label="Payment method">
                    {["Cash", "UPI", "Card"].map((method) => (
                      <HsrButton native
                        key={method}
                        type="button"
                        className={paymentMethod === method ? "active" : ""}
                        onClick={() => setPaymentMethod(method)}
                      >
                        <HsrIcon
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
                      </HsrButton>
                    ))}
                  </div>
                </>
              )}

              {cart.length === 0 ? (
                <EmptyState
                  icon="ti-shopping-cart-plus"
                  title="Cart is empty"
                  description="Click menu items to add them to this order."
                  action={filteredMenu.length > 0 ? (
                    <HsrButton native type="button" className="lf-secondary-button empty-action-button" onClick={() => document.querySelector(".food-menu-card")?.focus()}>
                      <HsrIcon className="ti ti-arrow-left" aria-hidden="true" />
                      Choose Items
                    </HsrButton>
                  ) : null}
                />
              ) : (
                <>
                  {cartItemCount >= 100 && <a className="food-cart-items-link" href="#food-cart-items" onClick={event => { event.preventDefault(); document.getElementById("food-cart-items")?.focus(); }}>100+ items · View items</a>}
                  <div id="food-cart-items" className="food-cart-lines" tabIndex={-1} aria-label="Order items">
                  {cart.map((i) => {
                    const price = getCartUnitPrice(i);
                    return (
                      <div
                        key={`${i.item}-${i.mrp || "fixed"}`}
                        className="cart-line"
                      >
                        <div>
                          <div className="cart-line-name" title={i.item}>
                            {isCigarette(i.item) && i.mrp
                              ? `${i.item} (₹${i.mrp})`
                              : i.item}
                          </div>
                          <div className="cart-line-meta">
                            {formatCurrency(price)} × {i.qty}
                          </div>
                        </div>
                        <div
                          className="cart-line-actions"
                        >
                          <div className="cart-qty-control" aria-label={`Quantity for ${i.item}`}>
                            <HsrButton native type="button" onClick={() => adjustCartQty(i, -1)} aria-label={`Decrease ${i.item} quantity`}>
                              <HsrIcon className="ti ti-minus" aria-hidden="true" />
                            </HsrButton>
                            <HsrInput
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={i.qty}
                              onChange={(e) => updateCartQty(i, e.target.value)}
                              aria-label={`${i.item} quantity`}
                            />
                            <HsrButton native type="button" onClick={() => adjustCartQty(i, 1)} aria-label={`Increase ${i.item} quantity`}>
                              <HsrIcon className="ti ti-plus" aria-hidden="true" />
                            </HsrButton>
                          </div>
                          <span className="cart-line-price">
                            {formatCurrency(price * i.qty)}
                          </span>
                          <HsrButton native
                            type="button"
                            onClick={() => removeFromCart(i)}
                            className="icon-danger-btn"
                            aria-label={`Remove ${i.item || "item"} from cart`}
                          >
                            <HsrIcon className="ti ti-x" aria-hidden="true" />
                          </HsrButton>
                        </div>
                      </div>
                    );
                  })}
                  </div>

                  <div className="food-cart-total">
                    <div>
                      <span>Subtotal</span>
                      <small>{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</small>
                    </div>
                    <MetricValue>{formatCurrency(cartTotalValue)}</MetricValue>
                  </div>

                  <div className="food-cart-grand-total">
                    <span>Total</span>
                    <MetricValue>{formatCurrency(cartTotalValue)}</MetricValue>
                  </div>

                  <HsrButton native
                    onClick={placeOrder}
                    disabled={!canPlaceOrder}
                    className="primary-action-btn"
                  >
                    {placing ? "Placing..." : placeOrderLabel}
                  </HsrButton>
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
                      <span>{formatCurrency(i.price)}</span>
                    </div>
                  ))}
                  <div className="success-callout-total">
                    Total: {formatCurrency(lastOrder.total)} · {lastOrder.paymentMethod || "Cash"}
                  </div>
                </div>
              )}
            </HsrPanel>
          </aside>
        </div>
      ))}

      {/* ── Food Stats ── */}
      {activeTab === "stats" && (
        <div>
          <div
              className="section-heading"
            >
            Food Item Performance
          </div>
          {statsLoading ? <SkeletonBlock rows={5} label="Loading food performance" /> : failedSections.includes("food stats") ? (
            <EmptyState icon="ti-alert-circle" title="Food performance could not load" description="Retry to see the latest item performance." secondaryAction={false} action={<Button icon="ti-refresh" onClick={() => fetchAll({ showLoading: true })}>Retry stats</Button>} />
          ) : stats.length === 0 ? (
            <EmptyState
              icon="ti-chart-bar"
              title="No food orders yet"
              description="Food performance will appear after the first order."
              action={<HsrButton onClick={() => setActiveTab("order")}>New Order</HsrButton>}
            />
          ) : (
            <div className="history-section">
              <HsrTable className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Item</th>
                    <th data-type="number">Units Sold</th>
                    <th data-type="number">Revenue</th>
                    <th>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStats.map((s, i) => {
                    const rankIndex = (safeStatsPage - 1) * pageSize + i;
                    const maxQty = stats[0]?.qty || 1;
                    const pct = Math.max(0, Math.min(100, Math.round(((Number(s.qty) || 0) / maxQty) * 100)));
                    return (
                      <tr key={i}>
                        <td className="type-sm polish-color-text-muted" >
                          #{rankIndex + 1}
                        </td>
                        <td className="polish-font-weight-weight-medium" >{s.name || "-"}</td>
                        <td data-type="number" className="polish-color-accent polish-font-weight-weight-semibold" >
                          {Number(s.qty) || 0}
                        </td>
                        <td data-type="number" className="polish-color-success polish-font-weight-weight-semibold" >
                          {formatCurrency(s.revenue)}
                        </td>
                        <td>
                          <div
                            className="polish-display-flex polish-align-items-center polish-gap-8px"
                          >
                            <div
                              className="polish-flex-1 polish-height-6px polish-background-border polish-border-radius-radius-sm"
                            >
                              <div
                                className="polish-height-6px polish-border-radius-radius-sm" style={{ width: `${pct}%`, background:
                                    rankIndex === 0
                                      ? "var(--success)"
                                      : rankIndex === stats.length - 1
                                        ? "var(--danger)"
                                        : "var(--accent)" }}
                              />
                            </div>
                            <span className="type-xs polish-color-text-muted polish-width-32px"

                            >
                              {pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </HsrTable>
              <Pagination total={stats.length} page={safeStatsPage} pageSize={pageSize} onPageChange={setStatsPage} label="Food performance" />
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
          {ordersLoading ? <SkeletonBlock rows={5} label="Loading order history" /> : failedSections.includes("order history") ? (
            <EmptyState icon="ti-alert-circle" title="Order history could not load" description="Retry to see the latest counter orders." secondaryAction={false} action={<Button icon="ti-refresh" onClick={() => fetchAll({ showLoading: true })}>Retry history</Button>} />
          ) : orders.length === 0 ? (
            <EmptyState
              icon="ti-receipt"
              title="No standalone food orders yet"
              description="Orders placed without a table session will show here."
              action={<HsrButton onClick={() => setActiveTab("order")}>New Order</HsrButton>}
            />
          ) : (
            <div className="history-section">
              <HsrTable className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Payment</th>
                    <th data-type="number">Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((o, i) => (
                    <tr key={o.id || i}>
                      <td className="type-sm polish-color-text-muted" >
                        {o.ts ? formatDateTime(o.ts) : o.date || "-"}
                      </td>
                      <td className="polish-font-weight-weight-medium" >{o.customer_name || "Guest"}</td>
                      <td className="type-sm polish-color-text-secondary" >
                        {Array.isArray(o.items) && o.items.length ? o.items.filter(Boolean).map((x) => `${x.item || "Item"} x${Number(x.qty) || 0}`).join(", ") : "No item details"}
                      </td>
                      <td className="polish-font-weight-weight-bold" style={{ color: !o.payment_method ? "var(--text-muted)" : o.payment_method === "UPI" ? "var(--accent)" : "var(--success)" }}>
                        {o.payment_method || "-"}
                      </td>
                      <td data-type="number" className="polish-font-weight-weight-semibold polish-color-success" >
                        {formatCurrency(o.total)}
                      </td>
                      <td>
                        <HsrButton native
                          type="button"
                          className="btn btn-danger-sm food-order-cancel"
	                          onClick={() => handleCancelFoodOrder(o)}
	                          disabled={!o.id || busyAction === `order-cancel-${o.id}`}
	                        >
	                          {busyAction === `order-cancel-${o.id}`
                              ? "Cancelling..."
                              : "Cancel Food Order"}
	                        </HsrButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HsrTable>
              <Pagination total={orders.length} page={safeHistoryPage} pageSize={pageSize} onPageChange={setHistoryPage} label="Order history" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
