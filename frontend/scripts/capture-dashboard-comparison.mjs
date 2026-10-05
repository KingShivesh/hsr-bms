import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const outputDir = path.resolve(process.cwd(), "../docs/visual-audit");
const appUrl = process.env.AUDIT_APP_URL || "http://127.0.0.1:5173";

async function capture(page, url, filename, readySelector) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (readySelector) await page.locator(readySelector).first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: false });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  if (!process.env.CAPTURE_HSR_AFTER) {
    await capture(page, "https://preview.tabler.io/?theme=light", "tabler-overview.png", ".page-wrapper");
    await capture(page, "https://preview.tabler.io/datatables.html?theme=light", "tabler-datatables.png", ".page-wrapper");
  }

  await page.goto(`${appUrl}/login`);
  await page.getByTestId("username-input").fill("admin");
  await page.getByTestId("password-input").fill("admin123");
  await page.getByTestId("login-button").click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.evaluate(() => localStorage.setItem("darkMode", "true"));

  if (process.env.CAPTURE_HSR_AFTER) {
    await capture(page, `${appUrl}/dashboard`, "hsr-dashboard-after.png", ".ops-dashboard");
    for (const width of [375, 414]) {
      await page.setViewportSize({ width, height: 900 });
      await capture(page, `${appUrl}/dashboard`, `hsr-dashboard-after-${width}.png`, ".ops-dashboard");
    }
  } else {
    await capture(page, `${appUrl}/dashboard`, "hsr-dashboard-before.png", ".ops-dashboard");
    await capture(page, `${appUrl}/live-floor`, "hsr-live-floor.png", ".live-floor-page");
  }

  await browser.close();
  console.log(outputDir);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
