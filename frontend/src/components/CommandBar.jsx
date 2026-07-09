import { useEffect, useMemo, useState } from "react";

export default function CommandBar({ page, setPage, onNewSession }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const commands = useMemo(
    () => [
      {
        id: "new-session",
        label: "New session",
        hint: "Open Tables",
        icon: "ti-plus",
        action: () => onNewSession(),
      },
      {
        id: "queue",
        label: "Smart table queue",
        hint: "Tables",
        icon: "ti-list-check",
        action: () => setPage("tables"),
      },
      {
        id: "dashboard",
        label: "Dashboard",
        hint: "Owner digest",
        icon: "ti-layout-dashboard",
        action: () => setPage("dashboard"),
      },
      {
        id: "tables",
        label: "Tables",
        hint: "Floor view",
        icon: "ti-circle-dot",
        action: () => setPage("tables"),
      },
      {
        id: "members",
        label: "Members",
        hint: "Customer profiles",
        icon: "ti-users",
        action: () => setPage("members"),
      },
      {
        id: "food",
        label: "Food orders",
        hint: "Menu and cart",
        icon: "ti-tools-kitchen-2",
        action: () => setPage("food"),
      },
      {
        id: "reports",
        label: "Reports",
        hint: "Closing and audit",
        icon: "ti-chart-bar",
        action: () => setPage("reports"),
      },
      {
        id: "tournaments",
        label: "Tournaments",
        hint: "Matches and brackets",
        icon: "ti-trophy",
        action: () => setPage("tournaments"),
      },
      {
        id: "settings",
        label: "Settings",
        hint: "Pricing and controls",
        icon: "ti-settings",
        action: () => setPage("settings"),
      },
    ],
    [onNewSession, setPage],
  );

  const filtered = commands.filter((cmd) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${cmd.label} ${cmd.hint}`.toLowerCase().includes(q);
  });

  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(cmd) {
    cmd.action();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="command-fab"
        onClick={() => setOpen(true)}
        title="Open command bar"
      >
        <i className="ti ti-command" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="command-overlay" onMouseDown={() => setOpen(false)}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-input-wrap">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[activeIndex]) {
                e.preventDefault();
                runCommand(filtered[activeIndex]);
              }
            }}
            placeholder="Search actions, pages, reports..."
          />
          <span>Esc</span>
        </div>
        <div className="command-list">
          {filtered.length === 0 ? (
            <div className="command-empty">No matching command</div>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                type="button"
                className={`${index === activeIndex ? "active" : ""} ${page === cmd.id ? "current" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(cmd)}
              >
                <i className={`ti ${cmd.icon}`} aria-hidden="true" />
                <span>{cmd.label}</span>
                <small>{cmd.hint}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
