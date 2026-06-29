import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../client/App";
import type { PlaygroundExample } from "../shared/types";

const tourStorageKey = "gql-window-playground.tourSeen";

const baseExamples: PlaygroundExample[] = [
  {
    id: "rank-source-node",
    title: "Rank by source account node",
    databaseId: "gwl-demo/accounts-transfers",
    description: "Partitions transfer rows by source account.",
    supportedBackends: ["apoc", "neo4j-sqlite"],
    tags: ["rank"],
    query: `MATCH (a:Account)-[t:TRANSFER]->(b:Account)
RETURN a.name AS source,
       rank() OVER (PARTITION BY a ORDER BY t.amount DESC) AS rankPerSource
ORDER BY source`
  },
  {
    id: "rows-moving-sum",
    title: "ROWS moving sum",
    databaseId: "gwl-demo/frame-rows",
    description: "Uses tuple offsets over a small frame table.",
    supportedBackends: ["apoc", "neo4j-sqlite"],
    tags: ["sum", "ROWS"],
    query: `MATCH (f:FrameRow)
RETURN f.name AS name,
       sum(f.amount) OVER (
         ORDER BY f.ord ASC
         ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
       ) AS windowSum
ORDER BY name`
  },
  {
    id: "path-element-edges",
    title: "Path-element cumulative edges",
    databaseId: "gwl-demo/path-elements",
    description: "Expands each transfer path into edge bindings.",
    supportedBackends: ["apoc"],
    tags: ["OVER PATH"],
    query: `MATCH p = (s:Account)-[:TRANSFER*1..4]->(t:Account)
RETURN position(e) AS position,
       sum(e.amount) OVER PATH p EDGES AS e (
         PARTITION BY p
         ORDER BY position(e)
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS cumulativeDistance`
  }
];

let apiExamples: PlaygroundExample[];

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(tourStorageKey, "1");
    apiExamples = baseExamples.map((example) => ({ ...example, supportedBackends: [...example.supportedBackends], tags: [...example.tags] }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/examples")) {
          return jsonResponse({ examples: apiExamples });
        }
        if (url.endsWith("/api/backends")) {
          return jsonResponse({
            backends: [
              { id: "apoc", label: "APOC", description: "APOC backend" },
              { id: "neo4j-sqlite", label: "Neo4j + SQLite", description: "SQLite backend" }
            ]
          });
        }
        if (url.endsWith("/api/parse")) {
          const body = JSON.parse(String(init?.body));
          const includePartitionId = body.includePartitionId === true;
          if (String(body.query).includes("OVER PATH")) {
            return jsonResponse({
              parse: {
                kind: "path-window",
                apocQuery: annotatedPathApoc(includePartitionId),
                diagnostics: []
              }
            });
          }
          return jsonResponse({
            parse: {
              kind: "row-window",
              sourceQuery: "MATCH (a:Account) RETURN a.name AS source",
              apocQuery: annotatedRowApoc(includePartitionId),
              sqliteSql: "SELECT ...",
              diagnostics: []
            }
          });
        }
        if (url.endsWith("/api/run")) {
          const body = JSON.parse(String(init?.body));
          const isSqlite = body.backendId === "neo4j-sqlite";
          const includePartitionId = !isSqlite && body.includePartitionId === true;
          return jsonResponse({
            backendId: body.backendId,
            rewrite: isSqlite ? "MATCH (a:Account) RETURN a.name AS source" : annotatedRowApoc(includePartitionId),
            sourceQuery: "MATCH (a:Account) RETURN a.name AS source",
            sqliteSql: isSqlite ? "SELECT ..." : undefined,
            columns: includePartitionId ? ["source", "rankPerSource", "partitionId"] : ["source", "rankPerSource"],
            rows: [
              includePartitionId
                ? { source: "Alice", rankPerSource: 1, partitionId: 1 }
                : { source: "Alice", rankPerSource: 1 }
            ],
            diagnostics: [],
            durationMs: 12,
            timing: {
              sourceQueryMs: 8,
              windowedQueryMs: 12,
              windowOverheadMs: 4,
              overheadPercentOfSource: 50,
              measurement: "estimated-apoc"
            }
          });
        }
        throw new Error(`Unhandled fetch ${url}`);
      })
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  test("shows the guided tour for first-time users and persists dismissal", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(tourStorageKey);

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "Why this exists" })).toBeInTheDocument();
    expect(screen.getByText(/what a window function means over a property graph/i)).toBeInTheDocument();
    expect(document.querySelector(".tour-step-topbar")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("dialog", { name: "Queries are fixtures" })).toBeInTheDocument();
    expect(screen.getByText(/pairs a query with a preloaded demo database/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(tourStorageKey)).toBe("1");
  });

  test("reopens the guided tour from the toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "GQL Window Playground" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tour" }));

    expect(await screen.findByRole("dialog", { name: "Why this exists" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("dialog", { name: "Path-element windows" })).toBeInTheDocument();
    expect(screen.getByText("sum(e.amount) OVER PATH p EDGES AS e (...)")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close guided tour"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("loads examples and renders run results", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "GQL Window Playground" })).toBeInTheDocument();
    await waitFor(() => expectCodeBlockContaining("CALL apoc.window.runRows("));
    expectCodeBlockContaining("false // includePartitionId");
    expectCodeBlockContaining("__gw_rows, // rows");
    expect(document.querySelector(".editor-highlight .tok-keyword")?.textContent).toBe("MATCH");

    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Returned 1 row/)).toBeInTheDocument();
    expect(screen.getByLabelText("Execution timing")).toBeInTheDocument();
    expect(screen.getByText("Overhead")).toBeInTheDocument();
    expect(screen.getByText("+4.00 ms")).toBeInTheDocument();
    expect(screen.getByText("+50.0%")).toBeInTheDocument();
  });

  test("places results below the new syntax editor in the left rail", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "GQL Window Playground" })).toBeInTheDocument();

    const workspace = document.querySelector(".workspace");
    const leftRail = document.querySelector(".left-rail");
    const rewritePanel = document.querySelector(".rewrite-panel");

    expect(workspace?.children[0]).toBe(leftRail);
    expect(workspace?.children[1]).toBe(rewritePanel);
    expect(leftRail?.children[0]).toHaveClass("editor-panel");
    expect(leftRail?.children[1]).toHaveClass("results-panel");
  });

  test("shows source Cypher instead of APOC rewrite for the SQLite backend", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expectCodeBlockContaining("CALL apoc.window.runRows("));

    await user.click(screen.getByRole("button", { name: "Neo4j + SQLite" }));

    expect(await screen.findByRole("heading", { name: "Neo4j Source Query" })).toBeInTheDocument();
    expectCodeBlockContaining("MATCH (a:Account) RETURN a.name AS source");
    expect(queryCodeBlockContaining("CALL apoc.window.runRows(")).toBeNull();
    expect(screen.getByText("SQLite Window SQL")).toBeInTheDocument();
    expectCodeBlockContaining("SELECT ...");

    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Neo4j Source Query" })).toBeInTheDocument();
    expect(queryCodeBlockContaining("CALL apoc.window.runRows(")).toBeNull();
  });

  test("toggles APOC partition id in the generated call and results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expectCodeBlockContaining("false // includePartitionId"));

    const groupIdToggle = await screen.findByLabelText("Group id");
    expect(groupIdToggle).not.toBeChecked();

    await user.click(groupIdToggle);

    expect(groupIdToggle).toBeChecked();
    await waitFor(() => expectCodeBlockContaining("true // includePartitionId"));

    await user.click(screen.getByRole("button", { name: "Neo4j + SQLite" }));

    expect(await screen.findByRole("heading", { name: "Neo4j Source Query" })).toBeInTheDocument();
    expect(groupIdToggle).toBeDisabled();
    expect(groupIdToggle).not.toBeChecked();
    expect(queryCodeBlockContaining("CALL apoc.window.runRows(")).toBeNull();

    await user.click(screen.getByRole("button", { name: "APOC" }));

    expect(groupIdToggle).toBeEnabled();
    expect(groupIdToggle).toBeChecked();
    await waitFor(() => expectCodeBlockContaining("true // includePartitionId"));

    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("partitionId")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(1);
  });

  test("does not show APOC path rewrites while SQLite is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expectCodeBlockContaining("CALL apoc.window.runRows("));
    await user.click(screen.getByRole("button", { name: "Neo4j + SQLite" }));

    const pathExample = apiExamples.find((example) => example.id === "path-element-edges");
    const editor = await screen.findByLabelText("New syntax query editor");
    fireEvent.change(editor, { target: { value: pathExample?.query ?? "" } });

    expect(await screen.findByRole("heading", { name: "Unsupported Backend" })).toBeInTheDocument();
    expect(screen.getByText("Path-element windows are supported by the APOC backend only.")).toBeInTheDocument();
    expect(queryCodeBlockContaining("CALL apoc.window.runPathRows(")).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  test("switches examples through the dropdown", async () => {
    const user = userEvent.setup();
    render(<App />);

    const select = await screen.findByLabelText("Query example");
    await user.selectOptions(select, "rows-moving-sum");

    expect(screen.getByDisplayValue(/ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING/)).toBeInTheDocument();
  });

  test("reloads examples from the API and preserves the selected query id", async () => {
    const user = userEvent.setup();
    render(<App />);

    const select = await screen.findByLabelText("Query example");
    await user.selectOptions(select, "rows-moving-sum");

    apiExamples = apiExamples.map((example) =>
      example.id === "rows-moving-sum"
        ? {
            ...example,
            title: "ROWS moving sum reloaded",
            databaseId: "gwl-demo/reloaded-frame-rows",
            query: `${example.query}\n// reloaded from yaml`
          }
        : example
    );

    await user.click(screen.getByRole("button", { name: "Reload" }));

    expect(await screen.findByText(/Reloaded 3 queries from YAML/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/reloaded from yaml/)).toBeInTheDocument();
    expect(screen.getByText("gwl-demo/reloaded-frame-rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  });

  test("switches to the executable path-element example", async () => {
    const user = userEvent.setup();
    render(<App />);

    const select = await screen.findByLabelText("Query example");
    await user.selectOptions(select, "path-element-edges");

    expect(screen.getByDisplayValue(/OVER PATH p EDGES AS e/)).toBeInTheDocument();
    await waitFor(() => expectCodeBlockContaining("CALL apoc.window.runPathRows("));
    expectCodeBlockContaining("pathSpec: path expansion parameters");
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });
});

function annotatedRowApoc(includePartitionId: boolean) {
  return `CALL apoc.window.runRows(
  __gw_rows, // rows: collected source row bindings
  {
    function: 'rank'
  }, // spec: window function, partition/order/frame
  ${includePartitionId ? "true" : "false"} // includePartitionId: emit partition/group id
)`;
}

function annotatedPathApoc(includePartitionId: boolean) {
  return `CALL apoc.window.runPathRows(
  __gw_rows, // rows: collected source row bindings
  {
    path: 'p'
  }, // pathSpec: path expansion parameters
  {
    function: 'sum'
  }, // spec: window function, partition/order/frame
  ${includePartitionId ? "true" : "false"} // includePartitionId: emit partition/group id
)`;
}

function expectCodeBlockContaining(text: string) {
  expect(queryCodeBlockContaining(text)).not.toBeNull();
}

function queryCodeBlockContaining(text: string) {
  return Array.from(document.querySelectorAll(".syntax-code")).find((element) => element.textContent?.includes(text)) ?? null;
}

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}
