import type {
  BackendInfo,
  BackendId,
  ParseResponse,
  PlaygroundExample,
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

export async function parseQuery(query: string) {
  return requestJson<ParseResponse>("/api/parse", {
    method: "POST",
    body: JSON.stringify({ query })
  });
}

export async function runQuery(query: string, backendId: BackendId) {
  return requestJson<RunResponse>("/api/run", {
    method: "POST",
    body: JSON.stringify({ query, backendId })
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
