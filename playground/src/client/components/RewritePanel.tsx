import { Code2 } from "lucide-react";
import type { ParseResult } from "../../shared/types";
import { SyntaxCode } from "./SyntaxCode";

interface RewritePanelProps {
  title: string;
  rewrite: string;
  emptyText?: string;
  sqliteSql?: string;
  diagnostics: string[];
  parseKind?: ParseResult["kind"];
  showDiagnostics?: boolean;
}

export function RewritePanel({
  title,
  rewrite,
  emptyText,
  sqliteSql,
  diagnostics,
  parseKind,
  showDiagnostics = false
}: RewritePanelProps) {
  const hasDiagnostics =
    diagnostics.length > 0 && (showDiagnostics || (parseKind !== "row-window" && parseKind !== "path-window"));
  return (
    <section className="panel rewrite-panel" aria-labelledby="rewrite-title">
      <div className="panel-header">
        <div className="panel-title">
          <Code2 aria-hidden="true" size={17} />
          <h2 id="rewrite-title">{title}</h2>
        </div>
      </div>
      {hasDiagnostics ? (
        <div className="diagnostic-list">
          {diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </div>
      ) : (
        <SyntaxCode
          value={rewrite || emptyText || "Waiting for a supported window query."}
          language="cypher"
          className="code-output"
          ariaLabel={title}
        />
      )}
      {sqliteSql ? (
        <div className="sql-preview">
          <div className="sql-title">SQLite Window SQL</div>
          <SyntaxCode value={sqliteSql} language="sql" className="code-output compact" ariaLabel="SQLite Window SQL" />
        </div>
      ) : null}
    </section>
  );
}
