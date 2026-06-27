import { describe, expect, test } from "vitest";
import { tokenizeSyntax } from "../client/syntaxHighlight";

describe("syntax highlighting", () => {
  test("classifies GQL window syntax tokens", () => {
    const tokens = tokenizeSyntax(
      `MATCH (f:FrameRow)
RETURN sum(f.amount) OVER (
  ORDER BY f.ord ASC
  ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
) AS windowSum`,
      "gql"
    );

    expect(tokens).toContainEqual({ kind: "keyword", value: "MATCH" });
    expect(tokens).toContainEqual({ kind: "function", value: "sum" });
    expect(tokens).toContainEqual({ kind: "keyword", value: "OVER" });
    expect(tokens).toContainEqual({ kind: "number", value: "1" });
  });

  test("classifies APOC procedures and SQL keywords", () => {
    expect(tokenizeSyntax("CALL apoc.window.runRows(__gw_rows, {})", "cypher")).toContainEqual({
      kind: "procedure",
      value: "apoc.window.runRows"
    });
    expect(tokenizeSyntax('SELECT "source" FROM source_rows', "sql")).toContainEqual({
      kind: "keyword",
      value: "SELECT"
    });
  });
});
