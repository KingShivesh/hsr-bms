import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
const app = process.env.ASYNC_BUTTON_APP_URL || "http://127.0.0.1:5181";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(app).hostname), "Local QA only");
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext();
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    await page.goto(app + "/login");
    await page.evaluate(async () => {
      const fixture = await import("/scripts/feedback-fixtures.jsx");
      fixture.mountAsyncButtonsFixture();
    });
    for (const name of ["standard", "native", "icon"]) {
      const button = page.getByTestId(name);
      await button.waitFor();
      const before = await button.boundingBox();
      await button.evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(name => document.querySelector(`[data-testid="${name}"]`).getAttribute("aria-busy") === "true", name);
      assert.equal(await page.evaluate(name => window.__buttonCalls[name], name), 1);
      assert.ok(await button.isDisabled());
      const after = await button.boundingBox();
      assert.equal(before.width, after.width); assert.equal(before.height, after.height);
      assert.equal(await button.locator(".ui-button-spinner").count(), 1);
      await page.evaluate(name => window.__buttonResolvers[name](), name);
      await page.waitForFunction(name => !document.querySelector(`[data-testid="${name}"]`).disabled, name);
      results.push({ theme, name, duplicateClicks: 2, calls: 1, spinner: true, dimensionShiftPx: 0 });
    }
    const button = page.getByTestId("native");
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    const pressed = await button.evaluate(button => ({ active: button.matches(":active"), filter: getComputedStyle(button).filter }));
    assert.ok(pressed.active); assert.equal(pressed.filter, "brightness(0.94)");
    results.push({ theme, name: "pointerdown CSS feedback before click", ...pressed });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(process.env.ASYNC_BUTTON_REPORT_PATH || "../docs/perceived-speed/async-buttons.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
