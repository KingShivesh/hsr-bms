import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const app = process.env.AUDIT_APP_URL || "http://127.0.0.1:5178";
const api = process.env.AUDIT_API_URL || "http://127.0.0.1:8003";
assert.ok([app, api].every(url => ["localhost", "127.0.0.1"].includes(new URL(url).hostname)));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark"]) {
    const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
    assert.ok(response.ok);
    const auth = await response.json();
    const context = await browser.newContext();
    await context.addInitScript(({ theme, auth }) => { localStorage.setItem("theme", theme); if (location.pathname !== "/login") for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { theme, auth });
    const page = await context.newPage();
    await page.goto(app + "/dashboard");
    await page.getByRole("button", { name: "Logout", exact: true }).waitFor();
    const pattern = "**/auth/logout";
    await page.route(pattern, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"QA outage"}' }));
    await page.getByRole("button", { name: "Logout", exact: true }).click();
    await page.getByRole("dialog", { name: "Log out?" }).getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByRole("dialog", { name: "Could not log out securely" }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), auth.token);
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
    await page.unroute(pattern);
    await page.getByRole("button", { name: "Logout", exact: true }).click();
    await page.getByRole("dialog", { name: "Log out?" }).getByRole("button", { name: "Log out", exact: true }).click();
    await page.waitForURL("**/login");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /sign in/i }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), null);
    const oldToken = await fetch(api + "/auth/me", { headers: { Authorization: `Bearer ${auth.token}` } });
    assert.equal(oldToken.status, 401);
    results.push({ theme, networkFailureVisible: true, sessionPreservedOnFailure: true, successfulLogoutNavigatedToLogin: true, oldTokenStatus: 401 });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile("../docs/full-stack-audit/logout-browser.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
