import { useState, useEffect } from "react";

export default function Topbar({ title, role = "admin", username = "" }) {
  const [dt, setDt] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("darkMode") === "true",
  );
  const displayName = username || role;

  useEffect(() => {
    function tick() {
      const d = new Date();
      setDt(
        d.toLocaleDateString("en-IN", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        }) +
          " • " +
          d.toLocaleTimeString("en-IN"),
      );
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (dark) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
    localStorage.setItem("darkMode", dark);
  }, [dark]);

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">
        <div className={`topbar-user-chip ${role === "staff" ? "staff" : "admin"}`}>
          <i className={`ti ${role === "staff" ? "ti-user" : "ti-shield-lock"}`} aria-hidden="true" />
          <strong>{displayName}</strong>
        </div>
        <div className="topbar-date">{dt}</div>

        {/* Dark mode toggle */}
        <button
          className="topbar-icon-btn"
          onClick={() => setDark((p) => !p)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <i className={`ti ${dark ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
        </button>

      </div>
    </div>
  );
}
