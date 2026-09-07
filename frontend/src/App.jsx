import { lazy, Suspense, useState, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import CommandBar from "./components/CommandBar.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ConfirmProvider } from "./components/ConfirmDialog.jsx";
import { useConfirm } from "./components/confirmContext.js";
import { getBackendHealth, getMe, getSummary } from "./api/index.js";

const Dashboard = lazy(() => import("./components/Dashboard.jsx"));
const LiveFloor = lazy(() => import("./features/live-floor/LiveFloor.jsx"));
const BookingsPage = lazy(() => import("./features/bookings/BookingsPage.jsx"));
const CustomersPage = lazy(() => import("./features/customers/CustomersPage.jsx"));
const SalesPage = lazy(() => import("./features/sales/SalesPage.jsx"));
const TablesTab = lazy(() => import("./components/tabs/TablesTab.jsx"));
const ReportsTab = lazy(() => import("./components/tabs/ReportsTab.jsx"));
const ClosingTab = lazy(() => import("./components/tabs/ClosingTab.jsx"));
const SettingsTab = lazy(() => import("./components/tabs/SettingsTab.jsx"));
const FoodTab = lazy(() => import("./components/tabs/FoodTab.jsx"));
const TournamentTab = lazy(() => import("./components/tabs/TournamentTab.jsx"));
const OperationsTab = lazy(() => import("./components/tabs/OperationsTab.jsx"));
const ClubSuiteTab = lazy(() => import("./components/tabs/ClubSuiteTab.jsx"));

const DEFAULT_PAGE = "live-floor";
const ROUTE_TO_PAGE = {
  "/dashboard": "dashboard",
};

const PAGE_TITLES = {
  "live-floor": "Live Floor",
  dashboard: "Executive Overview",
  tables: "Legacy Table Controls",
  waitlist: "Smart Waitlist",
  reservations: "Bookings",
  food: "Food & Cafe POS",
  billing: "Sales",
  members: "Customers",
  tournaments: "Tournament Hub",
  closing: "Daily Closing",
  reports: "Analytics & Reports",
  operations: "Pricing & Rules",
  inventory: "Inventory & Stocks",
  staff: "Audit Log",
  notifications: "Notification Center",
  settings: "Club Settings",
};

const ADMIN_ONLY_PAGES = new Set([
  "reports",
  "settings",
  "operations",
  "members",
  "staff",
  "billing",
  "inventory",
  "notifications",
  "tournaments",
  "dashboard",
]);

function routeForLoginRedirect(pathname) {
  if (ROUTE_TO_PAGE[pathname]) {
    return `/login?from=${encodeURIComponent(pathname)}`;
  }
  return "/login";
}

function safeRouteFromSearch(search) {
  const from = new URLSearchParams(search).get("from");
  return from && ROUTE_TO_PAGE[from] ? from : "";
}

function BackendStatusBanner({ backendStatus, onRetry }) {
  if (backendStatus.state !== "offline") return null;
  return (
    <div className="backend-status-banner" role="status">
      <i className="ti ti-alert-triangle" aria-hidden="true" />
      <span>{backendStatus.message}</span>
      {backendStatus.requestId && <code>{backendStatus.requestId}</code>}
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-label="Loading page">
      <div className="page-skeleton-status">
        <i className="ti ti-loader-2" aria-hidden="true" />
        <span>Loading page...</span>
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

function AppInner() {
  const { requestConfirm } = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));
  const [role, setRole] = useState(localStorage.getItem("role") || "admin");
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [legacyPage, setLegacyPage] = useState(DEFAULT_PAGE);
  const [newSessionRequest, setNewSessionRequest] = useState(0);
  const [foodOrderContext, setFoodOrderContext] = useState(null);
  const [backendStatus, setBackendStatus] = useState({
    state: "checking",
    message: "Checking backend connection...",
    requestId: "",
  });
  const [metrics, setMetrics] = useState({
    sale: 0,
    cust: 0,
    food: 0,
    active_tables: 0,
    sessions: 0,
    avg_time: 0,
    top_table: "-",
  });

  useEffect(() => {
    checkBackend();
    const healthIv = setInterval(checkBackend, 60000);
    const handleBackendFailure = (event) => {
      setBackendStatus({
        state: "offline",
        message: event.detail?.message || "Backend is unreachable.",
        requestId: event.detail?.requestId || "",
      });
    };
    window.addEventListener("backend:request-failed", handleBackendFailure);
    return () => {
      clearInterval(healthIv);
      window.removeEventListener("backend:request-failed", handleBackendFailure);
    };
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetchCurrentUser();
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 20000);
    const handleStorageChange = (event) => {
      if (event.key === "hsr:last-data-change") fetchMetrics();
    };
    window.addEventListener("hsr:data-changed", fetchMetrics);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      clearInterval(iv);
      window.removeEventListener("hsr:data-changed", fetchMetrics);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loggedIn]);

  const routedPage = ROUTE_TO_PAGE[location.pathname] || null;
  const page = routedPage || legacyPage;

  useEffect(() => {
    if (location.pathname !== "/") return;
    const statePage = location.state?.page;
    if (statePage && PAGE_TITLES[statePage]) {
      setLegacyPage(statePage);
    }
  }, [location.pathname, location.state]);

  useEffect(() => {
    if (!loggedIn) return;
    if (role === "staff" && ADMIN_ONLY_PAGES.has(page)) {
      setLegacyPage(DEFAULT_PAGE);
      if (location.pathname !== "/") {
        navigate("/", { replace: true, state: { page: DEFAULT_PAGE } });
      }
    }
  }, [loggedIn, location.pathname, navigate, page, role]);

  function goToPage(nextPage, options = {}) {
    if (nextPage === "dashboard") {
      navigate("/dashboard", { replace: options.replace });
      return;
    }
    setLegacyPage(nextPage);
    if (location.pathname !== "/" || location.state?.page !== nextPage) {
      navigate("/", {
        replace: options.replace,
        state: { page: nextPage },
      });
    }
  }

  async function fetchCurrentUser() {
    try {
      const res = await getMe();
      const nextRole = res.data.role || "admin";
      const nextUsername = res.data.username || "";
      setRole(nextRole);
      setUsername(nextUsername);
      localStorage.setItem("role", nextRole);
      localStorage.setItem("username", nextUsername);
    } catch (e) {
      console.error(e);
    }
  }

  async function checkBackend() {
    try {
      await getBackendHealth();
      setBackendStatus({
        state: "online",
        message: "",
        requestId: "",
      });
    } catch (e) {
      setBackendStatus({
        state: "offline",
        message: e.userMessage || "Backend is unreachable.",
        requestId:
          e.response?.headers?.["x-request-id"] ||
          e.response?.data?.request_id ||
          e.config?.headers?.["X-Client-Request-Id"] ||
          "",
      });
    }
  }

  async function fetchMetrics() {
    try {
      const res = await getSummary();
      setMetrics(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleLogout() {
    const confirmed = await requestConfirm({
      title: "Log out?",
      message: "You will return to the HSR BMS login screen.",
      confirmLabel: "Log out",
      tone: "warning",
    });
    if (!confirmed) return;
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    setRole("admin");
    setUsername("");
    setLoggedIn(false);
    setLegacyPage(DEFAULT_PAGE);
    navigate("/login", { replace: true });
  }

  function openNewSession() {
    goToPage("live-floor");
    setNewSessionRequest((request) => request + 1);
  }

  function openFoodOrder(context = {}) {
    setFoodOrderContext({
      tableId: context.tableId || "",
      playerName: context.playerName || "",
      requestedAt: Date.now(),
    });
    goToPage("food");
  }

  if (!loggedIn) {
    if (location.pathname !== "/login") {
      return <Navigate to={routeForLoginRedirect(location.pathname)} replace />;
    }
    return (
      <>
        <BackendStatusBanner backendStatus={backendStatus} onRetry={checkBackend} />
        <Login
          onLogin={(nextRole, nextUsername) => {
            setRole(nextRole || "admin");
            setUsername(nextUsername || "");
            setLoggedIn(true);
            const from = safeRouteFromSearch(location.search);
            navigate(from || "/", {
              replace: true,
              state: from ? undefined : { page: DEFAULT_PAGE },
            });
          }}
        />
      </>
    );
  }

  if (location.pathname === "/login") {
    const from = safeRouteFromSearch(location.search);
    return <Navigate to={from || "/"} replace state={from ? undefined : { page: legacyPage }} />;
  }

  return (
    <ToastProvider>
      <div className="shell">
        <Sidebar
          page={page}
          setPage={goToPage}
          onLogout={handleLogout}
          activeTables={metrics.active_tables}
          role={role}
        />
        <div className="main-content">
          <Topbar
            title={PAGE_TITLES[page]}
            role={role}
            username={username}
            activeTables={metrics.active_tables}
            totalTables={5}
            onNavigate={goToPage}
          />
          <BackendStatusBanner backendStatus={backendStatus} onRetry={checkBackend} />
          <Suspense
            fallback={
              <div className="page">
                <PageSkeleton />
              </div>
            }
          >
            <div className="page">
              {page === "dashboard" && (
                <Dashboard metrics={metrics} onNavigate={goToPage} role={role} />
              )}
              {page === "live-floor" && (
                <LiveFloor
                  username={username}
                  role={role}
                  onNavigate={goToPage}
                  newSessionRequest={newSessionRequest}
                />
              )}
              {page === "tables" && (
                <TablesTab
                  onSessionEnd={fetchMetrics}
                  newSessionRequest={newSessionRequest}
                  onOpenFoodOrder={openFoodOrder}
                />
              )}
              {page === "reports" && role === "admin" && <ReportsTab onNavigate={goToPage} />}
              {page === "closing" && <ClosingTab />}
              {page === "food" && (
                <FoodTab
                  onNavigate={goToPage}
                  role={role}
                  orderContext={foodOrderContext}
                  onOrderContextHandled={() => setFoodOrderContext(null)}
                />
              )}
              {page === "tournaments" && <TournamentTab />}
              {page === "members" && role === "admin" && <CustomersPage />}
              {page === "operations" && role === "admin" && <OperationsTab />}
              {page === "billing" && role === "admin" && <SalesPage />}
              {[
                "waitlist",
                "inventory",
                "notifications",
                "staff",
              ].includes(page) && <ClubSuiteTab view={page} />}
              {page === "reservations" && <BookingsPage />}
              {page === "settings" && (
                <SettingsTab
                  role={role}
                  onOpenTables={() => {
                    goToPage("tables");
                    openNewSession();
                  }}
                />
              )}
            </div>
          </Suspense>
        </div>
        <CommandBar
          page={page}
          setPage={goToPage}
          onNewSession={openNewSession}
          role={role}
        />
      </div>
    </ToastProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppInner />} />
      <Route path="/login" element={<AppInner />} />
      <Route path="/dashboard" element={<AppInner />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfirmProvider>
        <AppRoutes />
      </ConfirmProvider>
    </BrowserRouter>
  );
}
