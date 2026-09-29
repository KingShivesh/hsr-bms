import { useEffect, useRef, useState } from "react";
import { realtimeConnectionManager } from "./connectionManager.js";

export function useRealtimeSubscription({
  topics,
  onEvent,
  onFallbackPoll,
  fallbackPollMs = 15000,
  enabled = true,
}) {
  const [state, setState] = useState(enabled ? "connecting" : "idle");
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
    let fallbackTimer = null;

    const stopFallback = () => {
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = () => {
      if (fallbackTimer || !onFallbackPollRef.current) return;
      onFallbackPollRef.current();
      fallbackTimer = window.setInterval(() => {
        onFallbackPollRef.current?.();
      }, fallbackPollMs);
    };

    if (!enabled || !topicKey) {
      setState("idle");
      return stopFallback;
    }

    const unsubscribe = realtimeConnectionManager.subscribe({
      topics: topicKey.split(","),
      onEvent: (event) => onEventRef.current?.(event),
      onState: (nextState) => {
        setState(nextState);
        if (nextState === "fallback") startFallback();
        if (nextState === "connected" || nextState === "idle") stopFallback();
      },
    });

    return () => {
      unsubscribe();
      stopFallback();
    };
  }, [enabled, fallbackPollMs, topicKey]);

  return state;
}
