#!/usr/bin/env node
/**
 * Renders app.json (the ChatGPT App manifest) from the compiled tool schemas.
 *
 * app.json used to mirror the zod schemas by hand and had already lost every
 * `description` string. Generating it means the manifest can only ever describe
 * what the server actually accepts.
 *
 * Runs after `skybridge build` because it imports the compiled schemas from
 * dist/ — that avoids running TypeScript through a loader just to read them.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const pkg = readJson("package.json");
const serverManifest = readJson("server.json");

if (pkg.version !== serverManifest.version) {
  console.error(
    `[generate-app-json] version drift: package.json is ${pkg.version} but server.json is ${serverManifest.version}.`,
  );
  process.exit(1);
}

const compiled = join(root, "dist/server/src/schemas.js");
if (!existsSync(compiled)) {
  console.error("[generate-app-json] dist/server/src/schemas.js not found — run `skybridge build` first.");
  process.exit(1);
}

const { TOOL_META, TOOL_INPUT_SCHEMAS } = await import(pathToFileURL(compiled).href);

const remote = serverManifest.remotes?.find((r) => r.url)?.url;
if (!remote) {
  console.error("[generate-app-json] server.json declares no remote URL.");
  process.exit(1);
}

function inputSchema(shape) {
  const { $schema, ...schema } = z.toJSONSchema(z.object(shape), {
    io: "input",
    target: "draft-7",
  });
  // ChatGPT rejects unknown arguments rather than silently dropping them.
  return { ...schema, additionalProperties: false };
}

const toolNames = Object.keys(TOOL_INPUT_SCHEMAS);

const app = {
  $schema: "https://chatgpt.com/schemas/app/v1.json",
  id: "ai-pricing-hub",
  name: serverManifest.title,
  version: pkg.version,
  description: pkg.description,
  mcp: { server_url: remote },
  tools: toolNames.map((name) => ({
    name,
    title: TOOL_META[name].title,
    description: TOOL_META[name].description,
    input_schema: inputSchema(TOOL_INPUT_SCHEMAS[name]),
    ui_resource: `ui://widget/${name}`,
  })),
  ui_resources: toolNames.map((name) => ({
    uri: `ui://widget/${name}`,
    source: `web/src/widgets/${name}/index.tsx`,
  })),
};

writeFileSync(join(root, "app.json"), `${JSON.stringify(app, null, 2)}\n`, "utf8");
console.log(`[generate-app-json] wrote app.json (${toolNames.length} tools, v${pkg.version})`);
