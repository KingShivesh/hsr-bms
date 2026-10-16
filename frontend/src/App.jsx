import { Icon as HsrIcon, Button as HsrButton } from "./components/ui/index.js";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
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
import RouteErrorBoundary from "./components/RouteErrorBoundary.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import SessionAlertsProvider from "./features/sessions/SessionAlertsProvider.jsx";
import { ConfirmProvider } from "./components/ConfirmDialog.jsx";
import { useConfirm } from "./components/confirmContext.js";
import { getBackendHealth, getMe, getSummary, logout } from "./api/index.js";
import { loadPage } from "./routes.js";
import ProductProvider, { SetupChecklist } from "./product/ProductProvider.jsx";
import ProductSettings from "./product/ProductSettings.jsx";
import ProductPages from "./product/ProductPages.jsx";
import TrustSignals from "./product/TrustSignals.jsx";

const Dashboard = lazy(() => loadPage("dashboard"));
const LiveFloor = lazy(() => loadPage("live-floor"));
const BookingsPage = lazy(() => loadPage("reservations"));
const CustomersPage = lazy(() => loadPage("members"));
const SalesPage = lazy(() => loadPage("billing"));
const TablesTab = lazy(() => loadPage("tables"));
const ReportsTab = lazy(() => loadPage("reports"));
const ClosingTab = lazy(() => loadPage("closing"));
const SettingsTab = lazy(() => loadPage("settings"));
const FoodTab = lazy(() => loadPage("food"));
const TournamentTab = lazy(() => loadPage("tournaments"));
const OperationsTab = lazy(() => loadPage("operations"));
const ClubSuiteTab = lazy(() => loadPage("inventory"));

const DEFAULT_PAGE = "live-floor";
const ROUTE_TO_PAGE = {
  "/dashboard": "dashboard",
  "/live-floor": "live-floor",
  "/inventory": "inventory",
  "/bookings": "reservations",
  "/customers": "members",
  "/sales": "billing",
  "/analytics": "reports",
  "/cafe-pos": "food",
  "/waitlist": "waitlist",
  "/legacy-table-controls": "tables",
  "/tournaments": "tournaments",
  "/daily-closing": "closing",
  "/pricing-rules": "operations",
  "/audit-log": "staff",
  "/settings": "settings",
  "/help": "help",
  "/status": "status",
  "/changelog": "changelog",
  "/demo": "demo",
};
const PAGE_TO_ROUTE = Object.fromEntries(
  Object.entries(ROUTE_TO_PAGE).map(([route, page]) => [page, route]),
);

const PAGE_TITLES = {
  "live-floor": "Live Floor",
  dashboard: "Executive Overview",
  tables: "Advanced Table Controls",
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
  settings: "Club Settings",
  help: "Help & Documentation",
  status: "Service Status",
  changelog: "What’s New",
  demo: "Sample Workspace",
  "not-found": "Page Not Found",
};

const ADMIN_ONLY_PAGES = new Set([
  "reports",
  "settings",
  "operations",
  "members",
  "staff",
  "billing",
  "inventory",
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
  const connecting = backendStatus.state === "checking" && backendStatus.showWakeMessage;
  if (backendStatus.state !== "offline" && !connecting) return null;
  return (
    <div className={`backend-status-banner ${connecting ? "is-connecting" : "is-offline"}`} role="status">
      <HsrIcon className={`ti ${connecting ? "ti-loader-2" : "ti-alert-triangle"}`} aria-hidden="true" />
      <div className="backend-status-copy">
        <span>{backendStatus.message}</span>
        {connecting && (
          <small>The free-tier keep-alive can occasionally miss a scheduled run. The server may still need a moment to wake.</small>
        )}
        {backendStatus.requestId && <code>{backendStatus.requestId}</code>}
      </div>
      {!connecting && (
        <HsrButton native type="button" onClick={onRetry}>
          Retry
        </HsrButton>
      )}
      {connecting && <div className="backend-status-progress" aria-hidden="true" />}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-label="Loading page">
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
  const backendWakeTimerRef = useRef(null);
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
    showWakeMessage: false,
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
    checkBackend({ showWakeDelay: true });
    const healthIv = setInterval(checkBackend, 60000);
    const handleBackendFailure = (event) => {
      setBackendStatus({
        state: "offline",
        message: event.detail?.message || "Backend is unreachable.",
        requestId: event.detail?.requestId || "",
        showWakeMessage: false,
      });
    };
    window.addEventListener("backend:request-failed", handleBackendFailure);
    return () => {
      clearInterval(healthIv);
      if (backendWakeTimerRef.current) {
        clearTimeout(backendWakeTimerRef.current);
      }
      window.removeEventListener("backend:request-failed", handleBackendFailure);
    };
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetchCurrentUser();
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 20000);
    let refreshTimer;
    const scheduleMetrics = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(fetchMetrics, 150); };
    const handleStorageChange = (event) => {
      if (event.key === "hsr:last-data-change") scheduleMetrics();
    };
    window.addEventListener("hsr:data-changed", scheduleMetrics);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      clearInterval(iv);
      clearTimeout(refreshTimer);
      window.removeEventListener("hsr:data-changed", scheduleMetrics);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loggedIn]);

  const routedPage = ROUTE_TO_PAGE[location.pathname] || null;
  const page = routedPage || (location.pathname === "/" || location.pathname === "/login" ? legacyPage : "not-found");

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
    const route = PAGE_TO_ROUTE[nextPage];
    if (route) {
      const query = new URLSearchParams();
      if (options.tableId) query.set("table", options.tableId);
      if (options.tableAction) query.set("action", options.tableAction);
      if (options.section) query.set("section", options.section);
      navigate(query.size ? `${route}?${query}` : route, { replace: options.replace });
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

  async function checkBackend({ showWakeDelay = false } = {}) {
    if (backendWakeTimerRef.current) {
      clearTimeout(backendWakeTimerRef.current);
      backendWakeTimerRef.current = null;
    }
    if (showWakeDelay) {
      setBackendStatus({
        state: "checking",
        message: "Checking backend connection...",
        requestId: "",
        showWakeMessage: false,
      });
      backendWakeTimerRef.current = setTimeout(() => {
        setBackendStatus((current) => {
          if (current.state !== "checking") return current;
          return {
            state: "checking",
            message: "Connecting to server... this can take up to a minute.",
            requestId: "",
            showWakeMessage: true,
          };
        });
      }, 1400);
    }
    try {
      await getBackendHealth();
      setBackendStatus({
        state: "online",
        message: "",
        requestId: "",
        showWakeMessage: false,
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
        showWakeMessage: false,
      });
    } finally {
      if (backendWakeTimerRef.current) {
        clearTimeout(backendWakeTimerRef.current);
        backendWakeTimerRef.current = null;
      }
    }
  }

  async function fetchMetrics() {
    try {
      const res = await getSummary();
      setMetrics(current => JSON.stringify(current) === JSON.stringify(res.data) ? current : res.data);
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
    try {
      await logout();
    } catch (error) {
      if (error.response?.status !== 401) {
        await requestConfirm({ title: "Could not log out securely", message: "The server could not end this session. Check your connection and try again.", confirmLabel: "OK", tone: "warning" });
        return;
      }
    }
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
    if (location.pathname === "/status") return <main className="product-public"><ProductPages page="status" /></main>;
    if (location.pathname !== "/login") {
      return <Navigate to={routeForLoginRedirect(location.pathname)} replace />;
    }
    return (
      <>
        <BackendStatusBanner backendStatus={backendStatus} onRetry={() => checkBackend({ showWakeDelay: true })} />
        <Login
          onLogin={(nextRole, nextUsername) => {
            setRole(nextRole || "admin");
            setUsername(nextUsername || "");
            setLoggedIn(true);
            const from = safeRouteFromSearch(location.search);
            navigate(from || (nextRole === "admin" ? "/dashboard" : "/"), {
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
    return <Navigate to={from || (role === "admin" ? "/dashboard" : "/")} replace state={from ? undefined : { page: legacyPage }} />;
  }

  return (
    <ToastProvider>
    <SessionAlertsProvider onNavigate={goToPage}>
    <ProductProvider role={role} username={username} onNavigate={goToPage} onLogout={handleLogout} onNewSession={openNewSession}>
      <div className="shell">
        <Sidebar
          page={page}
          setPage={goToPage}
          onLogout={handleLogout}
          activeTables={metrics.active_tables}
          role={role}
        />
        <div className={`main-content page-${page}`}>
          <Topbar
            title={PAGE_TITLES[page]}
            role={role}
            username={username}
            activeTables={metrics.active_tables}
            totalTables={5}
            onNavigate={goToPage}
          />
          <BackendStatusBanner backendStatus={backendStatus} onRetry={() => checkBackend({ showWakeDelay: true })} />
          <TrustSignals />
          <RouteErrorBoundary key={`${location.pathname}:${page}`}>
          <Suspense
            fallback={
              <div className="page">
                <PageSkeleton />
              </div>
            }
          >
            <div className="page route-page" key={`${location.pathname}:${page}`}>
              {page === "dashboard" && (
                <><SetupChecklist /><Dashboard metrics={metrics} onNavigate={goToPage} role={role} /></>
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
                  onNavigate={goToPage}
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
              {page === "tournaments" && <TournamentTab onNavigate={goToPage} />}
              {page === "members" && role === "admin" && <CustomersPage />}
              {page === "operations" && role === "admin" && <OperationsTab />}
              {page === "billing" && role === "admin" && <SalesPage />}
              {[
                "waitlist",
                "inventory",
                "staff",
              ].includes(page) && <ClubSuiteTab view={page} />}
              {page === "reservations" && <BookingsPage onNavigate={goToPage} />}
              {page === "settings" && (
                <ProductSettings><SettingsTab
                  role={role}
                  onNavigate={goToPage}
                  onOpenTables={() => {
                    goToPage("tables");
                    openNewSession();
                  }}
                /></ProductSettings>
              )}
              {["help", "status", "changelog", "demo", "not-found"].includes(page) && <ProductPages page={page} />}
            </div>
          </Suspense>
          </RouteErrorBoundary>
        </div>
        <CommandBar
          page={page}
          setPage={goToPage}
          onNewSession={openNewSession}
          role={role}
        />
      </div>
    </ProductProvider>
    </SessionAlertsProvider>
    </ToastProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppInner />} />
      <Route path="/login" element={<AppInner />} />
      <Route path="/dashboard" element={<AppInner />} />
      <Route path="/live-floor" element={<AppInner />} />
      <Route path="/inventory" element={<AppInner />} />
      <Route path="/bookings" element={<AppInner />} />
      <Route path="/customers" element={<AppInner />} />
      <Route path="/sales" element={<AppInner />} />
      <Route path="/analytics" element={<AppInner />} />
      <Route path="/cafe-pos" element={<AppInner />} />
      <Route path="/waitlist" element={<AppInner />} />
      <Route path="/legacy-table-controls" element={<AppInner />} />
      <Route path="/tournaments" element={<AppInner />} />
      <Route path="/daily-closing" element={<AppInner />} />
      <Route path="/pricing-rules" element={<AppInner />} />
      <Route path="/audit-log" element={<AppInner />} />
      <Route path="/settings" element={<AppInner />} />
      <Route path="/help" element={<AppInner />} />
      <Route path="/status" element={<AppInner />} />
      <Route path="/changelog" element={<AppInner />} />
      <Route path="/demo" element={<AppInner />} />
      <Route path="*" element={<AppInner />} />
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
