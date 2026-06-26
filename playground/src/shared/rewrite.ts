import type {
  FrameBoundary,
  FrameSpecAst,
  HiddenColumn,
  OrderItem,
  ProjectionAst,
  RowWindowParseResult,
  WindowClause,
  WindowExpressionAst,
  WindowSpecLiteral
} from "./types";

interface RowWindowArtifactInput {
  originalQuery: string;
  clause: WindowClause;
  preamble: string;
  projections: ProjectionAst[];
  visibleProjections: ProjectionAst[];
  window: WindowExpressionAst;
  finalOrderBy?: string;
  finalOrderByItems: OrderItem[];
}

interface ColumnPlan {
  hiddenColumns: HiddenColumn[];
  spec: WindowSpecLiteral;
}

export function buildRowWindowArtifacts(input: RowWindowArtifactInput): RowWindowParseResult {
  const { hiddenColumns, spec } = buildColumnPlan(input.visibleProjections, input.window);
  const sourceColumns = [
    ...input.visibleProjections.map((projection) => projection.alias),
    ...hiddenColumns.map((column) => column.alias)
  ];
  const visibleColumns = [...input.visibleProjections.map((projection) => projection.alias), input.window.alias];
  const sourceQuery = buildSourceQuery(input.preamble, input.visibleProjections, hiddenColumns, "RETURN");
  const apocSourceQuery = buildSourceQuery(input.preamble, input.visibleProjections, hiddenColumns, "WITH");
  const apocQuery = buildApocQuery(apocSourceQuery, sourceColumns, visibleColumns, input.finalOrderBy, spec);
  const sqliteSql = buildSqliteSql(visibleColumns, input.finalOrderByItems, spec);

  return {
    kind: "row-window",
    originalQuery: input.originalQuery,
    clause: input.clause,
    preamble: input.preamble,
    projections: input.projections,
    visibleProjections: input.visibleProjections,
    hiddenColumns,
    window: input.window,
    finalOrderBy: input.finalOrderBy,
    finalOrderByItems: input.finalOrderByItems,
    sourceColumns,
    visibleColumns,
    sourceQuery,
    apocQuery,
    sqliteSql,
    spec,
    diagnostics: []
  };
}

function buildColumnPlan(visibleProjections: ProjectionAst[], window: WindowExpressionAst): ColumnPlan {
  const hiddenColumns: HiddenColumn[] = [];
  const expressionToAlias = new Map<string, string>();
  const aliasToAlias = new Map<string, string>();

  for (const projection of visibleProjections) {
    aliasToAlias.set(projection.alias, projection.alias);
    expressionToAlias.set(normalizeExpression(projection.expression), projection.alias);
  }

  const resolveColumn = (expression: string, role: HiddenColumn["role"]) => {
    const trimmed = expression.trim();
    const aliasMatch = aliasToAlias.get(trimmed);
    if (aliasMatch) {
      return aliasMatch;
    }

    const expressionMatch = expressionToAlias.get(normalizeExpression(trimmed));
    if (expressionMatch) {
      return expressionMatch;
    }

    const existing = hiddenColumns.find((column) => normalizeExpression(column.expression) === normalizeExpression(trimmed));
    if (existing) {
      return existing.alias;
    }

    const alias = `__gw_${role}_${hiddenColumns.filter((column) => column.role === role).length}`;
    hiddenColumns.push({ alias, expression: trimmed, role });
    return alias;
  };

  const spec: WindowSpecLiteral = {
    function: window.functionName,
    as: window.alias,
    orderBy: window.orderBy.map((item) => ({
      column: resolveColumn(item.expression, "order"),
      direction: item.direction
    }))
  };

  if (window.inputExpression) {
    spec.input = resolveColumn(window.inputExpression, "input");
  }
  if (window.partitionBy.length > 0) {
    spec.partitionBy = window.partitionBy.map((expression) => resolveColumn(expression, "partition"));
  }
  if (window.frame) {
    spec.frame = frameToSpec(window.frame);
  }

  return { hiddenColumns, spec };
}

function buildSourceQuery(
  preamble: string,
  visibleProjections: ProjectionAst[],
  hiddenColumns: HiddenColumn[],
  projectionClause: "WITH" | "RETURN"
) {
  const projectionLines = [
    ...visibleProjections.map((projection) => `${projection.expression} AS ${quoteCypherIdentifier(projection.alias)}`),
    ...hiddenColumns.map((column) => `${column.expression} AS ${quoteCypherIdentifier(column.alias)}`)
  ];

  return `${preamble}\n${projectionClause} ${projectionLines.join(",\n     ")}`;
}

function buildApocQuery(
  sourceQuery: string,
  sourceColumns: string[],
  visibleColumns: string[],
  finalOrderBy: string | undefined,
  spec: WindowSpecLiteral
) {
  const rowMap = sourceColumns
    .map((column) => `${quoteCypherIdentifier(column)}: ${quoteCypherIdentifier(column)}`)
    .join(", ");
  const returnItems = visibleColumns
    .map((column) => `__gw_row.${quoteCypherIdentifier(column)} AS ${quoteCypherIdentifier(column)}`)
    .join(",\n       ");

  return [
    sourceQuery,
    `WITH collect({${rowMap}}) AS __gw_rows`,
    `CALL apoc.window.runRows(__gw_rows, ${specToCypherLiteral(spec)}, false)`,
    "YIELD row AS __gw_row",
    `RETURN ${returnItems}`,
    finalOrderBy ? `ORDER BY ${finalOrderBy}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSqliteSql(
  visibleColumns: string[],
  finalOrderByItems: OrderItem[],
  spec: WindowSpecLiteral
) {
  const outputAlias = spec.as;
  const selectColumns = visibleColumns
    .filter((column) => column !== outputAlias)
    .map((column) => quoteSqlIdentifier(column));
  const windowExpression = sqliteWindowExpression(spec);
  const orderClause =
    finalOrderByItems.length > 0
      ? `\nORDER BY ${finalOrderByItems
          .map((item) => `${quoteSqlIdentifier(item.expression)} ${item.direction}`)
          .join(", ")}`
      : "\nORDER BY input_row_index ASC";

  return `SELECT ${[...selectColumns, `${windowExpression} AS ${quoteSqlIdentifier(outputAlias)}`].join(",\n       ")}
FROM source_rows${orderClause}`;
}

function sqliteWindowExpression(spec: WindowSpecLiteral) {
  const overParts: string[] = [];
  if (spec.partitionBy && spec.partitionBy.length > 0) {
    overParts.push(`PARTITION BY ${spec.partitionBy.map(quoteSqlIdentifier).join(", ")}`);
  }
  if (spec.orderBy.length > 0) {
    overParts.push(
      `ORDER BY ${[
        ...spec.orderBy.map((item) => `${quoteSqlIdentifier(item.column)} ${item.direction}`),
        "input_row_index ASC"
      ].join(", ")}`
    );
  }
  if (spec.frame) {
    overParts.push(frameToSql(spec.frame));
  }

  const over = `OVER (${overParts.join(" ")})`;
  if (spec.function === "rank") {
    return `RANK() ${over}`;
  }
  if (spec.function === "row_number") {
    return `ROW_NUMBER() ${over}`;
  }
  return `SUM(${quoteSqlIdentifier(spec.input ?? "")}) ${over}`;
}

function frameToSpec(frame: FrameSpecAst): NonNullable<WindowSpecLiteral["frame"]> {
  return {
    mode: frame.mode,
    start: boundaryToSpec(frame.start),
    end: boundaryToSpec(frame.end),
    ...(frame.exclude ? { exclude: frame.exclude } : {})
  };
}

function boundaryToSpec(boundary: FrameBoundary) {
  if (boundary.kind === "PRECEDING" || boundary.kind === "FOLLOWING") {
    return {
      type: boundary.kind,
      value: numericOrRaw(boundary.value ?? "0")
    };
  }
  return boundary.kind;
}

function frameToSql(frame: NonNullable<WindowSpecLiteral["frame"]>) {
  const exclude = frame.exclude ? ` EXCLUDE ${frame.exclude.replace("_", " ")}` : "";
  return `${frame.mode} BETWEEN ${boundaryToSql(frame.start)} AND ${boundaryToSql(frame.end)}${exclude}`;
}

function boundaryToSql(boundary: NonNullable<WindowSpecLiteral["frame"]>["start"]) {
  if (typeof boundary === "string") {
    return boundary.replaceAll("_", " ");
  }
  return `${boundary.value} ${boundary.type}`;
}

function specToCypherLiteral(spec: WindowSpecLiteral): string {
  const entries = [
    `function: ${quoteCypherString(spec.function)}`,
    spec.input ? `input: ${quoteCypherString(spec.input)}` : "",
    `as: ${quoteCypherString(spec.as)}`,
    spec.partitionBy ? `partitionBy: [${spec.partitionBy.map(quoteCypherString).join(", ")}]` : "",
    `orderBy: [${spec.orderBy
      .map((item) => `{column: ${quoteCypherString(item.column)}, direction: ${quoteCypherString(item.direction)}}`)
      .join(", ")}]`,
    spec.frame ? `frame: ${frameSpecToCypherLiteral(spec.frame)}` : ""
  ].filter(Boolean);

  return `{${entries.join(", ")}}`;
}

function frameSpecToCypherLiteral(frame: NonNullable<WindowSpecLiteral["frame"]>) {
  const entries = [
    `mode: ${quoteCypherString(frame.mode)}`,
    `start: ${boundaryToCypherLiteral(frame.start)}`,
    `end: ${boundaryToCypherLiteral(frame.end)}`,
    frame.exclude ? `exclude: ${quoteCypherString(frame.exclude)}` : ""
  ].filter(Boolean);
  return `{${entries.join(", ")}}`;
}

function boundaryToCypherLiteral(boundary: NonNullable<WindowSpecLiteral["frame"]>["start"]) {
  if (typeof boundary === "string") {
    return quoteCypherString(boundary);
  }
  return `{type: ${quoteCypherString(boundary.type)}, value: ${cypherValueLiteral(boundary.value)}}`;
}

function cypherValueLiteral(value: string | number) {
  if (typeof value === "number") {
    return String(value);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }
  if (/^(?:duration|date|datetime|localdatetime|time|localtime)\s*\(/i.test(value)) {
    return value;
  }
  return quoteCypherString(value);
}

function numericOrRaw(value: string): string | number {
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
}

export function normalizeExpression(expression: string) {
  return expression.trim().replace(/\s+/g, " ");
}

export function quoteCypherIdentifier(identifier: string) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

export function quoteCypherString(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function quoteSqlIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
