export default function DataTable({ columns = [], rows = [], rowKey = "id", empty, className = "" }) {
  return (
    <div className={["ui-table-wrap", className].filter(Boolean).join(" ")}>
      <table className="ui-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "is-right" : ""}>
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
                  <td key={column.key} className={column.align === "right" ? "is-right" : ""}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>{empty || "No records found."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
