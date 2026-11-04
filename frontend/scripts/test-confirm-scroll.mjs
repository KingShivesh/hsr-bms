import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = process.env.UI_CONFIRM_OUTPUT || `../docs/deployment-ui-completion/confirmation-scroll/${stage}`;
await fs.mkdir(output, { recursive: true });
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
assert.ok(auth.token);
const report = { stage, scope: "Local read-only duplicate-member fixtures; all writes blocked", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 320 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin === api && url.pathname === "/members/duplicates") return handler.fulfill({ json: [{ primary: { id: "QA-PRIMARY", name: "QA long member name ".repeat(40), spent: 0 }, matches: [{ id: "QA-MATCH", name: "QA matching member ".repeat(40), spent: 0, score: 99 }] }] });
      if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      return handler.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const row = { theme, width, errors: [] };
    report.cases.push(row);
    page.on("pageerror", error => row.errors.push(error.message));
    try {
      await page.goto(app + "/customers");
      const trigger = page.getByRole("button", { name: "Merge Profiles", exact: true }).first();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Merge customers?", exact: true });
      await dialog.waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      row.measurements = await dialog.evaluate(node => {
        const box = node.getBoundingClientRect();
        const action = node.querySelector('button[aria-label="Merge Profiles"]');
        const r = action.getBoundingClientRect();
        const description = document.getElementById(node.getAttribute("aria-describedby"));
        const scroll = node.querySelector(".ui-overlay-body");
        const heading = node.querySelector("h2,h3").getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, right: box.right, actionTop: r.top, actionBottom: r.bottom, actionVisible: r.top >= 0 && r.bottom <= innerHeight && action.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), titleVisible: heading.top >= box.top && heading.bottom <= Math.min(box.bottom, innerHeight), described: description?.textContent.includes("Visits, spend and history will be combined."), bodyScrolls: !!scroll && scroll.scrollHeight > scroll.clientHeight, viewportHeight: innerHeight };
      });
      row.contrast = await scanRenderedContrast(page, { route: "/customers", theme, state: "long-confirm", minimumContrast: 4.5, includeDisabled: true });
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, animations: "disabled" });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      if (stage === "after") {
        assert.ok(row.measurements.actionVisible && row.measurements.titleVisible && row.measurements.bodyScrolls && row.measurements.described);
        assert.ok(row.measurements.top >= 0 && row.measurements.bottom <= 320 && row.measurements.right <= width);
        assert.equal(row.contrast.length, 0); assert.equal(row.errors.length, 0);
      }
    } catch (error) { row.error = error.message; await page.screenshot({ path: `${output}/${theme}-${width}-failure.png`, animations: "disabled" }).catch(() => {}); }
    finally { await context.close(); }
    console.log(JSON.stringify(row));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
assert.ok(report.cases.every(row => !row.error));
