import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Braces, CheckCircle2, Database, Play, RotateCcw, Table2 } from "lucide-react";
import { fetchBackends, fetchExamples, parseQuery, runQuery } from "./api";
import type { BackendId, BackendInfo, ParseResult, PlaygroundExample, RunResponse } from "../shared/types";
import { EditorPanel } from "./components/EditorPanel";
import { ResultsTable } from "./components/ResultsTable";
import { RewritePanel } from "./components/RewritePanel";
import { StatusStrip } from "./components/StatusStrip";
import { TimingStrip } from "./components/TimingStrip";

type LoadState = "idle" | "loading" | "error";

export function App() {
  const [examples, setExamples] = useState<PlaygroundExample[]>([]);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [selectedExampleId, setSelectedExampleId] = useState("");
  const [backendId, setBackendId] = useState<BackendId>("apoc");
  const [query, setQuery] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [isParsing, setIsParsing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchExamples(), fetchBackends()])
      .then(([loadedExamples, loadedBackends]) => {
        if (!isMounted) {
          return;
        }
        setExamples(loadedExamples);
        setBackends(loadedBackends);
        const firstExample = loadedExamples[0];
        if (firstExample) {
          setSelectedExampleId(firstExample.id);
          setQuery(firstExample.query);
          setBackendId(firstExample.supportedBackends[0] ?? "apoc");
        }
        setLoadState("idle");
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }
        setLoadState("error");
        setStatus(error instanceof Error ? error.message : "Failed to load playground metadata.");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setParseResult(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsParsing(true);
      parseQuery(query)
        .then((response) => {
          if (controller.signal.aborted) {
            return;
          }
          setParseResult(response.parse);
          setStatus(response.parse.diagnostics[0] ?? "Parsed");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setParseResult(null);
          setStatus(error instanceof Error ? error.message : "Parse failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsParsing(false);
          }
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const selectedExample = useMemo(
    () => examples.find((example) => example.id === selectedExampleId) ?? null,
    [examples, selectedExampleId]
  );

  const backendSupport = selectedExample?.supportedBackends ?? ["apoc", "neo4j-sqlite"];
  const activeRewrite = runResult?.rewrite ?? (parseResult?.kind === "row-window" ? parseResult.apocQuery : "");
  const sqliteSql = runResult?.sqliteSql ?? (parseResult?.kind === "row-window" ? parseResult.sqliteSql : undefined);
  const diagnostics = parseResult?.diagnostics ?? [];
  const canRun = parseResult?.kind === "row-window" && !isRunning && backendSupport.includes(backendId);

  const selectExample = useCallback(
    (exampleId: string) => {
      const example = examples.find((item) => item.id === exampleId);
      if (!example) {
        return;
      }
      setSelectedExampleId(example.id);
      setQuery(example.query);
      setRunResult(null);
      setBackendId(example.supportedBackends[0] ?? "apoc");
      setStatus("Example loaded");
    },
    [examples]
  );

  const resetExample = useCallback(() => {
    if (!selectedExample) {
      return;
    }
    setQuery(selectedExample.query);
    setRunResult(null);
    setStatus("Example reset");
  }, [selectedExample]);

  const execute = useCallback(() => {
    if (!canRun) {
      return;
    }
    setIsRunning(true);
    setStatus("Running");
    runQuery(query, backendId)
      .then((result) => {
        setRunResult(result);
        setStatus(`Returned ${result.rows.length} row${result.rows.length === 1 ? "" : "s"} in ${result.durationMs} ms`);
      })
      .catch((error: unknown) => {
        setRunResult(null);
        setStatus(error instanceof Error ? error.message : "Run failed.");
      })
      .finally(() => setIsRunning(false));
  }, [backendId, canRun, query]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Database aria-hidden="true" size={22} />
          <h1>GQL Window Playground</h1>
        </div>
        <div className="toolbar">
          <label className="select-shell">
            <span>Query</span>
            <select
              value={selectedExampleId}
              onChange={(event) => selectExample(event.target.value)}
              aria-label="Query example"
            >
              {examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title}
                </option>
              ))}
            </select>
          </label>
          <div className="backend-toggle" aria-label="Backend selector">
            {backends.map((backend) => {
              const disabled = selectedExample ? !selectedExample.supportedBackends.includes(backend.id) : false;
              return (
                <button
                  key={backend.id}
                  type="button"
                  className={backendId === backend.id ? "active" : ""}
                  disabled={disabled}
                  onClick={() => setBackendId(backend.id)}
                  title={backend.description}
                >
                  {backend.label}
                </button>
              );
            })}
          </div>
          <button className="icon-button subtle" type="button" onClick={resetExample} title="Reset example">
            <RotateCcw aria-hidden="true" size={16} />
            <span>Reset</span>
          </button>
          <button className="run-button" type="button" onClick={execute} disabled={!canRun}>
            <Play aria-hidden="true" size={17} fill="currentColor" />
            <span>{isRunning ? "Running" : "Run"}</span>
          </button>
        </div>
      </header>

      <section className="meta-row" aria-label="Example metadata">
        <div>
          <span className="meta-label">Database</span>
          <strong>{selectedExample?.databaseId ?? "loading"}</strong>
        </div>
        <div>
          <span className="meta-label">Status</span>
          <StatusStrip
            icon={
              loadState === "error" || status.toLowerCase().includes("failed") || status.toLowerCase().includes("unsupported") ? (
                <AlertTriangle size={15} />
              ) : isParsing || isRunning ? (
                <Braces size={15} />
              ) : (
                <CheckCircle2 size={15} />
              )
            }
            text={status}
          />
        </div>
      </section>

      {runResult ? <TimingStrip timing={runResult.timing} /> : null}

      <section className="workspace">
        <EditorPanel value={query} onChange={setQuery} disabled={loadState === "loading"} />
        <div className="right-rail">
          <RewritePanel
            rewrite={activeRewrite}
            sqliteSql={backendId === "neo4j-sqlite" ? sqliteSql : undefined}
            diagnostics={diagnostics}
            parseKind={parseResult?.kind}
          />
          <section className="panel results-panel" aria-labelledby="results-title">
            <div className="panel-header">
              <div className="panel-title">
                <Table2 aria-hidden="true" size={17} />
                <h2 id="results-title">Results</h2>
              </div>
              <span className="panel-count">{runResult ? `${runResult.rows.length} rows` : "not run"}</span>
            </div>
            <ResultsTable columns={runResult?.columns ?? []} rows={runResult?.rows ?? []} />
          </section>
        </div>
      </section>
    </main>
  );
}
