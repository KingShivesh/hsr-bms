import { useEffect, useState } from "react";
import { Button } from "../components/ui/index.js";

export default function DataFreshness({ at, loading, onRefresh }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return <div className="product-freshness"><span role="status">{loading ? "Refreshing summary…" : !at ? "Summary not refreshed yet" : `Summary updated ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`} ago`}</span><Button icon="ti-refresh" variant="ghost" loading={loading} onClick={onRefresh}>Refresh summary</Button></div>;
}
