import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import babel from "@babel/core";
import { AxiosHeaders } from "axios";
import { RealtimeConnectionManager } from "../src/realtime/connectionManager.js";

// Source-only, isolated tests: no browser, HTTP requests, servers or business writes.
const reportUrl = new URL("../../docs/ui-readiness/auth-expiry/results.json", import.meta.url);
const marker = "hsr:auth-expired";
const checks = [];
async function check(name, run) {
  try { await run(); checks.push({ name, status: "pass" }); }
  catch (error) { checks.push({ name, status: "fail", error: error.stack }); }
}

function storage(initial = {}, blocked = false) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { if (blocked) throw new Error("Storage blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("Storage blocked"); values.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error("Storage blocked"); values.delete(key); },
  };
}

function environment(token = "original-token", blocked = false) {
  const localStorage = storage(token ? { token, role: "staff", username: "test-staff" } : {});
  const sessionStorage = storage({}, blocked);
  let reloads = 0;
  return {
    localStorage, sessionStorage,
    window: { location: { reload() { reloads += 1; } } },
    get reloads() { return reloads; },
  };
}

const apiSource = await fs.readFile(new URL("../src/api/index.js", import.meta.url), "utf8");
const apiCode = babel.transformSync(apiSource, {
  babelrc: false, configFile: false,
  plugins: [({ types: t }) => ({ visitor: {
    ImportDeclaration(path) { path.remove(); },
    ExportDefaultDeclaration(path) { path.remove(); },
    ExportNamedDeclaration(path) { path.replaceWith(path.node.declaration); },
    MetaProperty(path) { path.replaceWith(t.identifier("importMeta")); },
  } })],
}).code;

function apiFixture(env) {
  let request, reject;
  const instance = () => { throw new Error("Network access forbidden in this regression test"); };
  instance.interceptors = {
    request: { use(handler) { request = handler; } },
    response: { use(_resolve, handler) { reject = handler; } },
  };
  vm.runInNewContext(apiCode, {
    axios: { create: () => instance }, importMeta: { env: {} },
    localStorage: env.localStorage, sessionStorage: env.sessionStorage, window: env.window,
    readEpoch: () => 0, invalidateReads() {}, setTimeout() { throw new Error("Unexpected retry"); },
  });
  return {
    request(path = "/sessions/active", headers = new AxiosHeaders()) {
      return request({ url: path, method: "get", headers });
    },
    async fail(config, status = 401) {
      const error = { config, response: { status, data: { detail: "Rejected test request" } } };
      await assert.rejects(reject(error), candidate => candidate === error);
      return error;
    },
  };
}

await check("REST current-token 401 records notice and reloads only once", async () => {
  const env = environment(), api = apiFixture(env), request = api.request();
  await api.fail(request);
  assert.equal(env.localStorage.getItem("token"), null);
  assert.equal(env.sessionStorage.getItem(marker), "1");
  assert.equal(env.reloads, 1);
  await api.fail(request);
  assert.equal(env.reloads, 1);
  assert.equal(env.localStorage.getItem("role"), "staff");
});

for (const headers of ["plain", "AxiosHeaders"]) {
  await check(`REST stale 401 preserves newer login (${headers})`, async () => {
    const env = environment(), api = apiFixture(env);
    const request = api.request("/sessions/active", headers === "plain" ? {} : new AxiosHeaders());
    env.localStorage.setItem("token", "new-token");
    await api.fail(request);
    assert.equal(env.localStorage.getItem("token"), "new-token");
    assert.equal(env.sessionStorage.getItem(marker), null);
    assert.equal(env.reloads, 0);
  });
}

await check("REST request sent without auth cannot invalidate a later login", async () => {
  const env = environment(null), api = apiFixture(env), request = api.request();
  env.localStorage.setItem("token", "new-token");
  await api.fail(request);
  assert.equal(env.localStorage.getItem("token"), "new-token");
  assert.equal(env.sessionStorage.getItem(marker), null);
  assert.equal(env.reloads, 0);
});

await check("REST stale response after logout does not recreate expiry notice", async () => {
  const env = environment(), api = apiFixture(env), request = api.request();
  env.localStorage.removeItem("token");
  await api.fail(request);
  assert.equal(env.sessionStorage.getItem(marker), null);
  assert.equal(env.reloads, 0);
});

await check("Login 401 and protected 403/409 retain existing error handling", async () => {
  for (const [path, status] of [["/auth/login", 401], ["/sessions/active", 403], ["/sessions/active", 409]]) {
    const env = environment(), api = apiFixture(env);
    const error = await api.fail(api.request(path), status);
    assert.equal(error.userMessage, "Rejected test request");
    assert.equal(env.localStorage.getItem("token"), "original-token");
    assert.equal(env.sessionStorage.getItem(marker), null);
    assert.equal(env.reloads, 0);
  }
});

await check("REST expiry still ends session if notice storage is blocked", async () => {
  const env = environment("original-token", true), api = apiFixture(env);
  await api.fail(api.request());
  assert.equal(env.localStorage.getItem("token"), null);
  assert.equal(env.reloads, 1);
});

async function withGlobals(env, run) {
  const names = ["localStorage", "sessionStorage", "window"];
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: env[name] });
    await run();
  } finally {
    names.forEach((name, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index]);
      else delete globalThis[name];
    });
  }
}

async function streamCase({ event = false, replacement, aborted = false, superseded = false, blocked = false, custom = false }) {
  const env = environment("original-token", blocked);
  const timers = new Map(), callbacks = [], events = [];
  let nextTimer = 0, fetches = 0, manager;
  await withGlobals(env, async () => {
    manager = new RealtimeConnectionManager({
      apiUrl: "http://test.invalid", getToken: () => env.localStorage.getItem("token"),
      setTimeoutImpl(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeoutImpl(id) { timers.delete(id); },
      ...(custom ? { onAuthExpired: token => callbacks.push(token) } : {}),
      fetchImpl: async () => {
        fetches += 1;
        if (replacement !== undefined) {
          if (replacement === null) env.localStorage.removeItem("token");
          else env.localStorage.setItem("token", replacement);
        }
        if (aborted) manager.controller.abort();
        if (superseded) manager.generation += 1;
        if (!event) return new Response(null, { status: 401 });
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'event: system.auth_expired\ndata: {}\n\nevent: table.updated\ndata: {"topic":"floor"}\n\n',
          ));
          controller.close();
        } }));
      },
    });
    manager.topicKey = "floor";
    manager.subscriptions.set(1, { topics: new Set(["floor"]), onEvent: event => events.push(event) });
    await manager.connect(0, "floor");
  });
  assert.equal(fetches, 1, "No real request, immediate retry or business replay is allowed");
  assert.equal(manager.activeStreams, 0);
  assert.equal(events.length, 0, "Events queued after expiry must not be dispatched");
  return { env, callbacks, manager, timers };
}

for (const event of [false, true]) {
  const label = event ? "SSE auth_expired event" : "SSE HTTP 401";
  await check(`${label}: current token expires with one-shot notice`, async () => {
    const { env, timers } = await streamCase({ event });
    assert.equal(env.localStorage.getItem("token"), null);
    assert.equal(env.sessionStorage.getItem(marker), "1");
    assert.equal(env.reloads, 1);
    assert.equal(timers.size, 0);
  });
  await check(`${label}: stale token preserves newer login and schedules ordinary reconnect`, async () => {
    const { env, manager, timers } = await streamCase({ event, replacement: "new-token" });
    assert.equal(env.localStorage.getItem("token"), "new-token");
    assert.equal(env.sessionStorage.getItem(marker), null);
    assert.equal(env.reloads, 0);
    assert.equal(manager.state, "fallback");
    assert.ok(timers.has(manager.retryTimer));
  });
  await check(`${label}: stale callback is not invoked, matching callback receives original token`, async () => {
    const stale = await streamCase({ event, replacement: "new-token", custom: true });
    assert.deepEqual(stale.callbacks, []);
    const current = await streamCase({ event, custom: true });
    assert.deepEqual(current.callbacks, ["original-token"]);
  });
  await check(`${label}: late response after logout does not reload`, async () => {
    const { env } = await streamCase({ event, replacement: null });
    assert.equal(env.localStorage.getItem("token"), null);
    assert.equal(env.sessionStorage.getItem(marker), null);
    assert.equal(env.reloads, 0);
  });
}

await check("Cancelled or superseded stream 401 cannot expire the current login", async () => {
  for (const options of [{ aborted: true }, { superseded: true }]) {
    const { env } = await streamCase(options);
    assert.equal(env.localStorage.getItem("token"), "original-token");
    assert.equal(env.sessionStorage.getItem(marker), null);
    assert.equal(env.reloads, 0);
  }
});

await check("SSE expiry still ends session if notice storage is blocked", async () => {
  const { env } = await streamCase({ event: true, blocked: true });
  assert.equal(env.localStorage.getItem("token"), null);
  assert.equal(env.reloads, 1);
});

const loginSource = await fs.readFile(new URL("../src/components/Login.jsx", import.meta.url), "utf8");
const loginAst = babel.parseSync(loginSource, { babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
const login = loginAst.program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const submit = login.body.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "handleSubmit");
// Evaluate the real hook prelude without importing JSX/UI dependencies or mounting a browser.
const hookSource = loginSource.slice(login.body.start + 1, submit.start);
function loginHarness(sessionStorage) {
  const effects = [];
  const render = vm.runInNewContext(`(function () { ${hookSource}; return { sessionExpired, error, credentialsInvalid }; })`, {
    sessionStorage,
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    useRef: current => ({ current }),
    useEffect: callback => effects.push(callback),
  });
  return { render, effects };
}

await check("Login notice survives StrictMode double initialization and is consumed after mounting", () => {
  const store = storage({ [marker]: "1" });
  const { render, effects } = loginHarness(store);
  assert.equal(render().sessionExpired, true);
  const mounted = render();
  assert.equal(mounted.sessionExpired, true);
  assert.equal(store.getItem(marker), "1", "Rendering must not consume the marker");
  effects.forEach(effect => { effect(); effect(); });
  assert.equal(store.getItem(marker), null);
  assert.equal(mounted.sessionExpired, true);
  assert.equal(loginHarness(store).render().sessionExpired, false);
  assert.equal(mounted.error, "");
  assert.equal(mounted.credentialsInvalid, false);
});

await check("Login ordinary visits and blocked storage do not show an expiry notice", () => {
  assert.equal(loginHarness(storage()).render().sessionExpired, false);
  assert.equal(loginHarness(storage({}, true)).render().sessionExpired, false);
});

await check("Login notice markup uses a separate status and preserves credential-error association", () => {
  let noticeFound = false, credentialErrorFound = false, describedFields = 0;
  babel.traverse(loginAst, { JSXElement(path) {
    const attrs = path.node.openingElement.attributes;
    const attribute = name => attrs.find(attr => attr.type === "JSXAttribute" && attr.name.name === name)?.value;
    if (attribute("role")?.value === "status") {
      assert.equal(path.parent.type, "LogicalExpression");
      assert.equal(path.parent.left.name, "sessionExpired");
      const text = path.node.children.filter(child => child.type === "JSXText").map(child => child.value).join("").trim();
      assert.equal(text, "Your session ended. Sign in again to continue.");
      noticeFound = true;
    }
    if (attribute("id")?.value === "login-error") {
      assert.equal(attribute("role")?.value, "alert");
      credentialErrorFound = true;
    }
    if (attribute("aria-describedby")?.expression?.consequent?.value === "login-error") describedFields += 1;
  } });
  assert.ok(noticeFound && credentialErrorFound);
  assert.equal(describedFields, 2);
});

const report = {
  generatedAt: new Date().toISOString(),
  safety: { browserLaunched: false, networkRequests: 0, serversStarted: 0, businessWrites: 0 },
  scope: "Isolated REST interceptor, realtime manager, Login hook lifecycle and source markup regression checks",
  limitations: ["No browser, layout or production-preview assertions; parent owns final browser verification."],
  passed: checks.filter(check => check.status === "pass").length,
  failed: checks.filter(check => check.status === "fail").length,
  checks,
};
await fs.mkdir(new URL("./", reportUrl), { recursive: true });
await fs.writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: reportUrl.pathname, ...report }, null, 2));
if (report.failed) process.exitCode = 1;
