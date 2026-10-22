import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = `../docs/deployment-ui-completion/live-floor/rate-role-${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], writes: [], scope: "Guarded local QA; only before-phase Staff rate submission allowed to reproduce rejection; all other business writes blocked" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const username of ["admin", "staff"]) for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: username === "staff" ? "staff123" : "admin123" }) }).then(r => r.json());
    const headers = { Authorization: `Bearer ${auth.token}` };
    const before = await fetch(api + "/settings/rates", { headers }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return route.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.writes.push({ username, method: request.method(), path: url.pathname });
        if (!(stage === "before" && username === "staff" && request.method() === "POST" && url.pathname === "/settings/rates")) return route.abort("blockedbyclient");
      }
      if (url.pathname === "/sessions/alerts") return route.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      return route.continue();
    });
    const page = await context.newPage();
    const result = { username, theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/live-floor");
      const table = page.locator(".lf-table-card").nth(2);
      await table.waitFor();
      const edit = table.locator(".lf-inline-rate");
      result.editableRateButtons = await edit.count();
      if (await edit.count()) {
        await edit.scrollIntoViewIfNeeded();
        result.appearance = await edit.evaluate(node => ({ border: getComputedStyle(node).borderTopWidth, background: getComputedStyle(node).backgroundColor, height: node.getBoundingClientRect().height, pencil: !!node.querySelector("svg") }));
        await page.screenshot({ path: `${output}/${username}-${theme}-${width}-rate.png`, animations: "disabled" });
        await edit.click();
        const input = table.getByLabel("Hourly rate for T3", { exact: true });
        await input.waitFor();
        if (username === "staff" && stage === "before") {
          const rejected = page.waitForResponse(r => r.url() === api + "/settings/rates" && r.request().method() === "POST");
          await input.fill(String(Number(before.sr) + 1));
          await input.press("Enter");
          const response = await rejected;
          result.response = { status: response.status(), body: await response.json() };
          assert.equal(response.status(), 403);
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${output}/${username}-${theme}-${width}-rejected.png`, animations: "disabled" });
        } else {
          await input.press("Escape");
          await input.waitFor({ state: "hidden" });
          result.ownerEditAndCancel = true;
        }
      } else await page.screenshot({ path: `${output}/${username}-${theme}-${width}-readonly.png`, animations: "disabled" });
      const after = await fetch(api + "/settings/rates", { headers }).then(r => r.json());
      assert.deepEqual(after, before);
      result.ratesUnchanged = true;
      if (stage === "after") {
        assert.equal(result.editableRateButtons, username === "admin" ? 1 : 0);
        if (username === "admin") assert.ok(parseFloat(result.appearance.border) >= 1 && result.appearance.pencil && result.appearance.height >= 44);
      }
    } catch (error) { result.error = error.message; }
    finally { await context.close(); }
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.ok(report.cases.every(row => !row.error));
