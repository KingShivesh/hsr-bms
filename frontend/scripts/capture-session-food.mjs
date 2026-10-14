import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const stage = process.env.SESSION_FOOD_STAGE || "after";
const directory = path.resolve(`../docs/session-food-credit/${stage}`);
await fs.mkdir(directory, { recursive: true });
const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) }).then(r => r.json());
assert.ok(auth.token);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const measurements = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5181/live-floor");
    await page.locator(".lf-table-card").first().waitFor();
    async function capture(name, width) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.evaluate(() => document.fonts.ready);
      const row = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), font: getComputedStyle(document.body).fontFamily, accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(), controls: [...document.querySelectorAll('[role="dialog"] button')].filter(n => n.getClientRects().length).map(n => ({ text: n.textContent.trim(), height: n.getBoundingClientRect().height })) }));
      assert.equal(row.overflow, 0);
      const file = `${name}-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(directory, file), animations: "disabled" });
      measurements.push({ stage, theme, width, name, file, ...row });
    }
    for (const width of [1440, 375, 414]) await capture("floor", width);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
    await page.getByText("Payment method", { exact: true }).waitFor();
    await page.getByRole("button", { name: stage === "before" ? "Add phone for receipt" : "Add name", exact: true }).click();
    for (const width of [1440, 375, 414]) await capture("checkout", width);
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(measurements, null, 2)); }
console.log(JSON.stringify({ stage, screenshots: measurements.length, maxOverflow: Math.max(...measurements.map(r => r.overflow)) }));
