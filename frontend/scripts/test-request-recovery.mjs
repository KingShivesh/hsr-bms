import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { installRequestRecovery } from "../src/api/requestRecovery.js";

function fixture({ mode = "fail", status = 503, budget = 30000, attempt = 15000 } = {}) {
  let time = 0, calls = 0;
  const client = axios.create({ timeout: attempt });
  const waits = [];
  installRequestRecovery(client, { now: () => time, budgetMs: budget, wait: async ms => { waits.push(ms); time += ms; } });
  client.defaults.adapter = async config => {
    calls++;
    if (mode === "timeout") {
      time += config.timeout;
      throw new axios.AxiosError("Timed out", "ECONNABORTED", config);
    }
    if (mode === "recover" && calls === 3) return { config, status: 200, data: {}, headers: {} };
    if (mode === "cancel") throw new axios.CanceledError("Cancelled", config);
    const response = { config, status, data: {}, headers: {} };
    throw new axios.AxiosError("Unavailable", "ERR_BAD_RESPONSE", config, null, response);
  };
  return { client, snapshot: () => ({ time, calls, waits }) };
}

test("read timeouts share a 30s deadline, not three fresh timeouts", async () => {
  const f = fixture({ mode: "timeout" });
  await assert.rejects(f.client.get("/reports/summary"));
  assert.equal(f.snapshot().time, 30000);
  assert.equal(f.snapshot().calls, 2);
});
test("readiness has a bounded 75s wake budget", async () => {
  const f = fixture({ mode: "timeout" });
  await assert.rejects(f.client.get("/ready", { timeout: 10000, retryBudgetMs: 75000, retryLimit: 25 }));
  assert.equal(f.snapshot().time, 75000);
});
test("fast 503 reads retry twice then fail, and healthy retry returns data", async () => {
  const fail = fixture();
  await assert.rejects(fail.client.get("/food/orders"));
  assert.equal(fail.snapshot().calls, 3);
  const recover = fixture({ mode: "recover" });
  assert.equal((await recover.client.get("/food/orders")).status, 200);
  assert.equal(recover.snapshot().calls, 3);
});
for (const method of ["post", "put", "patch", "delete"]) test(`${method} is never replayed`, async () => {
  const f = fixture();
  await assert.rejects(f.client.request({ method, url: "/sessions/action" }));
  assert.equal(f.snapshot().calls, 1);
  assert.equal(f.snapshot().waits.length, 0);
});
for (const status of [400, 401, 403, 404, 409, 422, 429]) test(`${status} is not retried`, async () => {
  const f = fixture({ status });
  await assert.rejects(f.client.get("/resource"));
  assert.equal(f.snapshot().calls, 1);
});
test("cancellation and explicit noRetry never retry", async () => {
  const f = fixture({ mode: "cancel" });
  await assert.rejects(f.client.get("/resource"), axios.isCancel);
  assert.equal(f.snapshot().calls, 1);
  const noRetry = fixture();
  await assert.rejects(noRetry.client.get("/resource", { noRetry: true }));
  assert.equal(noRetry.snapshot().calls, 1);
});
test("abort while backing off cancels without another request", async () => {
  const client = axios.create({ timeout: 20 });
  const controller = new AbortController();
  let calls = 0;
  installRequestRecovery(client);
  client.defaults.adapter = async config => {
    calls++;
    setTimeout(() => controller.abort(), 10);
    throw new axios.AxiosError("Disconnected", "ERR_NETWORK", config);
  };
  await assert.rejects(client.get("/resource", { signal: controller.signal }), axios.isCancel);
  assert.equal(calls, 1);
});
