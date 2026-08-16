import test from "node:test";
import assert from "node:assert/strict";

import {
  MONTHLY_DECIMALS,
  PER_REQUEST_DECIMALS,
  USE_CASE_PROFILES,
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
