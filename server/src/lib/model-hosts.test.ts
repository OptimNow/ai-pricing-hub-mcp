import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MODEL_HOST_IDS,
  coerceModelHosts,
  describeHostListFailure,
  fetchModelHosts,
  resetModelHostsCache,
} from "./model-hosts.js";
import { OPTIMTOKEN_BASE_URL, UpstreamFetchError } from "./optimtoken-api.js";

/**
 * The full host list answers "where can we buy it". The way it goes wrong is
 * not a crash: it is an absence read as a fact. No platforms line becoming
 * "sold nowhere", no Bedrock regions becoming "not on Bedrock", a failed
 * request becoming "one host". These tests hold the difference between
 * "nothing on record" and "nothing".
 */

const LLAMA = {
  openRouterId: "meta-llama/llama-3.3-70b-instruct",
  provider: "Meta",
  model: "Llama 3.3 70B Instruct",
  hosts: 3,
  offers: [
    { host: "DeepInfra", input: 0.1, output: 0.32, quantization: "fp8" },
    { host: "Together", input: 0.6, output: 0.6, discount: 0.25 },
    { host: "Amazon Bedrock", input: 0.72, output: 0.72 },
  ],
  platforms: { names: ["AWS Bedrock", "Azure AI Foundry"], provenance: "estimated" },
  bedrockRegions: ["us-east-1", "eu-west-1"],
};

const META = {
  schemaVersion: "1.0",
  hostPricingAsOf: "2026-11-11",
  availabilityReviewedAt: "2026-10-20",
  bedrockAvailabilityAsOf: "2026-11-09",
};

// ── Reading the payload ─────────────────────────────────────────────

test("a model's hosts, platforms and regions are read as sent", () => {
  const result = coerceModelHosts({ meta: META, models: [LLAMA], notFound: ["some/unknown-id"] });

  assert.deepEqual(result.meta, META);
  assert.deepEqual(result.notFound, ["some/unknown-id"]);
  assert.deepEqual(result.byId.get(LLAMA.openRouterId), {
    openRouterId: LLAMA.openRouterId,
    hosts: 3,
    // In the site's order: cheapest first. Re-sorting here would be a second
    // opinion on a ranking the site already made.
    offers: LLAMA.offers,
    platforms: LLAMA.platforms,
    bedrockRegions: LLAMA.bedrockRegions,
  });
});

test("absent stays absent: nothing on record is never an empty list", () => {
  const bare = { openRouterId: "vendor/bare", provider: "Vendor", model: "Bare" };
  const empties = {
    openRouterId: "vendor/empties",
    offers: [],
    platforms: { names: [], provenance: "estimated" },
    bedrockRegions: [],
  };
  const result = coerceModelHosts({ models: [bare, empties] });

  for (const id of ["vendor/bare", "vendor/empties"]) {
    const detail = result.byId.get(id);
    assert.ok(detail, `${id} is known to the site`);
    // An empty list would be printed as "sold by no host", "on no platform",
    // "in no Bedrock region": three claims nobody made.
    assert.equal(detail.offers, undefined, `${id} offers`);
    assert.equal(detail.platforms, undefined, `${id} platforms`);
    assert.equal(detail.bedrockRegions, undefined, `${id} bedrockRegions`);
    assert.equal(detail.hosts, undefined, `${id} hosts`);
  }
  assert.deepEqual(result.notFound, []);
  assert.deepEqual(result.meta, {
    schemaVersion: undefined,
    hostPricingAsOf: undefined,
    availabilityReviewedAt: undefined,
    bedrockAvailabilityAsOf: undefined,
  });
});

test("a broken offer is dropped, and the usable ones are kept", () => {
  const result = coerceModelHosts({
    models: [
      {
        openRouterId: "vendor/mixed",
        offers: [
          { host: "Good", input: 1, output: 2 },
          { host: "No prices" },
          { host: "Negative", input: -1, output: 2 },
          { input: 1, output: 2 },
          "not an offer",
        ],
      },
      { provider: "No id", offers: [{ host: "Good", input: 1, output: 2 }] },
    ],
  });
  assert.deepEqual(result.byId.get("vendor/mixed")?.offers, [{ host: "Good", input: 1, output: 2 }]);
  assert.equal(result.byId.size, 1, "a row with no id cannot be matched to a model");
});

test("a payload with no models array is a failed read, not an empty answer", () => {
  for (const bad of [{}, { models: "none" }, { models: null }, null, undefined]) {
    assert.throws(() => coerceModelHosts(bad), /no "models" array/, JSON.stringify(bad));
  }
});

// ── Asking the site ─────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const requested: string[] = [];

function stubFetch(responder: (url: string) => { status?: number; body?: unknown; throws?: boolean }) {
  requested.length = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    const r = responder(url);
    if (r.throws) throw new Error("network down");
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

function restore() {
  globalThis.fetch = realFetch;
  resetModelHostsCache();
}

test("the ids are sent as the site reads them: one repeated parameter", async (t) => {
  t.after(restore);
  resetModelHostsCache();
  stubFetch(() => ({ body: { meta: META, models: [LLAMA] } }));

  await fetchModelHosts(["openai/gpt-x", LLAMA.openRouterId, "openai/gpt-x"]);

  assert.equal(requested.length, 1);
  const url = new URL(requested[0]);
  assert.ok(requested[0].startsWith(`${OPTIMTOKEN_BASE_URL}/api/model-hosts?`), requested[0]);
  // Deduplicated and sorted, so one set of models is one cache entry upstream
  // and here, whatever order the caller named them in.
  assert.deepEqual(url.searchParams.getAll("id"), [LLAMA.openRouterId, "openai/gpt-x"]);
});

test("the same models asked again are answered from memory", async (t) => {
  t.after(restore);
  resetModelHostsCache();
  stubFetch(() => ({ body: { meta: META, models: [LLAMA] } }));

  const first = await fetchModelHosts([LLAMA.openRouterId]);
  const second = await fetchModelHosts([LLAMA.openRouterId]);
  assert.equal(requested.length, 1, "one request for two identical calls");
  assert.equal(second, first);
});

test("nothing to ask is no request, and too many ids is refused before one is made", async (t) => {
  t.after(restore);
  resetModelHostsCache();
  stubFetch(() => ({ throws: true }));

  const none = await fetchModelHosts([]);
  assert.equal(none.byId.size, 0);
  assert.equal(requested.length, 0);

  const tooMany = Array.from({ length: MAX_MODEL_HOST_IDS + 1 }, (_, i) => `vendor/model-${i}`);
  await assert.rejects(() => fetchModelHosts(tooMany), /4 ids at most/);
  assert.equal(requested.length, 0, "the site would answer 400: do not ask");
});

test("a failed read throws, classified, and is not remembered", async (t) => {
  t.after(restore);
  resetModelHostsCache();

  stubFetch(() => ({ status: 503 }));
  await assert.rejects(
    () => fetchModelHosts([LLAMA.openRouterId]),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "http-status" && error.status === 503,
  );

  stubFetch(() => ({ throws: true }));
  await assert.rejects(
    () => fetchModelHosts([LLAMA.openRouterId]),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "transport",
  );

  // 200 with a body in another shape: a guard failure, not an empty catalogue.
  stubFetch(() => ({ body: { error: "nope" } }));
  await assert.rejects(
    () => fetchModelHosts([LLAMA.openRouterId]),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "guard",
  );

  // What the answer says about it is short, and carries no URL.
  const reasons = [
    new UpstreamFetchError("timeout", "x", { url: "https://example.test/secret?id=a", elapsedMs: 8000, timeoutMs: 8000 }),
    new UpstreamFetchError("http-status", "x", { url: "https://example.test/secret?id=a", elapsedMs: 3, status: 503 }),
    new UpstreamFetchError("transport", "x", { url: "https://example.test/secret?id=a", elapsedMs: 3 }),
    new UpstreamFetchError("guard", "x", { url: "https://example.test/secret?id=a", elapsedMs: 3 }),
    new Error("anything else"),
  ].map(describeHostListFailure);
  assert.deepEqual(reasons, [
    "the site did not answer within 8 seconds",
    "the site answered HTTP 503",
    "the site could not be reached",
    "the site's answer could not be read",
    "the site's answer could not be read",
  ]);

  // A failure must not poison the memo: the next call asks again and succeeds.
  stubFetch(() => ({ body: { meta: META, models: [LLAMA] } }));
  const recovered = await fetchModelHosts([LLAMA.openRouterId]);
  assert.equal(recovered.byId.get(LLAMA.openRouterId)?.offers?.length, 3);
});
