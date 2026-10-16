import EmptyState from "./EmptyState.jsx";

export default function DataTable({ columns = [], rows = [], rowKey = "id", empty, className = "" }) {
  return (
    <div className={["ui-table-wrap", className].filter(Boolean).join(" ")}>
      <Table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} data-type={column.type} className={column.align === "right" || column.type === "number" ? "is-right" : ""}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={row[rowKey] || index}>
                {columns.map((column) => (
                  <td key={column.key} data-type={column.type} className={column.align === "right" || column.type === "number" ? "is-right" : ""}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={Math.max(1, columns.length)}>{typeof empty === "object" ? empty : <EmptyState title="No matching records" description={empty || "Try a different filter, or return after the first record has been created."} />}</td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
export function Table({ children, className = "", ...props }) {
  return <table className={["ui-data-table", className].filter(Boolean).join(" ")} {...props}>{children}</table>;
}
