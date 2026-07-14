import { lazy, Suspense, useState, useEffect } from "react";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import CommandBar from "./components/CommandBar.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { getMe, getSummary } from "./api/index.js";

const Dashboard = lazy(() => import("./components/Dashboard.jsx"));
const TablesTab = lazy(() => import("./components/tabs/TablesTab.jsx"));
const ReportsTab = lazy(() => import("./components/tabs/ReportsTab.jsx"));
const ClosingTab = lazy(() => import("./components/tabs/ClosingTab.jsx"));
const SettingsTab = lazy(() => import("./components/tabs/SettingsTab.jsx"));
const FoodTab = lazy(() => import("./components/tabs/FoodTab.jsx"));
const TournamentTab = lazy(() => import("./components/tabs/TournamentTab.jsx"));

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));
  const [role, setRole] = useState(localStorage.getItem("role") || "admin");
  const [page, setPage] = useState("tables");
  const [newSessionRequest, setNewSessionRequest] = useState(0);
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
    if (!loggedIn) return;
    fetchCurrentUser();
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 10000);
    return () => clearInterval(iv);
  }, [loggedIn]);

  useEffect(() => {
    if (role === "staff" && page === "reports") {
      setPage("tables");
    }
  }, [role, page]);

  async function fetchCurrentUser() {
    try {
      const res = await getMe();
      const nextRole = res.data.role || "admin";
      setRole(nextRole);
      localStorage.setItem("role", nextRole);
      localStorage.setItem("username", res.data.username || "");
    } catch (e) {
      console.error(e);
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
      setLoggedIn(false);
    }
  }

  function openNewSession() {
    setPage("tables");
    setNewSessionRequest((request) => request + 1);
  }

  if (!loggedIn) {
    return (
      <Login
        onLogin={(nextRole) => {
          setRole(nextRole || "admin");
          setLoggedIn(true);
        }}
      />
    );
  }

  const PAGE_TITLES = {
    dashboard: "Dashboard",
    tables: "Tables",
    reports: "Reports",
    closing: "Daily Closing",
    food: "Food Orders",
    tournaments: "Tournaments",
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
            onNewSession={openNewSession}
          />
          <CommandBar
            page={page}
            setPage={setPage}
            onNewSession={openNewSession}
            role={role}
          />
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
              {page === "settings" && <SettingsTab role={role} />}
            </div>
          </Suspense>
        </div>
      </div>
    </ToastProvider>
  );
}
