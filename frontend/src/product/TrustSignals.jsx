import { useEffect, useState } from "react";
import { Button, Icon } from "../components/ui/index.js";
import { realtimeConnectionManager as manager } from "../realtime/connectionManager.js";

export default function TrustSignals() {
  const [state, setState] = useState(manager.state);
  const [saved, setSaved] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [reconnected, setReconnected] = useState(false);
  useEffect(() => {
    let previous = manager.state;
    let recoverTimer;
    const off = manager.observeState(next => {
      if (previous === "fallback" && next === "connected") { setReconnected(true); recoverTimer = setTimeout(() => setReconnected(false), 2000); }
      previous = next; setState(next);
    });
    return () => { off(); clearTimeout(recoverTimer); };
  }, []);
  useEffect(() => {
    let timer;
    const success = () => { setSaved(true); clearTimeout(timer); timer = setTimeout(() => setSaved(false), 3000); };
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("hsr:mutation-saved", success); window.addEventListener("online", online); window.addEventListener("offline", online);
    return () => { clearTimeout(timer); window.removeEventListener("hsr:mutation-saved", success); window.removeEventListener("online", online); window.removeEventListener("offline", online); };
  }, []);
  return <div className={`product-trust ${offline || state === "fallback" ? "is-degraded" : reconnected ? "is-reconnected" : ""}`} role="status" aria-live="polite">
    {saved && <span className="product-saved"><Icon name="check" />Saved just now</span>}
    {offline ? <span><Icon name="wifi-off" />Offline · changes need a connection</span> : state === "fallback" ? <><span><Icon name="wifi-off" />Reconnecting · polling continues</span><Button native onClick={() => manager.retry()}>Retry now</Button></> : reconnected ? <span><Icon name="circle-check" />Reconnected</span> : state === "connected" ? <span><Icon name="circle-dot" />Live sync</span> : state === "connecting" ? <span><Icon name="refresh" />Connecting</span> : <span>Live sync idle</span>}
  </div>;
}
