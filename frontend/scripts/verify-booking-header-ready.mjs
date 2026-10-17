import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const phase = process.argv[2] || "after";
const origin = `http://127.0.0.1:${phase === "before" ? 5180 : 5181}`;
const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { phase };
try {
  const page = await browser.newPage();
  await page.addInitScript(auth => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, auth);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/BookingsPage-*.js", async route => { await gate; await route.continue(); });
  await page.goto(origin + "/bookings", { waitUntil: "domcontentloaded" });
  await page.locator(".cf-page-primary-action").click();
  report.urlAfterClick = page.url();
  report.visibleLoading = await page.locator(".page-skeleton").count() > 0;
  release(); await page.waitForTimeout(1000);
  const dialog = page.getByRole("dialog", { name: "Reserve a table" });
  report.dialogOpened = await dialog.isVisible();
  if (phase === "after") assert.equal(report.dialogOpened, true);
  await page.screenshot({ path: `../docs/interaction-polish/booking-header-${phase}.png` });
} finally { await browser.close(); await fs.writeFile(`../docs/interaction-polish/booking-header-${phase}.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
