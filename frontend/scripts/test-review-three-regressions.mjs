/* global process */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { formatDateTime } from "../src/utils/format.js";

const app = "http://127.0.0.1:5181";
const api = "http://127.0.0.1:8006";
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const output = fileURLToPath(new URL("../../docs/ui-readiness/review-regressions/", import.meta.url));
const result = {
  app, api, startedAt: new Date().toISOString(),
  scope: "Focused three-finding regression only; both themes at 375/1440; toast lifecycle at 1440 only",
  checks: [], cases: [], pageErrors: [], blockedWrites: [], forwardedBusinessWrites: 0,
  fixtures: { history: "Two stubbed bills, same date/time in 2024 and 2025", optional: "Held then fulfilled with empty arrays", export: "Stubbed CSV read" },
};
const dates = ["2024-01-09T06:30:00Z", "2025-01-09T06:30:00Z"];
const bills = dates.map((date, index) => ({
  id: 990001 + index, ts: Date.parse(date), date: `09/01/${2024 + index}, 12:00:00`,
  nm: `QA Year ${2024 + index}`, tbl: "T1", dur: 60, ply: 320, famt: 0,
  tot: 320, billing_mode: "single", payment_method: "Cash",
}));

const historical = dates.map(date => formatDateTime(date, { includeYear: true }));
assert.match(historical[0], /2024/);
assert.match(historical[1], /2025/);
assert.notEqual(...historical);
assert.equal(formatDateTime(dates[0]), formatDateTime(dates[1]));
result.checks.push({ name: "source-helper-year-option", historical, passed: true });

// Authentication is the only real POST; browser business mutations are blocked.
const authResponse = await fetch(`${api}/auth/login`, {
  method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: process.env.UI_QA_USERNAME || "admin", password: process.env.UI_QA_PASSWORD || "admin123" }),
});
assert.ok(authResponse.ok, `QA authentication failed (${authResponse.status})`);
const auth = await authResponse.json();
assert.ok(auth.token && auth.role === "admin");

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
await fs.mkdir(output, { recursive: true });
async function runCase(theme, width) {
const current = { theme, width, checks: [], screenshots: [], passed: false };
result.cases.push(current);
const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, timezoneId: "Asia/Kolkata", acceptDownloads: true, serviceWorkers: "block" });
let releaseOptional;
const optionalGate = new Promise(resolve => { releaseOptional = resolve; });
const held = new Set();
let optionalReleased = false;
try {
  await context.addInitScript(({ auth, theme }) => {
    for (const key of ["token", "role", "username"]) if (auth[key] != null) localStorage.setItem(key, auth[key]);
    localStorage.setItem("theme", theme);
    localStorage.setItem("tablesViewMode", "detailed");
  }, { auth, theme });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!readMethods.has(request.method())) {
      result.blockedWrites.push({ theme, width, method: request.method(), path: url.pathname });
      return route.fulfill({ status: 409, json: { detail: "Read-only regression blocked this write" } });
    }
    if (![app, api].includes(url.origin)) return route.abort("blockedbyclient");
    if (url.origin === api) {
      if (url.pathname === "/events/stream") return route.abort("blockedbyclient");
      if (["/waitlist", "/bookings"].includes(url.pathname) && !optionalReleased) {
        held.add(url.pathname);
        await optionalGate;
        return route.fulfill({ json: [] });
      }
      if (url.pathname === "/reports/history") return route.fulfill({ json: bills });
      if (url.pathname === "/reports/export") return route.fulfill({ contentType: "text/csv", body: "Date,Total\n09/01/2024,320\n" });
    }
    return route.continue();
  });
  await context.routeWebSocket("**/*", socket => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => result.pageErrors.push({ theme, width, message: error.message }));
  async function capture(state) {
    await page.evaluate(() => document.fonts.ready);
    const file = `${theme}-${width}-${state}.png`;
    await page.screenshot({ path: `${output}/${file}`, fullPage: true, animations: "disabled" });
    current.screenshots.push({ state, file });
  }

  await page.goto(`${app}/legacy-table-controls`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator(".advanced-table-controls-page").waitFor({ state: "visible" });
  await page.getByRole("status", { name: "Loading walk-in queue", exact: true }).waitFor();
  await page.getByRole("status", { name: "Loading table bookings", exact: true }).waitFor();
  assert.equal(held.size, 2);
  await page.waitForTimeout(1800);
  assert.equal(optionalReleased, false);
  assert.ok(await page.locator(".advanced-table-controls-page").isVisible());
  assert.equal(await page.getByRole("status", { name: "Loading table controls", exact: true }).count(), 0);
  const actions = page.locator(".advanced-table-controls-page .table-state-primary");
  assert.ok(await actions.count() >= 5, "Five table primary actions must remain rendered");
  current.checks.push({ name: "held-queue-and-bookings-do-not-hide-floor", held: [...held], tableActions: await actions.count(), heldVisibleForMs: 1800, passed: true });
  await capture("held-floor");
  optionalReleased = true;
  releaseOptional();
  await page.getByRole("status", { name: "Loading walk-in queue", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("status", { name: "Loading table bookings", exact: true }).waitFor({ state: "hidden" });
  current.checks.push({ name: "optional-panels-settle-after-release", passed: true });

  await page.goto(`${app}/analytics`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("search-transactions").waitFor();
  await page.getByRole("button", { name: "All Time", exact: true }).click();
  const reportDates = [];
  for (const bill of bills) {
    const row = page.locator(`tr[data-receipt-id="${bill.id}"]`);
    await row.waitFor();
    reportDates.push(await row.locator("td").first().innerText());
  }
  assert.match(reportDates[0], /2024/);
  assert.match(reportDates[1], /2025/);
  assert.notEqual(...reportDates);
  current.checks.push({ name: "built-reports-distinguishes-years", dates: reportDates, passed: true });
  await capture("report-year-rows");

  if (width === 1440) {
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const toast = page.locator(".app-toast-success").filter({ hasText: "CSV export downloaded" });
  await toast.waitFor();
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log out?", exact: true });
  await dialog.waitFor();
  await dialog.locator(".app-toast-success").waitFor();
  await page.mouse.move(0, 0);
  await toast.getByRole("button", { name: "Dismiss notification", exact: true }).focus();
  await page.waitForTimeout(4300);
  assert.ok(await toast.isVisible(), "Focused timed toast must stay paused before its dialog closes");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await toast.waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(new URL(page.url()).pathname, "/analytics");
  current.checks.push({ name: "focused-toast-resumes-after-dialog-host-removal", pausedForMs: 4300, passed: true });
  }

  await page.goto(`${app}/sales`, { waitUntil: "domcontentloaded" });
  const salesDates = [];
  for (const bill of bills) {
    const row = page.locator(`tr[data-receipt-id="${bill.id}"]`);
    await row.waitFor();
    salesDates.push(await row.locator("td").first().innerText());
  }
  assert.match(salesDates[0], /2024/);
  assert.match(salesDates[1], /2025/);
  assert.notEqual(...salesDates);
  current.checks.push({ name: "built-sales-distinguishes-years", dates: salesDates, passed: true });
  await capture("sales-year-rows");
  assert.deepEqual(result.pageErrors.filter(item => item.theme === theme && item.width === width), []);
  assert.deepEqual(result.blockedWrites.filter(item => item.theme === theme && item.width === width), []);
  current.passed = true;
} catch (error) {
  current.error = error.stack || error.message;
} finally {
  optionalReleased = true;
  releaseOptional();
  await context.close();
  console.log(JSON.stringify({ theme, width, passed: current.passed, checks: current.checks.length, screenshots: current.screenshots.length, error: current.error }));
}
}

try {
  for (const theme of ["light", "dark"]) {
    for (const width of [375, 1440]) await runCase(theme, width);
  }
} finally {
  await browser.close();
  result.completedAt = new Date().toISOString();
  result.passed = result.cases.length === 4 && result.cases.every(item => item.passed) && result.pageErrors.length === 0 && result.blockedWrites.length === 0;
  await fs.writeFile(`${output}/results.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, screenshots: result.cases.reduce((sum, item) => sum + item.screenshots.length, 0), results: `${output}/results.json` }));
}
assert.ok(result.passed, "Focused regression failed; inspect saved results.json");
