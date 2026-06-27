import type {
  FrameBoundary,
  FrameSpecAst,
  HiddenColumn,
  OrderItem,
  PathProjectionSpec,
  PathSpecLiteral,
  PathWindowParseResult,
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

interface PathWindowArtifactInput extends RowWindowArtifactInput {
  pathVariable: string;
  elementKind: "EDGES" | "NODES";
  elementAlias: string;
}

interface ColumnPlan {
  hiddenColumns: HiddenColumn[];
  spec: WindowSpecLiteral;
}

interface PathColumnPlan {
  sourceProjections: ProjectionAst[];
  pathProjections: ProjectionAst[];
  hiddenSourceColumns: HiddenColumn[];
  hiddenPathProjections: PathProjectionSpec[];
  positionAlias: string;
  pathSpec: PathSpecLiteral;
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

export function buildPathWindowArtifacts(input: PathWindowArtifactInput): PathWindowParseResult {
  const plan = buildPathColumnPlan(input);
  const sourceColumns = [
    ...plan.sourceProjections.map((projection) => projection.alias),
    ...plan.hiddenSourceColumns.map((column) => column.alias)
  ];
  const visibleColumns = [
    ...plan.sourceProjections.map((projection) => projection.alias),
    ...plan.pathProjections.map((projection) => projection.alias),
    input.window.alias
  ];
  const sourceQuery = buildSourceQuery(input.preamble, plan.sourceProjections, plan.hiddenSourceColumns, "RETURN");
  const apocSourceQuery = buildSourceQuery(input.preamble, plan.sourceProjections, plan.hiddenSourceColumns, "WITH");
  const apocQuery = buildPathApocQuery(
    apocSourceQuery,
    sourceColumns,
    visibleColumns,
    input.finalOrderBy,
    plan.pathSpec,
    plan.spec
  );

  return {
    kind: "path-window",
    originalQuery: input.originalQuery,
    clause: input.clause,
    preamble: input.preamble,
    pathVariable: input.pathVariable,
    elementKind: input.elementKind,
    elementAlias: input.elementAlias,
    positionAlias: plan.positionAlias,
    projections: input.projections,
    visibleProjections: input.visibleProjections,
    sourceProjections: plan.sourceProjections,
    pathProjections: plan.pathProjections,
    hiddenSourceColumns: plan.hiddenSourceColumns,
    hiddenPathProjections: plan.hiddenPathProjections,
    window: input.window,
    finalOrderBy: input.finalOrderBy,
    finalOrderByItems: input.finalOrderByItems,
    sourceColumns,
    visibleColumns,
    sourceQuery,
    apocQuery,
    pathSpec: plan.pathSpec,
    spec: plan.spec,
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

function buildPathColumnPlan(input: PathWindowArtifactInput): PathColumnPlan {
  const sourceProjections: ProjectionAst[] = [];
  const pathProjections: ProjectionAst[] = [];
  const hiddenSourceColumns: HiddenColumn[] = [];
  const hiddenPathProjections: PathProjectionSpec[] = [];
  const sourceExpressionToAlias = new Map<string, string>();
  const sourceAliasToAlias = new Map<string, string>();
  const pathExpressionToAlias = new Map<string, string>();
  const pathProjectKeyToAlias = new Map<string, string>();
  let positionAlias = "";

  const reserveSourceProjection = (projection: ProjectionAst) => {
    sourceProjections.push(projection);
    sourceAliasToAlias.set(projection.alias, projection.alias);
    sourceExpressionToAlias.set(normalizeExpression(projection.expression), projection.alias);
  };

  const reservePathProjection = (projection: ProjectionAst, expressionAlias: string) => {
    pathProjections.push(projection);
    pathExpressionToAlias.set(normalizeExpression(projection.expression), projection.alias);
    pathExpressionToAlias.set(expressionAlias, projection.alias);
  };

  for (const projection of input.visibleProjections) {
    const pathReference = parsePathReference(projection.expression, input.elementAlias);
    if (!pathReference) {
      if (referencesElementAlias(projection.expression, input.elementAlias)) {
        throw new Error(
          `Path-element projection '${projection.source}' is unsupported; use ${input.elementAlias}.property or position(${input.elementAlias}).`
        );
      }
      reserveSourceProjection(projection);
      continue;
    }

    if (pathReference.kind === "position") {
      if (positionAlias && positionAlias !== projection.alias) {
        throw new Error("Only one visible position(element) alias is supported in a path-window query.");
      }
      positionAlias = projection.alias;
      reservePathProjection(projection, pathReference.expressionAlias);
      continue;
    }

    pathProjectKeyToAlias.set(pathReference.property, projection.alias);
    reservePathProjection(projection, pathReference.expressionAlias);
  }

  const usedAliases = new Set([
    ...sourceProjections.map((projection) => projection.alias),
    ...pathProjections.map((projection) => projection.alias),
    input.window.alias
  ]);

  const uniqueAlias = (base: string) => {
    let candidate = base;
    let index = 0;
    while (usedAliases.has(candidate)) {
      candidate = `${base}_${index++}`;
    }
    usedAliases.add(candidate);
    return candidate;
  };

  positionAlias ||= uniqueAlias("__gw_position");
  pathExpressionToAlias.set(`position(${input.elementAlias})`, positionAlias);

  const ensureSourceColumn = (expression: string, role: HiddenColumn["role"]) => {
    const trimmed = expression.trim();
    const aliasMatch = sourceAliasToAlias.get(trimmed);
    if (aliasMatch) {
      return aliasMatch;
    }

    const expressionMatch = sourceExpressionToAlias.get(normalizeExpression(trimmed));
    if (expressionMatch) {
      return expressionMatch;
    }

    const existing = hiddenSourceColumns.find(
      (column) => normalizeExpression(column.expression) === normalizeExpression(trimmed)
    );
    if (existing) {
      return existing.alias;
    }

    const preferredAlias = role === "path" && isSimpleIdentifier(trimmed) ? trimmed : `__gw_${role}_${hiddenSourceColumns.filter((column) => column.role === role).length}`;
    const alias = usedAliases.has(preferredAlias) ? uniqueAlias(preferredAlias) : preferredAlias;
    usedAliases.add(alias);
    hiddenSourceColumns.push({ alias, expression: trimmed, role });
    sourceAliasToAlias.set(alias, alias);
    sourceExpressionToAlias.set(normalizeExpression(trimmed), alias);
    return alias;
  };

  const ensurePathProperty = (property: string, role: HiddenColumn["role"], expressionAlias: string) => {
    const existing = pathExpressionToAlias.get(expressionAlias);
    if (existing) {
      return existing;
    }

    const visibleAlias = pathProjectKeyToAlias.get(property);
    if (visibleAlias) {
      pathExpressionToAlias.set(expressionAlias, visibleAlias);
      return visibleAlias;
    }

    const alias = uniqueAlias(`__gw_${role}_${hiddenPathProjections.filter((projection) => projection.as.startsWith(`__gw_${role}_`)).length}`);
    hiddenPathProjections.push({ property, as: alias });
    pathProjectKeyToAlias.set(property, alias);
    pathExpressionToAlias.set(expressionAlias, alias);
    return alias;
  };

  const resolveExpandedColumn = (expression: string, role: HiddenColumn["role"]) => {
    const pathReference = parsePathReference(expression, input.elementAlias);
    if (pathReference?.kind === "position") {
      return positionAlias;
    }
    if (pathReference?.kind === "property") {
      return ensurePathProperty(pathReference.property, role, pathReference.expressionAlias);
    }
    if (referencesElementAlias(expression, input.elementAlias)) {
      throw new Error(
        `Path-element expression '${expression}' is unsupported; use ${input.elementAlias}.property or position(${input.elementAlias}).`
      );
    }
    return ensureSourceColumn(expression, role);
  };

  const pathAlias = ensureSourceColumn(input.pathVariable, "path");
  const spec: WindowSpecLiteral = {
    function: input.window.functionName,
    as: input.window.alias,
    orderBy: input.window.orderBy.map((item) => ({
      column: resolveExpandedColumn(item.expression, "order"),
      direction: item.direction
    }))
  };

  if (input.window.inputExpression) {
    spec.input = resolveExpandedColumn(input.window.inputExpression, "input");
  }
  if (input.window.partitionBy.length > 0) {
    spec.partitionBy = input.window.partitionBy.map((expression) => resolveExpandedColumn(expression, "partition"));
  }
  if (input.window.frame) {
    spec.frame = frameToSpec(input.window.frame);
  }

  const project = [
    ...pathProjections
      .map((projection) => parsePathReference(projection.expression, input.elementAlias))
      .filter((reference): reference is Extract<NonNullable<ReturnType<typeof parsePathReference>>, { kind: "property" }> => reference?.kind === "property")
      .map((reference) => ({ property: reference.property, as: pathExpressionToAlias.get(reference.expressionAlias) ?? reference.property })),
    ...hiddenPathProjections
  ];

  return {
    sourceProjections,
    pathProjections,
    hiddenSourceColumns,
    hiddenPathProjections,
    positionAlias,
    pathSpec: {
      path: pathAlias,
      elements: input.elementKind,
      elementAlias: input.elementAlias,
      positionAlias,
      project: dedupeProjects(project)
    },
    spec
  };
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
  const rowMap = mapLiteral(
    sourceColumns.map((column) => `${quoteCypherIdentifier(column)}: ${quoteCypherIdentifier(column)}`)
  );
  const returnItems = visibleColumns
    .map((column) => `__gw_row.${quoteCypherIdentifier(column)} AS ${quoteCypherIdentifier(column)}`)
    .join(",\n       ");

  return [
    sourceQuery,
    `WITH collect(${rowMap}) AS __gw_rows`,
    [
      "CALL apoc.window.runRows(",
      "  __gw_rows,",
      `${indentBlock(specToCypherLiteral(spec), 2)},`,
      "  false",
      ")"
    ].join("\n"),
    "YIELD row AS __gw_row",
    `RETURN ${returnItems}`,
    finalOrderBy ? `ORDER BY ${finalOrderBy}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPathApocQuery(
  sourceQuery: string,
  sourceColumns: string[],
  visibleColumns: string[],
  finalOrderBy: string | undefined,
  pathSpec: PathSpecLiteral,
  spec: WindowSpecLiteral
) {
  const rowMap = mapLiteral(
    sourceColumns.map((column) => `${quoteCypherIdentifier(column)}: ${quoteCypherIdentifier(column)}`)
  );
  const returnItems = visibleColumns
    .map((column) => `__gw_row.${quoteCypherIdentifier(column)} AS ${quoteCypherIdentifier(column)}`)
    .join(",\n       ");

  return [
    sourceQuery,
    `WITH collect(${rowMap}) AS __gw_rows`,
    [
      "CALL apoc.window.runPathRows(",
      "  __gw_rows,",
      `${indentBlock(pathSpecToCypherLiteral(pathSpec), 2)},`,
      `${indentBlock(specToCypherLiteral(spec), 2)},`,
      "  false",
      ")"
    ].join("\n"),
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
    spec.partitionBy ? `partitionBy: ${listLiteral(spec.partitionBy.map(quoteCypherString))}` : "",
    `orderBy: ${listLiteral(
      spec.orderBy.map((item) =>
        mapLiteral([
          `column: ${quoteCypherString(item.column)}`,
          `direction: ${quoteCypherString(item.direction)}`
        ])
      )
    )}`,
    spec.frame ? `frame: ${frameSpecToCypherLiteral(spec.frame)}` : ""
  ].filter(Boolean);

  return mapLiteral(entries);
}

function pathSpecToCypherLiteral(pathSpec: PathSpecLiteral): string {
  const entries = [
    `path: ${quoteCypherString(pathSpec.path)}`,
    `elements: ${quoteCypherString(pathSpec.elements)}`,
    `elementAlias: ${quoteCypherString(pathSpec.elementAlias)}`,
    `positionAlias: ${quoteCypherString(pathSpec.positionAlias)}`,
    `project: ${listLiteral(
      pathSpec.project.map((projection) =>
        mapLiteral([
          `property: ${quoteCypherString(projection.property)}`,
          `as: ${quoteCypherString(projection.as)}`
        ])
      )
    )}`
  ];

  return mapLiteral(entries);
}

function frameSpecToCypherLiteral(frame: NonNullable<WindowSpecLiteral["frame"]>) {
  const entries = [
    `mode: ${quoteCypherString(frame.mode)}`,
    `start: ${boundaryToCypherLiteral(frame.start)}`,
    `end: ${boundaryToCypherLiteral(frame.end)}`,
    frame.exclude ? `exclude: ${quoteCypherString(frame.exclude)}` : ""
  ].filter(Boolean);
  return mapLiteral(entries);
}

function boundaryToCypherLiteral(boundary: NonNullable<WindowSpecLiteral["frame"]>["start"]) {
  if (typeof boundary === "string") {
    return quoteCypherString(boundary);
  }
  return mapLiteral([
    `type: ${quoteCypherString(boundary.type)}`,
    `value: ${cypherValueLiteral(boundary.value)}`
  ]);
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

function mapLiteral(entries: string[]): string {
  if (entries.length === 0) {
    return "{}";
  }
  return `{\n${entries.map((entry) => indentBlock(entry, 2)).join(",\n")}\n}`;
}

function listLiteral(items: string[]): string {
  if (items.length === 0) {
    return "[]";
  }
  return `[\n${items.map((item) => indentBlock(item, 2)).join(",\n")}\n]`;
}

function indentBlock(text: string, spaces: number) {
  const indentation = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function parsePathReference(expression: string, elementAlias: string):
  | { kind: "position"; expressionAlias: string }
  | { kind: "property"; property: string; expressionAlias: string }
  | null {
  const trimmed = normalizeExpression(expression);
  const quotedElement = escapeRegExp(elementAlias);
  const positionMatch = trimmed.match(new RegExp(`^position\\s*\\(\\s*${quotedElement}\\s*\\)$`, "i"));
  if (positionMatch) {
    return { kind: "position", expressionAlias: `position(${elementAlias})` };
  }

  const propertyMatch = trimmed.match(new RegExp(`^${quotedElement}\\.(?:\`([^\`]+)\`|([A-Za-z_][A-Za-z0-9_]*))$`));
  if (propertyMatch) {
    const property = propertyMatch[1] ?? propertyMatch[2];
    return { kind: "property", property, expressionAlias: `${elementAlias}.${property}` };
  }

  return null;
}

function referencesElementAlias(expression: string, elementAlias: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(elementAlias)}\\b`);
  return pattern.test(expression);
}

function dedupeProjects(projects: PathProjectionSpec[]) {
  const seen = new Set<string>();
  const deduped: PathProjectionSpec[] = [];
  for (const project of projects) {
    const key = `${project.property}\u0000${project.as}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(project);
    }
  }
  return deduped;
}

function isSimpleIdentifier(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
