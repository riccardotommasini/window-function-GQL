import type {
  BackendInfo,
  BackendId,
  ParseRequest,
  ParseResponse,
  PlaygroundExample,
  RunRequest,
  RunResponse
} from "../shared/types";

export async function fetchExamples() {
  const payload = await requestJson<{ examples: PlaygroundExample[] }>("/api/examples", { cache: "no-store" });
  return payload.examples;
}

export async function fetchBackends() {
  const payload = await requestJson<{ backends: BackendInfo[] }>("/api/backends");
  return payload.backends;
}

export async function parseQuery(query: string, includePartitionId = false) {
  const body: ParseRequest = { query, includePartitionId };
  return requestJson<ParseResponse>("/api/parse", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function runQuery(query: string, backendId: BackendId, includePartitionId = false) {
  const body: RunRequest = { query, backendId, includePartitionId };
  return requestJson<RunResponse>("/api/run", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json()) as T & { error?: string; diagnostics?: string[] };
  if (!response.ok) {
    const message = payload.diagnostics?.join("\n") || payload.error || "Request failed.";
    throw new Error(message);
  }
  return payload;
}
