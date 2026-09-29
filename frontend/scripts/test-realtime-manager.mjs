import assert from "node:assert/strict";
import { RealtimeConnectionManager } from "../src/realtime/connectionManager.js";

const encoder = new TextEncoder();
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const streams = [];
let concurrentStreams = 0;
let maxConcurrentStreams = 0;

const fetchImpl = async (url, { signal }) => {
  concurrentStreams += 1;
  maxConcurrentStreams = Math.max(maxConcurrentStreams, concurrentStreams);
  const record = { url, controller: null };
  const body = new ReadableStream({
    start(controller) {
      record.controller = controller;
      controller.enqueue(encoder.encode(
        'event: system.connected\ndata: {"occurred_at":"now"}\n\n',
      ));
      signal.addEventListener("abort", () => {
        concurrentStreams -= 1;
        controller.error(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    },
  });
  streams.push(record);
  return new Response(body, { status: 200 });
};

const manager = new RealtimeConnectionManager({
  apiUrl: "http://test.local",
  fetchImpl,
  getToken: () => "test-token",
  retryDelaysMs: [0],
  connectionGraceMs: 50,
});
const inventoryEvents = [];
const floorEvents = [];

const unsubscribeInventory = manager.subscribe({
  topics: ["inventory"],
  onEvent: (event) => inventoryEvents.push(event.type),
});
await waitFor(() => manager.snapshot().state === "connected", "inventory stream did not connect");

const unsubscribeFloor = manager.subscribe({
  topics: ["floor"],
  onEvent: (event) => floorEvents.push(event.type),
});
await waitFor(
  () => streams.length === 2 && manager.snapshot().state === "connected",
  "topic-union stream did not connect",
);

streams.at(-1).controller.enqueue(encoder.encode(
  'id: test:1\nevent: table.updated\ndata: {"topic":"floor"}\n\n',
));
streams.at(-1).controller.enqueue(encoder.encode(
  'id: test:2\nevent: inventory.updated\ndata: {"topic":"inventory"}\n\n',
));
await waitFor(() => floorEvents.length === 1 && inventoryEvents.length === 1, "events were not routed");

assert.deepEqual(floorEvents, ["table.updated"]);
assert.deepEqual(inventoryEvents, ["inventory.updated"]);
assert.deepEqual(manager.snapshot().topics, ["floor", "inventory"]);
assert.equal(manager.snapshot().subscriberCount, 2);
assert.equal(maxConcurrentStreams, 1, "more than one physical stream was active");

unsubscribeFloor();
await waitFor(
  () => streams.length === 3 && manager.snapshot().state === "connected",
  "stream did not narrow after unsubscribe",
);
assert.deepEqual(manager.snapshot().topics, ["inventory"]);
assert.equal(maxConcurrentStreams, 1, "reconfiguration overlapped physical streams");

unsubscribeInventory();
await waitFor(() => manager.snapshot().activeStreams === 0, "final stream did not close");
assert.equal(manager.snapshot().subscriberCount, 0);
assert.equal(manager.snapshot().state, "idle");

let fallbackObserved = false;
let fetchAttempts = 0;
const fallbackManager = new RealtimeConnectionManager({
  apiUrl: "http://test.local",
  fetchImpl: async () => {
    fetchAttempts += 1;
    return new Response(null, { status: 503 });
  },
  getToken: () => "test-token",
  retryDelaysMs: [10],
  connectionGraceMs: 50,
});
const stopFallbackTest = fallbackManager.subscribe({
  topics: ["floor"],
  onState: (state) => {
    if (state === "fallback") fallbackObserved = true;
  },
});
await waitFor(() => fallbackObserved && fetchAttempts >= 2, "503 did not enter fallback and retry");
stopFallbackTest();

console.log(JSON.stringify({
  maxConcurrentStreams,
  topicUnion: ["floor", "inventory"],
  routedEvents: { floor: floorEvents.length, inventory: inventoryEvents.length },
  fallback503: fallbackObserved,
  retryAttemptsObserved: fetchAttempts,
  finalSubscriberCount: manager.snapshot().subscriberCount,
}, null, 2));
