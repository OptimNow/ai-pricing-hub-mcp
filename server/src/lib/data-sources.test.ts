import test from "node:test";
import assert from "node:assert/strict";
import { fetchLLMModels, resetLLMModelCache } from "./llm-models.js";
import {
  fetchComputeInstances,
  resetComputePricingCache,
  primeComputePricingCache,
  setComputeTimeoutForTest,
  UPSTREAM_TIMEOUT_MS,
  MEASURED_COLD_REBUILD_MS,
} from "./compute-pricing.js";
import {
  optimtokenUrl,
  OPTIMTOKEN_BASE_URL,
  fetchOptimtokenJson,
  UpstreamFetchError,
} from "./optimtoken-api.js";
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

type Responder = (url: string) => {
  status?: number;
  body?: unknown;
  throws?: boolean;
  /** Hold the response open this long. Combined with the caller's own
   *  AbortSignal this is what makes a real timeout reproducible in a test. */
  delayMs?: number;
  /** Resolve with a body that is not valid JSON. */
  badJson?: boolean;
};

const realFetch = globalThis.fetch;
const requested: string[] = [];

function stubFetch(responder: Responder) {
  requested.length = 0;
  globalThis.fetch = (async (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input);
    requested.push(url);
    const r = responder(url);
    if (r.throws) throw new Error("network down");

    // Honour the caller's abort, the way a real fetch does. Without this the
    // timeout path — the one that broke in production — is untestable, because
    // the stub would always answer before any deadline could pass.
    if (r.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, r.delayMs);
        function onAbort() {
          clearTimeout(timer);
          reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        }
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    }

    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (r.badJson) throw new SyntaxError("Unexpected token < in JSON at position 0");
        return r.body;
      },
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
  setComputeTimeoutForTest(null);
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

// ── The regression: tier 2 while upstream is reachable ──────────────
//
// This is the defect these tests exist for. `/api/pricing` takes ~50.5s to
// rebuild a cold edge entry (measured 2026-08-17: 50.8s / 50.5s / 50.5s)
// against `/api/llm-models`' 209ms, because the site assembles six provider
// APIs inside a `maxDuration: 60` function. The compute budget was 20s — tuned
// for the small endpoint — so a cold entry could not reach tier 1 at all, and
// the tool served the snapshot on every call while reporting only that the
// site "was unreachable". It was reachable. We were not waiting for it.

test("the compute budget covers a cold upstream rebuild", () => {
  // The guard against re-tuning this budget to the LLM endpoint's profile. If
  // someone trims it back under the cold path, tier 1 becomes unreachable again
  // and every response quietly degrades — which is exactly how this shipped.
  assert.ok(
    UPSTREAM_TIMEOUT_MS > MEASURED_COLD_REBUILD_MS,
    `compute budget ${UPSTREAM_TIMEOUT_MS}ms must exceed the measured ${MEASURED_COLD_REBUILD_MS}ms cold rebuild`,
  );
});

test("a slow-but-reachable upstream reaches tier 1 instead of degrading", async (t) => {
  t.after(restoreFetch);
  reset();
  // 400ms upstream, 5s budget — the same ratio as 50.5s upstream against the
  // 55s budget, and the inverse of the 50.5s-against-20s that broke.
  setComputeTimeoutForTest(5_000);
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse(), delayMs: 400 } : { throws: true }));

  const result = await fetchComputeInstances("us-east");

  assert.equal(result.provenance.tier, 1, "upstream answered inside the budget — this must not be a fallback");
  assert.equal(result.source, "optimtoken");
  assert.equal(result.provenance.fallbackReason, undefined, "tier 1 has no fallback to explain");
});

test("an upstream slower than the budget falls back AND says it was a timeout", async (t) => {
  t.after(restoreFetch);
  reset();
  setComputeTimeoutForTest(300);
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse(), delayMs: 5_000 } : { throws: true }));

  const result = await fetchComputeInstances("us-east");

  assert.equal(result.provenance.tier, 2, "the fallback itself is correct behaviour and stays");
  // The part that was missing. "Unreachable" is equally true of a dead host and
  // of a budget that is simply too short, and those need opposite fixes.
  assert.match(
    result.provenance.fallbackReason ?? "",
    /^timeout/,
    "a fallback must name which failure it absorbed, not just that it absorbed one",
  );
  assert.match(result.provenance.fallbackReason ?? "", /300ms budget/, "and the budget it gave up on");
});

test("each failure mode is classified distinctly, not flattened to 'unreachable'", async (t) => {
  t.after(restoreFetch);

  const cases: [string, ReturnType<Responder>, RegExp][] = [
    ["a non-2xx status", { status: 503 }, /^http-status.*status=503/],
    ["a dead host", { throws: true }, /^transport/],
    ["HTML where JSON was promised", { badJson: true }, /^parse/],
    ["valid JSON that is not an object", { body: 42 }, /^not-object/],
    ["a 200 whose catalogue collapsed", { body: { instances: [], meta: {} } }, /^guard/],
  ];

  for (const [name, response, expected] of cases) {
    reset();
    stubFetch(url => (isSite(url) ? response : { throws: true }));
    const result = await fetchComputeInstances("us-east");

    assert.equal(result.provenance.tier, 2, `${name}: still falls back`);
    assert.match(result.provenance.fallbackReason ?? "", expected, `${name}: classified wrongly`);
  }
});

test("a timeout is told apart from a connection failure", async (t) => {
  t.after(restoreFetch);
  reset();
  // Both surface as a rejected fetch; only one means "upstream is alive but
  // slower than we waited", and only that one is fixed by waiting longer.
  stubFetch(() => ({ delayMs: 5_000 }));
  await assert.rejects(
    () => fetchOptimtokenJson("api/pricing", { timeoutMs: 200 }),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamFetchError);
      assert.equal(error.kind, "timeout");
      assert.ok(error.elapsedMs >= 150, "a timeout must report how long it actually waited");
      return true;
    },
  );

  reset();
  stubFetch(() => ({ throws: true }));
  await assert.rejects(
    () => fetchOptimtokenJson("api/pricing", { timeoutMs: 5_000 }),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamFetchError);
      assert.equal(error.kind, "transport", "a reset connection is not a timeout");
      return true;
    },
  );
});

// ── Tier 2 filters it cannot honour ─────────────────────────────────

test("tier 2 names the filters it accepted but could not apply", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(() => ({ throws: true }));

  const { provenance } = await fetchComputeInstances("asia-pacific");

  // A consumer reading `instances` sees a well-formed array and no sign that
  // the region it asked for was dropped on the floor. The prose notice does say
  // so, but a narrow query returning `[]` is exactly the case where nobody
  // reads the prose.
  assert.deepEqual(provenance.unappliedFilters, ["region"]);
  assert.equal(provenance.catalogueIsSubset, true, "137 rows against ~5,800 is a subset, and must say so");
  assert.equal(provenance.region, "asia-pacific", "what was asked for is still reported");
});

test("tier 1 claims no unapplied filters", async (t) => {
  t.after(restoreFetch);
  reset();
  stubFetch(url => (isSite(url) ? { body: sitePricingResponse() } : { throws: true }));

  const { provenance } = await fetchComputeInstances("europe");

  assert.equal(provenance.unappliedFilters, undefined);
  assert.equal(provenance.catalogueIsSubset, undefined);
});

// ── Serving stale beats making someone wait 50s ──────────────────────

test("a stale memo answers immediately and refreshes behind the caller", async (t) => {
  t.after(restoreFetch);
  reset();

  const stale = {
    instances: [{ provider: "AWS" as const, instanceType: "m7i.large", os: "Linux" as const, vCPUs: 2, memory: 8,
      onDemandHourly: 0.1, onDemandMonthly: 73, spot: null, savingsPlan1yr: null,
      savingsPlan3yr: null, reserved1yr: null, reserved3yr: null }],
    source: "optimtoken" as const,
    provenance: {
      tier: 1 as const, source: "optimtoken" as const, label: "stale entry", region: "us-east" as const,
      staticPriceColumns: [], unavailablePriceColumns: [],
    },
  };
  // Older than the 60-minute TTL, well inside the 12-hour stale window.
  primeComputePricingCache("us-east", stale, Date.now() - 2 * 60 * 60 * 1000);

  let refreshStarted = false;
  stubFetch(url => {
    if (isSite(url)) { refreshStarted = true; return { body: sitePricingResponse(), delayMs: 50 }; }
    return { throws: true };
  });

  const result = await fetchComputeInstances("us-east");

  // An hour-old compute list price is almost certainly still right — these move
  // on a scale of weeks — and is unambiguously better than a snapshot from a
  // different month. Making the caller wait 50s for the refresh is the worse
  // trade, so the refresh happens behind them.
  assert.equal(result.provenance.tier, 1);
  assert.equal(result.provenance.label, "stale entry", "the memo answered, not a fresh fetch");
  assert.ok(
    (result.provenance.servedFromCacheAgeMs ?? 0) > 60 * 60 * 1000,
    "serving a stale entry must be visible in provenance, not silent",
  );
  assert.ok(refreshStarted, "a stale read must trigger the background refresh");
});
