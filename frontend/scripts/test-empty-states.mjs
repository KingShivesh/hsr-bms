import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const app = process.env.POLISH_APP_URL || "http://127.0.0.1:5177";
const api = process.env.POLISH_API_URL || "http://127.0.0.1:8003";
const stage = process.env.EMPTY_STAGE || "after";
assert.ok(["before", "after"].includes(stage));
for (const url of [app, api]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Local QA only");
const output = path.resolve(`../docs/empty-state-polish/${stage}`);
await fs.mkdir(output, { recursive: true });
const login = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(login.status, 200);
const auth = await login.json();
const customer = { id: "QA-EMPTY-STATE", nm: "QA Empty State Customer", typ: "Regular", vis: 2, spt: 500, phone: "9000000000" };
const booking = { id: 99001, customer_name: "QA Empty State Booking", status: "booked", table_id: "t3", table_type: "SNOOKER", booking_time: "2099-10-12T18:00:00", duration_mins: 60, phone: "9000000000" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, samples: [], actions: [], errors: [], blockedWrites: 0, fixtures: "Browser-only responses; no records created" };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    let populated = false;
    await page.route(api + "/**", async handler => {
      const request = handler.request();
      const endpoint = new URL(request.url()).pathname.replace(/\/$/, "");
      if (request.method() !== "GET" && request.method() !== "OPTIONS") {
        report.blockedWrites++;
        return handler.fulfill({ status: 403, json: { detail: "QA is read-only" } });
      }
      if (endpoint === "/events/stream") return handler.fulfill({ status: 503, json: { detail: "QA isolates presentation from realtime" } });
      if (endpoint === "/members") return handler.fulfill({ json: populated ? [customer] : [] });
      if (endpoint === "/members/duplicates") return handler.fulfill({ json: [] });
      if (endpoint === "/bookings") return handler.fulfill({ json: populated ? [booking] : [] });
      if (endpoint === "/waitlist") return handler.fulfill({ json: [] });
      return handler.continue();
    });
    async function capture(route, state) {
      const container = page.locator(route === "/waitlist" ? ".cf-panel" : ".op2-panel").last();
      await container.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      const sample = await container.evaluate(node => ({
        text: node.innerText,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        font: getComputedStyle(document.body).fontFamily,
        canvas: getComputedStyle(document.body).getPropertyValue("--surface-base").trim(),
        accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(),
        actions: [...node.querySelectorAll("button")].map(button => ({ label: button.innerText.trim(), height: button.getBoundingClientRect().height })),
      }));
      const width = page.viewportSize().width;
      report.samples.push({ route, theme, width, state, ...sample });
      assert.equal(sample.overflow, 0);
      assert.match(sample.font, /Syne/);
      if (width < 768) assert.ok(sample.actions.every(action => action.height >= 44), JSON.stringify(sample.actions));
      const name = `${route.slice(1)}-${state}-${theme}-${width}`;
      await page.screenshot({ path: `${output}/${name}.png` });
      const empty = page.locator(route === "/waitlist" ? ".cf-panel:has(h2:text-is('Walk-ins Waiting'))" : ".op2-panel").locator(".op2-empty,.cf-empty,.ui-empty-state").first();
      if (await empty.count()) await empty.screenshot({ path: `${output}/${name}-detail.png` });
    }
    async function clickWithFeedback(button, kind, route) {
      await button.evaluate((node, kind) => {
        window.emptyFeedbackMs = null;
        node.addEventListener("click", () => {
          const start = performance.now();
          const check = () => {
            const ready = kind === "existing-form" ? Boolean(document.querySelector('[role="dialog"]'))
              : kind === "focus-customer" ? document.activeElement?.getAttribute("aria-label") === "Customer name"
              : kind === "clear-status" ? [...document.querySelectorAll('.op2-controls button[aria-pressed="true"]')].some(node => node.textContent.trim() === "all")
              : [...document.querySelectorAll('.op2-controls input')].some(node => node.value === "");
            if (ready) window.emptyFeedbackMs = performance.now() - start;
            else if (performance.now() - start < 2000) requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }, { once: true, capture: true });
      }, kind);
      await button.click();
      await page.waitForFunction(() => Number.isFinite(window.emptyFeedbackMs));
      const feedbackMs = await page.evaluate(() => window.emptyFeedbackMs);
      report.actions.push({ route, theme, width: page.viewportSize().width, kind, feedbackMs });
      assert.ok(feedbackMs < 200, `${route} ${kind}: ${feedbackMs}ms`);
    }
    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const route of ["/customers", "/bookings", "/waitlist"]) {
        populated = false;
        await page.goto(app + route);
        await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton")].some(node => node.getClientRects().length));
        await capture(route, "empty");
        if (stage === "after") {
          const empty = page.locator(".ui-empty-state").first();
          const action = empty.getByRole("button").first();
          if (route === "/customers") {
            await clickWithFeedback(action, "focus-customer", route);
            await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Customer name");
          } else {
            await clickWithFeedback(action, "existing-form", route);
            await page.getByRole("dialog").waitFor({ timeout: 500 });
            await page.keyboard.press("Escape");
            await page.getByRole("dialog").waitFor({ state: "hidden" });
          }
        }
        if (route === "/waitlist") continue;
        populated = true;
        await page.reload();
        const search = page.getByPlaceholder(route === "/customers" ? "Search customer..." : "Search booking...");
        await search.fill("no-such-QA-match");
        await capture(route, "filtered");
        if (stage === "after") {
          await clickWithFeedback(page.getByRole("button", { name: "Clear search", exact: true }), "clear-search", route);
          await page.getByText(route === "/customers" ? customer.nm : booking.customer_name, { exact: true }).last().waitFor();
          assert.equal(await search.inputValue(), "");
          if (route === "/bookings") {
            await page.getByRole("button", { name: "missed", exact: true }).click();
            await capture(route, "status-filter");
            await clickWithFeedback(page.getByRole("button", { name: "Show all bookings", exact: true }), "clear-status", route);
            await page.getByText(booking.customer_name, { exact: true }).last().waitFor();
            assert.equal(await page.getByRole("button", { name: "all", exact: true }).getAttribute("aria-pressed"), "true");
          }
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
}
assert.equal(report.errors.length, 0);
assert.equal(report.blockedWrites, 0);
console.log(JSON.stringify({ stage, samples: report.samples.length, actions: report.actions.length, errors: report.errors, blockedWrites: report.blockedWrites }));
