import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createFinancialIntents, isFinancialRequest } from "../src/api/financialIntents.js";

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const create = (name = "QA staff") => createFinancialIntents({ storage: () => storage, crypto: webcrypto, identity: () => [name, "staff"] });
  const config = (qty = 1) => ({ method: "post", url: "/food/order", headers: {}, data: { customer_name: "QA Guest", items: [{ item: "Tea", qty }] } });
  return { data, create, config };
}

test("uncertain request survives a full client recreation/reload", async () => {
  const f = fixture(), client = f.create(), first = await client.prepare(f.config());
  client.settle(first, 0);
  const retried = await f.create().prepare(f.config());
  assert.equal(first.headers["Idempotency-Key"], retried.headers["Idempotency-Key"]);
  assert.ok(!JSON.stringify([...f.data]).includes("QA Guest"));
});
test("a confirmed order permits a new identical but distinct sale", async () => {
  const f = fixture(), client = f.create(), first = await client.prepare(f.config());
  client.settle(first, 200);
  const next = await client.prepare(f.config());
  assert.notEqual(first.headers["Idempotency-Key"], next.headers["Idempotency-Key"]);
});
test("payload changes and account changes do not share identities", async () => {
  const f = fixture(), first = await f.create().prepare(f.config());
  const changed = await f.create().prepare(f.config(2));
  const other = await f.create("Other staff").prepare(f.config());
  assert.notEqual(first.headers["Idempotency-Key"], changed.headers["Idempotency-Key"]);
  assert.notEqual(first.headers["Idempotency-Key"], other.headers["Idempotency-Key"]);
});
test("conflicts and server errors retain the original intent", async () => {
  for (const status of [409, 500, 503]) {
    const f = fixture(), client = f.create(), first = await client.prepare(f.config());
    client.settle(first, status);
    assert.equal((await client.prepare(f.config())).headers["Idempotency-Key"], first.headers["Idempotency-Key"]);
  }
});
test("definitive validation rejection releases the intent", async () => {
  const f = fixture(), client = f.create(), first = await client.prepare(f.config());
  client.settle(first, 422);
  assert.equal(f.data.size, 0);
});
test("concurrent preparations collapse to the same pending intent", async () => {
  const f = fixture(), client = f.create();
  const [a, b] = await Promise.all([client.prepare(f.config()), client.prepare(f.config())]);
  assert.equal(a.headers["Idempotency-Key"], b.headers["Idempotency-Key"]);
});
test("unavailable persistence fails before a financial POST", async () => {
  const client = createFinancialIntents({ storage: () => { throw new Error("Storage blocked"); }, crypto: webcrypto, identity: () => [] });
  await assert.rejects(client.prepare({ url: "/food/order", method: "post", headers: {} }));
});
test("only financial writes get the safety contract", () => {
  for (const url of ["/food/order", "/sessions/start", "/sessions/pause/t1", "/sessions/stop/t1?session_key=QA", "/sessions/t1/food", "/sessions/t1/food-order"]) assert.ok(isFinancialRequest({ method: "post", url }), url);
  for (const url of ["/auth/login", "/sessions/checkout-preview/t1", "/food/orders/1/restore"]) assert.ok(!isFinancialRequest({ method: "post", url }), url);
  assert.ok(!isFinancialRequest({ method: "get", url: "/food/order" }));
});
