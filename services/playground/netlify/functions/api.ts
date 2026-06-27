import { existsSync } from "node:fs";
import { resolve } from "node:path";
import serverless from "serverless-http";
import { createApp } from "../../src/server/app";

const app = createApp({ examplesPath: resolveExamplesPath() });

export const handler = serverless(app);

function resolveExamplesPath() {
  const override = process.env.PLAYGROUND_EXAMPLES_FILE;
  if (override) {
    return resolve(process.cwd(), override);
  }

  for (const candidate of [
    resolve(process.cwd(), "examples.yaml"),
    resolve(process.cwd(), "services/playground/examples.yaml"),
    resolve(process.cwd(), "playground/examples.yaml")
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return resolve(process.cwd(), "examples.yaml");
}
