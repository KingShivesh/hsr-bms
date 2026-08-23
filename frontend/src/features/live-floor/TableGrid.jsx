import TableCard from "./TableCard.jsx";

export default function TableGrid({ tables = [], selectedTableId = "", tick = 0, onSelectTable, onStartSession }) {
  if (!tables.length) {
    return (
      <div className="lf-empty-inline">
        <i className="ti ti-table-off" aria-hidden="true" />
        <span>No tables returned by the backend.</span>
      </div>
    );
  }

  return (
    <div className="lf-table-grid">
      {tables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          selected={selectedTableId === table.id}
          tick={tick}
          onSelect={onSelectTable}
          onStart={onStartSession}
        />
      ))}
    </div>
  );
}
