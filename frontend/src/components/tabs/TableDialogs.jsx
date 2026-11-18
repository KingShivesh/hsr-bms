import { useEffect, useId, useRef, useState } from "react";
import { getTableAudit, getTableHistory } from "../../api/index.js";
import { formatCurrency } from "../../utils/format.js";
import { Button, EmptyState, Input, Modal, SkeletonBlock, Table } from "../ui/index.js";
import Pagination from "../ui/Pagination.jsx";
import RetryNotice from "../RetryNotice.jsx";

const money = value => value != null && value !== "" && Number.isFinite(Number(value)) ? formatCurrency(value) : "-";
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : "-";

export function HistoryModal({ tableId, tableNum, onClose }) {
  const [data, setData] = useState({ history: [], audit: [], errors: {}, loading: true });
  const [retry, setRetry] = useState(0);
  const [pages, setPages] = useState({ history: 1, audit: 1 });
  useEffect(() => {
    let alive = true;
    setData(current => ({ ...current, loading: true }));
    Promise.allSettled([getTableHistory(tableId), getTableAudit(tableId)]).then(results => {
      if (!alive) return;
      const next = { history: [], audit: [], errors: {}, loading: false };
      for (const [index, key] of ["history", "audit"].entries()) {
        const result = results[index];
        if (result.status === "fulfilled" && Array.isArray(result.value.data)) next[key] = result.value.data.filter(row => row && typeof row === "object");
        else next.errors[key] = `Could not load ${key === "history" ? "sessions" : "audit trail"}`;
      }
      setData(next); setPages({ history: 1, audit: 1 });
    });
    return () => { alive = false; };
  }, [tableId, retry]);
  const reload = () => setRetry(value => value + 1);
  return <Modal open portal size="lg" title={`Table ${tableNum} history`} description="Sessions and audit trail" className="table-history-dialog" onClose={onClose}>
    {data.loading ? <SkeletonBlock rows={8} label="Fetching table history" /> : ["history", "audit"].map(key => {
      const rows = data[key], page = Math.min(pages[key], Math.max(1, Math.ceil(rows.length / 25)));
      return <section key={key} className="table-history-section">
        <h3>{key === "history" ? "Last sessions" : "Audit trail"}</h3>
        {data.errors[key] ? <RetryNotice message={data.errors[key]} onRetry={reload} /> : !rows.length ? <EmptyState icon="ti-history" title={key === "history" ? "No sessions yet" : "No table audit yet"} description="Completed activity will appear here." secondaryAction={false} action={<Button icon="ti-refresh" onClick={reload}>Refresh history</Button>} /> : <>
          <div className="ui-table-wrap" role="region" aria-label={key === "history" ? "Last sessions table" : "Audit trail table"} tabIndex={0}><Table className="data-table table-history-table">
            <thead><tr>{(key === "history" ? ["Date", "Customer", "Duration", "Total", "Payment"] : ["Time", "Action", "Detail", "Amount"]).map(label => <th key={label} data-type={["Total", "Amount", "Duration"].includes(label) ? "number" : undefined}>{label}</th>)}</tr></thead>
            <tbody>{rows.slice((page - 1) * 25, page * 25).map((row, index) => <tr key={row.id || `${row.ts || row.date}-${index}`}>
              {key === "history" ? <><td>{text(row.date).split(",")[0]}</td><td>{text(row.nm)}</td><td data-type="number">{row.dur == null ? "-" : `${text(row.dur)}m`}</td><td data-type="number">{money(row.tot)}</td><td>{text(row.payment_method)}</td></> : <><td>{text(row.date)}</td><td>{text(row.action).replaceAll("_", " ")}</td><td>{text(row.detail)}</td><td data-type="number">{money(row.amount)}</td></>}
            </tr>)}</tbody>
          </Table></div>
          <Pagination label={key === "history" ? "Sessions" : "Audit events"} total={rows.length} page={page} pageSize={25} onPageChange={value => setPages(current => ({ ...current, [key]: value }))} />
        </>}
      </section>;
    })}
  </Modal>;
}

export function ResetConfirmModal({ tableId, loading, onClose, onConfirm }) {
  const [pin, setPin] = useState("");
  const pinRef = useRef(null);
  const formId = useId();
  return <Modal open portal className="table-reset-dialog" title={`Reset ${tableId.toUpperCase()}`} description="This clears the running session without creating a bill."
    onClose={onClose} closeDisabled={loading} initialFocusRef={pinRef} size="sm"
    footer={<><Button onClick={onClose} disabled={loading}>Cancel</Button><Button type="submit" form={formId} variant="danger" loading={loading}>Reset Table</Button></>}>
    <form id={formId} onSubmit={async event => { event.preventDefault(); if (loading) return; const success = await onConfirm(pin.trim()); if (success) onClose(); }}>
      <label className="form-label" htmlFor={`reset-pin-${tableId}`}>Manager PIN, if required</label>
      <Input ref={pinRef} id={`reset-pin-${tableId}`} type="password" inputMode="numeric" autoComplete="off" value={pin} disabled={loading} onChange={event => setPin(event.target.value)} />
    </form>
  </Modal>;
}
