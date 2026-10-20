import { chromium } from "playwright";
import fs from "node:fs/promises";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const appUrl = process.env.CONTRAST_APP_URL || "http://127.0.0.1:5173";
const apiUrl = process.env.CONTRAST_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:8000";
const source = await fs.readFile("src/App.jsx", "utf8");
const discoveredRoutes = [...new Set([...source.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map(m => m[1]).concat(JSON.parse(process.env.CONTRAST_EXTRA_ROUTES || "[]")))];
const onlyRoutes = JSON.parse(process.env.CONTRAST_ONLY_ROUTES || "null");
if (onlyRoutes && (!Array.isArray(onlyRoutes) || onlyRoutes.some(route => !discoveredRoutes.includes(route)))) throw new Error("Contrast route filter must contain reviewed routes");
const routes = onlyRoutes || discoveredRoutes;
const response = await fetch(apiUrl + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.CONTRAST_USERNAME || "admin", password: process.env.CONTRAST_PASSWORD || "admin123" }) });
if (!response.ok) throw new Error(`QA login failed: ${response.status}`);
const auth = await response.json();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { generatedAt: new Date().toISOString(), appUrl, apiUrl, routes, dynamicStatesIncluded: ["default (including login)", "login error and filled fields", "notification popover", "command palette", "first safe action"], method: "composited foreground/background, inputs, placeholders, ancestor opacity; rendered pixel samples for gradients/images; WCAG large text 24px or 18.66px bold; disabled controls exempt", violations: [], errors: [] };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ theme, auth }) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("darkMode", String(theme === "dark"));
      for (const key of ["token", "role", "username"]) {
        if (location.pathname === "/login") localStorage.removeItem(key);
        else localStorage.setItem(key, auth[key]);
      }
    }, { theme, auth });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", e => report.errors.push(e.message));
    page.on("requestfailed", r => { if (r.url().startsWith(apiUrl) && !r.url().includes("/events/stream") && r.failure()?.errorText !== "net::ERR_ABORTED") report.errors.push(`${r.url()}: ${r.failure()?.errorText}`); });
    for (const route of routes) {
      console.log(`Contrast: ${theme} ${route}`);
      await page.goto(appUrl + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
      if (route === "/live-floor") await page.locator(".lf-table-card").last().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const check = async state => {
        // A lazy route can mount its modal after the click wait; sample settled pixels.
        for (let pass = 0; pass < 2; pass++) await page.evaluate(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await Promise.all(document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        });
        report.violations.push(...await scanRenderedContrast(page, { theme, route, state }));
      };
      await check("default");
      if (route === "/login") {
        await page.route("**/auth/login", r => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "QA invalid credentials" }) }));
        await page.getByTestId("username-input").fill("QA invalid");
        await page.getByTestId("password-input").fill("QA invalid");
        await page.getByTestId("login-button").click();
        await page.getByText("Invalid username or password", { exact: true }).waitFor();
        await page.waitForTimeout(200);
        await check("login-error-and-filled-fields");
        await page.unroute("**/auth/login");
        continue;
      }
      const notification = page.getByRole("button", { name: /notification/i }).first();
      if (await notification.count()) {
        await notification.click(); await page.waitForTimeout(300); await check("notification-popover");
        await page.keyboard.press("Escape");
      }
      for (const label of ["Help", "User menu", "Club menu"]) {
        const trigger = page.getByRole("button", { name: label, exact: true });
        if (await trigger.count() && await trigger.isVisible()) {
          await trigger.click(); await page.getByRole("menu").waitFor();
          await check(`${label.toLowerCase().replaceAll(" ", "-")}-popover`);
          await page.keyboard.press("Escape");
        }
      }
      await page.keyboard.press("Meta+k");
      await page.waitForTimeout(200); await check("command-palette");
      await page.keyboard.press("Escape");
      const safe = page.getByRole("button", { name: /^(Start Table|New Booking|Add Customer|Add Walk-in|Advanced Controls|Review Close|Export Reports|Manage Inventory)$/i }).first();
      if (await safe.count() && await safe.isVisible() && await safe.isEnabled()) {
        await safe.click(); await page.waitForTimeout(300);
        await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await check("safe-action");
      }
    }
    await context.close();
  }
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  await browser.close();
  if (process.env.CONTRAST_REPORT_PATH) await fs.writeFile(process.env.CONTRAST_REPORT_PATH, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.violations.length || report.errors.length ? 2 : 0;
