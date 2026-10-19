import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAuditLogs, getProductAccount, saveClubProfile } from "../api/index.js";
import { Button, DataTable, EmptyState, Field, Input, SkeletonBlock, Tabs, Textarea } from "../components/ui/index.js";
import RetryNotice from "../components/RetryNotice.jsx";
import { useToast } from "../components/toastContext.js";
import { useProduct, APP_VERSION, supportLink } from "./context.js";

const SECTIONS = [{ value: "operations", label: "Operations & security" }, { value: "club", label: "Club profile" }, { value: "team", label: "Team" }, { value: "activity", label: "Activity" }, { value: "account", label: "Account" }, { value: "billing", label: "Billing" }];

function ClubProfile() {
  const p = useProduct();
  const { showToast } = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (p.profile) setForm({ ...p.profile, previousUpiId: p.profile.upiId, version: p.version }); }, [p.profile, p.version]);
  if (!form) return p.error ? <RetryNotice message={p.error} onRetry={p.reload} /> : <SkeletonBlock rows={6} label="Loading club profile" />;
  const field = key => ({ value: form[key], onChange: event => setForm(current => ({ ...current, [key]: event.target.value })) });
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" || file.size > 2 * 1024 * 1024) { setError("Choose a PNG logo smaller than 2 MB."); event.target.value = ""; return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const logo = canvas.toDataURL("image/png");
      if (logo.length > 174800) throw new Error("This logo is too detailed. Choose a smaller PNG.");
      setForm(current => ({ ...current, logo })); setError("");
    } catch (e) { setError(e.message || "This PNG could not be opened."); }
  }
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try { await saveClubProfile(form); await p.reload(); showToast("Club profile saved"); }
    catch (e) { setError(e.userMessage || "Club profile could not be saved."); }
    finally { setSaving(false); }
  }
  return <section className="product-settings-section"><h2>Club profile</h2><p>Your club identity, contact information and checkout UPI ID.</p>{p.error && <RetryNotice message={p.error} onRetry={p.reload} />}<form className="product-form" onSubmit={submit}>
    <div className="product-logo-field">{form.logo && <img src={form.logo} alt="Club logo preview" />}<Field label="Club logo" hint="PNG, up to 2 MB. Stored with your club, not on a temporary server disk."><Input type="file" accept="image/png" onChange={upload} disabled={saving} /></Field>{form.logo && <Button variant="ghost" disabled={saving} onClick={() => setForm({ ...form, logo: "" })}>Remove logo</Button>}</div>
    <Field label="Club name"><Input required maxLength={80} {...field("name")} disabled={saving} /></Field>
    <Field label="Address"><Textarea rows={3} maxLength={300} {...field("address")} disabled={saving} /></Field>
    <Field label="Phone"><Input type="tel" maxLength={30} {...field("phone")} disabled={saving} /></Field>
    <Field label="GST number" hint="Optional; use the 15-character GSTIN."><Input maxLength={15} {...field("gst")} disabled={saving} /></Field>
    <Field label="UPI ID" hint="The same payment ID used by checkout; changing it updates checkout too."><Input maxLength={120} {...field("upiId")} disabled={saving} /></Field>
    {error && <div className="product-error" role="alert">{error}{error.includes("Reload") && <Button onClick={p.reload}>Reload profile</Button>}</div>}
    <div className="product-actions"><Button variant="primary" type="submit" loading={saving}>Save club profile</Button></div>
  </form></section>;
}

function AccountSection({ section }) {
  const p = useProduct();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = async () => { setError(""); try { setData((await getProductAccount()).data); } catch (e) { setError(e.userMessage || "Account could not load."); } };
  useEffect(() => { if (section !== "billing") load(); }, [section]);
  if (section === "billing") return <section className="product-settings-section"><h2>Subscription billing</h2><EmptyState icon="ti-receipt" title="No subscription billing configured" description="This deployment has no paid plan, subscription invoices or upgrade checkout. Club sales and receipts remain in Sales." action={<Button onClick={() => p.onNavigate("billing")}>Open club sales</Button>} secondaryAction={<a href={supportLink()}>Contact support</a>} /></section>;
  if (!data) return error ? <RetryNotice message={error} onRetry={load} /> : <SkeletonBlock rows={5} label="Loading account" />;
  const team = Array.isArray(data.team) ? data.team.filter(Boolean) : [];
  if (section === "team") return <section className="product-settings-section"><h2>Team access</h2><p>Two role-based logins are available in this single-club deployment. Staff share one login; individual accounts and invitations are not available yet.</p><DataTable rows={team} rowKey="role" columns={[{ key: "username", label: "Login" }, { key: "role", label: "Role" }]} /><div className="product-actions"><Button variant="primary" onClick={() => p.onNavigate("settings", { section: "operations" })}>Manage credentials</Button><Button onClick={() => p.updateSetup({ team_reviewed: true })}>Mark access reviewed</Button></div><p>Older audit records may identify a shared role rather than an individual employee.</p></section>;
  return <section className="product-settings-section"><h2>Account</h2><dl className="product-details"><dt>Club</dt><dd>{p.profile?.name}</dd><dt>Deployment</dt><dd>{data.deployment}</dd><dt>Plan</dt><dd>No subscription configured</dd><dt>Customers</dt><dd>{data.members ?? 0}</dd><dt>Tables</dt><dd>{data.tables ?? 0}</dd><dt>Role logins</dt><dd>{team.length}</dd><dt>Version</dt><dd>v{APP_VERSION}</dd></dl><p>No plan quotas or paid upgrades are enforced. Multi-club switching and individual staff invitations are not supported in this deployment.</p><div className="product-actions"><Button onClick={() => p.updateSetup({ dismissed: false, collapsed: false }).then(() => p.onNavigate("dashboard"))}>Reopen setup checklist</Button><Button onClick={p.startTour}>Take a tour</Button></div></section>;
}

function Activity() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ actor: "", action: "", date: "" });
  const load = async () => { setError(""); try { const data = (await getAuditLogs(200)).data; setRows(Array.isArray(data) ? data.filter(Boolean) : []); } catch (e) { setError(e.userMessage || "Activity could not load."); } };
  useEffect(() => { load(); }, []);
  if (!rows) return error ? <RetryNotice message={error} onRetry={load} /> : <SkeletonBlock rows={5} label="Loading activity" />;
  const shown = rows.filter(row => (!filters.actor || (row.staff || "").toLowerCase().includes(filters.actor.toLowerCase())) && (!filters.action || (row.action || "").toLowerCase().includes(filters.action.toLowerCase().replaceAll(" ", "_"))) && (!filters.date || new Date(row.ts).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === filters.date));
  return <section className="product-settings-section"><div className="product-section-heading"><h2>Activity</h2><Button icon="ti-refresh" onClick={load}>Refresh activity</Button></div><p>Filter the latest 200 audit events. Dates use club time (India). Shared logins and legacy default actor labels are not individual employee attribution.</p><div className="product-filter-grid">{[["actor", "Actor"], ["action", "Action"], ["date", "Date"]].map(([key, label]) => <Field key={key} label={label}><Input type={key === "date" ? "date" : "search"} value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })} /></Field>)}<Button onClick={() => setFilters({ actor: "", action: "", date: "" })}>Clear filters</Button></div>{error && <p role="alert">{error}</p>}<DataTable rows={shown} columns={[{ key: "date", label: "Time" }, { key: "staff", label: "Actor" }, { key: "action", label: "Action", render: row => String(row.action ?? "").replaceAll("_", " ") || "—" }, { key: "detail", label: "Details" }]} empty={<EmptyState title="No matching activity" description="Change the filters, or return after a club action has been recorded." action={<Button onClick={() => setFilters({ actor: "", action: "", date: "" })}>Clear filters</Button>} />} /></section>;
}

export default function ProductSettings({ children }) {
  const [params, setParams] = useSearchParams();
  const p = useProduct();
  const section = SECTIONS.some(s => s.value === params.get("section")) ? params.get("section") : "operations";
  return <div className="product-settings"><Tabs tabs={SECTIONS} value={section} label="Settings sections" onChange={value => setParams({ section: value })} />
    {section === "club" ? <ClubProfile /> : section === "activity" ? <Activity /> : ["account", "team", "billing"].includes(section) ? <AccountSection key={section} section={section} /> : <><div className="product-actions product-operations-review"><Button onClick={() => p.updateSetup({ rates_reviewed: true })}>Mark table rates reviewed</Button></div>{children}</>}
  </div>;
}
