import { lazy, Suspense, useState, useEffect } from "react";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import CommandBar from "./components/CommandBar.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { getBackendHealth, getMe, getSummary } from "./api/index.js";

const Dashboard = lazy(() => import("./components/Dashboard.jsx"));
const TablesTab = lazy(() => import("./components/tabs/TablesTab.jsx"));
const ReportsTab = lazy(() => import("./components/tabs/ReportsTab.jsx"));
const ClosingTab = lazy(() => import("./components/tabs/ClosingTab.jsx"));
const SettingsTab = lazy(() => import("./components/tabs/SettingsTab.jsx"));
const FoodTab = lazy(() => import("./components/tabs/FoodTab.jsx"));
const TournamentTab = lazy(() => import("./components/tabs/TournamentTab.jsx"));
const MembersTab = lazy(() => import("./components/tabs/MembersTab.jsx"));
const OperationsTab = lazy(() => import("./components/tabs/OperationsTab.jsx"));
const ClubSuiteTab = lazy(() => import("./components/tabs/ClubSuiteTab.jsx"));

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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));
  const [role, setRole] = useState(localStorage.getItem("role") || "admin");
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [page, setPage] = useState("dashboard");
  const [newSessionRequest, setNewSessionRequest] = useState(0);
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
    return () => clearInterval(iv);
  }, [loggedIn]);

  useEffect(() => {
    const adminOnly = new Set([
      "reports",
      "settings",
      "operations",
      "members",
      "staff",
      "billing",
      "inventory",
      "notifications",
      "tournaments",
    ]);
    if (role === "staff" && adminOnly.has(page)) {
      setPage("tables");
    }
  }, [role, page]);

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
        requestId: e.config?.headers?.["X-Client-Request-Id"] || "",
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

  function handleLogout() {
    if (confirm("Are you sure you want to logout?")) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("username");
      setRole("admin");
      setUsername("");
      setLoggedIn(false);
    }
  }

  function openNewSession() {
    setPage("tables");
    setNewSessionRequest((request) => request + 1);
  }

  if (!loggedIn) {
    return (
      <>
        <BackendStatusBanner backendStatus={backendStatus} onRetry={checkBackend} />
        <Login
          onLogin={(nextRole, nextUsername) => {
            setRole(nextRole || "admin");
            setUsername(nextUsername || "");
            setLoggedIn(true);
          }}
        />
      </>
    );
  }

  const PAGE_TITLES = {
    dashboard: "Executive Overview",
    tables: "Live Table Floor",
    waitlist: "Smart Waitlist",
    reservations: "Reservations & Slots",
    food: "Food & Cafe POS",
    billing: "Billing & Invoices",
    members: "Club Members",
    tournaments: "Tournament Hub",
    closing: "Daily Closing",
    reports: "Analytics & Reports",
    operations: "Operations Control",
    inventory: "Inventory & Stocks",
    staff: "Activity Log",
    notifications: "Notification Center",
    settings: "Club Settings",
  };

  return (
    <ToastProvider>
      <div className="shell">
        <Sidebar
          page={page}
          setPage={setPage}
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
            onNavigate={setPage}
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
                <Dashboard metrics={metrics} onNavigate={setPage} role={role} />
              )}
              {page === "tables" && (
                <TablesTab
                  onSessionEnd={fetchMetrics}
                  newSessionRequest={newSessionRequest}
                />
              )}
              {page === "reports" && role === "admin" && <ReportsTab />}
              {page === "closing" && <ClosingTab />}
              {page === "food" && <FoodTab />}
              {page === "tournaments" && <TournamentTab />}
              {page === "members" && role === "admin" && <MembersTab />}
              {page === "operations" && role === "admin" && <OperationsTab />}
              {[
                "waitlist",
                "reservations",
                "billing",
                "inventory",
                "notifications",
                "staff",
              ].includes(page) && <ClubSuiteTab view={page} />}
              {page === "settings" && (
                <SettingsTab
                  role={role}
                  onOpenTables={() => {
                    setPage("tables");
                    openNewSession();
                  }}
                />
              )}
            </div>
          </Suspense>
        </div>
        <CommandBar
          page={page}
          setPage={setPage}
          onNewSession={openNewSession}
          role={role}
        />
      </div>
    </ToastProvider>
  );
}
