import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const CONNECTION_GRACE_MS = 5000;

function parseEventBlock(block) {
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
}

export function useRealtimeSubscription({
  topics,
  onEvent,
  onFallbackPoll,
  fallbackPollMs = 15000,
}) {
  const [state, setState] = useState("connecting");
  const onEventRef = useRef(onEvent);
  const onFallbackPollRef = useRef(onFallbackPoll);
  const topicKey = [...topics].sort().join(",");

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onFallbackPollRef.current = onFallbackPoll;
  }, [onFallbackPoll]);

  useEffect(() => {
    let stopped = false;
    let controller = null;
    let retryTimer = null;
    let fallbackTimer = null;
    let graceTimer = null;
    let retryAttempt = 0;
    let lastEventId = "";
    let fallbackActive = false;

    const stopFallback = () => {
      fallbackActive = false;
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = () => {
      if (stopped || fallbackTimer || !onFallbackPollRef.current) return;
      fallbackActive = true;
      setState("fallback");
      onFallbackPollRef.current();
      fallbackTimer = window.setInterval(() => {
        onFallbackPollRef.current?.();
      }, fallbackPollMs);
    };

    const scheduleReconnect = (connect) => {
      if (stopped) return;
      startFallback();
      const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) return;
      const token = localStorage.getItem("token");
      if (!token) {
        startFallback();
        return;
      }

      controller = new AbortController();
      if (!fallbackActive) {
        setState((current) => (current === "connected" ? current : "connecting"));
      }
      graceTimer = window.setTimeout(startFallback, CONNECTION_GRACE_MS);

      try {
        const headers = {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
        };
        if (lastEventId) headers["Last-Event-ID"] = lastEventId;
        const response = await fetch(
          `${API_URL}/events/stream?topics=${encodeURIComponent(topicKey)}`,
          {
            method: "GET",
            headers,
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (response.status === 401) {
          localStorage.removeItem("token");
          window.location.reload();
          return;
        }
        if (!response.ok) throw new Error(`Realtime connection failed (${response.status})`);

        await readEventStream(response, (event) => {
          if (event.id) lastEventId = event.id;
          if (event.type === "system.connected") {
            retryAttempt = 0;
            window.clearTimeout(graceTimer);
            stopFallback();
            setState("connected");
            return;
          }
          if (event.type === "system.auth_expired") {
            localStorage.removeItem("token");
            window.location.reload();
            return;
          }
          onEventRef.current?.(event);
        }, controller.signal);

        if (!stopped && !controller.signal.aborted) {
          throw new Error("Realtime connection closed");
        }
      } catch (error) {
        if (!stopped && error.name !== "AbortError") scheduleReconnect(connect);
      } finally {
        window.clearTimeout(graceTimer);
      }
    };

    connect();
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(graceTimer);
      stopFallback();
    };
  }, [fallbackPollMs, topicKey]);

  return state;
}
