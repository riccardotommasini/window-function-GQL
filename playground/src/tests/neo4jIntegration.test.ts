import neo4j from "neo4j-driver";
import { describe, expect, test } from "vitest";
import { parseWindowQuery } from "../shared/parser";
import { apocBackend } from "../server/backends/apocBackend";
import { loadExamples } from "../server/exampleCatalog";

const examples = loadExamples();

describe("local Neo4j integration", () => {
  test(
    "runs the APOC backend when local Neo4j is reachable",
    async () => {
      const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
      const user = process.env.NEO4J_USER;
      const password = process.env.NEO4J_PASSWORD ?? "";
      const driver = user
        ? neo4j.driver(uri, neo4j.auth.basic(user, password), { connectionTimeout: 1000 })
        : neo4j.driver(uri, undefined, { connectionTimeout: 1000 });

      try {
        await driver.verifyConnectivity();
      } catch {
        await driver.close();
        return;
      }

      try {
        const parsed = parseWindowQuery(examples[0].query);
        expect(parsed.kind).toBe("row-window");
        if (parsed.kind !== "row-window") {
          return;
        }

        const result = await apocBackend.run(parsed, { driver });
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.columns).toContain("rankPerSource");
        expect(result.timing.measurement).toBe("estimated-apoc");
      } finally {
        await driver.close();
      }
    },
    30000
  );
});
