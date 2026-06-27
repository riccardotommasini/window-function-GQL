import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { quoteSqlIdentifier } from "../../shared/rewrite";
import type { RowWindowParseResult, RunResponse, WindowSpecLiteral } from "../../shared/types";
import { normalizeRecordForSqlite } from "../normalization";
import type { BackendAdapter } from "./types";

const requireFromCwd = createRequire(resolve(process.cwd(), "package.json"));
let sqlJsPromise: Promise<SqlJsStatic> | null = null;
type SqlValue = string | number | Uint8Array | null;

export const sqliteBackend: BackendAdapter = {
  async run(parsed, context) {
    if (parsed.kind !== "row-window") {
      throw new Error("Path-element windows are supported by the APOC backend only.");
    }

    assertSqliteCompatible(parsed.spec);
    const session = context.driver.session();

    try {
      const windowedStart = performance.now();
      const windowSourceResult = await session.run(parsed.sourceQuery);
      const sourceRows = windowSourceResult.records.map((record) => normalizeRecordForSqlite(record.toObject()));
      const sqliteRows = await runSqliteWindow(parsed, sourceRows);
      const windowedQueryMs = performance.now() - windowedStart;

      const sourceStart = performance.now();
      const sourceResult = await session.run(parsed.sourceQuery);
      for (const record of sourceResult.records) {
        normalizeRecordForSqlite(record.toObject());
      }
      const sourceQueryMs = performance.now() - sourceStart;
      const windowOverheadMs = windowedQueryMs - sourceQueryMs;

      return {
        backendId: "neo4j-sqlite",
        rewrite: parsed.sourceQuery,
        sourceQuery: parsed.sourceQuery,
        sqliteSql: parsed.sqliteSql,
        columns: parsed.visibleColumns,
        rows: sqliteRows,
        diagnostics: parsed.diagnostics,
        durationMs: Math.round(windowedQueryMs),
        timing: {
          sourceQueryMs,
          windowedQueryMs,
          windowOverheadMs,
          overheadPercentOfSource: sourceQueryMs > 0 ? (windowOverheadMs / sourceQueryMs) * 100 : null,
          measurement: "measured-sqlite"
        }
      };
    } finally {
      await session.close();
    }
  }
};

export async function runSqliteWindow(
  parsed: RowWindowParseResult,
  sourceRows: Array<Record<string, unknown>>
) {
  assertSqliteCompatible(parsed.spec);
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  try {
    createSourceRowsTable(db, parsed.sourceColumns);
    insertRows(db, parsed.sourceColumns, sourceRows);
    const result = db.exec(parsed.sqliteSql)[0];
    if (!result) {
      return [];
    }
    return result.values.map((values) =>
      Object.fromEntries(result.columns.map((column, index) => [column, values[index] ?? null]))
    );
  } finally {
    db.close();
  }
}

function getSqlJs() {
  sqlJsPromise ??= initSqlJs({
    locateFile: resolveSqlJsFile
  });
  return sqlJsPromise;
}

function resolveSqlJsFile(file: string) {
  for (const candidate of [
    resolve(process.cwd(), "node_modules/sql.js/dist", file),
    resolve(process.cwd(), "playground/node_modules/sql.js/dist", file)
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return requireFromCwd.resolve(`sql.js/dist/${file}`);
}

function createSourceRowsTable(db: Database, sourceColumns: string[]) {
  const definitions = [
    `${quoteSqlIdentifier("input_row_index")} INTEGER NOT NULL`,
    ...sourceColumns.map((column) => quoteSqlIdentifier(column))
  ];
  db.run(`CREATE TABLE source_rows (${definitions.join(", ")})`);
}

function insertRows(db: Database, sourceColumns: string[], rows: Array<Record<string, unknown>>) {
  const columns = ["input_row_index", ...sourceColumns];
  const placeholders = columns.map(() => "?").join(", ");
  const statement = db.prepare(
    `INSERT INTO source_rows (${columns.map(quoteSqlIdentifier).join(", ")}) VALUES (${placeholders})`
  );

  try {
    rows.forEach((row, index) => {
      statement.run([index, ...sourceColumns.map((column) => toSqlValue(row[column]))]);
    });
  } finally {
    statement.free();
  }
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return JSON.stringify(value);
}

function assertSqliteCompatible(spec: WindowSpecLiteral) {
  for (const boundary of [spec.frame?.start, spec.frame?.end]) {
    if (boundary && typeof boundary !== "string" && typeof boundary.value === "string" && !/^-?\d+(?:\.\d+)?$/.test(boundary.value)) {
      throw new Error("The Neo4j + SQLite backend supports only numeric frame offsets in V1.");
    }
  }
}
