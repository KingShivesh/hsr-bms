import { chromium } from "playwright";
import fs from "node:fs/promises";

const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  const page = await browser.newPage();
  await page.addInitScript(auth => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, auth);
  for (const route of ["/legacy-table-controls", "/cafe-pos", "/tournaments", "/daily-closing", "/analytics", "/pricing-rules", "/inventory", "/audit-log"]) {
    await page.goto("http://127.0.0.1:5180" + route);
    const button = page.locator(".cf-page-primary-action");
    await button.waitFor(); await page.waitForTimeout(500);
    const label = await button.innerText();
    const result = await page.evaluate(() => {
      window.actionAudit = { mutations: 0, requests: [] };
      const content = document.querySelector(".route-page");
      window.auditObserver = new MutationObserver(() => window.actionAudit.mutations++);
      if (content) window.auditObserver.observe(content, { subtree: true, childList: true, attributes: true });
      return { url: location.href, focus: document.activeElement?.outerHTML?.slice(0, 100) };
    });
    const requests = [];
    const listener = request => { if (request.url().startsWith("http://127.0.0.1:8006") && !/events|health/.test(request.url())) requests.push(request.url()); };
    page.on("request", listener);
    await button.click(); await page.waitForTimeout(220);
    const after = await page.evaluate(() => { window.auditObserver.disconnect(); return { url: location.href, mutations: window.actionAudit.mutations, dialog: !!document.querySelector('[role="dialog"]') }; });
    page.off("request", listener);
    results.push({ route, label, ...after, urlChanged: after.url !== result.url, requests });
  }
} finally { await browser.close(); }
await fs.writeFile("../docs/interaction-polish/header-actions-before.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
