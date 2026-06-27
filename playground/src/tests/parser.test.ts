import { describe, expect, test } from "vitest";
import { parseWindowQuery, PlaygroundParseError } from "../shared/parser";
import { loadExamples } from "../server/exampleCatalog";

const examples = loadExamples();

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
    expect(parsed.apocQuery).toContain(`CALL apoc.window.runRows(\n  __gw_rows,\n  {`);
    expect(parsed.apocQuery).toContain("function: 'sum'");
    expect(parsed.apocQuery).toContain("ROWS");
    expect(parsed.apocQuery).toContain("RETURN __gw_row.`source` AS `source`");
    expect(parsed.apocQuery).not.toContain("__gw_partition_0 AS `__gw_partition_0`");
  });

  test("parses path-window syntax and rewrites to runPathRows", () => {
    const parsed = parseWindowQuery(examples.at(-1)!.query);

    expect(parsed.kind).toBe("path-window");
    if (parsed.kind !== "path-window") {
      return;
    }
    expect(parsed.pathVariable).toBe("p");
    expect(parsed.elementKind).toBe("EDGES");
    expect(parsed.elementAlias).toBe("e");
    expect(parsed.pathSpec).toMatchObject({
      path: "p",
      elements: "EDGES",
      elementAlias: "e",
      positionAlias: "position",
      project: [{ property: "amount", as: "amount" }]
    });
    expect(parsed.spec).toMatchObject({
      function: "sum",
      input: "amount",
      as: "cumulativeDistance",
      partitionBy: ["p"],
      orderBy: [{ column: "position", direction: "ASC" }]
    });
    expect(parsed.apocQuery).toContain("CALL apoc.window.runPathRows");
    expect(parsed.apocQuery).toContain(`CALL apoc.window.runPathRows(\n  __gw_rows,\n  {`);
    expect(parsed.apocQuery).toContain(`project: [\n      {`);
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
      expect(["row-window", "path-window"]).toContain(parseWindowQuery(example.query).kind);
    }
  });
});
