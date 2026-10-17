import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2] || "after";
const origin = phase === "before" ? "http://127.0.0.1:5180" : "http://127.0.0.1:5181";
const directory = path.resolve("../docs/interaction-polish", phase);
await fs.mkdir(directory, { recursive: true });
const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const source = await fs.readFile("src/App.jsx", "utf8");
const routes = [...new Set([...source.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map(row => row[1]))].filter(route => route !== "/");
routes.push(...["club", "team", "activity", "account", "billing"].map(section => `/settings?section=${section}`), "/missing-page");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { phase, screenshots: [], controls: [], errors: [] };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); if (location.pathname !== "/login") for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      const filename = `${name}-${theme}.png`;
      await page.screenshot({ path: path.join(directory, filename), animations: "disabled" });
      report.screenshots.push(filename);
    }
    for (const route of routes) {
      console.log(`${phase}: ${theme} ${route}`);
      await page.goto(origin + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      await page.waitForFunction(() => ![...document.querySelectorAll('.page-skeleton,.lf-skeleton,.ui-skeleton-stack,.ui-skeleton-grid')].some(node => node.getClientRects().length));
      for (const button of await page.getByRole("button", { name: "Dismiss", exact: true }).all()) if (await button.isVisible()) await button.click();
      await capture(route.replaceAll(/[/?=]/g, "-") || "home");
    }
    await page.goto(origin + "/settings");
    await page.getByRole("heading", { name: "Session reminders & time corrections" }).scrollIntoViewIfNeeded();
    await capture("settings-session-controls");
    await page.goto(origin + "/live-floor");
    await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
    const dialog = page.locator(".checkout-panel");
    await dialog.getByText("Payment method", { exact: true }).waitFor();
    await page.waitForTimeout(200);
    report.controls.push({ theme, ...await dialog.evaluate(node => {
      const summary = node.querySelector('.checkout-time-adjust summary,.checkout-adjust-toggle');
      const css = getComputedStyle(summary);
      return { header: node.querySelector('h2')?.textContent, adjust: { tag: summary.tagName, cursor: css.cursor, border: css.border, background: css.backgroundColor, height: summary.getBoundingClientRect().height }, width: node.getBoundingClientRect().width };
    }) });
    await dialog.getByText("Adjust Time", { exact: true }).click();
    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1100 : 896 });
      await dialog.getByText("Adjust Time", { exact: true }).scrollIntoViewIfNeeded();
      await capture(`checkout-adjust-${width}`);
      await dialog.getByText("Payment method", { exact: true }).scrollIntoViewIfNeeded();
      await capture(`checkout-payment-${width}`);
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ screenshots: report.screenshots.length, controls: report.controls, errors: report.errors }, null, 2));
if (report.errors.length) process.exitCode = 1;
