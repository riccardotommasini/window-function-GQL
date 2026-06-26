import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app";
import { closeNeo4jDriver } from "./neo4jClient";

const app = createApp();
const currentDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(currentDir, "../../dist");

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(resolve(distDir, "index.html"));
  });
}

const port = Number(process.env.PLAYGROUND_PORT ?? 5174);
const server = app.listen(port, () => {
  console.log(`GQL Window Playground API listening on http://localhost:${port}`);
});

async function shutdown() {
  server.close();
  await closeNeo4jDriver();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
