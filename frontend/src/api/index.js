import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLogin = err.config?.url?.includes("/auth/login");
    if (err.response?.status === 401 && !isLogin) {
      localStorage.removeItem("token");
      window.location.reload();
    }
    return Promise.reject(err);
  },
);

// Auth
export const login = (username, password) =>
  api.post("/auth/login", { username, password });
export const changeAuth = (username, password) =>
  api.post("/auth/change", { username, password });

// Sessions
export const startSession = (
  table_id,
  customer_name,
  rate,
  split,
  split_name,
  billing_mode = split ? "lp" : "single",
  players = [],
) =>
  api.post("/sessions/start", {
    table_id,
    customer_name,
    rate,
    split,
    split_name,
    billing_mode,
    players,
  });

export const pauseSession = (table_id) =>
  api.post(`/sessions/pause/${table_id}`);
export const stopSession = (
  table_id,
  payment_method = "Cash",
  payer_name = "",
  discount_type = "none",
  discount_value = 0,
) =>
  api.post(
    `/sessions/stop/${table_id}?payment_method=${encodeURIComponent(payment_method)}&payer_name=${encodeURIComponent(payer_name)}&discount_type=${encodeURIComponent(discount_type)}&discount_value=${encodeURIComponent(discount_value)}`,
  );
export const resetSession = (table_id, manager_pin = "") =>
  api.post(
    `/sessions/reset/${table_id}?manager_pin=${encodeURIComponent(manager_pin)}`,
  );
export const addFood = (table_id, item, qty, mrp = null, player_name = "") =>
  api.post(`/sessions/${table_id}/food`, { item, qty, mrp, player_name });
export const addReserve = (table_id, name, time) =>
  api.post(`/sessions/${table_id}/reserve`, { name, time });
export const cancelReserve = (table_id) =>
  api.delete(`/sessions/${table_id}/reserve`);
export const getActive = () => api.get("/sessions/active");

// Members
export const getMembers = () => api.get("/members");
export const addMember = (name) => api.post("/members", { name });
export const upgradeMember = (customerId) =>
  api.post(`/members/${encodeURIComponent(customerId)}/upgrade`);
export const deleteMember = (customerId) =>
  api.delete(`/members/${encodeURIComponent(customerId)}`);
export const searchMembers = (q) =>
  api.get(`/members/search?q=${encodeURIComponent(q)}`);
export const getMemberDuplicates = () => api.get("/members/duplicates");
export const mergeMembers = (primary_id, duplicate_id) =>
  api.post("/members/merge", { primary_id, duplicate_id });

// Reports
export const getSummary = () => api.get("/reports/summary");
export const getHistory = () => api.get("/reports/history");
export const exportCSV = (period = "all") =>
  api.get(`/reports/export?period=${period}`, { responseType: "blob" });
export const getAnalytics = () => api.get("/reports/analytics");

// Settings
export const getRates = () => api.get("/settings/rates");
export const saveRates = (wr, pr, sr) => api.post("/settings/rates", { wr, pr, sr });
export const getMenu = () => api.get("/settings/menu");
export const getMenuFull = () => api.get("/settings/menu");
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
export const getFoodOrders = () => api.get("/food/orders");
export const getFoodStats = () => api.get("/food/stats");

// Maintenance & Notes
export const updateNotes = (table_id, notes) =>
  api.post(`/sessions/${table_id}/notes`, { notes });
export const getTableHistory = (table_id) =>
  api.get(`/sessions/history/${table_id}`);
export const getMaintenance = () => api.get("/sessions/maintenance");
export const setMaintenance = (table_id, reason) =>
  api.post(`/sessions/maintenance/${table_id}`, { reason });
export const clearMaintenance = (table_id) =>
  api.delete(`/sessions/maintenance/${table_id}`);

export const getTopCustomers = (period) =>
  api.get(`/reports/top-customers?period=${period}`);
export const getTableUtilization = () => api.get("/reports/table-utilization");
export const getClosingReport = () => api.get("/reports/closing-report");
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
export const deletePeakHour = (id) =>
  api.delete(`/operations/peak-hours/${id}`);
export const getCurrentRate = () => api.get("/operations/current-rate");
export const getGST = () => api.get("/operations/gst");
export const saveGST = (gst_percent) =>
  api.post("/operations/gst", { gst_percent });
export const getAuditLogs = (limit = 50) =>
  api.get(`/operations/audit-logs?limit=${limit}`);

// Waitlist / smart queue
export const getWaitlist = () => api.get("/waitlist");
export const addWaitlistEntry = (entry) => api.post("/waitlist", entry);
export const seatWaitlistEntry = (entryId, table_id) =>
  api.post(`/waitlist/${entryId}/seat`, { table_id });
export const cancelWaitlistEntry = (entryId) =>
  api.delete(`/waitlist/${entryId}`);

// Bookings
export const getBookings = () => api.get("/bookings");
export const createBooking = (booking) => api.post("/bookings", booking);
export const cancelBooking = (bookingId) => api.delete(`/bookings/${bookingId}`);

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
