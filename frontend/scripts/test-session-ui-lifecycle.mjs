import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const api = "http://127.0.0.1:8007", app = "http://127.0.0.1:5182";
const output = process.env.LIFECYCLE_OUTPUT || "../docs/deployment-ui-completion/final-completion/lifecycle";
await fs.mkdir(output, { recursive: true });
const login = async role => {
  const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) });
  assert.equal(response.status, 200); return response.json();
};
const owner = await login("admin");
const read = async path => {
  const response = await fetch(api + path, { headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(response.status, 200); return response.json();
};
const beforeHistory = await read("/reports/history");
const beforeMembers = await read("/members/");
assert.ok(beforeMembers.some(member => (member.name || member.nm) === "QA Close Member"), "Dedicated QA seed is required");
const report = { scope: "20 real browser-driven local QA sessions, not API-only repetitions; API8007 exclusively uses sqlite:////tmp/hsr-lifecycle-ui.db; business requests restricted to table t3", cases: [], blockedWrites: [], errors: [], beforeTransactions: beforeHistory.length, beforeMembers: beforeMembers.length };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
try {
  run: for (const role of ["admin", "staff"]) for (const theme of ["light", "dark"]) for (const width of [375, 414, 768, 1024, 1440]) {
    const index = report.cases.length + 1;
    const method = ["Cash", "UPI", "Credit", "Cash", "UPI"][(index - 1) % 5];
    const row = { index, role, theme, width, method, requests: [], samples: [] };
    report.cases.push(row);
    const auth = await login(role);
    const context = await browser.newContext({ viewport: { width, height: width <= 414 ? 844 : 1000 }, timezoneId: "Asia/Kolkata", reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![api, app].includes(url.origin)) return handler.abort("blockedbyclient");
      if (url.origin === api && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        const allowed = request.method() === "POST" && ((url.pathname === "/sessions/start" && request.postDataJSON()?.table_id === "t3") || /^\/sessions\/(pause|checkout-preview|stop)\/t3$/.test(url.pathname) || url.pathname === "/sessions/t3/food");
        if (!allowed) { report.blockedWrites.push({ method: request.method(), path: url.pathname }); return handler.abort("blockedbyclient"); }
        row.requests.push({ method: request.method(), path: url.pathname });
      }
      if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      return handler.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push({ index, message: error.message }));
    const card = () => page.locator(".lf-table-card").nth(2);
    const responseTo = path => page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === "POST");
    const sample = async name => {
      await settle(page);
      const metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      const contrast = await scanRenderedContrast(page, { route: "/live-floor", theme, state: name, minimumContrast: 4.5, includeDisabled: true });
      row.samples.push({ name, metrics, contrast });
      await page.screenshot({ path: `${output}/${index}-${role}-${theme}-${width}-${name}.png`, animations: "disabled" });
      assert.equal(metrics.overflow, 0);
      for (const key of ["shortTargets", "smallText", "clipped", "clippedControls", "contentOverflow", "unlabeledButtons", "unlabeledInputs", "invalidCopy"]) assert.equal(metrics[key].length, 0, `${name}: ${key}`);
      assert.equal(contrast.length, 0, `${name}: contrast`);
    };
    try {
      await page.goto(app + "/live-floor"); await card().getByRole("button", { name: "Start Session", exact: true }).waitFor();
      const startResponse = responseTo("/sessions/start");
      await card().getByRole("button", { name: "Start Session", exact: true }).click();
      assert.equal((await startResponse).status(), 200);
      await card().getByRole("button", { name: "Pause", exact: true }).waitFor();
      const pause = responseTo("/sessions/pause/t3"); await card().getByRole("button", { name: "Pause", exact: true }).click(); assert.equal((await pause).status(), 200);
      await card().getByRole("button", { name: "Resume", exact: true }).waitFor();
      const resume = responseTo("/sessions/pause/t3"); await card().getByRole("button", { name: "Resume", exact: true }).click(); assert.equal((await resume).status(), 200);
      await card().getByRole("button", { name: "Pause", exact: true }).waitFor();
      await card().focus(); await card().press("Enter");
      const details = page.getByRole("dialog", { name: "Session details · T3", exact: true }); await details.waitFor();
      await sample("session-details"); await page.keyboard.press("Escape"); await details.waitFor({ state: "hidden" });
      await card().getByRole("button", { name: "Food", exact: true }).click();
      const food = page.getByRole("dialog", { name: "Session food · T3", exact: true }); await food.waitFor();
      await food.getByRole("button", { name: /QA Water/ }).click();
      const foodResponse = responseTo("/sessions/t3/food");
      await food.getByRole("button", { name: "Add Food to Session", exact: true }).click();
      assert.equal((await foodResponse).status(), 200); await food.waitFor({ state: "hidden" });
      await card().getByText(/1× QA Water/).waitFor();
      await card().getByRole("button", { name: "End", exact: true }).click();
      const checkout = page.locator(".checkout-panel");
      await checkout.getByText("Payment method", { exact: true }).waitFor();
      if (method === "Credit") {
        await checkout.getByRole("button", { name: "Search LP Member", exact: true }).click();
        await checkout.getByLabel("Search by phone or name").fill("QA Close");
        await checkout.getByRole("button", { name: /QA Close Member/ }).click();
      } else if (index % 2) {
        await checkout.getByRole("button", { name: "Add name", exact: true }).click();
        const name = checkout.getByLabel("Name (optional)");
        await name.fill(`QA Lifecycle ${index}`); await name.press("Enter");
      }
      await checkout.getByRole("button", { name: method, exact: true }).click();
      const confirm = checkout.getByRole("button", { name: /^Confirm & Close/ });
      await page.waitForFunction(node => !node.disabled, await confirm.elementHandle());
      await sample("checkout");
      const closed = responseTo("/sessions/stop/t3"); await confirm.click();
      const response = await closed;
      assert.equal(response.status(), 200, await response.text());
      const receipt = await response.json();
      row.receipt = { id: receipt.id, sessionKey: receipt.session_key, total: receipt.tot, food: receipt.famt, method: receipt.payment_method, status: receipt.payment_status };
      assert.ok(receipt.session_key); assert.ok(receipt.famt >= 20); assert.equal(receipt.payment_method, method);
      await checkout.getByRole("heading", { name: method === "Credit" ? "Charged to Credit" : "Payment Complete", exact: true }).waitFor();
      await sample("receipt");
      await checkout.getByRole("button", { name: "Close Receipt", exact: true }).click();
      await checkout.waitFor({ state: "hidden" });
      await card().getByRole("button", { name: "Start Session", exact: true }).waitFor();
      const history = await read("/reports/history");
      const persisted = history.filter(record => record.session_key === receipt.session_key);
      assert.equal(persisted.length, 1, "Exactly one durable transaction per session");
      assert.equal(persisted[0].payment_method, method); assert.equal(persisted[0].tot, receipt.tot); assert.equal(persisted[0].payment_status, method === "Credit" ? "credit" : "paid");
      const count = path => row.requests.filter(request => request.path === path).length;
      assert.equal(count("/sessions/start"), 1); assert.equal(count("/sessions/pause/t3"), 2); assert.equal(count("/sessions/t3/food"), 1); assert.equal(count("/sessions/stop/t3"), 1);
      row.completed = true;
    } catch (error) { row.error = error.message; await page.screenshot({ path: `${output}/${index}-failure.png` }).catch(() => {}); }
    finally { await context.close(); }
    console.log(JSON.stringify({ index, role, theme, width, method, completed: row.completed, error: row.error }));
    if (row.error) break run;
  }
  report.afterTransactions = (await read("/reports/history")).length;
  report.afterMembers = (await read("/members/")).length;
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.cases.length, 20); assert.ok(report.cases.every(row => row.completed));
assert.equal(report.afterTransactions - report.beforeTransactions, 20);
assert.equal(report.afterMembers, report.beforeMembers, "Guest names must not create member rows");
assert.equal(report.blockedWrites.length, 0); assert.equal(report.errors.length, 0);
