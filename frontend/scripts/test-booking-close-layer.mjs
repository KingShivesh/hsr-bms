/* global process */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Run only after the parent confirms preview5181 is rebuilt. Never builds or starts servers.
// node frontend/scripts/test-booking-close-layer.mjs [before|after|both]
const mode = process.argv[2] || "both";
assert.ok(["before", "after", "both"].includes(mode) && process.argv.length <= 3, "Use before, after, or both.");
const origins = { before: "http://127.0.0.1:5180", after: "http://127.0.0.1:5181" };
const api = "http://127.0.0.1:8006";
const stages = mode === "both" ? ["before", "after"] : [mode];
const widths = [375, 768, 1024, 1440, 1920];
const themes = ["light", "dark"];
const output = fileURLToPath(new URL("../../docs/ui-readiness/booking-close-layer/", import.meta.url));
const reportFile = `${output}/${mode === "both" ? "results" : `results-${mode}`}.json`;
const original = JSON.parse(await fs.readFile(new URL("../../docs/ui-readiness/button-feedback/core-retry.json", import.meta.url), "utf8"));
const timeoutEvidence = JSON.parse(await fs.readFile(new URL("../../docs/ui-readiness/button-feedback/core-timeout-rechecks.json", import.meta.url), "utf8"));
const reminderEvidence = JSON.parse(await fs.readFile(new URL("../../docs/ui-readiness/reminder-stack/after-results.json", import.meta.url), "utf8"));
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), mode, origins, api,
  configuration: { route: "/bookings", widths, themes, isolateReminders: true, maxCases: stages.length * widths.length * themes.length },
  safety: {
    authenticationPosts: 0, forwardedBusinessWrites: 0, blockedWrites: [],
    expectedQaDatabase: "sqlite:////tmp/hsr-session-close-ui.db",
    databaseVerification: "Parent-provided QA isolation; not independently verified.",
    policy: "Only fixed loopback previews and API8006; allowlisted GET/HEAD, reviewed same-origin redirects; all browser writes, service workers, WebSockets and SSE blocked. Local authentication is the sole possible POST exception; BOOKING_QA_TOKEN avoids even that POST.",
    getSideEffects: "GET /bookings may reconcile isolated QA state. Zero database side effects are not asserted.",
  },
  cases: [], failures: [], baselineObservations: [], errors: [],
  harnessCorrection: { earlierAttempt: "docs/ui-readiness/booking-close-layer/opener-harness-attempt.json", reason: "Baseline mobile/tablet has no topbar New Booking control. Use the first existing New Booking control on either preview; missing topbar controls were harness setup misses, not app bugs." },
  limitations: ["Only the first existing New Booking opener (topbar when present) and Close booking form control are exercised; no form filling, submit, forced clicks, DOM relocation, CSS overrides or synthetic application states.", "A closed dialog is UI behavior, not a claim of business success."],
};
report.coreRetryDisposition = {
  sourceReport: "docs/ui-readiness/button-feedback/core-retry.json",
  rawSummary: original.summary,
  originalReportNotModified: true,
  policy: "These dispositions explain the original ten unreachable entries. They do not turn the original 68-pass/10-unreachable run into a passing raw run.",
  timeoutRecheckReport: "docs/ui-readiness/button-feedback/core-timeout-rechecks.json",
  timeoutRechecks: timeoutEvidence.cases,
  reminderEvidence: { report: "docs/ui-readiness/reminder-stack/after-results.json", summary: reminderEvidence.summary, cases: reminderEvidence.cases.map(({ stage, theme, width, status }) => ({ stage, theme, width, status })) },
  entries: original.buttons.flatMap((row, originalButtonIndex) => {
    if (row.feedback.status !== "unreachable") return [];
    const entry = { originalButtonIndex, route: row.route, theme: row.theme, width: row.width, openerSteps: row.steps.map(step => step.label), button: row.button.label, originalStatus: row.feedback.status, originalReason: row.feedback.reason.split("\n")[0] };
    if (row.button.label === "Close booking form") return [{ ...entry, disposition: "confirmed-booking-layer-bug", sourceFix: "BookingsPage.jsx: BookingModal body portal and z-index 2000", focusedVerification: "pending", verificationScope: "Same BookingModal close control and original width/theme; duplicate opener paths are not separately re-audited." }];
    if (row.button.classes?.includes("app-toast-action") && ["View", "Dismiss"].includes(row.button.label)) return [{ ...entry, disposition: "excluded-reminder-isolation-mismatch", explanation: "The retry disables reminder records that originally supplied these controls. Absence is not failed button feedback.", evidence: "docs/ui-readiness/reminder-stack/after-results.json", rawEntryNotReclassifiedAsPass: true }];
    const recheck = timeoutEvidence.cases.find(test => test.route === row.route && test.theme === row.theme && test.width === row.width);
    return [{ ...entry, disposition: recheck?.recheckStatus === "pass" ? "passed-on-separate-focused-recheck" : "unresolved", evidence: recheck || null, rawEntryNotReclassifiedAsPass: true }];
  }),
};
assert.equal(report.coreRetryDisposition.entries.length, 10, "Expected the original ten unreachable entries.");
assert.ok(report.coreRetryDisposition.entries.every(entry => entry.disposition !== "unresolved"), "Unmapped original finding.");
const reads = [
  /^\/(ready|health|auth\/me)\/?$/,
  /^\/product\/(context|account|setup)\/?$/,
  /^\/sessions\/(active|tables|live-floor|maintenance|alerts)\/?$/,
  /^\/bookings\/?$/,
  /^\/reports\/(summary|dashboard)\/?$/,
  /^\/settings\/(session-controls|tariffs|rates|min-session|booking-grace|menu)\/?$/,
  /^\/operations\/(current-rate|peak-hours|security-controls)\/?$/,
];

function localUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password, "Literal loopback HTTP only.");
  assert.ok([api, ...Object.values(origins)].includes(url.origin), "Unapproved local port.");
  return url;
}
for (const url of [api, ...Object.values(origins)]) localUrl(url);
const cleanUrl = value => { const url = new URL(value); return url.origin + url.pathname; };
const allowedRead = url => url.origin === api && reads.some(pattern => pattern.test(url.pathname));

async function authenticate() {
  if (process.env.BOOKING_QA_TOKEN) {
    const response = await fetch(localUrl(`${api}/auth/me`), {
      headers: { Authorization: `Bearer ${process.env.BOOKING_QA_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(12000),
    });
    assert.ok(response.ok, `Supplied local token rejected (${response.status}).`);
    const identity = await response.json();
    assert.equal(identity.role, "admin", "The supplied QA account must already be admin.");
    return { token: process.env.BOOKING_QA_TOKEN, role: identity.role, username: identity.username };
  }
  const response = await fetch(localUrl(`${api}/auth/login`), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.BUTTON_FEEDBACK_USERNAME || "admin", password: process.env.BUTTON_FEEDBACK_PASSWORD || "admin123" }),
  });
  report.safety.authenticationPosts++;
  assert.ok(response.ok, `Local QA login failed (${response.status}).`);
  const auth = await response.json();
  assert.ok(auth.token && auth.role === "admin", "Existing admin QA credentials required; no permission changes are made.");
  return auth;
}

async function screenshot(page, result, state) {
  const file = `${result.stage}/${result.theme}-${result.width}-${state}.png`;
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${output}/${file}`, animations: "disabled", fullPage: false });
  result.screenshots.push({ state, file });
}

async function guardedContext(browser, result, auth) {
  const origin = origins[result.stage];
  const context = await browser.newContext({
    viewport: { width: result.width, height: result.width === 375 ? 844 : 1000 },
    colorScheme: result.theme, serviceWorkers: "block", acceptDownloads: false,
  });
  await context.addInitScript(({ origin, auth, theme }) => {
    if (location.origin !== origin) return;
    localStorage.clear();
    localStorage.setItem("theme", theme);
    for (const key of ["token", "role", "username"]) if (auth[key] != null) localStorage.setItem(key, auth[key]);
  }, { origin, auth, theme: result.theme });
  await context.routeWebSocket("**/*", socket => { socket.close(); });
  await context.route("**/*", async handler => {
    const request = handler.request();
    const entry = { method: request.method(), url: cleanUrl(request.url()) };
    try {
      const url = localUrl(request.url());
      assert.ok(url.origin === origin || url.origin === api, "Cross-preview request rejected.");
      const headers = { "access-control-allow-origin": origin, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,HEAD,OPTIONS", "cache-control": "no-store" };
      if (request.method() === "OPTIONS") return await handler.fulfill({ status: 204, headers });
      if (!["GET", "HEAD"].includes(request.method())) {
        report.safety.blockedWrites.push({ stage: result.stage, theme: result.theme, width: result.width, ...entry });
        return await handler.fulfill({ status: 409, headers, json: { detail: "Read-only booking QA: write blocked, not forwarded." } });
      }
      if (url.origin === api && url.pathname === "/events/stream") return await handler.fulfill({ status: 503, headers, json: { detail: "Read-only QA disables event streams." } });
      if (url.origin === api) assert.ok(allowedRead(url), "Unreviewed API read rejected.");
      else assert.ok(["document", "script", "stylesheet", "image", "font", "manifest"].includes(request.resourceType()) || url.pathname === "/favicon.svg", "Unreviewed app data request rejected.");
      let current = url;
      let response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      for (let hops = 0; response.status() >= 300 && response.status() < 400; hops++) {
        assert.ok(hops < 4 && response.headers().location, "Redirect limit or missing location.");
        const target = localUrl(new URL(response.headers().location, current).href);
        assert.ok(target.origin === url.origin && (target.origin !== api || allowedRead(target)), "Unreviewed redirect rejected.");
        current = target;
        response = await handler.fetch({ url: target.href, maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      }
      if (response.status() >= 400) result.networkErrors.push({ ...entry, status: response.status() });
      if (url.origin === api && url.pathname === "/sessions/alerts" && response.ok()) {
        const data = await response.json();
        return await handler.fulfill({ response, json: { ...data, alerts: [], owner_summaries: [] } });
      }
      return await handler.fulfill({ response });
    } catch (error) {
      if (!result.closing) result.networkErrors.push({ ...entry, message: error.message });
      await handler.abort("blockedbyclient").catch(() => {});
    }
  });
  return context;
}

async function measure(close) {
  return close.evaluate(button => {
    const rect = node => {
      if (!node) return null;
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { tag: node.tagName, className: typeof node.className === "string" ? node.className : "SVG", zIndex: style.zIndex, position: style.position, opacity: style.opacity, transform: style.transform, isolation: style.isolation, bounds: { x: box.x, y: box.y, width: box.width, height: box.height } };
    };
    const box = button.getBoundingClientRect();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    const dialog = button.closest('[role="dialog"]');
    const backdrop = dialog?.parentElement;
    const ancestry = [];
    for (let node = button; node; node = node.parentElement) ancestry.push(rect(node));
    const modalBox = dialog.getBoundingClientRect();
    const leftPoint = { x: modalBox.x + 4, y: modalBox.y + modalBox.height / 2 };
    const leftHit = document.elementFromPoint(leftPoint.x, leftPoint.y);
    return {
      center: point, centerHitBelongsToButton: hit === button || button.contains(hit), hit: rect(hit),
      button: rect(button), dialog: rect(dialog), backdrop: rect(backdrop),
      topbar: rect(document.querySelector(".topbar")), sidebar: rect(document.querySelector(".cf-sidebar")),
      backdropDirectlyUnderBody: backdrop?.parentElement === document.body,
      modalLeftEdgeOwned: leftHit === dialog || dialog.contains(leftHit),
      scroll: { x: scrollX, y: scrollY, dialog: dialog.scrollTop }, ancestry,
    };
  });
}

async function runCase(browser, result, auth) {
  const context = await guardedContext(browser, result, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => result.pageErrors.push(error.message));
  page.on("download", download => { void download.cancel(); });
  context.on("page", popup => { if (popup !== page) void popup.close(); });
  try {
    await page.goto(`${origins[result.stage]}/bookings`, { waitUntil: "domcontentloaded", timeout: 25000 });
    if (new URL(page.url()).pathname === "/login") throw new Error("Authentication redirected to login; this is not a booking layer failure.");
    await page.getByRole("button", { name: "New Booking", exact: true }).first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid"), null, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    const opener = page.getByRole("button", { name: /^new booking$/i }).first();
    result.opener = await opener.evaluate(node => ({ label: node.getAttribute("aria-label") || node.textContent.trim(), inTopbar: !!node.closest(".topbar") }));
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Reserve a table", exact: true });
    const close = dialog.getByRole("button", { name: "Close booking form", exact: true });
    await close.waitFor();
    await page.waitForTimeout(200);
    result.measurements = await measure(close);
    await screenshot(page, result, "open-before-click");
    await close.evaluate(node => {
      window.__bookingCloseClick = { count: 0, trusted: false };
      node.addEventListener("click", event => { window.__bookingCloseClick.count++; window.__bookingCloseClick.trusted = event.isTrusted; }, { once: true });
    });
    const bounds = await close.boundingBox();
    try {
      await close.click({ position: { x: bounds.width / 2, y: bounds.height / 2 }, timeout: 3000 });
      result.click.completed = true;
    } catch (error) { result.click.error = error.message; }
    result.click.observed = await page.evaluate(() => window.__bookingCloseClick);
    result.click.dialogClosed = result.click.completed && await dialog.waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false);
    result.click.routeRetained = new URL(page.url()).pathname === "/bookings";
    result.checks = {
      centerHitBelongsToButton: result.measurements.centerHitBelongsToButton,
      modalLeftEdgeNotBehindSidebar: result.measurements.modalLeftEdgeOwned,
      actualUnforcedTrustedClick: result.click.completed && result.click.observed?.count === 1 && result.click.observed.trusted,
      dialogClosed: result.click.dialogClosed,
      routeRetained: result.click.routeRetained,
      noRuntimeErrors: result.pageErrors.length === 0,
      noReadErrors: result.networkErrors.length === 0,
    };
    result.status = result.networkErrors.length ? "setup-degraded-not-app-bug" : Object.values(result.checks).every(Boolean) ? "pass" : "layer-or-close-failure";
    await screenshot(page, result, result.click.dialogClosed ? "closed-after-click" : "still-open-after-click");
  } catch (error) {
    result.status = "setup-degraded-not-app-bug";
    result.setupError = error.message;
    await screenshot(page, result, "setup-degraded").catch(() => {});
  } finally {
    result.closing = true;
    await context.close();
    delete result.closing;
  }
}

await fs.mkdir(output, { recursive: true });
let browser;
try {
  const auth = await authenticate();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"],
  });
  for (const stage of stages) {
    await fs.mkdir(`${output}/${stage}`, { recursive: true });
    for (const theme of themes) for (const width of widths) {
      const result = { stage, theme, width, status: "pending", click: { completed: false, method: "Playwright center click; no force, JS click or DOM relocation" }, screenshots: [], networkErrors: [], pageErrors: [] };
      report.cases.push(result);
      await runCase(browser, result, auth);
      if (result.status !== "pass") {
        const entry = { stage, theme, width, status: result.status, failedChecks: Object.entries(result.checks || {}).filter(([, pass]) => !pass).map(([name]) => name), setupError: result.setupError };
        (stage === "before" && result.status !== "setup-degraded-not-app-bug" ? report.baselineObservations : report.failures).push(entry);
      }
      await fs.writeFile(reportFile, JSON.stringify({ ...report, inProgress: true }, null, 2));
      console.log(`${stage} ${theme} ${width}: ${result.status}; center=${result.measurements?.centerHitBelongsToButton}, closed=${result.click.dialogClosed}`);
    }
  }
} catch (error) { report.errors.push(error.message); }
finally {
  if (browser) await browser.close();
  for (const entry of report.coreRetryDisposition.entries.filter(row => row.disposition === "confirmed-booking-layer-bug")) {
    const verification = report.cases.find(row => row.stage === "after" && row.theme === entry.theme && row.width === entry.width);
    entry.focusedVerification = verification ? { report: "docs/ui-readiness/booking-close-layer/results.json", stage: verification.stage, theme: verification.theme, width: verification.width, status: verification.status, checks: verification.checks } : "not run";
  }
  report.finishedAt = new Date().toISOString();
  report.summary = { cases: report.cases.length, expectedCases: report.configuration.maxCases, afterPasses: report.cases.filter(row => row.stage === "after" && row.status === "pass").length, baselineObservations: report.baselineObservations.length, degradedCases: report.cases.filter(row => row.status === "setup-degraded-not-app-bug").length, failures: report.failures.length, errors: report.errors.length, forwardedBusinessWrites: report.safety.forwardedBusinessWrites };
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportFile, ...report.summary }, null, 2));
}
if (report.errors.length || report.failures.length || report.safety.blockedWrites.length || report.cases.length !== report.configuration.maxCases) process.exitCode = 1;
