import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.AUDIT_APP_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname)) throw new Error("Visual QA is local-only");
const phase = process.env.AUDIT_PHASE || "before";
const outputDir = path.resolve(process.cwd(), `../docs/table-state-audit/${phase}`);
const surfaces = [
  { key: "live-floor", route: "/live-floor", selector: ".lf-floor-panel" },
  { key: "dashboard", route: "/dashboard", selector: ".ops-floor-panel" },
  { key: "advanced-controls", route: "/legacy-table-controls", selector: ".advanced-table-controls-page", fullPage: true },
  { key: "reservations", route: "/bookings", selector: ".op2-board" },
  { key: "tournament", route: "/tournaments", selector: ".tournament-table-grid" },
];

async function login(page) {
  await page.goto(`${appUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("username-input").fill(process.env.AUDIT_USERNAME || "admin");
  await page.getByTestId("password-input").fill(process.env.AUDIT_PASSWORD || "admin123");
  await page.getByTestId("login-button").click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function setTheme(page, theme) {
  await page.evaluate((dark) => {
    localStorage.setItem("darkMode", String(dark));
    document.body.classList.toggle("dark", dark);
  }, theme === "dark");
}

async function captureSurface(page, surface, theme) {
  await setTheme(page, theme);
  await page.goto(`${appUrl}${surface.route}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((dark) => document.body.classList.toggle("dark", dark), theme === "dark");
  const target = page.locator(surface.selector).first();
  await target.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.fonts.ready);
  const screenshotPath = path.join(outputDir, `${surface.key}-${theme}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await login(page);
  for (const theme of ["light", "dark"]) {
    for (const surface of surfaces) {
      await captureSurface(page, surface, theme);
    }
  }

  await browser.close();
  console.log(outputDir);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
