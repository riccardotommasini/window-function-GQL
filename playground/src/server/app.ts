import cors from "cors";
import express, { type Request, type Response } from "express";
import { backends, examples } from "../shared/examples";
import { parseWindowQuery, PlaygroundParseError } from "../shared/parser";
import type { ApiErrorResponse, BackendId, RunRequest } from "../shared/types";
import { getNeo4jDriver } from "./neo4jClient";
import { apocBackend } from "./backends/apocBackend";
import { sqliteBackend } from "./backends/sqliteBackend";
import type { BackendAdapter } from "./backends/types";
import type { Driver } from "neo4j-driver";

const backendAdapters: Record<BackendId, BackendAdapter> = {
  apoc: apocBackend,
  "neo4j-sqlite": sqliteBackend
};

interface CreateAppOptions {
  adapters?: Partial<Record<BackendId, BackendAdapter>>;
  driver?: Driver;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const adapters = { ...backendAdapters, ...options.adapters };
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/backends", (_request, response) => {
    response.json({ backends });
  });

  app.get("/api/examples", (_request, response) => {
    response.json({ examples });
  });

  app.post("/api/parse", (request, response) => {
    try {
      const query = readQuery(request);
      response.json({ parse: parseWindowQuery(query) });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post("/api/run", async (request, response) => {
    try {
      const body = request.body as Partial<RunRequest>;
      const query = readQuery(request);
      const backendId = body.backendId;
      if (backendId !== "apoc" && backendId !== "neo4j-sqlite") {
        throw new PlaygroundParseError("Unknown backend selected.");
      }

      const parsed = parseWindowQuery(query);
      if (parsed.kind !== "row-window") {
        throw new PlaygroundParseError("This syntax is parsed but cannot be executed by V1 backends.", parsed.diagnostics);
      }

      const result = await adapters[backendId].run(parsed, { driver: options.driver ?? getNeo4jDriver() });
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  return app;
}

function readQuery(request: Request) {
  const query = (request.body as { query?: unknown }).query;
  if (typeof query !== "string") {
    throw new PlaygroundParseError("Request body must include a query string.");
  }
  return query;
}

function sendApiError(response: Response<ApiErrorResponse>, error: unknown) {
  if (error instanceof PlaygroundParseError) {
    response.status(400).json({ error: error.message, diagnostics: error.diagnostics });
    return;
  }
  const message = error instanceof Error ? error.message : "Unexpected playground error.";
  response.status(500).json({ error: message });
}
