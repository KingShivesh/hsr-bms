import { invalidateReads } from "../api/readEpoch.js";

const DEFAULT_API_URL = import.meta.env?.VITE_API_URL || "http://localhost:8000";
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const DEFAULT_CONNECTION_GRACE_MS = 5000;

export function parseEventBlock(block) {
  const event = { type: "message", id: "", data: null };
  const data = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") event.type = value;
    if (field === "id") event.id = value;
    if (field === "data") data.push(value);
  }

  if (data.length) {
    const value = data.join("\n");
    try {
      event.data = JSON.parse(value);
    } catch {
      event.data = value;
    }
  }
  return event;
}

async function readEventStream(response, onEvent, signal) {
  if (!response.body) throw new Error("Realtime response has no readable body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach((block) => {
      if (block.trim()) onEvent(parseEventBlock(block));
    });
    if (done) break;
  }
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function defaultAuthExpired() {
  localStorage.removeItem("token");
  window.location.reload();
}

export class RealtimeConnectionManager {
  constructor({
    apiUrl = DEFAULT_API_URL,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getToken = () => localStorage.getItem("token"),
    onAuthExpired = defaultAuthExpired,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    connectionGraceMs = DEFAULT_CONNECTION_GRACE_MS,
    heartbeatTimeoutMs = 35000,
    setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
    clearTimeoutImpl = (...args) => globalThis.clearTimeout(...args),
  } = {}) {
    this.apiUrl = apiUrl;
    this.fetchImpl = fetchImpl;
    this.getToken = getToken;
    this.onAuthExpired = onAuthExpired;
    this.retryDelaysMs = retryDelaysMs;
    this.connectionGraceMs = connectionGraceMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.subscriptions = new Map();
    this.nextSubscriptionId = 1;
    this.topicKey = "";
    this.state = "idle";
    this.controller = null;
    this.retryTimer = null;
    this.graceTimer = null;
    this.heartbeatTimer = null;
    this.retryAttempt = 0;
    this.lastEventId = "";
    this.generation = 0;
    this.activeStreams = 0;
    this.connectionPromise = null;
  }

  subscribe({ topics, onEvent, onState }) {
    const normalizedTopics = new Set(topics.filter(Boolean));
    const id = this.nextSubscriptionId;
    this.nextSubscriptionId += 1;
    this.subscriptions.set(id, { topics: normalizedTopics, onEvent, onState });
    onState?.(this.state === "idle" ? "connecting" : this.state);
    this.reconcile();

    return () => {
      this.subscriptions.delete(id);
      this.reconcile();
    };
  }

  snapshot() {
    return {
      activeStreams: this.activeStreams,
      state: this.state,
      subscriberCount: this.subscriptions.size,
      topics: this.topicKey ? this.topicKey.split(",") : [],
    };
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.subscriptions.forEach((subscription) => subscription.onState?.(state));
  }

  clearTimers() {
    this.clearTimeout(this.retryTimer);
    this.clearTimeout(this.graceTimer);
    this.clearTimeout(this.heartbeatTimer);
    this.retryTimer = null;
    this.graceTimer = null;
    this.heartbeatTimer = null;
  }

  reconcile() {
    const topicKey = [...new Set(
      [...this.subscriptions.values()].flatMap((subscription) => [...subscription.topics]),
    )].sort().join(",");

    if (topicKey === this.topicKey && (this.controller || !topicKey)) return;

    this.generation += 1;
    this.clearTimers();
    this.controller?.abort();
    this.controller = null;
    this.topicKey = topicKey;
    this.retryAttempt = 0;

    if (!topicKey) {
      this.lastEventId = "";
      this.setState("idle");
      return;
    }

    this.setState("connecting");
    this.startConnection(this.generation, topicKey);
  }

  dispatch(event) {
    invalidateReads();
    const eventTopic = event.data?.topic;
    const isSystemEvent = event.type.startsWith("system.");
    this.subscriptions.forEach((subscription) => {
      if (isSystemEvent || subscription.topics.has(eventTopic)) {
        subscription.onEvent?.(event);
      }
    });
  }

  scheduleReconnect(generation, topicKey) {
    if (generation !== this.generation || !this.topicKey) return;
    this.setState("fallback");
    const delay = this.retryDelaysMs[Math.min(this.retryAttempt, this.retryDelaysMs.length - 1)];
    this.retryAttempt += 1;
    this.retryTimer = this.setTimeout(() => this.startConnection(generation, topicKey), delay);
  }

  startConnection(generation, topicKey) {
    const previousConnection = this.connectionPromise;
    const connection = (async () => {
      if (previousConnection) await previousConnection;
      if (generation === this.generation && topicKey === this.topicKey) {
        await this.connect(generation, topicKey);
      }
    })();
    this.connectionPromise = connection;
    connection.finally(() => {
      if (this.connectionPromise === connection) this.connectionPromise = null;
    });
  }

  async connect(generation, topicKey) {
    if (generation !== this.generation || topicKey !== this.topicKey) return;
    const token = this.getToken();
    if (!token) {
      this.setState("fallback");
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.graceTimer = this.setTimeout(() => {
      if (generation === this.generation) this.setState("fallback");
    }, this.connectionGraceMs);

    try {
      const headers = {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
      };
      if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;
      this.activeStreams += 1;
      const response = await this.fetchImpl(
        `${this.apiUrl}/events/stream?topics=${encodeURIComponent(topicKey)}`,
        {
          method: "GET",
          headers,
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        this.onAuthExpired();
        return;
      }
      if (!response.ok) throw new Error(`Realtime connection failed (${response.status})`);

      await readEventStream(response, (event) => {
        if (generation !== this.generation) return;
        this.clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = this.setTimeout(() => {
          if (generation !== this.generation) return;
          controller.abort();
          this.scheduleReconnect(generation, topicKey);
        }, this.heartbeatTimeoutMs);
        if (event.id) this.lastEventId = event.id;
        if (event.type === "system.connected") {
          this.retryAttempt = 0;
          this.clearTimeout(this.graceTimer);
          this.graceTimer = null;
          this.setState("connected");
          return;
        }
        if (event.type === "system.auth_expired") {
          controller.abort();
          this.onAuthExpired();
          return;
        }
        if (event.type === "system.heartbeat") return;
        this.dispatch(event);
      }, controller.signal);

      if (generation === this.generation && !controller.signal.aborted) {
        throw new Error("Realtime connection closed");
      }
    } catch (error) {
      if (generation === this.generation && error.name !== "AbortError") {
        this.scheduleReconnect(generation, topicKey);
      }
    } finally {
      this.activeStreams = Math.max(0, this.activeStreams - 1);
      this.clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.controller === controller) this.controller = null;
    }
  }
}

export const realtimeConnectionManager = new RealtimeConnectionManager();
