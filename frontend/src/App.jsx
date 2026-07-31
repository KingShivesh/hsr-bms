import { lazy, Suspense, useState, useEffect } from "react";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
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
const BillingTab = lazy(() => import("./components/tabs/BillingTab.jsx"));
const InventoryTab = lazy(() => import("./components/tabs/InventoryTab.jsx"));
const NotificationsTab = lazy(() => import("./components/tabs/NotificationsTab.jsx"));

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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));
  const [role, setRole] = useState(localStorage.getItem("role") || "admin");
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [page, setPage] = useState("tables");
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
    if (role === "staff" && ["reports", "billing", "inventory", "members"].includes(page)) {
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
    dashboard: "Dashboard",
    tables: "Tables",
    reports: "Reports",
    closing: "Daily Closing",
    food: "Food Orders",
    tournaments: "Tournaments",
    members: "Members",
    billing: "Billing & Invoices",
    inventory: "Inventory",
    notifications: "Notifications",
    settings: "Settings",
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
            page={page}
            role={role}
            username={username}
            activeTables={metrics.active_tables}
            onNavigate={setPage}
          />
          <BackendStatusBanner backendStatus={backendStatus} onRetry={checkBackend} />
          <Suspense
            fallback={
              <div className="page">
                <div className="loading-state">
                  <div className="loading-state-icon">
                    <i className="ti ti-loader-2" aria-hidden="true" />
                  </div>
                  <div className="loading-state-title">Loading view...</div>
                </div>
              </div>
            }
          >
            <div className="page">
              {page === "dashboard" && (
                <Dashboard metrics={metrics} onNavigate={setPage} />
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
              {page === "billing" && role === "admin" && <BillingTab />}
              {page === "inventory" && role === "admin" && <InventoryTab />}
              {page === "notifications" && <NotificationsTab />}
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
      </div>
    </ToastProvider>
  );
}
