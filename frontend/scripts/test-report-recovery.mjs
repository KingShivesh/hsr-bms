/* global process */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

// Run only against the parent's already-built previews. No server or build is started.
// Usage: node scripts/test-report-recovery.mjs [before|after|both]
const mode = process.argv[2] || "both";
assert.ok(["before", "after", "both"].includes(mode), "Use before, after, or both.");
assert.equal(process.argv.length <= 3, true, "Unexpected arguments; targets are fixed loopback ports.");
const api = "http://127.0.0.1:8006";
const origins = { before: "http://127.0.0.1:5180", after: "http://127.0.0.1:5181" };
const stages = mode === "both" ? ["before", "after"] : [mode];
const output = fileURLToPath(new URL("../../docs/ui-readiness/reports-recovery/", import.meta.url));
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const rootSelector = ".main-content.page-reports .route-page";
const domains = [
  { id: "summary", tab: "history", path: "/reports/summary", loading: "Loading report summary..." },
  { id: "bills", tab: "history", path: "/reports/history", loading: "Loading bills..." },
  { id: "table-utilization", tab: "tables", path: "/reports/table-utilization", loading: "Loading table performance..." },
  { id: "top-customers", tab: "customers", path: "/reports/top-customers", loading: "Loading regular customers..." },
  { id: "analytics", tab: "advanced", path: "/reports/advanced-analytics", loading: "Loading advanced analytics..." },
  { id: "session-edits", tab: "session-edits", path: "/reports/session-edits", loading: "Loading session edits" },
];
const report = {
  mode, api, origins, startedAt: new Date().toISOString(), domains,
  cases: [], pageErrors: [], failures: [], baselineObservations: [],
  safety: { authPosts: 0, forwardedBusinessMutations: 0, blockedRequests: [], blockedWebSockets: 0 },
};

function localUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", `Non-HTTP target rejected: ${url.origin}`);
  assert.equal(url.hostname, "127.0.0.1", `Non-loopback target rejected: ${url.origin}`);
  assert.ok([api, ...Object.values(origins)].includes(url.origin), `Unexpected local port: ${url.origin}`);
  assert.equal(url.username + url.password, "", "URL credentials are not allowed.");
  return url;
}
for (const url of [api, ...Object.values(origins)]) localUrl(url);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function check(result, name, passed, detail) {
  result.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
  if (!passed) {
    const entry = { stage: result.stage, theme: result.theme, case: result.id, check: name, detail };
    (result.stage === "before" ? report.baselineObservations : report.failures).push(entry);
  }
}

async function until(predicate, timeout = 12000) {
  const end = Date.now() + timeout;
  do {
    if (await predicate()) return true;
    await delay(75);
  } while (Date.now() < end);
  return false;
}

async function authenticate() {
  const url = localUrl(`${api}/auth/login`);
  assert.equal(url.origin, api);
  assert.equal(url.pathname, "/auth/login");
  // Authentication is the only real POST. All browser mutations are rejected below.
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.UI_QA_USERNAME || "admin", password: process.env.UI_QA_PASSWORD || "admin123" }),
  });
  report.safety.authPosts++;
  assert.ok(response.ok, `Local QA login failed (${response.status}).`);
  const auth = await response.json();
  assert.ok(auth.token && auth.role === "admin", "An admin QA login is required; permissions are not modified.");
  return auth;
}

async function openCase(browser, auth, stage, theme, tab) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce",
    timezoneId: "Asia/Kolkata", serviceWorkers: "block",
  });
  const state = { intercept: null };
  await context.addInitScript(({ auth, theme, tab }) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("reportsDefaultTab", tab);
    for (const key of ["token", "role", "username"]) {
      if (auth[key] != null) localStorage.setItem(key, auth[key]);
    }
  }, { auth, theme, tab });
  await context.route("**/*", async handler => {
    const request = handler.request();
    let url;
    try {
      url = localUrl(request.url());
      assert.ok(url.origin === api || url.origin === origins[stage], "Cross-preview request rejected.");
      assert.ok(readMethods.has(request.method()), "Browser writes are not allowed.");
    } catch (error) {
      report.safety.blockedRequests.push({ stage, theme, method: request.method(), url: request.url().split("?")[0], reason: error.message });
      return handler.abort("blockedbyclient");
    }
    if (url.origin === api && request.method() === "GET" && state.intercept) {
      if (await state.intercept(handler, url)) return;
    }
    return handler.continue();
  });
  await context.routeWebSocket("**/*", socket => {
    report.safety.blockedWebSockets++;
    socket.close({ code: 1008, reason: "Read-only QA does not open WebSocket connections" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => report.pageErrors.push({ stage, theme, tab, message: error.message }));
  return { context, page, state, root: page.locator(rootSelector) };
}

async function capture(page, result, state) {
  await page.evaluate(() => document.fonts.ready);
  const file = `${result.stage}/${result.theme}/${result.id}-${state}.png`;
  await fs.mkdir(`${output}/${result.stage}/${result.theme}`, { recursive: true });
  await page.screenshot({ path: `${output}/${file}`, animations: "disabled", fullPage: false });
  result.screenshots.push({ state, file });
}

function successResponse(page, path) {
  const pending = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === api && url.pathname === path && response.request().method() === "GET" && response.status() === 200;
  }, { timeout: 20000 });
  pending.catch(() => {});
  return pending;
}

async function settled(root) {
  await root.locator(".reports-tabs").waitFor();
  return until(async () => await root.locator(".page-skeleton:visible,.ui-skeleton-stack:visible,.ui-skeleton-grid:visible,.retry-notice:visible").count() === 0);
}

async function recoveryCase(session, result, domain) {
  const { page, root, state } = session;
  const gate = deferred();
  let requested = false;
  let forced500s = 0;
  state.intercept = async (handler, url) => {
    if (url.pathname !== domain.path) return false;
    requested = true;
    await gate.promise;
    forced500s++;
    await handler.fulfill({ status: 500, json: { detail: "QA simulated report failure; no data was changed" } });
    return true;
  };
  try {
    await page.goto(`${origins[result.stage]}/analytics`, { waitUntil: "domcontentloaded" });
    assert.ok(await until(async () => requested), `No request for ${domain.path}`);
    await root.locator(".reports-tabs").waitFor();
    check(result, "domain-loading-skeleton", await root.getByRole("status", { name: domain.loading, exact: true }).isVisible());
    if (domain.id === "summary") check(result, "no-fake-summary-zeros", await root.locator(".reports-summary-grid").count() === 0);
    if (domain.id === "bills") check(result, "no-false-empty-bills", await root.getByText("No transactions found", { exact: true }).count() === 0);
    await capture(page, result, "loading");
    gate.resolve();
    const notice = root.locator(".retry-notice[role='alert']").first();
    const localRetry = await notice.waitFor({ state: "visible", timeout: 9000 }).then(() => true, () => false);
    check(result, "forced-500-observed", forced500s > 0, { forced500s });
    check(result, "local-retry-notice", localRetry);
    await capture(page, result, "error");
    // Remove only the target override; the write/network safety guard remains installed.
    state.intercept = null;
    const actualSuccess = successResponse(page, domain.path);
    let navigations = 0;
    const onNavigation = frame => { if (frame === page.mainFrame()) navigations++; };
    page.on("framenavigated", onNavigation);
    if (localRetry) await notice.getByRole("button", { name: "Retry", exact: true }).click();
    else await page.reload({ waitUntil: "domcontentloaded" });
    const response = await actualSuccess;
    check(result, "real-api-recovery", response.status() === 200, { endpoint: domain.path, synthetic: false });
    check(result, "settled-after-recovery", await settled(root));
    check(result, "retry-without-reload", localRetry && navigations === 0);
    check(result, "reports-route-retained", page.url() === `${origins[result.stage]}/analytics`);
    page.off("framenavigated", onNavigation);
    result.recoveryMethod = localRetry ? "local Retry" : "baseline reload fallback (not Retry recovery)";
    await capture(page, result, "recovered");
  } finally { gate.resolve(); }
}

function billsFixture() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  return Array.from({ length: 1000 }, (_, index) => ({
    id: 9700001 + index, nm: `QA Report Bill ${String(index + 1).padStart(4, "0")}`,
    tbl: `T${index % 5 + 1}`, ts: now.getTime(), date: `${date}, 12:00:00`,
    dur: 60, ply: 320, famt: 120, tot: 440, billing_mode: "single", payment_method: "Cash",
  }));
}

async function billIds(root) {
  return root.locator(".history-section table tbody tr").evaluateAll(nodes => nodes.flatMap(node => {
    if (node.querySelectorAll("td").length !== 8) return [];
    const id = node.getAttribute("data-receipt-id");
    const fixtureIndex = node.querySelectorAll("td")[2]?.textContent.match(/^QA Report Bill (\d{4})$/)?.[1];
    return [id ? Number(id) : fixtureIndex ? 9700000 + Number(fixtureIndex) : null];
  }));
}

async function paginationCase({ page, root, state }, result) {
  const fixture = billsFixture();
  let rows = fixture;
  state.intercept = async (handler, url) => {
    if (url.pathname !== "/reports/history") return false;
    await handler.fulfill({ json: rows });
    return true;
  };
  await page.goto(`${origins[result.stage]}/analytics`, { waitUntil: "domcontentloaded" });
  await root.getByTestId("search-transactions").waitFor();
  assert.ok(await until(async () => (await billIds(root)).length > 0), "Bills fixture did not render.");
  const nav = root.getByRole("navigation", { name: "Bills pagination", exact: true });
  const hasPagination = await nav.count() > 0;
  const initialIds = await billIds(root);
  check(result, "initial-page-25-rows", initialIds.length === 25, { rows: initialIds.length });
  check(result, "receipt-id-attributes", await root.locator("tr[data-receipt-id]").count() === initialIds.length);
  check(result, "bills-pagination-present", hasPagination);
  check(result, "search-accessible-label", await root.getByRole("textbox", { name: "Search bills by customer or table", exact: true }).count() === 1);
  await capture(page, result, "page-1");
  if (!hasPagination) {
    check(result, "baseline-fixture-records", initialIds.length === 1000 && new Set(initialIds).size === 1000);
    result.pagination = { records: initialIds.length, pages: 1, unpaginated: true };
    return;
  }
  const next = nav.getByRole("button", { name: "Next page", exact: true });
  const seen = [];
  for (let pageNumber = 1; pageNumber <= 40; pageNumber++) {
    const expected = fixture.slice((pageNumber - 1) * 25, pageNumber * 25).map(row => row.id);
    assert.ok(await until(async () => JSON.stringify(await billIds(root)) === JSON.stringify(expected)), `Wrong receipts on page ${pageNumber}.`);
    seen.push(...await billIds(root));
    if (pageNumber < 40) { assert.equal(await next.isDisabled(), false); await next.click(); }
  }
  check(result, "all-1000-ids-no-missing-or-duplicates", seen.length === 1000 && new Set(seen).size === 1000 && fixture.every(row => seen.includes(row.id)));
  check(result, "page-40-next-disabled", await next.isDisabled());
  result.pagination = { records: seen.length, pages: 40, pageSize: 25, duplicates: seen.length - new Set(seen).size };
  await capture(page, result, "page-40");
  const search = root.getByTestId("search-transactions");
  await search.fill(fixture[0].nm);
  check(result, "search-from-page-40-finds-first-record", await until(async () => JSON.stringify(await billIds(root)) === JSON.stringify([fixture[0].id])));
  await search.fill("");
  check(result, "clear-search-resets-page-1", await until(async () => (await billIds(root))[0] === fixture[0].id && (await billIds(root)).length === 25));
  await next.click();
  await root.getByRole("button", { name: "All Time", exact: true }).click();
  check(result, "period-resets-page-1", await until(async () => (await billIds(root))[0] === fixture[0].id));
  await next.click();
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(fixture[0].ts));
  await root.getByLabel("Choose report date", { exact: true }).fill(dateKey);
  check(result, "date-resets-page-1", await until(async () => (await billIds(root))[0] === fixture[0].id));
  await next.click();
  rows = fixture.slice(0, 10);
  const refreshed = successResponse(page, "/reports/history");
  await root.getByRole("button", { name: "Refresh summary", exact: true }).click();
  await refreshed;
  check(result, "data-shrink-clamps-page", await until(async () => (await billIds(root)).length === 10 && (await billIds(root))[0] === fixture[0].id));
  check(result, "short-result-hides-pagination", await nav.count() === 0);
  await capture(page, result, "search-date-clamp");
}

async function stalePeriodCase({ page, root, state }, result) {
  const monthGate = deferred(), monthRequested = deferred();
  let monthSeen = false;
  const payload = (period, name) => ({ label: `QA ${period}`, customers: [{ name, visits: 2, play: 320, food: 120, spent: 440 }] });
  state.intercept = async (handler, url) => {
    if (url.pathname !== "/reports/top-customers") return false;
    const period = url.searchParams.get("period");
    if (period === "month") { monthSeen = true; monthRequested.resolve(); await monthGate.promise; }
    await handler.fulfill({ json: payload(period, period === "month" ? "QA obsolete month" : "QA latest week") });
    return true;
  };
  try {
    await page.goto(`${origins[result.stage]}/analytics`, { waitUntil: "domcontentloaded" });
    assert.ok(await until(async () => monthSeen), "Initial customer period was not requested.");
    await monthRequested.promise;
    await root.getByRole("button", { name: "This Week", exact: true }).click();
    await root.getByText("QA latest week", { exact: true }).waitFor();
    await capture(page, result, "newer-period");
    const oldResponse = successResponse(page, "/reports/top-customers");
    monthGate.resolve();
    await oldResponse;
    await delay(200);
    check(result, "obsolete-period-response-ignored", await root.getByText("QA latest week", { exact: true }).isVisible() && await root.getByText("QA obsolete month", { exact: true }).count() === 0);
    await capture(page, result, "obsolete-response-released");
    state.intercept = null;
    const realResponse = successResponse(page, "/reports/top-customers");
    await root.getByRole("button", { name: "All Time", exact: true }).click();
    await realResponse;
    check(result, "race-fixture-removed-real-api-success", await settled(root));
    await capture(page, result, "real-data-recovered");
  } finally { monthGate.resolve(); }
}

await fs.mkdir(output, { recursive: true });
let browser;
try {
  const auth = await authenticate();
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  });
  // Serial contexts limit load and prevent cached reports masking isolated failures.
  for (const stage of stages) for (const theme of ["dark", "light"]) {
    const cases = [
      ...domains.map(domain => ({ id: domain.id, tab: domain.tab, run: (session, result) => recoveryCase(session, result, domain) })),
      { id: "bills-pagination", tab: "history", run: paginationCase },
      { id: "top-customers-stale-period", tab: "customers", run: stalePeriodCase },
    ];
    for (const test of cases) {
      const result = { stage, theme, id: test.id, checks: [], screenshots: [] };
      report.cases.push(result);
      let session;
      try {
        session = await openCase(browser, auth, stage, theme, test.tab);
        await test.run(session, result);
      } catch (error) {
        check(result, "case-completed", false, error.message);
        if (session) await capture(session.page, result, "unexpected-failure").catch(() => {});
      } finally { if (session) await session.context.close(); }
      console.log(`${stage} ${theme} ${test.id}: ${result.checks.filter(item => item.passed).length}/${result.checks.length} checks`);
    }
  }
} catch (error) {
  report.failures.push({ check: "runner-completed", detail: error.message });
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.failures.push(...report.safety.blockedRequests.map(entry => ({ check: "read-only-loopback-guard", ...entry })));
  report.failures.push(...report.pageErrors.filter(entry => entry.stage === "after").map(entry => ({ check: "no-browser-runtime-errors", ...entry })));
  const filename = mode === "both" ? "results.json" : `results-${mode}.json`;
  await fs.writeFile(`${output}/${filename}`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, cases: report.cases.length, failures: report.failures, baselineObservations: report.baselineObservations.length, safety: report.safety, results: `${output}/${filename}` }, null, 2));
}
if (report.failures.length) process.exitCode = 1;
