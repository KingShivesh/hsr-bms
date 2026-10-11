import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const directory = process.env.PRESENTATION_PRODUCTION_OUTPUT || "../docs/presentation-polish/production";
const base = process.env.PRESENTATION_PRODUCTION_URL || "https://hsr-bms.vercel.app";
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { base, method: "Anonymous login only. No credentials entered, no login attempt, no mutation.", samples: [], violations: [], errors: [] };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(base + "/login");
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
        leadingIcons: [...document.querySelectorAll(".login-input-wrap")].map(wrapper => {
          const input = wrapper.querySelector("input");
          const icon = wrapper.querySelector(".ui-icon");
          const textStart = input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft);
          return { textStart, iconRight: icon.getBoundingClientRect().right, gap: textStart - icon.getBoundingClientRect().right };
        }),
      }));
      assert.ok(sample.bodyFont.includes("Syne"));
      assert.equal(sample.fontLoaded, true);
      assert.equal(sample.canvas, theme === "dark" ? "rgb(11, 11, 15)" : "rgb(250, 250, 250)");
      assert.equal(sample.titleSize, "24px");
      assert.equal(sample.overflow, 0);
      assert.ok(sample.leadingIcons.every(item => item.gap >= 8), "Field icon must not overlap placeholder/value text");
      sample.placeholderPixels = [];
      // Check neutral glyph paint as well as geometry; colored icon ink is excluded.
      for (const input of await page.locator(".login-input-wrap input").all()) {
        const style = await input.evaluate(node => ({ padding: parseFloat(getComputedStyle(node).paddingLeft), color: getComputedStyle(node, "::placeholder").color.match(/[\d.]+/g).slice(0,3).map(Number) }));
        const pixels = PNG.sync.read(await input.screenshot());
        let firstInk = pixels.width;
        for (let y = Math.ceil(pixels.height * 0.25); y < pixels.height * 0.75; y++) {
          for (let x = 3; x < pixels.width - 3; x++) {
            const offset = (y * pixels.width + x) * 4;
            if (style.color.every((channel, index) => Math.abs(pixels.data[offset + index] - channel) < 24)) firstInk = Math.min(firstInk, x);
          }
        }
        sample.placeholderPixels.push({ firstInk, expectedInset: style.padding });
        assert.ok(firstInk < pixels.width, "Placeholder glyph pixels must be present");
        assert.ok(firstInk >= style.padding - 2, "Rendered placeholder must honor the leading inset, not just computed style");
      }
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
