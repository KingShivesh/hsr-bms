import { useEffect, useMemo, useState } from "react";
import { getInvoices } from "../../api/index.js";

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function InvoicePreview({ invoice, onClose }) {
  if (!invoice) return null;
  return (
    <div className="modal-backdrop plain" onClick={onClose}>
      <div className="invoice-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="table-history-head">
          <div>
            <strong>Invoice {invoice.id}</strong>
            <span>{invoice.date} · {invoice.payment_method}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close invoice">×</button>
        </div>
        <div className="invoice-brand">
          <strong>HSR Snooker Cafe BMS</strong>
          <span>{invoice.kind === "table" ? invoice.table_id : "Food order"}</span>
        </div>
        <div className="invoice-customer">
          <span>Customer</span>
          <strong>{invoice.customer_name || "Walk-in"}</strong>
        </div>
        <table className="data-table invoice-lines">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((item, index) => (
              <tr key={`${item.description}-${index}`}>
                <td>{item.description}</td>
                <td>{item.qty}</td>
                <td>{money(item.rate)}</td>
                <td>{money(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="invoice-totals">
          <span>Subtotal <strong>{money(invoice.subtotal)}</strong></span>
          {invoice.discount_amount > 0 && <span>Discount <strong>-{money(invoice.discount_amount)}</strong></span>}
          {invoice.tax_amount > 0 && <span>Tax <strong>{money(invoice.tax_amount)}</strong></span>}
          <span className="final">Total <strong>{money(invoice.total)}</strong></span>
        </div>
        {invoice.payment_split?.length > 0 && (
          <div className="checkout-payment-received">
            {invoice.payment_split.map((row) => (
              <span key={`${row.method}-${row.amount}`}>{row.method} {money(row.amount)}</span>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-primary-sm invoice-print-btn" onClick={() => window.print()}>
          <i className="ti ti-printer" aria-hidden="true" />
          Print
        </button>
      </div>
    </div>
  );
}

export default function BillingTab() {
  const [invoices, setInvoices] = useState([]);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("All");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInvoices()
      .then((res) => setInvoices(res.data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = invoices.filter((invoice) => {
    const text = `${invoice.id} ${invoice.customer_name} ${invoice.table_id} ${invoice.payment_method}`.toLowerCase();
    return (
      (method === "All" || invoice.payment_method === method) &&
      text.includes(query.toLowerCase())
    );
  });
  const totals = useMemo(() => ({
    collected: invoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0),
    table: invoices.filter((invoice) => invoice.kind === "table").length,
    food: invoices.filter((invoice) => invoice.kind === "food").length,
  }), [invoices]);

  if (loading) return <div className="loading-state-title">Loading invoices...</div>;

  return (
    <div className="ops-page">
      <InvoicePreview invoice={selected} onClose={() => setSelected(null)} />
      <div className="ops-hero">
        <div>
          <div className="quick-session-eyebrow">Receipts</div>
          <h2>Billing & Invoices</h2>
          <p>Search table and food receipts, payment methods, and printable invoice details.</p>
        </div>
      </div>
      <div className="closing-metric-grid">
        <div className="closing-metric total"><span>Total collected</span><strong>{money(totals.collected)}</strong></div>
        <div className="closing-metric"><span>Table invoices</span><strong>{totals.table}</strong></div>
        <div className="closing-metric"><span>Food invoices</span><strong>{totals.food}</strong></div>
      </div>
      <div className="inventory-toolbar">
        <input className="table-mini-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, customer, table" />
        <select className="table-mini-input" value={method} onChange={(event) => setMethod(event.target.value)}>
          {["All", "Cash", "UPI", "Card", "Split"].map((option) => <option key={option}>{option}</option>)}
        </select>
      </div>
      <div className="history-section">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Table</th>
              <th>Payment</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id}>
                <td><strong>{invoice.id}</strong></td>
                <td>{invoice.date}</td>
                <td>{invoice.customer_name}</td>
                <td>{invoice.table_id || "-"}</td>
                <td>{invoice.payment_method}</td>
                <td><strong>{money(invoice.total)}</strong></td>
                <td>
                  <button type="button" className="member-action-btn is-upgrade" onClick={() => setSelected(invoice)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
