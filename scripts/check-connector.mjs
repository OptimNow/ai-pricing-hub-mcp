#!/usr/bin/env node
/**
 * Verify a deployed connector by calling it, not by reading its source.
 *
 *   node scripts/check-connector.mjs [url] [--expect-version 0.13.0]
 *        [--attempts 6] [--delay 10] [--output report.md]
 *
 * `url` defaults to server.json `remotes[0].url`, the published one. Pass a
 * different URL to check a local `npm run start` (http://localhost:3000/mcp)
 * or the *.fly.dev host. The script checks, in order:
 *
 *   1. initialize   -> HTTP 200, serverInfo, the version this checkout declares
 *                      (server.json, or --expect-version), and the instructions
 *                      the server sends the calling model (since 0.10.0)
 *   2. tools/list   -> the eight tools, each with a title (top-level and in
 *                      annotations), readOnlyHint, a 2020-12 outputSchema, and
 *                      no widget template
 *   3. resources    -> none: the server publishes no `ui://` resources since
 *                      0.5.0, and a client must not be offered any
 *   4. each of the eight tools, called once with ordinary arguments -> an
 *      answer with `structuredContent`, whose text closes with the source to
 *      name (since 0.12.1), and compare-llm-models served live (tier 1)
 *   5. eight tool calls at once -> eight answers. Up to 0.4.2 every call that
 *      overlapped another was answered HTTP 500.
 *   6. GET /healthz -> 200
 *
 * WHO RUNS IT. The `deploy` job of ci.yml, after every deploy, on the fly.dev
 * host: the registry entry and the GitHub release wait for it. The daily
 * production-check.yml, on the published URL. deploy-tag.yml after a rollback.
 * And anyone, before touching the registry entry or the directory listing.
 *
 * EXIT CODES, as the Cloud FinOps connector's checks use them:
 *   0  every check passed
 *   1  the server itself is wrong: a version, a tool, a schema, an answer
 *   2  the server is right and the site behind it could not be read: an answer
 *      from the snapshot (tier 2), or the price archive unreadable. An outage of
 *      optimtoken.optimnow.io is not a defect of this repository, and a red run
 *      for one teaches everyone to ignore the job.
 *
 * `--attempts` repeats the whole run while the server itself is wrong: the
 * first call after a deploy pays a machine start, and an answer from the
 * previous image can arrive while a rollout settles. Everything it sees is
 * printed. In GitHub Actions each failure is also an annotation, and
 * `--output` writes the last attempt as a Markdown report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const serverJson = JSON.parse(readFileSync(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"));
const publishedUrl = serverJson.remotes[0].url;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "expect-version": { type: "string", default: serverJson.version },
    attempts: { type: "string", default: "1" },
    delay: { type: "string", default: "10" },
    output: { type: "string" },
  },
});
const url = positionals[0] ?? publishedUrl;
const expectedVersion = options["expect-version"];
const attempts = Math.max(1, Number.parseInt(options.attempts, 10) || 1);
const delaySeconds = Math.max(0, Number(options.delay) || 0);

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
/** The closing line every successful text carries since 0.12.1 (lib/citation.ts). */
const SOURCE_LINE = /OptimToken \(optimtoken\.optimnow\.io\)/;
/** deploy-tag.yml can put an older tag back: it is held to what it shipped. */
const atLeast = (version, floor) => {
  const [a, b] = [version, floor].map(v => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
const expectSourceLine = atLeast(expectedVersion, "0.12.1");
/** How a tool says the site could not be read: an outage, not a defect here. */
const SITE_UNREADABLE = /could not be read|could not be reached|did not answer|answered HTTP \d+/i;

let nextId = 1;

/** POST one JSON-RPC message and return the parsed result (SSE or JSON body).
 *  A request that gets no HTTP answer at all comes back with status 0. */
async function rpc(method, params) {
  const body = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
  const isNotification = method.startsWith("notifications/");
  if (!isNotification) body.id = nextId++;
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return { status: 0, elapsed: Date.now() - started, payload: { error: String(error) } };
  }
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

const textOf = result => (result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");

/** One full pass. Returns every check as { ok, label, detail, upstream }. */
async function runChecks() {
  const results = [];
  const check = (ok, label, detail, { upstream = false } = {}) => {
    results.push({ ok, label, detail, upstream });
    console.log(`${ok ? "PASS" : upstream ? "WARN" : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "check-connector", version: serverJson.version },
  });
  const serverInfo = init.payload?.result?.serverInfo;
  console.log(`initialize -> HTTP ${init.status} in ${init.elapsed} ms: ${JSON.stringify(serverInfo ?? init.payload)}`);
  check(init.status === 200 && serverInfo?.name === "ai-pricing-hub", "initialize answers as ai-pricing-hub", `HTTP ${init.status}`);
  if (init.status !== 200) return results; // nothing further can be asked
  check(serverInfo?.version === expectedVersion, `serverInfo.version is ${expectedVersion}`, serverInfo?.version ?? "none");
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
  console.log(`tools/list -> HTTP ${tools.status}: ${JSON.stringify(toolNames)}`);
  check(
    EXPECTED_TOOLS.every(n => toolNames.includes(n)) && toolNames.length === EXPECTED_TOOLS.length,
    `the ${EXPECTED_TOOLS.length} tools are listed`,
    toolNames.length === EXPECTED_TOOLS.length ? undefined : `${toolNames.length} listed`,
  );
  for (const tool of listed) {
    const problems = [
      tool.title ? "" : "no title",
      // Anthropic's directory portal reads the title from the annotations, not
      // from the top-level field, and flags a tool without it.
      tool.annotations?.title === tool.title ? "" : `annotations.title is ${JSON.stringify(tool.annotations?.title)}`,
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
  console.log(`resources/list -> HTTP ${resources.status}: ${JSON.stringify(resources.payload?.error ?? uris)}`);
  check(uris.length === 0, "no resources are published", uris.length ? uris.join(", ") : undefined);

  // Each tool once. The model names come from the first answer, so the check
  // does not go stale when the catalogue changes.
  const answers = {};
  const callTool = async (name, args) => {
    const call = await rpc("tools/call", { name, arguments: args });
    const result = call.payload?.result;
    answers[name] = result;
    const text = textOf(result);
    if (call.status !== 200 || !result) {
      check(false, `${name} answers`, `HTTP ${call.status} ${JSON.stringify(call.payload?.error ?? "").slice(0, 160)}`);
      return result;
    }
    if (result.isError) {
      const upstream = SITE_UNREADABLE.test(text);
      check(false, `${name} answers`, text.slice(0, 200), { upstream });
      return result;
    }
    const lastLine = text.trim().split("\n").at(-1) ?? "";
    const problems = [
      result.structuredContent && typeof result.structuredContent === "object" ? "" : "no structuredContent",
      !expectSourceLine || SOURCE_LINE.test(lastLine) ? "" : `last line does not name the source: ${JSON.stringify(lastLine.slice(0, 100))}`,
    ].filter(Boolean);
    const label = `${name} answers, with structuredContent${expectSourceLine ? " and the source line" : ""}`;
    check(problems.length === 0, label, problems.join("; ") || `${call.elapsed} ms`);
    return result;
  };

  const compare = await callTool("compare-llm-models", { limit: 3 });
  const provenance = compare?.structuredContent?.provenance;
  console.log(`  provenance: ${JSON.stringify(provenance)}`);
  check(provenance?.tier === 1, "compare-llm-models is served live (provenance.tier 1)", `tier ${provenance?.tier}`, {
    upstream: true,
  });
  const [first, second] = (compare?.structuredContent?.models ?? []).map(m => m.model);
  if (first && second) {
    await callTool("estimate-llm-cost", { modelName: first, useCasePreset: "supportTicket" });
    await callTool("compare-models-side-by-side", { models: [first, second] });
    await callTool("compare-model-hosts", { models: [first] });
    await callTool("estimate-self-hosting-breakeven", { model: first, hourlyRate: 10 });
  } else {
    check(false, "compare-llm-models names two models to call the other tools with");
  }
  await callTool("recommend-llm-model", { useCasePreset: "supportTicket" });
  await callTool("compare-compute-pricing", { region: "us-east", limit: 5 });
  await callTool("track-llm-price-changes", {});

  // Assistants issue tool calls in parallel. Alternating regions makes at least
  // one of them slow on a machine that has just woken, which is exactly when the
  // others used to be refused.
  const burst = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      rpc("tools/call", { name: "compare-compute-pricing", arguments: { region: i % 2 ? "us-east" : "europe", limit: 5 } }),
    ),
  );
  const answered = burst.filter(r => r.status === 200 && r.payload?.result?.isError === false).length;
  console.log(`8 concurrent tools/call -> statuses ${burst.map(r => r.status).join(" ")}, slowest ${Math.max(...burst.map(r => r.elapsed))} ms`);
  check(answered === 8, "eight concurrent calls, eight answers", `${answered} of 8`);

  const healthUrl = new URL("/healthz", url);
  const health = await fetch(healthUrl, { signal: AbortSignal.timeout(30_000) }).catch(error => ({ status: 0, statusText: String(error) }));
  check(health.status === 200, "GET /healthz answers 200", `HTTP ${health.status}`);

  return results;
}

console.log(`Connector under test: ${url}`);
console.log(`Published URL (server.json): ${publishedUrl}`);
console.log(`Expected version: ${expectedVersion}\n`);

let results = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  if (attempts > 1) console.log(`── attempt ${attempt} of ${attempts}`);
  results = await runChecks();
  const surface = results.filter(r => !r.ok && !r.upstream).length;
  if (surface === 0) break;
  if (attempt < attempts) {
    console.log(`\n${surface} check(s) failed; trying again in ${delaySeconds} s.\n`);
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
  }
}

const failed = results.filter(r => !r.ok && !r.upstream);
const warned = results.filter(r => !r.ok && r.upstream);
const code = failed.length > 0 ? 1 : warned.length > 0 ? 2 : 0;
const verdict = [
  "ALL CHECKS PASSED",
  `${failed.length} CHECK(S) FAILED`,
  `THE SERVER PASSED; ${warned.length} CHECK(S) COULD NOT PASS BECAUSE THE SITE WAS NOT READ`,
][code];
console.log(`\n${verdict}`);

if (process.env.GITHUB_ACTIONS === "true") {
  // An annotation is one line.
  const one = s => String(s ?? "").replace(/\s+/g, " ").slice(0, 300);
  for (const r of failed) console.log(`::error title=Connector check failed::${one(r.label)}${r.detail ? `: ${one(r.detail)}` : ""}`);
  for (const r of warned) console.log(`::warning title=The site was not read::${one(r.label)}${r.detail ? `: ${one(r.detail)}` : ""}`);
}

if (options.output) {
  const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 200);
  const lines = [
    `### Connector check: ${verdict.toLowerCase()}`,
    "",
    `\`${url}\`, expected version \`${expectedVersion}\`, ${new Date().toISOString()}.`,
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...results.map(r => `| ${r.ok ? "pass" : r.upstream ? "site not read" : "**FAIL**"} | ${cell(r.label)} | ${cell(r.detail)} |`),
    "",
  ];
  writeFileSync(options.output, lines.join("\n"));
}

process.exit(code);
