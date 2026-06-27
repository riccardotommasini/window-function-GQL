import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import neo4j, { type Driver } from "neo4j-driver";

let driver: Driver | null = null;
let seedPromise: Promise<void> | null = null;

export function getNeo4jDriver() {
  if (driver) {
    return driver;
  }

  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD ?? "";
  driver = user ? neo4j.driver(uri, neo4j.auth.basic(user, password)) : neo4j.driver(uri);
  return driver;
}

export async function closeNeo4jDriver() {
  if (driver) {
    await driver.close();
    driver = null;
    seedPromise = null;
  }
}

export async function ensureDemoData(neo4jDriver = getNeo4jDriver()) {
  seedPromise ??= seedDemoData(neo4jDriver);
  await seedPromise;
}

async function seedDemoData(neo4jDriver: Driver) {
  const needsSeed = await isDemoDataMissing(neo4jDriver);
  if (!needsSeed) {
    return;
  }

  const cypherPath = resolveDemoDataPath();
  const cypher = await readFile(cypherPath, "utf8");
  const statements = splitCypherStatements(cypher);
  const session = neo4jDriver.session();

  try {
    for (const statement of statements) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}

function resolveDemoDataPath() {
  for (const candidate of [
    resolve(process.cwd(), "../neo4j/examples/01-example-data.cypher"),
    resolve(process.cwd(), "neo4j/examples/01-example-data.cypher")
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return resolve(process.cwd(), "../neo4j/examples/01-example-data.cypher");
}

async function isDemoDataMissing(neo4jDriver: Driver) {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(`
      MATCH (account:Account)
      WITH count(account) AS accounts
      MATCH (frameRow:FrameRow)
      WITH accounts, count(frameRow) AS frameRows
      MATCH (temporalFrameRow:TemporalFrameRow)
      RETURN accounts, frameRows, count(temporalFrameRow) AS temporalRows
    `);
    const row = result.records[0];
    if (!row) {
      return true;
    }
    return row.get("accounts").toNumber() < 5 || row.get("frameRows").toNumber() < 5 || row.get("temporalRows").toNumber() < 4;
  } catch {
    return true;
  } finally {
    await session.close();
  }
}

function splitCypherStatements(cypher: string) {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < cypher.length; index++) {
    const char = cypher[index];
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
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === ";") {
      const statement = cypher.slice(start, index).trim();
      if (statement) {
        statements.push(statement);
      }
      start = index + 1;
    }
  }

  const tail = cypher.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}
