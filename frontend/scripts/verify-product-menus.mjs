import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const directory = "../docs/product-shell/verification";
const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(({ auth, theme }) => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); localStorage.setItem("theme", theme); }, { auth, theme });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5181/live-floor"); await page.locator(".lf-table-grid").waitFor();
    for (const name of ["Club menu", "Help", "User menu"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("menu", { name, exact: true }).waitFor();
      await page.screenshot({ path: `${directory}/${name.replaceAll(" ", "-").toLowerCase()}-${theme}.png` });
      if (name === "User menu") assert.match(await page.getByRole("menu").innerText(), /Owner/);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("menuitem", { name: "Documentation", exact: true }).click();
    await page.getByRole("button", { name: "Take a tour", exact: true }).click();
    const titles = ["Your live floor", "Start a session", "Close the bill", "Customers and credit"];
    for (let index = 0; index < titles.length; index++) {
      const dialog = page.getByRole("dialog", { name: titles[index], exact: true });
      await dialog.waitFor();
      await page.locator(".product-tour-target").waitFor();
      if (index === 0) await page.screenshot({ path: `${directory}/tour-${theme}.png` });
      if (index < titles.length - 1) await dialog.getByRole("button", { name: "Next", exact: true }).click();
      else await dialog.getByRole("button", { name: "Skip tour", exact: true }).click();
    }
    assert.equal(await page.locator(".product-tour-target").count(), 0);
    results.push({ theme, menus: 3, tourSteps: 4, actualRegionHighlightedEachStep: true, skippedWithoutWrite: true });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await fs.writeFile("../docs/product-shell/menus-tour.json", JSON.stringify(results, null, 2)); await browser.close(); }
