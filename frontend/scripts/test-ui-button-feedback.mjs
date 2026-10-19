/* global window, document, localStorage, MutationObserver, getComputedStyle, requestAnimationFrame, HTMLAnchorElement, process, URL, AbortSignal, console, setTimeout, performance, fetch */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run only when the parent QA reaches its cross-cutting stage. No server is started.
// API8006 must use sqlite:////tmp/hsr-session-close-ui.db. Approved GETs may
// reconcile this isolated QA database; this audit does not assert zero DB effects.
// node frontend/scripts/test-ui-button-feedback.mjs --routes=/settings,/live-floor --widths=1440,375
// Options also accept BUTTON_FEEDBACK_<UPPER_SNAKE_CASE> environment variables.
// --app-url, --api-url, --report-path, --chrome-path, --themes, --max-depth,
// --max-states, --max-buttons (0 = unlimited), --settle-ms, --outcome-ms.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const argument = process.argv[i];
  if (!argument.startsWith("--")) throw new Error(`Expected an option, received ${argument}`);
  const [key, ...rest] = argument.slice(2).split("=");
  const value = rest.length ? rest.join("=") : process.argv[++i];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
  options.set(key, value);
}
const names = ["app-url", "api-url", "report-path", "chrome-path", "routes", "widths", "themes", "scope", "retry-report", "isolate-reminders", "max-depth", "max-states", "max-buttons", "settle-ms", "outcome-ms"];
for (const key of options.keys()) if (!names.includes(key)) throw new Error(`Unknown option --${key}`);
const option = (name, fallback) => options.get(name) ?? process.env[`BUTTON_FEEDBACK_${name.replaceAll("-", "_").toUpperCase()}`] ?? fallback;
function integer(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid --${name}`);
  return value;
}
function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`Only literal loopback HTTP origins are permitted: ${value}`);
  }
  return url.origin;
}
const app = localOrigin(option("app-url", process.env.UI_APP_URL || "http://127.0.0.1:5181"));
const api = localOrigin(option("api-url", process.env.UI_API_URL || "http://127.0.0.1:8006"));
const qaApiOrigin = "http://127.0.0.1:8006";
const qaDatabase = "sqlite:////tmp/hsr-session-close-ui.db";
if (api !== qaApiOrigin) throw new Error(`This audit requires the isolated QA API at ${qaApiOrigin}, backed by ${qaDatabase}`);
if (app === api) throw new Error("App and API must have distinct origins");
const reportPath = path.resolve(root, option("report-path", "docs/ui-readiness/button-feedback/results.json"));
const widths = [...new Set(option("widths", "1440,375").split(",").map(Number))];
if (!widths.length || widths.some(width => !Number.isInteger(width) || width < 320 || width > 3840)) throw new Error("Invalid widths");
const themes = [...new Set(option("themes", "light,dark").split(","))];
if (!themes.length || themes.some(theme => !["light", "dark"].includes(theme))) throw new Error("Invalid themes");
const maxDepth = integer("max-depth", 1, 0, 5);
const scope = option("scope", "all");
if (!["all", "page", "shell"].includes(scope)) throw new Error("Invalid button scope");
const isolateReminders = option("isolate-reminders", "false") === "true";
const retryPath = option("retry-report", "");
const retryTargets = retryPath ? JSON.parse(await fs.readFile(path.resolve(root, retryPath), "utf8")).buttons.filter(row => ["fail", "unreachable", "unmeasured-navigation"].includes(row.feedback.status)) : null;
const maxStates = integer("max-states", 6, 1, 1000);
const maxButtons = integer("max-buttons", 0, 0, 100000);
const settleMs = integer("settle-ms", 350, 100, 10000);
const outcomeMs = integer("outcome-ms", 1200, 250, 10000);
const deadlineMs = 200;
const blockedDelayMs = 700;
const buttonSelector = 'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]';
const surfaceSelector = '[role="dialog"],[role="menu"],.offcanvas.show,.modal.show';
const screenshotStates = ["default", "hover", "pressed", "focus", "loading", "disabled"];
const samples = new Map();
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), app, api,
  configuration: { widths, themes, scope, isolateReminders, retryPath, deadlineMs, outcomeMs, blockedDelayMs, maxDepth, maxStates, maxButtons, settleMs },
  safety: {
    localLoginExceptions: 0, forwardedBusinessWriteMethods: 0,
    expectedQaDatabase: qaDatabase, databaseVerification: "Operator-provided isolation guarantee; not independently verified by this browser audit",
    localDatabaseSideEffects: "Approved QA GETs may reconcile state; DB side effects are not measured or claimed absent",
    policy: "Exact API8006 QA origin; allowlisted GET/HEAD only, including approved reconciling GETs; all business POST/PUT/PATCH/DELETE blocked; same-origin reviewed read redirects only; no service workers, WebSockets or event streams",
  },
  routes: [], buttons: [], exclusions: [], screenshots: [], errors: [],
  limitations: [
    "Feedback is not business success. Writes receive a deliberate HTTP 409 after 700ms; transient loading can pass feedback while action remains blocked.",
    "Action-outcome observations stop at the configured outcomeMs window; an incomplete request is not called successful. The in-page feedback deadline remains 200ms regardless of that window.",
    "GET /bookings and GET /sessions/quote/<id> are allowed only on API8006 against the operator-isolated sqlite:////tmp/hsr-session-close-ui.db. These GETs may reconcile QA state, including booking expiry and session-key initialization; zero local DB side effects are not asserted.",
    "All browser POST/PUT/PATCH/DELETE requests, including checkout preview and all settlement/business writes, are blocked. Local QA login via Node fetch is the sole POST exception.",
    "Only rendered buttons are inventoried; offscreen buttons are scrolled into view. Hidden controls, unavailable records, disabled controls and bounded exploration are reported, not passed.",
    "No form filling, business fixtures, synthetic component states or seeded records. Overlay/menu exploration defaults to depth 1 and six states per route/configuration (including default); limit exclusions are explicit. Replay blocks business write methods but permits approved QA GET reconciliation.",
    "The optional page/shell scopes partition initial controls: shared navigation must be tested separately, not inferred as a per-page click. Page scope includes each route-specific topbar action. Revealed dialogs and menus remain included.",
    "Optional reminder isolation replaces only the local alerts read with an empty browser response, preserving its config. Reminder behavior/layering is verified separately; obscured controls are not called unresponsive. Retry runs cover only the prior report's failed/unmeasured controls.",
    "Press feedback compares painted computed properties against settled hover, not :active membership. Click DOM feedback ignores arbitrary clock text and unrelated attribute changes.",
    "Focus images use keyboard modality plus direct focus, not a complete keyboard-navigation audit. Screenshot sheets contain actual button crops, not whole-page evidence.",
    "Service workers, WebSockets, SSE and external assets are blocked; live-sync fallback may differ from an unrestricted browser.",
  ],
};

// Fail closed except for the two explicitly authorized QA reconciliation GETs.
// Unknown API reads are excluded. Every redirect hop uses the same method/origin policy.
const apiReads = [
  /^\/(?:ready|health|auth\/me)\/?$/,
  /^\/product\/(?:context|account|setup)\/?$/,
  /^\/sessions\/(?:active|tables|live-floor|maintenance|alerts)\/?$/,
  /^\/sessions\/(?:history|audit|events)\/[^/]+\/?$/,
  /^\/bookings\/start-options\/[^/]+\/?$/,
  /^\/members(?:\/(?:search|recent|duplicates))?\/?$/,
  /^\/reports\/(?:summary|dashboard|history|export|top-customers|table-utilization|closing-report|closing-insights|analytics|advanced-analytics|session-edits)\/?$/,
  /^\/settings\/(?:session-controls|tariffs|rates|min-session|booking-grace|menu)\/?$/,
  /^\/operations\/(?:peak-hours|current-rate|gst|security-controls|audit-logs)\/?$/,
  /^\/food\/(?:orders|stats)\/?$/,
  /^\/(?:waitlist|challenges|tournaments)(?:\/\d+)?\/?$/,
  /^\/staff\/roles\/?$/,
];
const qaReconcilingReads = [/^\/bookings\/?$/, /^\/sessions\/quote\/[^/]+\/?$/];
const isQaReconcilingGet = (url, method) => url.origin === qaApiOrigin && method === "GET" && qaReconcilingReads.some(pattern => pattern.test(url.pathname));
const isAllowedApiRead = (url, method) => url.origin === api && (apiReads.some(pattern => pattern.test(url.pathname)) || isQaReconcilingGet(url, method));
const cleanUrl = value => { const url = new URL(value); return `${url.origin}${url.pathname}`; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function validateRoute(value) {
  if (!value.startsWith("/") || value.startsWith("//") || new URL(value, app).origin !== app || value.includes("#")) throw new Error(`Unsafe route: ${value}`);
  return `${new URL(value, app).pathname}${new URL(value, app).search}`;
}
async function discoverRoutes() {
  const source = await fs.readFile(path.join(root, "frontend/src/App.jsx"), "utf8");
  const discovered = [...source.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map(match => match[1]).filter(route => route !== "*");
  if (!discovered.length) throw new Error("No routes found in App.jsx; supply --routes explicitly");
  return [...new Set(discovered.map(validateRoute))];
}

// Installed only at browser presentation boundaries. Application handlers, response
// parsing, DOM rendering and promise rejection are left untouched.
function initializeBrowser({ auth, theme, appOrigin }) {
  if (window.location.origin !== appOrigin) return;
  localStorage.clear();
  localStorage.setItem("theme", theme);
  if (auth) for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
  window.__buttonPresentation = [];
  window.__buttonFailures = [];
  window.print = () => window.__buttonPresentation.push({ kind: "print", at: performance.now() });
  const preventDownload = anchor => {
    if (!anchor.hasAttribute("download") && !anchor.href.startsWith("blob:")) return false;
    window.__buttonPresentation.push({ kind: "download", at: performance.now(), filename: anchor.download || "unnamed" });
    return true;
  };
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!preventDownload(this)) return nativeClick.call(this); };
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a");
    if (anchor && preventDownload(anchor)) event.preventDefault();
  }, true);
  window.addEventListener("hsr:action-failed", event => window.__buttonFailures.push(String(event.detail)));
}

async function createCase(browser, route, theme, width, auth) {
  const network = [];
  const pageErrors = [];
  let phase = "setup";
  let closing = false;
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, colorScheme: theme, serviceWorkers: "block", acceptDownloads: false });
  await context.addInitScript(initializeBrowser, { auth: new URL(app + route).pathname === "/login" ? null : auth, theme, appOrigin: app });
  await context.routeWebSocket("**/*", socket => { network.push({ phase, kind: "blocked-websocket", url: cleanUrl(socket.url()) }); socket.close(); });
  await context.route("**/*", async handler => {
    const request = handler.request();
    const url = new URL(request.url());
    const method = request.method();
    const entry = { phase, method, url: cleanUrl(url), at: Date.now() };
    const headers = { "access-control-allow-origin": app, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE", "cache-control": "no-store" };
    try {
      if (![app, api].includes(url.origin) || url.username || url.password) {
        network.push({ ...entry, kind: "blocked-origin" });
        return await handler.abort("blockedbyclient");
      }
      if (method === "OPTIONS") return await handler.fulfill({ status: 204, headers });
      if (!["GET", "HEAD"].includes(method)) {
        network.push({ ...entry, kind: "blocked-mutation" });
        await wait(blockedDelayMs);
        if (!closing) await handler.fulfill({ status: 409, headers, json: { detail: "Button feedback audit: this business write request was intentionally blocked and was not forwarded." } });
        return;
      }
      const isApi = url.origin === api;
      if (isApi && url.pathname === "/events/stream") {
        network.push({ ...entry, kind: "realtime-unavailable-fixture", status: 503 });
        return await handler.fulfill({ status: 503, headers, json: { detail: "Read-only button QA uses polling fallback" } });
      }
      if (isApi && !isAllowedApiRead(url, method)) {
        network.push({ ...entry, kind: "blocked-read", reason: "Unreviewed read/stream or method outside the approved QA GET policy" });
        return await handler.fulfill({ status: 409, headers, json: { detail: "Audit safety guard: this read is excluded." } });
      }
      const favicon = !isApi && url.pathname === "/favicon.svg" && !url.search && request.resourceType() === "other";
      if (!isApi && !favicon && !["document", "script", "stylesheet", "image", "font", "manifest"].includes(request.resourceType())) {
        network.push({ ...entry, kind: "blocked-app-data-request" });
        return await handler.abort("blockedbyclient");
      }
      if (isQaReconcilingGet(url, method)) network.push({ ...entry, kind: "qa-reconciling-get-attempt", database: qaDatabase, sideEffects: "Permitted local QA reconciliation; not measured" });
      let response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 12000 });
      if (favicon && response.headers()["content-type"]?.split(";")[0].trim() !== "image/svg+xml") throw new Error("Unexpected favicon content type");
      let current = url;
      for (let hops = 0; response.status() >= 300 && response.status() < 400; hops += 1) {
        const location = response.headers().location;
        const target = location ? new URL(location, current) : null;
        if (hops >= 4 || !target || target.origin !== url.origin || target.username || target.password || (isApi && !isAllowedApiRead(target, method))) {
          network.push({ ...entry, kind: "blocked-redirect", status: response.status(), target: target ? cleanUrl(target) : null });
          return await handler.fulfill({ status: 409, headers, body: "Audit blocked redirect" });
        }
        network.push({ ...entry, kind: "reviewed-read-redirect", target: cleanUrl(target) });
        if (isQaReconcilingGet(target, method)) network.push({ ...entry, url: cleanUrl(target), kind: "qa-reconciling-get-attempt", database: qaDatabase, sideEffects: "Permitted local QA reconciliation; not measured" });
        current = target;
        response = await handler.fetch({ url: target.href, maxRedirects: 0, maxRetries: 0, timeout: 12000 });
      }
      if (response.status() >= 400) network.push({ ...entry, kind: "read-error", status: response.status() });
      if (isolateReminders && isApi && url.pathname === "/sessions/alerts" && response.ok()) {
        const payload = await response.json();
        network.push({ ...entry, kind: "reminder-isolation-fixture" });
        return await handler.fulfill({ response, json: { ...payload, alerts: [], owner_summaries: [] } });
      }
      await handler.fulfill({ response });
    } catch (error) {
      if (!closing) { network.push({ ...entry, kind: "request-error", message: error.message }); await handler.abort("failed").catch(() => {}); }
    }
  });
  const page = await context.newPage();
  const pendingReads = new Set();
  page.on("request", request => {
    if (request.url().startsWith(api + "/") && request.method() === "GET" && !request.url().includes("/events/stream")) pendingReads.add(request);
  });
  const finishRead = request => pendingReads.delete(request);
  page.on("requestfinished", finishRead);
  page.on("requestfailed", finishRead);
  page.setDefaultTimeout(2500);
  page.on("pageerror", error => pageErrors.push({ phase, message: error.message }));
  page.on("dialog", dialog => { network.push({ phase, kind: "native-dialog-dismissed", type: dialog.type(), message: dialog.message() }); void dialog.dismiss().catch(() => {}); });
  page.on("download", download => { network.push({ phase, kind: "download-cancelled", filename: download.suggestedFilename() }); void download.cancel().catch(() => {}); });
  context.on("page", popup => { if (popup !== page) { network.push({ phase, kind: "popup-excluded" }); void popup.close().catch(() => {}); } });
  return {
    context, page, network, pageErrors,
    setPhase(value) { phase = value; },
    async settleReads() {
      const started = Date.now();
      while (pendingReads.size && Date.now() - started < 15000) await wait(25);
      if (pendingReads.size) throw new Error("QA reads did not settle before the button inventory");
    },
    async close() { closing = true; await context.close(); },
  };
}

async function settle(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length), null, { timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settleMs);
}

async function inventory(page) {
  return page.locator(buttonSelector).evaluateAll((nodes, surface) => {
    const occurrences = new Map();
    const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .filter(node => node.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]')).at(-1);
    return nodes.map((node, index) => {
      const label = (node.getAttribute("aria-label") || (node.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim() || node.innerText || node.value || node.title || "").replace(/\s+/g, " ").trim();
      const key = JSON.stringify([node.tagName, node.getAttribute("role") || "", node.id, node.getAttribute("data-testid"), label]);
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const visible = !!node.getClientRects().length && box.width > 0 && box.height > 0 && style.visibility === "visible" && Number(style.opacity) > 0 && !node.closest('[hidden],[inert],[aria-hidden="true"]');
      const classes = [...node.classList];
      const variant = classes.includes("ui-button-icon") ? "icon" : classes.includes("ui-button-native") ? "native" : classes.find(name => /^ui-button-(primary|secondary|ghost|danger|success|warning)$/.test(name))?.slice(10) || "unshared";
      const blockedByModal = !!dialog && !dialog.contains(node);
      return { index, key, occurrence, label, variant, classes, visible: visible && !blockedByModal, blockedByModal, inPage: !!node.closest(".route-page,.login-page,.login-container") || node.matches(".cf-page-primary-action"), disabled: node.matches(":disabled") || node.getAttribute("aria-disabled") === "true", loading: node.getAttribute("aria-busy") === "true", surface: !!node.closest(surface) };
    });
  }, surfaceSelector);
}
const stableLabel = label => String(label).replace(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g, "<clock>").replace(/₹[\d,.]+/g, "<amount>");
const identity = button => {
  try { const parts = JSON.parse(button.key); parts[parts.length - 1] = stableLabel(parts.at(-1)); return `${JSON.stringify(parts)}:${button.occurrence}`; }
  catch { return `${stableLabel(button.key)}:${button.occurrence}`; }
};
async function findButton(page, descriptor) {
  const match = (await inventory(page)).find(button => identity(button) === identity(descriptor));
  if (!match?.visible) throw new Error(`Button no longer rendered: ${descriptor.label || descriptor.key}`);
  return page.locator(buttonSelector).nth(match.index);
}

// These two non-button openers are verified read-only UI handlers in this app.
// Do not guess at arbitrary clickable rows or click through nested action buttons.
async function safeOpeners(page, route) {
  const pathname = new URL(app + route).pathname;
  const selector = pathname === "/live-floor" ? '.lf-table-card[role="group"]' : pathname === "/sales" ? ".sales-table tbody tr" : null;
  if (!selector) return null;
  return page.locator(selector).evaluateAll((nodes, selector) => nodes.filter(node => node.getClientRects().length && node.getAttribute("aria-disabled") !== "true").map(node => ({
    kind: "safe-opener", selector,
    label: (node.getAttribute("aria-label") || node.querySelector("td")?.innerText || "").replace(/\s+/g, " ").trim(),
    key: (node.getAttribute("aria-label") || node.querySelector("td")?.innerText || "").replace(/\s+/g, " ").trim(), occurrence: 0,
  })), selector);
}

async function replayOpener(page, step) {
  if (step.kind !== "safe-opener") {
    const button = await findButton(page, step);
    if (await button.isDisabled() || step.disabled) throw new Error("Replay opener is disabled");
    await button.click();
    return;
  }
  const matches = await page.locator(step.selector).evaluateAll((nodes, label) => nodes.map((node, index) => ({ index, label: (node.getAttribute("aria-label") || node.querySelector("td")?.innerText || "").replace(/\s+/g, " ").trim() })).filter(item => item.label === label), step.label);
  if (matches.length !== 1) throw new Error("Read-only row/card opener is missing or ambiguous");
  const opener = page.locator(step.selector).nth(matches[0].index);
  if (step.selector.includes("lf-table-card")) { await opener.focus(); await opener.press("Enter"); }
  else await opener.locator("td").first().click();
}

// The clocks live in the page so protocol latency and screenshot time cannot turn
// feedback later than 200ms into a pass. Style is sampled against hover, not default.
async function installProbe(button) {
  await button.evaluate(node => {
    window.__buttonProbe?.stop?.();
    const visible = element => element?.isConnected && element.getClientRects().length && getComputedStyle(element).visibility === "visible" && Number(getComputedStyle(element).opacity) > 0;
    const paint = element => {
      if (!visible(element)) return null;
      const properties = ["backgroundColor", "backgroundImage", "color", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "boxShadow", "filter", "transform", "opacity", "outlineColor", "outlineStyle", "outlineWidth", "fontWeight", "textDecorationLine"];
      return [element, ...element.querySelectorAll("span,svg")].filter(visible).slice(0, 12).map(item => [null, "::before", "::after"].map(pseudo => {
        const style = getComputedStyle(item, pseudo);
        if (pseudo && ["none", "normal"].includes(style.content)) return null;
        return properties.map(property => style[property]).concat(pseudo ? style.content : "");
      }));
    };
    const baseline = JSON.stringify(paint(node));
    const initialText = node.innerText || node.value || "";
    const attributes = ["disabled", "aria-disabled", "aria-busy", "aria-expanded", "aria-pressed", "aria-selected", "aria-invalid"];
    const initialAttributes = attributes.map(name => node.getAttribute(name));
    const initialUrl = window.location.href;
    const probe = { pointerAt: null, clickAt: null, pressed: null, response: null, loading: false, stop: null };
    let stopped = false;
    const respond = kind => {
      if (probe.clickAt !== null && !probe.response) probe.response = { kind, ms: performance.now() - probe.clickAt };
    };
    const observer = new MutationObserver(records => {
      if (probe.clickAt === null) return;
      for (const record of records) {
        if (record.type !== "childList") continue;
        // Element additions/removals count only when currently visible or when
        // the audited target itself was removed; text-node clock ticks do not.
        if (!node.isConnected) respond("target-removed");
        if ([...record.addedNodes].some(item => item.nodeType === 1 && visible(item) && (item.innerText?.trim() || item.querySelector("svg,input,button")))) respond("visible-dom-added");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const down = event => { if (node === event.target || node.contains(event.target)) probe.pointerAt = performance.now(); };
    const click = event => { if (node === event.target || node.contains(event.target)) probe.clickAt = performance.now(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    const sample = () => {
      if (stopped) return;
      const now = performance.now();
      if (probe.pointerAt !== null && probe.clickAt === null && !probe.pressed && visible(node)) {
        const current = paint(node);
        if (current && JSON.stringify(current) !== baseline) probe.pressed = { ms: now - probe.pointerAt, before: JSON.parse(baseline), after: current };
      }
      if (probe.clickAt !== null) {
        if (window.location.href !== initialUrl) respond("navigation");
        if (!node.isConnected) respond("target-removed");
        if (visible(node)) {
          if (attributes.some((name, index) => node.getAttribute(name) !== initialAttributes[index])) respond("button-state-changed");
          if ((node.innerText || node.value || "") !== initialText) respond("button-label-changed");
          probe.loading ||= node.getAttribute("aria-busy") === "true" || node.getAttribute("data-loading") === "true" || !!node.querySelector(".ui-button-spinner");
        }
      }
      requestAnimationFrame(sample);
    };
    probe.stop = () => { stopped = true; observer.disconnect(); document.removeEventListener("pointerdown", down, true); document.removeEventListener("click", click, true); };
    window.__buttonProbe = probe;
    requestAnimationFrame(sample);
  });
}

async function takeSample(page, button, descriptor, state, metadata) {
  if (descriptor.variant === "unshared") return;
  const key = `${metadata.theme}:${metadata.width}:${descriptor.variant}:${state}`;
  if (samples.has(key)) return;
  try {
    const box = await button.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return;
    const x = Math.max(0, box.x - 8);
    const y = Math.max(0, box.y - 8);
    const clip = { x, y, width: Math.min(viewport.width, box.x + box.width + 8) - x, height: Math.min(viewport.height, box.y + box.height + 8) - y };
    if (clip.width <= 0 || clip.height <= 0) return;
    const image = await page.screenshot({ clip, animations: "allow", timeout: 1000 });
    samples.set(key, { ...metadata, variant: descriptor.variant, state, button: descriptor.label, image: image.toString("base64") });
  } catch (error) {
    report.errors.push({ kind: "screenshot-sample-unavailable", ...metadata, state, button: descriptor.label, message: error.message });
  }
}

async function testButton(testCase, descriptor, metadata) {
  const { page } = testCase;
  const button = await findButton(page, descriptor);
  const result = { ...metadata, button: descriptor, feedback: { status: "untested", pressedWithin200ms: false, clickResponseWithin200ms: false }, actionOutcome: { status: "not-attempted", businessSuccess: "not-asserted" } };
  await button.scrollIntoViewIfNeeded();
  if (await button.isDisabled() || descriptor.disabled) {
    result.feedback.status = "disabled";
    result.actionOutcome.status = "disabled-not-invoked";
    await takeSample(page, button, descriptor, descriptor.loading ? "loading" : "disabled", metadata);
    return result;
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(100);
  await takeSample(page, button, descriptor, "default", metadata);
  if (await button.evaluate(node => !!node.closest('[role="menu"]'))) await page.keyboard.press("ArrowDown");
  else await page.keyboard.press("Tab");
  await button.focus();
  await page.waitForTimeout(48);
  await takeSample(page, button, descriptor, "focus", metadata);
  await page.evaluate(() => document.activeElement?.blur());
  await button.hover();
  await page.waitForTimeout(360);
  await takeSample(page, button, descriptor, "hover", metadata);
  await installProbe(button);
  const box = await button.boundingBox();
  if (!box) throw new Error("Button lost its bounds before press");
  const point = await button.evaluate((node, { box, selector }) => {
    for (const [across, down] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const point = { x: box.x + box.width * across, y: box.y + box.height * down };
      const element = document.elementFromPoint(point.x, point.y);
      const interactive = element?.closest(`${selector},a[href],input,select,textarea`);
      if ((node === element || node.contains(element)) && (!interactive || interactive === node)) return point;
    }
    return null;
  }, { box, selector: buttonSelector });
  if (!point) throw new Error("Button is obscured or its click points belong to nested controls");
  testCase.setPhase("action");
  const beforeUrl = page.url();
  let pressedProbe;
  await page.mouse.move(point.x, point.y);
  try {
    await page.mouse.down();
    await page.waitForTimeout(215);
    pressedProbe = await page.evaluate(() => {
      const value = window.__buttonProbe;
      return value ? { pointerAt: value.pointerAt, pressed: value.pressed } : null;
    }).catch(() => null);
    await takeSample(page, button, descriptor, "pressed", metadata);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(70);
  try {
    const busy = await button.evaluate(node => node.getAttribute("aria-busy") === "true" || node.getAttribute("data-loading") === "true" || !!node.querySelector(".ui-button-spinner"));
    if (busy) await takeSample(page, button, descriptor, "loading", metadata);
  } catch { /* A navigation or a removed target is valid feedback, not a screenshot fixture. */ }
  await page.waitForTimeout(outcomeMs);
  const clickProbe = await page.evaluate(() => {
    const value = window.__buttonProbe;
    value?.stop();
    return value ? { pointerAt: value.pointerAt, clickAt: value.clickAt, pressed: value.pressed, response: value.response, loading: value.loading } : null;
  }).catch(() => null);
  const probe = clickProbe || pressedProbe;
  result.feedback = {
    status: "fail", deadlineMs,
    pressedWithin200ms: !!probe?.pressed && probe.pressed.ms <= deadlineMs,
    clickResponseWithin200ms: !!probe?.response && probe.response.ms <= deadlineMs,
    pressed: probe?.pressed || null, clickResponse: probe?.response || null,
    loadingObserved: probe?.loading || false,
  };
  // Preserve measured press evidence across a full-document navigation. A missing
  // click clock is never converted to a timing pass based on Node's wall clock.
  if (result.feedback.pressedWithin200ms || result.feedback.clickResponseWithin200ms) result.feedback.status = "pass";
  else if (!clickProbe && page.url() !== beforeUrl) result.feedback.status = "unmeasured-navigation";
  const events = testCase.network.filter(event => event.phase === "action");
  const presentation = await page.evaluate(() => window.__buttonPresentation || []).catch(() => []);
  const actionFailures = await page.evaluate(() => window.__buttonFailures || []).catch(() => []);
  const actionErrors = testCase.pageErrors.filter(error => error.phase === "action");
  result.actionOutcome = {
    status: events.some(event => event.kind === "blocked-mutation") ? "mutation-blocked" : events.some(event => event.kind.startsWith("blocked-")) ? "safety-boundary-blocked" : actionFailures.length || actionErrors.length || events.some(event => ["read-error", "request-error"].includes(event.kind)) ? "error-observed" : presentation.length ? "presentation-boundary-only" : beforeUrl !== page.url() ? "navigation-observed" : probe?.response ? "local-dom-response-observed" : "no-action-outcome-observed",
    businessSuccess: "not-asserted", urlAfter: page.url(), network: events, presentation, actionFailures, pageErrors: actionErrors,
  };
  return result;
}

async function openState(browser, route, theme, width, auth, steps) {
  const testCase = await createCase(browser, route, theme, width, auth);
  try {
    await testCase.page.goto(app + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    await settle(testCase.page);
    await testCase.settleReads();
    await settle(testCase.page);
    if (new URL(app + route).pathname !== "/login" && new URL(testCase.page.url()).pathname === "/login") throw new Error("Authentication redirected this route to login");
    testCase.setPhase("replay");
    for (const step of steps) {
      const opener = !step.kind && !step.key?.startsWith("[") ? (await safeOpeners(testCase.page, route))?.find(candidate => candidate.key === step.key) : step;
      if (!opener) throw new Error("Prior read-only opener is no longer available");
      await replayOpener(testCase.page, opener);
      await settle(testCase.page);
      await testCase.settleReads();
      await settle(testCase.page);
      if (testCase.network.some(event => event.phase === "replay" && ["blocked-mutation", "blocked-read", "blocked-origin"].includes(event.kind))) throw new Error("Unsafe/unavailable opener: replay stopped at safety boundary");
    }
    return testCase;
  } catch (error) { await testCase.close(); throw error; }
}

async function auditRoute(browser, route, theme, width, auth) {
  const metadata = { route, theme, width };
  const targets = retryTargets?.filter(row => row.route === route && row.theme === theme && row.width === width);
  if (targets && !targets.length) return;
  const queue = targets ? [...new Map(targets.map(row => [JSON.stringify(row.steps), row.steps])).values()].map(steps => ({ steps, buttons: targets.filter(row => JSON.stringify(row.steps) === JSON.stringify(steps)).map(row => row.button) })) : [{ steps: [], buttons: null }];
  const stateKeys = new Set();
  let states = 1;
  let tested = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    let discovery;
    try {
      discovery = await openState(browser, route, theme, width, auth, state.steps);
      const controls = await inventory(discovery.page);
      const visible = controls.filter(button => button.visible);
      if (!state.steps.length) {
        const screenState = discovery.network.some(event => ["blocked-read", "blocked-origin", "blocked-app-data-request", "blocked-redirect"].includes(event.kind)) ? "safety-degraded" : discovery.network.some(event => ["read-error", "request-error"].includes(event.kind)) || discovery.pageErrors.length ? "data-error" : "default";
        report.routes.push({ ...metadata, status: "reachable", screenState, url: discovery.page.url(), visibleButtons: visible.length, hiddenButtons: controls.filter(button => !button.visible).map(button => ({ ...button, status: "excluded-hidden" })), setupNetwork: discovery.network, pageErrors: discovery.pageErrors });
        if (!options.has("routes") && !process.env.BUTTON_FEEDBACK_ROUTES) {
          const links = await discovery.page.locator('a[href^="/"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
          for (const link of links) {
            if (link.startsWith("//") || link.includes("#")) continue;
            const candidate = validateRoute(link);
            if (!routes.includes(candidate)) routes.push(candidate);
          }
        }
        const openers = scope === "shell" ? null : await safeOpeners(discovery.page, route);
        if (openers && !openers.length) report.exclusions.push({ ...metadata, status: "unreachable-record-overlay", reason: "No enabled records for the verified read-only card/receipt opener" });
        for (const opener of openers || []) {
          if (!maxDepth || states >= maxStates) report.exclusions.push({ ...metadata, opener, status: "excluded-state-limit", reason: !maxDepth ? "depth limit" : "state limit", maxDepth, maxStates });
          else { states += 1; queue.push({ steps: [opener], buttons: null, overlayOnly: true }); }
        }
      }
      if (!state.buttons) {
        const selected = !state.steps.length && scope !== "all" ? visible.filter(button => scope === "page" ? button.inPage : !button.inPage) : state.overlayOnly ? visible.filter(button => button.surface) : visible;
        if (!state.steps.length && scope !== "all") for (const button of visible.filter(button => !selected.includes(button))) report.exclusions.push({ ...metadata, button, status: "separate-scope", requiredCompanionScope: scope === "page" ? "shell" : "page" });
        state.buttons = selected;
      }
      if (state.overlayOnly && !state.buttons.length) report.exclusions.push({ ...metadata, steps: state.steps, status: "unreachable-record-overlay", reason: "Read-only opener did not reveal any rendered dialog/menu buttons" });
    } catch (error) {
      const entry = { ...metadata, steps: state.steps, reason: error.message };
      if (!state.steps.length) report.routes.push({ ...entry, status: "unreachable" });
      else report.exclusions.push({ ...entry, status: "unreachable-state" });
      continue;
    } finally { if (discovery) await discovery.close(); }
    for (const descriptor of state.buttons) {
      const details = { ...metadata, steps: state.steps.map(step => ({ ...step })) };
      if (maxButtons && tested >= maxButtons) { report.exclusions.push({ ...details, button: descriptor, status: "excluded-button-limit" }); continue; }
      tested += 1;
      let testCase;
      try {
        testCase = await openState(browser, route, theme, width, auth, state.steps);
        const currentControls = await inventory(testCase.page);
        if (currentControls.some(button => identity(button) === identity(descriptor) && button.blockedByModal)) {
          report.exclusions.push({ ...details, button: descriptor, status: "expected-modal-background", reason: "An open modal intentionally blocks this background control" });
          continue;
        }
        const before = new Set(currentControls.filter(button => button.visible).map(identity));
        const result = await testButton(testCase, descriptor, details);
        result.setupNetwork = testCase.network.filter(event => event.phase !== "action");
        report.buttons.push(result);
        if (result.feedback.status !== "pass" && result.feedback.status !== "disabled") console.log(`Feedback ${result.feedback.status}: ${route} / ${descriptor.label}`);
        const safe = !testCase.network.some(event => event.phase === "action" && (event.kind.startsWith("blocked-") || event.kind === "request-error")) && result.actionOutcome.status !== "disabled-not-invoked";
        if (!safe || new URL(testCase.page.url()).pathname !== new URL(app + route).pathname) continue;
        if (retryTargets) continue;
        const after = (await inventory(testCase.page)).filter(button => button.visible);
        const revealed = after.filter(button => !before.has(identity(button)));
        if (!revealed.length) continue;
        const nextSteps = [...state.steps, descriptor];
        const signature = JSON.stringify([nextSteps.map(identity), revealed.map(identity)]);
        if (stateKeys.has(signature)) continue;
        stateKeys.add(signature);
        if (nextSteps.length > maxDepth || states >= maxStates) {
          report.exclusions.push({ ...metadata, steps: nextSteps, buttons: revealed, status: "excluded-state-limit", reason: nextSteps.length > maxDepth ? "depth limit" : "state limit", maxDepth, maxStates });
        } else {
          states += 1;
          queue.push({ steps: nextSteps, buttons: revealed });
        }
      } catch (error) {
        report.buttons.push({ ...details, button: descriptor, feedback: { status: "unreachable", reason: error.message }, actionOutcome: { status: "unmeasured", businessSuccess: "not-asserted" } });
      } finally {
        if (testCase) await testCase.close();
        if (tested % 10 === 0) await fs.writeFile(reportPath, `${JSON.stringify({ ...report, inProgress: true }, null, 2)}\n`);
      }
    }
  }
  console.log(`Audited ${route} ${theme} ${width}px: ${tested} buttons across ${states} states`);
  await fs.writeFile(reportPath, `${JSON.stringify({ ...report, inProgress: true }, null, 2)}\n`);
}

const escapeHtml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function saveScreenshotSheets(browser) {
  for (const theme of themes) for (const width of widths) {
    if (report.screenshots.length >= 12) { report.exclusions.push({ theme, width, status: "excluded-screenshot-limit" }); continue; }
    const group = [...samples.values()].filter(sample => sample.theme === theme && sample.width === width);
    const variants = [...new Set(group.map(sample => sample.variant))];
    if (!variants.length) { report.exclusions.push({ theme, width, status: "unreachable-screenshot-states", reason: "No shared-variant crop captured" }); continue; }
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      await context.route("**/*", handler => handler.abort("blockedbyclient"));
      await context.routeWebSocket("**/*", socket => socket.close());
      const page = await context.newPage();
      await page.setViewportSize({ width: 1590, height: 1000 });
      const cells = variants.map(variant => screenshotStates.map(state => {
        const sample = group.find(item => item.variant === variant && item.state === state);
        return `<section><b>${escapeHtml(variant)} / ${state}</b>${sample ? `<img src="data:image/png;base64,${sample.image}" alt="${escapeHtml(sample.button)}"><small>${escapeHtml(sample.route)}: ${escapeHtml(sample.button)}</small>` : "<p>Not naturally observed</p>"}</section>`;
      }).join("")).join("");
      await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:20px;font:13px Arial;background:${theme === "dark" ? "#161616" : "#fafafa"};color:${theme === "dark" ? "#fafafa" : "#161616"}}h1{font-size:20px}main{display:grid;grid-template-columns:repeat(6,250px);gap:8px}section{height:150px;border:1px solid #888;padding:7px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}b{font-size:12px}img{max-width:232px;max-height:85px;object-fit:contain;align-self:flex-start}small{overflow-wrap:anywhere;font-size:10px}p{color:#888}</style></head><body><h1>Observed shared button states: ${theme}, ${width}px viewport</h1><p>Actual crops from real screens. Loading is feedback only. Business write requests were blocked; approved QA GETs may reconcile local state. Missing cells are not passes.</p><main>${cells}</main></body></html>`);
      await page.locator("img").evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
      const imagePath = path.join(path.dirname(reportPath), `button-states-${theme}-${width}.png`);
      await page.screenshot({ path: imagePath, fullPage: true });
      report.screenshots.push({ theme, width, path: imagePath, samples: group.map(sample => ({ theme: sample.theme, width: sample.width, route: sample.route, steps: sample.steps, button: sample.button, variant: sample.variant, state: sample.state })), missing: variants.flatMap(variant => screenshotStates.filter(state => !group.some(item => item.variant === variant && item.state === state)).map(state => ({ variant, state, status: "not-naturally-observed" }))) });
    } finally { await context.close(); }
  }
}

let routes = option("routes", "") ? [...new Set(option("routes", "").split(",").map(validateRoute))] : await discoverRoutes();
report.configuration.routes = [...routes];
await fs.mkdir(path.dirname(reportPath), { recursive: true });
let browser;
async function authenticateQa() {
  // This is the sole allowed POST: local QA authentication, before interception.
  const response = await fetch(`${api}/auth/login`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.BUTTON_FEEDBACK_USERNAME || "admin", password: process.env.BUTTON_FEEDBACK_PASSWORD || "admin123" }),
  });
  report.safety.localLoginExceptions += 1;
  if (!response.ok) throw new Error(`Local QA login failed: HTTP ${response.status}`);
  const auth = await response.json();
  if (!auth.token || !auth.role || !auth.username) throw new Error("Local login did not provide token, role and username");
  return auth;
}
try {
  let auth = await authenticateQa();
  let authenticatedAt = Date.now();
  browser = await chromium.launch({ executablePath: option("chrome-path", process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
  for (const theme of themes) for (const width of widths) {
    for (let index = 0; index < routes.length; index += 1) {
      if (Date.now() - authenticatedAt >= 3600000) {
        auth = await authenticateQa();
        authenticatedAt = Date.now();
      }
      await auditRoute(browser, routes[index], theme, width, auth);
    }
  }
  await saveScreenshotSheets(browser);
} catch (error) {
  report.errors.push({ kind: "fatal", message: error.stack || error.message });
  process.exitCode = 2;
} finally {
  if (browser) await browser.close().catch(error => { report.errors.push({ kind: "browser-close", message: error.message }); process.exitCode = 2; });
  report.finishedAt = new Date().toISOString();
  report.configuration.discoveredRoutes = routes;
  report.summary = {
    routes: report.routes.length, degradedScreens: report.routes.filter(route => route.screenState && route.screenState !== "default").length, buttons: report.buttons.length,
    feedback: report.buttons.reduce((counts, result) => ({ ...counts, [result.feedback.status]: (counts[result.feedback.status] || 0) + 1 }), {}),
    actionOutcomes: report.buttons.reduce((counts, result) => ({ ...counts, [result.actionOutcome.status]: (counts[result.actionOutcome.status] || 0) + 1 }), {}),
    exclusions: report.exclusions.length, screenshots: report.screenshots.length,
    businessSuccessClaims: 0,
  };
  if (!process.exitCode && (report.buttons.some(result => ["fail", "unreachable", "unmeasured-navigation"].includes(result.feedback.status)) || report.routes.some(route => route.status === "unreachable") || !report.buttons.length)) process.exitCode = 1;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, ...report.summary }, null, 2));
}
