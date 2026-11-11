import test from "node:test";
import assert from "node:assert/strict";

import {
  MAKER_ROW_NOT_STANDARD_RATE,
  NOTEWORTHY_SPREAD,
  SAME_RATE_TOLERANCE,
  blendPair,
  coerceHostOffer,
  coerceHostPricing,
  declaredBuilds,
  describeOffer,
  describeVsQuoted,
  hasNoteworthySpread,
  hostFootnote,
  makerOffer,
  matchesOffer,
  priceProvenance,
  provenanceExplanation,
  sameRate,
  standardRateOf,
  vsQuotedPct,
} from "./host-prices.js";
import type { HostPriceSummary } from "./host-prices.js";

/**
 * Every other tool quotes one price per model. It is one host's rate, and for
 * 145 of 311 models on 2026-11-11 at least one other host published another.
 * The ported rules here are held to the site's by `npm run check-parity`;
 * these tests hold what arrives over HTTP and what the text says about it.
 */

/** As the site served it for Xiaomi MiMo-V2.6-Pro on 2026-11-11. */
const mimo = {
  hosts: 5,
  cheapest: { host: "GMICloud", input: 0.3263, output: 0.6525, quantization: "bf16", discount: 0.25 },
  dearest: { host: "PrimaLabs", input: 4, output: 8, quantization: "fp8" },
  vendor: { host: "Xiaomi", input: 0.435, output: 0.87, quantization: "fp8" },
  spread: 12.2602,
  outlierBasis: { medianInput: 0.435, medianRatio: 2 },
  promotions: [
    { host: "GMICloud", input: 0.3263, output: 0.6525, quantization: "bf16", discount: 0.25 },
    { host: "DeepInfra", input: 0.387, output: 0.783, quantization: "fp8", discount: 0.1 },
  ],
};

const summary = (over: Partial<HostPriceSummary> = {}): HostPriceSummary => ({
  hosts: 3,
  cheapest: { host: "Cheap", input: 1, output: 2 },
  dearest: { host: "Dear", input: 2, output: 4 },
  spread: 2,
  ...over,
});

// ── What arrives over HTTP ───────────────────────────────────────────

test("a host summary survives the trip from the site unchanged", () => {
  assert.deepEqual(coerceHostPricing(mimo), mimo);
});

test("a summary that cannot be trusted whole is unknown, not half-served", () => {
  for (const bad of [
    undefined,
    null,
    "5 hosts",
    {},
    { ...mimo, hosts: 0 },
    { ...mimo, hosts: 2.5 },
    { ...mimo, hosts: "5" },
    { ...mimo, cheapest: undefined },
    { ...mimo, dearest: { host: "PrimaLabs", input: "4", output: 8 } },
    { ...mimo, cheapest: { host: "", input: 1, output: 2 } },
    { ...mimo, cheapest: { host: "X", input: -1, output: 2 } },
    { ...mimo, dearest: { host: "X", input: Number.NaN, output: 2 } },
  ]) {
    assert.equal(coerceHostPricing(bad), undefined, JSON.stringify(bad));
  }
});

test("the optional parts are dropped one by one when malformed", () => {
  const coerced = coerceHostPricing({
    ...mimo,
    vendor: { host: "Xiaomi" },
    spread: -3,
    outlierBasis: { medianInput: "0.4" },
    promotions: [{ host: "DeepInfra", input: 0.387, output: 0.783, discount: 0.1 }, { host: "Broken" }, "nope"],
  });
  assert.ok(coerced);
  assert.equal(coerced.vendor, undefined);
  assert.equal(coerced.spread, undefined);
  assert.equal(coerced.outlierBasis, undefined);
  assert.deepEqual(coerced.promotions, [{ host: "DeepInfra", input: 0.387, output: 0.783, discount: 0.1 }]);
  assert.equal(coerceHostPricing({ ...mimo, promotions: [{ host: "Broken" }] })?.promotions, undefined, "no usable promotion is no promotion");
});

test("a free listing is an offer, and a discount must be a share", () => {
  assert.deepEqual(coerceHostOffer({ host: "Free", input: 0, output: 0 }), { host: "Free", input: 0, output: 0 });
  for (const discount of [0, 1, 1.5, -0.2, "0.25", Number.NaN]) {
    assert.equal(coerceHostOffer({ host: "H", input: 1, output: 2, discount })?.discount, undefined, String(discount));
  }
  assert.equal(coerceHostOffer({ host: "H", input: 1, output: 2, quantization: "" })?.quantization, undefined);
});

// ── Whose price the quoted one is ────────────────────────────────────

test("the quoted price is classified against the hosts", () => {
  const s = coerceHostPricing(mimo)!;
  assert.equal(priceProvenance({ input: 0.435, output: 0.87 }, s), "vendor");
  assert.equal(priceProvenance({ input: 0.3263, output: 0.6525 }, s), "reference", "the cheapest host's rate");
  assert.equal(priceProvenance({ input: 4, output: 8 }, s), "reference", "the dearest host's rate");
  assert.equal(priceProvenance({ input: 1, output: 2 }, s), "reference", "inside the range: a host the summary does not name");
  assert.equal(priceProvenance({ input: 0.1, output: 0.2 }, s), "adjusted", "below every host");
  assert.equal(priceProvenance({ input: 9, output: 18 }, s), "adjusted", "above every host");
  assert.equal(priceProvenance({ input: 0.435, output: 0.87 }, undefined), "unknown");
});

test("two figures within 2% are one rate, and a non-number never is", () => {
  assert.equal(SAME_RATE_TOLERANCE, 0.02);
  assert.equal(sameRate(0.0795, 0.0799), true, "a 0.5% gap is rounding");
  assert.equal(sameRate(1, 1.05), false);
  assert.equal(sameRate(0, 0), true);
  assert.equal(sameRate(Number.NaN, 1), false);
  assert.equal(sameRate(1, Number.POSITIVE_INFINITY), false);
  assert.equal(matchesOffer({ input: 4, output: 20 }, { input: 4, output: 20.3 }), true);
  assert.equal(matchesOffer({ input: 4, output: 20 }, { input: 4, output: 22 }), false, "both sides must match");
  assert.equal(matchesOffer({ input: 4, output: 20 }, undefined), false);
});

test("each classification has its sentence, and only the maker's names a host", () => {
  const s = coerceHostPricing(mimo)!;
  assert.equal(provenanceExplanation("vendor", s), "This is the model maker's own published rate (Xiaomi).");
  assert.match(provenanceExplanation("reference", s), /^This is not the model maker's own rate/);
  assert.match(provenanceExplanation("adjusted", s), /matches none of the rates/);
  assert.equal(provenanceExplanation("unknown", undefined), "No per-host pricing is known for this model yet.");
});

// ── The maker's row ──────────────────────────────────────────────────

test("the maker's row is quoted, unless it is a discount tier under the maker's name", () => {
  const s = coerceHostPricing(mimo)!;
  const quoted = { input: 0.435, output: 0.87 };
  assert.deepEqual(makerOffer({ summary: s, openRouterId: "xiaomi/mimo-v2.6-pro" }, quoted), { offer: s.vendor, notStandardRate: false });
  assert.deepEqual(makerOffer({ summary: s }, quoted), { offer: s.vendor, notStandardRate: false }, "no id: nothing known against it");
  assert.deepEqual(makerOffer({ summary: summary() }, quoted), { offer: null, notStandardRate: false }, "no maker row at all");
  assert.deepEqual(makerOffer(undefined, quoted), { offer: null, notStandardRate: false });
});

test("the maker-row exception bites only while that row differs from the quoted price", () => {
  assert.ok(MAKER_ROW_NOT_STANDARD_RATE.has("openai/gpt-5.6-sol"));
  const sol = (vendor: { input: number; output: number }): HostPriceSummary => ({
    hosts: 3,
    cheapest: { host: "OpenAI", ...vendor },
    dearest: { host: "Azure", input: 5, output: 30 },
    vendor: { host: "OpenAI", ...vendor },
  });
  // The quoted price is the one the site read on OpenAI's own page.
  const quoted = { input: 4, output: 20 };

  // 30 Aug to 14 Oct 2026: the row under OpenAI's name was its flex tier.
  assert.deepEqual(makerOffer({ summary: sol({ input: 2, output: 10 }), openRouterId: "openai/gpt-5.6-sol" }, quoted), {
    offer: null,
    notStandardRate: true,
  });

  // Since 15 Oct the row reads the standard rate, while the id is still on the
  // list. Saying it "is not the standard rate" would now be false.
  const now = sol(quoted);
  assert.deepEqual(makerOffer({ summary: now, openRouterId: "openai/gpt-5.6-sol" }, quoted), {
    offer: now.vendor,
    notStandardRate: false,
  });
  assert.equal(priceProvenance(quoted, now), "vendor");
});

// ── Spread, builds, promotions ───────────────────────────────────────

test("a spread is worth saying from 10% up, and only between several hosts", () => {
  assert.equal(NOTEWORTHY_SPREAD, 1.1);
  assert.equal(hasNoteworthySpread(summary({ spread: 1.1 })), true);
  assert.equal(hasNoteworthySpread(summary({ spread: 1.09 })), false);
  assert.equal(hasNoteworthySpread(summary({ hosts: 1, spread: 3 })), false);
  assert.equal(hasNoteworthySpread(summary({ spread: undefined })), false, "no spread when the cheapest is free");
  assert.equal(hasNoteworthySpread(undefined), false);
  assert.equal(blendPair(1, 2), 1.7, "30% input, 70% output");
});

test("the builds the listings declare are named once each", () => {
  assert.deepEqual(declaredBuilds(coerceHostPricing(mimo)), ["bf16", "fp8"]);
  assert.deepEqual(declaredBuilds(summary()), [], "none declared");
  assert.deepEqual(declaredBuilds(undefined), []);
});

test("a promotional listing states the standard rate behind it", () => {
  assert.deepEqual(standardRateOf({ host: "DeepInfra", input: 0.387, output: 0.783, discount: 0.1 }), { input: 0.43, output: 0.87 });
  assert.equal(standardRateOf({ host: "Xiaomi", input: 0.435, output: 0.87 }), null, "the standard rate has none behind it");
  assert.equal(standardRateOf(undefined), null);

  assert.equal(
    describeOffer({ host: "DeepInfra", input: 0.387, output: 0.783, quantization: "fp8", discount: 0.1 }),
    "DeepInfra: $0.387 in / $0.783 out per 1M [fp8] (promotional, −10% off $0.43 / $0.87)",
  );
  assert.equal(describeOffer({ host: "Anthropic", input: 4, output: 20 }), "Anthropic: $4 in / $20 out per 1M");
});

// ── Against the quoted price ─────────────────────────────────────────

test("a host's cost is stated against the quoted one, in the reader's direction", () => {
  assert.equal(vsQuotedPct(0.75, 1), -25);
  assert.equal(vsQuotedPct(9.2, 1), 820);
  assert.equal(vsQuotedPct(1, 1), 0);
  assert.equal(vsQuotedPct(1, 0), null, "nothing to compare with");
  assert.equal(vsQuotedPct(Number.NaN, 1), null);

  assert.equal(describeVsQuoted(-25), "−25% vs quoted");
  assert.equal(describeVsQuoted(820), "+820% vs quoted");
  assert.equal(describeVsQuoted(0), "same cost as quoted");
  assert.equal(describeVsQuoted(null), "");
});

test("the footnote says what is not shown, and dates the prices when it can", () => {
  const dated = hostFootnote("2026-11-11");
  assert.match(dated, /List prices as published on 2026-11-11, via OpenRouter\./);
  assert.match(dated, /the hosts in between are not/);
  assert.match(dated, /Negotiated rates, committed-use discounts and provisioned capacity are not shown/);
  assert.match(dated, /cache and batch rates are not published per host/);
  assert.match(dated, /not a recommendation to buy there/);
  assert.match(hostFootnote(undefined), /List prices as published, via OpenRouter\./);
});
