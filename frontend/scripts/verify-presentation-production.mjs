import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const directory = "../docs/presentation-polish/production";
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { method: "Anonymous production login only. No credentials entered, no login attempt, no mutation.", samples: [], violations: [], errors: [] };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto("https://hsr-bms.vercel.app/login");
    await page.getByTestId("login-button").waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      const sample = await page.evaluate(() => ({
        bodyFont: getComputedStyle(document.body).fontFamily,
        canvas: getComputedStyle(document.body).backgroundColor,
        fontLoaded: [...document.fonts].some(font => font.family.includes("Syne") && font.status === "loaded"),
        titleSize: getComputedStyle(document.querySelector("h1")).fontSize,
        buttonHeight: document.querySelector('[data-testid="login-button"]').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }));
      assert.ok(sample.bodyFont.includes("Syne"));
      assert.equal(sample.fontLoaded, true);
      assert.equal(sample.canvas, theme === "dark" ? "rgb(11, 11, 15)" : "rgb(250, 250, 250)");
      assert.equal(sample.titleSize, "24px");
      assert.equal(sample.overflow, 0);
      if (width < 760) assert.ok(sample.buttonHeight >= 44);
      report.samples.push({ theme, width, ...sample });
      await page.screenshot({ path: `${directory}/login-${theme}-${width}.png` });
      report.violations.push(...await scanRenderedContrast(page, { route: "/login", theme, state: `production-${width}` }));
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${directory}/measurements.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.violations.length, 0);
assert.equal(report.errors.length, 0);
console.log(JSON.stringify(report));
