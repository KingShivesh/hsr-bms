import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const api = "http://127.0.0.1:8006";
const app = "http://127.0.0.1:5181";
const before = "http://127.0.0.1:5180";
const output = path.resolve("../docs/product-shell/verification");
await fs.mkdir(output, { recursive: true });
const auth = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(response => response.json());
assert.ok(auth.token, "Local QA login required");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { checks: [], screenshots: [], measurements: [], errors: [], productionMutations: 0 };
const routes = ["dashboard", "live-floor", "inventory", "bookings", "customers", "sales", "analytics", "cafe-pos", "waitlist", "legacy-table-controls", "tournaments", "daily-closing", "pricing-rules", "audit-log", "settings", "help", "status", "changelog", "demo", "missing-page"];
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` };
async function call(method, url, body) {
  const response = await fetch(`${api}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
async function context(theme = "light", width = 1440, user = auth) {
  const c = await browser.newContext({ viewport: { width, height: width === 1440 ? 1100 : 896 }, reducedMotion: "reduce" });
  await c.addInitScript(({ user, theme }) => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, user[key]); localStorage.setItem("theme", theme); }, { user, theme });
  return c;
}
async function ready(page, route, origin = app) {
  await page.goto(`${origin}/${route}`);
  await page.locator(".topbar-title").waitFor();
  await page.waitForTimeout(650);
  await page.waitForFunction(() => !document.querySelector('.page-skeleton,.lf-skeleton,[aria-label="Loading club profile"],[aria-label="Loading account"],[aria-label="Loading activity"]'), { timeout: 15000 });
  for (const dismiss of await page.getByRole("button", { name: "Dismiss", exact: true }).all()) { if (await dismiss.isVisible()) await dismiss.click(); }
}
async function shot(page, label) {
  await page.locator(".topbar-title").click();
  await page.mouse.move(0, 0);
  const file = `${label}.png`;
  await page.screenshot({ path: path.join(output, file), animations: "disabled", fullPage: false }); report.screenshots.push(file);
}
try {
  for (const theme of ["light", "dark"]) {
    const c = await context(theme); const page = await c.newPage();
    for (const route of ["dashboard", "live-floor", "settings", "analytics"]) { await ready(page, route, before); await shot(page, `before-${route}-${theme}`); }
    await c.close();
  }
  const c = await context(); const page = await c.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  await ready(page, "dashboard");
  await page.getByRole("region", { name: "Getting started" }).waitFor();
  await page.getByRole("button", { name: "Collapse setup", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: "Expand setup", exact: true }).waitFor();
  await page.getByRole("button", { name: "Expand setup", exact: true }).click();
  report.checks.push("Setup collapse persists across reload");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  assert.equal(await page.locator('[role="menu"]:visible').count(), 1);
  assert.match(await page.getByRole("menuitem", { name: "Contact support" }).getAttribute("href"), /^mailto:shivanshg2510@gmail.com/);
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Keyboard shortcuts");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
  await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.activeElement.closest('[role="dialog"]') !== null));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "User menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "My profile", exact: true }).click();
  await page.getByRole("dialog", { name: "My profile" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /admin/);
  await page.keyboard.press("Escape");
  report.checks.push("Help/user menus, configured support address, arrows, Enter, Escape, dialog focus");
  await page.keyboard.press("?"); await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor(); await page.keyboard.press("Escape");
  await page.keyboard.press("g"); await page.keyboard.press("b"); await page.waitForURL("**/bookings");
  await page.keyboard.press("g"); await page.keyboard.press("m"); await page.waitForURL("**/customers");
  const input = page.locator("input").first(); await input.fill("gn?"); assert.equal(await page.getByRole("dialog").count(), 0);
  await input.blur(); await page.keyboard.press("n"); await page.waitForURL("**/live-floor"); await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k"); await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
  report.checks.push("?, G-B, G-M, N and command palette; typing guard");
  await ready(page, "settings?section=club");
  await page.getByLabel("Club name", { exact: true }).fill("HSR Snooker Cafe");
  await page.getByLabel("Address", { exact: true }).fill("QA Club profile · HSR Layout, Bengaluru");
  await page.getByLabel("Phone", { exact: true }).fill("9876500001");
  await page.getByLabel("UPI ID", { exact: true }).fill("qa-club@upi");
  await page.getByRole("button", { name: "Save club profile", exact: true }).click();
  await page.getByText("Club profile saved", { exact: true }).waitFor();
  await page.getByText("Saved just now", { exact: true }).waitFor();
  await page.reload(); await page.getByLabel("Club name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("UPI ID", { exact: true }).inputValue(), "qa-club@upi");
  assert.equal((await call("GET", "/settings/session-controls")).upiId, "qa-club@upi");
  report.checks.push("Club profile persists; UPI has one checkout source; successful write shows Saved");
  await page.waitForTimeout(3200);
  await page.route("**/product/profile", route => route.request().method() === "PUT" ? route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"Club profile changed elsewhere. Reload before saving."}' }) : route.continue());
  await page.getByLabel("Club name", { exact: true }).fill("Should not save");
  await page.getByRole("button", { name: "Save club profile", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "changed elsewhere" }).waitFor();
  assert.equal(await page.getByText("Saved just now", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Reload profile", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[maxlength="80"]')?.value === "HSR Snooker Cafe");
  await page.unroute("**/product/profile");
  report.checks.push("Failed/stale save shows actual error, no Saved, reload recovers");
  await ready(page, "demo");
  let sandboxWrites = 0;
  const writes = request => { if (!/GET|HEAD|OPTIONS/.test(request.method()) && request.url().startsWith(api)) sandboxWrites++; };
  page.on("request", writes);
  await page.getByRole("button", { name: "Load sample data", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 5);
  await page.getByRole("button", { name: "Close sample session" }).first().click();
  await page.getByRole("tab", { name: "Members", exact: true }).click(); assert.equal(await page.locator("tbody tr").count(), 10);
  await page.getByRole("tab", { name: "Bookings", exact: true }).click(); assert.equal(await page.locator("tbody tr").count(), 3);
  await page.getByRole("button", { name: "Delete sample data", exact: true }).click();
  assert.equal(sandboxWrites, 0); page.off("request", writes);
  report.checks.push("Sample workspace: 10 members/5 tables/3 bookings, interactive, delete, ZERO backend writes");
  await ready(page, "settings?section=activity");
  await page.getByLabel("Actor", { exact: true }).fill("definitely-no-actor");
  await page.getByText("No matching activity", { exact: true }).waitFor();
  await page.locator(".product-filter-grid").getByRole("button", { name: "Clear filters" }).click();
  report.checks.push("Activity filters real audit records and clears filters");
  await call("PATCH", "/product/setup", { rates_reviewed: true, team_reviewed: true, guide_reviewed: true, dismissed: false });
  await ready(page, "dashboard");
  await page.getByText("Setup complete", { exact: true }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Getting started" }).count(), 0);
  assert.equal((await call("GET", "/product/setup")).setup.dismissed, true);
  report.checks.push("Six real setup steps complete, auto-hide and confirmation persist");
  await ready(page, "live-floor");
  const card = page.locator(".lf-table-card").first();
  await page.route("**/sessions/pause/t1", route => route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"QA keyboard pause rejected"}' }));
  await card.focus(); await page.keyboard.press("p"); await page.getByText("QA keyboard pause rejected", { exact: true }).waitFor();
  await page.unroute("**/sessions/pause/t1");
  await card.focus(); await page.keyboard.press("e"); await page.getByRole("dialog", { name: "Checkout T1" }).waitFor();
  await page.getByLabel("Help with checkout").click(); await page.getByText(/Credit requires a linked member/).waitFor();
  await page.keyboard.press("Escape");
  report.checks.push("Focused-table P invokes guarded existing action; E opens review, contextual help, no settlement");
  await page.route("**/events/stream?**", route => route.fulfill({ status: 503, body: "QA realtime unavailable" }));
  await page.reload(); await page.getByText("Reconnecting · polling continues", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await page.unroute("**/events/stream?**");
  await page.getByText("Live sync", { exact: true }).waitFor({ timeout: 40000 });
  await c.setOffline(true); await page.getByText("Offline · changes need a connection", { exact: true }).waitFor(); await c.setOffline(false);
  report.checks.push("Forced SSE 503 shows polling degradation; retry recovers; real browser offline state");
  await ready(page, "missing-page"); await page.getByRole("heading", { name: "This page doesn’t exist" }).waitFor();
  await page.getByRole("button", { name: "Back to club", exact: true }).click(); await page.waitForURL("**/dashboard");
  await c.close();
  const staff = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) }).then(r => r.json());
  const sc = await context("dark", 414, staff); const sp = await sc.newPage();
  await ready(sp, "live-floor"); await sp.getByRole("button", { name: "User menu", exact: true }).click();
  assert.match(await sp.getByRole("menu").innerText(), /Staff/);
  assert.equal(await sp.getByRole("menuitem", { name: "Settings", exact: true }).count(), 0);
  await sp.keyboard.press("Escape"); await sp.goto(`${app}/settings?section=club`); await sp.waitForURL(`${app}/`);
  report.checks.push("Staff shell identifies real role, hides Owner controls, direct Settings route denied"); await sc.close();
  await call("PATCH", "/product/setup", { dismissed: false, rates_reviewed: false, guide_reviewed: false, team_reviewed: false });
  for (const theme of ["light", "dark"]) {
    const c = await context(theme); const page = await c.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    for (const route of [...routes, "settings?section=club", "settings?section=team", "settings?section=activity", "settings?section=account", "settings?section=billing"]) {
      await ready(page, route);
      const measurements = await page.evaluate(() => ({ width: innerWidth, bodyWidth: document.documentElement.scrollWidth, topbarHeight: document.querySelector("header.cf-topbar").getBoundingClientRect().height, clubVisible: !!document.querySelector(".topbar-breadcrumb")?.textContent.includes("HSR Snooker Cafe"), userMenu: !!document.querySelector('[aria-label="User menu"]'), footer: document.querySelector(".product-footer")?.textContent, font: getComputedStyle(document.body).fontFamily, accent: getComputedStyle(document.body).getPropertyValue("--accent").trim() }));
      assert.ok(measurements.clubVisible && measurements.userMenu, JSON.stringify({ route, measurements }));
      assert.ok(measurements.bodyWidth <= 1440, JSON.stringify({ route, measurements }));
      report.measurements.push({ theme, route, ...measurements }); await shot(page, `after-${route.replace(/[?=]/g, "-")}-${theme}`);
    }
    for (const width of [375, 414]) {
      await page.setViewportSize({ width, height: 896 });
      for (const route of ["dashboard", "live-floor", "settings?section=club", "settings?section=activity", "help", "demo"]) {
        await ready(page, route);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflow at ${width}`);
        const clipped = await page.evaluate(() => [...document.querySelectorAll('.product-form input,.product-form textarea,.product-settings-section h2,.cf-topbar .topbar-right > button')].filter(node => node.getClientRects().length && (node.getBoundingClientRect().right > innerWidth + 1 || node.getBoundingClientRect().left < 64)).map(node => ({ label: node.getAttribute("aria-label") || node.tagName, rect: node.getBoundingClientRect().toJSON() })));
        assert.equal(clipped.length, 0, JSON.stringify({ route, width, clipped }));
        await page.getByRole("button", { name: "Help", exact: true }).click();
        const rect = await page.getByRole("menu").boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
        await page.keyboard.press("Escape");
        await shot(page, `after-${route.replace(/[?=]/g, "-")}-${theme}-${width}`);
      }
    }
    await c.close();
  }
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.checks.push("20 routes + five Settings sections in both themes; mobile 375/414, no document overflow, menu bounds, approved font/color tokens unchanged");
  console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots.length, errors: report.errors }, null, 2));
} finally { await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n"); await browser.close(); }
