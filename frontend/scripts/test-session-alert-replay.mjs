import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) }).then(response => response.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const checks = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    let urgent = false;
    await page.route(api + "/sessions/alerts", route => route.fulfill({ json: { config: { soundEnabled: false }, owner_summaries: [], alerts: [{ id: urgent ? 100180 : 100060, session_key: "qa-replay", table_id: "t1", threshold_minutes: urgent ? 180 : 60, intensity: urgent ? "urgent" : "normal", paused: false, accrued_amount: 320 }] } }));
    await page.goto(app + "/live-floor");
    await page.getByText(/T1 — 60 min played/).waitFor();
    await page.reload();
    await page.locator(".lf-table-card").first().waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByText(/T1 — 60 min played/).count(), 0);
    await page.getByRole("button", { name: "Open notifications" }).click();
    assert.ok(await page.getByRole("button", { name: /T1 · 60m played/ }).isVisible());
    await page.keyboard.press("Escape");
    urgent = true;
    await page.evaluate(() => window.dispatchEvent(new Event("hsr:data-changed")));
    await page.getByText(/T1 — 180 min played/).waitFor();
    await page.reload();
    await page.getByText(/T1 — 180 min played/).waitFor();
    assert.equal(await page.getByText(/T1 — 180 min played/).count(), 1);
    checks.push({ theme, normalToastNotReplayed: true, unreadBellRetained: true, urgentRestoredOnce: true, actualBusinessWrites: 0 });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile("../docs/session-close-controls/alert-replay.json", JSON.stringify({ checks, fixture: "UI-only REST response, no server writes" }, null, 2));
console.log(JSON.stringify(checks));
