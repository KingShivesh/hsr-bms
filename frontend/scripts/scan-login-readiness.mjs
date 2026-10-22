import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const stage = process.argv[2] || "after", origin = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
const output = process.env.UI_OUTPUT_DIR || `../docs/ui-readiness/login/${stage}`;
const strict = process.env.UI_STRICT_PILOT === "true";
await fs.mkdir(output, { recursive: true });
const report = { stage, samples: [], errors: [], productionWrites: 0 };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(e.message));
    for (const width of process.env.UI_WIDTHS?.split(",").map(Number) || [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 375 ? 844 : 1000 });
      await page.goto(origin + "/login");
      await page.getByTestId("login-button").waitFor(); await page.evaluate(() => document.fonts.ready);
      async function capture(state) {
        await page.mouse.move(0, 0);
        await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.getAnimations().filter(a => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
        const metrics = await page.evaluate(measureUi, { minimumTextSize: strict ? 12 : 0 });
        const contrast = await scanRenderedContrast(page, { route: "/login", theme, state, ...(strict ? { minimumContrast: 4.5, includeDisabled: true } : {}) });
        const file = `${theme}-${width}-${state}.png`;
        await page.screenshot({ path: `${output}/${file}`, fullPage: true, animations: "disabled" });
        report.samples.push({ theme, width, state, file, ...metrics, contrast });
      }
      await capture("default");
      await page.getByTestId("username-input").fill("QA invalid username");
      await page.getByTestId("password-input").fill("QA invalid password");
      await capture("filled");
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route("**/auth/login", async route => { await gate; await route.fulfill({ status: 401, json: { detail: "QA invalid credentials" } }); });
      await page.getByTestId("login-button").click();
      await page.getByTestId("login-button").locator(".ui-button-spinner").waitFor();
      await capture("pending"); release();
      await page.locator("#login-error,.login-box .error-message").waitFor();
      await capture("error");
      const errorFields = await page.getByTestId("username-input").getAttribute("aria-invalid");
      report.samples.at(-1).errorFieldsMarked = errorFields === "true";
      await page.unroute("**/auth/login");
      for (const failure of ["server-error", "offline"]) {
        await page.route("**/auth/login", route => failure === "offline" ? route.abort("internetdisconnected") : route.fulfill({ status: 500, json: { detail: "QA upstream failure" } }));
        await page.getByTestId("login-button").click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="login-button"]').disabled);
        await capture(failure);
        if (stage === "after") assert.doesNotMatch(await page.locator("#login-error").innerText(), /VITE_|Render logs|stack trace/);
        await page.unroute("**/auth/login");
      }
      console.log(`${stage} login ${theme} ${width}`);
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
const faults = report.samples.filter(row => row.overflow || row.smallText.length || row.shortTargets.length || row.invalidCopy.length || row.brokenImages.length || row.unlabeledButtons.length || row.contrast.length || (row.state === "error" && !row.errorFieldsMarked));
console.log(JSON.stringify({ stage, samples: report.samples.length, faults: faults.map(({theme,width,state,overflow,shortTargets,contrast,errorFieldsMarked}) => ({theme,width,state,overflow,shortTargets,contrast,errorFieldsMarked})), errors: report.errors }, null, 2));
if (stage === "after") { assert.equal(faults.length, 0); assert.equal(report.errors.length, 0); }
