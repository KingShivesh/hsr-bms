import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const app = process.env.CONTRAST_APP_URL || "http://127.0.0.1:5177";
const api = process.env.CONTRAST_API_URL || "http://127.0.0.1:8003";
for (const url of [app, api]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Disposable local QA only");
const login = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(login.status, 200);
const { token } = await login.json();
async function request(method, route, body) {
  const response = await fetch(api + route, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Connection: "close" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${route}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
assert.equal((await request("GET", "/sessions/active")).length, 0, "QA database must have no active sessions");
const directory = "../docs/session-start-audit/theme-runtime";
await fs.mkdir(`${directory}/after`, { recursive: true });
const started = [];
let booking;
try {
  for (const table of ["t1", "t2"]) {
    await request("POST", "/sessions/start", { table_id: table, customer_name: "QA Theme Guest" });
    started.push(table);
  }
  await request("POST", "/sessions/pause/t2");
  booking = await request("POST", "/bookings", { customer_name: "QA Theme Booking", table_id: "T3", booking_time: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  const run = spawnSync(process.execPath, ["scripts/test-theme-runtime.mjs"], {
    env: { ...process.env, CONTRAST_APP_URL: app, CONTRAST_API_URL: api, THEME_RUNTIME_REPORT_DIR: directory },
    encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  assert.equal(run.status, 0, "Theme runtime test must pass with all required local fixture states");
} finally {
  for (const table of started) await request("POST", `/sessions/stop/${table}`);
  if (booking) await request("DELETE", `/bookings/${booking.id}`);
  assert.equal((await request("GET", "/sessions/active")).length, 0);
}
