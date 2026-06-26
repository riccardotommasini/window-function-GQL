import type { Driver } from "neo4j-driver";
import type { RowWindowParseResult, RunResponse } from "../../shared/types";

export interface BackendContext {
  driver: Driver;
}

export interface BackendAdapter {
  run(parsed: RowWindowParseResult, context: BackendContext): Promise<RunResponse>;
}
