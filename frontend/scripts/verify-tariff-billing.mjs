import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const phase = process.env.AUDIT_PHASE || "after";
if (!["before", "after"].includes(phase)) throw new Error("Unknown phase");
const app = "http://127.0.0.1:5175";
const api = "http://127.0.0.1:8002";
const database = "/tmp/hsr-tariff-browser.db";
const directory = path.resolve(process.env.TARIFF_AUDIT_DIR || "../docs/tariff-billing-audit", phase);
await fs.mkdir(directory, { recursive: true });
let auth;
async function request(method, route, body) {
  const response = await fetch(api + route, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}
auth = await request("POST", "/auth/login", { username: "admin", password: "admin123" });
if ((await request("GET", "/sessions/active")).length) throw new Error("Disposable QA database must be empty");
if (phase === "after") await request("POST", "/settings/tariffs", { frame_rates: { wr: 0, sr: 0, pr: 0 }, packages: [] });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const result = { phase, themes: [], mobile: [], feedback: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(auth => {
    localStorage.setItem("token", auth.token); localStorage.setItem("role", auth.role); localStorage.setItem("username", auth.username);
  }, auth);
  page.on("pageerror", error => result.errors.push(error.message));
  async function go(route) { await page.goto(app + route, { waitUntil: "load" }); await page.waitForTimeout(300); await page.evaluate(() => document.fonts.ready); }
  await go("/live-floor");
  async function screenshot(name, fullPage = false) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(directory, name + ".png"), fullPage }); }
  async function openCheckout(tableId) {
    if (phase === "before") {
      await page.getByRole("button", { name: "Open Checkout", exact: true }).click();
    } else {
      if (await page.locator(".lf-detail-drawer").count()) await page.locator(".lf-detail-drawer").getByRole("button", { name: "Close panel" }).click();
      await page.locator(".lf-table-card").filter({ has: page.locator(".lf-table-card-head strong", { hasText: tableId.toUpperCase() }) }).getByRole("button", { name: "End", exact: true }).click();
    }
  }
  async function feedback(button, routePattern) {
    await page.route(routePattern, async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); }, { times: 1 });
    await button.evaluate(button => {
      window.__feedback = null;
      button.addEventListener("pointerdown", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => { if (button.matches(":disabled")) { window.__feedback = performance.now() - started; observer.disconnect(); } });
        observer.observe(button.closest("fieldset") || button, { attributes: true, childList: true, characterData: true, subtree: true });
      }, { once: true });
    });
    const label = await button.textContent();
    await button.click();
    await page.waitForFunction(() => window.__feedback !== null);
    const milliseconds = await page.evaluate(() => window.__feedback);
    result.feedback.push({ label: label.trim(), milliseconds });
    if (milliseconds > 200) throw new Error("Slow click feedback");
  }
  if (phase === "after") {
    await go("/settings");
    const settings = page.getByRole("region", { name: "Frame and package tariffs" });
    await settings.getByRole("button", { name: "Add Package" }).waitFor();
    await settings.getByRole("spinbutton").first().fill("80");
    await settings.getByRole("button", { name: "Add Package" }).click();
    await settings.getByLabel("Package 1 name").fill("QA Fixed Session");
    await settings.getByLabel("Package 1 price").fill("500");
    await settings.getByLabel("Package 1 tables").selectOption("wr");
    await feedback(settings.getByRole("button", { name: "Save Tariffs" }), "**/settings/tariffs");
    await settings.getByRole("button", { name: "Save Tariffs" }).waitFor();
    const catalog = await request("GET", "/settings/tariffs");
    if (catalog.frame_rates.wr !== 80 || catalog.packages.length !== 1) throw new Error("Settings save failed");
    result.catalog = { frameRate: catalog.frame_rates.wr, packagePrice: catalog.packages[0].price };
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
    await go("/settings");
    await page.getByText("HSR Table Rates", { exact: true }).waitFor();
    if (phase === "after") await page.getByRole("button", { name: "Save Tariffs" }).waitFor();
    await screenshot(`settings-${theme}`, true);
    await go("/live-floor?table=t1&action=start");
    await page.locator(".lf-new-session").waitFor();
    if (phase === "after") await page.getByLabel("Tariff", { exact: true }).selectOption("frame");
    await screenshot(`start-${theme}`);
    result.themes.push(await page.evaluate(() => { const style = getComputedStyle(document.body); return { theme: document.body.classList.contains("dark") ? "dark" : "light", font: style.fontFamily, canvas: style.backgroundColor, accent: style.getPropertyValue("--accent").trim() }; }));
  }
  await page.getByLabel("Customer", { exact: true }).fill("QA Tariff Player");
  await feedback(page.locator(".lf-new-session").getByRole("button", { name: phase === "before" ? "Start Table" : "Start Session", exact: true }), "**/sessions/start");
  await page.locator(".lf-new-session").waitFor({ state: "hidden" });
  if (phase === "after") {
    await go("/live-floor?table=t1");
    await page.getByRole("button", { name: "Complete Frame" }).waitFor();
    await openCheckout("t1");
    await page.getByText("Close the open frame before checkout.", { exact: true }).waitFor();
    const finalize = page.locator(".checkout-panel").getByRole("button", { name: /Close table/i });
    if (!(await finalize.isDisabled())) throw new Error("Open frame checkout enabled");
    result.openFrameCheckoutBlocked = true;
    await page.keyboard.press("Escape");
    await page.locator(".checkout-panel").waitFor({ state: "hidden" });
    await go("/live-floor?table=t1");
    await feedback(page.getByRole("button", { name: "Complete Frame", exact: true }), "**/sessions/t1/frames/close");
    await page.getByRole("button", { name: "Start Frame", exact: true }).waitFor();
    await page.getByRole("button", { name: "Start Frame", exact: true }).click();
    await page.getByRole("button", { name: "Complete Frame", exact: true }).waitFor();
    await page.getByRole("button", { name: "Complete Frame", exact: true }).click();
    await page.getByRole("button", { name: "Start Frame", exact: true }).waitFor();
    const catalog = await request("GET", "/settings/tariffs");
    await request("POST", "/settings/tariffs", { ...catalog, frame_rates: { ...catalog.frame_rates, wr: 120 } });
    const quote = await request("GET", "/sessions/quote/t1");
    if (quote.ply !== 160 || quote.tariff_price !== 80 || quote.frame_count !== 2) throw new Error("Frame price changed");
    result.frameQuote = { charge: quote.ply, price: quote.tariff_price, completedFrames: quote.frame_count };
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
    await go("/live-floor?table=t1");
    await page.locator(".lf-table-card").last().waitFor();
    if (phase === "after") await page.locator(".lf-detail-drawer").getByRole("button", { name: "Close panel" }).click();
    await screenshot(`floor-${theme}`, true);
    await openCheckout("t1");
    await page.locator(".checkout-panel .checkout-summary-grid").waitFor();
    await screenshot(`checkout-${theme}`);
  }
  if (phase === "after") {
    await page.locator(".checkout-panel").getByRole("button", { name: /Close table/i }).click();
    await page.getByText("Payment Complete", { exact: true }).waitFor();
    const history = await request("GET", "/reports/history");
    if (history[0].tot !== 160 || history[0].tariff_mode !== "frame") throw new Error("Saved frame bill wrong");
    await go("/live-floor?table=t2&action=start");
    await page.getByLabel("Customer", { exact: true }).fill("QA Package Player");
    await page.getByLabel("Tariff", { exact: true }).selectOption("package");
    const catalog = await request("GET", "/settings/tariffs");
    await page.getByLabel("Package", { exact: true }).selectOption(catalog.packages[0].id);
    await page.locator(".lf-new-session").getByRole("button", { name: "Start Session", exact: true }).click();
    await page.locator(".lf-new-session").waitFor({ state: "hidden" });
    await request("POST", "/settings/tariffs", { ...catalog, packages: [] });
    const fixed = await request("GET", "/sessions/quote/t2");
    if (fixed.ply !== 500) throw new Error("Removed package changed live price");
    result.packageQuote = { priceAfterCatalogRemoval: fixed.ply, name: fixed.tariff_label };
    await request("POST", "/settings/tariffs", catalog);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
      await go("/live-floor?table=t2");
      await page.locator(".lf-table-card").last().waitFor();
      await page.locator(".lf-detail-drawer").getByRole("button", { name: "Close panel" }).click();
      await screenshot(`package-${theme}`, true);
    }
    for (const width of [375, 414]) {
      await page.setViewportSize({ width, height: 896 });
      for (const route of ["/live-floor?table=t2", "/settings", "/legacy-table-controls"]) {
        await go(route);
        await page.waitForTimeout(600);
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        if (dimensions.document > width + 1) throw new Error(`Mobile overflow ${route}: ${JSON.stringify(dimensions)}`);
        result.mobile.push({ width, route, ...dimensions });
        await screenshot(`mobile-${width}-${route.split("?")[0].slice(1)}`, true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("/legacy-table-controls");
    const advanced = page.locator(".table-detail-panel");
    await advanced.getByLabel("Tariff", { exact: true }).waitFor();
    await advanced.getByLabel("Tariff", { exact: true }).selectOption("frame");
    await advanced.locator(".billing-mode-control").getByRole("button", { name: "Single One payer" }).click();
    await advanced.getByRole("button", { name: "Start Table", exact: true }).click();
    await advanced.getByRole("button", { name: "Complete Frame", exact: true }).waitFor();
    await advanced.getByRole("button", { name: "Complete Frame", exact: true }).click();
    await advanced.getByRole("button", { name: "Start Frame", exact: true }).waitFor();
    const legacyQuote = await request("GET", "/sessions/quote/t1");
    if (legacyQuote.ply !== 120 || legacyQuote.frame_count !== 1) throw new Error("Advanced tariff start/complete failed");
    result.legacyFrameCharge = legacyQuote.ply;
    result.legacySelectorPresent = true;
    await screenshot("advanced-dark", true);
    for (const width of [375, 414]) {
      await page.setViewportSize({ width, height: 896 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
        await go("/live-floor?table=t1");
        const frameAction = page.getByRole("button", { name: "Start Frame", exact: true });
        await frameAction.waitFor();
        await frameAction.scrollIntoViewIfNeeded();
        const hit = await frameAction.evaluate(button => {
          const rect = button.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { width: rect.width, height: rect.height, x: rect.x, y: rect.y, target: target?.className, unobscured: target === button || button.contains(target) };
        });
        if (!hit.unobscured || hit.height < 44) { await page.screenshot({ path: "/tmp/hsr-tariff-obscured.png" }); throw new Error(`Frame action obscured/too small: ${JSON.stringify(hit)}`); }
        result.mobile.push({ width, theme, route: "/live-floor?table=t1", frameAction: hit });
        await screenshot(`mobile-${width}-frames-${theme}`, true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("/sales");
    await page.getByText("QA Tariff Player", { exact: true }).first().click();
    await page.getByText("2 frames x ₹80", { exact: true }).waitFor();
    result.savedReceiptTariffVisible = true;
    await screenshot("saved-receipt-dark");
  }
  if (result.errors.length) throw new Error("Browser errors detected");
} finally {
  await browser.close();
  // This fixed-path fixture DB is local and disposable; never target a live database.
  const cleanup = spawnSync("sqlite3", [database, "DELETE FROM session_frames; DELETE FROM active_sessions; DELETE FROM transactions; DELETE FROM closed_session_frames; DELETE FROM session_events; DELETE FROM members; DELETE FROM audit_logs;" + (phase === "after" ? "UPDATE settings SET tariffs_json='{}';" : "")], { encoding: "utf8" });
  if (cleanup.status !== 0) throw new Error(cleanup.stderr);
}
await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
