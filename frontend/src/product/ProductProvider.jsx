import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getProductContext, getSetup, saveSetup } from "../api/index.js";
import { Button, Modal, Icon } from "../components/ui/index.js";
import { useToast } from "../components/toastContext.js";
import { ProductContext, useProduct } from "./context.js";

const STEPS = [
  { title: "Your live floor", text: "Check the table state and elapsed time before taking an action.", target: ".cf-nav", page: "live-floor" },
  { title: "Start a session", text: "Start a guest session without a name, or select a loyalty member for their rate.", target: ".cf-page-primary-action", page: "live-floor" },
  { title: "Close the bill", text: "Select Checkout on a running table. Review time and food, then choose Cash, UPI or member Credit. Opening checkout does not settle the bill.", target: ".lf-table-grid", page: "live-floor" },
  { title: "Customers and credit", text: "Owners can review customer balances and history. Staff can select an existing member during a session.", target: ".cf-nav", page: "members" },
];

export default function ProductProvider({ children, role, username, onNavigate, onLogout, onNewSession }) {
  const [profile, setProfile] = useState(null);
  const [version, setVersion] = useState(0);
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState("");
  const [tour, setTour] = useState(0);
  const { pathname } = useLocation();
  const { showToast } = useToast();
  const completed = useRef(false);
  const reload = useCallback(async () => {
    try {
      const result = await getProductContext();
      setProfile(result.data.profile); setVersion(result.data.version); setError("");
      if (role === "admin") setSetup((await getSetup()).data);
    } catch (e) { setError(e.userMessage || "Club settings could not load."); }
  }, [role]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (role !== "admin") return;
    let timer;
    const refresh = event => {
      if (!/settings|product|auth\/change/.test(event.detail?.path || "")) return;
      clearTimeout(timer);
      timer = setTimeout(() => getSetup().then(response => setSetup(response.data)).catch(() => {}), 250);
    };
    window.addEventListener("hsr:data-changed", refresh);
    return () => { clearTimeout(timer); window.removeEventListener("hsr:data-changed", refresh); };
  }, [role]);
  const updateSetup = useCallback(async patch => {
    try { const response = await saveSetup(patch); setSetup(response.data); }
    catch (e) { showToast(e.userMessage || "Setup could not be saved", "error"); throw e; }
  }, [showToast]);
  useEffect(() => {
    if (!setup?.steps?.every(step => step.done)) return;
    if (!setup.setup.dismissed && !completed.current) {
      completed.current = true;
      showToast("Setup complete");
      updateSetup({ dismissed: true }).catch(() => { completed.current = false; });
    }
  }, [setup, showToast, updateSetup]);
  useEffect(() => {
    const help = () => setDialog("help");
    window.addEventListener("product:help", help);
    return () => window.removeEventListener("product:help", help);
  }, []);
  useEffect(() => {
    let chord = 0;
    const keydown = event => {
      const target = event.target;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target?.closest?.("input,textarea,select,[contenteditable=true]")) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (event.key === "?") { event.preventDefault(); setDialog("shortcuts"); return; }
      const key = event.key.toLowerCase();
      if (key === "g") { chord = Date.now(); return; }
      if (Date.now() - chord < 900) {
        chord = 0;
        const page = { d: role === "admin" ? "dashboard" : "live-floor", m: role === "admin" ? "members" : null, b: "reservations" }[key];
        if (page) { event.preventDefault(); onNavigate(page); return; }
      }
      if (key === "n") { event.preventDefault(); onNewSession(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onNavigate, onNewSession, role]);
  useEffect(() => {
    if (dialog !== "tour") return;
    const element = document.querySelector(STEPS[tour].target);
    element?.classList.add("product-tour-target");
    return () => element?.classList.remove("product-tour-target");
  }, [dialog, tour, pathname]);
  const value = useMemo(() => ({ profile, version, setup, error, reload, updateSetup, role, username, onNavigate, onLogout,
    openDialog: setDialog, startTour: () => { setTour(0); onNavigate("live-floor"); setDialog("tour"); } }),
  [profile, version, setup, error, reload, updateSetup, role, username, onNavigate, onLogout]);
  return <ProductContext.Provider value={value}>{children}
    <Modal open={!!dialog} portal title={dialog === "shortcuts" ? "Keyboard shortcuts" : dialog === "profile" ? "My profile" : dialog === "tour" ? STEPS[tour].title : "Help with this page"} onClose={() => setDialog("")} className="product-dialog">
      {dialog === "shortcuts" && <><dl className="product-shortcuts">{[["⌘K / Ctrl+K", "Command palette"], ["/", "Search actions"], ["G then D", role === "admin" ? "Dashboard" : "Live Floor"], ...(role === "admin" ? [["G then M", "Customers"]] : []), ["G then B", "Bookings"], ["N", "Start a session"], ["?", "Keyboard shortcuts"], ["Esc", "Close dialog"], ["↑ / ↓ / Enter", "Choose a command"], ["P / R", "Pause / resume focused table"], ["E", "Open focused table checkout"], ["O", "Order food for focused table"]].map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl><p>Focus a Live Floor table for session shortcuts. Shortcuts pause while you type or a dialog is open. End opens checkout; it never confirms a payment.</p></>}
      {dialog === "profile" && <><dl className="product-details"><dt>Username</dt><dd>{username}</dd><dt>Role</dt><dd>{role === "admin" ? "Owner" : "Staff"}</dd><dt>Club</dt><dd>{profile?.name || "HSR Snooker Cafe"}</dd></dl><p>This deployment uses shared Owner and Staff logins, not individual employee profiles.</p>{role === "admin" && <Button onClick={() => { setDialog(""); onNavigate("settings", { section: "operations" }); }}>Manage credentials</Button>}</>}
      {dialog === "help" && <><p>Start guests without a name. Select a member when you need their rate or credit account. At checkout, review time and food before confirming payment.</p><p>Time corrections need a reason and are audited. Large amount changes may require the configured manager PIN. Credit requires an existing member.</p><Button onClick={() => { setDialog(""); onNavigate("help"); }}>Open documentation</Button></>}
      {dialog === "tour" && <><p>{STEPS[tour].text}</p><p>Step {tour + 1} of {STEPS.length}</p><div className="product-actions"><Button variant="secondary" onClick={() => setDialog("")}>Skip tour</Button><Button onClick={async () => { if (tour === STEPS.length - 1) { if (role === "admin") await updateSetup({ guide_reviewed: true }); setDialog(""); } else { const next = tour + 1; setTour(next); onNavigate(role === "staff" && STEPS[next].page === "members" ? "live-floor" : STEPS[next].page); } }}>{tour === STEPS.length - 1 ? "Finish" : "Next"}</Button></div></>}
    </Modal>
  </ProductContext.Provider>;
}

export function SetupChecklist() {
  const product = useProduct();
  if (!product || product.role !== "admin" || !product.setup || product.setup.setup.dismissed || product.setup.steps.every(step => step.done)) return null;
  const { setup, updateSetup, onNavigate, startTour } = product;
  const count = setup.steps.filter(step => step.done).length;
  return <section className="product-setup" aria-label="Getting started">
    <div className="product-section-heading">
      <h2>Get started with your club <small>{count} of {setup.steps.length}</small></h2>
      <div className="product-actions">
        <Button variant="ghost" aria-label={setup.setup.collapsed ? "Expand setup" : "Collapse setup"} onClick={() => updateSetup({ collapsed: !setup.setup.collapsed })}><Icon name={setup.setup.collapsed ? "chevron-down" : "chevron-up"} /></Button>
        <Button variant="ghost" aria-label="Dismiss setup" onClick={() => updateSetup({ dismissed: true })}><Icon name="x" /></Button>
      </div>
    </div>
    {!setup.setup.collapsed && <>
      <div className="product-setup-steps">{setup.steps.map(step => <Button key={step.id} variant="ghost" onClick={() => onNavigate(step.page || "settings", { section: step.section })}>
        <Icon name={step.done ? "circle-check" : "circle"} /><span>{step.label}</span>{step.done && <span className="product-muted">Complete</span>}
      </Button>)}</div>
      <div className="product-actions">
        <Button variant="primary" onClick={() => { const next = setup.steps.find(step => !step.done); onNavigate(next.page || "settings", { section: next.section }); }}>Continue setup</Button>
        <Button variant="secondary" onClick={() => onNavigate("demo")}>Try sample workspace</Button>
        <Button variant="ghost" onClick={startTour}>Take a tour</Button>
      </div>
    </>}
  </section>;
}
