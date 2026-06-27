interface ResultsTableProps {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export function ResultsTable({ columns, rows }: ResultsTableProps) {
  if (columns.length === 0) {
    return <div className="empty-state">Run a supported example to populate the table.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column}>{formatCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="muted">null</span>;
  }
  if (typeof value === "object") {
    return <code>{JSON.stringify(value)}</code>;
  }
  return String(value);
}
