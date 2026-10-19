/* global process, URL, console, document, window, localStorage, getComputedStyle */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

// Prepared only: run after the parent finishes its read-only matrices/builds.
// node frontend/scripts/test-remaining-recovery.mjs [before|after|both]
// REMAINING_RECOVERY_CASES=gst-recovery,peak-hours,... limits subset retries.
// REMAINING_RECOVERY_THEMES=light,dark; REMAINING_RECOVERY_REPORT_PATH overrides output.
// Every API read/auth claim is a browser fixture; no real login or API write is sent.
const mode = process.argv[2] || "both";
if (!["before", "after", "both"].includes(mode) || process.argv.length > 3) throw new Error("Usage: test-remaining-recovery.mjs [before|after|both]");
const origins = { before: "http://127.0.0.1:5180", after: "http://127.0.0.1:5181" };
const api = "http://127.0.0.1:8006";
const stages = mode === "both" ? ["before", "after"] : [mode];
const themes = [...new Set((process.env.REMAINING_RECOVERY_THEMES || "light,dark").split(","))];
if (!themes.length || themes.some(theme => !["light", "dark"].includes(theme))) throw new Error("Themes must be light and/or dark");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.resolve(root, process.env.REMAINING_RECOVERY_REPORT_PATH || "docs/ui-readiness/remaining-recovery/results.json");
const routeRoot = ".main-content .route-page";
const report = {
  startedAt: new Date().toISOString(), mode, origins, api, themes, cases: [], failures: [], baselineObservations: [], screenshots: [],
  safety: { authentication: "Browser-only role/auth fixtures; no real login", forwardedApiRequests: 0, forwardedBusinessWrites: 0, blockedOrigins: [], blockedWebSockets: 0 },
  limitations: [
    "This is a deterministic browser-fixture suite, not backend/database, server authorization or business-success verification.",
    "A peak-hour POST observed by interception is only an attempted action; it receives HTTP 409 and is never forwarded or called saved.",
    "Expected before-stage UI gaps are baseline observations. Invariant failures and every after-stage failure fail the suite.",
    "Inventory renders all 100 supplied items; pagination is not implemented here and is reported as not applicable.",
    "Role checks preserve existing admin-only route gates and the read-only audit summary. No new staff restrictions are assumed for Daily Closing or other existing staff workflows.",
    "Screenshots cover changed GST, peak-hour, Closing and long-name Inventory states only, in both themes/stages; unchanged sample and permission checks have no screenshots.",
    "WebSockets, event streams, service workers, cross-preview requests and external origins are excluded. App assets alone are fetched from the selected immutable local preview.",
  ],
};

function localUrl(value, appOrigin) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || ![appOrigin, api].includes(url.origin)) throw new Error(`Disallowed origin: ${url.origin}`);
  return url;
}
for (const origin of Object.values(origins)) localUrl(origin, origin);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate, timeout = 12000) {
  const end = Date.now() + timeout;
  do { if (await predicate()) return true; await delay(75); } while (Date.now() < end);
  return false;
}
function check(result, name, passed, detail, invariant = false) {
  const entry = { name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) };
  result.checks.push(entry);
  if (entry.passed) return;
  const finding = { id: result.id, stage: result.stage, theme: result.theme, width: result.width, ...entry };
  (result.stage === "before" && !invariant ? report.baselineObservations : report.failures).push(finding);
}
const tables = Array.from({ length: 5 }, (_, index) => ({
  id: `t${index + 1}`, num: index + 1, label: index < 2 ? "Wiraka" : index < 4 ? "English" : "Pool", type: index === 4 ? "POOL" : "SNOOKER",
  rate: index < 2 ? 320 : index < 4 ? 270 : 170, session: null, booking: null, maintenance: null,
  status_key: "available", status_label: "Available", status_tone: "success", elapsed_seconds: 0, running_total: 0,
}));
const tableFixture = { tables, active_sessions: [], maintenance: [], rates: { wr: 320, pr: 170, sr: 270 }, active_tables: 0, idle_tables: 5 };
const closingFixture = {
  date: "QA recovery day", total_revenue: 1000, food_revenue: 100, food_only_revenue: 234, total_sessions: 2,
  cash_total: 1000, upi_total: 234, card_total: 0, food_only_payment_breakdown: { Cash: 0, UPI: 234, Card: 0 },
  active_tables: 0, can_close_day: true, open_tables: [], idle_tables: ["T1", "T2", "T3", "T4", "T5"],
  table_breakdown: { T1: { sessions: 2, revenue: 1000 } }, food_breakdown: { Tea: 2 }, corrections_today: [],
  day_close: { closed: false, opened_float: 0, counted_cash: 0, notes: "" },
};
function defaultFixture(pathname, role) {
  const fixtures = {
    "/ready": { status: "ready" }, "/health": { status: "ok" },
    "/auth/me": { username: `qa-${role}`, role },
    "/product/context": { profile: { name: "HSR QA browser fixture", logo: "", address: "", phone: "", gst: "", upiId: "" }, version: 1, deployment: "single_club" },
    "/product/setup": { setup: { dismissed: true, collapsed: true }, steps: [{ id: "fixture", label: "QA", done: false }] },
    "/reports/summary": { sale: 0, cust: 0, food: 0, active_tables: 0, sessions: 0, avg_time: 0, top_table: "-" },
    "/sessions/alerts": { alerts: [], owner_summaries: [], config: {} },
    "/sessions/tables": tableFixture,
    "/sessions/live-floor": { ...tableFixture, summary: { active_tables: 0, idle_tables: 5, live_value: 0 }, attention: [] },
    "/sessions/active": [], "/members/recent": [], "/bookings": [], "/waitlist": [],
    "/settings/menu": [], "/settings/rates": tableFixture.rates,
    "/operations/peak-hours": [], "/operations/current-rate": { is_peak: false, label: "Standard", multiplier: 1 },
    "/operations/gst": { gst_percent: 18 },
    "/reports/closing-report": closingFixture,
    "/reports/closing-insights": { insights: [{ type: "info", title: "QA insights recovered", detail: "Browser fixture only." }] },
    "/operations/audit-logs": [{ id: 1, staff: "qa-owner", action: "session_closed", severity: "info", detail: "Browser fixture", date: "18/10/2026, 12:00" }],
  };
  return fixtures[pathname];
}

async function openSession(browser, result, role = "admin") {
  const app = origins[result.stage];
  const context = await browser.newContext({
    viewport: { width: result.width, height: result.width < 600 ? 844 : 1000 }, colorScheme: result.theme,
    reducedMotion: "reduce", timezoneId: "Asia/Kolkata", serviceWorkers: "block", acceptDownloads: false,
  });
  const state = { override: null, requests: [], writes: [], unknownReads: [], pageErrors: [], gates: [], closing: false };
  await context.addInitScript(({ app, theme, role }) => {
    if (window.location.origin !== app) return;
    localStorage.clear();
    localStorage.setItem("theme", theme);
    localStorage.setItem("token", "browser-fixture-token-not-valid-on-server");
    localStorage.setItem("role", role);
    localStorage.setItem("username", `qa-${role}`);
  }, { app, theme: result.theme, role });
  await context.routeWebSocket("**/*", socket => { report.safety.blockedWebSockets += 1; socket.close(); });
  await context.route("**/*", async handler => {
    const request = handler.request();
    const method = request.method();
    let url;
    try { url = localUrl(request.url(), app); }
    catch (error) {
      report.safety.blockedOrigins.push({ stage: result.stage, id: result.id, method, url: request.url().split("?")[0], reason: error.message });
      await handler.abort("blockedbyclient");
      return;
    }
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const headers = { "access-control-allow-origin": app, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE", "cache-control": "no-store" };
    try {
      if (method === "OPTIONS") { await handler.fulfill({ status: 204, headers }); return; }
      if (!["GET", "HEAD"].includes(method)) {
        let body;
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
        state.writes.push({ method, pathname, origin: url.origin, body, disposition: "blocked-not-forwarded", at: Date.now() });
        await handler.fulfill({ status: 409, headers, json: { detail: "QA blocked this write attempt; it was not sent or saved." } });
        return;
      }
      if (url.origin === api) {
        state.requests.push({ method, pathname, at: Date.now(), disposition: "browser-fixture" });
        if (pathname === "/events/stream") { await handler.fulfill({ status: 204, headers }); return; }
        const override = state.override ? await state.override({ method, pathname }) : null;
        const body = override ? override.body : defaultFixture(pathname, role);
        const status = override?.status || (body === undefined ? 404 : 200);
        if (body === undefined) state.unknownReads.push({ method, pathname });
        await handler.fulfill({ status, headers, json: body ?? { detail: "Unconfigured browser fixture; no API request forwarded" } });
        return;
      }
      // Chromium classifies the built index's icon as "other", not "image".
      const previewFavicon = url.origin === app && ["GET", "HEAD"].includes(method) && request.resourceType() === "other" && url.pathname === "/favicon.svg" && !url.search;
      if (!["document", "script", "stylesheet", "font", "image", "manifest"].includes(request.resourceType()) && !previewFavicon) {
        state.unknownReads.push({ method, pathname, origin: app, reason: "Non-asset app request blocked" });
        await handler.abort("blockedbyclient");
        return;
      }
      // route.fetch does not auto-follow redirects to unguarded origins.
      const response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      if (response.status() >= 300 && response.status() < 400) throw new Error("Preview asset redirect blocked");
      if (previewFavicon && response.headers()["content-type"]?.split(";")[0].trim() !== "image/svg+xml") throw new Error("Reviewed preview favicon must remain an SVG asset");
      await handler.fulfill({ response });
    } catch (error) {
      if (!state.closing) { state.pageErrors.push(`Interception: ${error.message}`); await handler.abort("failed").catch(() => {}); }
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => state.pageErrors.push(error.message));
  page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
  const session = {
    page, state, root: page.locator(routeRoot),
    async goto(route) { await page.goto(app + route, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.locator(routeRoot).waitFor(); },
    async close() { state.closing = true; for (const gate of state.gates) gate.resolve(); await context.close(); },
  };
  return session;
}

async function screenshot(session, result, state, fullPage = false) {
  // Only these source-change cases produce visual artifacts.
  if (!["gst-recovery", "peak-hours", "closing-insights", "inventory-extreme"].includes(result.id)) return;
  if (result.id === "inventory-extreme" && result.width !== 375) return;
  await session.page.evaluate(() => document.fonts.ready);
  const directory = path.join(path.dirname(reportPath), result.stage, result.theme);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${result.id}-${result.width}-${state}.png`);
  await session.page.screenshot({ path: file, fullPage, animations: "disabled" });
  result.screenshots.push({ state, path: file });
  report.screenshots.push({ id: result.id, stage: result.stage, theme: result.theme, width: result.width, state, path: file });
}

// The baseline's labels are visually present but unassociated. Resolve through
// their actual field container so missing a label does not prevent comparison.
function peakField(root, label) {
  return root.locator(".form-label").filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("input").first();
}

async function gstRecovery(session, result) {
  const { page, root, state } = session;
  const gate = deferred();
  state.gates.push(gate);
  let fail = true;
  let failures = 0;
  state.override = async ({ pathname }) => {
    if (pathname !== "/operations/gst") return null;
    await gate.promise;
    if (fail) { failures += 1; return { status: 500, body: { detail: "QA simulated GST read failure" } }; }
    return { status: 200, body: { gst_percent: 18 } };
  };
  try {
    await session.goto("/pricing-rules");
    await root.getByRole("button", { name: "Tax / GST", exact: true }).click();
    check(result, "GST request reached", await until(() => state.requests.some(request => request.pathname === "/operations/gst")), undefined, true);
    check(result, "GST loading skeleton", await root.getByRole("status", { name: "Loading GST setting", exact: true }).isVisible());
    check(result, "No editable default zero while loading", await root.locator("input[type=number]:visible").count() === 0);
    await screenshot(session, result, "loading");
  } finally { gate.resolve(); }
  const notice = root.locator(".retry-notice").first();
  await notice.waitFor();
  check(result, "HTTP 500 shown with local Retry", failures > 0 && await notice.getByRole("button", { name: "Retry", exact: true }).isVisible(), { fixture500s: failures }, true);
  check(result, "Failed GST load hides editable default", await root.locator("input[type=number]:visible").count() === 0);
  await screenshot(session, result, "error");
  fail = false;
  const readsBefore = state.requests.filter(request => request.pathname === "/operations/gst").length;
  let navigations = 0;
  const navigation = frame => { if (frame === page.mainFrame()) navigations += 1; };
  page.on("framenavigated", navigation);
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  check(result, "GST Retry restores saved 18 percent", await until(async () => await root.locator("input[type=number]").first().inputValue().catch(() => "") === "18"), undefined, true);
  check(result, "GST recovery made a fresh fixture read", state.requests.filter(request => request.pathname === "/operations/gst").length > readsBefore, undefined, true);
  check(result, "GST Retry did not navigate/reload", navigations === 0, undefined, true);
  check(result, "GST Retry cleared local error", await notice.count() === 0, undefined, true);
  page.off("framenavigated", navigation);
}

async function peakHours(session, result) {
  const { root, state } = session;
  await session.goto("/pricing-rules");
  await peakField(root, "Start Hour").waitFor();
  await peakField(root, "Start Hour").fill("9");
  await peakField(root, "End Hour").fill("18");
  await root.getByRole("button", { name: "Add Peak Rule", exact: true }).click();
  const validAttempt = await until(() => state.writes.some(request => request.pathname === "/operations/peak-hours"), 1200);
  const attempts = state.writes.filter(request => request.pathname === "/operations/peak-hours");
  check(result, "Valid 9 to 18 window attempts a POST", validAttempt && attempts.length === 1 && attempts[0].method === "POST" && attempts[0].body?.start_hour === 9 && attempts[0].body?.end_hour === 18, { intercepted: attempts, businessSuccess: "not-asserted" });
  result.baselineValidationObserved = await session.page.getByText("Start hour must be before end hour", { exact: true }).count() > 0;
  await screenshot(session, result, "valid-window");
  // A fresh document removes the valid-window toast, so it cannot falsely count
  // as validation feedback for the separate invalid-window check.
  await session.page.reload({ waitUntil: "domcontentloaded" });
  await peakField(root, "Start Hour").waitFor();
  await peakField(root, "Start Hour").fill("18");
  await peakField(root, "End Hour").fill("9");
  const count = state.writes.length;
  await root.getByRole("button", { name: "Add Peak Rule", exact: true }).click();
  await delay(500);
  check(result, "Invalid 18 to 9 window sends no request", state.writes.length === count, { attemptedWrites: state.writes.slice(count) });
  check(result, "Invalid window shows validation", await session.page.getByText("Start hour must be before end hour", { exact: true }).count() > 0);
}

async function closingInsights(session, result) {
  const { page, root, state } = session;
  let fail = true;
  let failures = 0;
  state.override = async ({ pathname }) => {
    if (pathname !== "/reports/closing-insights" || !fail) return null;
    failures += 1;
    return { status: 500, body: { detail: "QA insights read temporarily unavailable" } };
  };
  await session.goto("/daily-closing");
  const notice = root.locator(".retry-notice").first();
  await notice.waitFor();
  check(result, "Insights-only 500 fixture reached", failures > 0 && state.requests.some(request => request.pathname === "/reports/closing-report"), { fixture500s: failures }, true);
  check(result, "Closing report retained during insights failure", await root.locator(".closing-metric-grid").isVisible() && await root.getByText("QA recovery day", { exact: true }).isVisible());
  const metric = root.locator(".closing-metric").filter({ hasText: "Total sales" }).locator("strong");
  const metricText = await metric.count() ? await metric.textContent() : "";
  check(result, "Retained total is the fixture's 1234, not an empty default", metricText.replace(/[^\d]/g, "") === "1234");
  check(result, "Insights error has Retry", await notice.getByRole("button", { name: "Retry", exact: true }).isVisible(), undefined, true);
  await screenshot(session, result, "insights-error", true);
  fail = false;
  let navigations = 0;
  const navigation = frame => { if (frame === page.mainFrame()) navigations += 1; };
  page.on("framenavigated", navigation);
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await root.getByText("QA insights recovered", { exact: true }).waitFor();
  check(result, "Insights Retry recovers without losing report", await root.locator(".closing-metric-grid").isVisible() && await root.getByText("QA insights recovered", { exact: true }).isVisible(), undefined, true);
  check(result, "Insights Retry did not reload", navigations === 0, undefined, true);
  check(result, "No settlement was attempted", state.writes.length === 0, state.writes, true);
  page.off("framenavigated", navigation);
}

async function inventory(session, result, extreme) {
  const { page, root, state } = session;
  const items = extreme ? Array.from({ length: 100 }, (_, index) => ({
    name: `QA item ${String(index + 1).padStart(3, "0")} ${"VeryLongMenuNameWithoutSpaces".repeat(12)}`,
    category: "Veg Snacks", price: index + 0.5, available: index % 4 !== 0,
  })) : [];
  state.override = async ({ pathname }) => pathname === "/settings/menu" ? { status: 200, body: items } : null;
  await session.goto("/inventory");
  await root.getByText("Inventory command", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const rows = root.locator(".cf-inventory-row");
  check(result, extreme ? "All 100 fixture items render" : "Empty menu renders without phantom items", await rows.count() === items.length, { fixtureItems: items.length, rendered: await rows.count() }, true);
  result.pagination = { status: "not-applicable", reason: "Existing Inventory renders the full menu; no pagination feature added" };
  if (!extreme) {
    check(result, "Empty menu has an honest empty state", await root.getByText("No menu items", { exact: true }).isVisible(), undefined, true);
  } else {
    const bounds = await rows.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const name = node.querySelector("strong");
      const style = name ? getComputedStyle(name) : null;
      return { name: name?.textContent, title: name?.getAttribute("title"), left: rect.left, right: rect.right, viewport: window.innerWidth,
        clipped: !!name && name.scrollWidth > name.clientWidth + 1, bounded: !!style && ["hidden", "clip"].includes(style.overflowX) && style.textOverflow === "ellipsis" };
    }));
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: window.innerWidth }));
    check(result, "Long menu rows stay within viewport", bounds.every(row => row.left >= -1 && row.right <= row.viewport + 1), bounds.filter(row => row.left < -1 || row.right > row.viewport + 1));
    check(result, "No page-level horizontal overflow", overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, overflow);
    check(result, "Clipped names have bounded ellipsis and full title", bounds.every(row => (!row.clipped || row.bounded) && row.title === row.name), { missingTitles: bounds.filter(row => row.title !== row.name).length, unbounded: bounds.filter(row => row.clipped && !row.bounded).length });
    await rows.last().scrollIntoViewIfNeeded();
    check(result, "Last fixture item remains reachable", await rows.last().isVisible(), undefined, true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await screenshot(session, result, "long-names");
  }
  check(result, "Inventory fixtures cause no business writes", state.writes.length === 0, state.writes, true);
}

async function sampleWorkspace(session, result) {
  const { root, state } = session;
  await session.goto("/demo");
  await root.getByRole("button", { name: "Load sample data", exact: true }).click();
  const definitions = [["Tables", 5], ["Members", 10], ["Bookings", 3], ["Cafe orders", 2]];
  for (const [name, count] of definitions) {
    const tab = root.getByRole("tab", { name, exact: true });
    await tab.click();
    check(result, `Sample ${name} tab/row count`, await tab.getAttribute("aria-selected") === "true" && await root.locator("table tbody tr").count() === count, { expectedRows: count, rendered: await root.locator("table tbody tr").count() }, true);
  }
  await root.getByRole("tab", { name: "Tables", exact: true }).click();
  await root.locator("table tbody tr").first().getByRole("button", { name: "Close sample session", exact: true }).click();
  check(result, "Sample table change is visible", (await root.locator("table tbody tr").first().textContent()).includes("Available"), undefined, true);
  await root.getByRole("button", { name: "Reset sample data", exact: true }).click();
  check(result, "Sample reset restores original first table", (await root.locator("table tbody tr").first().textContent()).includes("Running") && await root.locator("table tbody tr").count() === 5, undefined, true);
  await root.getByRole("button", { name: "Delete sample data", exact: true }).click();
  check(result, "Sample delete returns to browser-only empty state", await root.getByRole("button", { name: "Load sample data", exact: true }).isVisible() && await root.getByRole("tablist").count() === 0, undefined, true);
  check(result, "Sample load/reset/delete do not attempt API writes", state.writes.length === 0, state.writes, true);
}

async function auditReadOnly(session, result) {
  await session.goto("/audit-log");
  const content = session.root.locator(".cf-page-staff");
  await content.waitFor();
  check(result, "Existing audit summary is readable", await content.getByText("qa-owner", { exact: true }).isVisible(), undefined, true);
  check(result, "Audit summary exposes no row mutation controls", await content.locator(".cf-row-actions,input,textarea,select,form").count() === 0, undefined, true);
  check(result, "Audit summary makes no write attempts", session.state.writes.length === 0, session.state.writes, true);
}

async function staffPermissions(session, result) {
  for (const route of ["/pricing-rules", "/inventory", "/audit-log"]) {
    await session.goto(route);
    const redirected = await until(() => new URL(session.page.url()).pathname === "/");
    check(result, `Existing Staff gate for ${route}`, redirected, { urlAfter: session.page.url() }, true);
    check(result, `No protected form leaked for ${route}`, await session.root.locator(".page-operations,.cf-page-inventory,.cf-page-staff").count() === 0 && await session.root.getByRole("button", { name: /^(Save GST|Add Peak Rule|Add Menu Item)$/ }).count() === 0, undefined, true);
  }
  check(result, "Permission checks do not attempt writes", session.state.writes.length === 0, session.state.writes, true);
  result.permissionScope = "Browser route/affordance regression only. Does not verify server RBAC or impose new Staff permissions.";
}

const definitions = [
  { id: "gst-recovery", run: gstRecovery }, { id: "peak-hours", run: peakHours }, { id: "closing-insights", run: closingInsights },
  { id: "inventory-empty", run: (session, result) => inventory(session, result, false) },
  { id: "inventory-extreme", widths: [1440, 375], run: (session, result) => inventory(session, result, true) },
  { id: "sample-workspace", run: sampleWorkspace }, { id: "audit-readonly", run: auditReadOnly },
  { id: "staff-permissions", role: "staff", run: staffPermissions },
];
const selected = process.env.REMAINING_RECOVERY_CASES?.split(",") || definitions.map(definition => definition.id);
if (!selected.length || selected.some(id => !definitions.some(definition => definition.id === id))) throw new Error("Unknown REMAINING_RECOVERY_CASES entry");
await fs.mkdir(path.dirname(reportPath), { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
  for (const stage of stages) for (const theme of themes) for (const definition of definitions.filter(item => selected.includes(item.id))) for (const width of definition.widths || [1440]) {
    const result = { id: definition.id, stage, theme, width, role: definition.role || "admin", checks: [], screenshots: [] };
    report.cases.push(result);
    let session;
    try {
      session = await openSession(browser, result, result.role);
      await definition.run(session, result);
    } catch (error) {
      check(result, "Scenario completed", false, { message: error.stack || error.message }, true);
    } finally {
      if (session) {
        result.requests = session.state.requests;
        result.blockedWrites = session.state.writes;
        result.unknownFixtureReads = session.state.unknownReads;
        result.pageErrors = session.state.pageErrors;
        check(result, "No unconfigured fixture reads", result.unknownFixtureReads.length === 0, result.unknownFixtureReads, true);
        check(result, "No uncaught browser/interception errors", result.pageErrors.length === 0, result.pageErrors, false);
        const unexpected = result.blockedWrites.filter(request => definition.id !== "peak-hours" || request.pathname !== "/operations/peak-hours" || request.method !== "POST");
        check(result, "No unexpected business-write attempts", unexpected.length === 0, unexpected, true);
        await session.close();
      }
    }
    console.log(`${stage} ${theme} ${width}px ${definition.id}: ${result.checks.filter(item => item.passed).length}/${result.checks.length} checks`);
  }
} catch (error) {
  report.failures.push({ kind: "fatal", message: error.stack || error.message });
} finally {
  if (browser) await browser.close().catch(error => report.failures.push({ kind: "browser-close", message: error.message }));
  report.finishedAt = new Date().toISOString();
  report.summary = { cases: report.cases.length, failures: report.failures.length, baselineObservations: report.baselineObservations.length, screenshots: report.screenshots.length, businessSuccessClaims: 0 };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, ...report.summary }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
