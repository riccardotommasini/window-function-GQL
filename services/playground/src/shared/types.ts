export type BackendId = "apoc" | "neo4j-sqlite";

export interface BackendInfo {
  id: BackendId;
  label: string;
  description: string;
}

export interface PlaygroundExample {
  id: string;
  title: string;
  databaseId: string;
  description: string;
  query: string;
  supportedBackends: BackendId[];
  tags: string[];
}

export type WindowFunctionName = "rank" | "row_number" | "sum";
export type WindowClause = "RETURN" | "WITH";
export type SortDirection = "ASC" | "DESC";
export type FrameMode = "ROWS" | "RANGE" | "GROUPS";
export type FrameExclusion = "NO_OTHERS" | "CURRENT_ROW" | "GROUP" | "TIES";

export interface OrderItem {
  expression: string;
  direction: SortDirection;
  column?: string;
}

export type FrameBoundaryKind =
  | "UNBOUNDED_PRECEDING"
  | "CURRENT_ROW"
  | "UNBOUNDED_FOLLOWING"
  | "PRECEDING"
  | "FOLLOWING";

export interface FrameBoundary {
  kind: FrameBoundaryKind;
  value?: string;
}

export interface FrameSpecAst {
  mode: FrameMode;
  start: FrameBoundary;
  end: FrameBoundary;
  exclude?: FrameExclusion;
}

export interface ProjectionAst {
  expression: string;
  alias: string;
  source: string;
  isWindow: boolean;
}

export interface WindowExpressionAst {
  functionName: WindowFunctionName;
  inputExpression?: string;
  path?: {
    pathVariable: string;
    elementKind: "EDGES" | "NODES";
    elementAlias: string;
  };
  partitionBy: string[];
  orderBy: OrderItem[];
  frame?: FrameSpecAst;
  alias: string;
  raw: string;
}

export interface HiddenColumn {
  alias: string;
  expression: string;
  role: "partition" | "order" | "input" | "path";
}

export interface WindowSpecLiteral {
  function: WindowFunctionName;
  as: string;
  input?: string;
  partitionBy?: string[];
  orderBy: Array<{ column: string; direction: SortDirection }>;
  frame?: {
    mode: FrameMode;
    start: string | { type: "PRECEDING" | "FOLLOWING"; value: string | number };
    end: string | { type: "PRECEDING" | "FOLLOWING"; value: string | number };
    exclude?: FrameExclusion;
  };
}

export interface RowWindowParseResult {
  kind: "row-window";
  originalQuery: string;
  clause: WindowClause;
  preamble: string;
  projections: ProjectionAst[];
  visibleProjections: ProjectionAst[];
  hiddenColumns: HiddenColumn[];
  window: WindowExpressionAst;
  finalOrderBy?: string;
  finalOrderByItems: OrderItem[];
  sourceColumns: string[];
  visibleColumns: string[];
  sourceQuery: string;
  apocQuery: string;
  sqliteSql: string;
  spec: WindowSpecLiteral;
  diagnostics: string[];
}

export interface PathProjectionSpec {
  property: string;
  as: string;
}

export interface PathSpecLiteral {
  path: string;
  elements: "EDGES" | "NODES";
  elementAlias: string;
  positionAlias: string;
  project: PathProjectionSpec[];
}

export interface PathWindowParseResult {
  kind: "path-window";
  originalQuery: string;
  clause: WindowClause;
  preamble: string;
  pathVariable: string;
  elementKind: "EDGES" | "NODES";
  elementAlias: string;
  positionAlias: string;
  projections: ProjectionAst[];
  visibleProjections: ProjectionAst[];
  sourceProjections: ProjectionAst[];
  pathProjections: ProjectionAst[];
  hiddenSourceColumns: HiddenColumn[];
  hiddenPathProjections: PathProjectionSpec[];
  window: WindowExpressionAst;
  finalOrderBy?: string;
  finalOrderByItems: OrderItem[];
  sourceColumns: string[];
  visibleColumns: string[];
  sourceQuery: string;
  apocQuery: string;
  pathSpec: PathSpecLiteral;
  spec: WindowSpecLiteral;
  diagnostics: string[];
}

export type ParseResult = RowWindowParseResult | PathWindowParseResult;

export interface ParseRequest {
  query: string;
  includePartitionId?: boolean;
}

export interface ParseResponse {
  parse: ParseResult;
}

export interface RunRequest {
  query: string;
  backendId: BackendId;
  includePartitionId?: boolean;
}

export type ExecutionTimingMeasurement = "estimated-apoc" | "measured-sqlite";

export interface ExecutionTiming {
  sourceQueryMs: number;
  windowedQueryMs: number;
  windowOverheadMs: number;
  overheadPercentOfSource: number | null;
  measurement: ExecutionTimingMeasurement;
}

export interface RunResponse {
  backendId: BackendId;
  rewrite: string;
  sourceQuery?: string;
  sqliteSql?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  diagnostics: string[];
  durationMs: number;
  timing: ExecutionTiming;
}

export interface ApiErrorResponse {
  error: string;
  diagnostics?: string[];
}
