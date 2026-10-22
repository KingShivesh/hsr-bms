import assert from "node:assert/strict";
import { readableFloorSnapshot } from "../src/features/live-floor/floorData.js";

const item = { id: "qa-item", item: "QA tea", qty: 2, price: 50 };
const valid = { id: "t1", status_key: "running", session: { food_items: [null, item], food_total: 500, running_total: 1000 } };
const source = { tables: [null, valid, { id: "t2", status_key: "available", session: null }], summary: { live_value: 1000 } };
const floor = readableFloorSnapshot(source);
assert.equal(floor.tables.length, 2);
assert.deepEqual(floor.tables[0].session.food_items, [item]);
assert.equal(floor.tables[0].session.food_total, 500);
assert.equal(floor.tables[0].session.running_total, 1000);
assert.equal(source.tables[1].session.food_items.length, 2);
assert.throws(() => readableFloorSnapshot({ tables: [{ id: "t1" }] }), /availability is incomplete/);
assert.throws(() => readableFloorSnapshot({ tables: null }), /status is incomplete/);
assert.deepEqual(readableFloorSnapshot({ tables: [] }).tables, []);
assert.deepEqual(readableFloorSnapshot({ tables: [{ ...valid, session: { food_items: null } }] }).tables[0].session.food_items, []);
console.log(JSON.stringify({ nullRowsGuarded: true, serverTotalsUnchanged: true, inputNotMutated: true, unknownStatusNotAvailable: true, missingCollectionRejected: true, emptyCollectionRetained: true }));
