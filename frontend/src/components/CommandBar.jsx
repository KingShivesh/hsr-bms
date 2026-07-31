import { useEffect, useMemo, useState } from "react";

export default function CommandBar({ page, setPage, onNewSession, role = "admin" }) {
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
        label: "Waitlist queue",
        hint: "Walk-ins",
        icon: "ti-list-check",
        action: () => setPage("waitlist"),
      },
      {
        id: "dashboard",
        label: "Dashboard",
        hint: "Owner glance",
        icon: "ti-layout-dashboard",
        action: () => setPage("dashboard"),
      },
      {
        id: "tables",
        label: "Table management",
        hint: "Floor view",
        icon: "ti-layout-grid",
        action: () => setPage("tables"),
      },
      {
        id: "reservations",
        label: "Reservations",
        hint: "Bookings and slots",
        icon: "ti-calendar",
        action: () => setPage("reservations"),
      },
      {
        id: "food",
        label: "Food & Cafe POS",
        hint: "Menu and billing",
        icon: "ti-tools-kitchen-2",
        action: () => setPage("food"),
      },
      {
        id: "tournaments",
        label: "Tournaments",
        hint: "Matches and winners",
        icon: "ti-trophy",
        action: () => setPage("tournaments"),
      },
      {
        id: "reports",
        label: "Analytics & reports",
        hint: "Bills and table performance",
        icon: "ti-chart-bar",
        action: () => setPage("reports"),
        adminOnly: true,
      },
      {
        id: "plans",
        label: "Membership plans",
        hint: "Silver, Gold, VIP",
        icon: "ti-award",
        action: () => setPage("plans"),
        adminOnly: true,
      },
      {
        id: "staff",
        label: "Staff & roster",
        hint: "Shift board",
        icon: "ti-user-check",
        action: () => setPage("staff"),
        adminOnly: true,
      },
      {
        id: "closing",
        label: "Daily closing",
        hint: "Cash, UPI and open tables",
        icon: "ti-clipboard-check",
        action: () => setPage("closing"),
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

  const allowedCommands = commands.filter((cmd) => role === "admin" || !cmd.adminOnly);
  const filtered = allowedCommands.filter((cmd) => {
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
    function onOpenCommand() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("command:open", onOpenCommand);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("command:open", onOpenCommand);
    };
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
