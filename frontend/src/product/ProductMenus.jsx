import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Icon } from "../components/ui/index.js";
import { useProduct, APP_VERSION, supportLink } from "./context.js";

function Menu({ label, children, trigger, className = "" }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const popup = useRef(null);
  const [position, setPosition] = useState({});
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector('[role="menuitem"]')?.focus();
    const close = event => { if (!popup.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
      if (event.key === "Tab") { setOpen(false); button.current?.focus(); }
      const items = [...(popup.current?.querySelectorAll('[role="menuitem"]') || [])];
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const reposition = () => setOpen(false);
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", keydown);
    window.addEventListener("resize", reposition);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", keydown); window.removeEventListener("resize", reposition); };
  }, [open]);
  return <><Button native ref={button} className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => {
    const rect = button.current.getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 310)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)) }); setOpen(!open);
  }}>{trigger}</Button>{open && createPortal(<div className="product-menu" role="menu" aria-label={label} ref={popup} style={position} onClick={event => { if (event.target.closest('[role="menuitem"]')) { setOpen(false); button.current?.focus(); } }}>{children}</div>, document.body)}</>;
}

export function ClubMenu() {
  const p = useProduct();
  return <Menu label="Club menu" className="product-club-trigger sb-logo" trigger={<><span className="sb-logo-mark">{p?.profile?.logo ? <img src={p.profile.logo} alt="" /> : "HSR"}</span><span className="product-club-copy"><strong className="sb-logo-name">{p?.profile?.name || "HSR Snooker Cafe"}</strong><small>Single-club workspace</small></span></>}>
    <div className="product-menu-heading">{p?.profile?.name || "HSR Snooker Cafe"}<small>One configured club</small></div>
    {p?.role === "admin" && <><Button native role="menuitem" onClick={() => p.onNavigate("settings", { section: "club" })}><Icon name="settings" />Club settings</Button><Button native role="menuitem" onClick={() => p.onNavigate("settings", { section: "team" })}><Icon name="users" />Team access</Button></>}
    <Button native role="menuitem" onClick={() => p?.onNavigate("help")}><Icon name="info-circle" />Help & documentation</Button>
    <Button native role="menuitem" onClick={p?.onLogout}><Icon name="logout" />Sign out</Button>
  </Menu>;
}

export function HelpMenu() {
  const p = useProduct();
  return <Menu label="Help" className="topbar-icon-btn product-menu-trigger" trigger={<Icon name="info-circle" />}>
    <Button native role="menuitem" onClick={() => p.onNavigate("help")}><Icon name="note" />Documentation</Button>
    <Button native role="menuitem" onClick={() => p.openDialog("shortcuts")}><Icon name="command" />Keyboard shortcuts</Button>
    <a role="menuitem" href={supportLink()}><Icon name="user-check" />Contact support</a>
    <Button native role="menuitem" onClick={() => p.onNavigate("changelog")}><Icon name="history" />What’s new</Button>
  </Menu>;
}

export function UserMenu() {
  const p = useProduct();
  return <Menu label="User menu" className="topbar-icon-btn product-user-trigger product-menu-trigger" trigger={<span>{(p?.username || "U").slice(0, 2).toUpperCase()}</span>}>
    <div className="product-menu-heading">{p?.username}<small>{p?.role === "admin" ? "Owner" : "Staff"}</small></div>
    <Button native role="menuitem" onClick={() => p.openDialog("profile")}><Icon name="user" />My profile</Button>
    {p?.role === "admin" && <Button native role="menuitem" onClick={() => p.onNavigate("settings")}><Icon name="settings" />Settings</Button>}
    <Button native role="menuitem" onClick={p?.onLogout}><Icon name="logout" />Sign out</Button>
  </Menu>;
}

export function ProductFooter() {
  const p = useProduct();
  return <div className="product-footer"><span>v{APP_VERSION}</span><Button native onClick={() => p.onNavigate("status")}>Status</Button><Button native onClick={() => p.onNavigate("changelog")}>Changelog</Button></div>;
}
