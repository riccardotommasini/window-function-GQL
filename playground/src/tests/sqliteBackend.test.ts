import { describe, expect, test } from "vitest";
import { parseWindowQuery } from "../shared/parser";
import { runSqliteWindow } from "../server/backends/sqliteBackend";

describe("sqlite backend", () => {
  test("executes generated SQLite window SQL over source rows", async () => {
    const parsed = parseWindowQuery(`MATCH (p:Peer)
RETURN p.grp AS grp,
       p.name AS name,
       p.score AS score,
       row_number() OVER (
         PARTITION BY grp
         ORDER BY score DESC
       ) AS rowNumberValue
ORDER BY name`);

    expect(parsed.kind).toBe("row-window");
    if (parsed.kind !== "row-window") {
      return;
    }

    const rows = await runSqliteWindow(parsed, [
      { grp: "A", name: "peer-1", score: 10 },
      { grp: "A", name: "peer-2", score: 10 },
      { grp: "A", name: "peer-3", score: 5 }
    ]);

    expect(rows).toEqual([
      { grp: "A", name: "peer-1", score: 10, rowNumberValue: 1 },
      { grp: "A", name: "peer-2", score: 10, rowNumberValue: 2 },
      { grp: "A", name: "peer-3", score: 5, rowNumberValue: 3 }
    ]);
  });

  test("generates SQL for frame-sensitive sum", async () => {
    const parsed = parseWindowQuery(`MATCH (f:FrameRow)
RETURN f.name AS name,
       f.ord AS ord,
       f.amount AS amount,
       sum(f.amount) OVER (
         ORDER BY f.ord ASC
         ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
       ) AS windowSum
ORDER BY name`);

    expect(parsed.kind).toBe("row-window");
    if (parsed.kind !== "row-window") {
      return;
    }
    expect(parsed.sqliteSql).toContain("ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING");

    const rows = await runSqliteWindow(parsed, [
      { name: "r1", ord: 10, amount: 1 },
      { name: "r2", ord: 10, amount: 2 },
      { name: "r3", ord: 20, amount: 3 }
    ]);

    expect(rows.map((row) => row.windowSum)).toEqual([3, 6, 5]);
  });
});
