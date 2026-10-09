import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const app = "http://127.0.0.1:5175";
const api = "http://127.0.0.1:8002";
const database = "/tmp/hsr-tariff-browser.db";
const directory = path.resolve("../docs/inline-table-actions-audit/after");
await fs.mkdir(directory, { recursive: true });
const seed = spawnSync("../backend/venv/bin/python", ["-c", `
import importlib.util, sqlite3
spec=importlib.util.spec_from_file_location('fixture','scripts/table-state-fixture.py')
fixture=importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
with sqlite3.connect('${database}') as db:
    assert db.execute("SELECT COUNT(*) FROM active_sessions WHERE customer_name NOT LIKE 'QA %'").fetchone()[0] == 0
    db.execute('DELETE FROM session_frames'); db.execute('DELETE FROM active_sessions')
    fixture.cleanup(db); fixture.seed_all_states(db)
`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
assert.equal(seed.status, 0, seed.stderr);
let auth;
async function request(method, route, body) {
  const response = await fetch(api + route, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
auth = await request("POST", "/auth/login", { username: "admin", password: "admin123" });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const result = { themes: [], cards: [], mobile: [], feedback: [], checks: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(auth => { localStorage.setItem("token", auth.token); localStorage.setItem("role", auth.role); localStorage.setItem("username", auth.username); }, auth);
  page.on("pageerror", error => result.errors.push(error.message));
  async function go() {
    await page.goto(app + "/live-floor");
    await page.locator(".lf-table-card").last().waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
  const stateCard = state => page.locator(`.lf-table-card[data-table-state="${state}"]`);
  async function screenshot(name, fullPage = true) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(directory, name + ".png"), fullPage });
  }
  async function feedback(button, pattern) {
    await page.route(pattern, async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); }, { times: 1 });
    await button.evaluate(button => {
      window.__feedback = null;
      button.addEventListener("pointerdown", () => {
        const start = performance.now();
        const observer = new MutationObserver(() => { if (button.matches(":disabled")) { window.__feedback = performance.now() - start; observer.disconnect(); } });
        observer.observe(button.closest("fieldset") || button, { attributes: true, childList: true, characterData: true, subtree: true });
      }, { once: true });
    });
    const label = (await button.textContent()).trim();
    await button.click();
    await page.waitForFunction(() => window.__feedback !== null);
    const ms = await page.evaluate(() => window.__feedback);
    assert.ok(ms < 200, `Slow feedback: ${label} ${ms}`);
    result.feedback.push({ label, milliseconds: ms });
  }

  await go();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
    await go();
    assert.equal(await page.locator(".session-workspace").count(), 0, "No automatic side workspace");
    result.themes.push(await page.evaluate(() => { const s = getComputedStyle(document.body); return { theme: document.body.classList.contains("dark") ? "dark" : "light", font: s.fontFamily, canvas: s.backgroundColor, accent: s.getPropertyValue("--accent").trim() }; }));
    await screenshot(`floor-${theme}`);
    const cards = await page.locator(".lf-table-card").evaluateAll(cards => cards.map(card => {
      const s = getComputedStyle(card);
      return { state: card.dataset.tableState, background: s.backgroundColor, color: s.color, labels: [...card.querySelectorAll(".lf-card-actions button")].map(b => b.textContent.trim()), targets: [...card.querySelectorAll(".lf-card-actions button")].map(b => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })) };
    }));
    for (const entry of cards) for (const target of entry.targets) assert.ok(target.width >= 44 && target.height >= 44);
    result.cards.push({ theme, cards });
    await stateCard("available").getByRole("button", { name: "Start Session" }).click();
    const modal = page.getByRole("dialog", { name: "Start Session" });
    await modal.waitFor();
    assert.equal(await page.locator(".ui-drawer").count(), 0, "Start must not open drawer");
    const bounds = await modal.boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 720) < 2, "Modal centered");
    await screenshot(`start-${theme}`, false);
    await modal.getByRole("button", { name: "Cancel" }).click();
  }
  result.checks.push("Five real states, no auto-workspace, start is centered modal, both themes");
  await page.goto(app + "/live-floor?action=start");
  await page.waitForFunction(() => document.querySelector('.lf-new-session select')?.value === "t5");
  assert.ok(await page.getByRole("dialog", { name: "Start Session" }).getByRole("button", { name: "Start Session", exact: true }).isEnabled());
  await page.getByRole("dialog", { name: "Start Session" }).getByRole("button", { name: "Cancel" }).click();
  result.checks.push("Start deep-link with no table selects first available table after initial loading");

  for (const width of [375, 414]) {
    await page.setViewportSize({ width, height: 896 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
      await go();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const actions = page.locator(".lf-card-actions button:not(:disabled)");
      for (let i = 0; i < await actions.count(); i++) {
        await actions.nth(i).scrollIntoViewIfNeeded();
        const hit = await actions.nth(i).evaluate(button => { const r = button.getBoundingClientRect(); const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, unobscured: target === button || button.contains(target) }; });
        assert.ok(hit.width >= 44 && hit.height >= 44 && hit.unobscured, JSON.stringify(hit));
      }
      await screenshot(`mobile-${width}-${theme}`);
      await stateCard("available").getByRole("button", { name: "Start Session" }).click();
      const modal = page.getByRole("dialog", { name: "Start Session" });
      await modal.waitFor();
      const bounds = await modal.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 896);
      await screenshot(`mobile-start-${width}-${theme}`, false);
      await modal.getByRole("button", { name: "Cancel" }).click();
      result.mobile.push({ width, theme, overflow: 0, allActionTargets: "44px minimum; unobscured", modalBounds: bounds });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go();
  const running = stateCard("running");
  await feedback(running.getByRole("button", { name: "Pause", exact: true }), "**/sessions/pause/t1");
  await page.locator('.lf-table-card[data-table-state="paused"]').filter({ hasText: "QA State Running" }).waitFor();
  const paused = page.locator('.lf-table-card[data-table-state="paused"]').filter({ hasText: "QA State Running" });
  const frozen = await paused.locator(".table-state-timer").textContent();
  await page.waitForTimeout(1100);
  assert.equal(await paused.locator(".table-state-timer").textContent(), frozen);
  await feedback(paused.getByRole("button", { name: "Resume" }), "**/sessions/pause/t1");
  await stateCard("running").waitFor();
  assert.equal(await page.locator(".ui-drawer").count(), 0);
  result.checks.push("Pause/resume directly on card, timer freezes, no drawer");

  await page.route("**/sessions/pause/t1", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA temporary failure" }) }), { times: 1 });
  await stateCard("running").getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText(/Could not update session|unavailable|temporary failure/i).first().waitFor();
  await stateCard("running").getByRole("button", { name: "Pause", exact: true }).waitFor();
  assert.ok(await stateCard("running").getByRole("button", { name: "Pause", exact: true }).isEnabled());
  result.checks.push("Failed pause reports error, keeps running state, re-enables control");

  await request("POST", "/settings/menu", { name: "QA Inline Tea", price: 25, category: "Drinks" });
  await stateCard("running").getByRole("button", { name: "Food", exact: true }).click();
  await page.locator(".order-selector").getByRole("button", { name: /QA Inline Tea/ }).click();
  await feedback(page.getByRole("button", { name: "Add Food to Session" }), "**/sessions/t1/food");
  await page.locator(".lf-food-modal").waitFor({ state: "hidden" });
  const active = await request("GET", "/sessions/live-floor");
  assert.ok(active.floor.tables.find(t => t.id === "t1").session.food_items.some(i => i.item === "QA Inline Tea"));
  result.checks.push("Food opens directly from card and posts onto correct session");

  await stateCard("running").getByRole("button", { name: "End", exact: true }).click();
  await page.locator(".checkout-panel .checkout-summary-grid").waitFor();
  assert.equal(await page.locator(".lf-detail-drawer").count(), 0);
  await page.getByRole("button", { name: "Keep Table Open" }).click();
  assert.equal((await request("GET", "/sessions/active")).length, 2);
  await stateCard("running").getByRole("button", { name: "End", exact: true }).click();
  await page.locator(".checkout-panel .checkout-summary-grid").waitFor();
  await feedback(page.locator(".checkout-panel").getByRole("button", { name: /Close table/ }), "**/sessions/stop/t1**");
  await page.getByText("Payment Complete", { exact: true }).waitFor();
  await screenshot("receipt-dark");
  await page.getByRole("button", { name: "Close Receipt" }).click();
  result.checks.push("End opens checkout directly; cancel preserves session; confirmed payment saves receipt");

  await stateCard("reserved").getByRole("button", { name: "Check In" }).click();
  let modal = page.getByRole("dialog", { name: "Start Session" });
  assert.equal(await modal.getByLabel("Customer", { exact: true }).inputValue(), "QA State Reserved");
  await feedback(modal.getByRole("button", { name: "Start Session", exact: true }), "**/sessions/start");
  await modal.waitFor({ state: "hidden" });
  assert.ok((await request("GET", "/sessions/active")).some(s => s.table_id === "t3"));
  result.checks.push("Reserved Check In opens populated modal, starts correct table and completes matching booking");

  await request("POST", "/settings/tariffs", { frame_rates: { wr: 0, sr: 0, pr: 80 }, packages: [] });
  await go();
  await stateCard("available").filter({ hasText: "POOL" }).getByRole("button", { name: "Start Session" }).click();
  modal = page.getByRole("dialog", { name: "Start Session" });
  await modal.getByLabel("Customer", { exact: true }).fill("QA Inline Frame");
  await modal.getByLabel("Tariff", { exact: true }).selectOption("frame");
  await modal.getByRole("button", { name: "Start Session", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".lf-detail-drawer").count(), 0);
  const frameCard = page.locator(".lf-table-card").filter({ hasText: "QA Inline Frame" });
  await frameCard.getByRole("button", { name: "End", exact: true }).click();
  await page.getByText("Close the open frame before checkout.", { exact: true }).waitFor();
  assert.ok(await page.locator(".checkout-panel").getByRole("button", { name: /Close table/ }).isDisabled());
  await page.getByRole("button", { name: "Keep Table Open" }).click();
  await frameCard.locator(".lf-table-card-head strong").click();
  await page.getByRole("button", { name: "Complete Frame", exact: true }).click();
  await page.getByRole("button", { name: "Start Frame", exact: true }).waitFor();
  await page.locator(".lf-detail-drawer").getByRole("button", { name: "Close panel" }).click();
  assert.equal((await request("GET", "/sessions/quote/t5")).ply, 80);
  result.checks.push("Card body opens details; frame controls preserved; open-frame billing guard preserved");

  assert.equal(result.errors.length, 0, result.errors.join("\n"));
} finally {
  await browser.close();
  const cleanup = spawnSync("sqlite3", [database, "DELETE FROM session_frames; DELETE FROM active_sessions; DELETE FROM transactions; DELETE FROM closed_session_frames; DELETE FROM session_events; DELETE FROM members; DELETE FROM audit_logs; DELETE FROM table_maintenance WHERE reason='QA TABLE STATE AUDIT'; DELETE FROM bookings WHERE notes='QA TABLE STATE AUDIT'; DELETE FROM menu_items WHERE name='QA Inline Tea'; UPDATE settings SET tariffs_json='{}';"], { encoding: "utf8" });
  assert.equal(cleanup.status, 0, cleanup.stderr);
  await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));
