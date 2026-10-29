import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const output = process.env.UI_READ_OUTPUT || "../docs/deployment-ui-completion/operations-read-contract";
await fs.mkdir(output, { recursive: true });
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(response => response.json());
assert.ok(auth.token, "Isolated QA login required");
const scenarios = [
  ["inventory-missing-stock", "/inventory"], ["inventory-unavailable-floor", "/inventory"],
  ["inventory-unavailable-menu", "/inventory"], ["waitlist-reserved", "/waitlist"],
  ["waitlist-unknown-floor", "/waitlist"], ["legacy-unknown-floor", "/legacy-table-controls"],
  ["tournament-unknown-floor", "/tournaments"],
];
const report = { scope: "Read-only local response fixtures; all business writes and external requests blocked", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const [scenario, route] of scenarios.filter(([name]) => !process.env.UI_READ_SCENARIOS || process.env.UI_READ_SCENARIOS.split(",").includes(name))) for (const theme of ["light", "dark"]) for (const width of process.env.UI_READ_WIDTHS?.split(",").map(Number) || [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin !== api) return handler.continue();
      if (url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      if (scenario === "inventory-unavailable-menu" && url.pathname === "/settings/menu") return handler.fulfill({ status: 500, json: { detail: "QA menu read failure" } });
      if (scenario === "inventory-missing-stock" && url.pathname === "/settings/menu") return handler.fulfill({ json: { "QA Unknown Stock": { price: null, available: null, category: "Drinks" }, "QA Null Item": null } });
      if (route === "/waitlist" && url.pathname.replace(/\/$/, "") === "/waitlist") return handler.fulfill({ json: [{ id: 99001, position: null, customer_name: null, party_size: null, preferred_type: "ANY", wait_mins: null, recommended_table: { id: "t3" } }] });
      if (["/sessions/tables", "/sessions/live-floor"].includes(url.pathname) && scenario !== "inventory-unavailable-menu" && scenario !== "inventory-missing-stock") {
        if (scenario === "inventory-unavailable-floor") return handler.fulfill({ status: 500, json: { detail: "QA floor read failure" } });
        const response = await handler.fetch(), data = await response.json();
        const replace = tables => tables.map(table => table.id === "t3" ? { ...table, status_key: scenario === "waitlist-reserved" ? "reserved" : null, status_label: scenario === "waitlist-reserved" ? "Reserved" : null, booking: { customer_name: "QA Reservation", booking_time: "2099-10-29T18:00:00+05:30" } } : table);
        const tables = replace(data.tables);
        return handler.fulfill({ response, json: { ...data, tables, ...(data.floor ? { floor: { ...data.floor, tables: replace(data.floor.tables) } } : {}) } });
      }
      return handler.continue();
    });
    const page = await context.newPage(), result = { scenario, route, theme, width, errors: [] };
    report.cases.push(result);
    page.on("pageerror", error => result.errors.push(error.message));
    try {
      await page.goto(app + route);
      await page.locator(".topbar-title").waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
      await page.evaluate(() => document.fonts.ready);
      if (scenario === "inventory-missing-stock") {
        const row = page.locator(".cf-inventory-row");
        await row.waitFor();
        assert.equal(await row.count(), 1, "Null menu entries must not invent an in-stock item");
        result.stockActionDisabled = await row.getByRole("button", { name: "Stock status unavailable for QA Unknown Stock", exact: true }).isDisabled();
        assert.ok(result.stockActionDisabled);
        result.deleteActionDisabled = await row.getByRole("button", { name: "Delete QA Unknown Stock", exact: true }).isDisabled();
        assert.ok(result.deleteActionDisabled, "Undo must not restore invented price or stock fields");
        await row.getByRole("checkbox", { name: "Select QA Unknown Stock", exact: true }).check();
        assert.ok(await page.getByRole("button", { name: "Delete Items", exact: true }).isDisabled());
        result.rowText = await row.innerText();
        assert.ok(result.rowText.includes("Stock unavailable") && !result.rowText.includes("₹0"));
      } else if (scenario === "inventory-unavailable-floor") {
        await page.getByText("Table maintenance details are unavailable.", { exact: true }).waitFor();
        assert.ok(await page.getByRole("button", { name: "Mark", exact: true }).isDisabled());
        assert.equal(await page.getByText("No tables in maintenance", { exact: true }).count(), 0);
      } else if (scenario === "inventory-unavailable-menu") {
        assert.ok(await page.getByRole("button", { name: "Retry", exact: true }).count());
        assert.equal(await page.getByText("No menu items", { exact: true }).count(), 0);
      } else if (route === "/waitlist") {
        const name = page.getByText("Name unavailable", { exact: true });
        await name.waitFor({ state: "attached" });
        result.nameWidth = await name.evaluate(node => node.getBoundingClientRect().width);
        assert.ok(result.nameWidth >= 100, "Queue controls must not squeeze the guest name to zero width");
        const selection = page.getByRole("combobox", { name: "Table for waiting guest", exact: true });
        result.options = await selection.locator("option").evaluateAll(nodes => nodes.map(node => node.value));
        if (scenario === "waitlist-reserved") {
          assert.deepEqual(result.options, ["", "t4", "t5"], "Reserved table must not be offered even when backend recommends it");
          assert.equal(await selection.inputValue(), "t4");
          assert.equal(await page.getByRole("button", { name: "Seat", exact: true }).isDisabled(), false);
        } else {
          assert.deepEqual(result.options, [""]);
          assert.ok(await page.getByRole("button", { name: "Seat", exact: true }).isDisabled());
          await page.getByText("Table availability unavailable", { exact: true }).waitFor();
        }
      } else {
        await page.getByRole("button", { name: /retry/i }).first().waitFor();
        result.tableCards = await page.locator(".lf-table-card").count();
        assert.equal(result.tableCards, 0, "Unknown statuses must not become available cards");
      }
      result.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      result.contrast = await scanRenderedContrast(page, { route, theme, state: scenario, minimumContrast: 4.5, includeDisabled: true });
      await page.screenshot({ path: `${output}/${scenario}-${theme}-${width}.png`, fullPage: true, animations: "disabled" });
      for (const key of ["shortTargets", "clipped", "clippedControls", "smallText", "contentOverflow", "invalidCopy", "unlabeledButtons", "unlabeledInputs", "brokenImages"]) assert.equal(result.metrics[key].length, 0, key);
      assert.equal(result.metrics.overflow, 0); assert.equal(result.metrics.applicationCrashed, false);
      assert.equal(result.contrast.length, 0, "contrast"); assert.equal(result.errors.length, 0);
    } catch (error) { result.error = error.message; await page.screenshot({ path: `${output}/${scenario}-${theme}-${width}-failure.png`, fullPage: true, animations: "disabled" }).catch(() => {}); }
    finally { await context.close(); }
    console.log(JSON.stringify({ scenario, theme, width, error: result.error }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
assert.ok(report.cases.every(result => !result.error));
