import { buildPathWindowArtifacts, buildRowWindowArtifacts, normalizeExpression } from "./rewrite";
import type {
  FrameBoundary,
  FrameExclusion,
  FrameMode,
  FrameSpecAst,
  OrderItem,
  ParseResult,
  ProjectionAst,
  SortDirection,
  WindowClause,
  WindowExpressionAst,
  WindowFunctionName
} from "./types";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MUTATING_PATTERN =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|ALTER|LOAD\s+CSV|FOREACH)\b|\bCALL\s+(?:dbms|apoc\.periodic)\b/i;

export class PlaygroundParseError extends Error {
  readonly diagnostics: string[];

  constructor(message: string, diagnostics: string[] = [message]) {
    super(message);
    this.name = "PlaygroundParseError";
    this.diagnostics = diagnostics;
  }
}

export function parseWindowQuery(query: string): ParseResult {
  const originalQuery = query.trim().replace(/;+\s*$/, "");
  if (!originalQuery) {
    throw new PlaygroundParseError("Enter a query before parsing.");
  }

  rejectMutatingClauses(originalQuery);

  const projectionClause = findLastProjectionClause(originalQuery);
  if (!projectionClause) {
    throw new PlaygroundParseError("Expected a top-level RETURN or WITH clause.");
  }

  const { clause, position } = projectionClause;
  const preamble = originalQuery.slice(0, position).trim();
  const projectionAndTail = originalQuery.slice(position + clause.length).trim();
  const orderPosition = findTopLevelKeyword(projectionAndTail, "ORDER BY");
  const projectionText =
    orderPosition === -1 ? projectionAndTail : projectionAndTail.slice(0, orderPosition).trim();
  const finalOrderBy =
    orderPosition === -1
      ? undefined
      : projectionAndTail.slice(orderPosition + "ORDER BY".length).trim();

  if (!preamble) {
    throw new PlaygroundParseError("The playground expects a graph binding query before the window projection.");
  }

  const projections = splitTopLevel(projectionText, ",").map(parseProjection);
  const windowProjections = projections.filter((projection) => projection.isWindow);
  if (windowProjections.length !== 1) {
    throw new PlaygroundParseError(
      "V1 supports exactly one window expression in the RETURN/WITH projection.",
      [`Found ${windowProjections.length} window expressions; expected exactly one.`]
    );
  }

  const windowProjection = windowProjections[0];
  const window = parseWindowExpression(windowProjection.expression, windowProjection.alias);
  const visibleProjections = projections.filter((projection) => !projection.isWindow);
  const finalOrderByItems = finalOrderBy ? parseOrderItems(finalOrderBy) : [];
  validateFinalOrderBy(finalOrderByItems, visibleProjections, window.alias);

  if (window.path) {
    try {
      return buildPathWindowArtifacts({
        originalQuery,
        clause,
        preamble,
        projections,
        visibleProjections,
        window,
        finalOrderBy,
        finalOrderByItems,
        pathVariable: window.path.pathVariable,
        elementKind: window.path.elementKind,
        elementAlias: window.path.elementAlias
      });
    } catch (error) {
      throw new PlaygroundParseError(error instanceof Error ? error.message : "Path-window rewrite failed.");
    }
  }

  return buildRowWindowArtifacts({
    originalQuery,
    clause,
    preamble,
    projections,
    visibleProjections,
    window,
    finalOrderBy,
    finalOrderByItems
  });
}

function rejectMutatingClauses(query: string) {
  const searchable = stripQuotedText(query);
  const match = searchable.match(MUTATING_PATTERN);
  if (match) {
    throw new PlaygroundParseError(
      `Mutating clause '${match[0].trim()}' is not allowed in the playground.`,
      ["Only read-only MATCH/WITH/RETURN/ORDER BY style queries are accepted."]
    );
  }
}

function findLastProjectionClause(query: string): { clause: WindowClause; position: number } | null {
  const matches: Array<{ clause: WindowClause; position: number }> = [];
  scanTopLevel(query, (position) => {
    if (matchesKeywordAt(query, position, "RETURN")) {
      matches.push({ clause: "RETURN", position });
    }
    if (matchesKeywordAt(query, position, "WITH")) {
      matches.push({ clause: "WITH", position });
    }
  });
  return matches.at(-1) ?? null;
}

function parseProjection(source: string): ProjectionAst {
  const trimmed = source.trim();
  const asPosition = findLastTopLevelKeyword(trimmed, "AS");
  let expression = trimmed;
  let alias = "";

  if (asPosition !== -1) {
    expression = trimmed.slice(0, asPosition).trim();
    alias = trimmed.slice(asPosition + 2).trim();
  } else if (IDENTIFIER.test(trimmed)) {
    alias = trimmed;
  }

  if (!alias || !IDENTIFIER.test(alias)) {
    throw new PlaygroundParseError(
      `Projection '${trimmed}' needs an explicit simple alias.`,
      ["Use `expression AS alias`; aliases must be simple identifiers."]
    );
  }

  return {
    expression,
    alias,
    source: trimmed,
    isWindow: /\bOVER\b/i.test(expression)
  };
}

function parseWindowExpression(expression: string, alias: string): WindowExpressionAst {
  const trimmed = expression.trim();
  const pathAggregateMatch = trimmed.match(
    /^sum\s*\(([\s\S]+)\)\s+OVER\s+PATH\s+([A-Za-z_][A-Za-z0-9_]*)\s+(EDGES|NODES)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/i
  );
  const pathRankingMatch = trimmed.match(
    /^(rank|row_number)\s*\(\s*\)\s+OVER\s+PATH\s+([A-Za-z_][A-Za-z0-9_]*)\s+(EDGES|NODES)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/i
  );
  const aggregateMatch = trimmed.match(/^sum\s*\(([\s\S]+)\)\s+OVER\s*\(([\s\S]*)\)$/i);
  const rankingMatch = trimmed.match(/^(rank|row_number)\s*\(\s*\)\s+OVER\s*\(([\s\S]*)\)$/i);

  let functionName: WindowFunctionName;
  let inputExpression: string | undefined;
  let overBody: string;
  let path: WindowExpressionAst["path"];

  if (pathAggregateMatch) {
    functionName = "sum";
    inputExpression = pathAggregateMatch[1].trim();
    overBody = pathAggregateMatch[5].trim();
    path = {
      pathVariable: pathAggregateMatch[2],
      elementKind: pathAggregateMatch[3].toUpperCase() as "EDGES" | "NODES",
      elementAlias: pathAggregateMatch[4]
    };
  } else if (pathRankingMatch) {
    functionName = pathRankingMatch[1].toLowerCase() as WindowFunctionName;
    overBody = pathRankingMatch[5].trim();
    path = {
      pathVariable: pathRankingMatch[2],
      elementKind: pathRankingMatch[3].toUpperCase() as "EDGES" | "NODES",
      elementAlias: pathRankingMatch[4]
    };
  } else if (aggregateMatch) {
    functionName = "sum";
    inputExpression = aggregateMatch[1].trim();
    overBody = aggregateMatch[2].trim();
  } else if (rankingMatch) {
    functionName = rankingMatch[1].toLowerCase() as WindowFunctionName;
    overBody = rankingMatch[2].trim();
  } else {
    throw new PlaygroundParseError(
      `Unsupported window expression '${trimmed}'.`,
      ["Supported functions are rank(), row_number(), and sum(expr) with OVER (...) or OVER PATH ... (...)."]
    );
  }

  const over = parseOverBody(overBody);
  return {
    functionName,
    inputExpression,
    path,
    partitionBy: over.partitionBy,
    orderBy: over.orderBy,
    frame: over.frame,
    alias,
    raw: trimmed
  };
}

function parseOverBody(overBody: string): {
  partitionBy: string[];
  orderBy: OrderItem[];
  frame?: FrameSpecAst;
} {
  const framePosition = findFirstFramePosition(overBody);
  const beforeFrame = framePosition === -1 ? overBody.trim() : overBody.slice(0, framePosition).trim();
  const frame = framePosition === -1 ? undefined : parseFrame(overBody.slice(framePosition).trim());
  const partitionPosition = findTopLevelKeyword(beforeFrame, "PARTITION BY");
  const orderPosition = findTopLevelKeyword(beforeFrame, "ORDER BY");

  let partitionBy: string[] = [];
  if (partitionPosition !== -1) {
    const partitionStart = partitionPosition + "PARTITION BY".length;
    const partitionEnd = orderPosition === -1 ? beforeFrame.length : orderPosition;
    partitionBy = splitTopLevel(beforeFrame.slice(partitionStart, partitionEnd), ",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  let orderBy: OrderItem[] = [];
  if (orderPosition !== -1) {
    const orderStart = orderPosition + "ORDER BY".length;
    orderBy = parseOrderItems(beforeFrame.slice(orderStart));
  }

  return { partitionBy, orderBy, frame };
}

export function parseOrderItems(orderText: string): OrderItem[] {
  return splitTopLevel(orderText, ",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/([\s\S]*?)\s+(ASC|DESC)$/i);
      if (!match) {
        return { expression: item, direction: "ASC" as SortDirection };
      }
      return {
        expression: match[1].trim(),
        direction: match[2].toUpperCase() as SortDirection
      };
    });
}

function parseFrame(frameText: string): FrameSpecAst {
  const modeMatch = frameText.match(/^(ROWS|RANGE|GROUPS)\s+BETWEEN\s+/i);
  if (!modeMatch) {
    throw new PlaygroundParseError(
      `Unsupported frame clause '${frameText}'.`,
      ["Use ROWS, RANGE, or GROUPS BETWEEN <boundary> AND <boundary>."]
    );
  }

  const mode = modeMatch[1].toUpperCase() as FrameMode;
  const rest = frameText.slice(modeMatch[0].length).trim();
  const andPosition = findTopLevelKeyword(rest, "AND");
  if (andPosition === -1) {
    throw new PlaygroundParseError(`Frame '${frameText}' is missing AND.`);
  }

  const startText = rest.slice(0, andPosition).trim();
  let endText = rest.slice(andPosition + "AND".length).trim();
  let exclude: FrameExclusion | undefined;
  const excludePosition = findTopLevelKeyword(endText, "EXCLUDE");
  if (excludePosition !== -1) {
    const rawExclude = normalizeToken(endText.slice(excludePosition + "EXCLUDE".length));
    endText = endText.slice(0, excludePosition).trim();
    exclude =
      rawExclude === "NO_OTHERS"
        ? "NO_OTHERS"
        : rawExclude === "CURRENT_ROW"
          ? "CURRENT_ROW"
          : rawExclude === "GROUP"
            ? "GROUP"
            : rawExclude === "TIES"
              ? "TIES"
              : undefined;
    if (!exclude) {
      throw new PlaygroundParseError(`Unsupported EXCLUDE mode '${rawExclude}'.`);
    }
  }

  return {
    mode,
    start: parseBoundary(startText),
    end: parseBoundary(endText),
    exclude
  };
}

function parseBoundary(boundaryText: string): FrameBoundary {
  const normalized = normalizeToken(boundaryText);
  if (normalized === "UNBOUNDED_PRECEDING") {
    return { kind: "UNBOUNDED_PRECEDING" };
  }
  if (normalized === "CURRENT_ROW") {
    return { kind: "CURRENT_ROW" };
  }
  if (normalized === "UNBOUNDED_FOLLOWING") {
    return { kind: "UNBOUNDED_FOLLOWING" };
  }

  const offsetMatch = boundaryText.match(/^([\s\S]+?)\s+(PRECEDING|FOLLOWING)$/i);
  if (!offsetMatch) {
    throw new PlaygroundParseError(`Unsupported frame boundary '${boundaryText}'.`);
  }

  return {
    kind: offsetMatch[2].toUpperCase() as "PRECEDING" | "FOLLOWING",
    value: offsetMatch[1].trim()
  };
}

function validateFinalOrderBy(items: OrderItem[], visibleProjections: ProjectionAst[], windowAlias: string) {
  const aliases = new Set([...visibleProjections.map((projection) => projection.alias), windowAlias]);
  for (const item of items) {
    const normalized = normalizeExpression(item.expression);
    if (!aliases.has(item.expression) && !aliases.has(normalized)) {
      throw new PlaygroundParseError(
        `Final ORDER BY expression '${item.expression}' is not a projected alias.`,
        ["For V1, final ORDER BY must use aliases projected by the RETURN/WITH clause."]
      );
    }
  }
}

function findFirstFramePosition(text: string): number {
  const positions = ["ROWS", "RANGE", "GROUPS"]
    .map((keyword) => findTopLevelKeyword(text, keyword))
    .filter((position) => position !== -1);
  return positions.length === 0 ? -1 : Math.min(...positions);
}

export function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  scanTopLevel(text, (position) => {
    if (text[position] === delimiter) {
      parts.push(text.slice(start, position).trim());
      start = position + delimiter.length;
    }
  });
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

export function findTopLevelKeyword(text: string, keyword: string): number {
  let result = -1;
  scanTopLevel(text, (position) => {
    if (result === -1 && matchesKeywordAt(text, position, keyword)) {
      result = position;
    }
  });
  return result;
}

function findLastTopLevelKeyword(text: string, keyword: string): number {
  let result = -1;
  scanTopLevel(text, (position) => {
    if (matchesKeywordAt(text, position, keyword)) {
      result = position;
    }
  });
  return result;
}

function scanTopLevel(text: string, visitor: (position: number) => void) {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (char === "\\" && quote !== "`") {
        index++;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index++;
      }
      index++;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth++;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      visitor(index);
    }
  }
}

function matchesKeywordAt(text: string, position: number, keyword: string): boolean {
  const words = keyword.split(/\s+/);
  let cursor = position;

  if (isIdentifierChar(text[position - 1])) {
    return false;
  }

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const fragment = text.slice(cursor, cursor + word.length);
    if (fragment.toUpperCase() !== word.toUpperCase()) {
      return false;
    }
    cursor += word.length;

    if (index < words.length - 1) {
      const whitespace = text.slice(cursor).match(/^\s+/);
      if (!whitespace) {
        return false;
      }
      cursor += whitespace[0].length;
    }
  }

  return !isIdentifierChar(text[cursor]);
}

function isIdentifierChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_]/.test(char);
}

function stripQuotedText(text: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      output += " ";
      if (char === "\\" && quote !== "`") {
        index++;
        output += " ";
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function normalizeToken(token: string): string {
  return token.trim().replace(/\s+/g, "_").toUpperCase();
}
