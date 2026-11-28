import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

/**
 * The eight tools, called over HTTP the way a client calls them, with what a
 * model actually sends.
 *
 * On 2026-11-26 the directory portal reported 7 tool errors in 49 calls
 * (14.3%, against a 5% threshold) and did not say which tool. A replay of 131
 * calls against production 0.14.3 on 2026-11-28 answered it: all 28
 * well-formed calls answered, and 74 of the 93 calls a model plausibly sends
 * came back `isError: true`: a region as the provider writes it, a preset in
 * another case, the argument name of a sibling tool, a number as text, a
 * retired model. Each of those cases is below with the outcome it must have
 * now: answered, or refused in a way that says what the tool takes.
 *
 * It runs the real server (index.ts listens on import, here on a free port)
 * against a stub of the site, so every answer passes the SDK's own validation
 * of the tool's output schema: an answer the schema refuses comes back as an
 * error and fails the case. The catalogue is built here because the snapshot
 * is rewritten every Monday and a model can leave it.
 */

const SITE = "https://optimtoken.test";
// Before index.ts is imported: it reads all three as it loads.
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.OPTIMTOKEN_API_BASE_URL = SITE;

// ── The site, stubbed ───────────────────────────────────────────────

const HOSTS_OF_LLAMA = {
  hosts: 3,
  cheapest: { host: "DeepInfra", input: 0.1, output: 0.32, quantization: "fp8" },
  dearest: { host: "Amazon Bedrock", input: 0.72, output: 0.72 },
  vendor: { host: "Meta", input: 0.6, output: 0.6 },
  spread: 2.9,
};

function model(provider: string, name: string, input: number, output: number, elo: number, license: string, extra: object = {}) {
  return {
    provider,
    model: name,
    inputPricePer1M: input,
    outputPricePer1M: output,
    cachedInputPricePer1M: input / 10,
    contextWindow: "200K",
    category: input >= 2 ? "Frontier" : "Mid-tier",
    capabilities: ["Text", "Vision"],
    releaseDate: "2026-06",
    eloScore: elo,
    license,
    openRouterId: `${provider}/${name}`.toLowerCase().replace(/[^a-z0-9./]+/g, "-"),
    ...extra,
  };
}

const CATALOGUE = [
  model("OpenAI", "GPT-5.5", 5, 30, 1480, "Proprietary"),
  model("OpenAI", "GPT-4o", 2.5, 10, 1340, "Proprietary"),
  model("OpenAI", "GPT-4o-mini", 0.15, 0.6, 1280, "Proprietary"),
  model("Anthropic", "Claude Sonnet 5.5", 3, 15, 1470, "Proprietary"),
  model("Anthropic", "Claude Sonnet 5", 3, 15, 1450, "Proprietary"),
  model("Anthropic", "Claude Sonnet 4.5", 3, 15, 1420, "Proprietary"),
  model("Anthropic", "Claude Opus 5", 5, 25, 1490, "Proprietary"),
  model("Google", "Gemini 3.1 Pro Preview", 2, 12, 1460, "Proprietary"),
  model("Google", "Gemini 2.5 Pro", 1.25, 10, 1400, "Proprietary"),
  model("xAI", "Grok 4.5", 3, 15, 1430, "Proprietary"),
  model("DeepSeek", "DeepSeek V3.2", 0.27, 0.4, 1320, "MIT"),
  model("DeepSeek", "DeepSeek V4 Pro 0423", 0.5, 1.5, 1410, "MIT"),
  model("Meta", "Llama 3.3 70B Instruct", 0.1, 0.32, 1250, "Llama 3.x", {
    openRouterId: "meta-llama/llama-3.3-70b-instruct",
    hostPricing: HOSTS_OF_LLAMA,
  }),
  model("Meta", "Llama 3.1 70B Instruct", 0.1, 0.28, 1220, "Llama 3.x"),
  // Enough rows to clear the floor under which the site's answer is refused.
  ...Array.from({ length: 80 }, (_, i) => model("Filler Labs", `Filler ${i + 1}`, 1 + i / 100, 2 + i / 100, 1000 + i, "Proprietary")),
];

function instance(provider: string, instanceType: string, vCPUs: number, memory: number, hourly: number) {
  return {
    provider, instanceType, os: "Linux", vCPUs, memory,
    onDemandHourly: hourly, onDemandMonthly: hourly * 730, spot: hourly * 0.4,
    savingsPlan1yr: hourly * 0.7, savingsPlan3yr: hourly * 0.5, reserved1yr: hourly * 0.72, reserved3yr: hourly * 0.52,
  };
}

const INSTANCES = [
  instance("AWS", "g6e.12xlarge", 48, 384, 10.49),
  instance("GCP", "a2-highgpu-1g", 12, 85, 3.67),
  instance("Azure", "NC24ads_A10_v4", 24, 220, 3.2),
  ...Array.from({ length: 150 }, (_, i) => instance("AWS", `m7i.${i + 1}xlarge`, 4 * (i + 1), 16 * (i + 1), 0.2 * (i + 1))),
];

const ARCHIVE_META = { schemaVersion: "1.0", windowStart: "2026-11-21", windowEnd: "2026-11-28", trackingStart: "2026-08-15", asOf: "2026-11-28" };
const MOVES = [
  {
    provider: "Meta", model: "Llama 3.3 70B Instruct", openRouterId: "meta-llama/llama-3.3-70b-instruct",
    before: { input: 0.1, output: 0.32 }, after: { input: 0.71, output: 0.71 },
    blendedPct: 179.5, inputPct: 610, outputPct: 121.9, flags: ["hostSwitch"],
  },
  {
    provider: "OpenAI", model: "GPT-4o-mini", openRouterId: "openai/gpt-4o-mini",
    before: { input: 0.16, output: 0.64 }, after: { input: 0.15, output: 0.6 },
    blendedPct: -6.3, inputPct: -6.3, outputPct: -6.3,
  },
];

/** What the stub does next: flipped by the tests that need the site to fail. */
const site = { archiveDown: false };

function siteAnswer(url: URL): { status: number; body: unknown } {
  const ids = url.searchParams.getAll("id");
  switch (url.pathname) {
    case "/api/llm-models":
      return {
        status: 200,
        body: {
          models: CATALOGUE,
          meta: {
            schemaVersion: "2.8", total: CATALOGUE.length, catalogTotal: 300, source: "openrouter",
            timestamp: "2026-11-28T09:00:00.000Z", eloAsOf: "2026-11-20", hostPricingAsOf: "2026-11-27",
            deprecationsVerifiedAt: "2026-11-20",
          },
        },
      };
    case "/api/pricing":
      return {
        status: 200,
        body: {
          instances: INSTANCES,
          meta: {
            schemaVersion: "1.3", region: url.searchParams.get("region"), timestamp: "2026-11-28T09:00:00.000Z",
            sources: { AWS: "live", GCP: "live", Azure: "live" },
            sourceRegions: { AWS: "eu-west-1 (Ireland)", GCP: "europe-west1 (Belgium)", Azure: "West Europe" },
            priceTypes: {},
            liveProviders: { live: 6, expected: 6 },
            total: INSTANCES.length, catalogTotal: 5800,
          },
        },
      };
    case "/api/model-hosts":
      return {
        status: 200,
        body: {
          meta: { schemaVersion: "1.0", hostPricingAsOf: "2026-11-27", availabilityReviewedAt: "2026-11-20", bedrockAvailabilityAsOf: "2026-11-24" },
          models: ids.map(id => ({
            openRouterId: id, hosts: 3,
            offers: [HOSTS_OF_LLAMA.cheapest, HOSTS_OF_LLAMA.vendor, HOSTS_OF_LLAMA.dearest],
            platforms: { names: ["AWS Bedrock"], provenance: "estimated" },
            bedrockRegions: ["us-east-1"],
          })),
          notFound: [],
        },
      };
    case "/api/price-changes":
      if (site.archiveDown) return { status: 503, body: { error: "unavailable" } };
      if (ids.length > 0) {
        return {
          status: 200,
          body: {
            meta: ARCHIVE_META, openRouterId: ids[0], provider: "Vendor", model: "Model",
            firstSeen: "2026-08-19", first: { date: "2026-08-19", input: 0.1, output: 0.32 },
            changes: [{ date: "2026-09-03", input: 0.12, output: 0.36, blendedPct: 14.1 }],
          },
        };
      }
      return { status: 200, body: { meta: ARCHIVE_META, summary: { tracked: 94, moved: 2, up: 1, down: 1, flagged: 1 }, changes: MOVES } };
    default:
      return { status: 404, body: { error: "not found" } };
  }
}

// ── The server ──────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const realWarn = console.warn;
/** Every `tool_error` line the server wrote, parsed. */
const logged: { event: string; tool: string; category: string; arguments?: string[]; issues?: string[] }[] = [];
let server: Server;
let endpoint = "";

before(async () => {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(SITE)) return realFetch(input as string, init);
    const { status, body } = siteAnswer(new URL(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  console.warn = (...parts: unknown[]) => {
    const line = String(parts[0]);
    if (line.startsWith('{"event":"tool_error"')) logged.push(JSON.parse(line));
  };
  ({ httpServer: server } = await import("./index.js"));
  if (!server.listening) await once(server, "listening");
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(async () => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  await new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
});

interface Answer {
  isError: boolean;
  text: string;
  // The tools' answers differ; each check reads the fields it names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

let nextId = 1;
async function rpc(method: string, params: unknown): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const response = await realFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  assert.equal(response.status, 200, `${method} answered HTTP ${response.status}`);
  const raw = await response.text();
  const event = raw.split("\n").find(line => line.startsWith("data: "));
  return JSON.parse(event ? event.slice(6) : raw);
}

async function call(tool: string, args: unknown): Promise<Answer> {
  const { result, error } = await rpc("tools/call", { name: tool, arguments: args });
  assert.equal(error, undefined, `${tool} ${JSON.stringify(args)}: a JSON-RPC error, not a tool result`);
  const content = (result?.content ?? []) as { type: string; text?: string }[];
  return {
    isError: result?.isError === true,
    text: content.find(block => block.type === "text")?.text ?? "",
    data: result?.structuredContent,
  };
}

type Case = [tool: string, args: unknown, check?: (answer: Answer) => void];

/** Each case answers: no error, and a structuredContent its output schema took. */
async function allAnswer(cases: Case[]): Promise<void> {
  for (const [tool, args, check] of cases) {
    const answer = await call(tool, args);
    const what = `${tool} ${JSON.stringify(args)}`;
    assert.equal(answer.isError, false, `${what} was refused: ${answer.text.slice(0, 300)}`);
    assert.ok(answer.data, `${what} carries no structuredContent`);
    check?.(answer);
  }
}

/** Each case is refused, with a line in the log of the category given. */
async function allRefused(category: string, cases: Case[]): Promise<void> {
  for (const [tool, args, check] of cases) {
    const before = logged.length;
    const answer = await call(tool, args);
    const what = `${tool} ${JSON.stringify(args)}`;
    assert.equal(answer.isError, true, `${what} was answered: ${answer.text.slice(0, 200)}`);
    assert.deepEqual(
      logged.slice(before).map(line => [line.tool, line.category]),
      [[tool, category]],
      `${what}: one log line, for this tool and this kind of error`,
    );
    check?.(answer);
  }
}

const costed = (answer: Answer): string[] =>
  answer.data.modelCosts.map((entry: { model: { provider: string; model: string } }) => `${entry.model.provider} ${entry.model.model}`);
const columns = (answer: Answer): string[] =>
  answer.data.models.map((m: { provider: string; model: string }) => `${m.provider} ${m.model}`);
const statuses = (answer: Answer): string[] => answer.data.resolution.map((r: { status: string }) => r.status);

// ── The definitions ─────────────────────────────────────────────────

test("reading arguments more tolerantly moved no published definition", async () => {
  // A definition that changes makes claude.ai ask every user who chose "Always
  // allow" to approve the tool again. The tolerance sits in front of the
  // schemas, so what tools/list publishes must be what is pinned, to the byte.
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
        : value;
  const pinned = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../scripts/tools-fingerprint.json", import.meta.url)), "utf8"),
  ).tools as Record<string, string>;

  const { result } = await rpc("tools/list", {});
  const served = Object.fromEntries(
    (result?.tools as { name: string }[]).map(tool => [
      tool.name,
      createHash("sha256").update(JSON.stringify(canonical(tool))).digest("hex"),
    ]),
  );
  assert.deepEqual(served, pinned);
});

// ── Well-formed calls ───────────────────────────────────────────────

test("every well-formed call answers", async () => {
  await allAnswer([
    ["compare-llm-models", {}],
    ["compare-llm-models", { provider: "OpenAI", limit: 5 }],
    ["compare-llm-models", { openness: "Open weights", minElo: 1300 }],
    ["compare-llm-models", { useCasePreset: "codingTask", sortBy: "cost", limit: 10 }],
    ["estimate-llm-cost", {}],
    ["estimate-llm-cost", { modelName: "GPT-4o", useCasePreset: "supportTicket" }],
    ["estimate-llm-cost", { modelName: "Claude Sonnet 5.5", customInputTokens: 800, customOutputTokens: 200, monthlyVolume: 4_000_000 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", customInputTokens: 3000, customOutputTokens: 500, cacheHitRate: 0.6, batchEligible: false }],
    ["compare-models-side-by-side", { models: ["GPT-4o", "Claude Opus 5", "Gemini 3.1 Pro"] }, a => assert.equal(a.data.models.length, 3)],
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude Sonnet 5.5"], volumePreset: "1m" }],
    ["recommend-llm-model", { useCasePreset: "supportTicket", maxMonthlyBudget: 500 }],
    ["recommend-llm-model", { useCasePreset: "agentWorkflow", volumePreset: "1m", minElo: 1400, openness: "Open weights" }],
    ["recommend-llm-model", { useCasePreset: "codingTask", maxMonthlyBudget: 1, minElo: 1500 }, a => assert.equal(a.data.overConstrained, true)],
    ["compare-compute-pricing", {}],
    ["compare-compute-pricing", { region: "europe", minVCPUs: 8, minMemory: 32, limit: 5 }],
    ["compare-compute-pricing", { provider: "AWS", category: "GPU / Accelerated", limit: 10 }],
    ["compare-compute-pricing", { useCase: "ML & AI", sortBy: "pricePerVCPU" }],
    ["compare-model-hosts", { models: ["Llama 3.3 70B"] }, a => assert.equal(a.data.hostList.available, true)],
    ["compare-model-hosts", { models: ["Claude Sonnet 5", "DeepSeek V4"] }],
    ["compare-model-hosts", { models: ["GPT-4o"], useCasePreset: "codingTask", volumePreset: "1m" }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "g6e.12xlarge" }, a => assert.ok(a.data.options.length > 0)],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: 2.5, outputTokensPerSecond: 1500, monthlyVolume: 2_000_000 }],
    ["estimate-self-hosting-breakeven", { model: "GPT-5.5", hourlyRate: 3 }, a => assert.equal(a.data.model.selfHostable, false)],
    ["track-llm-price-changes", {}, a => assert.equal(a.data.mode, "window")],
    ["track-llm-price-changes", { direction: "down" }],
    ["track-llm-price-changes", { provider: "OpenAI", includeFlagged: false }],
    ["track-llm-price-changes", { models: ["Llama 3.3 70B"] }, a => assert.equal(a.data.histories[0].known, true)],
    ["track-llm-price-changes", { models: ["GPT-4o", "Claude Sonnet 5"] }, a => assert.equal(a.data.histories.length, 2)],
  ]);
});

// ── The same argument, spelled another way ──────────────────────────

test("an option of a closed list is read in another case, as its label, or as the provider writes it", async () => {
  await allAnswer([
    ["compare-llm-models", { openness: "open weights" }],
    ["compare-llm-models", { openness: "open-source" }],
    ["compare-llm-models", { volumePreset: "1M" }, a => assert.equal(a.data.volumeLabel, "1M")],
    ["compare-llm-models", { useCasePreset: "coding" }, a => assert.equal(a.data.useCaseLabel, "Coding Task")],
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude Opus 5"], volumePreset: "100K" }, a => assert.equal(a.data.volume, 100_000)],
    ["recommend-llm-model", { useCasePreset: "support tickets" }, a => assert.equal(a.data.useCaseLabel, "Support Ticket")],
    ["recommend-llm-model", { useCasePreset: "supportTicket", openness: "open-weights" }],
    // The region group, from a provider's own code. The answer names the group
    // it priced, and the place each provider's figures describe.
    ["compare-compute-pricing", { region: "us-east-1" }, a => assert.equal(a.data.provenance.region, "us-east")],
    ["compare-compute-pricing", { region: "eu-west-1", provider: "AWS" }, a => {
      assert.equal(a.data.provenance.region, "europe");
      assert.match(a.text, /eu-west-1 \(Ireland\)/);
    }],
    ["compare-compute-pricing", { region: "Europe" }, a => assert.equal(a.data.provenance.region, "europe")],
    ["compare-compute-pricing", { region: "EU" }, a => assert.equal(a.data.provenance.region, "europe")],
    ["compare-compute-pricing", { sortBy: "pricePerVcpu" }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "g6e.12xlarge", region: "us-east-1" }, a => assert.equal(a.data.fleet.region, "us-east")],
    ["track-llm-price-changes", { direction: "decrease" }, a => {
      assert.ok(a.data.matchingCount >= 1);
      for (const move of [...a.data.priceChanges, ...a.data.flaggedMoves]) assert.ok(move.blendedPct < 0);
    }],
  ]);
});

test("a number, a yes or no and a list are read when they arrive as text, and null as not given", async () => {
  await allAnswer([
    ["compare-llm-models", { maxInputPrice: "1" }, a => {
      for (const m of a.data.models) assert.ok(m.inputPricePer1M <= 1);
    }],
    ["compare-llm-models", { provider: null, limit: null, sortBy: null }],
    ["compare-llm-models", { provider: "", capability: "" }, a => assert.equal(a.data.matchingCount, CATALOGUE.length)],
    ["estimate-llm-cost", { modelName: "GPT-5.5", monthlyVolume: "1000000" }, a => assert.equal(a.data.volume, 1_000_000)],
    ["estimate-llm-cost", { modelName: "GPT-5.5", customInputTokens: "3,000", customOutputTokens: "500", batchEligible: "true" }, a =>
      assert.equal(a.data.modelCosts[0].costs[0].batchEligible, true)],
    ["recommend-llm-model", { useCasePreset: "supportTicket", maxMonthlyBudget: "500" }],
    ["compare-compute-pricing", { minVCPUs: "8" }, a => {
      for (const row of a.data.instances) assert.ok(row.vCPUs >= 8);
    }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: "2.5" }, a => assert.equal(a.data.options[0].hourlyRate, 2.5)],
    ["compare-models-side-by-side", { models: "GPT-5.5, Claude Opus 5" }, a => assert.deepEqual(columns(a), ["OpenAI GPT-5.5", "Anthropic Claude Opus 5"])],
    ["compare-model-hosts", { models: "Llama 3.3 70B" }, a => assert.equal(a.data.models.length, 1)],
    ["track-llm-price-changes", { models: "GPT-5.5" }, a => assert.equal(a.data.mode, "history")],
    // No names is no names: the week's moves, as when `models` is left out.
    ["track-llm-price-changes", { models: [] }, a => assert.equal(a.data.mode, "window")],
  ]);
});

test("more rows than the most is the most, and a share above 1 is a percentage", async () => {
  await allAnswer([
    ["compare-llm-models", { limit: 100 }, a => {
      assert.equal(a.data.models.length, 50);
      assert.equal(a.data.matchingCount, CATALOGUE.length);
    }],
    ["compare-compute-pricing", { limit: 100 }, a => assert.equal(a.data.instances.length, 50)],
    ["track-llm-price-changes", { limit: 100 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", customInputTokens: 3000, customOutputTokens: 500, cacheHitRate: 60 }, a =>
      assert.equal(a.data.modelCosts[0].costs[0].cacheHitRate, 0.6)],
  ]);
});

test("an argument under the name a sibling tool gives it is read as this tool's own", async () => {
  await allAnswer([
    // On 0.13.0 `model` was dropped and the first eight models costed; on
    // 0.14.x it was an error. It is the model asked for.
    ["estimate-llm-cost", { model: "GPT-5.5" }, a => assert.deepEqual(costed(a).slice(0, 1), ["OpenAI GPT-5.5"])],
    ["estimate-llm-cost", { models: ["GPT-5.5"] }, a => assert.deepEqual(costed(a).slice(0, 1), ["OpenAI GPT-5.5"])],
    ["estimate-llm-cost", { model_name: "GPT-4o-mini" }, a => assert.deepEqual(costed(a), ["OpenAI GPT-4o-mini"])],
    ["estimate-llm-cost", { modelName: "GPT-5.5", volumePreset: "1m" }, a => assert.equal(a.data.volume, 1_000_000)],
    ["compare-llm-models", { monthlyVolume: 1_000_000 }, a => assert.equal(a.data.volumeLabel, "1M")],
    ["compare-llm-models", { use_case_preset: "codingTask" }, a => assert.equal(a.data.useCaseLabel, "Coding Task")],
    ["recommend-llm-model", { useCase: "supportTicket" }, a => assert.equal(a.data.useCaseLabel, "Support Ticket")],
    ["compare-model-hosts", { model: "Llama 3.3 70B" }, a => assert.deepEqual(statuses(a), ["unique"])],
    ["estimate-self-hosting-breakeven", { modelName: "Llama 3.3 70B", hourlyRate: 3 }, a => assert.equal(a.data.model.model, "Llama 3.3 70B Instruct")],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: 3, volumePreset: "1m" }, a => assert.equal(a.data.workload.volume, 1_000_000)],
    ["track-llm-price-changes", { model: "GPT-5.5" }, a => assert.equal(a.data.mode, "history")],
    // Dropped, because it cannot change the answer: every use case is costed,
    // and Linux is the only operating system served.
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude Opus 5"], useCasePreset: "codingTask" }, a => assert.equal(a.data.models.length, 2)],
    ["compare-compute-pricing", { os: "Linux", limit: 3 }],
  ]);
});

test("a provider is found by any of its names", async () => {
  await allAnswer([
    ["compare-llm-models", { provider: "openai" }, a => {
      assert.ok(a.data.matchingCount >= 3);
      for (const m of a.data.models) assert.equal(m.provider, "OpenAI");
    }],
    ["compare-compute-pricing", { provider: "Amazon" }, a => {
      assert.ok(a.data.matchingCount > 100, "Amazon is AWS, not a provider with no instance");
      for (const row of a.data.instances) assert.equal(row.provider, "AWS");
    }],
    ["compare-compute-pricing", { provider: "Google Cloud" }, a => assert.equal(a.data.instances[0].provider, "GCP")],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "a2-highgpu-1g", provider: "Google" }, a =>
      assert.equal(a.data.fleet.provider, "GCP")],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "G6E.12XLARGE" }, a => assert.equal(a.data.fleet.instanceType, "g6e.12xlarge")],
    // A filter that matches nothing answers "none": documented, and no error.
    ["compare-llm-models", { provider: "Aleph Alpha" }, a => assert.equal(a.data.matchingCount, 0)],
    ["compare-llm-models", { capability: "vision" }, a => assert.ok(a.data.matchingCount > 0)],
    ["compare-llm-models", { capability: "Code" }, a => assert.equal(a.data.matchingCount, 0)],
    ["recommend-llm-model", { useCasePreset: "codingTask", requiredCapability: "Code" }],
    ["compare-compute-pricing", { provider: "CoreWeave" }, a => assert.equal(a.data.matchingCount, 0)],
    ["compare-compute-pricing", { category: "GPU" }, a => assert.equal(a.data.matchingCount, 0)],
    ["compare-compute-pricing", { processor: "H100" }, a => assert.equal(a.data.matchingCount, 0)],
  ]);
});

// ── Model names ─────────────────────────────────────────────────────

test("a model is found by the identifier an API gives it", async () => {
  await allAnswer([
    ["estimate-llm-cost", { modelName: "claude sonnet" }, a => assert.ok(costed(a).length > 1)],
    ["estimate-llm-cost", { modelName: "gpt-4o-mini" }, a => assert.deepEqual(costed(a), ["OpenAI GPT-4o-mini"])],
    ["estimate-llm-cost", { modelName: "anthropic/claude-sonnet-4.5" }, a => assert.deepEqual(costed(a), ["Anthropic Claude Sonnet 4.5"])],
    // Each of these matched nothing on 0.14.3.
    ["estimate-llm-cost", { modelName: "claude-sonnet-5-5" }, a => assert.deepEqual(costed(a), ["Anthropic Claude Sonnet 5.5"])],
    ["estimate-llm-cost", { modelName: "claude-sonnet-4-5-20250929" }, a => assert.deepEqual(costed(a), ["Anthropic Claude Sonnet 4.5"])],
    ["estimate-llm-cost", { modelName: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" }, a => assert.deepEqual(costed(a), ["Anthropic Claude Sonnet 4.5"])],
    ["estimate-llm-cost", { modelName: "meta-llama/llama-3.3-70b-instruct" }, a => assert.deepEqual(costed(a), ["Meta Llama 3.3 70B Instruct"])],
    ["compare-model-hosts", { models: ["llama-3.3-70b-instruct"] }, a => assert.equal(a.data.models.length, 1)],
    ["compare-model-hosts", { models: ["meta-llama/llama-3.3-70b-instruct"] }, a => assert.equal(a.data.models.length, 1)],
    ["compare-models-side-by-side", { models: ["gpt-5.5", "claude-sonnet-5-5"] }, a =>
      assert.deepEqual(columns(a), ["OpenAI GPT-5.5", "Anthropic Claude Sonnet 5.5"])],
    ["estimate-llm-cost", { modelName: "Anthropic" }, a => assert.ok(costed(a).every(name => name.startsWith("Anthropic "))) ],
  ]);
});

test("a name that matches nothing is answered with the closest names, and none is used in its place", async () => {
  const before = logged.length;
  const noFigure = (a: Answer) => assert.doesNotMatch(a.text, /\$\d/, "a miss quotes no price");

  await allAnswer([
    // A retired model, a dated id of one, a wrong version, a misspelling.
    ["estimate-llm-cost", { modelName: "Claude 3.5 Sonnet" }, a => {
      assert.deepEqual(a.data.modelCosts, []);
      assert.match(a.data.error, /No model in the catalogue of 94 matches "Claude 3\.5 Sonnet", so no cost was estimated\./);
      assert.match(a.data.error, /Closest names in the catalogue: Anthropic Claude Sonnet/);
      assert.match(a.data.error, /None of them was costed in its place\./);
      assert.ok(a.text.startsWith(a.data.error), "the text and the JSON say the same");
      assert.equal(a.data.provenance.tier, 1, "a miss is still dated: the catalogue it was looked up in");
      noFigure(a);
    }],
    ["estimate-llm-cost", { modelName: "claude-3-5-sonnet-20241022" }, a => assert.deepEqual(a.data.modelCosts, [])],
    ["estimate-llm-cost", { modelName: "Llama 3 70B" }, a => {
      assert.deepEqual(a.data.modelCosts, []);
      assert.match(a.data.error, /Meta Llama 3\.3 70B Instruct/);
    }],
    ["estimate-llm-cost", { modelName: "GPT-4 Turbo" }, a => assert.deepEqual(a.data.modelCosts, [])],
    ["estimate-llm-cost", { modelName: "Claud Sonet 5.5" }, a => {
      assert.deepEqual(a.data.modelCosts, []);
      assert.match(a.data.error, /Closest names in the catalogue: Anthropic Claude Sonnet 5\.5/);
    }],
    ["estimate-llm-cost", { modelName: "FooBar 9000" }, a => {
      assert.deepEqual(a.data.modelCosts, []);
      assert.match(a.data.error, /No name in the catalogue is close to it\./);
    }],
    ["compare-model-hosts", { models: ["Llama 3 70B"] }, a => {
      assert.deepEqual(a.data.models, []);
      assert.deepEqual(statuses(a), ["not-found"]);
      assert.ok(a.data.resolution[0].alternatives.includes("Meta Llama 3.3 70B Instruct"));
      assert.match(a.data.error, /no host was looked up/);
      noFigure(a);
    }],
    ["compare-model-hosts", { models: ["FooBar 9000"] }, a => assert.deepEqual(a.data.resolution[0].alternatives, [])],
    ["estimate-self-hosting-breakeven", { model: "Llama 3 70B", hourlyRate: 3 }, a => {
      assert.equal(a.data.model, null);
      assert.deepEqual(a.data.options, []);
      assert.match(a.data.error, /no break-even/);
      noFigure(a);
    }],
    ["track-llm-price-changes", { models: ["Claude 3.5 Sonnet"] }, a => {
      assert.deepEqual(a.data.histories, []);
      assert.deepEqual(statuses(a), ["not-found"]);
      assert.match(a.data.error, /That is not "the price never changed"\./);
    }],
    ["track-llm-price-changes", { models: ["FooBar 9000"] }, a => assert.deepEqual(a.data.histories, [])],
    ["compare-models-side-by-side", { models: ["FooBar 9000", "Claude 3.5 Sonnet"] }, a => {
      assert.deepEqual(a.data.models, []);
      assert.match(a.data.error, /None of the 2 names matched a model in the catalogue, so there is nothing to compare\./);
    }],
  ]);
  assert.deepEqual(logged.slice(before), [], "a lookup that finds nothing is not an error, and logs none");
});

test("one name that resolves is still costed when the other does not", async () => {
  await allAnswer([
    // Until 0.15.0 a retired model among two names lost the other's figures.
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude 3.5 Sonnet"] }, a => {
      assert.deepEqual(columns(a), ["OpenAI GPT-5.5"]);
      assert.deepEqual(statuses(a), ["exact", "not-found"]);
      assert.match(a.text, /Only one of the 2 names resolved to a distinct model, so there is one column/);
      assert.match(a.text, /"Claude 3\.5 Sonnet" matched no model — no column for it\./);
      assert.equal(a.data.models[0].useCaseCosts.length, 8);
    }],
    ["compare-models-side-by-side", { models: ["GPT-5.5", "gpt 5.5"] }, a => {
      assert.deepEqual(columns(a), ["OpenAI GPT-5.5"]);
      assert.deepEqual(statuses(a), ["exact", "duplicate"]);
    }],
  ]);
});

// ── The break-even without a fleet ──────────────────────────────────

test("a break-even with no fleet priced still gives the API side, and why there is no break-even", async () => {
  const apiSideOnly = (a: Answer) => {
    assert.equal(a.data.fleet, null);
    assert.deepEqual(a.data.options, []);
    assert.equal(a.data.model.model, "Llama 3.3 70B Instruct");
    assert.deepEqual(a.data.api.map((entry: { basis: string }) => entry.basis).slice(0, 2), ["list", "optimized"]);
    assert.ok(a.data.api[0].monthly > 0);
    assert.match(a.text, /Paying per token:/);
    assert.match(a.text, /No fleet was priced, so no break-even is given\./);
    assert.ok(a.text.includes(a.data.error), "the reason is in the text and in the JSON");
  };
  await allAnswer([
    // "Is self-hosting worth it" before any hardware is named. Nothing is
    // assumed (decision 11): the answer says what the fleet side is missing.
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B" }, a => {
      apiSideOnly(a);
      assert.match(a.data.error, /^No fleet was named\./);
      assert.match(a.data.error, /No instance is assumed\./);
    }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "g6e.12xl" }, a => {
      apiSideOnly(a);
      assert.match(a.data.error, /No instance named "g6e\.12xl" in the us-east catalogue/);
      assert.match(a.data.error, /Close names: AWS g6e\.12xlarge\./);
      assert.equal(a.data.computeProvenance.region, "us-east");
    }],
    // A GPU is not an instance: the instances that carry one are named.
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "H100" }, apiSideOnly],
  ]);
});

// ── What stays an error ─────────────────────────────────────────────

test("an argument the tool does not have is refused with what the tool takes", async () => {
  await allRefused("unknown-argument", [
    ["compare-llm-models", { model: "GPT-4o" }, a => {
      assert.match(a.text, /^`model` is not an argument of compare-llm-models, so the call was not run/);
      assert.match(a.text, /compare-llm-models takes: provider, category, openness, capability, /);
      assert.match(a.text, /takes no model name\. estimate-llm-cost costs one named model/);
    }],
    ["compare-llm-models", { monthlyVolume: 250_000 }, a => assert.match(a.text, /volumePreset 10k, 100k or 1m\)\. estimate-llm-cost takes any monthlyVolume\./)],
    ["estimate-llm-cost", { models: ["GPT-5.5", "Claude Opus 5"] }, a => assert.match(a.text, /takes one name, in modelName\. compare-models-side-by-side takes 2 to 4 names\./)],
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude Opus 5"], monthlyVolume: 500_000 }],
    ["recommend-llm-model", { useCasePreset: "supportTicket", monthlyVolume: 250_000 }],
    ["recommend-llm-model", { useCasePreset: "supportTicket", provider: "Anthropic" }, a => assert.match(a.text, /has no provider filter\. compare-llm-models filters by provider\./)],
    // Windows rates answered with Linux ones would be a wrong answer.
    ["compare-compute-pricing", { os: "Windows" }, a => assert.match(a.text, /serves Linux list prices only\./)],
    ["compare-compute-pricing", { instanceType: "g6e.12xlarge" }, a => assert.match(a.text, /has no filter by instance name\./)],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: 3, gpuCount: 4 }, a => assert.match(a.text, /counted in instances \(instanceCount\)/)],
    ["track-llm-price-changes", { days: 30 }, a => assert.match(a.text, /cover the last 7 days and the window is fixed\./)],
    ["track-llm-price-changes", { since: "2026-06-01" }],
    // Both names of one argument: neither is chosen for the caller.
    ["estimate-llm-cost", { model: "GPT-5.5", modelName: "GPT-4o" }],
  ]);
});

test("a value with no single reading is refused by the schema, by name", async () => {
  await allRefused("input-validation", [
    ["compare-llm-models", { volumePreset: "500k" }, a => assert.match(a.text, /expected one of "10k"\|"100k"\|"1m" at volumePreset/)],
    // Three sort keys are a price: none is picked.
    ["compare-llm-models", { sortBy: "price" }],
    ["compare-llm-models", { limit: -5 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", customInputTokens: 0.8, customOutputTokens: 0.2 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", customInputTokens: 500, customOutputTokens: 0 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", monthlyVolume: 2_000_000_000 }],
    ["estimate-llm-cost", { modelName: "GPT-5.5", monthlyVolume: -100 }],
    ["compare-models-side-by-side", { models: ["GPT-5.5"] }],
    ["compare-models-side-by-side", { models: ["GPT-5.5", "Claude Opus 5", "Gemini 2.5 Pro", "Grok 4.5", "DeepSeek V3.2"] }],
    ["compare-models-side-by-side", { models: [] }],
    ["compare-models-side-by-side", {}],
    ["recommend-llm-model", {}],
    ["recommend-llm-model", { maxMonthlyBudget: 500 }],
    ["recommend-llm-model", { useCasePreset: "rag" }],
    ["recommend-llm-model", { useCasePreset: "supportTicket", maxMonthlyBudget: 0 }],
    ["compare-compute-pricing", { limit: 0 }],
    ["compare-compute-pricing", { region: "mars" }],
    ["compare-model-hosts", { models: [] }],
    ["compare-model-hosts", { models: ["GPT-5.5", "Claude Opus 5", "Gemini 2.5 Pro", "Grok 4.5", "DeepSeek V3.2"] }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: 0 }],
    ["track-llm-price-changes", { direction: "sideways" }],
  ]);
});

test("arguments that contradict each other are refused", async () => {
  await allRefused("invalid-arguments", [
    ["estimate-llm-cost", { modelName: "GPT-5.5", useCasePreset: "supportTicket", cacheHitRate: 0.6 }],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", instanceType: "g6e.12xlarge", hourlyRate: 10 }, a => assert.match(a.text, /not both: they are two different fleets/)],
    ["estimate-self-hosting-breakeven", { model: "Llama 3.3 70B", hourlyRate: 3, customInputTokens: 800 }],
    ["track-llm-price-changes", { models: ["Claude Sonnet 5"], direction: "down" }],
    ["estimate-llm-cost", { modelName: "x".repeat(201) }],
  ]);
});

test("a price archive that cannot be read is an error, never a quiet week", async t => {
  // Decision 12. The one read with no fallback behind it.
  const { resetPriceChangesCache } = await import("./lib/price-changes.js");
  resetPriceChangesCache();
  site.archiveDown = true;
  t.after(() => {
    site.archiveDown = false;
    resetPriceChangesCache();
  });
  await allRefused("upstream-unavailable", [
    ["track-llm-price-changes", {}, a => assert.match(a.text, /No move is reported: that is not "nothing moved"\./)],
    ["track-llm-price-changes", { models: ["GPT-5.5"] }, a => assert.match(a.text, /that is not "the price never changed"/)],
  ]);
});

// ── The log ─────────────────────────────────────────────────────────

test("an error's log line holds the tool, the kind and the argument's name, and never a value", async () => {
  const before = logged.length;
  await call("compare-compute-pricing", { os: "Windows Server 2025" });
  await call("compare-llm-models", { volumePreset: "five hundred thousand" });
  await call("estimate-llm-cost", { modelName: "GPT-5.5", "a key that is a sentence": 1 });
  await call("no-such-tool", { secret: "value" });

  assert.deepEqual(logged.slice(before), [
    { event: "tool_error", tool: "compare-compute-pricing", category: "unknown-argument", arguments: ["os"] },
    { event: "tool_error", tool: "compare-llm-models", category: "input-validation", arguments: ["volumePreset"], issues: ["invalid_value"] },
    { event: "tool_error", tool: "estimate-llm-cost", category: "unknown-argument", arguments: ["(unprintable)"] },
    { event: "tool_error", tool: "(unknown)", category: "unknown-tool" },
  ]);
  const written = JSON.stringify(logged.slice(before));
  for (const value of ["Windows", "five hundred", "sentence", "no-such-tool", "secret", "GPT-5.5"]) {
    assert.ok(!written.includes(value), `the log repeats ${JSON.stringify(value)}`);
  }
});
