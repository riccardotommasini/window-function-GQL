import { performance } from "node:perf_hooks";
import { normalizeRecordForJson } from "../normalization";
import type { BackendAdapter } from "./types";

export const apocBackend: BackendAdapter = {
  async run(parsed, context) {
    const session = context.driver.session();

    try {
      const windowedStart = performance.now();
      const result = await session.run(parsed.apocQuery);
      const rows = result.records.map((record) => normalizeRecordForJson(record.toObject()));
      const windowedQueryMs = performance.now() - windowedStart;

      const sourceStart = performance.now();
      const sourceResult = await session.run(parsed.sourceQuery);
      for (const record of sourceResult.records) {
        record.toObject();
      }
      const sourceQueryMs = performance.now() - sourceStart;
      const windowOverheadMs = windowedQueryMs - sourceQueryMs;

      return {
        backendId: "apoc",
        rewrite: parsed.apocQuery,
        sourceQuery: parsed.sourceQuery,
        columns: parsed.visibleColumns,
        rows,
        diagnostics: parsed.diagnostics,
        durationMs: Math.round(windowedQueryMs),
        timing: {
          sourceQueryMs,
          windowedQueryMs,
          windowOverheadMs,
          overheadPercentOfSource: sourceQueryMs > 0 ? (windowOverheadMs / sourceQueryMs) * 100 : null,
          measurement: "estimated-apoc"
        }
      };
    } finally {
      await session.close();
    }
  }
};
