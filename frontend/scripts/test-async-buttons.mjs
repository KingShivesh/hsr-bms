import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext();
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5181/login");
    await page.evaluate(async () => {
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { createElement } = React;
      const { createRoot } = ReactDOM;
      const { default: Button, IconButton } = await import("/src/components/ui/Button.jsx");
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:10px;z-index:9999;background:var(--surface);padding:30px;display:flex;gap:20px;align-items:start";
      document.body.append(host);
      window.__buttonCalls = {}; window.__buttonResolvers = {};
      const make = name => () => {
        window.__buttonCalls[name] = (window.__buttonCalls[name] || 0) + 1;
        return new Promise(resolve => { window.__buttonResolvers[name] = resolve; });
      };
      createRoot(host).render(createElement("div", {},
        createElement(Button, { onClick: make("standard"), "data-testid": "standard" }, "Save a longer label"),
        createElement(Button, { native: true, onClick: make("native"), "data-testid": "native" }, "Native action"),
        createElement(IconButton, { onClick: make("icon"), "data-testid": "icon", label: "Retry", icon: "ti-refresh" }),
      ));
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
await fs.writeFile("../docs/perceived-speed/async-buttons.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
