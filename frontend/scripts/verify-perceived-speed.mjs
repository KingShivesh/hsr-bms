import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const api = "http://127.0.0.1:8006";
const membersPath = /\/members\/?$/;
const directory = path.resolve("../docs/perceived-speed/verification");
await fs.mkdir(directory, { recursive: true });
const auth = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { checks: [], screenshots: [], errors: [], productionMutations: 0 };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(({ auth, theme }) => {
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
      localStorage.setItem("theme", theme);
    }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto("http://127.0.0.1:5181/live-floor");
    const card = page.locator(".lf-table-card").first();
    await card.waitFor();
    await page.waitForTimeout(1500);
    async function screenshot(name) {
      await page.evaluate(() => scrollTo(0, 0));
      const file = `${name}-${theme}.png`;
      await page.screenshot({ path: path.join(directory, file), animations: "disabled" });
      report.screenshots.push(file);
    }
    async function observedClick(button) {
      await button.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await button.evaluate(button => {
        window.__reaction = { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height };
        const observer = new MutationObserver(() => {
          if (button.getAttribute("aria-busy") === "true" && window.__reaction.feedbackMs == null) {
            window.__reaction.feedbackMs = performance.now() - window.__reaction.start;
            window.__reaction.busyWidth = button.getBoundingClientRect().width;
            window.__reaction.busyHeight = button.getBoundingClientRect().height;
          }
        });
        observer.observe(button, { attributes: true, childList: true, subtree: true });
        button.addEventListener("click", () => { window.__reaction.start = performance.now(); setTimeout(() => observer.disconnect(), 2000); }, { once: true, capture: true });
      });
      await button.click();
      await page.waitForFunction(() => window.__reaction.feedbackMs != null);
      const result = await page.evaluate(() => window.__reaction);
      assert.ok(result.feedbackMs < 100, JSON.stringify(result));
      assert.equal(result.width, result.busyWidth);
      assert.equal(result.height, result.busyHeight);
      return result;
    }
    let pauseRequests = 0;
    await page.route("**/sessions/pause/t1", async route => {
      pauseRequests++;
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "QA pause rejected" }) });
    });
    const initialState = await card.getAttribute("data-table-state");
    const pauseButton = card.getByRole("button", { name: /^(Pause|Resume)$/ });
    const reaction = await observedClick(pauseButton);
    assert.notEqual(await card.getAttribute("data-table-state"), initialState);
    await screenshot("pause-pending");
    await page.getByText("QA pause rejected", { exact: true }).waitFor();
    assert.equal(await card.getAttribute("data-table-state"), initialState);
    assert.equal(pauseRequests, 1);
    report.checks.push({ theme, name: "pause immediate feedback + optimistic state + 409 rollback", ...reaction, requests: pauseRequests });
    await page.unroute("**/sessions/pause/t1");

    const third = page.locator(".lf-table-card").nth(2);
    await page.route("**/sessions/start", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"QA start rejected"}' });
    });
    const startReaction = await observedClick(third.getByRole("button", { name: "Start Session", exact: true }));
    assert.equal(await third.getAttribute("data-table-state"), "running");
    await page.getByText("QA start rejected", { exact: true }).waitFor();
    assert.equal(await third.getAttribute("data-table-state"), "available");
    report.checks.push({ theme, name: "start instant running state + rollback", ...startReaction });
    await page.unroute("**/sessions/start");

    await card.getByRole("button", { name: "Food", exact: true }).click();
    await page.getByRole("button", { name: /QA Water/ }).click();
    await page.route("**/sessions/t1/food", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"QA food rejected"}' });
    });
    const addReaction = await observedClick(page.getByRole("button", { name: "Add Food to Session", exact: true }));
    assert.match(await card.innerText(), /QA Water/);
    await page.getByText("QA food rejected", { exact: true }).first().waitFor();
    assert.doesNotMatch(await card.innerText(), /QA Water/);
    assert.equal(await page.getByRole("dialog").count(), 1, "failed form must stay open");
    assert.equal(await page.locator(".order-item.is-selected").count(), 1);
    report.checks.push({ theme, name: "food pending insert + rollback + retained selection", ...addReaction });
    await page.unroute("**/sessions/t1/food");
    await page.keyboard.press("Escape");

    await card.getByRole("button", { name: "Canteen orders for T1", exact: true }).click();
    const row = page.getByRole("region", { name: "QA Cold Drink", exact: true });
    await page.route("**/sessions/t1/food/qa-drink", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"QA serve rejected"}' });
    });
    await observedClick(row.getByRole("button", { name: "Mark served", exact: true }));
    assert.match(await row.innerText(), /Served/);
    await page.getByText("QA serve rejected", { exact: true }).first().waitFor();
    await row.getByRole("button", { name: "Mark served", exact: true }).waitFor();
    report.checks.push({ theme, name: "serve instant + 409 rollback", pass: true });
    await page.unroute("**/sessions/t1/food/qa-drink");
    await page.keyboard.press("Escape");

    await card.getByRole("button", { name: "End", exact: true }).click();
    await page.getByText("Payment method", { exact: true }).waitFor();
    await page.route("**/sessions/stop/t1?**", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ status: 409, json: { detail: "QA close rejected" } });
    });
    await observedClick(page.getByRole("button", { name: /^(Confirm & Close|Close table)/ }));
    assert.match(await card.innerText(), /Closing…/);
    await page.getByText("QA close rejected", { exact: true }).waitFor();
    assert.equal(await card.getAttribute("data-table-state"), initialState);
    assert.equal(await page.getByRole("heading", { name: "Payment Complete" }).count(), 0);
    report.checks.push({ theme, name: "closing pending, no false payment success on rejection", pass: true });
    await page.unroute("**/sessions/stop/t1?**");
    await page.keyboard.press("Escape");

    // Warm navigation retains shell DOM and cached content under an intentionally slow read.
    await page.evaluate(() => { window.__shell = document.querySelector("aside.sidebar"); });
    await page.getByRole("button", { name: "Customers", exact: true }).hover();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Customers", exact: true }).click();
    await page.getByText("QA Close Member", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Live Floor", exact: true }).click();
    await card.waitFor();
    await page.route(membersPath, async route => { await new Promise(resolve => setTimeout(resolve, 800)); await route.continue(); });
    const warmRead = page.waitForResponse(response => membersPath.test(response.url()) && response.request().method() === "GET");
    await page.getByRole("button", { name: "Customers", exact: true }).click();
    await page.getByText("QA Close Member", { exact: true }).first().waitFor();
    assert.equal(await page.locator(".page-skeleton").count(), 0);
    assert.ok(await page.evaluate(() => window.__shell === document.querySelector("aside.sidebar")));
    report.checks.push({ theme, name: "cached return while revalidating + same shell DOM", pass: true });
    await warmRead;
    await page.unroute(membersPath);

    await page.route(membersPath, async route => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ status: 422, contentType: "application/json", body: '{"detail":[{"msg":"QA invalid customer"}]}' });
    });
    await page.getByRole("textbox", { name: "Customer name", exact: true }).fill("QA Pending Customer");
    await observedClick(page.locator("form").getByRole("button", { name: "Add Customer", exact: true }));
    await page.getByText("QA Pending Customer · Saving…", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "QA invalid customer" }).waitFor();
    assert.equal(await page.getByText("QA Pending Customer · Saving…", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Customer name", exact: true }).inputValue(), "QA Pending Customer");
    report.checks.push({ theme, name: "optimistic customer create + 422 inline error + retained draft", pass: true });
    await page.unroute(membersPath);

    await page.getByRole("button", { name: "Inventory & Stocks", exact: true }).click();
    const inventory = page.locator(".cf-inventory-row").filter({ hasText: "QA Cold Drink" });
    await inventory.waitFor();
    await page.route("**/settings/menu/*/availability", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ status: 409, json: { detail: "QA stock rejected" } });
    });
    await observedClick(inventory.getByRole("button", { name: "Mark QA Cold Drink out of stock", exact: true }));
    assert.match(await inventory.innerText(), /Out of stock/);
    await page.getByText("QA stock rejected", { exact: true }).waitFor();
    assert.match(await inventory.innerText(), /In stock/);
    report.checks.push({ theme, name: "optimistic inventory availability + rollback", pass: true });
    await page.unroute("**/settings/menu/*/availability");
    await page.route("**/settings/menu/QA%20Cold%20Drink", async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ status: 409, json: { detail: "QA deletion rejected" } });
    });
    await inventory.getByRole("button", { name: "Delete QA Cold Drink", exact: true }).click();
    assert.equal(await inventory.count(), 0);
    await page.getByText("QA deletion rejected", { exact: true }).waitFor();
    await inventory.waitFor();
    report.checks.push({ theme, name: "optimistic inventory deletion + rollback", pass: true });
    await page.unroute("**/settings/menu/QA%20Cold%20Drink");

    await page.getByRole("button", { name: "Live Floor", exact: true }).click();
    await card.waitFor();
    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
      assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
      await screenshot(`floor-${width}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(report, null, 2));
}
assert.equal(report.errors.length, 0, report.errors.join("\n"));
console.log(JSON.stringify(report, null, 2));
