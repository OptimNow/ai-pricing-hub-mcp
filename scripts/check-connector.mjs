#!/usr/bin/env node
/**
 * Verify a connector by calling it, not by reading its source.
 *
 *   node scripts/check-connector.mjs [url] [--expect-version 0.13.0]
 *        [--attempts 6] [--delay 10] [--output report.md]
 *        [--tools-fingerprint scripts/tools-fingerprint.json]
 *        [--write-tools-fingerprint scripts/tools-fingerprint.json]
 *        [--site https://optimtoken.optimnow.io] [--recheck-delay 65]
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
 *                      no widget template. With --tools-fingerprint, each
 *                      tool's definition is the one pinned in that file.
 *   3. resources    -> none: the server publishes no `ui://` resources since
 *                      0.5.0, and a client must not be offered any
 *   4. each of the eight tools, called once with ordinary arguments -> an
 *      answer with `structuredContent`, whose text closes with the source to
 *      name (since 0.12.1); compare-llm-models and compare-compute-pricing
 *      served live (tier 1), and the price archive read
 *   5. eight tool calls at once -> eight answers. Up to 0.4.2 every call that
 *      overlapped another was answered HTTP 500.
 *   6. GET /healthz -> 200
 *
 * WHO RUNS IT. The `check` job of ci.yml, on a build of every pull request
 * started on the runner, with --tools-fingerprint. The `deploy` job of ci.yml,
 * after every deploy, on the fly.dev host: the registry entry and the GitHub
 * release wait for it. The daily production-check.yml, on the published URL.
 * deploy-tag.yml after a rollback. And anyone, before touching the registry
 * entry or the directory listing.
 *
 * EXIT CODES, as the Cloud FinOps connector's checks use them:
 *   0  every check passed
 *   1  the server itself is wrong: a version, a tool, a schema, an answer, a
 *      definition that is not the pinned one, or a site it cannot read while
 *      the site answers
 *   2  the server is right and the site behind it did not answer: an answer
 *      from the snapshot (tier 2), or the price archive unreadable. An outage of
 *      optimtoken.optimnow.io is not a defect of this repository, and a red run
 *      for one teaches everyone to ignore the job.
 *
 * WHOSE FAULT A FALLBACK IS. A server that falls back to its snapshot, or says
 * the price archive could not be read, says the same thing whether the site is
 * down or its own parser has stopped reading what the site serves. Until this
 * rule the script took the server's word, so a parser broken by a release
 * passed as an outage: exit 2, a green run, the registry published. Now the
 * script asks the site itself for the same document (`SITE_READS`). When the
 * site does not answer, it is an outage: exit 2. When it does, the server is
 * asked once more after --recheck-delay seconds, longer than the minute it
 * remembers a fallback: a second read that passes was a passing failure of
 * the site and the check passes; a second failure beside a second answer from
 * the site is the server's, and exit 1.
 *
 * `--attempts` repeats the whole run while the server itself is wrong: the
 * first call after a deploy pays a machine start, and an answer from the
 * previous image can arrive while a rollout settles. A failure that would be
 * the same on every attempt (a definition, a site read twice) ends the run.
 * Everything it sees is printed. In GitHub Actions each failure is also an
 * annotation, and `--output` writes the last attempt as a Markdown report.
 *
 * `--site` is the site the server under test reads, when it is not the
 * production one (a server started with OPTIMTOKEN_API_BASE_URL).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const serverJson = JSON.parse(readFileSync(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"));
const publishedUrl = serverJson.remotes[0].url;
/** The site this server reads: OPTIMTOKEN_BASE_URL in server/src/lib/optimtoken-api.ts. */
const DEFAULT_SITE = "https://optimtoken.optimnow.io";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "expect-version": { type: "string", default: serverJson.version },
    attempts: { type: "string", default: "1" },
    delay: { type: "string", default: "10" },
    output: { type: "string" },
    "tools-fingerprint": { type: "string" },
    "write-tools-fingerprint": { type: "string" },
    site: { type: "string", default: DEFAULT_SITE },
    "recheck-delay": { type: "string", default: "65" },
  },
});
const url = positionals[0] ?? publishedUrl;
const expectedVersion = options["expect-version"];
const attempts = Math.max(1, Number.parseInt(options.attempts, 10) || 1);
const delaySeconds = Math.max(0, Number(options.delay) || 0);
const site = options.site.replace(/\/+$/, "");
const recheckSeconds = Math.max(0, Number(options["recheck-delay"]) || 0);

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
/** Since 0.14.0 every tool declares idempotentHint and refuses undeclared arguments. */
const expectStrictInputs = atLeast(expectedVersion, "0.14.0");
/** How a tool says the site could not be read. Whether that is an outage is
 *  for the site to say: see `SITE_READS`. */
const SITE_UNREADABLE = /could not be read|could not be reached|did not answer|answered HTTP \d+/i;

/**
 * What the server reads from the site behind each check, and what makes an
 * answer one the server is expected to read. Each entry repeats the server's
 * own rule, and server/src/check-connector.test.ts holds the two together:
 *
 *  - `path`: the address the server asks for, spelled as it spells it, so the
 *    two requests share one entry at the site's edge;
 *  - `budgetMs`: how long the server waits. An answer that comes later is one
 *    the server could not have read either;
 *  - `rows` and `minRows`: the array the server reads, and the fewest rows it
 *    takes for a catalogue (the price archive may hold no move at all);
 *  - `refused`: an answer the server turns down by design. A catalogue the
 *    site serves from its own fallback is no more current than the snapshot.
 */
const SITE_READS = {
  llm: {
    path: "/api/llm-models",
    budgetMs: 15_000,
    rows: body => body.models,
    minRows: 80,
    refused: body =>
      body.meta?.source === "openrouter" ? null : `the site serves its own fallback (meta.source ${JSON.stringify(body.meta?.source)})`,
  },
  compute: {
    path: "/api/pricing?region=us-east&os=Linux",
    budgetMs: 40_000,
    rows: body => body.instances,
    minRows: 100,
  },
  priceChanges: {
    path: "/api/price-changes",
    budgetMs: 10_000,
    rows: body => body.changes,
    minRows: 0,
  },
};
/** The read behind a tool that says the site could not be read. */
const SITE_READ_OF_TOOL = { "compare-compute-pricing": "compute", "track-llm-price-changes": "priceChanges" };

const USER_AGENT = `ai-pricing-hub-mcp-check/${serverJson.version} (+${serverJson.repository.url})`;
const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
/** A sentence without its closing period, to carry on from. */
const open = text => String(text).replace(/[.\s]+$/, "");

/** Ask the site for what the server reads. `answered` is true for an answer the
 *  server is expected to read; `detail` says what came back either way. */
async function askSite(key) {
  const read = SITE_READS[key];
  const started = Date.now();
  const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
  let response;
  let text;
  try {
    response = await fetch(`${site}${read.path}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(read.budgetMs),
    });
    text = await response.text();
  } catch (error) {
    const why = error?.name === "TimeoutError" ? `no answer within ${read.budgetMs / 1000} s` : `no answer (${error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.name ?? "error"})`;
    return { answered: false, detail: `${read.path}: ${why}` };
  }
  // The server follows a redirect on the site's own origin only.
  if (new URL(response.url).origin !== new URL(site).origin) {
    return { answered: false, detail: `${read.path}: redirected to ${new URL(response.url).origin}` };
  }
  if (response.status !== 200) return { answered: false, detail: `${read.path}: HTTP ${response.status} in ${seconds()}` };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { answered: false, detail: `${read.path}: HTTP 200 and a body that is not a JSON object` };
  }
  const rows = read.rows(body);
  if (!Array.isArray(rows)) return { answered: false, detail: `${read.path}: HTTP 200 without the rows this server reads` };
  if (rows.length < read.minRows) {
    return { answered: false, detail: `${read.path}: ${rows.length} rows, under the ${read.minRows} this server takes for a catalogue` };
  }
  const refused = read.refused?.(body);
  if (refused) return { answered: false, detail: `${read.path}: ${refused}` };
  return { answered: true, detail: `${read.path}: HTTP 200, ${rows.length} rows in ${seconds()}` };
}

/** A tool's definition as tools/list returns it, keys sorted: one text for one
 *  definition, however the server ordered its properties. */
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value;
const fingerprintOf = tool => createHash("sha256").update(JSON.stringify(canonical(tool))).digest("hex");

const FINGERPRINT_ABOUT =
  "SHA-256 of each tool's definition as tools/list returns it (name, title, description, input and output " +
  "schema, annotations), as JSON with sorted keys. The check job of ci.yml compares a build of every pull " +
  "request with this file. A hash that differs is a definition that changed, and claude.ai then asks every " +
  'user who chose "Always allow" to approve that tool again (CLAUDE.md, decision 1b). To change a ' +
  "definition on purpose, group the changes in one release, then rewrite this file from a local build: " +
  "npm run build, npm run start, node scripts/check-connector.mjs http://localhost:3000/mcp " +
  "--write-tools-fingerprint scripts/tools-fingerprint.json";

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

/** One full pass. Returns every check as { ok, label, detail, upstream, final }. */
async function runChecks() {
  const results = [];
  // `upstream`: the site did not answer, so the check could not pass (exit 2).
  // `final`: the failure would be the same on another attempt.
  const check = (ok, label, detail, { upstream = false, final = false } = {}) => {
    results.push({ ok, label, detail, upstream, final });
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
      !expectStrictInputs || tool.annotations?.idempotentHint === true ? "" : "idempotentHint is not true",
      !expectStrictInputs || tool.inputSchema?.additionalProperties === false ? "" : "inputSchema accepts undeclared arguments",
      tool.outputSchema?.$schema === JSON_SCHEMA_2020_12 ? "" : `outputSchema dialect ${tool.outputSchema?.$schema}`,
      tool._meta && Object.keys(tool._meta).length > 0 ? `carries _meta ${JSON.stringify(tool._meta)}` : "",
      tool.name.length <= 64 ? "" : "name over 64 characters",
    ].filter(Boolean);
    check(problems.length === 0, `${tool.name}: title, read-only, 2020-12 schema, no widget template`, problems.join("; ") || undefined);
  }

  // The definitions, against the ones pinned in the repository. Not asked of a
  // deployed server by default: deploy-tag.yml puts back tags whose
  // definitions are not this checkout's.
  const served = Object.fromEntries(listed.map(tool => [tool.name, fingerprintOf(tool)]));
  if (options["write-tools-fingerprint"]) {
    const sorted = Object.fromEntries(Object.keys(served).sort().map(name => [name, served[name]]));
    writeFileSync(options["write-tools-fingerprint"], `${JSON.stringify({ about: FINGERPRINT_ABOUT, tools: sorted }, null, 2)}\n`);
    console.log(`Wrote the fingerprint of ${listed.length} tool definitions to ${options["write-tools-fingerprint"]}`);
  }
  if (options["tools-fingerprint"]) {
    const file = options["tools-fingerprint"];
    const label = `the tool definitions are the ones pinned in ${file}`;
    let pinned = null;
    try {
      pinned = JSON.parse(readFileSync(file, "utf8")).tools;
    } catch (error) {
      check(false, label, `${file} could not be read: ${error.message}`, { final: true });
    }
    if (pinned) {
      const differences = [
        ["changed", Object.keys(served).filter(name => name in pinned && pinned[name] !== served[name])],
        ["not pinned", Object.keys(served).filter(name => !(name in pinned))],
        ["pinned and no longer served", Object.keys(pinned).filter(name => !(name in served))],
      ]
        .filter(([, names]) => names.length > 0)
        .map(([what, names]) => `${what}: ${names.join(", ")}`);
      check(
        differences.length === 0,
        label,
        differences.length === 0
          ? undefined
          : `${differences.join("; ")}. claude.ai asks every user who chose "Always allow" to approve a tool again ` +
            `when its definition changes. If the change is meant, rewrite the file with --write-tools-fingerprint ${file}`,
        { final: true },
      );
    }
  }

  // No widgets: either the server does not implement resources at all (the
  // method is not found) or it lists none. A `ui://` entry here would mean a
  // client is being offered a widget that no longer exists.
  const resources = await rpc("resources/list");
  const uris = (resources.payload?.result?.resources ?? []).map(r => r.uri);
  console.log(`resources/list -> HTTP ${resources.status}: ${JSON.stringify(resources.payload?.error ?? uris)}`);
  check(uris.length === 0, "no resources are published", uris.length ? uris.join(", ") : undefined);

  /** One call, judged: `problem` is what is wrong with the answer, if anything,
   *  and `unreadable` that the server says it could not read the site. */
  const callTool = async (name, args) => {
    const call = await rpc("tools/call", { name, arguments: args });
    const result = call.payload?.result;
    const text = textOf(result);
    if (call.status !== 200 || !result) {
      return { result, problem: `HTTP ${call.status} ${JSON.stringify(call.payload?.error ?? "").slice(0, 160)}` };
    }
    if (result.isError) return { result, problem: text.slice(0, 200), unreadable: SITE_UNREADABLE.test(text) };
    const lastLine = text.trim().split("\n").at(-1) ?? "";
    const problems = [
      result.structuredContent && typeof result.structuredContent === "object" ? "" : "no structuredContent",
      !expectSourceLine || SOURCE_LINE.test(lastLine) ? "" : `last line does not name the source: ${JSON.stringify(lastLine.slice(0, 100))}`,
    ].filter(Boolean);
    return { result, problem: problems.join("; ") || null, elapsed: call.elapsed };
  };
  const tierOf = answer => answer.result?.structuredContent?.provenance?.tier;

  // Checks that failed on the server's word that the site could not be read.
  // They are settled at the end, once the site itself has been asked.
  const unsettled = [];

  /** Each tool once. `liveRead` names the site read behind a tool whose answer
   *  says which tier served it: that answer must come from the site. */
  const checkTool = async (name, args, liveRead) => {
    const answer = await callTool(name, args);
    const label = `${name} answers, with structuredContent${expectSourceLine ? " and the source line" : ""}`;
    if (answer.unreadable) {
      unsettled.push({ name, args, label, read: SITE_READ_OF_TOOL[name] ?? "llm", said: answer.problem, passes: again => !again.problem });
      return answer.result;
    }
    check(!answer.problem, label, answer.problem ?? `${answer.elapsed} ms`);
    if (!answer.problem && liveRead) {
      const liveLabel = `${name} is served live (provenance.tier 1)`;
      if (tierOf(answer) === 1) check(true, liveLabel, "tier 1");
      else {
        unsettled.push({
          name,
          args,
          label: liveLabel,
          read: liveRead,
          said: `tier ${tierOf(answer)}`,
          passes: again => !again.problem && tierOf(again) === 1,
        });
      }
    }
    return answer.result;
  };

  // The model names come from the first answer, so the check does not go
  // stale when the catalogue changes.
  const compare = await checkTool("compare-llm-models", { limit: 3 }, "llm");
  console.log(`  provenance: ${JSON.stringify(compare?.structuredContent?.provenance)}`);
  const [first, second] = (compare?.structuredContent?.models ?? []).map(m => m.model);
  if (first && second) {
    await checkTool("estimate-llm-cost", { modelName: first, useCasePreset: "supportTicket" });
    await checkTool("compare-models-side-by-side", { models: [first, second] });
    await checkTool("compare-model-hosts", { models: [first] });
    await checkTool("estimate-self-hosting-breakeven", { model: first, hourlyRate: 10 });
  } else {
    check(false, "compare-llm-models names two models to call the other tools with");
  }
  await checkTool("recommend-llm-model", { useCasePreset: "supportTicket" });
  await checkTool("compare-compute-pricing", { region: "us-east", limit: 5 }, "compute");
  await checkTool("track-llm-price-changes", {});

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

  // Whose fault each fallback is (the head of this file). One request to the
  // site per read, shared by the checks that wait on it.
  if (unsettled.length > 0) {
    const asked = new Map();
    const ask = read => {
      if (!asked.has(read)) asked.set(read, askSite(read));
      return asked.get(read);
    };
    const disputed = [];
    for (const item of unsettled) {
      const answer = await ask(item.read);
      if (answer.answered) disputed.push({ item, before: answer });
      else check(false, item.label, `${open(item.said)}. The site did not answer either: ${answer.detail}`, { upstream: true });
    }
    if (disputed.length > 0) {
      console.log(
        `The site answered (${[...new Set(disputed.map(d => d.before.detail))].join("; ")}) where the server said it ` +
          `could not read it. Asking the server again in ${recheckSeconds} s.`,
      );
      await sleep(recheckSeconds);
      asked.clear();
      for (const { item, before } of disputed) {
        const again = await callTool(item.name, item.args);
        if (item.passes(again)) {
          check(true, item.label, `on a second read, ${recheckSeconds} s after "${item.said}" (the site answered then: ${before.detail})`);
          continue;
        }
        const now = await ask(item.read);
        if (now.answered) {
          check(
            false,
            item.label,
            `${open(again.problem ?? item.said)}, twice and ${recheckSeconds} s apart, while the site answered both times ` +
              `(${now.detail}). This server cannot read what the site serves`,
            { final: true },
          );
        } else {
          check(false, item.label, `${open(again.problem ?? item.said)}. The site answered once, then did not: ${now.detail}`, { upstream: true });
        }
      }
    }
  }

  return results;
}

console.log(`Connector under test: ${url}`);
console.log(`Published URL (server.json): ${publishedUrl}`);
console.log(`Expected version: ${expectedVersion}\n`);

let results = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  if (attempts > 1) console.log(`── attempt ${attempt} of ${attempts}`);
  results = await runChecks();
  const surface = results.filter(r => !r.ok && !r.upstream);
  if (surface.length === 0) break;
  if (surface.every(r => r.final)) {
    if (attempt < attempts) console.log(`\n${surface.length} check(s) failed, and another attempt would find the same.`);
    break;
  }
  if (attempt < attempts) {
    console.log(`\n${surface.length} check(s) failed; trying again in ${delaySeconds} s.\n`);
    await sleep(delaySeconds);
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
