import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * scripts/check-connector.mjs decides what a release does next: exit 0 and the
 * registry is published, exit 1 and the run is red, exit 2 and it is green with
 * a warning. These tests run the script itself, against a connector and a site
 * that are both stand-ins on localhost, so each verdict is held by what the
 * script does and not by how it is written.
 *
 * The rule under test: a server that says it could not read the site is
 * believed only when the site does not answer the script either. Until this
 * rule a parser broken by a release read exactly like an outage of the site,
 * and passed as one (review of 2026-11-22, the second gap against the Cloud
 * FinOps connector's release chain).
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const script = fileURLToPath(new URL("../../scripts/check-connector.mjs", import.meta.url));
const version: string = JSON.parse(read("../../server.json")).version;
const toolNames = [...read("./index.ts").matchAll(/^tool\(\n\s*"([a-z-]+)"/gm)].map((match) => match[1]);

type Json = Record<string, unknown>;

/** What the stand-in connector says about the site, and what the stand-in
 *  site answers. `siteAsked` counts the script's own requests to the site. */
interface Scene {
  /** provenance.tier of compare-llm-models. */
  llmTier: () => number;
  /** provenance.tier of compare-compute-pricing. */
  computeTier: () => number;
  /** Whether track-llm-price-changes says the archive could not be read. */
  archiveUnreadable: () => boolean;
  /** The site's answer to a path: a status and a body. */
  site: (path: string) => { status: number; body: unknown };
  /** A description, to change one tool's definition. */
  describe: (tool: string) => string;
  siteAsked: string[];
}

const healthySite = (path: string): { status: number; body: unknown } => {
  if (path.startsWith("/api/llm-models")) return { status: 200, body: { models: Array(80).fill({}), meta: { source: "openrouter" } } };
  if (path.startsWith("/api/pricing")) return { status: 200, body: { instances: Array(100).fill({}) } };
  if (path.startsWith("/api/price-changes")) return { status: 200, body: { changes: [] } };
  return { status: 404, body: {} };
};

const scene = (over: Partial<Scene> = {}): Scene => ({
  llmTier: () => 1,
  computeTier: () => 1,
  archiveUnreadable: () => false,
  site: healthySite,
  describe: () => "A tool.",
  siteAsked: [],
  ...over,
});

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const body = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => resolve(text));
  });

const send = (response: ServerResponse, status: number, payload?: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(payload === undefined ? "" : JSON.stringify(payload));
};

/** A connector that passes every check of the script, and says of the site
 *  what the scene tells it to. */
function connector(s: Scene): Server {
  const closing = "Source to name with any figure quoted from this answer: OptimToken (optimtoken.optimnow.io).";
  const answer = (structuredContent: Json) => ({
    content: [{ type: "text", text: `Figures.\n${closing}` }],
    structuredContent,
    isError: false,
  });
  const call = (name: string): Json => {
    if (name === "compare-llm-models") {
      return answer({ models: [{ model: "Model A" }, { model: "Model B" }], provenance: { tier: s.llmTier() } });
    }
    if (name === "compare-compute-pricing") return answer({ instances: [], provenance: { tier: s.computeTier() } });
    if (name === "track-llm-price-changes" && s.archiveUnreadable()) {
      // The words of describePriceChangesFailure() for an answer the parser refused.
      const message = "Price changes are served by optimtoken.optimnow.io only, and the site's answer could not be read.";
      return { content: [{ type: "text", text: message }], structuredContent: { error: message }, isError: true };
    }
    return answer({});
  };
  const tools = () =>
    toolNames.map((name) => ({
      name,
      title: name,
      description: s.describe(name),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
      annotations: { title: name, readOnlyHint: true, idempotentHint: true },
    }));

  return createServer(async (request, response) => {
    if (request.method === "GET") return send(response, request.url === "/healthz" ? 200 : 404, {});
    const message = JSON.parse(await body(request)) as { id?: number; method: string; params?: { name?: string } };
    const result = (value: unknown) => send(response, 200, { jsonrpc: "2.0", id: message.id, result: value });
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "ai-pricing-hub", version },
          instructions: "What the answers carry.",
        });
      case "notifications/initialized":
        return send(response, 202);
      case "tools/list":
        return result({ tools: tools() });
      case "tools/call":
        return result(call(message.params?.name ?? ""));
      default:
        return send(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    }
  });
}

function siteStandIn(s: Scene): Server {
  return createServer((request, response) => {
    const path = request.url ?? "";
    s.siteAsked.push(path);
    const { status, body: payload } = s.site(path);
    send(response, status, payload);
  });
}

/** Run the script against the two stand-ins. `siteDown` hands it the address
 *  of a site that has stopped listening. */
async function check(s: Scene, extra: string[] = [], { siteDown = false } = {}): Promise<{ code: number | null; out: string }> {
  const mcp = connector(s);
  const site = siteStandIn(s);
  const [mcpUrl, siteUrl] = await Promise.all([listen(mcp), listen(site)]);
  if (siteDown) await close(site);
  try {
    return await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.GITHUB_ACTIONS; // annotations would repeat every failure
      const child = spawn(process.execPath, [script, `${mcpUrl}/mcp`, "--site", siteUrl, "--recheck-delay", "0", ...extra], { env });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, out }));
    });
  } finally {
    await close(mcp);
    if (!siteDown) await close(site);
  }
}

test("the stand-in connector lists the tools the server declares", () => {
  assert.equal(toolNames.length, 8, `index.ts declares ${toolNames.length} tools`);
});

test("a connector that reads the site passes, and the site is not asked", async () => {
  const s = scene();
  const { code, out } = await check(s);
  assert.equal(code, 0, out);
  assert.match(out, /PASS {2}compare-llm-models is served live \(provenance\.tier 1\)/);
  assert.match(out, /PASS {2}compare-compute-pricing is served live \(provenance\.tier 1\)/);
  assert.match(out, /ALL CHECKS PASSED/);
  // The script asks the site only when the server says it could not read it.
  assert.deepEqual(s.siteAsked, []);
});

test("a fallback while the site answers is the server's failure: exit 1", async () => {
  // What a parser broken by a release looks like: the snapshot, with the site up.
  const s = scene({ llmTier: () => 2 });
  const { code, out } = await check(s);
  assert.equal(code, 1, out);
  assert.match(out, /FAIL {2}compare-llm-models is served live[^\n]*tier 2, twice[^\n]*This server cannot read what the site serves/);
  assert.match(out, /1 CHECK\(S\) FAILED/);
  // Asked as the server asks, before and after the second read.
  assert.deepEqual(s.siteAsked, ["/api/llm-models", "/api/llm-models"]);
});

test("a fallback while the site does not answer is an outage: exit 2", async () => {
  for (const [what, site, said] of [
    ["an error status", () => ({ status: 503, body: {} }), /The site did not answer either: \/api\/llm-models: HTTP 503/],
    ["a body that is not JSON", () => ({ status: 200, body: "<html>" }), /not a JSON object/],
    // The two answers the server turns down by design are the site's doing too.
    ["its own fallback", () => ({ status: 200, body: { models: Array(80).fill({}), meta: { source: "static" } } }), /the site serves its own fallback/],
    ["a catalogue under the floor", () => ({ status: 200, body: { models: Array(79).fill({}), meta: { source: "openrouter" } } }), /79 rows, under the 80/],
  ] as const) {
    const { code, out } = await check(scene({ llmTier: () => 2, site }));
    assert.equal(code, 2, `${what}\n${out}`);
    assert.match(out, /WARN {2}compare-llm-models is served live/, what);
    assert.match(out, said, what);
    assert.match(out, /THE SERVER PASSED; 1 CHECK\(S\) COULD NOT PASS BECAUSE THE SITE WAS NOT READ/, what);
  }
  const down = await check(scene({ llmTier: () => 2 }), [], { siteDown: true });
  assert.equal(down.code, 2, down.out);
  assert.match(down.out, /\/api\/llm-models: no answer/);
});

test("a fallback that is gone on the second read was the site's, and passes", async () => {
  // The server remembers a failed read for a minute: the script asks the site,
  // waits, and asks the server again. Here the server reads the site once the
  // script has asked it.
  const s = scene();
  s.llmTier = () => (s.siteAsked.length > 0 ? 1 : 2);
  const { code, out } = await check(s);
  assert.equal(code, 0, out);
  assert.match(out, /PASS {2}compare-llm-models is served live[^\n]*on a second read/);
  assert.deepEqual(s.siteAsked, ["/api/llm-models"]);
});

test("the compute catalogue and the price archive are held the same way", async () => {
  const compute = scene({ computeTier: () => 2 });
  const failed = await check(compute);
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /FAIL {2}compare-compute-pricing is served live[^\n]*This server cannot read what the site serves/);
  // The address the server asks for, so the two share one entry at the site's edge.
  assert.deepEqual(compute.siteAsked, ["/api/pricing?region=us-east&os=Linux", "/api/pricing?region=us-east&os=Linux"]);
  const outage = await check(scene({ computeTier: () => 2 }), [], { siteDown: true });
  assert.equal(outage.code, 2, outage.out);

  const archive = scene({ archiveUnreadable: () => true });
  const unread = await check(archive);
  assert.equal(unread.code, 1, unread.out);
  assert.match(unread.out, /FAIL {2}track-llm-price-changes answers[^\n]*could not be read[^\n]*This server cannot read what the site serves/);
  assert.deepEqual(archive.siteAsked, ["/api/price-changes", "/api/price-changes"]);
  const noArchive = await check(scene({ archiveUnreadable: () => true, site: () => ({ status: 500, body: {} }) }));
  assert.equal(noArchive.code, 2, noArchive.out);
  assert.match(noArchive.out, /WARN {2}track-llm-price-changes answers[^\n]*\/api\/price-changes: HTTP 500/);
});

test("a tool definition that is not the pinned one fails, names the tool, and is not tried again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "check-connector-"));
  const file = join(dir, "tools-fingerprint.json");
  try {
    const written = await check(scene(), ["--write-tools-fingerprint", file]);
    assert.equal(written.code, 0, written.out);
    const pinned = JSON.parse(readFileSync(file, "utf8")) as { about: string; tools: Record<string, string> };
    assert.deepEqual(Object.keys(pinned.tools), [...toolNames].sort());
    for (const hash of Object.values(pinned.tools)) assert.match(hash, /^[0-9a-f]{64}$/);

    const same = await check(scene(), ["--tools-fingerprint", file]);
    assert.equal(same.code, 0, same.out);
    assert.match(same.out, /PASS {2}the tool definitions are the ones pinned in/);

    // One word in one description.
    const reworded = scene({ describe: (tool) => (tool === "estimate-llm-cost" ? "A tool, reworded." : "A tool.") });
    const started = Date.now();
    const changed = await check(reworded, ["--tools-fingerprint", file, "--attempts", "3", "--delay", "30"]);
    assert.equal(changed.code, 1, changed.out);
    assert.match(changed.out, /FAIL {2}the tool definitions are the ones pinned in[^\n]*changed: estimate-llm-cost\./);
    assert.match(changed.out, /approve a tool again/);
    assert.match(changed.out, /another attempt would find the same/);
    assert.ok(Date.now() - started < 20_000, "a definition is the same on every attempt: no 30 s wait");

    const missing = await check(scene(), ["--tools-fingerprint", join(dir, "absent.json")]);
    assert.equal(missing.code, 1, missing.out);
    assert.match(missing.out, /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script reads the site as the server does", () => {
  // SITE_READS repeats four of the server's own rules. A copy that drifts
  // would blame the server for an answer it is right to refuse, or excuse it.
  const source = read("../../scripts/check-connector.mjs");
  const llm = read("./lib/llm-models.ts");
  const compute = read("./lib/compute-pricing.ts");
  const archive = read("./lib/price-changes.ts");
  const number = (text: string, pattern: RegExp) => Number(pattern.exec(text)?.[1]?.replace(/_/g, ""));
  const entry = (key: string) => new RegExp(`\\n  ${key}: \\{\\n([\\s\\S]*?)\\n  \\},`).exec(source)?.[1] ?? "";

  assert.match(read("./lib/optimtoken-api.ts"), /process\.env\.OPTIMTOKEN_API_BASE_URL \|\| "https:\/\/optimtoken\.optimnow\.io"/);
  assert.match(source, /const DEFAULT_SITE = "https:\/\/optimtoken\.optimnow\.io";/);

  // The catalogue of models: address, budget, floor, and the fallback refused.
  assert.match(llm, /fetchOptimtokenJson<SiteModelsResponse>\("api\/llm-models"/);
  assert.match(entry("llm"), /path: "\/api\/llm-models",/);
  assert.equal(number(entry("llm"), /budgetMs: ([\d_]+)/), number(llm, /const UPSTREAM_TIMEOUT_MS = ([\d_]+);/));
  assert.equal(number(entry("llm"), /minRows: ([\d_]+)/), number(llm, /const MIN_PLAUSIBLE_CATALOGUE = ([\d_]+);/));
  assert.match(llm, /if \(meta\.source !== "openrouter"\) \{\n\s+throw/);
  assert.match(entry("llm"), /body\.meta\?\.source === "openrouter" \? null/);

  // The compute catalogue: the region the script calls the tool with, Linux.
  assert.match(compute, /export const PRICING_OS = "Linux";/);
  assert.match(compute, /const params = \{ region, os: PRICING_OS \};/);
  assert.match(entry("compute"), /path: "\/api\/pricing\?region=us-east&os=Linux",/);
  assert.match(source, /checkTool\("compare-compute-pricing", \{ region: "us-east", limit: 5 \}, "compute"\)/);
  assert.equal(number(entry("compute"), /budgetMs: ([\d_]+)/), number(compute, /export const UPSTREAM_TIMEOUT_MS = ([\d_]+);/));
  assert.equal(number(entry("compute"), /minRows: ([\d_]+)/), number(compute, /const MIN_PLAUSIBLE_COMPUTE_CATALOGUE = ([\d_]+);/));

  // The price archive: no floor, a quiet week is an answer.
  assert.match(archive, /fetchOptimtokenJson<unknown>\("api\/price-changes"/);
  assert.match(entry("priceChanges"), /path: "\/api\/price-changes",/);
  assert.equal(number(entry("priceChanges"), /budgetMs: ([\d_]+)/), number(archive, /export const PRICE_CHANGES_TIMEOUT_MS = ([\d_]+);/));
  assert.equal(number(entry("priceChanges"), /minRows: ([\d_]+)/), 0);

  // The second read waits longer than the server remembers a fallback.
  const remembered = number(llm, /export const FALLBACK_CACHE_TTL_MS = (\d+) \* 1000;/);
  const waits = number(source, /"recheck-delay": \{ type: "string", default: "(\d+)" \}/);
  assert.ok(waits > remembered, `the script waits ${waits} s, the server remembers a fallback for ${remembered} s`);
});

test("the pinned fingerprints name the tools the server declares", () => {
  // The hashes are checked by the check job of ci.yml, against a build of the
  // commit: index.ts listens on import, so no test can list its tools.
  const pinned = JSON.parse(read("../../scripts/tools-fingerprint.json")) as { about: string; tools: Record<string, string> };
  assert.deepEqual(Object.keys(pinned.tools), [...toolNames].sort());
  for (const [name, hash] of Object.entries(pinned.tools)) assert.match(hash, /^[0-9a-f]{64}$/, name);
  assert.match(pinned.about, /--write-tools-fingerprint scripts\/tools-fingerprint\.json/);
});
