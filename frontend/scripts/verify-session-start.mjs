import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const app = process.env.SESSION_APP_URL || "http://127.0.0.1:5177";
const api = process.env.SESSION_API_URL || "http://127.0.0.1:8003";
for (const url of [app, api]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Disposable local QA only");
}
const stage = process.env.SESSION_STAGE || "before";
const dir = path.resolve(`../docs/session-start-audit/${stage}`);
await fs.mkdir(dir, { recursive: true });
const login = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(login.status, 200);
const auth = await login.json();
async function request(method, route, body) {
  const response = await fetch(api + route, { method, headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.ok, true, `${route}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
if (stage !== "before") {
  await request("POST", "/members/CUSSESSIONQA/restore", { name: "QA Session Vikram Singh", phone: "+91 98765 43210", visits: 7 });
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => {
      localStorage.setItem("theme", theme);
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { auth, theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${app}/live-floor?action=start&table=t1`);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").locator("select").first().locator("option").first().waitFor({ state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/start-${theme}.png` });
    const start = page.getByRole("dialog").getByRole("button", { name: "Start Session", exact: true });
    const startEnabled = await start.isEnabled();
    assert.equal(startEnabled, true, "Blank guest start must be enabled");
    results.push({ theme, stage, startEnabled });
    for (const width of [375, 414]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: `${dir}/start-${theme}-${width}.png` });
      results.push({ theme, width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    }
    if (stage !== "before") {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.route("**/sessions/start", async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
      await start.evaluate(button => button.addEventListener("click", () => {
        const clicked = performance.now();
        const observer = new MutationObserver(() => {
          if (button.textContent.includes("Starting...")) { window.sessionFeedbackMs = performance.now() - clicked; observer.disconnect(); }
        });
        observer.observe(button, { childList: true, subtree: true, characterData: true });
      }, { capture: true, once: true }));
      await start.click();
      await page.getByRole("dialog").getByRole("button", { name: "Starting..." }).waitFor({ timeout: 200 });
      const feedbackMs = await page.evaluate(() => window.sessionFeedbackMs);
      assert.equal(typeof feedbackMs, "number");
      assert.equal(feedbackMs <= 200, true);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const active = await request("GET", "/sessions/active");
      assert.equal(active.find(session => session.table_id === "t1").customer_name, null);
      await page.locator('[data-table-state="running"]').first().waitFor();
      assert.equal(await page.getByText("Guest", { exact: true }).count() > 0, true);
      await page.screenshot({ path: `${dir}/anonymous-floor-${theme}.png` });
      await page.goto(`${app}/live-floor?action=checkout&table=t1`);
      await page.getByRole("dialog").getByText(/T1.*Guest/).waitFor();
      await page.screenshot({ path: `${dir}/anonymous-checkout-${theme}.png` });
      await request("POST", "/sessions/stop/t1");
      await page.goto(`${app}/live-floor?action=start&table=t2`);
      await page.getByRole("dialog").getByRole("tab", { name: "Member", exact: true }).click();
      const memberStart = page.getByRole("dialog").getByRole("button", { name: "Start Session", exact: true });
      assert.equal(await memberStart.isEnabled(), false);
      await page.getByLabel("Search by phone or name").fill("987654");
      await page.getByRole("button", { name: /QA Session Vikram Singh/ }).click();
      assert.equal(await memberStart.isEnabled(), true);
      await page.screenshot({ path: `${dir}/member-${theme}.png` });
      for (const width of [375, 414]) {
        await page.setViewportSize({ width, height: 844 });
        await page.screenshot({ path: `${dir}/member-${theme}-${width}.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false);
        results.push({ theme, tab: "member", width, overflow });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await memberStart.click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await request("GET", "/sessions/active")).find(session => session.table_id === "t2").member_id, "CUSSESSIONQA");
      await page.screenshot({ path: `${dir}/member-floor-${theme}.png` });
      await request("POST", "/sessions/stop/t2");
      const booking = await request("POST", "/bookings", { customer_name: "QA Session Booked Guest", table_id: "T3", booking_time: new Date().toISOString() });
      await page.goto(`${app}/live-floor?action=start&table=t3`);
      await page.getByRole("dialog").getByRole("tab", { name: "From Booking" }).click();
      const bookingStart = page.getByRole("dialog").getByRole("button", { name: "Start Session", exact: true });
      assert.equal(await bookingStart.isEnabled(), false);
      await page.getByRole("button", { name: /QA Session Booked Guest/ }).click();
      await page.screenshot({ path: `${dir}/booking-${theme}.png` });
      for (const width of [375, 414]) {
        await page.setViewportSize({ width, height: 844 });
        await page.screenshot({ path: `${dir}/booking-${theme}-${width}.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false);
        results.push({ theme, tab: "booking", width, overflow });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await bookingStart.click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await request("GET", "/sessions/active")).find(session => session.table_id === "t3").booking_id, booking.id);
      await page.screenshot({ path: `${dir}/booking-floor-${theme}.png` });
      await request("POST", "/sessions/stop/t3");
      await page.goto(`${app}/legacy-table-controls`);
      await page.locator(".advanced-table-controls-page .live-floor-primary").click();
      await page.getByRole("dialog").getByRole("tab", { name: "Guest", exact: true }).waitFor();
      await page.screenshot({ path: `${dir}/advanced-start-${theme}.png` });
      await page.getByRole("tab", { name: "Guest", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "Member", exact: true }).getAttribute("aria-selected"), "true");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(errors.length, 0);
      results.push({ theme, anonymousNull: true, memberLinked: true, bookingLinked: true, feedbackMs, keyboardTabsAndEscape: true, advancedUsesSharedModal: true, errors });
    }
    await context.close();
  }
} finally { await browser.close(); }
if (stage !== "before") {
  await request("DELETE", "/members/CUSSESSIONQA");
  assert.equal((await request("GET", "/sessions/active")).length, 0);
}
await fs.writeFile(`${dir}/browser.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (stage !== "before") {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
    const shots = [];
    for (const theme of ["light", "dark"]) for (const version of ["before", "after"]) {
      const bytes = await fs.readFile(path.resolve(`../docs/session-start-audit/${version}/start-${theme}.png`));
      shots.push(`<section><h2>${version.toUpperCase()} / ${theme.toUpperCase()}</h2><img src="data:image/png;base64,${bytes.toString("base64")}" /></section>`);
    }
    await page.setContent(`<style>body{margin:0;background:#eee;font:14px Arial}main{display:grid;grid-template-columns:1fr 1fr;gap:8px}h2{margin:0;padding:6px;font-size:16px}img{display:block;width:100%}</style><main>${shots.join("")}</main>`);
    await page.screenshot({ path: path.resolve("../docs/session-start-audit/comparison.png"), fullPage: true });
  } finally { await browser.close(); }
}
