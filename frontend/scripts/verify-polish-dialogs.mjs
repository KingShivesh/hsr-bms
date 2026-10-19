import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";
const output = process.env.DIALOG_OUTPUT_DIR || "../docs/interaction-polish/dialogs";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { checks: [], contrast: [], errors: [] };
try {
  for (const theme of ["dark", "light"]) for (const phase of process.env.DIALOG_STAGES?.split(",") || ["before", "after"]) {
    const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    const origin = `http://127.0.0.1:${phase === "before" ? 5180 : 5181}`;
    console.log(`${phase} ${theme}: settings`);
    await page.goto(origin + "/settings");
    const settings = page.locator("section.settings-panel").filter({ has: page.getByRole("heading", { name: "Session reminders & time corrections" }) });
    await settings.getByRole("button", { name: "Save Session Controls" }).waitFor();
    await settings.screenshot({ path: `${output}/settings-${phase}-${theme}.png` });
    if (phase === "after") {
      const toggle = settings.getByRole("switch", { name: "Staff may edit time", exact: true });
      const start = await toggle.isChecked();
      const beforeTransform = await toggle.evaluate(node => getComputedStyle(node.nextElementSibling.firstElementChild).transform);
      await toggle.setChecked(!start); await page.waitForTimeout(150);
      const transform = await toggle.evaluate(node => getComputedStyle(node.nextElementSibling.firstElementChild).transform);
      assert.notEqual(transform, beforeTransform);
      assert.equal(await toggle.isChecked(), !start); await toggle.setChecked(start);
      report.checks.push({ phase, theme, switchChangesPosition: true, beforeTransform, transform, trustedStaffSettingUnchanged: true, savedToBackend: false });
    }
    for (const [name, route, open] of [
      ["booking", "/bookings", () => page.getByRole("button", { name: "New Booking", exact: true }).first().click()],
      ["inventory", "/inventory", () => page.getByRole("button", { name: "Add Menu Item", exact: true }).click()],
      ["history", "/legacy-table-controls", () => page.getByRole("button", { name: "Open T1 history", exact: true }).click()],
      ["reset", "/legacy-table-controls", () => page.getByTestId("reset-t1").click()],
      ["cigarette-price", "/cafe-pos", async () => {
        await page.route("**/settings/menu", async route => { const response = await route.fetch(); const menu = await response.json(); menu["QA Cigarette"] = { price: 20, category: "Cigarettes", available: true }; await route.fulfill({ response, json: menu }); });
        await page.reload(); await page.getByRole("button", { name: /QA Cigarette/ }).click();
      }],
    ].filter(([name]) => !process.env.DIALOG_NAMES || process.env.DIALOG_NAMES.split(",").includes(name))) {
      console.log(`${phase} ${theme}: ${name}`);
      await page.goto(origin + route);
      await page.waitForFunction(() => !document.querySelector('.page-skeleton,.lf-skeleton,.ui-skeleton-stack,.ui-skeleton-grid'));
      await open();
      const dialog = name === "history" && phase === "before" ? page.locator(".table-history-modal") : page.getByRole("dialog", { name: name === "reset" && phase === "after" ? "Reset T1" : undefined }).last();
      await dialog.waitFor(); await page.waitForTimeout(200);
      await dialog.screenshot({ path: `${output}/${name}-${phase}-${theme}.png` });
      for (const width of process.env.DIALOG_WIDTHS?.split(",").map(Number) || [1440]) {
        await page.setViewportSize({width,height:width===375?844:1000});
        await page.waitForTimeout(100);
        const metrics = await page.evaluate(measureUi), box = await dialog.boundingBox();
        await page.screenshot({path:`${output}/${name}-${phase}-${theme}-${width}.png`,animations:"disabled"});
        report.checks.push({phase,theme,name,width,...metrics,withinViewport:box.x>=0&&box.y>=0&&box.width<=width+1&&box.height<=(width===375?844:1000)+1});
        if (phase === "after") {
          assert.equal(metrics.overflow,0);assert.equal(metrics.shortTargets.length,0);assert.equal(metrics.unlabeledInputs.length,0);assert.equal(metrics.contentOverflow.length,0);
          assert.ok(box.x>=0&&box.y>=0&&box.width<=width+1&&box.height<=(width===375?844:1000)+1);
          report.contrast.push(...await scanRenderedContrast(page,{route,theme,state:`${name}-${width}`}));
        }
      }
      if (phase === "after") {
        const controls = dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),textarea:visible:not(:disabled)');
        await controls.last().focus(); await page.keyboard.press("Tab");
        assert.ok(await controls.first().evaluate(node => document.activeElement === node), `${name}: forward trap`);
        await page.keyboard.press("Shift+Tab");
        assert.ok(await controls.last().evaluate(node => document.activeElement === node), `${name}: reverse trap`);
        report.contrast.push(...await scanRenderedContrast(page, { route, theme, state: name + "-dialog" }));
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        report.checks.push({ phase, theme, name, forwardTrap: true, reverseTrap: true, escapeCloses: true });
      }
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
assert.equal(report.contrast.length, 0, JSON.stringify(report.contrast));
console.log(JSON.stringify(report, null, 2));
