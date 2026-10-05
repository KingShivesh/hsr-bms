import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.AUDIT_APP_URL || "http://127.0.0.1:5173";
const outputPath = process.env.AUDIT_OUTPUT || "/tmp/hsr-button-feedback.json";
const defaultRoutes = [
  "/dashboard",
  "/live-floor",
  "/inventory",
  "/bookings",
  "/customers",
  "/sales",
  "/analytics",
  "/cafe-pos",
  "/waitlist",
  "/legacy-table-controls",
  "/tournaments",
  "/daily-closing",
  "/pricing-rules",
  "/audit-log",
  "/settings",
];
const routes = process.env.AUDIT_ROUTES
  ? process.env.AUDIT_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
  : defaultRoutes;
const labelPattern = process.env.AUDIT_MATCH ? new RegExp(process.env.AUDIT_MATCH, "i") : null;

const SKIP_LABELS = new Set(["Logout", "Print", "Print register", "Print Register"]);
const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
const hash = (value) => createHash("sha1").update(value).digest("hex");

async function buttonState(button) {
  return button.evaluate((element) => ({
    text: (element.innerText || element.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
    className: element.className,
    disabled: element.disabled,
    expanded: element.getAttribute("aria-expanded"),
    pressed: element.getAttribute("aria-pressed"),
  }));
}

async function pageState(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    dialogs: document.querySelectorAll('[role="dialog"], .modal-backdrop, .cf-modal-backdrop, .confirm-dialog-backdrop').length,
    toasts: Array.from(document.querySelectorAll('[role="alert"], .toast, .app-toast'))
      .map((element) => element.textContent.trim())
      .filter(Boolean),
    selected: document.querySelectorAll('.active, .is-active, .is-selected, [aria-selected="true"]').length,
    controls: document.querySelectorAll("input, select, textarea").length,
  }));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let delayRequests = false;

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (delayRequests && /127\.0\.0\.1:8000/.test(request.url()) && !request.url().includes("/events/stream")) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  await page.goto(`${appUrl}/login`);
  await page.getByTestId("username-input").fill("admin");
  await page.getByTestId("password-input").fill("admin123");
  await page.getByTestId("login-button").click();
  await page.waitForURL((url) => url.pathname !== "/login");

  const inventory = {};
  for (const route of routes) {
    await page.goto(`${appUrl}${route}`);
    await page.waitForTimeout(350);
    inventory[route] = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.map((button, index) => ({
        index,
        label: (button.getAttribute("aria-label") || button.innerText || button.title || "").trim().replace(/\s+/g, " "),
        className: button.className,
        disabled: button.disabled,
      })),
    );
  }

  const results = [];
  for (const route of routes) {
    const buttons = inventory[route];
    const occurrences = new Map();
    for (const descriptor of buttons) {
      if (descriptor.disabled || SKIP_LABELS.has(descriptor.label)) continue;
      if (labelPattern && !labelPattern.test(descriptor.label)) continue;
      const sharedNavigation = descriptor.className.includes("sb-item") || descriptor.className.includes("cf-collapse-btn");
      if (sharedNavigation && route !== "/dashboard") continue;

      await page.goto(`${appUrl}${route}`);
      await page.waitForTimeout(350);
      const occurrence = occurrences.get(descriptor.label) || 0;
      occurrences.set(descriptor.label, occurrence + 1);
      const button = page.getByRole("button", { name: descriptor.label, exact: true }).nth(occurrence);
      if (!(await button.isVisible().catch(() => false))) {
        results.push({ route, label: descriptor.label, status: "missing-on-reset", signals: [] });
        continue;
      }

      const before = await pageState(page);
      const beforeButton = await buttonState(button);
      const beforeShot = await button.screenshot().catch(() => null);
      let pressChanged = false;
      let clickError = "";

      try {
        const box = await button.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(60);
          const pressedShot = await button.screenshot().catch(() => null);
          pressChanged = Boolean(beforeShot && pressedShot && hash(beforeShot) !== hash(pressedShot));
          delayRequests = true;
          await page.mouse.up();
        } else {
          delayRequests = true;
          await button.click({ timeout: 2500 });
        }
      } catch (error) {
        clickError = String(error).slice(0, 180);
        await page.mouse.up().catch(() => {});
      }

      await page.waitForTimeout(190);
      const after = await pageState(page);
      const afterButton = await buttonState(button).catch(() => null);
      delayRequests = false;

      const signals = [];
      if (pressChanged) signals.push("press-feedback");
      if (before.path !== after.path) signals.push("navigation");
      if (before.dialogs !== after.dialogs) signals.push("dialog");
      if (before.controls !== after.controls) signals.push("form");
      if (before.selected !== after.selected) signals.push("selection");
      if (after.toasts.join("|") !== before.toasts.join("|") && after.toasts.length) signals.push("toast");
      if (afterButton && JSON.stringify(beforeButton) !== JSON.stringify(afterButton)) signals.push("button-state");

      results.push({
        route,
        label: descriptor.label,
        className: descriptor.className,
        status: clickError ? "click-error" : signals.length ? "responsive" : "no-visible-feedback",
        signals,
        clickError,
      });
    }
  }

  await browser.close();
  const report = {
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    renderedButtonCount: Object.values(inventory).reduce((sum, buttons) => sum + buttons.length, 0),
    testedButtonCount: results.length,
    failures: results.filter((result) => result.status !== "responsive"),
    results,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    routeCount: report.routeCount,
    renderedButtonCount: report.renderedButtonCount,
    testedButtonCount: report.testedButtonCount,
    failures: report.failures,
    outputPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
