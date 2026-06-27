import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { BackendId, PlaygroundExample } from "../shared/types";

interface RawExampleRecord {
  id?: unknown;
  title?: unknown;
  database?: unknown;
  databaseId?: unknown;
  description?: unknown;
  supportedBackends?: unknown;
  tags?: unknown;
  query?: unknown;
}

export function getExamplesPath() {
  return resolve(process.cwd(), process.env.PLAYGROUND_EXAMPLES_FILE ?? "examples.yaml");
}

export function loadExamples(filePath = getExamplesPath()): PlaygroundExample[] {
  const raw = parse(readFileSync(filePath, "utf8")) as { examples?: unknown } | null;
  if (!raw || !Array.isArray(raw.examples)) {
    throw new Error(`Examples YAML must contain an "examples" list: ${filePath}`);
  }

  const seenIds = new Set<string>();
  return raw.examples.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`Example at index ${index} must be a map.`);
    }
    return normalizeExample(record, index, seenIds);
  });
}

function normalizeExample(record: RawExampleRecord, index: number, seenIds: Set<string>): PlaygroundExample {
  const id = readRequiredString(record.id, "id", index);
  if (seenIds.has(id)) {
    throw new Error(`Duplicate example id "${id}" in examples YAML.`);
  }
  seenIds.add(id);

  return {
    id,
    title: readRequiredString(record.title, "title", index),
    databaseId: readRequiredString(record.database ?? record.databaseId, "database", index),
    description: readRequiredString(record.description, "description", index),
    supportedBackends: readBackends(record.supportedBackends, index),
    tags: readStringList(record.tags, "tags", index),
    query: readRequiredString(record.query, "query", index).trimEnd()
  };
}

function readBackends(value: unknown, index: number): BackendId[] {
  const backends = readStringList(value, "supportedBackends", index);
  for (const backend of backends) {
    if (backend !== "apoc" && backend !== "neo4j-sqlite") {
      throw new Error(`Example at index ${index} has unknown backend "${backend}".`);
    }
  }
  return backends as BackendId[];
}

function readStringList(value: unknown, field: string, index: number) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Example at index ${index} must have a string list field "${field}".`);
  }
  return value;
}

function readRequiredString(value: unknown, field: string, index: number) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Example at index ${index} must have a non-empty string field "${field}".`);
  }
  return value;
}

function isRecord(value: unknown): value is RawExampleRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
