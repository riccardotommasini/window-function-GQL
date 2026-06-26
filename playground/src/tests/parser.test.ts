import { describe, expect, test } from "vitest";
import { examples } from "../shared/examples";
import { parseWindowQuery, PlaygroundParseError } from "../shared/parser";

describe("parseWindowQuery", () => {
  test("parses row-window syntax and builds a hidden node partition", () => {
    const parsed = parseWindowQuery(examples[0].query);

    expect(parsed.kind).toBe("row-window");
    if (parsed.kind !== "row-window") {
      return;
    }

    expect(parsed.window.functionName).toBe("rank");
    expect(parsed.window.partitionBy).toEqual(["a"]);
    expect(parsed.hiddenColumns).toEqual([{ alias: "__gw_partition_0", expression: "a", role: "partition" }]);
    expect(parsed.spec).toMatchObject({
      function: "rank",
      as: "rankPerSource",
      partitionBy: ["__gw_partition_0"],
      orderBy: [{ column: "amount", direction: "DESC" }]
    });
    expect(parsed.visibleColumns).toEqual(["source", "target", "amount", "rankPerSource"]);
  });

  test("rewrites supported syntax to apoc.window.runRows", () => {
    const parsed = parseWindowQuery(examples[1].query);
    expect(parsed.kind).toBe("row-window");
    if (parsed.kind !== "row-window") {
      return;
    }

    expect(parsed.sourceQuery).toContain("RETURN a.name AS `source`");
    expect(parsed.apocQuery).toContain("WITH a.name AS `source`");
    expect(parsed.apocQuery).toContain("CALL apoc.window.runRows");
    expect(parsed.apocQuery).toContain("function: 'sum'");
    expect(parsed.apocQuery).toContain("ROWS");
    expect(parsed.apocQuery).toContain("RETURN __gw_row.`source` AS `source`");
    expect(parsed.apocQuery).not.toContain("__gw_partition_0 AS `__gw_partition_0`");
  });

  test("parses path-window syntax as unsupported", () => {
    const parsed = parseWindowQuery(examples.at(-1)!.query);

    expect(parsed.kind).toBe("unsupported-path-window");
    if (parsed.kind !== "unsupported-path-window") {
      return;
    }
    expect(parsed.pathVariable).toBe("p");
    expect(parsed.elementKind).toBe("EDGES");
    expect(parsed.elementAlias).toBe("e");
    expect(parsed.diagnostics[0]).toContain("unsupported");
  });

  test("rejects mutating clauses", () => {
    expect(() =>
      parseWindowQuery(`MATCH (n)
CREATE (:Scratch)
RETURN n.name AS name,
       row_number() OVER (ORDER BY name) AS rn`)
    ).toThrow(PlaygroundParseError);
  });

  test("current executable examples parse successfully", () => {
    const executableExamples = examples.filter((example) => example.supportedBackends.length > 0);
    expect(executableExamples.length).toBeGreaterThan(5);
    for (const example of executableExamples) {
      expect(parseWindowQuery(example.query).kind, example.id).toBe("row-window");
    }
  });
});
