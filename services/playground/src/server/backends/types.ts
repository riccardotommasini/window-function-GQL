import type { Driver } from "neo4j-driver";
import type { PathWindowParseResult, RowWindowParseResult, RunResponse } from "../../shared/types";

export type ExecutableParseResult = RowWindowParseResult | PathWindowParseResult;

export interface BackendContext {
  driver: Driver;
}

export interface BackendAdapter {
  run(parsed: ExecutableParseResult, context: BackendContext): Promise<RunResponse>;
}
