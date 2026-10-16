import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext();
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5181/login");
    await page.evaluate(async () => {
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { default: Boundary } = await import("/src/components/RouteErrorBoundary.jsx");
      const host = document.createElement("div"); host.setAttribute("data-testid", "boundary-harness");
      host.style.cssText = "position:fixed;inset:0;z-index:9999;background:var(--surface-base);padding:24px";
      document.body.append(host);
      window.__qaRenderFails = true;
      function FailingPage() { if (window.__qaRenderFails) throw new Error("QA render failure"); return React.createElement("h2", {}, "Page recovered"); }
      ReactDOM.createRoot(host).render(React.createElement(Boundary, {}, React.createElement(FailingPage)));
    });
    const harness = page.getByTestId("boundary-harness");
    await harness.getByText("This page could not open.", { exact: true }).waitFor();
    assert.doesNotMatch(await harness.innerText(), /been notified/i);
    assert.match(await harness.getByRole("link", { name: "Contact support" }).getAttribute("href"), /^mailto:shivanshg2510@gmail.com/);
    await page.evaluate(() => { window.__qaRenderFails = false; });
    await harness.getByRole("button", { name: "Retry", exact: true }).click();
    await harness.getByRole("heading", { name: "Page recovered" }).waitFor();
    results.push({ theme, renderErrorCaught: true, truthfulMessage: true, configuredSupport: true, retryRecoveredWithoutReload: true });
    await context.close();
  }
  const anonymous = await browser.newPage();
  await anonymous.goto("http://127.0.0.1:5181/status");
  await anonymous.getByRole("heading", { name: "Service status" }).waitFor();
  await anonymous.getByText("Ready", { exact: true }).waitFor();
  results.push({ publicStatusWithoutLogin: true, readinessFromRealBackend: true });
  await anonymous.goto("http://127.0.0.1:5181/login");
  await anonymous.getByTestId("username-input").fill("admin");
  await anonymous.getByTestId("password-input").fill("admin123");
  await anonymous.getByTestId("login-button").click();
  await anonymous.waitForURL("**/dashboard");
  await anonymous.getByRole("region", { name: "Getting started" }).waitFor();
  await anonymous.getByRole("button", { name: "Help", exact: true }).click();
  await anonymous.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await anonymous.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
  await anonymous.keyboard.press("Meta+k");
  assert.equal(await anonymous.getByRole("dialog").count(), 1, "command palette stacked over an existing modal");
  await anonymous.keyboard.press("Escape");
  results.push({ ownerLoginShowsSetup: true, commandPaletteDoesNotStackModals: true });
  console.log(JSON.stringify(results, null, 2));
} finally { await fs.writeFile("../docs/product-shell/recovery.json", JSON.stringify(results, null, 2)); await browser.close(); }
