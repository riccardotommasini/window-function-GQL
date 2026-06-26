import request from "supertest";
import { describe, expect, test } from "vitest";
import { createApp } from "../server/app";
import type { BackendAdapter } from "../server/backends/types";

describe("playground API", () => {
  test("returns examples and backends", async () => {
    const app = createApp();

    const examplesResponse = await request(app).get("/api/examples").expect(200);
    const backendsResponse = await request(app).get("/api/backends").expect(200);

    expect(examplesResponse.body.examples.length).toBeGreaterThan(0);
    expect(backendsResponse.body.backends.map((backend: { id: string }) => backend.id)).toEqual([
      "apoc",
      "neo4j-sqlite"
    ]);
  });

  test("runs through an injected backend adapter", async () => {
    const adapter: BackendAdapter = {
      async run(parsed) {
        return {
          backendId: "apoc",
          rewrite: parsed.apocQuery,
          columns: parsed.visibleColumns,
          rows: [{ source: "Alice", rankPerSource: 1 }],
          diagnostics: [],
          durationMs: 1,
          timing: {
            sourceQueryMs: 0.5,
            windowedQueryMs: 1,
            windowOverheadMs: 0.5,
            overheadPercentOfSource: 100,
            measurement: "estimated-apoc"
          }
        };
      }
    };
    const app = createApp({ adapters: { apoc: adapter }, driver: {} as never });

    const response = await request(app)
      .post("/api/run")
      .send({
        backendId: "apoc",
        query: `MATCH (a:Account)-[t:TRANSFER]->(b:Account)
RETURN a.name AS source,
       rank() OVER (PARTITION BY a ORDER BY t.amount DESC) AS rankPerSource
ORDER BY source`
      })
      .expect(200);

    expect(response.body.columns).toEqual(["source", "rankPerSource"]);
    expect(response.body.rows).toEqual([{ source: "Alice", rankPerSource: 1 }]);
    expect(response.body.timing.windowOverheadMs).toBe(0.5);
  });

  test("reports unsupported path windows", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/run")
      .send({
        backendId: "apoc",
        query: `MATCH p = (a:Account)-[:TRANSFER*]->(b:Account)
RETURN sum(e.amount) OVER PATH p EDGES AS e (
  PARTITION BY p
  ORDER BY position(e)
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
) AS total`
      })
      .expect(400);

    expect(response.body.diagnostics[0]).toContain("unsupported");
  });
});
