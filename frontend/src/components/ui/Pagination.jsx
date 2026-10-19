import { IconButton } from "./Button.jsx";

export default function Pagination({ total, page, pageSize, onPageChange, label = "Records" }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  if (total <= pageSize) return null;
  return <nav className="ops-table-pagination" aria-label={`${label} pagination`}>
    <span role="status">{(current - 1) * pageSize + 1}-{Math.min(current * pageSize, total)} of {total} · Page {current} of {pages}</span>
    <div>
      <IconButton label="Previous page" icon="ti-chevron-left" variant="secondary" disabled={current <= 1} onClick={() => onPageChange(current - 1)} />
      <IconButton label="Next page" icon="ti-chevron-right" variant="secondary" disabled={current >= pages} onClick={() => onPageChange(current + 1)} />
    </div>
  </nav>;
}
