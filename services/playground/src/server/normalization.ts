import neo4j from "neo4j-driver";

type UnknownRecord = Record<string, unknown>;

export function normalizeRecordForJson(record: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeForJson(value)]));
}

export function normalizeRecordForSqlite(record: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeForSqlite(value)]));
}

export function normalizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }
  if (isNode(value)) {
    return {
      kind: "node",
      elementId: value.elementId,
      labels: value.labels,
      properties: normalizeForJson(value.properties)
    };
  }
  if (isRelationship(value)) {
    return {
      kind: "relationship",
      elementId: value.elementId,
      type: value.type,
      startNodeElementId: value.startNodeElementId,
      endNodeElementId: value.endNodeElementId,
      properties: normalizeForJson(value.properties)
    };
  }
  if (isPath(value)) {
    return {
      kind: "path",
      pathKey: pathKey(value),
      length: value.segments.length
    };
  }
  if (isNeo4jTemporal(value)) {
    return value.toString();
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord).map(([key, nestedValue]) => [key, normalizeForJson(nestedValue)])
    );
  }
  return value;
}

export function normalizeForSqlite(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (isNode(value)) {
    return `node:${value.elementId}`;
  }
  if (isRelationship(value)) {
    return `relationship:${value.elementId}`;
  }
  if (isPath(value)) {
    return pathKey(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(normalizeForSqlite));
  }
  if (isNeo4jTemporal(value)) {
    return value.toString();
  }
  if (typeof value === "object") {
    return JSON.stringify(normalizeForJson(value));
  }
  return String(value);
}

function isNode(value: unknown): value is {
  elementId: string;
  labels: string[];
  properties: UnknownRecord;
} {
  return !!value && typeof value === "object" && "labels" in value && "properties" in value && "elementId" in value;
}

function isRelationship(value: unknown): value is {
  elementId: string;
  type: string;
  startNodeElementId: string;
  endNodeElementId: string;
  properties: UnknownRecord;
} {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    "properties" in value &&
    "startNodeElementId" in value &&
    "endNodeElementId" in value
  );
}

function isPath(value: unknown): value is {
  start: { elementId: string };
  segments: Array<{
    relationship: { elementId: string };
    end: { elementId: string };
  }>;
} {
  return !!value && typeof value === "object" && "segments" in value && Array.isArray((value as { segments: unknown }).segments);
}

function isNeo4jTemporal(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { toString?: unknown }).toString === "function" &&
    /^(Date|DateTime|LocalDateTime|LocalTime|Time|Duration)$/i.test(value.constructor.name)
  );
}

function pathKey(path: {
  start: { elementId: string };
  segments: Array<{
    relationship: { elementId: string };
    end: { elementId: string };
  }>;
}) {
  const tokens = [`node:${path.start.elementId}`];
  for (const segment of path.segments) {
    tokens.push(`rel:${segment.relationship.elementId}`);
    tokens.push(`node:${segment.end.elementId}`);
  }
  return JSON.stringify(tokens);
}
