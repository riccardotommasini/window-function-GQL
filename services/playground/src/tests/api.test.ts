import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(examplesResponse.body.examples[0].databaseId).toBe("gwl-demo/accounts-transfers");
    expect(backendsResponse.body.backends.map((backend: { id: string }) => backend.id)).toEqual([
      "apoc",
      "neo4j-sqlite"
    ]);
  });

  test("reloads examples from YAML on each request", async () => {
    const examplesPath = join(mkdtempSync(join(tmpdir(), "gwl-examples-")), "examples.yaml");
    writeFileSync(examplesPath, buildExamplesYaml("first-query", "First query", "gwl-demo/first"));
    const app = createApp({ examplesPath });

    const firstResponse = await request(app).get("/api/examples").expect(200);
    expect(firstResponse.body.examples).toMatchObject([
      {
        id: "first-query",
        title: "First query",
        databaseId: "gwl-demo/first"
      }
    ]);

    writeFileSync(examplesPath, buildExamplesYaml("second-query", "Second query", "gwl-demo/second"));

    const secondResponse = await request(app).get("/api/examples").expect(200);
    expect(secondResponse.body.examples).toMatchObject([
      {
        id: "second-query",
        title: "Second query",
        databaseId: "gwl-demo/second"
      }
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

function buildExamplesYaml(id: string, title: string, database: string) {
  return `examples:
  - id: ${id}
    title: ${title}
    database: ${database}
    description: Test query
    supportedBackends:
      - apoc
    tags:
      - test
    query: |
      MATCH (n)
      RETURN n.name AS name,
             row_number() OVER (ORDER BY name) AS rn
`;
}

  test("runs path windows through an injected APOC adapter", async () => {
    const adapter: BackendAdapter = {
      async run(parsed) {
        return {
          backendId: "apoc",
          rewrite: parsed.apocQuery,
          columns: parsed.visibleColumns,
          rows: [{ source: "Alice", position: 0, amount: 2500, cumulativeDistance: 2500 }],
          diagnostics: [],
          durationMs: 2,
          timing: {
            sourceQueryMs: 1,
            windowedQueryMs: 2,
            windowOverheadMs: 1,
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
        query: `MATCH p = (a:Account)-[:TRANSFER*]->(b:Account)
RETURN a.name AS source,
       position(e) AS position,
       e.amount AS amount,
       sum(e.amount) OVER PATH p EDGES AS e (
  PARTITION BY p
  ORDER BY position(e)
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
) AS total`
      })
      .expect(200);

    expect(response.body.rewrite).toContain("CALL apoc.window.runPathRows");
    expect(response.body.columns).toEqual(["source", "position", "amount", "total"]);
  });

  test("passes the partition id option into APOC rewrites", async () => {
    const adapter: BackendAdapter = {
      async run(parsed) {
        return {
          backendId: "apoc",
          rewrite: parsed.apocQuery,
          columns: parsed.visibleColumns,
          rows: [{ source: "Alice", rankPerSource: 1, partitionId: 1 }],
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
        includePartitionId: true,
        query: `MATCH (a:Account)-[t:TRANSFER]->(b:Account)
RETURN a.name AS source,
       rank() OVER (PARTITION BY a ORDER BY t.amount DESC) AS rankPerSource
ORDER BY source`
      })
      .expect(200);

    expect(response.body.rewrite).toContain("true // includePartitionId");
    expect(response.body.columns).toContain("partitionId");
  });

  test("reports that SQLite cannot run path windows", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/run")
      .send({
        backendId: "neo4j-sqlite",
        query: `MATCH p = (a:Account)-[:TRANSFER*]->(b:Account)
RETURN sum(e.amount) OVER PATH p EDGES AS e (
  PARTITION BY p
  ORDER BY position(e)
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
) AS total`
      })
      .expect(400);

    expect(response.body.error).toContain("APOC backend only");
  });
});
