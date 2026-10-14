import axios from "axios";
import { readEpoch, invalidateReads } from "./readEpoch.js";

const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 45000);
const DEV_BACKEND_WAKE_DELAY_MS = import.meta.env.DEV
  ? Number(import.meta.env.VITE_SIMULATE_BACKEND_WAKE_MS || 0)
  : 0;
const SAFE_RETRY_METHODS = new Set(["get", "head", "options"]);
const RETRY_DELAYS_MS = [800, 1800];
let lastBackendEventAt = 0;
let lastDataChangeAt = 0;
const inFlight = new Map();

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  timeout: API_TIMEOUT_MS,
});

// Collapse concurrent reads, not sequential refreshes. Never share auth or bill requests.
function getResource(url, config = {}) {
  if (config.signal || config.responseType || /\/(auth|ready)|quote|checkout|export/.test(url)) return api.get(url, config);
  const key = JSON.stringify([localStorage.getItem("token"), localStorage.getItem("role"), readEpoch(), url, config.params]);
  if (inFlight.has(key)) return inFlight.get(key);
  const request = api.get(url, config).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

const tableKey = (table_id) => String(table_id || "").trim().toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldRetryRequest(err) {
  const cfg = err.config || {};
  const method = String(cfg.method || "get").toLowerCase();
  if (!SAFE_RETRY_METHODS.has(method)) return false;
  if (cfg.__retryCount >= RETRY_DELAYS_MS.length) return false;
  if (cfg.noRetry) return false;
  if (!err.response) return true;
  return err.response.status >= 500;
}

function backendErrorMessage(err) {
  if (err.code === "ECONNABORTED") {
    return "Backend took too long to respond. It may be waking up. Please try again.";
  }
  if (!err.response) {
    return "Backend is unreachable. Check internet, Render backend status, or VITE_API_URL.";
  }
  if (err.response.status >= 500) {
    return "Backend had a server error. Try again and check Render logs if it repeats.";
  }
  const detail = err.response.data?.detail;
  if (Array.isArray(detail)) return detail.map(row => row.msg || "Invalid value").join("; ");
  return typeof detail === "string" ? detail : err.message || "Request failed";
}

function notifyBackendFailure(err) {
  const now = Date.now();
  if (now - lastBackendEventAt < 8000) return;
  lastBackendEventAt = now;
  window.dispatchEvent(
    new CustomEvent("backend:request-failed", {
      detail: {
        message: backendErrorMessage(err),
        requestId:
          err.response?.headers?.["x-request-id"] ||
          err.response?.data?.request_id ||
          err.config?.headers?.["X-Client-Request-Id"] ||
          "",
        status: err.response?.status || 0,
      },
    }),
  );
}

function notifyDataChanged(res) {
  const method = String(res.config?.method || "get").toLowerCase();
  if (SAFE_RETRY_METHODS.has(method)) return;
  // Preview is a read-only POST; typing must not invalidate the whole application.
  if (/checkout-preview|\/auth\//.test(res.config?.url || "")) return;
  invalidateReads();
  const now = Date.now();
  if (now - lastDataChangeAt < 250) return;
  lastDataChangeAt = now;
  window.dispatchEvent(new CustomEvent("hsr:data-changed", {
    detail: { path: res.config?.url || "", method },
  }));
  try {
    localStorage.setItem("hsr:last-data-change", String(now));
  } catch {
    // Ignore storage failures in private browsing or locked-down clients.
  }
}

api.interceptors.request.use((cfg) => {
  cfg.headers = cfg.headers || {};
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  cfg.headers["X-Client-Request-Id"] = cfg.headers["X-Client-Request-Id"] || requestId();
  cfg.metadata = { startedAt: Date.now() };
  return cfg;
});

api.interceptors.response.use(
  (res) => {
    notifyDataChanged(res);
    return res;
  },
  async (err) => {
    if (shouldRetryRequest(err)) {
      err.config.__retryCount = (err.config.__retryCount || 0) + 1;
      await sleep(RETRY_DELAYS_MS[err.config.__retryCount - 1]);
      return api(err.config);
    }
    err.userMessage = backendErrorMessage(err);
    if (!err.response || err.response.status >= 500 || err.code === "ECONNABORTED") {
      notifyBackendFailure(err);
    }
    const isLogin = err.config?.url?.includes("/auth/login");
    if (err.response?.status === 401 && !isLogin) {
      localStorage.removeItem("token");
      window.location.reload();
    }
    return Promise.reject(err);
  },
);

export const getBackendHealth = async () => {
  if (DEV_BACKEND_WAKE_DELAY_MS > 0) {
    await sleep(DEV_BACKEND_WAKE_DELAY_MS);
  }
  return api.get("/ready", { noRetry: false });
};

// Auth
export const login = (username, password) =>
  api.post("/auth/login", { username, password });
export const getMe = () => api.get("/auth/me");
export const logout = () => api.post("/auth/logout");
export const changeAuth = (username, password) =>
  api.post("/auth/change", { username, password });
export const changeStaffAuth = (username, password) =>
  api.post("/auth/change-staff", { username, password });

// Sessions
export const startSession = (
  table_id,
  customer_name,
  rate,
  split,
  split_name,
  billing_mode = split ? "lp" : "single",
  players = [],
  tariff = {},
) =>
  api.post("/sessions/start", {
    table_id: tableKey(table_id),
    customer_name,
    rate,
    split,
    split_name,
    billing_mode,
    players,
    tariff_mode: tariff.tariff_mode || "hourly",
    package_id: tariff.package_id || "",
    player_type: tariff.player_type || "guest",
    member_id: tariff.member_id || null,
    booking_id: tariff.booking_id || null,
    player_count: tariff.player_count ?? 2,
  });

export const getSessionBookings = (table_id) => api.get(`/bookings/start-options/${tableKey(table_id)}`);

export const pauseSession = (table_id) =>
  api.post(`/sessions/pause/${tableKey(table_id)}`);

export const startGuestSession = (table_id) => api.post("/sessions/start", { table_id: tableKey(table_id) });
export const previewCheckout = (table_id, body) => api.post(`/sessions/checkout-preview/${tableKey(table_id)}`, body);
export const closeWithProposal = (table_id, body, discount_reason = "") => api.post(`/sessions/stop/${tableKey(table_id)}?discount_reason=${encodeURIComponent(discount_reason)}`, body);
export const getRecentMembers = () => api.get("/members/recent");
export const getSessionAlerts = () => getResource("/sessions/alerts");
export const acknowledgeWeeklySummary = (week) => api.post(`/sessions/weekly-summary/${encodeURIComponent(week)}/acknowledge`);
export const acknowledgeSessionAlert = (id) => api.post(`/sessions/alerts/${id}/acknowledge`);
export const getSessionControls = () => api.get("/settings/session-controls");
export const saveSessionControls = (body) => api.post("/settings/session-controls", body);
export const getSessionEdits = (params) => api.get("/reports/session-edits", { params });

const sessionCheckoutParams = (
  payment_method = "Cash",
  payer_name = "",
  discount_type = "none",
  discount_value = 0,
  closed_at_ms = "",
  discount_reason = "",
  payment_split = [],
  session_key = "",
  checkout_token = "",
) => {
  const params = new URLSearchParams({
    payment_method,
    payer_name,
    discount_type,
    discount_value: String(discount_value || 0),
  });
  if (closed_at_ms !== "" && closed_at_ms !== null && closed_at_ms !== undefined) {
    params.set("closed_at_ms", String(closed_at_ms));
  }
  if (discount_reason) params.set("discount_reason", discount_reason);
  if (Array.isArray(payment_split) && payment_split.length) {
    params.set("payment_split_json", JSON.stringify(payment_split));
  }
  if (session_key) params.set("session_key", session_key);
  if (checkout_token) params.set("checkout_token_value", checkout_token);
  return params.toString();
};

export const stopSession = (
  table_id,
  payment_method = "Cash",
  payer_name = "",
  discount_type = "none",
  discount_value = 0,
  closed_at_ms = "",
  discount_reason = "",
  payment_split = [],
  session_key = "",
  checkout_token = "",
) =>
  api.post(
    `/sessions/stop/${tableKey(table_id)}?${sessionCheckoutParams(
      payment_method,
      payer_name,
      discount_type,
      discount_value,
      closed_at_ms,
      discount_reason,
      payment_split,
      session_key,
      checkout_token,
    )}`,
  );
export const quoteSession = (
  table_id,
  payment_method = "Cash",
  discount_type = "none",
  discount_value = 0,
  closed_at_ms = "",
  checkout_token = "",
) =>
  api.get(
    `/sessions/quote/${tableKey(table_id)}?${sessionCheckoutParams(
      payment_method,
      "",
      discount_type,
      discount_value,
      closed_at_ms,
      "",
      [],
      "",
      checkout_token,
    )}`,
  );
export const resetSession = (table_id, manager_pin = "") =>
  api.post(
    `/sessions/reset/${tableKey(table_id)}?manager_pin=${encodeURIComponent(manager_pin)}`,
  );
export const addFood = (table_id, item, qty, mrp = null, player_name = "", session_key = null) =>
  api.post(`/sessions/${tableKey(table_id)}/food`, { item, qty, mrp, player_name, session_key });
export const updateSessionFood = (table_id, order_id, session_key, changes) =>
  api.patch(`/sessions/${tableKey(table_id)}/food/${encodeURIComponent(order_id)}`, { session_key, ...changes });
export const cancelSessionFood = (table_id, order_id, session_key) =>
  api.delete(`/sessions/${tableKey(table_id)}/food/${encodeURIComponent(order_id)}`, { params: { session_key } });
export const startFrame = (table_id) =>
  api.post(`/sessions/${tableKey(table_id)}/frames/start`);
export const closeFrame = (table_id, loser_name, frame_id = null) =>
  api.post(`/sessions/${tableKey(table_id)}/frames/close`, { loser_name, frame_id });
export const addReserve = (table_id, name, time) =>
  api.post(`/sessions/${tableKey(table_id)}/reserve`, { name, time });
export const cancelReserve = (table_id) =>
  api.delete(`/sessions/${tableKey(table_id)}/reserve`);
export const getActive = () => getResource("/sessions/active");
export const getTableState = () => getResource("/sessions/tables");
export const getLiveFloor = () => getResource("/sessions/live-floor");
export const transferSession = (table_id, target_table_id) =>
  api.post(`/sessions/transfer/${tableKey(table_id)}`, {
    target_table_id: tableKey(target_table_id),
  });

// Members
export const getMembers = () => getResource("/members/");
export const addMember = (name) => api.post("/members/", { name });
export const upgradeMember = (customerId) =>
  api.post(`/members/${encodeURIComponent(customerId)}/upgrade`);
export const deleteMember = (customerId) =>
  api.delete(`/members/${encodeURIComponent(customerId)}`);
export const restoreMember = (customerId, member) =>
  api.post(`/members/${encodeURIComponent(customerId)}/restore`, member);
export const searchMembers = (q) =>
  api.get(`/members/search?q=${encodeURIComponent(q)}`);
export const getMemberDuplicates = () => getResource("/members/duplicates");
export const mergeMembers = (primary_id, duplicate_id) =>
  api.post("/members/merge", { primary_id, duplicate_id });

// Reports
export const getSummary = () => getResource("/reports/summary");
export const getDashboardLive = (period = "today") =>
  api.get(`/reports/dashboard?period=${encodeURIComponent(period)}`);
export const getHistory = () => api.get("/reports/history");
export const exportCSV = (period = "all") =>
  api.get(`/reports/export?period=${period}`, { responseType: "blob" });
export const getAnalytics = () => api.get("/reports/analytics");

// Settings
export const getRates = () => api.get("/settings/rates");
export const getTariffs = () => api.get("/settings/tariffs");
export const saveTariffs = (catalog) => api.post("/settings/tariffs", catalog);
export const saveRates = (wr, pr, sr) => api.post("/settings/rates", { wr, pr, sr });
export const getMenu = () => getResource("/settings/menu");
export const getMenuFull = () => getResource("/settings/menu");
export const addMenuItem = (name, price, category = "Snacks") =>
  api.post("/settings/menu", { name, price, category });
export const updateMenuItem = (
  old_name,
  new_name,
  price,
  category = "Snacks",
) => api.post("/settings/menu/update", { old_name, new_name, price, category });
export const deleteMenuItem = (item_name) =>
  api.delete(`/settings/menu/${item_name}`);
export const restoreMenuItem = (item) => api.post("/settings/menu/restore", item);
export const setItemAvailability = (name, available) =>
  api.post(`/settings/menu/${encodeURIComponent(name)}/availability`, {
    available,
  });
export const resetDaily = (manager_pin = "") =>
  api.post(`/settings/reset-daily?manager_pin=${encodeURIComponent(manager_pin)}`);
export const clearAll = (manager_pin = "") =>
  api.post(`/settings/clear-all?manager_pin=${encodeURIComponent(manager_pin)}`);
export const getMinSession = () => api.get("/settings/min-session");
export const saveMinSession = (min_session) =>
  api.post("/settings/min-session", { min_session });
export const getBookingGrace = () => api.get("/settings/booking-grace");
export const saveBookingGrace = (booking_grace_minutes) =>
  api.post("/settings/booking-grace", { booking_grace_minutes });

// Food Orders
export const placeFoodOrder = (customer_name, items, payment_method = "Cash") =>
  api.post("/food/order", { customer_name, items, payment_method });
export const getFoodOrders = () => getResource("/food/orders");
export const cancelFoodOrder = (orderId) => api.delete(`/food/orders/${orderId}`);
export const restoreFoodOrder = (orderId, order) =>
  api.post(`/food/orders/${orderId}/restore`, order);
export const getFoodStats = () => api.get("/food/stats");

// Maintenance & Notes
export const updateNotes = (table_id, notes) =>
  api.post(`/sessions/${tableKey(table_id)}/notes`, { notes });
export const getTableHistory = (table_id) =>
  api.get(`/sessions/history/${tableKey(table_id)}`);
export const getTableAudit = (table_id) =>
  api.get(`/sessions/audit/${tableKey(table_id)}`);
export const getTableEvents = (table_id) =>
  api.get(`/sessions/events/${tableKey(table_id)}`);
export const getMaintenance = () => api.get("/sessions/maintenance");
export const setMaintenance = (table_id, reason) =>
  api.post(`/sessions/maintenance/${tableKey(table_id)}`, { reason });
export const clearMaintenance = (table_id) =>
  api.delete(`/sessions/maintenance/${tableKey(table_id)}`);

export const getTopCustomers = (period) =>
  api.get(`/reports/top-customers?period=${period}`);
export const getTableUtilization = () => api.get("/reports/table-utilization");
export const getClosingReport = () => api.get("/reports/closing-report");
export const closeDay = (opened_float, counted_cash, notes = "") =>
  api.post("/reports/day-close", { opened_float, counted_cash, notes });
export const getClosingInsights = () => api.get("/reports/closing-insights");
export const getAdvancedAnalytics = () => api.get("/reports/advanced-analytics");

// Operations
export const getPeakHours = () => api.get("/operations/peak-hours");
export const addPeakHour = (start_hour, end_hour, multiplier, label) =>
  api.post("/operations/peak-hours", {
    start_hour,
    end_hour,
    multiplier,
    label,
  });
export const updatePeakHour = (id, start_hour, end_hour, multiplier, label) =>
  api.put(`/operations/peak-hours/${id}`, {
    start_hour,
    end_hour,
    multiplier,
    label,
  });
export const deletePeakHour = (id) =>
  api.delete(`/operations/peak-hours/${id}`);
export const getCurrentRate = () => api.get("/operations/current-rate");
export const getGST = () => api.get("/operations/gst");
export const saveGST = (gst_percent) =>
  api.post("/operations/gst", { gst_percent });
export const getAuditLogs = (limit = 50) =>
  api.get(`/operations/audit-logs?limit=${limit}`);

// Waitlist / smart queue
export const getWaitlist = () => getResource("/waitlist");
export const addWaitlistEntry = (entry) => api.post("/waitlist", entry);
export const seatWaitlistEntry = (entryId, table_id) =>
  api.post(`/waitlist/${entryId}/seat`, { table_id: tableKey(table_id) });
export const cancelWaitlistEntry = (entryId) =>
  api.delete(`/waitlist/${entryId}`);

// Bookings
export const getBookings = () => getResource("/bookings");
export const createBooking = (booking) => api.post("/bookings", booking);
export const cancelBooking = (bookingId) => api.delete(`/bookings/${bookingId}`);
export const restoreBooking = (bookingId) => api.post(`/bookings/${bookingId}/restore`);

// Challenge board
export const getChallenges = () => api.get("/challenges");
export const createChallenge = (challenge) => api.post("/challenges", challenge);
export const matchChallenge = (challengeId, opponent_name) =>
  api.post(`/challenges/${challengeId}/match`, { opponent_name });
export const closeChallenge = (challengeId) =>
  api.delete(`/challenges/${challengeId}`);

// Tournaments
export const getTournaments = () => api.get("/tournaments");
export const createTournament = (name, game_type, entry_fee, players) =>
  api.post("/tournaments", { name, game_type, entry_fee, players });
export const getTournament = (id) => api.get(`/tournaments/${id}`);
export const recordTournamentWinner = (tournamentId, matchId, winner) =>
  api.post(`/tournaments/${tournamentId}/matches/${matchId}/winner`, {
    winner,
  });
export const closeTournament = (id) => api.post(`/tournaments/${id}/close`);

export default api;
