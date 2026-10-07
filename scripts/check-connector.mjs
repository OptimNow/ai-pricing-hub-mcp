#!/usr/bin/env node
/**
 * Verify a deployed connector by calling it, not by reading its source.
 *
 *   node scripts/check-connector.mjs [url]
 *
 * `url` defaults to server.json `remotes[0].url`, the published one. Pass a
 * different URL to check a local `npm run start` or the *.fly.dev host; the
 * expected sandbox domain is always the hash of the PUBLISHED URL, because
 * `pinPublicUrl` stamps that URL on every request whatever host it arrived on.
 * The script opens an MCP session and checks, in order:
 *
 *   1. initialize            -> HTTP 200 and serverInfo
 *   2. tools/list            -> the five tools
 *   3. resources/list + read -> every widget resource carries _meta.ui.domain
 *                               equal to sha256(published url)[:32] +
 *                               ".claudemcpcontent.com", which is what claude.ai
 *                               validates. The read is sent with User-Agent
 *                               "Claude-User" because Skybridge only emits the
 *                               hash for that agent.
 *   4. tools/call compare-llm-models -> provenance.tier is 1 (live upstream)
 *
 * Everything it sees is printed verbatim; the exit code is non-zero on the
 * first mismatch. Run it after every deploy and before touching the registry
 * entry or the directory listing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverJson = JSON.parse(readFileSync(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"));
const publishedUrl = serverJson.remotes[0].url;
const url = process.argv[2] ?? publishedUrl;
const expectedDomain = `${createHash("sha256").update(publishedUrl).digest("hex").slice(0, 32)}.claudemcpcontent.com`;

const EXPECTED_TOOLS = [
  "compare-llm-models",
  "estimate-llm-cost",
  "compare-models-side-by-side",
  "recommend-llm-model",
  "compare-compute-pricing",
];

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
  if (!ok) failures += 1;
};

let sessionId;
let nextId = 1;

/** POST one JSON-RPC message and return the parsed result (SSE or JSON body). */
async function rpc(method, params, extraHeaders = {}) {
  const body = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
  const isNotification = method.startsWith("notifications/");
  if (!isNotification) body.id = nextId++;
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;
  sessionId ??= response.headers.get("mcp-session-id") ?? undefined;
  if (isNotification) return { status: response.status, elapsed };
  const text = await response.text();
  let payload;
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
    payload = JSON.parse(data.at(-1) ?? "null");
  } else {
    payload = JSON.parse(text || "null");
  }
  return { status: response.status, elapsed, payload };
}

console.log(`Connector under test: ${url}`);
console.log(`Published URL (server.json): ${publishedUrl}`);
console.log(`Expected _meta.ui.domain: ${expectedDomain}\n`);

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "check-connector", version: serverJson.version },
});
console.log(`initialize -> HTTP ${init.status} in ${init.elapsed} ms`);
console.log(JSON.stringify(init.payload?.result ?? init.payload, null, 2));
check(init.status === 200 && init.payload?.result?.serverInfo?.name === "ai-pricing-hub", "initialize serverInfo", init.payload?.result?.serverInfo?.version);
await rpc("notifications/initialized");

const tools = await rpc("tools/list");
const toolNames = (tools.payload?.result?.tools ?? []).map(t => t.name);
console.log(`\ntools/list -> HTTP ${tools.status}: ${JSON.stringify(toolNames)}`);
check(EXPECTED_TOOLS.every(n => toolNames.includes(n)) && toolNames.length === EXPECTED_TOOLS.length, "the five tools are listed");

const resources = await rpc("resources/list");
const uris = (resources.payload?.result?.resources ?? []).map(r => r.uri);
console.log(`\nresources/list -> HTTP ${resources.status}: ${JSON.stringify(uris)}`);
check(uris.length === EXPECTED_TOOLS.length, "one widget resource per tool", `${uris.length}`);
for (const uri of uris) {
  const read = await rpc("resources/read", { uri }, { "user-agent": "Claude-User" });
  const content = read.payload?.result?.contents?.[0];
  const meta = content?._meta;
  console.log(`resources/read ${uri} -> ${content?.mimeType} ${JSON.stringify(meta)}`);
  check(meta?.ui?.domain === expectedDomain, `${uri} _meta.ui.domain`, meta?.ui?.domain);
}

const call = await rpc("tools/call", { name: "compare-llm-models", arguments: { limit: 3 } });
const provenance = call.payload?.result?.structuredContent?.provenance;
console.log(`\ntools/call compare-llm-models -> HTTP ${call.status} in ${call.elapsed} ms`);
console.log(JSON.stringify(provenance, null, 2));
check(provenance?.tier === 1, "provenance.tier is 1 (live optimtoken)", `tier ${provenance?.tier}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
