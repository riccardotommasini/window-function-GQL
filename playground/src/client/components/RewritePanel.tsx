import { Code2 } from "lucide-react";
import type { ParseResult } from "../../shared/types";

interface RewritePanelProps {
  rewrite: string;
  sqliteSql?: string;
  diagnostics: string[];
  parseKind?: ParseResult["kind"];
}

export function RewritePanel({ rewrite, sqliteSql, diagnostics, parseKind }: RewritePanelProps) {
  const hasUnsupportedPath = parseKind === "unsupported-path-window";
  return (
    <section className="panel rewrite-panel" aria-labelledby="rewrite-title">
      <div className="panel-header">
        <div className="panel-title">
          <Code2 aria-hidden="true" size={17} />
          <h2 id="rewrite-title">APOC Rewrite</h2>
        </div>
      </div>
      {hasUnsupportedPath ? (
        <div className="diagnostic-list">
          {diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </div>
      ) : (
        <pre className="code-output">{rewrite || "Waiting for a supported row-window query."}</pre>
      )}
      {sqliteSql ? (
        <div className="sql-preview">
          <div className="sql-title">SQLite Window SQL</div>
          <pre className="code-output compact">{sqliteSql}</pre>
        </div>
      ) : null}
    </section>
  );
}
