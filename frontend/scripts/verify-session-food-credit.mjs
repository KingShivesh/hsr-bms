import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const api = "http://127.0.0.1:8006";
const directory = path.resolve(process.env.SESSION_FOOD_REPORT_PATH || "../docs/session-food-credit/verification");
await fs.mkdir(directory, { recursive: true });
const env = { ...process.env, DATABASE_URL: "sqlite:////tmp/hsr-session-close-ui.db", APP_ENV: "development", SECRET_KEY: "qa-session-close-secret-with-at-least-32-characters" };
const seed = (...args) => execFileSync(process.env.PYTHON_BIN || "/tmp/hsr-controls-fresh-venv/bin/python", ["seed_session_close_qa.py", ...args], { cwd: path.resolve("../backend"), env, stdio: "pipe" });
async function login(role = "staff") {
  const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "staff" ? "staff123" : "admin123" }) });
  assert.equal(response.status, 200); return response.json();
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { checks: [], screenshots: [], contrast: [], errors: [], productionMutations: 0 };
async function capture(page, theme, name, width) {
  await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
  await page.evaluate(() => document.fonts.ready);
  const row = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), font: getComputedStyle(document.body).fontFamily, accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(), controls: [...document.querySelectorAll('[role="dialog"] button')].filter(n => n.getClientRects().length).map(n => ({ label: n.textContent.trim(), height: n.getBoundingClientRect().height })) }));
  assert.equal(row.overflow, 0);
  if (width < 500) assert.ok(row.controls.every(r => r.height >= 44), JSON.stringify(row.controls));
  const file = `${name}-${theme}-${width}.png`;
  await page.screenshot({ path: path.join(directory, file), animations: "disabled", fullPage: name === "floor-orders" });
  report.screenshots.push({ file, theme, name, width, ...row });
}
try {
  for (const theme of ["light", "dark"]) {
    seed("--food");
    const authA = await login(), authB = await login();
    const contexts = [], pages = [];
    for (const [index, auth] of [authA, authB].entries()) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: theme, timezoneId: "Asia/Kolkata" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      await context.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.__qaStreamConnections = 0;
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (!String(args[0]).includes("/events/stream") || !response.ok) return response;
          window.__qaStreamConnections += 1;
          const reader = response.body.getReader();
          let controller, dropped = false;
          const body = new ReadableStream({
            start(value) {
              controller = value;
              (async () => {
                try { while (!dropped) { const next = await reader.read(); if (dropped) break; if (next.done) { controller.close(); break; } controller.enqueue(next.value); } }
                catch (error) { if (!dropped) controller.error(error); }
              })();
            },
            cancel() { dropped = true; return reader.cancel(); },
          });
          window.__qaDropStream = () => { dropped = true; controller.error(new TypeError("QA connection reset")); return reader.cancel(); };
          return new Response(body, { status: response.status, headers: response.headers });
        };
      });
      const page = await context.newPage();
      page.on("pageerror", err => report.errors.push(err.message));
      await page.goto(`http://127.0.0.1:${index ? 5180 : 5181}/live-floor`);
      await page.locator(".lf-table-card").first().waitFor();
      contexts.push(context); pages.push(page);
    }
    const [a, b] = pages;
    const card = page => page.locator(".lf-table-card").first();
    const summary = page => card(page).getByRole("button", { name: "Canteen orders for T1", exact: true });
    async function request(method, endpoint, body) {
      const response = await fetch(api + endpoint, { method, headers: { Authorization: `Bearer ${authA.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 200, await response.clone().text()); return response.json();
    }
    async function measure(name, action, expected) {
      console.log(`${theme}: ${name}`);
      let dispatchedAt;
      const listener = request => { if (["POST", "PATCH", "DELETE"].includes(request.method()) && request.url().includes("/food")) dispatchedAt ??= performance.now(); };
      a.on("request", listener);
      const start = performance.now(); await action();
      await b.waitForFunction(({ expected }) => document.querySelector('.lf-table-card .session-canteen-summary')?.textContent.includes(expected), { expected }, { timeout: 2200 });
      a.off("request", listener);
      assert.ok(dispatchedAt);
      const ms = Math.round(performance.now() - dispatchedAt); assert.ok(ms < 2000, `${name}: ${ms}`);
      report.checks.push({ theme, name, propagationMs: ms, actionIncludingInputAndScrollMs: Math.round(performance.now() - start) });
    }
    await summary(a).getByText(/2× QA Cold Drink/).waitFor();
    assert.match(await summary(b).innerText(), /2× QA Cold Drink/);
    assert.match(await a.locator(".lf-table-card").nth(1).innerText(), /No canteen orders/);
    for (const width of [1440, 375, 414]) await capture(a, theme, "floor-orders", width);
    report.contrast.push(...await scanRenderedContrast(a, { route: "/live-floor", theme, state: "floor-with-orders" }));
    await a.setViewportSize({ width: 1440, height: 1100 });
    await summary(a).click();
    const drawer = a.getByRole("dialog");
    await drawer.getByRole("heading", { name: "Canteen orders · T1" }).waitFor();
    const drink = drawer.getByRole("region", { name: "QA Cold Drink", exact: true });
    await measure("quantity change", async () => {
      await drink.getByLabel("Quantity for QA Cold Drink").fill("3");
      await drink.getByRole("button", { name: "Update", exact: true }).click();
    }, "3× QA Cold Drink");
    await measure("mark drink served", async () => {
      await drink.getByRole("button", { name: "Mark served", exact: true }).click();
      await drink.getByRole("button", { name: "Served", exact: true }).waitFor();
    }, "1 pending");
    await measure("mark all served", async () => {
      await drawer.getByRole("region", { name: "QA Samosa", exact: true }).getByRole("button", { name: "Mark served", exact: true }).click();
    }, "All served");
    assert.equal(await summary(b).locator(".session-order-dot").count(), 0);
    for (const width of [1440, 375, 414]) await capture(a, theme, "orders-drawer", width);
    report.contrast.push(...await scanRenderedContrast(a, { route: "/live-floor", theme, state: "orders-drawer" }));
    const samosa = drawer.getByRole("region", { name: "QA Samosa", exact: true });
    await samosa.getByRole("button", { name: "Cancel item", exact: true }).click();
    const startCancel = performance.now();
    await samosa.getByRole("button", { name: "Confirm cancel", exact: true }).click();
    await b.waitForFunction(() => !document.querySelector('.lf-table-card .session-canteen-summary')?.textContent.includes("Samosa"));
    report.checks.push({ theme, name: "cancel order", propagationMs: Math.round(performance.now() - startCancel) });
    await a.keyboard.press("Escape");
    await a.setViewportSize({ width: 1440, height: 1100 });
    await measure("add order through UI", async () => {
      await card(a).getByRole("button", { name: "Food", exact: true }).click();
      await a.getByRole("button", { name: /QA Water/ }).click();
      await a.getByRole("button", { name: "Add Food to Session", exact: true }).click();
    }, "1× QA Water");
    let floorRequests = 0;
    let restRequests = 0;
    const paths = {};
    for (const page of pages) page.on("request", r => {
      if (r.method() === "GET" && r.url() === api + "/sessions/live-floor") floorRequests += 1;
      if (r.url().startsWith(api) && !r.url().includes("/events/stream") && r.method() !== "OPTIONS") { restRequests += 1; const name = new URL(r.url()).pathname; paths[name] = (paths[name] || 0) + 1; }
    });
    await a.waitForTimeout(500); floorRequests = 0; restRequests = 0; for (const name of Object.keys(paths)) delete paths[name];
    await Promise.all(Array.from({ length: 10 }, () => request("POST", "/sessions/t1/food", { item: "QA Water", qty: 1, session_key: "qa-close-t1" })));
    await b.waitForFunction(() => document.querySelector('.lf-table-card .session-canteen-summary')?.textContent.includes("11× QA Water"));
    await a.waitForTimeout(500);
    assert.ok(floorRequests <= 8, `Refetch storm: ${floorRequests}`);
    report.checks.push({ theme, name: "10-order burst", mutations: 10, totalFloorRequestsBothSessions: floorRequests, totalRestRequestsIncludingMutations: restRequests + 10, refetchPaths: { ...paths } });
    const connectionsBeforeDrop = await b.evaluate(() => window.__qaStreamConnections);
    await contexts[1].setOffline(true); await b.evaluate(() => window.__qaDropStream()); await a.waitForTimeout(350);
    await request("POST", "/sessions/t1/food", { item: "QA Coffee", qty: 1, session_key: "qa-close-t1" });
    const reconnectStart = performance.now(); await contexts[1].setOffline(false);
    await b.waitForFunction(count => window.__qaStreamConnections > count, connectionsBeforeDrop, { timeout: 20000 });
    await b.waitForFunction(() => document.querySelector('.lf-table-card .session-canteen-summary')?.textContent.includes("QA Coffee"), null, { timeout: 20000 });
    report.checks.push({ theme, name: "network drop/reconnect", recoveredMs: Math.round(performance.now() - reconnectStart), method: "real stream reader cancelled with injected transport error during browser offline interval", connectionsBeforeDrop, connectionsAfterReconnect: await b.evaluate(() => window.__qaStreamConnections) });
    let rejectedStreams = 0;
    await b.route("**/events/stream**", route => { rejectedStreams += 1; return route.fulfill({ status: 503, body: "QA stream unavailable", headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5180" } }); });
    const rejectedResponse = b.waitForResponse(response => response.url().includes("/events/stream") && response.status() === 503);
    await b.reload(); await rejectedResponse;
    await b.locator(".lf-table-card").first().waitFor();
    await a.waitForTimeout(1000);
    const fallbackStart = performance.now();
    await request("PATCH", "/sessions/t1/food/qa-drink", { session_key: "qa-close-t1", quantity: 4 });
    await b.waitForFunction(() => document.querySelector('.lf-table-card .session-canteen-summary')?.textContent.includes("4× QA Cold Drink"), null, { timeout: 18000 });
    assert.ok(rejectedStreams > 0);
    assert.equal(await b.evaluate(() => window.__qaStreamConnections), 0);
    report.checks.push({ theme, name: "503 with REST up", fallbackUpdateMs: Math.round(performance.now() - fallbackStart), confirmed503Responses: rejectedStreams, successfulStreams: 0 });
    await b.unroute("**/events/stream**");
    await card(a).getByRole("button", { name: "End", exact: true }).click();
    const checkout = a.getByRole("dialog");
    await checkout.getByText("Payment method", { exact: true }).waitFor();
    assert.deepEqual(await checkout.locator(".checkout-payment-grid button").allTextContents().then(rows => rows.map(r => r.trim())), ["UPI", "Cash", "Credit"]);
    assert.ok(await checkout.getByRole("button", { name: "Credit", exact: true }).isDisabled());
    await checkout.getByRole("button", { name: "Add name", exact: true }).click();
    await checkout.getByLabel("Name (optional)").fill("QA Name-only Receipt");
    assert.equal(await checkout.locator('input[type="tel"]').count(), 0);
    await a.waitForTimeout(400);
    for (const width of [1440, 375, 414]) {
      await a.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
      await checkout.getByText("Customer (optional)", { exact: true }).scrollIntoViewIfNeeded();
      await capture(a, theme, "name-and-payment", width);
    }
    report.contrast.push(...await scanRenderedContrast(a, { route: "/live-floor", theme, state: "name-only-close" }));
    await a.setViewportSize({ width: 1440, height: 1100 });
    await checkout.getByRole("button", { name: /^Close table/ }).click();
    await checkout.getByRole("heading", { name: "Payment Complete" }).waitFor();
    report.checks.push({ theme, name: "name-only cash close", noPhoneInput: true, paymentOptions: ["UPI", "Cash", "Credit"] });
    await checkout.getByRole("button", { name: "Close Receipt" }).click();
    await a.locator(".lf-table-card").nth(1).getByRole("button", { name: "End", exact: true }).click();
    await checkout.getByText("Payment method", { exact: true }).waitFor();
    await checkout.getByRole("button", { name: "Search LP Member", exact: true }).click();
    await checkout.getByLabel("Search by phone or name").fill("QA Close");
    await checkout.getByRole("button", { name: /QA Close Member/ }).click();
    await checkout.getByRole("button", { name: "Credit", exact: true }).click();
    await checkout.getByText(/Payment remains outstanding/).waitFor();
    for (const width of [1440, 375, 414]) { await a.setViewportSize({ width, height: width === 1440 ? 1100 : 844 }); await checkout.getByText("Payment method", { exact: true }).scrollIntoViewIfNeeded(); await capture(a, theme, "member-credit", width); }
    await checkout.getByRole("button", { name: /^Close table/ }).click();
    await checkout.getByRole("heading", { name: "Charged to Credit" }).waitFor();
    report.checks.push({ theme, name: "member credit UI close", receiptStatus: "credit" });
    const owner = await login("admin");
    const members = await fetch(api + "/members/", { headers: { Authorization: `Bearer ${owner.token}` } }).then(r => r.json());
    assert.equal(members.length, 1, "Name-only close must never create a member");
    assert.ok(members[0].current_balance > 0);
    for (const context of contexts) await context.close();
  }
} finally { await browser.close(); await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(report, null, 2)); }
assert.equal(report.errors.length, 0, report.errors.join("\n"));
assert.equal(report.contrast.length, 0, JSON.stringify(report.contrast));
console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots.length, contrast: report.contrast.length, errors: report.errors }));
