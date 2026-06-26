import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { examples } from "../shared/examples";
import { App } from "../client/App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/examples")) {
          return jsonResponse({ examples });
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
          return jsonResponse({
            parse: {
              kind: "row-window",
              apocQuery: "CALL apoc.window.runRows(...)",
              sqliteSql: "SELECT ...",
              diagnostics: []
            }
          });
        }
        if (url.endsWith("/api/run")) {
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            backendId: body.backendId,
            rewrite: "CALL apoc.window.runRows(...)",
            columns: ["source", "rankPerSource"],
            rows: [{ source: "Alice", rankPerSource: 1 }],
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
    vi.unstubAllGlobals();
  });

  test("loads examples and renders run results", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "GQL Window Playground" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("CALL apoc.window.runRows(...)")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Returned 1 row/)).toBeInTheDocument();
    expect(screen.getByLabelText("Execution timing")).toBeInTheDocument();
    expect(screen.getByText("Overhead")).toBeInTheDocument();
    expect(screen.getByText("+4.00 ms")).toBeInTheDocument();
    expect(screen.getByText("+50.0%")).toBeInTheDocument();
  });

  test("switches examples through the dropdown", async () => {
    const user = userEvent.setup();
    render(<App />);

    const select = await screen.findByLabelText("Query example");
    await user.selectOptions(select, "rows-moving-sum");

    expect(screen.getByDisplayValue(/ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING/)).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}
