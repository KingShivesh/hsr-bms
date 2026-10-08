import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const phase = process.env.AUDIT_PHASE || "after";
if (!["before", "after"].includes(phase)) throw new Error("Unknown audit phase");
const api = "http://127.0.0.1:8002";
const app = "http://127.0.0.1:5175";
const db = "/tmp/hsr-session-browser.db";
const directory = path.resolve("../docs/session-engine-audit", phase);
await fs.mkdir(directory, { recursive: true });
let token = "";
async function request(method, route, body) {
  const response = await fetch(api + route, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}
function sql(query) {
  const result = spawnSync("sqlite3", [db, query], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

const auth = await request("POST", "/auth/login", { username: "admin", password: "admin123" });
token = auth.token;
if ((await request("GET", "/sessions/active")).length) throw new Error("Disposable QA DB must have no active sessions");
const ruleBody = { start_hour: 0, end_hour: 24, multiplier: 1.5, label: "QA Session Engine Peak" };
await request("POST", "/operations/peak-hours", ruleBody);
const rule = (await request("GET", "/operations/peak-hours")).find(row => row.label === ruleBody.label);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const result = { phase, themes: [], mutations: [], requestErrors: [] };
try {
  await request("POST", "/sessions/start", { table_id: "t1", customer_name: "QA Engine Browser", rate: 320 });
  const started = Date.now() - 45 * 60_000;
  const columns = sql("PRAGMA table_info(active_sessions)");
  sql(`UPDATE active_sessions SET start_time=${started}${columns.includes("|started_at|") ? `, started_at=${started}` : ""} WHERE customer_name='QA Engine Browser'`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(auth => {
    localStorage.setItem("token", auth.token);
    localStorage.setItem("role", auth.role);
    localStorage.setItem("username", auth.username);
  }, auth);
  page.on("pageerror", error => result.requestErrors.push(error.message));
  await page.goto(`${app}/live-floor?table=t1`, { waitUntil: "domcontentloaded" });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await pause.waitFor({ state: "visible" });
  await page.route("**/sessions/pause/t1", async route => {
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  }, { times: 1 });
  await pause.evaluate(button => {
    window.__pauseFeedback = {};
    button.addEventListener("pointerdown", () => {
      window.__pauseFeedback.clickedAt = performance.now();
    }, { once: true });
    const observer = new MutationObserver(() => {
      if (button.disabled && button.textContent.includes("Working")) {
        window.__pauseFeedback.loadingFeedbackMs = performance.now() - window.__pauseFeedback.clickedAt;
        observer.disconnect();
      }
    });
    observer.observe(button, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  });
  const pauseStarted = Date.now();
  await pause.click();
  await page.getByRole("button", { name: "Working...", exact: true }).waitFor({ state: "visible" });
  const loadingFeedbackMs = await page.evaluate(() => window.__pauseFeedback.loadingFeedbackMs);
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ state: "visible" });
  result.mutations.push({ action: "pause via UI", loadingFeedbackMs, completionMs: Date.now() - pauseStarted });
  if (!Number.isFinite(loadingFeedbackMs) || loadingFeedbackMs > 200) throw new Error("Pause had no immediate loading feedback");
  sql("UPDATE active_sessions SET elapsed_ms=2700000 WHERE customer_name='QA Engine Browser'");
  const agreed = await request("GET", "/sessions/quote/t1");
  await request("PUT", `/operations/peak-hours/${rule.id}`, { ...ruleBody, multiplier: 0.5 });
  const changed = await request("GET", "/sessions/quote/t1");
  result.rate = { agreedPlay: agreed.ply, afterRuleEditPlay: changed.ply, pausedMinutes: changed.dur };
  if (phase === "after" && (agreed.ply !== 360 || changed.ply !== agreed.ply)) throw new Error("Rate snapshot changed");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("darkMode", String(theme === "dark")), theme);
    await page.goto(`${app}/live-floor?table=t1`, { waitUntil: "domcontentloaded" });
    await page.locator(".lf-table-card").first().waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(directory, `floor-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Open Checkout", exact: true }).click();
    await page.locator(".checkout-panel").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(directory, `checkout-${theme}.png`) });
    result.themes.push(await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { theme: document.body.classList.contains("dark") ? "dark" : "light", font: s.fontFamily,
        canvas: s.backgroundColor, accent: s.getPropertyValue("--accent").trim() };
    }));
  }
  await page.goto(`${app}/live-floor?table=t1`, { waitUntil: "domcontentloaded" });
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await resume.waitFor({ state: "visible" });
  await resume.click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor({ state: "visible" });
  const resumed = await request("GET", "/sessions/quote/t1");
  result.timeline = { originalStartedAt: started, reportedStartedAt: resumed.session_started_at };
  if (phase === "after" && resumed.session_started_at !== started) throw new Error("Original start changed after resume");
  if (result.requestErrors.length) throw new Error("Browser errors detected");
} finally {
  await browser.close();
  await request("POST", "/sessions/reset/t1", { pin: "1234" }).catch(() => {});
  await request("DELETE", `/operations/peak-hours/${rule.id}`).catch(() => {});
  // The entire fixture database is disposable; cleanup includes its historical QA rows.
  sql("DELETE FROM active_sessions; DELETE FROM peak_hour_rates; DELETE FROM session_events; DELETE FROM audit_logs;");
  result.qaResidue = Number(sql("SELECT COUNT(*) FROM active_sessions WHERE customer_name LIKE 'QA %'"));
  await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));
