import test from "node:test";
import assert from "node:assert/strict";
import { fetchLLMModels, resetLLMModelCache } from "./llm-models.js";
import { fetchComputeInstances, resetComputePricingCache } from "./compute-pricing.js";
import { optimtokenUrl, OPTIMTOKEN_BASE_URL } from "./optimtoken-api.js";
import { opennessOf } from "./openness.js";

/**
 * The fallback chain is the part of this server that only runs when something
 * is already broken, which is exactly why it needs tests: in production nobody
 * sees tier 2 or tier 3 until the day they are serving every request.
 *
 * The property that matters is not "a fallback exists" but "a fallback says so".
 * OpenRouter intermittently publishes a model at exactly half its vendor's list
 * rate, and the corrections for that live only on the site. So a response that
 * fell past tier 1 is serving uncorrected prices to a caller whose tool
 * description tells it to report figures exactly as returned. Silence there is
 * the bug.
 */

// ── Fixtures ────────────────────────────────────────────────────────

/** Enough rows to clear MIN_PLAUSIBLE_CATALOGUE (80). */
function siteModels(count = 120) {
  return Array.from({ length: count }, (_, i) => ({
    provider: "TestVendor",
    model: `Alpha ${i}`,
    inputPricePer1M: 1 + i,
    outputPricePer1M: 2 + i,
    contextWindow: "128K",
    category: "Mid-tier",
    capabilities: ["Text"],
    releaseDate: "2026-01",
    eloScore: 1200 + i,
    license: "Proprietary",
  }));
}

function siteModelsResponse(overrides: Record<string, unknown> = {}) {
  return {
    models: siteModels(),
    meta: {
      schemaVersion: "2.0",
      total: 120,
      catalogTotal: 257,
      source: "openrouter",
      timestamp: "2026-08-17T19:43:36.090Z",
      eloAsOf: "2026-08-13",
    },
    ...overrides,
  };
}

/** Enough OpenRouter rows to clear the same floor after transform. */
function openRouterPayload(count = 120) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      id: `testvendor/alpha-${i}`,
      name: `Alpha ${i}`,
      created: 1_750_000_000,
      description: "test model",
      context_length: 128_000,
      architecture: {
        modality: "text->text",
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      pricing: { prompt: "0.000001", completion: "0.000002" },
      top_provider: { context_length: 128_000, max_completion_tokens: 4096 },
      supported_parameters: ["tools"],
    })),
  };
}

/** Enough rows to clear MIN_PLAUSIBLE_COMPUTE_CATALOGUE (100). */
function siteInstances(count = 150) {
  return Array.from({ length: count }, (_, i) => ({
    provider: "AWS",
    instanceType: `m7i.${i}xlarge`,
    os: "Linux",
    vCPUs: 2 + i,
    memory: 8 + i,
    onDemandHourly: 0.1 + i,
    onDemandMonthly: 73 + i,
    spot: 0.03 + i,
    savingsPlan1yr: 0.08 + i,
    savingsPlan3yr: 0.06 + i,
    reserved1yr: 0.07 + i,
    reserved3yr: 0.05 + i,
  }));
}

function sitePricingResponse(overrides: Record<string, unknown> = {}) {
  return {
    instances: siteInstances(),
    meta: {
      schemaVersion: "1.2",
      region: "europe",
      timestamp: "2026-08-17T20:00:41.353Z",
      sources: { AWS: "live", Alibaba: "static" },
      sourceRegions: { AWS: "eu-west-1 (Ireland)" },
      priceTypes: {
        AWS: {
          onDemand: "live",
          spot: "live",
          savingsPlan1yr: "static",
          savingsPlan3yr: "static",
          reserved1yr: "live",
          reserved3yr: "live",
        },
        GCP: {
          onDemand: "live",
          spot: "live",
          savingsPlan1yr: "static",
          savingsPlan3yr: "static",
          reserved1yr: "unavailable",
          reserved3yr: "unavailable",
        },
      },
      liveProviders: { live: 6, expected: 6 },
      total: 150,
      catalogTotal: 5834,
      errors: ["AWS SavingsPlan: savings plan index returned HTTP 404"],
    },
    ...overrides,
  };
}

// ── fetch stubbing ──────────────────────────────────────────────────

type Responder = (url: string) => { status?: number; body?: unknown; throws?: boolean };

const realFetch = globalThis.fetch;
const requested: string[] = [];

function stubFetch(responder: Responder) {
  requested.length = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    const r = responder(url);
    if (r.throws) throw new Error("network down");
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
    };
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** Each test drives the tiers by stubbing fetch, so a memo from the previous
 *  test would answer before the stub was consulted. */
function reset() {
  resetLLMModelCache();
  resetComputePricingCache();
}

const isSite = (url: string) => url.startsWith(OPTIMTOKEN_BASE_URL);
const isOpenRouter = (url: string) => url.includes("openrouter.ai");

// ── One base URL, env-overridable ───────────────────────────────────

test("every upstream call goes through the one configured base URL", () => {
  assert.match(OPTIMTOKEN_BASE_URL, /^https?:\/\//);
  assert.equal(
    optimtokenUrl("api/llm-models"),
    `${OPTIMTOKEN_BASE_URL}/api/llm-models`,
    "paths must resolve against the constant, not a second hard-coded host",
  );
  assert.equal(
    optimtokenUrl("api/pricing", { region: "europe", unset: undefined }),
    `${OPTIMTOKEN_BASE_URL}/api/pricing?region=europe`,
    "undefined params must be omitted rather than serialised as 'undefined'",
  );
});

// ── LLM: tier ordering ──────────────────────────────────────────────

test("tier 1 — the site serves, and its prices are marked verified", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: siteModelsResponse() } : { throws: true }));

  const result = await fetchLLMModels();

  assert.equal(result.source, "optimtoken");
  assert.equal(result.provenance.tier, 1);
  assert.equal(result.provenance.pricesVerified, true);
  assert.equal(result.provenance.notice, undefined, "tier 1 needs no warning");
  assert.equal(result.provenance.upstreamTimestamp, "2026-08-17T19:43:36.090Z");
  assert.equal(result.provenance.catalogTotal, 257);
  assert.equal(result.provenance.upstreamSchemaVersion, "2.0");
  assert.equal(result.eloAsOf, "2026-08-13", "the site's own ELO vintage wins over the local constant");
  assert.ok(!requested.some(isOpenRouter), "tier 1 succeeded, so tier 2 must not have been called");
});

test("tier 2 — the site is down, OpenRouter serves, and the prices are flagged unverified", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => {
    if (isSite(url)) return { status: 503 };
    if (isOpenRouter(url)) return { body: openRouterPayload() };
    return { throws: true };
  });

  const result = await fetchLLMModels();

  assert.equal(result.source, "openrouter", "the existing direct path is kept as a working second tier");
  assert.equal(result.provenance.tier, 2);
  assert.equal(result.provenance.pricesVerified, false);

  // The whole reason the site is preferred: this is the tier where GPT-5.6 Sol
  // comes back at half of what OpenAI charges.
  assert.match(
    result.provenance.notice ?? "",
    /UNVERIFIED PRICING/,
    "a fallback must not silently downgrade correctness",
  );
  assert.match(result.provenance.notice ?? "", /half/i);
  assert.ok(requested.some(isSite), "the site must be tried before OpenRouter");
});

test("tier 3 — both live sources are down, so the snapshot serves and says it is stale", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(() => ({ throws: true }));

  const result = await fetchLLMModels();

  assert.equal(result.source, "static-fallback");
  assert.equal(result.provenance.tier, 3);
  assert.equal(result.provenance.pricesVerified, false);
  assert.match(result.provenance.notice ?? "", /STALE PRICING/);
  assert.ok(result.provenance.dataAsOf, "the snapshot must date itself");
  assert.ok(result.models.length > 0, "the snapshot is the whole point of tier 3");
});

test("the tiers are tried strictly in order", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => {
    if (isSite(url)) return { status: 500 };
    if (isOpenRouter(url)) return { status: 500 };
    return { throws: true };
  });

  await fetchLLMModels();

  const siteIndex = requested.findIndex(isSite);
  const orIndex = requested.findIndex(isOpenRouter);
  assert.ok(siteIndex > -1 && orIndex > -1, "both live tiers must be attempted");
  assert.ok(siteIndex < orIndex, "the site is tier 1 and must be asked first");
});

// ── LLM: refusing bad payloads ──────────────────────────────────────

test("a malformed site payload falls through instead of being served", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => {
    if (isSite(url)) return { body: { models: "not an array", meta: { source: "openrouter" } } };
    if (isOpenRouter(url)) return { body: openRouterPayload() };
    return { throws: true };
  });

  const result = await fetchLLMModels();
  assert.equal(result.source, "openrouter", "a 200 with a broken body is an upstream failure");
});

test("an empty site payload falls through rather than becoming an empty catalogue", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => {
    if (isSite(url)) return { body: { models: [], meta: { source: "openrouter" } } };
    if (isOpenRouter(url)) return { body: openRouterPayload() };
    return { throws: true };
  });

  const result = await fetchLLMModels();
  assert.equal(result.source, "openrouter");
  assert.ok(result.models.length > 0, "'no models found' must never be the answer to an empty 200");
});

test("a collapsed-but-non-empty site catalogue is refused by the floor", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => {
    if (isSite(url)) return { body: siteModelsResponse({ models: siteModels(5) }) };
    if (isOpenRouter(url)) return { body: openRouterPayload() };
    return { throws: true };
  });

  const result = await fetchLLMModels();
  assert.equal(result.source, "openrouter", "5 models is a broken upstream, not a small catalogue");
});

test("the site serving its own fallback is not treated as authoritative", async (t) => {
  t.after(restoreFetch);
  reset();
  // meta.source === "error" means the site itself fell back to static data, so
  // it carries no fresh corrections and is no better than our own tier 2.
  stubFetch(url => {
    if (isSite(url)) return { body: siteModelsResponse({ meta: { source: "error", total: 120 } }) };
    if (isOpenRouter(url)) return { body: openRouterPayload() };
    return { throws: true };
  });

  const result = await fetchLLMModels();
  assert.equal(result.source, "openrouter");
  assert.equal(result.provenance.pricesVerified, false);
});

// ── The enum that would have broken silently ────────────────────────

test("Llama 4 is a recognised open-weights licence", () => {
  // The site emits "Llama 4" as a licence string distinct from "Llama 3.x".
  // Before it was added, consuming the site's catalogue reported every Llama 4
  // model as unknown-licence — a silent wrong answer to "can I self-host this".
  assert.equal(opennessOf("Llama 4"), "Open weights");
  assert.equal(opennessOf("Llama 3.x"), "Open weights");
  assert.equal(opennessOf("Proprietary"), "Proprietary");
  assert.equal(opennessOf(undefined), "Unknown");
});

// ── Compute ─────────────────────────────────────────────────────────

test("compute tier 1 — the site serves, with per-column provenance intact", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse() } : { throws: true }));

  const result = await fetchComputeInstances("europe");

  assert.equal(result.source, "optimtoken");
  assert.equal(result.provenance.tier, 1);
  assert.equal(result.provenance.upstreamTimestamp, "2026-08-17T20:00:41.353Z");
  assert.equal(result.provenance.catalogTotal, 5834);
  assert.equal(result.provenance.upstreamSchemaVersion, "1.2");
  assert.deepEqual(result.provenance.sources, { AWS: "live", Alibaba: "static" });
  assert.deepEqual(result.provenance.sourceRegions, { AWS: "eu-west-1 (Ireland)" });
  assert.ok(result.provenance.priceTypes?.AWS, "priceTypes must reach the caller verbatim");
  assert.deepEqual(result.provenance.upstreamErrors, [
    "AWS SavingsPlan: savings plan index returned HTTP 404",
  ]);
});

test("a static price column is visible in the response, not swallowed", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse() } : { throws: true }));

  const { provenance } = await fetchComputeInstances("europe");

  // AWS Savings Plans and GCP CUDs are us-east-1 constants scaled by a region
  // multiplier. Returning them beside a live on-demand rate without saying
  // which is which is a FinOps answer nobody can audit.
  assert.ok(
    provenance.staticPriceColumns.includes("AWS.savingsPlan1yr"),
    "a 'static' priceTypes entry must surface in staticPriceColumns",
  );
  assert.ok(provenance.staticPriceColumns.includes("GCP.savingsPlan3yr"));
  assert.ok(
    provenance.unavailablePriceColumns.includes("GCP.reserved1yr"),
    "'unavailable' must be distinguishable from 'static'",
  );
  assert.ok(!provenance.staticPriceColumns.includes("AWS.onDemand"), "live columns must not be flagged");
  assert.match(provenance.notice ?? "", /AWS\.savingsPlan1yr/, "the notice must name the affected columns");
});

test("the region is passed through to the site", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse() } : { throws: true }));

  const result = await fetchComputeInstances("asia-pacific");

  assert.ok(
    requested.some(u => u.includes("region=asia-pacific")),
    "the region filter must reach the API, not be dropped",
  );
  assert.equal(result.provenance.region, "asia-pacific");
});

test("an empty compute payload falls back instead of reporting no instances", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: { instances: [], meta: {} } } : { throws: true }));

  const result = await fetchComputeInstances("us-east");

  assert.equal(result.source, "static-fallback");
  assert.ok(
    result.instances.length > 0,
    "a 200 with an empty body must not become 'no instances found'",
  );
  assert.match(result.provenance.notice ?? "", /STALE PRICING/);
});

test("a malformed compute payload falls back to the snapshot", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: { instances: { nope: true } } } : { throws: true }));

  const result = await fetchComputeInstances("us-east");
  assert.equal(result.source, "static-fallback");
  assert.equal(result.provenance.tier, 2);
});

test("the compute snapshot admits it ignored the region filter", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(() => ({ throws: true }));

  const result = await fetchComputeInstances("europe");

  assert.equal(result.source, "static-fallback");
  // The static array has no region dimension, so honouring "europe" is not
  // something it can do — and quietly pretending otherwise would be worse than
  // the outage.
  assert.match(result.provenance.notice ?? "", /NOT applied/);
  assert.ok(result.provenance.dataAsOf);
});
