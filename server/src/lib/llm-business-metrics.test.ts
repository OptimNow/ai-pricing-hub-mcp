import test from "node:test";
import assert from "node:assert/strict";
import { llmModels } from "../data/pricing-data.js";
import type { LLMModel } from "../data/pricing-data.js";

import {
  CACHE_READS_PER_WRITE,
  DEFAULT_LLM_SORT,
  LLM_SORT_KEYS,
  MONTHLY_DECIMALS,
  PER_REQUEST_DECIMALS,
  USE_CASE_PROFILES,
  computeScoreComponents,
  describeSort,
  enrichModels,
  sortEnrichedModels,
  formatMonthlyBudget,
  optimizationLevers,
  optimizedUseCaseCost,
  roundCost,
  roundMonthlyCost,
  roundPerRequestCost,
  roundPricePer1M,
  roundPricePer1MOrNull,
  useCaseCost,
} from "./llm-business-metrics.js";

/** How a value will actually look once it is JSON — the only thing that matters
 *  here, since the tools instruct the caller to print figures verbatim. */
const decimalsInJson = (n: number): number => (JSON.stringify(n).split(".")[1] ?? "").length;

// ── The reported defect ──────────────────────────────────────────────

test("the two reported cases serialise cleanly", () => {
  // GPT-5.5 Pro at $30 in / $180 out, 3000 + 2000 tokens.
  const proRaw = useCaseCost(30, 180, {
    label: "Custom", shortLabel: "Custom", inputTokens: 3000, outputTokens: 2000,
    cacheHitRate: 0, batchEligible: false,
  });
  assert.equal(proRaw, 0.44999999999999996, "guard: the raw float is still the ugly one");
  assert.equal(roundPerRequestCost(proRaw), 0.45);
  assert.equal(roundMonthlyCost(proRaw * 100_000), 45000);

  // Gemini 3.5 Flash at $1.5 in / $9 out.
  const flashRaw = useCaseCost(1.5, 9, {
    label: "Custom", shortLabel: "Custom", inputTokens: 3000, outputTokens: 2000,
    cacheHitRate: 0, batchEligible: false,
  });
  assert.equal(roundPerRequestCost(flashRaw), 0.0225);
  assert.equal(roundMonthlyCost(flashRaw * 100_000), 2250);
});

// ── The rounding contract ────────────────────────────────────────────

test("rounding never exceeds its declared precision", () => {
  const awkward = [0.44999999999999996, 0.022500000000000003, 1 / 3, 2 / 3, 0.1 + 0.2];
  for (const n of awkward) {
    assert.ok(decimalsInJson(roundPerRequestCost(n)) <= PER_REQUEST_DECIMALS, `${n} per-request`);
    assert.ok(decimalsInJson(roundMonthlyCost(n)) <= MONTHLY_DECIMALS, `${n} monthly`);
  }
});

test("rounding is idempotent", () => {
  for (const n of [0.44999999999999996, 1 / 3, 1234.5678, 0.0000004]) {
    assert.equal(roundPerRequestCost(roundPerRequestCost(n)), roundPerRequestCost(n));
    assert.equal(roundMonthlyCost(roundMonthlyCost(n)), roundMonthlyCost(n));
  }
});

test("zero, negatives and non-finite values survive", () => {
  assert.equal(roundPerRequestCost(0), 0);
  assert.equal(roundMonthlyCost(0), 0);
  // Free models are a real catalogue entry, and must not become NaN or -0.
  assert.ok(Object.is(roundPerRequestCost(0), 0), "no negative zero");
  assert.equal(roundPerRequestCost(-0.44999999999999996), -0.45);
  // Non-finite is passed through rather than turned into a bogus number:
  // toFixed would throw the shape away and 0 would read as "free".
  assert.equal(roundCost(Number.POSITIVE_INFINITY, 6), Number.POSITIVE_INFINITY);
  assert.ok(Number.isNaN(roundCost(Number.NaN, 6)));
});

test("large monthly budgets do not fall back to exponent notation", () => {
  // 1M requests on an expensive model is an ordinary query, and "4.5e+7" in a
  // budget column would be worse than the noise this replaced.
  const big = roundMonthlyCost(45 * 1_000_000);
  assert.equal(JSON.stringify(big), "45000000");
  assert.ok(!JSON.stringify(big).includes("e"));
});

test("the 6-decimal floor clears the cheapest real workload", () => {
  // Cheapest catalogue entries sit near $0.01/1M; the smallest preset is
  // 1500 in + 500 out. Nothing in range may collapse to a misleading zero.
  const cheapest = useCaseCost(0.01, 0.02, USE_CASE_PROFILES.supportTicket);
  assert.ok(cheapest > 0);
  assert.ok(roundPerRequestCost(cheapest) > 0, "a priced model must not round to free");
});

// ── The design decision this must not undo ───────────────────────────

test("the cost functions themselves stay unrounded", () => {
  // Ranking and percentiles consume these raw. Rounding inside them would
  // manufacture ties, which is why the rounding lives at serialisation.
  const raw = useCaseCost(30, 180, {
    label: "x", shortLabel: "x", inputTokens: 3000, outputTokens: 2000,
    cacheHitRate: 0, batchEligible: false,
  });
  assert.notEqual(raw, 0.45, "useCaseCost() must return the raw float");

  const model = {
    provider: "T", model: "T", inputPricePer1M: 30, outputPricePer1M: 180,
    contextWindow: "1M", category: "Frontier", capabilities: [],
  } as unknown as Parameters<typeof optimizedUseCaseCost>[0];
  const rawOpt = optimizedUseCaseCost(model, {
    label: "x", shortLabel: "x", inputTokens: 3000, outputTokens: 2000,
    cacheHitRate: 0, batchEligible: false,
  });
  assert.notEqual(rawOpt, 0.45, "optimizedUseCaseCost() must return the raw float");
});

// ── Derived prices ───────────────────────────────────────────────────

test("per-1M price rounding handles the blended-price noise", () => {
  // blendedPrice() mixes 30/70 and is noisy for ~40% of the catalogue:
  // $2 in / $12 out lands on 8.999999999999998.
  assert.equal(roundPricePer1M(2 * 0.3 + 12 * 0.7), 9);
  assert.equal(roundPricePer1M(0.32 * 0.3 + 1.28 * 0.7), 0.992);
});

test("the nullable price variant keeps null distinct from zero", () => {
  // The badge summary reports null when nothing qualifies; turning that into
  // 0 would read as "qualifies at $0/1M".
  assert.equal(roundPricePer1MOrNull(null), null);
  assert.equal(roundPricePer1MOrNull(8.999999999999998), 9);
});

// ── A lever that costs money is not an optimization ──────────────────
//
// Zhipu GLM 5.2 publishes batch rates ABOVE its list rates ($0.70/$2.20 against
// $0.49/$1.54). The original formula applied batch whenever both fields were
// present, so "optimized" came out 34% dearer than list — and because
// savingsPct() clamps at 0, the output reported "Same as list price" next to a
// visibly larger number and a longer bar.
//
// The site has closed this twice since: its PR #60 drops any batch row above
// list at the source, and its formula now clamps the result at list. This
// server keeps its own, stricter rule (batch only when its branch is the
// cheaper one), so no real catalogue row triggers the guard any more. That is
// exactly why the model below is synthetic: it keeps the guard tested once the
// data stops exercising it. See "Keeping in sync" in docs/DESIGN.md.

test("a published batch rate that costs more is not applied", () => {
  const dearBatch: LLMModel = {
    provider: "Test", model: "Dear Batch", inputPricePer1M: 0.49, outputPricePer1M: 1.54,
    batchInputPricePer1M: 0.70, batchOutputPricePer1M: 2.20,
    contextWindow: "128K", category: "Budget", capabilities: ["Text"],
  };
  const profile = USE_CASE_PROFILES.meetingSummary;
  assert.equal(profile.batchEligible, true, "sanity: this profile is batch-eligible");

  const levers = optimizationLevers(dearBatch, profile);
  assert.equal(levers.batchEligible, true, "the workload is still batch-eligible");
  assert.equal(levers.batchApplied, false, "but the lever must not be reported as applied");

  const list = useCaseCost(dearBatch.inputPricePer1M, dearBatch.outputPricePer1M, profile);
  assert.ok(
    optimizedUseCaseCost(dearBatch, profile) <= list,
    "optimized must never exceed list — it is the best achievable price, not a different one",
  );
});

test("a cache rate above the input price is not applied either", () => {
  const dearCache: LLMModel = {
    provider: "Test", model: "Dear Cache", inputPricePer1M: 1.0, outputPricePer1M: 2.0,
    cachedInputPricePer1M: 1.5,
    contextWindow: "128K", category: "Budget", capabilities: ["Text"],
  };
  const profile = USE_CASE_PROFILES.supportTicket;
  assert.ok(profile.cacheHitRate > 0, "sanity: this profile has a cacheable prefix");

  assert.equal(optimizationLevers(dearCache, profile).cacheApplied, false);
  assert.equal(
    optimizedUseCaseCost(dearCache, profile),
    useCaseCost(dearCache.inputPricePer1M, dearCache.outputPricePer1M, profile),
    "with no lever pulled, optimized is exactly the list cost — not a few ULPs above it",
  );
});

test("optimized never exceeds list anywhere in the catalogue", () => {
  // The guard against this class returning: 3 (model, workload) pairs were
  // materially inverted and 35 more by float noise before the fix.
  for (const m of llmModels) {
    for (const profile of Object.values(USE_CASE_PROFILES)) {
      const list = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
      assert.ok(
        optimizedUseCaseCost(m, profile) <= list,
        `${m.provider} ${m.model} / ${profile.label}: optimized exceeds list`,
      );
    }
  }
});

test("a lever is only reported applied when it actually saved money", () => {
  for (const m of llmModels) {
    for (const profile of Object.values(USE_CASE_PROFILES)) {
      const { batchApplied, cacheApplied } = optimizationLevers(m, profile);
      if (!batchApplied && !cacheApplied) continue;
      const list = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
      assert.ok(
        optimizedUseCaseCost(m, profile) < list,
        `${m.provider} ${m.model} / ${profile.label}: names a lever but saved nothing`,
      );
    }
  }
});

// ── The cache write, and the clamps that came with it ────────────────
//
// Ported from the site on 2026-11-11. Until then this server credited every
// cache read without charging the write that made it possible, and the two
// apps disagreed on 307 of 2,512 (model, workload) pairs.

const model = (over: Partial<LLMModel>): LLMModel => ({
  provider: "Test", model: "Model", inputPricePer1M: 4, outputPricePer1M: 20,
  contextWindow: "1M", category: "Frontier", capabilities: ["Text"],
  ...over,
});

const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${what}: got ${actual}, expected ${expected}`);

test("a published cache-write rate is charged, amortised over the reads it buys", () => {
  // The Claude Opus 5.5 row of 2026-11-11: $4 in, $20 out, read $0.20, write $5.
  const opus = model({ cachedInputPricePer1M: 0.2, cacheWritePricePer1M: 5 });
  const profile = USE_CASE_PROFILES.supportTicket; // 1500 in, 500 out, h = 0.6

  // effectiveIn = 0.6 x 0.2 + 0.4 x 4 + min(0.6/5, 0.4) x (5 - 4) = 1.84
  assert.equal(CACHE_READS_PER_WRITE, 5, "the worked figures below assume the site's constant");
  near(optimizedUseCaseCost(opus, profile), (1500 / 1e6) * 1.84 + (500 / 1e6) * 20, "with the write");

  // The same model with no write rate is the read-only figure, 1.4% lower.
  const readOnly = model({ cachedInputPricePer1M: 0.2 });
  near(optimizedUseCaseCost(readOnly, profile), (1500 / 1e6) * 1.72 + (500 / 1e6) * 20, "read only");
  assert.ok(optimizedUseCaseCost(opus, profile) > optimizedUseCaseCost(readOnly, profile));
});

test("the written share never exceeds the cache misses", () => {
  // h = 0.9 leaves 10% misses; h/5 = 18% of the tokens cannot all be written.
  const profile = { ...USE_CASE_PROFILES.supportTicket, cacheHitRate: 0.9 };
  const m = model({ cachedInputPricePer1M: 0.2, cacheWritePricePer1M: 5 });
  // effectiveIn = 0.9 x 0.2 + 0.1 x 4 + 0.1 x (5 - 4) = 0.68
  near(optimizedUseCaseCost(m, profile), (1500 / 1e6) * 0.68 + (500 / 1e6) * 20, "capped written share");
});

test("a write rate with no read rate changes nothing", () => {
  // No published read rate means no caching in the estimate, hence no write.
  const m = model({ cacheWritePricePer1M: 5 });
  const profile = USE_CASE_PROFILES.agentWorkflow;
  assert.equal(optimizedUseCaseCost(m, profile), useCaseCost(4, 20, profile));
  assert.equal(optimizationLevers(m, profile).cacheApplied, false);
});

test("a write rate at or below the input rate is no premium", () => {
  const profile = USE_CASE_PROFILES.supportTicket;
  const withWrite = model({ cachedInputPricePer1M: 0.2, cacheWritePricePer1M: 4 });
  const without = model({ cachedInputPricePer1M: 0.2 });
  assert.equal(optimizedUseCaseCost(withWrite, profile), optimizedUseCaseCost(without, profile));
});

test("caching that stops paying once the write is charged is not applied", () => {
  // Read barely under input, write far above it: the premium eats the saving.
  const m = model({ inputPricePer1M: 1, outputPricePer1M: 2, cachedInputPricePer1M: 0.95, cacheWritePricePer1M: 3 });
  const profile = USE_CASE_PROFILES.supportTicket;
  assert.equal(optimizationLevers(m, profile).cacheApplied, false, "the lever must not be named");
  assert.equal(optimizedUseCaseCost(m, profile), useCaseCost(1, 2, profile), "and the cost is list, exactly");
});

test("under batch, a cache read dearer than the batch input rate is left out", () => {
  // The gpt-oss-120b row of 2026-11-11. Its cache read ($0.075) is cheaper than
  // list input ($0.15) but dearer than batch input ($0.0296). Blending it in
  // under batch RAISED the cost 16% and named "caching + batch API" as the
  // saving.
  const oss = model({
    inputPricePer1M: 0.15, outputPricePer1M: 0.6,
    batchInputPricePer1M: 0.0296, batchOutputPricePer1M: 0.136,
    cachedInputPricePer1M: 0.075,
  });
  const profile = USE_CASE_PROFILES.invoiceProcessing; // batch-eligible, h = 0.3
  near(optimizedUseCaseCost(oss, profile), (1500 / 1e6) * 0.0296 + (600 / 1e6) * 0.136, "batch only");

  const levers = optimizationLevers(oss, profile);
  assert.equal(levers.batchApplied, true);
  assert.equal(levers.cacheApplied, false, "caching did not pay on the branch chosen");

  // Off batch, the same read rate does pay and is applied.
  assert.equal(optimizationLevers(oss, USE_CASE_PROFILES.supportTicket).cacheApplied, true);
});

// ── Ranking ──────────────────────────────────────────────────────────

const ranked = (name: string, elo: number, input: number, output: number, over: Partial<LLMModel> = {}): LLMModel =>
  model({ model: name, eloScore: elo, inputPricePer1M: input, outputPricePer1M: output, category: "Mid-tier", releaseDate: "2025-01", ...over });

test("models tied on price or on ELO share a rank, whatever the catalogue order", () => {
  const a = ranked("A", 1500, 3, 15);
  const twin1 = ranked("Twin 1", 1450, 2, 10);
  const twin2 = ranked("Twin 2", 1450, 2, 10);
  const d = ranked("D", 1400, 1, 5);
  const e = ranked("E", 1300, 0.5, 2);

  const forward = computeScoreComponents([a, twin1, twin2, d, e]);
  const reversed = computeScoreComponents([e, d, twin2, twin1, a]);

  assert.deepEqual(forward[1], forward[2], "the twins score alike");
  assert.deepEqual(forward[1], reversed[2], "and the same in the other order");
  // Competition ranking: one model is strictly better on ELO, so 3 of 4 = 75.
  assert.equal(forward[1].eloPercentile, 75);
  // Two models are strictly cheaper, so 2 of 4 = 50.
  assert.equal(forward[1].pricePercentile, 50);
  // An untied model is where it always was.
  assert.equal(forward[0].eloPercentile, 100);
  assert.equal(forward[4].pricePercentile, 100);
});

test("a model with no published price is not ranked as the cheapest", () => {
  const free = ranked("Free", 1450, 0, 0);
  const cheap = ranked("Cheap", 1400, 0.1, 0.4);
  const dear = ranked("Dear", 1500, 3, 15);
  const [f, c] = computeScoreComponents([free, cheap, dear]);
  assert.equal(f.score, null, "a $0 row is unpriced, not cheap");
  assert.equal(c.pricePercentile, 100, "and the cheapest priced model keeps the top price rank");
});

test("an outlier listing is refused the badge and stays in the ranking", () => {
  // Enough models that the percentile gates have room, with the candidate
  // placed to clear all of them on its own figures.
  const field = Array.from({ length: 9 }, (_, i) => ranked(`Field ${i}`, 1300 + i * 10, 1 + i, 4 + i * 4));
  const candidate = ranked("Candidate", 1480, 0.07, 1.4);

  const clean = enrichModels([...field, candidate], "100k", "supportTicket");
  const flagged = enrichModels([...field, { ...candidate, outlierListing: true }], "100k", "supportTicket");

  assert.equal(clean[9].isFinOpsFriendly, true, "sanity: it earns the badge on an ordinary listing");
  assert.equal(flagged[9].isFinOpsFriendly, false, "and loses it as an outlier listing");
  assert.equal(flagged[9].efficiencyScore, clean[9].efficiencyScore, "its own score is unchanged");
  assert.deepEqual(
    flagged.slice(0, 9).map(m => m.efficiencyScore),
    clean.slice(0, 9).map(m => m.efficiencyScore),
    "and so is every other model's: the listing is labelled, not removed",
  );
});

// ── Ordering ─────────────────────────────────────────────────────────
//
// compare-llm-models returned the catalogue in arrival order (Arena ELO
// descending) and nothing else until 0.6.0, so "the ten cheapest for a coding
// task" could only be answered by fetching 50 rows and sorting them by hand.

const names = (models: { model: string }[]): string[] => models.map(m => m.model);
const enrich = (models: LLMModel[], useCase: Parameters<typeof enrichModels>[2] = "supportTicket") =>
  enrichModels(models, "100k", useCase);

test("the default order is Arena ELO, and returns the catalogue as it arrived", () => {
  // The order fetchLLMModels hands over: ranked models by ELO, unranked after.
  const arrived = enrich([
    ranked("Top", 1500, 3, 15),
    ranked("Middle", 1400, 1, 5),
    ranked("Low", 1300, 0.5, 2),
    model({ model: "Unranked new", releaseDate: "2026-10" }),
    model({ model: "Unranked old", releaseDate: "2024-01" }),
  ]);

  assert.equal(DEFAULT_LLM_SORT, "elo");
  const sorted = sortEnrichedModels(arrived);
  assert.deepEqual(names(sorted), names(arrived), "nothing moved");
  assert.notEqual(sorted, arrived, "and the caller's array is not the one returned");

  // Handed the same rows out of order, it still puts them in ELO order.
  const shuffled = [arrived[3], arrived[2], arrived[0], arrived[4], arrived[1]];
  assert.deepEqual(names(sortEnrichedModels(shuffled, "elo")), ["Top", "Middle", "Low", "Unranked new", "Unranked old"]);
  assert.deepEqual(names(shuffled), ["Unranked new", "Low", "Top", "Unranked old", "Middle"], "input left as it was");
});

test("the cost orders follow the workload, the price orders follow one side", () => {
  // Cheap to read and dear to write, against the reverse.
  const reader = ranked("Reader", 1400, 1, 20);
  const writer = ranked("Writer", 1400, 4, 5);

  // supportTicket is 1.5k in / 500 out: output weighs enough for Writer to win.
  assert.deepEqual(names(sortEnrichedModels(enrich([reader, writer], "supportTicket"), "cost")), ["Writer", "Reader"]);
  // meetingSummary is 10k in / 1.2k out: the input price decides, and Reader wins.
  assert.deepEqual(names(sortEnrichedModels(enrich([reader, writer], "meetingSummary"), "cost")), ["Reader", "Writer"]);

  const table = enrich([writer, reader]);
  assert.deepEqual(names(sortEnrichedModels(table, "inputPrice")), ["Reader", "Writer"]);
  assert.deepEqual(names(sortEnrichedModels(table, "outputPrice")), ["Writer", "Reader"]);
});

test("optimized cost is its own order, not list cost again", () => {
  // Dearer at list, cheaper once its cache-read rate is counted.
  const cached = ranked("Cached", 1400, 3, 15, { cachedInputPricePer1M: 0.3 });
  const plain = ranked("Plain", 1400, 2.8, 15);
  const table = enrich([cached, plain]);

  assert.ok(table[0].useCaseCost > table[1].useCaseCost, "sanity: Cached is dearer at list");
  assert.ok(table[0].optimizedUseCaseCost < table[1].optimizedUseCaseCost, "sanity: and cheaper optimized");
  assert.deepEqual(names(sortEnrichedModels(table, "cost")), ["Plain", "Cached"]);
  assert.deepEqual(names(sortEnrichedModels(table, "optimizedCost")), ["Cached", "Plain"]);
});

test("efficiency puts the best value first and unscored models last", () => {
  const table = enrich([
    ranked("Dear and best", 1500, 30, 150),
    ranked("Strong and cheap", 1480, 0.2, 0.8),
    ranked("Weak and dear", 1300, 20, 100),
    model({ model: "Unranked" }),
  ]);
  const sorted = sortEnrichedModels(table, "efficiency");

  assert.equal(sorted[0].model, "Strong and cheap");
  assert.equal(sorted.at(-1)!.model, "Unranked", "no ELO means no score, so no place in the ranking");
  const scores = sorted.slice(0, -1).map(m => m.efficiencyScore!);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "scores descend");
});

test("a missing figure sorts last, and a zero price is missing, not cheapest", () => {
  const table = enrich([
    ranked("Free input", 1450, 0, 4),
    ranked("Cheap", 1400, 0.1, 0.4),
    ranked("Dear", 1500, 3, 15),
  ]);

  // The rule computeScoreComponents applies: an unpriced side is not a bargain.
  assert.deepEqual(names(sortEnrichedModels(table, "inputPrice")), ["Cheap", "Dear", "Free input"]);
  // Its output side is priced, and is ranked like any other.
  assert.deepEqual(names(sortEnrichedModels(table, "outputPrice")), ["Cheap", "Free input", "Dear"]);
});

test("ties keep the order they came in", () => {
  const first = ranked("First", 1500, 2, 10);
  const second = ranked("Second", 1450, 2, 10);
  const cheaper = ranked("Cheaper", 1300, 1, 5);

  // Same prices, so the same cost: the better-ranked one stays ahead.
  assert.deepEqual(names(sortEnrichedModels(enrich([first, second, cheaper]), "cost")), ["Cheaper", "First", "Second"]);
  assert.deepEqual(names(sortEnrichedModels(enrich([second, first, cheaper]), "outputPrice")), ["Cheaper", "Second", "First"]);
});

test("every order holds across the whole snapshot and loses no model", () => {
  const table = enrich(llmModels);
  const figure: Record<(typeof LLM_SORT_KEYS)[number], (m: (typeof table)[number]) => number | null> = {
    elo: m => m.eloScore || null,
    efficiency: m => m.efficiencyScore,
    cost: m => (m.useCaseCost > 0 ? m.useCaseCost : null),
    optimizedCost: m => (m.optimizedUseCaseCost > 0 ? m.optimizedUseCaseCost : null),
    inputPrice: m => (m.inputPricePer1M > 0 ? m.inputPricePer1M : null),
    outputPrice: m => (m.outputPricePer1M > 0 ? m.outputPricePer1M : null),
  };

  for (const key of LLM_SORT_KEYS) {
    const sorted = sortEnrichedModels(table, key);
    assert.equal(sorted.length, table.length, `${key}: same number of rows`);
    assert.equal(new Set(sorted).size, table.length, `${key}: each row once`);

    const values = sorted.map(figure[key]);
    const firstMissing = values.indexOf(null);
    const present = (firstMissing === -1 ? values : values.slice(0, firstMissing)) as number[];
    assert.ok(present.length > 0, `${key}: sanity, the snapshot has rows carrying this figure`);
    assert.ok(
      values.slice(present.length).every(v => v === null),
      `${key}: every row missing the figure is after every row that has it`,
    );
    const descending = key === "elo" || key === "efficiency";
    for (let i = 1; i < present.length; i++) {
      assert.ok(
        descending ? present[i - 1] >= present[i] : present[i - 1] <= present[i],
        `${key}: row ${i} is out of order (${present[i - 1]} then ${present[i]})`,
      );
    }
  }
});

test("each order can be named in a sentence, and the cost ones name the workload", () => {
  for (const key of LLM_SORT_KEYS) {
    const text = describeSort(key, "Coding task");
    assert.ok(text.length > 0, `${key} has no description`);
    assert.match(text, /first/, `${key}: the direction is stated`);
  }
  assert.match(describeSort("cost", "Coding task"), /^Coding task cost per request at list price/);
  assert.match(describeSort("optimizedCost", "Coding task"), /^Coding task optimized cost/);
});

// ── Budget formatting ────────────────────────────────────────────────

test("a budget is given the unit it rounds into", () => {
  // Chosen on the value alone, these printed "$1000" and "$1000.0K".
  assert.equal(formatMonthlyBudget(999.9999), "$1.0K");
  assert.equal(formatMonthlyBudget(999_999), "$1.0M");
  assert.equal(formatMonthlyBudget(0.009999), "$0.01");
  // Away from a boundary nothing moved.
  assert.equal(formatMonthlyBudget(450), "$450");
  assert.equal(formatMonthlyBudget(1234.5), "$1.2K");
  assert.equal(formatMonthlyBudget(0.0042), "$0.0042");
});
