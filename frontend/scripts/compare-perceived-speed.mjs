import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
const directory = path.resolve("../docs/perceived-speed/comparison");
await fs.mkdir(directory, { recursive: true });
const api = "http://127.0.0.1:8006";
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { baseline: "f535d69", delayMs: 800, rejection: 409, productionMutations: 0, results: [] };
try {
  for (const theme of ["light", "dark"]) for (const [phase, port] of [["before", 5182], ["after", 5181]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(({ theme, auth }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { theme, auth });
    const page = await context.newPage();
    await page.route(api + "/**", async route => {
      if (route.request().url().includes("/events/stream")) return route.fulfill({ status: 503, body: "Local comparison: polling only" });
      if (route.request().url().includes("/sessions/pause/t1")) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return route.fulfill({ status: 409, json: { detail: "QA comparison rollback" }, headers: { "Access-Control-Allow-Origin": `http://127.0.0.1:${port}` } });
      }
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": `http://127.0.0.1:${port}` } });
    });
    await page.goto(`http://127.0.0.1:${port}/live-floor`);
    const card = page.locator(".lf-table-card").first();
    await card.waitFor(); await page.waitForTimeout(1800);
    const button = card.getByRole("button", { name: /^(Pause|Resume)$/ });
    const initialState = await card.getAttribute("data-table-state");
    const action = (await button.innerText()).trim();
    await button.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
    await button.evaluate(button => {
      const card = button.closest(".lf-table-card");
      window.__comparison = { initialState: card.dataset.tableState, changes: [] };
      button.addEventListener("click", () => {
        const start = performance.now();
        const observer = new MutationObserver(() => window.__comparison.changes.push({ ms: performance.now() - start, busy: button.getAttribute("aria-busy"), disabled: button.disabled, state: card.dataset.tableState, spinner: !!button.querySelector(".ui-button-spinner") }));
        observer.observe(card, { attributes: true, childList: true, subtree: true, characterData: true });
        setTimeout(() => observer.disconnect(), 1300);
      }, { once: true, capture: true });
    });
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const pressed = await button.evaluate(button => ({ transform: getComputedStyle(button).transform, filter: getComputedStyle(button).filter, active: button.matches(":active") }));
    await page.mouse.up();
    await page.waitForTimeout(160);
    await page.mouse.move(5, 5);
    await card.screenshot({ path: path.join(directory, `${phase}-${theme}.png`), animations: "disabled" });
    await page.waitForTimeout(1100);
    report.results.push({ theme, phase, action, pressed, ...await page.evaluate(() => window.__comparison), rolledBack: await card.getAttribute("data-table-state") === initialState });
    await context.close();
  }
  const rows = [];
  for (const theme of ["light", "dark"]) {
    const images = [];
    for (const phase of ["before", "after"]) images.push(`<div><h2>${phase === "before" ? "Before" : "After"} · ${theme}</h2><img src="data:image/png;base64,${await fs.readFile(path.join(directory, `${phase}-${theme}.png`), "base64")}"/></div>`);
    rows.push(images.join(""));
  }
  const page = await browser.newPage({ viewport: { width: 1120, height: 810 } });
  await page.setContent(`<style>body{margin:0;padding:24px;background:#e9e9ed;color:#141419;font:14px system-ui}h1{font-size:22px}h2{font-size:16px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}img{width:100%;display:block}p{max-width:1000px}</style><h1>Same ${report.results[0].initialState} table, 160ms after ${report.results[0].action}</h1><p>Both requests intentionally take 800ms and then fail. Before: unchanged card. After: immediate requested state, pending cue and fixed-size spinner; rejection restores the original state. Same data, fonts and palette.</p><main>${rows.join("")}</main>`);
  await page.screenshot({ path: path.join(directory, "comparison.png"), fullPage: true });
} finally { await browser.close(); await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
