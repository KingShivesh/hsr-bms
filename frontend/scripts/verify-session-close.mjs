import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.env.SESSION_QA_STAGE || "after";
const app = stage === "before" ? "http://127.0.0.1:5180" : "http://127.0.0.1:5181";
const api = "http://127.0.0.1:8006";
const directory = path.resolve(`../docs/session-close-controls/${stage}`);
const backend = path.resolve("../backend");
const python = process.env.PYTHON_BIN || path.resolve("../backend/venv/bin/python");
const env = { ...process.env, DATABASE_URL: "sqlite:////tmp/hsr-session-close-ui.db", APP_ENV: "development", SECRET_KEY: "qa-session-close-secret-with-at-least-32-characters" };
const seed = (...args) => execFileSync(python, ["seed_session_close_qa.py", ...args], { cwd: backend, env, stdio: "pipe" });
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, screenshots: [], checks: [], contrast: [], errors: [] };
async function capture(page, name, theme, width) {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  await page.waitForTimeout(150);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".app-toast:not(.app-toast-warning)").first().waitFor({ state: "hidden", timeout: 7000 });
  if (name === "checkout") await page.evaluate(() => { for (const node of document.querySelectorAll(".ui-overlay *")) if (node.scrollHeight > node.clientHeight) node.scrollTop = 0; });
  const metrics = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    font: getComputedStyle(document.body).fontFamily,
    accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(),
    dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON(),
    controls: [...document.querySelectorAll('[role="dialog"] button')].filter(node => node.getClientRects().length).map(node => ({ label: node.textContent.trim(), height: node.getBoundingClientRect().height })) }));
  assert.equal(metrics.overflow, 0, `${name} ${theme} ${width}`);
  if (metrics.dialog) assert.ok(metrics.dialog.height <= (width === 1440 ? 1000 : 844));
  const file = `${name}-${theme}-${width}.png`;
  await page.screenshot({ path: path.join(directory, file), animations: "disabled" });
  report.screenshots.push({ file, name, theme, width, ...metrics });
}
async function login(username, password) {
  const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200); return response.json();
}
try {
  for (const theme of ["light", "dark"]) {
    seed();
    const auth = await login("staff", "staff123");
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, timezoneId: "Asia/Kolkata" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(app + "/live-floor");
    await page.locator(".lf-table-card").first().waitFor();
    if (stage === "after") {
      await page.route(api + "/sessions/start", async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
      const requestPromise = page.waitForRequest(request => request.url() === api + "/sessions/start" && request.method() === "POST");
      await page.locator(".lf-table-card").nth(2).getByRole("button", { name: "Start Session", exact: true }).click();
      const request = await requestPromise;
      assert.deepEqual(request.postDataJSON(), { table_id: "t3" });
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.ok(await page.locator(".lf-table-card").nth(2).getByRole("button").last().isDisabled());
      await page.locator(".lf-table-card").nth(2).getByRole("button", { name: "End", exact: true }).waitFor();
      report.checks.push({ theme, name: "one-tap start", identityFieldsSent: 0, modalOpened: false, visiblePending: true });
    }
    for (const width of [1440, 375, 414]) await capture(page, "floor", theme, width);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Payment method", { exact: true }).waitFor();
    if (stage === "after") {
      await dialog.getByText("Adjust Time", { exact: true }).click();
      assert.ok(await dialog.getByRole("button", { name: "Apply Change", exact: true }).isDisabled());
      const started = await page.evaluate(() => {
        const ms = Date.now() - 90 * 60000, date = new Date(ms);
        return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0,19).replace(/:00$/, "");
      });
      await dialog.getByLabel("Started at", { exact: true }).fill(started);
      await dialog.getByLabel("Time adjustment reason", { exact: true }).selectOption("staff_forgot_to_start");
      await dialog.getByRole("button", { name: "Apply Change", exact: true }).click();
      await dialog.getByText("Duration adjusted", { exact: true }).waitFor();
      report.checks.push({ theme, name: "staff earlier start preview", reasonRequired: true, deltaVisible: true });
      await dialog.getByRole("button", { name: "Add phone for receipt", exact: true }).click();
      await dialog.getByLabel("Name (optional)").fill("QA Receipt Walk-in");
      await dialog.getByLabel("Phone (10 digits)").fill("9876500002");
      await page.waitForTimeout(300);
      report.contrast.push(...await scanRenderedContrast(page, { route: "/live-floor", theme, state: "staff-time-and-customer-checkout" }));
    }
    for (const width of [1440, 375, 414]) await capture(page, "checkout", theme, width);
    if (stage === "before") {
      await page.keyboard.press("Escape");
      await page.locator(".lf-table-card").nth(2).getByRole("button", { name: "Start Session", exact: true }).click();
      for (const width of [1440, 375, 414]) await capture(page, "start", theme, width);
    } else {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await dialog.getByRole("button", { name: /^Close table/ }).click();
      await dialog.getByRole("heading", { name: "Payment Complete" }).waitFor();
      const receipts = await fetch(api + "/reports/history", { headers: { Authorization: `Bearer ${(await login("admin", "admin123")).token}` } }).then(response => response.json());
      assert.ok(receipts.some(row => row.time_edit?.staff === "staff" && row.nm === "QA Receipt Walk-in"));
      report.checks.push({ theme, name: "staff edit closes atomically", receiptSaved: true });
      await capture(page, "receipt", theme, 1440);
      await dialog.getByRole("button", { name: "Close Receipt" }).click();
      seed("--alerts");
      await page.reload();
      await page.locator(".lf-table-card").first().waitFor();
      await page.getByText(/T2 — 180 min played/).waitFor();
      await page.waitForTimeout(11000);
      assert.ok(await page.getByText(/T2 — 180 min played/).isVisible(), "Overtime toast must persist");
      report.contrast.push(...(await scanRenderedContrast(page, { route: "/live-floor", theme, state: "persistent-session-toast" })).filter(row => row.selector.includes("app-toast")));
      await page.getByRole("button", { name: "Open notifications" }).click();
      await page.getByRole("button", { name: /T2 · 180m played/ }).click();
      await page.waitForTimeout(300);
      assert.equal(await page.getByText(/T2 — 180 min played/).count(), 0);
      report.checks.push({ theme, name: "urgent reminder", persistent: true, acknowledged: true });
      for (const width of [1440, 375, 414]) await capture(page, "alerts", theme, width);
    }
    await context.close();
  }
  if (stage === "after") {
    const auth = await login("admin", "admin123");
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      const page = await context.newPage();
      await page.goto(app + "/analytics");
      await page.getByRole("button", { name: "Session Edits", exact: true }).click();
      await page.getByRole("cell", { name: "staff", exact: true }).first().waitFor();
      for (const width of [1440, 375, 414]) await capture(page, "session-edits", theme, width);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(report, null, 2));
}
assert.equal(report.errors.length, 0, report.errors.join("\n"));
assert.equal(report.contrast.length, 0, JSON.stringify(report.contrast));
console.log(JSON.stringify({ stage, screenshots: report.screenshots.length, checks: report.checks, contrastViolations: report.contrast.length, errors: report.errors }));
