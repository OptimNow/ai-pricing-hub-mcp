/**
 * Per-host prices: who sells a model, and at what range.
 *
 * Most models are sold by several hosts at different rates, and the price
 * every other tool here quotes is ONE of them. The site reads each model's
 * hosts nightly and publishes a compact summary on every row of
 * `/api/llm-models` (`hostPricing`, dated by `meta.hostPricingAsOf`): how many
 * hosts, the cheapest, the dearest, the model maker's own, and any promotional
 * listing. It does not publish the hosts in between.
 *
 * The first half of this file is a port of the site's `src/lib/host-prices.ts`
 * (the parts a reader of the API needs) and of `MAKER_ROW_NOT_STANDARD_RATE`
 * in its `src/lib/host-pricing-view.ts`. `npm run check-parity` runs both over
 * the live catalogue; change one side and it says so. The second half, the
 * coercion of what arrives over HTTP and the wording of the text block, is
 * this server's own.
 */

// ── Ported from the site ─────────────────────────────────────────────

/** One host's entry price for a model, per 1M tokens. */
export interface HostOffer {
  host: string;
  input: number;
  output: number;
  /** The build this host serves, when it declares one (fp8, int4...). A
   *  quantized build is not the same product as the full-precision one, so a
   *  range across hosts is not necessarily like-for-like. */
  quantization?: string;
  /** A promotional listing: the share taken off the host's standard rate,
   *  already applied to `input` and `output`. Absent at the standard rate. */
  discount?: number;
}

export interface OutlierBasis {
  medianInput: number;
  medianRatio: number;
}

/** The compact record the site serves per model. */
export interface HostPriceSummary {
  /** Distinct hosts publishing a usable rate. */
  hosts: number;
  cheapest: HostOffer;
  dearest: HostOffer;
  /** The model maker's own endpoint, when it sells one. Absent for open-weight
   *  models whose maker sells no API (Meta's Llama family, for one). */
  vendor?: HostOffer;
  /** dearest / cheapest by the 30/70 blend. Absent when the cheapest is free. */
  spread?: number;
  /** What an outlier listing is measured against. Absent with fewer than
   *  three priced hosts. */
  outlierBasis?: OutlierBasis;
  /** The listings at a promotional rate that no host also sells at its
   *  standard rate. Absent when there is none. */
  promotions?: HostOffer[];
}

/**
 * Whose price the quoted one is.
 *
 * - `vendor`     the model maker's own published rate.
 * - `reference`  another host's rate: the cheapest, the dearest, or one in
 *                between that the compact summary does not name.
 * - `adjusted`   it matches none of the rates the hosts currently publish.
 * - `unknown`    no host data for this model.
 */
export type PriceProvenance = "vendor" | "reference" | "adjusted" | "unknown";

/** The 30/70 input/output mix the site ranks on, over a bare price pair. */
export function blendPair(input: number, output: number): number {
  return input * 0.3 + output * 0.7;
}

/** Relative tolerance for "the same rate": 2%, far below any real price step
 *  and above the rounding that separates one figure published twice. */
export const SAME_RATE_TOLERANCE = 0.02;

/** True when two rates are the same price to within SAME_RATE_TOLERANCE. */
export function sameRate(a: number, b: number, tolerance = SAME_RATE_TOLERANCE): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) <= tolerance * scale;
}

/** True when a displayed price pair is the same rate card as a host's offer. */
export function matchesOffer(
  displayed: { input: number; output: number },
  offer: Pick<HostOffer, "input" | "output"> | undefined,
): boolean {
  if (!offer) return false;
  return sameRate(displayed.input, offer.input) && sameRate(displayed.output, offer.output);
}

function withinRange(displayed: { input: number; output: number }, summary: HostPriceSummary): boolean {
  const blended = blendPair(displayed.input, displayed.output);
  const low = blendPair(summary.cheapest.input, summary.cheapest.output);
  const high = blendPair(summary.dearest.input, summary.dearest.output);
  return blended >= low * (1 - SAME_RATE_TOLERANCE) && blended <= high * (1 + SAME_RATE_TOLERANCE);
}

/** Classifies the quoted price against the host summary. */
export function priceProvenance(
  displayed: { input: number; output: number },
  summary: HostPriceSummary | undefined,
): PriceProvenance {
  if (!summary) return "unknown";
  if (matchesOffer(displayed, summary.vendor)) return "vendor";
  if (
    matchesOffer(displayed, summary.cheapest) ||
    matchesOffer(displayed, summary.dearest) ||
    // A middle host: the compact summary does not carry it, so the honest
    // answer is "some host's rate", which is what `reference` means.
    withinRange(displayed, summary)
  ) {
    return "reference";
  }
  return "adjusted";
}

/** Below this the range between hosts is rounding, not a finding. */
export const NOTEWORTHY_SPREAD = 1.1;

export function hasNoteworthySpread(summary: HostPriceSummary | undefined): boolean {
  return !!summary && summary.hosts > 1 && (summary.spread ?? 1) >= NOTEWORTHY_SPREAD;
}

/** The standard rate behind a promotional offer: the listed price divided by
 *  (1 - discount), to 4 decimals. Null at the standard rate. */
export function standardRateOf(offer: HostOffer | undefined | null): { input: number; output: number } | null {
  const discount = offer?.discount;
  if (!offer || typeof discount !== "number" || !(discount > 0 && discount < 1)) return null;
  const round4 = (value: number) => Math.round(value * 10000) / 10000;
  return { input: round4(offer.input / (1 - discount)), output: round4(offer.output / (1 - discount)) };
}

export const HOST_DEFINITION =
  "A host is a company that runs the model and sells it by the token: the model maker, " +
  "a cloud platform like Amazon Bedrock, Azure or Vertex, or an independent host. " +
  "One model, several hosts, and often several prices.";

/** One sentence naming whose price the quoted one is. */
export function provenanceExplanation(provenance: PriceProvenance, summary: HostPriceSummary | undefined): string {
  switch (provenance) {
    case "vendor":
      return `This is the model maker's own published rate${summary?.vendor ? ` (${summary.vendor.host})` : ""}.`;
    case "reference":
      return "This is not the model maker's own rate. It is the rate of another host: the one our data source treats as its reference.";
    case "adjusted":
      return "The price we quote matches none of the rates this model's hosts currently publish. It is our data source's model-level figure, which can differ from that same source's per-host listings.";
    case "unknown":
      return "No per-host pricing is known for this model yet.";
  }
}

/**
 * Models whose "model maker" row is NOT the maker's standard rate, keyed by
 * the upstream (OpenRouter) id, so no sentence may quote that row as the
 * maker's price. On these two, the untagged `openai` row is OpenAI's flex
 * tier and the standard rate sits under a service tier the site sets aside.
 * The API does not flag it: the site keeps the list in its reader, and this
 * is that list.
 */
export const MAKER_ROW_NOT_STANDARD_RATE: ReadonlySet<string> = new Set([
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
]);

// ── This server's own ────────────────────────────────────────────────

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate one host offer as it arrives over HTTP. A free rate (0) is a real
 *  listing; a negative or missing one is not an offer. */
export function coerceHostOffer(value: unknown): HostOffer | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.host !== "string" || !o.host) return undefined;
  if (!finite(o.input) || !finite(o.output) || o.input < 0 || o.output < 0) return undefined;
  // Optional parts are set only when present, so an offer carries no
  // `undefined` keys: it is compared and serialised as upstream sent it.
  const offer: HostOffer = { host: o.host, input: o.input, output: o.output };
  if (typeof o.quantization === "string" && o.quantization) offer.quantization = o.quantization;
  if (finite(o.discount) && o.discount > 0 && o.discount < 1) offer.discount = o.discount;
  return offer;
}

/**
 * Validate a row's `hostPricing`. Undefined means unknown, which is also what
 * an absent field means upstream: a listing newer than the last nightly read,
 * never "sold by one host". A summary missing its host count, its cheapest or
 * its dearest offer is dropped whole rather than half-served.
 */
export function coerceHostPricing(value: unknown): HostPriceSummary | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const s = value as Record<string, unknown>;
  if (!finite(s.hosts) || !Number.isInteger(s.hosts) || s.hosts < 1) return undefined;
  const cheapest = coerceHostOffer(s.cheapest);
  const dearest = coerceHostOffer(s.dearest);
  if (!cheapest || !dearest) return undefined;

  const summary: HostPriceSummary = { hosts: s.hosts, cheapest, dearest };

  const vendor = coerceHostOffer(s.vendor);
  if (vendor) summary.vendor = vendor;
  if (finite(s.spread) && s.spread > 0) summary.spread = s.spread;

  const basis = s.outlierBasis as Record<string, unknown> | null | undefined;
  if (basis && typeof basis === "object" && finite(basis.medianInput) && finite(basis.medianRatio)) {
    summary.outlierBasis = { medianInput: basis.medianInput, medianRatio: basis.medianRatio };
  }

  const promotions = Array.isArray(s.promotions)
    ? s.promotions.map(coerceHostOffer).filter((o): o is HostOffer => o !== undefined)
    : [];
  if (promotions.length > 0) summary.promotions = promotions;

  return summary;
}

/** A model's host summary together with the upstream id it is keyed by. */
export interface ModelHostPricing {
  summary: HostPriceSummary;
  /** The upstream (OpenRouter) id, the key of MAKER_ROW_NOT_STANDARD_RATE. */
  openRouterId?: string;
}

/**
 * The maker's own offer, unless that row is a discount tier listed under the
 * maker's name. `notStandardRate` then says why there is none to quote.
 *
 * The exception bites only while the row DIFFERS from the quoted price. For
 * the ids in MAKER_ROW_NOT_STANDARD_RATE the site pins the quoted price to the
 * figure it read on the maker's own page, so a maker row at that same rate is
 * the standard rate, whatever the list says. That is the state since
 * 2026-10-15: the list is kept upstream until a re-check due on 2026-11-21,
 * and on 2026-11-11 OpenAI's row for GPT-5.6 Sol read $4/$20, the quoted
 * price. Applying the list blindly made this server say that row was "known
 * not to be its standard rate" on a day when it was.
 */
export function makerOffer(
  entry: ModelHostPricing | undefined,
  quoted: { input: number; output: number },
): { offer: HostOffer | null; notStandardRate: boolean } {
  const vendor = entry?.summary.vendor;
  if (!vendor) return { offer: null, notStandardRate: false };
  if (
    entry.openRouterId &&
    MAKER_ROW_NOT_STANDARD_RATE.has(entry.openRouterId) &&
    !matchesOffer(quoted, vendor)
  ) {
    return { offer: null, notStandardRate: true };
  }
  return { offer: vendor, notStandardRate: false };
}

/** The builds the offers a summary carries declare, e.g. ["fp8", "bf16"]. Two
 *  or more means the range is not like-for-like. Only the offers the summary
 *  names are known, so one build here does not prove every host serves it. */
export function declaredBuilds(summary: HostPriceSummary | undefined): string[] {
  if (!summary) return [];
  const offers = [summary.cheapest, summary.dearest, summary.vendor, ...(summary.promotions ?? [])];
  return [...new Set(offers.map((o) => o?.quantization).filter((q): q is string => !!q))];
}

/** Whole-percent difference of a cost against the quoted one: negative is
 *  cheaper. Null when there is no quoted cost to compare with. */
export function vsQuotedPct(cost: number, quotedCost: number): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(quotedCost) || quotedCost <= 0) return null;
  return Math.round((cost / quotedCost - 1) * 100);
}

/** "−25% vs quoted", "+132% vs quoted", "same cost as quoted". */
export function describeVsQuoted(pct: number | null): string {
  if (pct === null) return "";
  if (pct === 0) return "same cost as quoted";
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct)}% vs quoted`;
}

/** `DeepInfra: $0.10 in / $0.32 out per 1M [fp8]`, with the promotion behind
 *  a discounted listing: `(promotional, −25% off $0.435 / $0.87)`. */
export function describeOffer(offer: HostOffer): string {
  const standard = standardRateOf(offer);
  return (
    `${offer.host}: $${offer.input} in / $${offer.output} out per 1M` +
    (offer.quantization ? ` [${offer.quantization}]` : "") +
    (standard && offer.discount !== undefined
      ? ` (promotional, −${Math.round(offer.discount * 100)}% off $${standard.input} / $${standard.output})`
      : "")
  );
}

/** The caveats printed once under the host table. */
export function hostFootnote(asOf: string | undefined): string {
  return (
    `${HOST_DEFINITION}\n` +
    `Only the cheapest host, the dearest, the model maker's own and any promotional listing are carried here; ` +
    `the hosts in between are not.\n` +
    `List prices as published${asOf ? ` on ${asOf}` : ""}, via OpenRouter. Negotiated rates, committed-use ` +
    `discounts and provisioned capacity are not shown, and cache and batch rates are not published per host: ` +
    `every cost at a host's rate is a list-price cost.\n` +
    `The quoted price is one host's rate, kept so that models stay comparable. It is not a recommendation to buy there.`
  );
}
