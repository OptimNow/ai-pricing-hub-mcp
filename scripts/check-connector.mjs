#!/usr/bin/env node
/**
 * Verify a deployed connector by calling it, not by reading its source.
 *
 *   node scripts/check-connector.mjs [url]
 *
 * `url` defaults to server.json `remotes[0].url`, the published one. Pass a
 * different URL to check a local `npm run start` (http://localhost:3000/mcp)
 * or the *.fly.dev host. The script checks, in order:
 *
 *   1. initialize   -> HTTP 200, serverInfo, and the instructions the server
 *                      sends the calling model (since 0.10.0)
 *   2. tools/list   -> the eight tools, each with a title, readOnlyHint, a
 *                      2020-12 outputSchema, and no widget template
 *   3. resources    -> none: the server publishes no `ui://` resources since
 *                      0.5.0, and a client must not be offered any
 *   4. tools/call compare-llm-models -> provenance.tier is 1 (live upstream)
 *   5. eight tool calls at once -> eight answers. Up to 0.4.2 every call that
 *      overlapped another was answered HTTP 500.
 *   6. GET /healthz -> 200
 *
 * Everything it sees is printed; the exit code is non-zero on any mismatch.
 * Run it after every deploy and before touching the registry entry or the
 * directory listing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverJson = JSON.parse(readFileSync(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"));
const publishedUrl = serverJson.remotes[0].url;
const url = process.argv[2] ?? publishedUrl;

const EXPECTED_TOOLS = [
  "compare-llm-models",
  "estimate-llm-cost",
  "compare-models-side-by-side",
  "recommend-llm-model",
  "compare-compute-pricing",
  "compare-model-hosts",
  "estimate-self-hosting-breakeven",
  "track-llm-price-changes",
];
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
  if (!ok) failures += 1;
};

let nextId = 1;

/** POST one JSON-RPC message and return the parsed result (SSE or JSON body). */
async function rpc(method, params) {
  const body = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
  const isNotification = method.startsWith("notifications/");
  if (!isNotification) body.id = nextId++;
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;
  if (isNotification) return { status: response.status, elapsed };
  const text = await response.text();
  let payload = null;
  try {
    if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const data = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
      payload = JSON.parse(data.at(-1) ?? "null");
    } else {
      payload = JSON.parse(text || "null");
    }
  } catch {
    payload = { unparseable: text.slice(0, 200) };
  }
  return { status: response.status, elapsed, payload };
}

console.log(`Connector under test: ${url}`);
console.log(`Published URL (server.json): ${publishedUrl}\n`);

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "check-connector", version: serverJson.version },
});
console.log(`initialize -> HTTP ${init.status} in ${init.elapsed} ms`);
console.log(JSON.stringify(init.payload?.result ?? init.payload, null, 2));
check(init.status === 200 && init.payload?.result?.serverInfo?.name === "ai-pricing-hub", "initialize serverInfo", init.payload?.result?.serverInfo?.version);
const instructions = init.payload?.result?.instructions;
check(
  typeof instructions === "string" && instructions.trim().length > 0,
  "initialize sends instructions for the calling model",
  typeof instructions === "string" ? `${instructions.length} characters` : "none",
);
await rpc("notifications/initialized");

const tools = await rpc("tools/list");
const listed = tools.payload?.result?.tools ?? [];
const toolNames = listed.map(t => t.name);
console.log(`\ntools/list -> HTTP ${tools.status}: ${JSON.stringify(toolNames)}`);
check(EXPECTED_TOOLS.every(n => toolNames.includes(n)) && toolNames.length === EXPECTED_TOOLS.length, `the ${EXPECTED_TOOLS.length} tools are listed`);
for (const tool of listed) {
  const problems = [
    tool.title ? "" : "no title",
    tool.annotations?.readOnlyHint === true ? "" : "readOnlyHint is not true",
    tool.outputSchema?.$schema === JSON_SCHEMA_2020_12 ? "" : `outputSchema dialect ${tool.outputSchema?.$schema}`,
    tool._meta && Object.keys(tool._meta).length > 0 ? `carries _meta ${JSON.stringify(tool._meta)}` : "",
    tool.name.length <= 64 ? "" : "name over 64 characters",
  ].filter(Boolean);
  check(problems.length === 0, `${tool.name}: title, read-only, 2020-12 schema, no widget template`, problems.join("; ") || undefined);
}

// No widgets: either the server does not implement resources at all (the
// method is not found) or it lists none. A `ui://` entry here would mean a
// client is being offered a widget that no longer exists.
const resources = await rpc("resources/list");
const uris = (resources.payload?.result?.resources ?? []).map(r => r.uri);
console.log(`\nresources/list -> HTTP ${resources.status}: ${JSON.stringify(resources.payload?.error ?? uris)}`);
check(uris.length === 0, "no resources are published", uris.length ? uris.join(", ") : undefined);

const call = await rpc("tools/call", { name: "compare-llm-models", arguments: { limit: 3 } });
const provenance = call.payload?.result?.structuredContent?.provenance;
console.log(`\ntools/call compare-llm-models -> HTTP ${call.status} in ${call.elapsed} ms`);
console.log(JSON.stringify(provenance, null, 2));
check(provenance?.tier === 1, "provenance.tier is 1 (live optimtoken)", `tier ${provenance?.tier}`);

// Assistants issue tool calls in parallel. Alternating regions makes at least
// one of them slow on a machine that has just woken, which is exactly when the
// others used to be refused.
const burst = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    rpc("tools/call", { name: "compare-compute-pricing", arguments: { region: i % 2 ? "us-east" : "europe", limit: 5 } }),
  ),
);
const answered = burst.filter(r => r.status === 200 && r.payload?.result?.isError === false).length;
console.log(`\n8 concurrent tools/call -> statuses ${burst.map(r => r.status).join(" ")}, slowest ${Math.max(...burst.map(r => r.elapsed))} ms`);
check(answered === 8, "eight concurrent calls, eight answers", `${answered} of 8`);

const healthUrl = new URL("/healthz", url);
const health = await fetch(healthUrl).catch(error => ({ status: 0, statusText: String(error) }));
console.log(`\nGET ${healthUrl} -> HTTP ${health.status}`);
check(health.status === 200, "health check answers");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
