import { Button, Dropdown as Menu, Icon } from "../components/ui/index.js";
import { useProduct, APP_VERSION, supportLink } from "./context.js";

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
