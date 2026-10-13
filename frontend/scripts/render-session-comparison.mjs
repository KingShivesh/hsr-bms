import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";
const directory = path.resolve("../docs/session-close-controls");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1576, height: 944 } });
  await page.goto(pathToFileURL(path.join(directory, "comparison.html")).href);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(directory, "comparison.png"), fullPage: true });
} finally { await browser.close(); }
