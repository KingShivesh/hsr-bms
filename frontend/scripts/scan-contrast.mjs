import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const APP_URL = process.env.CONTRAST_APP_URL || "http://127.0.0.1:5173";
const API_URL = process.env.CONTRAST_API_URL || process.env.VITE_API_URL || "http://127.0.0.1:8000";
const USERNAME = process.env.CONTRAST_USERNAME || "admin";
const PASSWORD = process.env.CONTRAST_PASSWORD || "admin123";
const CHROME_PATH = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = Number(process.env.CONTRAST_DEBUG_PORT || 9333);
const FAIL_NORMAL = 4.5;
const FAIL_LARGE = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRoutes() {
  const appSource = fs.readFileSync(path.join(process.cwd(), "src", "App.jsx"), "utf8");
  return Array.from(appSource.matchAll(/<Route\s+path="([^"*][^"]*)"/g))
    .map((match) => match[1])
    .filter((route) => route !== "/login")
    .filter((route, index, list) => list.indexOf(route) === index)
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null, text: body });
        } catch {
          resolve({ status: res.statusCode, body: null, text: body });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getToken() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return { token: data.token, role: data.role || "admin", username: data.username || USERNAME };
}

async function waitForChrome() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await httpJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.status === 200) return;
    } catch {
      // Chrome is still starting.
    }
    await sleep(125);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

async function openPage() {
  const res = await httpJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
    method: "PUT",
  });
  if (res.status !== 200 || !res.body?.webSocketDebuggerUrl) {
    throw new Error(`Could not open CDP page: ${res.status} ${res.text}`);
  }
  return connectCdp(res.body.webSocketDebuggerUrl);
}

function connectCdp(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ""}`));
      else resolve(msg.result);
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const commandId = ++id;
          ws.send(JSON.stringify({ id: commandId, method, params }));
          return new Promise((commandResolve, commandReject) => {
            pending.set(commandId, { resolve: commandResolve, reject: commandReject });
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
  });
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function navigate(client, route) {
  await client.send("Page.navigate", { url: `${APP_URL}${route === "/" ? "/" : route}` });
  await sleep(1300);
}

function pageScanExpression({ theme, route, state }) {
  return `
    (() => {
      const FAIL_NORMAL = ${FAIL_NORMAL};
      const FAIL_LARGE = ${FAIL_LARGE};
      const parseColor = (value) => {
        const match = String(value || "").match(/rgba?\\(([^)]+)\\)/);
        if (!match) return null;
        const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      };
      const luminance = (color) => {
        const channel = (value) => {
          value /= 255;
          return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
      };
      const contrastRatio = (fg, bg) => {
        const a = luminance(fg);
        const b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const effectiveBackground = (element) => {
        let node = element;
        while (node && node.nodeType === Node.ELEMENT_NODE) {
          const style = getComputedStyle(node);
          const color = parseColor(style.backgroundColor);
          if (color && color.a > 0.98) return { color, source: selectorFor(node), raw: style.backgroundColor };
          node = node.parentElement;
        }
        const bodyDark = document.body.classList.contains("dark");
        return bodyDark
          ? { color: { r: 0, g: 0, b: 0, a: 1 }, source: "viewport fallback", raw: "rgb(0, 0, 0)" }
          : { color: { r: 255, g: 255, b: 255, a: 1 }, source: "viewport fallback", raw: "rgb(255, 255, 255)" };
      };
      const selectorFor = (element) => {
        if (!element || element === document.body) return "body";
        if (element.id) return "#" + CSS.escape(element.id);
        const classes = Array.from(element.classList || []).slice(0, 5).map((item) => "." + CSS.escape(item)).join("");
        const parent = element.parentElement;
        const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === element.tagName) : [];
        const nth = siblings.length > 1 ? ":nth-of-type(" + (siblings.indexOf(element) + 1) + ")" : "";
        return element.tagName.toLowerCase() + classes + nth;
      };
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0.01 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const directText = (element) =>
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent.trim())
          .filter(Boolean)
          .join(" ")
          .replace(/\\s+/g, " ");

      const violations = [];
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        if (!visible(element)) continue;
        const text = directText(element);
        if (!text) continue;
        const style = getComputedStyle(element);
        const fg = parseColor(style.color);
        if (!fg || fg.a < 0.95) continue;
        const bg = effectiveBackground(element);
        const ratio = contrastRatio(fg, bg.color);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const minimum = large ? FAIL_LARGE : FAIL_NORMAL;
        if (ratio < minimum) {
          violations.push({
            route: ${JSON.stringify(route)},
            theme: ${JSON.stringify(theme)},
            state: ${JSON.stringify(state)},
            selector: selectorFor(element),
            className: String(element.className || ""),
            text: text.slice(0, 100),
            color: style.color,
            background: bg.raw,
            backgroundSource: bg.source,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            ratio: Number(ratio.toFixed(2)),
            required: minimum,
          });
        }
      }
      return violations;
    })()
  `;
}

async function setThemeAndAuth(client, auth, darkMode) {
  await navigate(client, "/");
  await evaluate(
    client,
    `(() => {
      localStorage.setItem("token", ${JSON.stringify(auth.token)});
      localStorage.setItem("role", ${JSON.stringify(auth.role)});
      localStorage.setItem("username", ${JSON.stringify(auth.username)});
      localStorage.setItem("darkMode", ${JSON.stringify(darkMode ? "true" : "false")});
      if (${darkMode ? "true" : "false"}) document.body.classList.add("dark");
      else document.body.classList.remove("dark");
      return true;
    })()`,
  );
}

async function openDynamicStates(client) {
  const states = [];
  const dynamicResult = await evaluate(
    client,
    `(() => {
      const opened = [];
      const click = (label, selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        el.click();
        opened.push(label);
        return true;
      };
      click("notification-popover", '[aria-label*="notification" i], [title*="notification" i]');
      const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, ctrlKey: true, bubbles: true });
      window.dispatchEvent(event);
      document.dispatchEvent(event);
      opened.push("command-palette-shortcut");
      const safeButtons = Array.from(document.querySelectorAll("button")).filter((button) => {
        const text = (button.textContent || "").trim().toLowerCase();
        if (!text) return false;
        if (/delete|remove|cancel order|close day|logout|clear|reset|collect|checkout|end/i.test(text)) return false;
        return /start table|new booking|add customer|reserve table|add walk-in|advanced controls|review close|export reports|manage inventory/i.test(text);
      });
      if (safeButtons[0]) {
        safeButtons[0].click();
        opened.push("safe-primary-action:" + (safeButtons[0].textContent || "").trim().slice(0, 40));
      }
      return opened;
    })()`,
  );
  states.push(...(dynamicResult || []));
  await sleep(500);
  return states;
}

async function scan() {
  const routes = parseRoutes();
  const auth = await getToken();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsr-contrast-chrome-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitForChrome();
    const client = await openPage();
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const report = {
      generatedAt: new Date().toISOString(),
      appUrl: APP_URL,
      apiUrl: API_URL,
      routes,
      dynamicStatesIncluded: [
        "default route state",
        "notification popover when bell exists",
        "command palette shortcut",
        "first non-destructive primary/action button per page when present",
      ],
      violations: [],
    };

    for (const theme of ["light", "dark"]) {
      await setThemeAndAuth(client, auth, theme === "dark");
      for (const route of routes) {
        await navigate(client, route);
        await sleep(900);
        report.violations.push(...await evaluate(client, pageScanExpression({ theme, route, state: "default" })));
        const opened = await openDynamicStates(client);
        report.violations.push(...await evaluate(client, pageScanExpression({ theme, route, state: opened.join(",") || "dynamic-attempted" })));
      }
    }

    client.close();
    return report;
  } finally {
    chrome.kill("SIGTERM");
    await sleep(500);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // A headless Chrome helper can briefly keep a cache file open.
      // The temp profile is disposable and should not block report output.
    }
  }
}

scan()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.violations.length ? 2 : 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
