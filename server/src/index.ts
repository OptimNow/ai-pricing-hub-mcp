import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { fetchLLMModels, filterModels, hostPricingKey, matchModels, resolveModel } from "./lib/llm-models.js";
import {
  blendPair,
  buildsOf,
  declaredBuilds,
  describeOffer,
  describeVsQuoted,
  hasNoteworthySpread,
  hostFootnote,
  makerOffer,
  matchesOffer,
  priceProvenance,
  provenanceExplanation,
  standardRateOf,
  vsQuotedPct,
} from "./lib/host-prices.js";
import type { HostOffer } from "./lib/host-prices.js";
import type { ResolutionStatus } from "./lib/llm-models.js";
import type { LLMModel, ComputeInstance } from "./data/pricing-data.js";
import { LLM_CAPABILITIES } from "./data/pricing-data.js";
import {
  USE_CASE_KEYS,
  USE_CASE_PROFILES,
  VOLUME_PRESETS,
  enrichModels,
  sortEnrichedModels,
  describeSort,
  LLM_SORT_KEYS,
  DEFAULT_LLM_SORT,
  summarizeFinOpsBadge,
  useCaseCost,
  optimizedUseCaseCost,
  formatMicroCost,
  formatMonthlyBudget,
  roundPerRequestCost,
  roundMonthlyCost,
  roundPricePer1M,
  roundPricePer1MOrNull,
  optimizationLevers,
  savingsPct,
  leverSummary,
  NO_ASSUMPTIONS_NOTE,
} from "./lib/llm-business-metrics.js";
import { OPENNESS_VALUES, opennessOf } from "./lib/openness.js";
import { createHttpServer } from "./lib/http.js";
import type {
  UseCaseProfile,
  VolumePreset,
  UseCaseKey,
  EnrichedLLMModel,
  OptimizationLevers,
} from "./lib/llm-business-metrics.js";
import { roiCalculatorUrl } from "./lib/roi-link.js";
import { ALL_PROCESSORS, enrichInstances } from "./lib/compute-categories.js";
import type { EnrichedComputeInstance } from "./lib/compute-categories.js";
import { outputSchema } from "./lib/output-schema.js";
import { describeRates, rateSavings, ratesLegend } from "./lib/compute-rates.js";
import {
  API_BASES,
  API_BASIS_LABELS,
  FLEET_RATES,
  HOURS_PER_MONTH,
  callerRateOption,
  describeDelta,
  describeOptionName,
  describePoint,
  evaluateOption,
  fleetCapacity,
  formatCount,
  formatThroughput,
  instancesNeeded,
  rateOptions,
  roundHourlyRate,
  roundThroughput,
  selfHostingFootnote,
  throughputForVolume,
  toPct,
} from "./lib/self-hosting.js";
import type { ApiBaseline, OptionResult, RateOption } from "./lib/self-hosting.js";
import {
  PRICING_REGIONS,
  DEFAULT_PRICING_REGION,
  fetchComputeInstances,
  incompleteCatalogueCaveat,
} from "./lib/compute-pricing.js";
import type { ComputeProvenance, PricingRegion } from "./lib/compute-pricing.js";
import { deprecationLegend, deprecationTag, describeDeprecation } from "./lib/deprecation.js";
import type { DeprecationInfo } from "./lib/deprecation.js";
import { OPTIMTOKEN_BASE_URL, describeUpstreamFailure } from "./lib/optimtoken-api.js";
import {
  describePct,
  describePriceChangesFailure,
  fetchPriceChanges,
  fetchPriceHistory,
  flagLegend,
  flagTags,
  isFlagged,
} from "./lib/price-changes.js";
import type { PriceChangesWindow, PriceMove } from "./lib/price-changes.js";
import { MAX_MODEL_HOST_IDS, describeHostListFailure, fetchModelHosts } from "./lib/model-hosts.js";
import { SERVER_INSTRUCTIONS } from "./lib/server-instructions.js";
import type { ModelHostsDetail, ModelHostsResult } from "./lib/model-hosts.js";

// ─── Output schemas ─────────────────────────────────────────────────
// Mirror the structuredContent each tool returns, error paths included, so a
// host and any downstream consumer get a contract instead of a guess.

/** The model maker's retirement notice, as the site publishes it. Present
 *  only on a model with a notice on record: absent is "none on record as of
 *  `provenance.deprecationsVerifiedAt`", never "not deprecated". */
const deprecationSchema = z.object({
  // The maker's shutdown date for its own API (YYYY-MM-DD), when it gives one.
  shutdown: z.string().optional(),
  // The replacement the maker recommends, when it names one.
  replacement: z.string().optional(),
});

const modelShape = {
  provider: z.string(),
  model: z.string(),
  parameters: z.string().optional(),
  inputPricePer1M: z.number(),
  outputPricePer1M: z.number(),
  batchInputPricePer1M: z.number().optional(),
  batchOutputPricePer1M: z.number().optional(),
  cachedInputPricePer1M: z.number().optional(),
  cacheWritePricePer1M: z.number().optional(),
  contextWindow: z.string(),
  category: z.string(),
  capabilities: z.array(z.string()),
  releaseDate: z.string().optional(),
  eloScore: z.number().optional(),
  license: z.string().optional(),
  // What kind of price the row quotes, as the site flags it. Present and true,
  // or absent: absent means not flagged or unknown, never "a typical price".
  outlierListing: z.boolean().optional(),
  promotionalListing: z.boolean().optional(),
  deprecation: deprecationSchema.optional(),
};

/** Where the cache and batch assumptions behind an optimized figure came from.
 *  `none-supplied` is a custom token shape with neither: its optimized cost
 *  repeats list price because nothing was assumed, not because nothing is
 *  achievable, and a reader has to be able to tell those apart. */
const OPTIMIZATION_BASES = ["preset", "caller-supplied", "none-supplied"] as const;
type OptimizationBasis = (typeof OPTIMIZATION_BASES)[number];

/** What the site flags on a row: the kind of price it quotes, and the maker's
 *  retirement notice. */
type Flagged = { promotionalListing?: boolean; outlierListing?: boolean; deprecation?: DeprecationInfo };

/** Inline markers for the kind of price a row quotes, e.g. ` [promotional price]`.
 *  For a line where the retirement notice is printed elsewhere. */
function priceTags(m: Flagged): string {
  return (m.promotionalListing ? " [promotional price]" : "") + (m.outlierListing ? " [outlier listing]" : "");
}

/** Every inline marker for a row: the price tags above, then the maker's
 *  retirement notice, e.g. ` [retired by its maker on 2026-08-10, replacement: GPT-5.6 Sol]`. */
function listingTags(m: Flagged): string {
  return priceTags(m) + deprecationTag(m);
}

/** One line per flag that appears in `models`, saying what the marker means.
 *  Empty when nothing is flagged, so an ordinary answer carries no boilerplate.
 *  `deprecationsVerifiedAt` dates the retirement notices, when any is shown. */
function listingLegend(models: Flagged[], deprecationsVerifiedAt?: string): string {
  const lines: string[] = [];
  if (models.some(m => m.promotionalListing)) {
    lines.push(
      "[promotional price]: a temporary discounted rate, charged today; the standard rate is higher, " +
      "so a budget built on it will rise when the promotion ends.",
    );
  }
  if (models.some(m => m.outlierListing)) {
    lines.push(
      "[outlier listing]: one host's rate with input near free and output at or above the going rate; " +
      "not typical of what the model costs elsewhere, and not eligible for the FinOps Friendly badge.",
    );
  }
  lines.push(...deprecationLegend(models, deprecationsVerifiedAt));
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

const enrichedModelSchema = z.object({
  ...modelShape,
  openness: z.string(),
  efficiencyScore: z.number().nullable(),
  useCaseCost: z.number(),
  optimizedUseCaseCost: z.number(),
  monthlyBudget: z.number(),
  optimizedMonthlyBudget: z.number(),
  volatilityRisk: z.string(),
  isFinOpsFriendly: z.boolean(),
  /** Which optimization levers actually applied for the selected use case, so
   *  a reader can name them instead of assuming caching. */
  batchEligible: z.boolean(),
  cacheEligible: z.boolean(),
  batchApplied: z.boolean(),
  cacheApplied: z.boolean(),
});

/**
 * Where the figures came from and whether anyone has checked them.
 *
 * Added because a caller had no way to date a number it was being told to quote
 * verbatim. `pricesVerified` is the load-bearing field: it is true only when
 * optimtoken.optimnow.io served the response, which is the only tier where the
 * vendor-verified price corrections have been applied.
 */
const llmProvenanceSchema = z.object({
  tier: z.number(),
  source: z.string(),
  label: z.string(),
  pricesVerified: z.boolean(),
  upstreamTimestamp: z.string().optional(),
  upstreamSource: z.string().optional(),
  upstreamSchemaVersion: z.string().optional(),
  catalogTotal: z.number().optional(),
  eloAsOf: z.string(),
  // The day the site last read each model's hosts: the date of the per-host
  // prices, and of the outlier and promotional flags decided from them.
  hostPricingAsOf: z.string().optional(),
  // The day the site last re-read its retirement notices against each model
  // maker's own page: the date of every `deprecation`, and of the lack of one.
  // Absent on a fallback tier, where no model carries a notice at all.
  deprecationsVerifiedAt: z.string().optional(),
  dataAsOf: z.string().optional(),
  notice: z.string().optional(),
});

/** As above, plus the per-provider and per-column detail only compute has.
 *  `staticPriceColumns` is `priceTypes` pre-walked: the columns served from
 *  constants rather than a live provider API, which is the distinction that
 *  decides whether a commitment-rate comparison can be audited. */
const computeProvenanceSchema = z.object({
  tier: z.number(),
  source: z.string(),
  label: z.string(),
  region: z.string(),
  upstreamTimestamp: z.string().optional(),
  upstreamSchemaVersion: z.string().optional(),
  catalogTotal: z.number().optional(),
  sources: z.record(z.string(), z.string()).optional(),
  sourceRegions: z.record(z.string(), z.string()).optional(),
  priceTypes: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  staticPriceColumns: z.array(z.string()),
  unavailablePriceColumns: z.array(z.string()),
  // AWS's publication date of the Savings Plan price files: the date of the
  // AWS savingsPlan1yr/3yr columns, which upstream reads weekly.
  awsSavingsPlansAsOf: z.string().optional(),
  upstreamErrors: z.array(z.string()).optional(),
  // How many of the providers the site reads live answered it on this read, and
  // the ones that did not, each with the Linux rows it is left with: the site's
  // static sample, a small part of that provider's catalogue.
  liveProviders: z.object({ live: z.number(), expected: z.number() }).optional(),
  degradedProviders: z.array(z.object({ provider: z.string(), rows: z.number() })).optional(),
  // Tier-2 diagnostics. `fallbackReason` says why tier 1 was missed, classified
  // and timed; `unappliedFilters` names the arguments this tier accepted and
  // then could not honour, so a consumer reading only `instances` is not left
  // to infer that from an empty array.
  fallbackReason: z.string().optional(),
  unappliedFilters: z.array(z.string()).optional(),
  // True on tier 2 (the snapshot) and on a tier-1 answer with a provider in
  // `degradedProviders`: "no match" is then not "no such instance".
  catalogueIsSubset: z.boolean().optional(),
  servedFromCacheAgeMs: z.number().optional(),
  dataAsOf: z.string().optional(),
  notice: z.string().optional(),
});

const compareModelsOutputSchema = {
  models: z.array(enrichedModelSchema),
  useCaseLabel: z.string(),
  volumeLabel: z.string(),
  source: z.string(),
  matchingCount: z.number(),
  catalogSize: z.number(),
  // The order `models` is in, and so what "the first N" of a longer match means.
  sortedBy: z.enum(LLM_SORT_KEYS),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  // What the badge's percentile gates land on for this catalogue, so "top 40%"
  // can be restated as a concrete ELO and price instead of taken on faith.
  finopsBadge: z
    .object({
      qualifying: z.number(),
      ranked: z.number(),
      minElo: z.number().nullable(),
      maxBlendedPrice: z.number().nullable(),
    })
    .optional(),
  provenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

const estimateCostOutputSchema = {
  modelCosts: z.array(
    z.object({
      model: z.object(modelShape),
      costs: z.array(
        z.object({
          useCase: z.string(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          perRequest: z.number(),
          monthly: z.number(),
          perRequestOptimized: z.number(),
          monthlyOptimized: z.number(),
          savingsPct: z.number(),
          batchEligible: z.boolean(),
          cacheEligible: z.boolean(),
          batchApplied: z.boolean(),
          cacheApplied: z.boolean(),
          // The cache assumption behind the optimized figure and where the
          // assumptions came from. `batchEligible` above is its batch twin.
          cacheHitRate: z.number(),
          optimizationBasis: z.enum(OPTIMIZATION_BASES),
        }),
      ),
    }),
  ),
  volume: z.number(),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  provenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

const computePricingOutputSchema = {
  instances: z.array(
    z.object({
      provider: z.string(),
      instanceType: z.string(),
      os: z.string(),
      vCPUs: z.number(),
      memory: z.number(),
      processor: z.string(),
      category: z.string(),
      useCases: z.array(z.string()),
      onDemandHourly: z.number().nullable(),
      onDemandMonthly: z.number().nullable(),
      spot: z.number().nullable(),
      savingsPlan1yr: z.number().nullable(),
      savingsPlan3yr: z.number().nullable(),
      reserved1yr: z.number().nullable(),
      reserved3yr: z.number().nullable(),
      // Whole-percent saving of each rate against this row's on-demand rate.
      // Null when the rate is missing or is not below on-demand: there is
      // then no saving to state, and it is never a negative number.
      spotSavingsPct: z.number().nullable(),
      savingsPlan1yrSavingsPct: z.number().nullable(),
      savingsPlan3yrSavingsPct: z.number().nullable(),
      reserved1yrSavingsPct: z.number().nullable(),
      reserved3yrSavingsPct: z.number().nullable(),
    }),
  ),
  matchingCount: z.number(),
  catalogSize: z.number(),
  source: z.string(),
  provenance: computeProvenanceSchema.optional(),
  error: z.string().optional(),
};

const resolutionSchema = z.object({
  query: z.string(),
  status: z.enum(["exact", "unique", "ambiguous", "not-found", "duplicate"]),
  resolved: z.string().optional(),
  /** Capped at 5 — `totalMatches` is the real figure. */
  alternatives: z.array(z.string()),
  totalMatches: z.number(),
});

/** One (model, use case) cell: list and optimized cost, plus which of the two
 *  optimization levers actually applied. The levers ship so a consumer can say
 *  *why* a saving is 0% instead of reporting a bare zero. */
const useCaseCostSchema = z.object({
  key: z.string(),
  label: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  perRequest: z.number(),
  perRequestOptimized: z.number(),
  monthly: z.number(),
  monthlyOptimized: z.number(),
  savingsPct: z.number(),
  batchEligible: z.boolean(),
  cacheEligible: z.boolean(),
  batchApplied: z.boolean(),
  cacheApplied: z.boolean(),
});

const sideBySideOutputSchema = {
  models: z.array(z.object({ ...modelShape, useCaseCosts: z.array(useCaseCostSchema) })),
  resolution: z.array(resolutionSchema),
  volume: z.number(),
  volumeLabel: z.string(),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  provenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

/** One host's listing for a model, costed for the chosen workload. */
const hostOfferSchema = z.object({
  host: z.string(),
  inputPricePer1M: z.number(),
  outputPricePer1M: z.number(),
  // The build this host serves, when it declares one (fp8, int4...). A
  // quantized build is not the same product as the full-precision one.
  quantization: z.string().optional(),
  // On a promotional listing only: the share taken off the host's standard
  // rate (already applied to the two prices above), and that standard rate.
  discount: z.number().optional(),
  standardInputPricePer1M: z.number().optional(),
  standardOutputPricePer1M: z.number().optional(),
  // List-price cost of the workload at this host's rate.
  perRequest: z.number(),
  monthly: z.number(),
  // Whole-percent difference against the cost at the quoted price: negative
  // is cheaper than quoted. Null when there is no quoted cost to compare with.
  vsQuotedPct: z.number().nullable(),
});

const modelHostsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  eloScore: z.number().optional(),
  openness: z.string(),
  // The price every other tool here quotes for this model, and whose rate it
  // is: the maker's own ("vendor"), another host's ("reference"), a figure no
  // host currently publishes ("adjusted"), or "unknown" without host data.
  quoted: z.object({
    inputPricePer1M: z.number(),
    outputPricePer1M: z.number(),
    perRequest: z.number(),
    monthly: z.number(),
    priceSource: z.enum(["vendor", "reference", "adjusted", "unknown"]),
    outlierListing: z.boolean().optional(),
    promotionalListing: z.boolean().optional(),
    // The hosts in `offers` publishing the quoted rate, to within rounding.
    // Present only when the full host list was read; it can be empty, when the
    // quoted price is none of the rates the hosts publish.
    matchingHosts: z.array(z.string()).optional(),
  }),
  deprecation: deprecationSchema.optional(),
  // Null means no host data for this model: unknown, never "one host".
  hostCount: z.number().nullable(),
  cheapest: hostOfferSchema.nullable(),
  dearest: hostOfferSchema.nullable(),
  // The model maker's own endpoint. Null when it sells none, when there is no
  // host data, or when `vendorRowNotStandardRate` is true.
  vendor: hostOfferSchema.nullable(),
  // True when the row upstream lists under the maker's name is a discount
  // tier rather than its standard rate, so it is not quoted as the maker's.
  vendorRowNotStandardRate: z.boolean(),
  // Dearest over cheapest on the 30/70 blended price. Null with no host data
  // or when the cheapest listing is free.
  spread: z.number().nullable(),
  noteworthySpread: z.boolean(),
  // The builds the offers declare: every host's when `offers` is known, the
  // named ones above otherwise. Two or more: not like-for-like.
  quantizations: z.array(z.string()),
  promotions: z.array(hostOfferSchema),
  // Every host publishing a usable rate, cheapest first on the blended price,
  // each costed for the workload. Null when the full list is not known for
  // this model: see `hostList`. Null is never "no other host".
  offers: z.array(hostOfferSchema).nullable(),
  // Where the site lists the model as sold, from a list it keeps by hand for
  // the major models (`provenance` says how: "estimated"). Null when the model
  // is not in that list, which is not "sold nowhere".
  platforms: z.object({ names: z.array(z.string()), provenance: z.string() }).nullable(),
  // AWS regions where Amazon Bedrock lists the model, in the region or through
  // a geographic inference profile. Null when no Bedrock model id matched the
  // model's name, which is not "not on Bedrock".
  bedrockRegions: z.array(z.string()).nullable(),
});

/** Whether the full host list (the site's `/api/model-hosts`) was read for
 *  this answer, and the dates of what it carries. */
const hostListSchema = z.object({
  available: z.boolean(),
  // Why it is not, when it is not: a fallback tier, or the failed request.
  unavailableReason: z.string().optional(),
  upstreamSchemaVersion: z.string().optional(),
  // The day the per-host rates were read (nightly).
  hostPricingAsOf: z.string().optional(),
  // The day the platforms list was last reviewed by hand.
  availabilityReviewedAt: z.string().optional(),
  // The day AWS's own model list was last read (weekly).
  bedrockAvailabilityAsOf: z.string().optional(),
  // Upstream ids the site's catalogue did not hold when asked.
  notFound: z.array(z.string()),
});

const modelHostsOutputSchema = {
  models: z.array(modelHostsSchema),
  hostList: hostListSchema.optional(),
  resolution: z.array(resolutionSchema),
  useCaseLabel: z.string(),
  volume: z.number(),
  volumeLabel: z.string(),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  provenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

/** One way of paying the API for the workload: what the fleet is held against. */
const apiBaselineSchema = z.object({
  // "list" is the quoted price, "optimized" that price with the caching and
  // batch levers the workload allows, "cheapestHost" the cheapest host known.
  basis: z.enum(API_BASES),
  label: z.string(),
  // The rate behind the figure. Absent on "optimized", which has no single rate.
  inputPricePer1M: z.number().optional(),
  outputPricePer1M: z.number().optional(),
  // "cheapestHost" only: who it is, the build it declares, and the share a
  // promotional listing takes off its standard rate.
  host: z.string().optional(),
  quantization: z.string().optional(),
  discount: z.number().optional(),
  perRequest: z.number(),
  monthly: z.number(),
  // "optimized" only: the saving against list and the levers behind it.
  savingsPct: z.number().optional(),
  batchEligible: z.boolean().optional(),
  cacheEligible: z.boolean().optional(),
  batchApplied: z.boolean().optional(),
  cacheApplied: z.boolean().optional(),
});

/** Where one way of paying for the fleet meets one way of paying the API. */
const breakEvenSchema = z.object({
  basis: z.enum(API_BASES),
  // Monthly requests at which the two cost the same: below it the API is
  // cheaper, above it the fleet is. Null when the API costs nothing per request.
  requestsPerMonth: z.number().nullable(),
  // The same volume as input + output tokens a day.
  tokensPerDay: z.number().nullable(),
  // Output tokens the fleet must generate each second, averaged over every
  // hour of the month, to serve that volume.
  requiredOutputTokensPerSecond: z.number().nullable(),
  // That volume as a percentage of what the fleet can serve flat out. Null
  // when no throughput was supplied. Above 100 it is out of reach.
  utilizationPct: z.number().nullable(),
  reachable: z.boolean().nullable(),
  // At the caller's volume: fleet cost minus API cost, per month. Positive
  // means the fleet is the dearer of the two.
  fleetMinusApiMonthly: z.number(),
});

const fleetOptionSchema = z.object({
  rate: z.enum(FLEET_RATES),
  label: z.string(),
  hourlyRate: z.number(),
  // Upstream marks this rate a curated estimate, not one read this cycle.
  static: z.boolean(),
  // Spot capacity: the provider can reclaim it at short notice.
  interruptible: z.boolean(),
  // Every instance billed 730 hours, plus the operations cost supplied.
  monthlyCost: z.number(),
  // One request with the fleet flat out around the clock: the lowest the
  // fleet can go. Null when no throughput was supplied.
  fullLoadCostPerRequest: z.number().nullable(),
  breakEven: z.array(breakEvenSchema),
});

const selfHostingOutputSchema = {
  // Null only when no model was resolved.
  model: z
    .object({
      provider: z.string(),
      model: z.string(),
      parameters: z.string().optional(),
      eloScore: z.number().optional(),
      license: z.string().optional(),
      openness: z.string(),
      // True when the licence publishes the weights, false when it is
      // proprietary, null when the licence was never established.
      selfHostable: z.boolean().nullable(),
      inputPricePer1M: z.number(),
      outputPricePer1M: z.number(),
      outlierListing: z.boolean().optional(),
      promotionalListing: z.boolean().optional(),
      // The maker's retirement notice for its API. It does not reach weights
      // already downloaded: an open model stays runnable on one's own fleet.
      deprecation: deprecationSchema.optional(),
    })
    .nullable(),
  workload: z.object({
    useCase: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheHitRate: z.number(),
    batchEligible: z.boolean(),
    optimizationBasis: z.enum(OPTIMIZATION_BASES),
    // Requests a month the comparison is made at.
    volume: z.number(),
  }),
  api: z.array(apiBaselineSchema),
  // Null when the fleet could not be priced.
  fleet: z
    .object({
      // The catalogue instance, or nulls when the caller supplied the rate.
      provider: z.string().nullable(),
      instanceType: z.string().nullable(),
      region: z.string().nullable(),
      vCPUs: z.number().nullable(),
      memory: z.number().nullable(),
      processor: z.string().nullable(),
      category: z.string().nullable(),
      instanceCount: z.number(),
      hoursPerMonth: z.number(),
      monthlyOperationsCost: z.number(),
      // False means the fleet figures are hardware rent only.
      operationsCostSupplied: z.boolean(),
      // Per instance, as the caller measured it. Null: none was supplied, and
      // none was assumed.
      outputTokensPerSecond: z.number().nullable(),
      // What the caller's volume asks of the whole fleet, averaged over every
      // hour of the month. A comparison at that volume holds only if the
      // fleet can generate it.
      volumeRequiredOutputTokensPerSecond: z.number(),
      // What the fleet serves flat out, the share of it the caller's volume
      // uses, and the instances that volume takes. Null without a throughput.
      capacityRequestsPerMonth: z.number().nullable(),
      volumeUtilizationPct: z.number().nullable(),
      canServeVolume: z.boolean().nullable(),
      instancesNeededForVolume: z.number().nullable(),
    })
    .nullable(),
  options: z.array(fleetOptionSchema),
  resolution: z.array(resolutionSchema),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  provenance: llmProvenanceSchema.optional(),
  // Present when the fleet was priced from the compute catalogue.
  computeProvenance: computeProvenanceSchema.optional(),
  error: z.string().optional(),
};

/** One constraint the caller set, and whether this model met it. Returned for
 *  satisfied constraints too: "met" is the evidence behind a recommendation. */
const constraintCheckSchema = z.object({
  constraint: z.string(),
  required: z.string(),
  actual: z.string(),
  satisfied: z.boolean(),
});

const recommendationSchema = z.object({
  rank: z.number(),
  provider: z.string(),
  model: z.string(),
  category: z.string(),
  openness: z.string(),
  contextWindow: z.string(),
  capabilities: z.array(z.string()),
  license: z.string().optional(),
  eloScore: z.number().nullable(),
  efficiencyScore: z.number().nullable(),
  efficiencyRank: z.number().nullable(),
  rankedOutOf: z.number(),
  perRequest: z.number(),
  perRequestOptimized: z.number(),
  monthlyBudget: z.number(),
  monthlyOptimizedBudget: z.number(),
  savingsPct: z.number(),
  isFinOpsFriendly: z.boolean(),
  volatilityRisk: z.string(),
  costDeltaVsTopPct: z.number(),
  constraints: z.array(constraintCheckSchema),
  outlierListing: z.boolean().optional(),
  promotionalListing: z.boolean().optional(),
  // Only on an entry of `retiredNotRecommended`: a model with a retirement
  // notice is never in `recommendations` or `nearMisses`.
  deprecation: deprecationSchema.optional(),
});

const recommendOutputSchema = {
  recommendations: z.array(recommendationSchema),
  /** Populated only when `overConstrained` — the nearest models, each carrying
   *  the constraint it failed, so an impossible query still answers something. */
  nearMisses: z.array(recommendationSchema),
  /** A recommendation is a model to start on, so a model whose maker has
   *  announced its retirement is left out of the two lists above. This is how
   *  many ranked models that removed, and the ones among them that satisfied
   *  every constraint and would have ranked at or above the last pick (three
   *  at most), so the exclusion can be checked. Zero and empty on a fallback
   *  tier, where no model carries a notice. */
  retiredExcludedCount: z.number(),
  retiredNotRecommended: z.array(recommendationSchema),
  overConstrained: z.boolean(),
  useCaseLabel: z.string(),
  volumeLabel: z.string(),
  volume: z.number(),
  candidateCount: z.number(),
  rankedCount: z.number(),
  catalogSize: z.number(),
  roiCalculatorUrl: z.string(),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  provenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

/** One price of the site's archive, costed for the chosen workload. */
const archivedPriceSchema = z.object({
  inputPricePer1M: z.number(),
  outputPricePer1M: z.number(),
  // List-price cost of the workload at this price.
  perRequest: z.number(),
  monthly: z.number(),
});

/** A move of the price the site quotes for a model, over the trend window. */
const priceMoveSchema = z.object({
  provider: z.string(),
  model: z.string(),
  // The price quoted on the first and on the last day of the window.
  before: archivedPriceSchema,
  after: archivedPriceSchema,
  // Change of the blended price (30% input, 70% output), in percent.
  blendedPct: z.number(),
  // Null when the price it starts from is zero.
  inputPct: z.number().nullable(),
  outputPct: z.number().nullable(),
  // What the move does to the workload's monthly bill: after minus before.
  monthlyDelta: z.number(),
  // What the site established about the move: "hostSwitch" (the host quoted
  // changed) or "outlierHost" (an outlier listing). Empty means neither was
  // established, which is NOT a statement that the model maker repriced.
  flags: z.array(z.string()),
  // The price the catalogue quotes today, only when it is not `after`: the
  // archive is a nightly file and the catalogue is live.
  quotedNow: z.object({ inputPricePer1M: z.number(), outputPricePer1M: z.number() }).optional(),
  deprecation: deprecationSchema.optional(),
});

/** One dated price in a model's history. */
const priceHistoryPointSchema = z.object({
  // The day the quoted price changed; it holds from that day on.
  date: z.string(),
  inputPricePer1M: z.number(),
  outputPricePer1M: z.number(),
  perRequest: z.number(),
  monthly: z.number(),
  // Against the price before it. Null on the first price on record.
  blendedPct: z.number().nullable(),
  flags: z.array(z.string()),
});

const priceHistorySchema = z.object({
  provider: z.string(),
  model: z.string(),
  // False when no history could be given for this model. `unavailableReason`
  // then says why. Never read it as "the price never changed".
  known: z.boolean(),
  unavailableReason: z.string().optional(),
  // The first day the model is in the archive.
  firstSeen: z.string().nullable(),
  first: priceHistoryPointSchema.nullable(),
  // Each day the quoted price changed, oldest first. Empty with `known` true:
  // the quoted price has not changed since `first`.
  changes: z.array(priceHistoryPointSchema),
  changeCount: z.number(),
  flaggedCount: z.number(),
  // The price in force on the archive's last day: the last change, or `first`.
  latest: priceHistoryPointSchema.nullable(),
  // From the first price on record to the latest, on the blended price.
  netBlendedPct: z.number().nullable(),
  quotedNow: z.object({ inputPricePer1M: z.number(), outputPricePer1M: z.number() }).optional(),
  deprecation: deprecationSchema.optional(),
});

/** The site's price archive: what it covers and how fresh it is. There is no
 *  fallback tier behind it, so this is present or the answer is an error. */
const priceChangesProvenanceSchema = z.object({
  source: z.string(),
  label: z.string(),
  upstreamSchemaVersion: z.string().optional(),
  // The window the moves are measured over: the last 7 days at most.
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
  // The first and the newest day of the archive.
  trackingStart: z.string().optional(),
  asOf: z.string().optional(),
});

const priceChangesOutputSchema = {
  // "window": the moves of the trend window. "history": named models' prices
  // since tracking began.
  mode: z.enum(["window", "history"]),
  // Window mode. The whole window, before any filter: `unflagged` is what the
  // site's barometer counts as price changes. Null in history mode.
  summary: z
    .object({
      tracked: z.number().nullable(),
      moved: z.number(),
      up: z.number(),
      down: z.number(),
      flagged: z.number(),
      unflagged: z.number(),
    })
    .nullable(),
  // The moves no flag was established on, then the flagged ones, each largest
  // first and cut at `limit`. `matchingCount` is how many matched the filters.
  priceChanges: z.array(priceMoveSchema),
  flaggedMoves: z.array(priceMoveSchema),
  matchingCount: z.number(),
  // History mode.
  histories: z.array(priceHistorySchema),
  resolution: z.array(resolutionSchema),
  useCaseLabel: z.string(),
  volume: z.number(),
  volumeLabel: z.string(),
  provenance: priceChangesProvenanceSchema.optional(),
  // The catalogue the names, the retirement notices and `quotedNow` come from.
  catalogueProvenance: llmProvenanceSchema.optional(),
  error: z.string().optional(),
};

type ResolutionEntry = { query: string; status: ResolutionStatus; resolved?: string; alternatives: string[]; totalMatches: number };
type ConstraintCheck = z.infer<typeof constraintCheckSchema>;
type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * The rows this tool can actually return, enriched, memoised per catalogue.
 *
 * Two wastes were stacked here. `enrichInstances()` ran over all ~6,050 rows on
 * every single request — 60-85% of warm CPU and ~2.6 MB of allocation — even
 * though the catalogue behind it is memoised for an hour and the enrichment is
 * a pure function of it. And ~41% of those rows are Windows, which the filter
 * below discarded immediately afterwards, so nearly half the work could never
 * reach a caller.
 *
 * Keyed by the catalogue array identity rather than by region or a timestamp:
 * the memo in compute-pricing.ts hands back the same array for the life of an
 * entry and a fresh one after a refresh, so identity tracks exactly the thing
 * that would invalidate this. A WeakMap means a refreshed catalogue takes its
 * enriched copy with it.
 */
const servableCache = new WeakMap<ComputeInstance[], EnrichedComputeInstance[]>();

function servableCatalogue(catalogue: ComputeInstance[]): EnrichedComputeInstance[] {
  const hit = servableCache.get(catalogue);
  if (hit) return hit;
  // Linux-only is a property of the tool, not of the fetch layer, which is why
  // the filter lives here rather than in coerceSiteInstance.
  const enriched = enrichInstances(catalogue).filter(inst => inst.os === "Linux");
  servableCache.set(catalogue, enriched);
  return enriched;
}

/** Flat shortfall charge for a constraint that is a yes/no, not a distance.
 *  Larger than any realistic numeric shortfall (a 10x budget overrun scores 1,
 *  a 500-point ELO gap scores 5) so categorical misses rank last among equals. */
const CATEGORICAL_SHORTFALL = 10;

function modelKey(m: { provider: string; model: string }): string {
  return `${m.provider}/${m.model}`;
}

/** Resolve each requested name against the catalogue: one pass per name,
 *  keeping the caller's order and recording every miss. Dropping a name
 *  silently is the failure mode to avoid. Shared by the tools that take a
 *  list of free-text model names. */
function resolveNames(
  allModels: LLMModel[],
  requested: string[],
): { selected: LLMModel[]; resolution: ResolutionEntry[] } {
  const seen = new Set<string>();
  const resolution: ResolutionEntry[] = [];
  const selected: LLMModel[] = [];

  for (const query of requested) {
    const r = resolveModel(allModels, query);
    if (!r.matched) {
      resolution.push({ query, status: "not-found", alternatives: [], totalMatches: 0 });
      continue;
    }
    const resolved = `${r.matched.provider} ${r.matched.model}`;
    if (seen.has(modelKey(r.matched))) {
      resolution.push({ query, status: "duplicate", resolved, alternatives: r.alternatives, totalMatches: r.totalMatches });
      continue;
    }
    seen.add(modelKey(r.matched));
    selected.push(r.matched);
    resolution.push({ query, status: r.status, resolved, alternatives: r.alternatives, totalMatches: r.totalMatches });
  }

  return { selected, resolution };
}

/** One sentence per requested name. `slot` is what a matched name earns in the
 *  tool's answer (a "column", an "entry"), so a miss can say it earned none. */
function describeResolution(r: ResolutionEntry, slot: string): string {
  switch (r.status) {
    case "not-found": return `"${r.query}" matched no model — no ${slot} for it.`;
    case "duplicate": return `"${r.query}" resolved to ${r.resolved}, already selected by an earlier name — no extra ${slot}.`;
    case "ambiguous": {
      const undisclosed = r.totalMatches - 1 - r.alternatives.length;
      return `"${r.query}" matched ${r.totalMatches} models; used ${r.resolved}` +
        (r.alternatives.length > 0
          ? ` (also matched: ${r.alternatives.join(", ")}${undisclosed > 0 ? `, and ${undisclosed} more` : ""})`
          : "") + ".";
    }
    default: return `"${r.query}" → ${r.resolved}.`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Tools ──────────────────────────────────────────────────────────
// (serialisation-contract.test.ts reads the output schemas as everything above
// this heading, so keep the heading where the schemas end.)

/** The tools, as registrations to replay on a server. One MCP server is built
 *  per request (see lib/http.ts for why), so a tool cannot be registered once
 *  on a long-lived instance: it is declared once here and registered on each. */
const tools: ((server: McpServer) => void)[] = [];

/** Declare a tool. Same parameters as `McpServer.registerTool`, so the handler's
 *  arguments are inferred from `inputSchema` exactly as they would be there. */
function tool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>,
): void {
  tools.push(server => {
    server.registerTool(name, config, cb);
  });
}

// ─── Tool 1: Compare LLM Models ─────────────────────────────────────

tool(
  "compare-llm-models",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare LLM Models",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Browse and filter the whole LLM catalogue and get back a ranked table: price, quality (ELO), " +
      "efficiency and capabilities. Use this when the user wants to SEE THE FIELD — 'show me models " +
      "under $1/1M', 'which providers have vision models', 'list open-weight models above ELO 1300', " +
      "'the ten cheapest models for a coding task'. " +
      "The table is ordered by Arena ELO unless `sortBy` asks for efficiency, cost or price, and `limit` " +
      "keeps the first rows of that order. " +
      "For a single PICK under a budget use recommend-llm-model; to weigh 2-4 NAMED models against " +
      "each other use compare-models-side-by-side. " +
      "Prices come from optimtoken.optimnow.io where reachable; the response's `provenance` says which tier served them and whether they are vendor-verified. Filter by provider, price tier (category), openness, " +
      "capability, price range, or minimum ELO score. Optionally enrich with business metrics for a use case. " +
      "Price tier and openness are independent: a model can be Frontier-priced and open-weight at once. " +
      "Reports both list-price cost and the optimized cost achievable with prompt caching and the batch API. " +
      "Prices, costs and scores are final as returned: rounded and ranked server-side, and dated by " +
      "`provenance`. The text block is a numbered table of the same figures.",
    inputSchema: {
      provider: z.string().optional().describe("Filter by provider name (e.g. 'OpenAI', 'Anthropic', 'Google')"),
      category: z.string().optional().describe("Price tier, matched by exact equality (case-insensitive): Frontier, Mid-tier, Budget, Image. This is cost only — self-hostability is the separate `openness` axis."),
      openness: z.enum(OPENNESS_VALUES as [string, ...string[]]).optional().describe("Filter by self-hostability, derived from the licence: Open source, Open weights, Proprietary, Unknown"),
      capability: z.string().optional().describe(`Capability, matched by exact equality (case-insensitive): ${LLM_CAPABILITIES.join(", ")}. Any other string returns zero matches. There is no Code capability: for what coding costs, use useCasePreset codingTask.`),
      maxInputPrice: z.number().optional().describe("Max input price per 1M tokens in USD"),
      maxOutputPrice: z.number().optional().describe("Max output price per 1M tokens in USD"),
      minElo: z.number().positive().optional().describe("Minimum Chatbot Arena ELO score. Typical range 1000-1500; ~1400 is roughly frontier-class. Models with no ELO score never satisfy this."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k). Default: supportTicket"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      sortBy: z.enum(LLM_SORT_KEYS).optional().describe("Order of the table, best first. elo: Arena ELO, highest first (default). efficiency: value score out of 100, highest first. cost: list-price cost per request for the use case, cheapest first. optimizedCost: the same after caching and batch. inputPrice / outputPrice: price per 1M tokens, cheapest first. A model missing the sorted figure comes last, and ties keep the ELO order. Cheapest first says nothing about quality: read the ELO beside each row."),
      limit: z.number().min(1).max(50).optional().describe("Max models to return, counted after sorting (default: 15)"),
    },
    outputSchema: outputSchema(compareModelsOutputSchema),
  },
  async ({ provider, category, openness, capability, maxInputPrice, maxOutputPrice, minElo, useCasePreset, volumePreset, sortBy, limit }) => {
    const sortedBy = sortBy ?? DEFAULT_LLM_SORT;
    const emptyOutput = {
      models: [],
      useCaseLabel: "",
      volumeLabel: "",
      source: "error",
      matchingCount: 0,
      catalogSize: 0,
      sortedBy,
      eloAsOf: "",
    };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const vol = (volumePreset || "100k") as VolumePreset;
      const ucKey = useCasePreset || "supportTicket";

      // Value scores are percentile ranks: computing them over the full catalogue
      // and filtering afterwards keeps the FinOps Friendly badge meaning the same
      // thing regardless of which filters the caller happened to apply.
      const enriched = enrichModels(allModels, vol, ucKey);
      const finopsBadge = summarizeFinOpsBadge(enriched);
      const filtered = filterModels(enriched, {
        provider, category, openness, capability, maxInputPrice, maxOutputPrice, minElo,
      });

      // Sorted after filtering and before the cut, on the unrounded figures:
      // `limit` keeps the first rows of the order the caller asked for.
      const maxCount = limit || 15;
      const results = sortEnrichedModels(filtered, sortedBy).slice(0, maxCount);

      const volumeLabel = VOLUME_PRESETS.find(p => p.key === vol)?.label || vol;
      const useCaseLabel = USE_CASE_PROFILES[ucKey].label;

      // Build text summary for LLM consumption
      const lines = results.map((m, i) =>
        `${i + 1}. ${m.provider} ${m.model} — ` +
        `${m.category}, ${m.openness}` +
        `, Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M` +
        listingTags(m) +
        // Both are printed even when missing: in a table sorted by price, a row
        // with no ELO has to say so, or it reads as a ranked model.
        `, ELO: ${m.eloScore || "n/a"}` +
        `, Efficiency: ${m.efficiencyScore === null ? "n/a" : `${m.efficiencyScore}/100`}` +
        `, ${useCaseLabel} cost: ${formatMicroCost(m.useCaseCost)}/req` +
        ` (optimized: ${formatMicroCost(m.optimizedUseCaseCost)}/req)` +
        `, Monthly (${volumeLabel}): ${formatMonthlyBudget(m.monthlyBudget)}` +
        ` (optimized: ${formatMonthlyBudget(m.optimizedMonthlyBudget)})` +
        (m.isFinOpsFriendly ? " ✅ FinOps Friendly" : "")
      );

      return {
        structuredContent: {
          // Costs are rounded on the way out only; `enriched` keeps the raw
          // floats that the ranking above depends on.
          models: results.map(m => ({
            ...m,
            useCaseCost: roundPerRequestCost(m.useCaseCost),
            monthlyBudget: roundMonthlyCost(m.monthlyBudget),
            optimizedUseCaseCost: roundPerRequestCost(m.optimizedUseCaseCost),
            optimizedMonthlyBudget: roundMonthlyCost(m.optimizedMonthlyBudget),
            ...optimizationLevers(m, USE_CASE_PROFILES[ucKey]),
          })),
          useCaseLabel,
          volumeLabel,
          source,
          matchingCount: filtered.length,
          catalogSize: allModels.length,
          sortedBy,
          eloAsOf,
          dataAsOf,
          provenance,
          // maxBlendedPrice is derived (input×0.3 + output×0.7), so it carries
          // the same float noise the costs did — just less visibly, since only
          // one value surfaces per call.
          finopsBadge: {
            ...finopsBadge,
            maxBlendedPrice: roundPricePer1MOrNull(finopsBadge.maxBlendedPrice),
          },
        },
        content: [
          {
            type: "text",
            // The notice leads: a caller told to report prices exactly as
            // returned must see "unverified" before it sees the prices.
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n` +
              `${filtered.length} of ${allModels.length} models match; showing the first ${results.length}, ` +
              `sorted by ${describeSort(sortedBy, useCaseLabel)}. ` +
              `Use case: ${useCaseLabel}, Volume: ${volumeLabel}/mo. ` +
              `Optimized costs assume prompt caching and, where the use case allows, the batch API.\n` +
              `FinOps Friendly today means ELO ≥ ${finopsBadge.minElo ?? "n/a"} and a blended list price ` +
              `≤ $${finopsBadge.maxBlendedPrice?.toFixed(2) ?? "n/a"}/1M, plus a top-30% efficiency score, ` +
              `a stable release, a price that is not an outlier listing and no retirement notice from its maker — ` +
              `${finopsBadge.qualifying} of ${finopsBadge.ranked} ranked models qualify.\n\n` +
              lines.join("\n") + listingLegend(results, provenance.deprecationsVerifiedAt),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-llm-models] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error comparing models: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 2: Estimate LLM Cost ──────────────────────────────────────

tool(
  "estimate-llm-cost",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Estimate LLM Cost",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Cost a workload with EXACT numbers the caller supplies: arbitrary token counts per request and " +
      "any monthly volume, not just the 10k/100k/1m presets the other cost tools use. Use this for " +
      "'about 800 in and 200 out, 4 million calls a month', or to price one named model across every " +
      "use-case profile. To compare 2-4 named models like for like at a preset volume, use " +
      "compare-models-side-by-side instead. " +
      "Provide a model name to get detailed cost breakdowns, or compare costs across all use case presets. " +
      "Each figure comes twice: list price, and the optimized price achievable with prompt caching and the batch API. " +
      "The presets carry their own cache-hit and batch assumptions; a custom token shape carries none " +
      "unless cacheHitRate and/or batchEligible are passed with it, and each cost entry states which " +
      "applied in `optimizationBasis`. " +
      "Cost figures are final as returned: rounded server-side and dated by `provenance`, with the " +
      "lever behind each saving, or the reason there is none, named in the text.",
    inputSchema: {
      modelName: z.string().optional().describe("Model name, e.g. 'GPT-4o'. A partial name matches up to 5 models and ALL of them are costed. If omitted, the first 8 catalogue entries are used — that is catalogue order, not a quality ranking."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k). Default: every preset."),
      customInputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom input tokens per request. Must be supplied TOGETHER with customOutputTokens — either alone is ignored and the preset is used. A custom shape assumes no cacheable prefix and no batch eligibility unless cacheHitRate / batchEligible say otherwise, so without them its optimized cost equals its list cost."),
      customOutputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom output tokens per request. Must be supplied TOGETHER with customInputTokens — either alone is ignored and the preset is used."),
      cacheHitRate: z.number().min(0).max(1).optional().describe("Share of input tokens served from the prompt cache, 0 to 1: for example 0.6 for a stable system prompt and tool definitions re-sent on every call. Only valid with customInputTokens and customOutputTokens; the presets carry their own and cannot be overridden. Omitting it means no caching is assumed, not that none is achievable."),
      batchEligible: z.boolean().optional().describe("Whether this workload is asynchronous and can go through the batch API. Only valid with customInputTokens and customOutputTokens; the presets carry their own. Omitting it means no batch discount is assumed, not that the workload is ineligible."),
      monthlyVolume: z.number().int().min(1).max(1_000_000_000).optional().describe("Exact monthly request count, any integer (default 100,000). This tool does not take the 10k/100k/1m presets the other cost tools use."),
    },
    outputSchema: outputSchema(estimateCostOutputSchema),
  },
  async ({ modelName, useCasePreset, customInputTokens, customOutputTokens, cacheHitRate, batchEligible, monthlyVolume }) => {
    const volume = monthlyVolume || 100_000;
    const emptyOutput = { modelCosts: [], volume, source: "error", eloAsOf: "" };

    const customTokens = customInputTokens !== undefined && customOutputTokens !== undefined;
    const leversSupplied = cacheHitRate !== undefined || batchEligible !== undefined;

    // The two levers describe a *custom* workload. Each preset already carries
    // its own cache-hit rate and batch eligibility, and one override would
    // rewrite all eight rows from a single number. Refusing is louder than
    // ignoring, and a silently ignored input is exactly what these two
    // arguments exist to remove.
    if (leversSupplied && !customTokens) {
      const message =
        "cacheHitRate and batchEligible describe a custom workload, so they need both " +
        "customInputTokens and customOutputTokens alongside them. The use-case presets carry " +
        "their own cache-hit and batch assumptions and cannot be overridden.";
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }

    try {
      const { models: allModels, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      // Find matching models
      let targetModels: LLMModel[];
      if (modelName) {
        targetModels = matchModels(allModels, modelName, 5);
        if (targetModels.length === 0) {
          return {
            structuredContent: {
              ...emptyOutput,
              source,
              eloAsOf,
              dataAsOf,
              provenance,
              error: `No models found matching "${modelName}".`,
            },
            content: [{ type: "text", text: `No models found matching "${modelName}".` }],
            isError: true,
          };
        }
      } else {
        targetModels = allModels.slice(0, 8);
      }

      // Calculate costs for each use case (or custom)
      type CostEntry = {
        useCase: string;
        inputTokens: number;
        outputTokens: number;
        perRequest: number;
        monthly: number;
        perRequestOptimized: number;
        monthlyOptimized: number;
        savingsPct: number;
        cacheHitRate: number;
        optimizationBasis: OptimizationBasis;
      } & OptimizationLevers;

      const entry = (
        m: LLMModel,
        useCase: string,
        profile: UseCaseProfile,
        basis: OptimizationBasis,
      ): CostEntry => {
        const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
        const optimized = optimizedUseCaseCost(m, profile);
        return {
          useCase,
          inputTokens: profile.inputTokens,
          outputTokens: profile.outputTokens,
          perRequest: cost,
          monthly: cost * volume,
          perRequestOptimized: optimized,
          monthlyOptimized: optimized * volume,
          savingsPct: savingsPct(cost, optimized),
          ...optimizationLevers(m, profile),
          cacheHitRate: profile.cacheHitRate,
          optimizationBasis: basis,
        };
      };

      const modelCosts: { model: LLMModel; costs: CostEntry[] }[] = targetModels.map(m => {
        const costs: CostEntry[] = [];

        if (customTokens) {
          // A custom shape carries no discount assumptions of its own, so take
          // the caller's when they gave any and assume nothing otherwise.
          // Defaulting to some average cache-hit rate would invent a fact about
          // their workload; optimizationBasis records which of the two it was.
          const profile: UseCaseProfile = {
            label: "Custom", shortLabel: "Custom",
            inputTokens: customInputTokens!, outputTokens: customOutputTokens!,
            cacheHitRate: cacheHitRate ?? 0,
            batchEligible: batchEligible ?? false,
          };
          costs.push(entry(m, "Custom", profile, leversSupplied ? "caller-supplied" : "none-supplied"));
        } else if (useCasePreset) {
          const profile = USE_CASE_PROFILES[useCasePreset];
          costs.push(entry(m, profile.label, profile, "preset"));
        } else {
          for (const key of USE_CASE_KEYS) {
            const profile = USE_CASE_PROFILES[key];
            costs.push(entry(m, profile.label, profile, "preset"));
          }
        }

        return { model: m, costs };
      });

      // Asked for but not applied. Naming only what was applied would let a
      // caller who requested both levers read a one-lever discount as the full
      // answer.
      const notApplied = (c: CostEntry): string => {
        const missing = [
          c.cacheEligible && !c.cacheApplied ? "caching" : "",
          c.batchEligible && !c.batchApplied ? "the batch API" : "",
        ].filter(Boolean);
        return missing.length > 0
          ? `; ${missing.join(" and ")} not applied: no published rate that lowers the cost`
          : "";
      };

      // Build text summary
      const lines = modelCosts.map(({ model: m, costs }) => {
        const costLines = costs.map(c =>
          `  ${c.useCase}: ${formatMicroCost(c.perRequest)}/req → ${formatMonthlyBudget(c.monthly)}/mo ` +
          `(${c.inputTokens} in + ${c.outputTokens} out tokens)
` +
          `    optimized: ${formatMicroCost(c.perRequestOptimized)}/req → ${formatMonthlyBudget(c.monthlyOptimized)}/mo` +
          (c.savingsPct > 0
            ? ` — save ${c.savingsPct}% with ${leverSummary(c)}${notApplied(c)}`
            : c.optimizationBasis === "none-supplied"
            ? ` — ${NO_ASSUMPTIONS_NOTE}`
            : ` — no saving available (${leverSummary(c)})`)
        );
        return `${m.provider} ${m.model} (Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M)${listingTags(m)}\n${costLines.join("\n")}`;
      });

      return {
        structuredContent: {
          // Costs are rounded on the way out only; `modelCosts` keeps the raw
          // floats the text summary above formats.
          modelCosts: modelCosts.map(({ model, costs }) => ({
            model,
            costs: costs.map(c => ({
              ...c,
              perRequest: roundPerRequestCost(c.perRequest),
              monthly: roundMonthlyCost(c.monthly),
              perRequestOptimized: roundPerRequestCost(c.perRequestOptimized),
              monthlyOptimized: roundMonthlyCost(c.monthlyOptimized),
            })),
          })),
          volume,
          source,
          eloAsOf,
          dataAsOf,
          provenance,
        },
        content: [
          {
            type: "text",
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n\n` +
              `Cost estimates for ${targetModels.length} model(s) at ${volume.toLocaleString()} requests/month:\n\n` +
              lines.join("\n\n") + listingLegend(targetModels, provenance.deprecationsVerifiedAt),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[estimate-llm-cost] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error estimating costs: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 3: Compare Models Side by Side ────────────────────────────

tool(
  "compare-models-side-by-side",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare Models Side by Side",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Compare 2-4 named LLM models against all 8 use-case profiles at a chosen monthly volume, " +
      "showing list and optimized cost for each. Use when the user names specific models to weigh " +
      "against each other, rather than filtering the whole catalogue. If they also supply their own " +
      "token counts, or a volume outside 10k/100k/1m, use estimate-llm-cost instead. " +
      "Every name is resolved against the catalogue and the outcome is reported in `resolution` and " +
      "in the text: a name that matched nothing, matched several models, or duplicated an earlier pick " +
      "is stated explicitly, and such a name gets no column rather than a zero cost. Prices and costs " +
      "are final as returned: rounded server-side and dated by `provenance`.",
    inputSchema: {
      models: z
        .array(z.string())
        .min(2)
        .max(4)
        .describe("2-4 model names to compare, e.g. ['GPT-4o', 'Claude Opus 5', 'Gemini 3.1 Pro']"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
    },
    outputSchema: outputSchema(sideBySideOutputSchema),
  },
  async ({ models: requested, volumePreset }) => {
    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;

    const emptyOutput = {
      models: [] as unknown[],
      resolution: [] as ResolutionEntry[],
      volume,
      volumeLabel: volumeEntry?.label ?? vol,
      source: "error",
      eloAsOf: "",
      dataAsOf: undefined as string | undefined,
      provenance: undefined as unknown,
      error: undefined as string | undefined,
    };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const { selected, resolution } = resolveNames(allModels, requested);
      const describe = (r: ResolutionEntry): string => describeResolution(r, "column");

      if (selected.length < 2) {
        const message =
          `Need at least 2 distinct models to compare, resolved ${selected.length}. ` +
          resolution.map(describe).join(" ");
        return {
          structuredContent: { ...emptyOutput, resolution, source, eloAsOf, dataAsOf, provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      // Raw floats drive the arithmetic; rounding happens once, on the way out.
      const withCosts = selected.map(m => ({
        ...m,
        useCaseCosts: USE_CASE_KEYS.map(key => {
          const profile = USE_CASE_PROFILES[key];
          const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
          const optimized = optimizedUseCaseCost(m, profile);
          return {
            key,
            label: profile.label,
            inputTokens: profile.inputTokens,
            outputTokens: profile.outputTokens,
            perRequest: cost,
            perRequestOptimized: optimized,
            monthly: cost * volume,
            monthlyOptimized: optimized * volume,
            savingsPct: savingsPct(cost, optimized),
            ...optimizationLevers(m, profile),
          };
        }),
      }));

      const header = withCosts.map(m =>
        `${m.provider} ${m.model} — In: $${m.inputPricePer1M}/1M, Out: $${m.outputPricePer1M}/1M` +
        listingTags(m) +
        (m.eloScore ? `, ELO: ${m.eloScore}` : "") +
        `, context ${m.contextWindow}`
      );

      const rows = USE_CASE_KEYS.map((key, i) => {
        const profile = USE_CASE_PROFILES[key];
        const cells = withCosts.map(m => {
          const c = m.useCaseCosts[i];
          return `  ${m.provider} ${m.model}: ${formatMicroCost(c.perRequest)}/req → ${formatMonthlyBudget(c.monthly)}/mo` +
            ` | optimized ${formatMicroCost(c.perRequestOptimized)}/req → ${formatMonthlyBudget(c.monthlyOptimized)}/mo` +
            (c.savingsPct > 0 ? ` (−${c.savingsPct}%, ${leverSummary(c)})` : ` (no saving: ${leverSummary(c)})`);
        });
        return `${profile.label} (${profile.inputTokens} in + ${profile.outputTokens} out):\n${cells.join("\n")}`;
      });

      return {
        structuredContent: {
          ...emptyOutput,
          models: withCosts.map(m => ({
            ...m,
            useCaseCosts: m.useCaseCosts.map(c => ({
              ...c,
              perRequest: roundPerRequestCost(c.perRequest),
              perRequestOptimized: roundPerRequestCost(c.perRequestOptimized),
              monthly: roundMonthlyCost(c.monthly),
              monthlyOptimized: roundMonthlyCost(c.monthlyOptimized),
            })),
          })),
          resolution,
          source,
          eloAsOf,
          dataAsOf,
          provenance,
        },
        content: [
          {
            type: "text",
            // The notice leads: a caller told to report prices exactly as
            // returned must see "unverified" before it sees the prices.
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n` +
              `Side-by-side comparison of ${withCosts.length} models at ${volume.toLocaleString()} requests/month.\n\n` +
              `Name resolution:\n${resolution.map(r => `  ${describe(r)}`).join("\n")}\n\n` +
              `${header.join("\n")}${listingLegend(withCosts, provenance.deprecationsVerifiedAt)}\n\n${rows.join("\n\n")}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-models-side-by-side] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error comparing models: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 4: Recommend an LLM Model ─────────────────────────────────

tool(
  "recommend-llm-model",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Recommend an LLM Model",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Pick a model. Returns a ranked top 3 for one workload under optional constraints, each with a " +
      "per-constraint satisfied/violated breakdown as the evidence. Use this when the user wants an " +
      "ANSWER rather than a table — 'what should I use for support tickets under $500 a month'. To " +
      "browse or filter the whole catalogue instead, use compare-llm-models. Constraints: " +
      "(monthly budget, minimum ELO, required capability, self-hostability). " +
      "Returns a top 3 as structured facts — efficiency rank, ELO, list and optimized cost, " +
      "FinOps flag, volatility, and a per-constraint satisfied/violated breakdown. " +
      "When nothing satisfies every constraint the query is reported as over-constrained, " +
      "`recommendations` is empty, and the nearest misses are returned in `nearMisses` instead, each " +
      "carrying the constraint it failed and flagged as a miss in the text. A model whose maker has " +
      "announced its retirement is never recommended: it is left out, counted in `retiredExcludedCount`, " +
      "and the ones that would have ranked are named in `retiredNotRecommended` with the notice. The " +
      "ranking is computed server-side and is final.",
    inputSchema: {
      useCasePreset: z.enum(USE_CASE_KEYS).describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k)."),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      maxMonthlyBudget: z.number().positive().optional().describe("Maximum monthly budget in USD at the given volume. Tested against the LIST-price monthly cost, not the caching/batch-optimized cost."),
      minElo: z.number().positive().optional().describe("Minimum Chatbot Arena ELO score. Typical range 1000-1500; ~1400 is roughly frontier-class. Models with no ELO score never satisfy this."),
      requiredCapability: z.string().optional().describe(`Capability the model must have: ${LLM_CAPABILITIES.join(", ")}. There is no Code capability: for coding, pass useCasePreset codingTask.`),
      openness: z
        .enum(OPENNESS_VALUES as [string, ...string[]])
        .optional()
        .describe("Require a self-hostability bucket, derived from the licence: Open source, Open weights, Proprietary, Unknown"),
    },
    outputSchema: outputSchema(recommendOutputSchema),
  },
  async ({ useCasePreset, volumePreset, maxMonthlyBudget, minElo, requiredCapability, openness }) => {
    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;
    const ucKey = useCasePreset as UseCaseKey;

    const emptyOutput = {
      recommendations: [] as unknown[],
      nearMisses: [] as unknown[],
      retiredExcludedCount: 0,
      retiredNotRecommended: [] as unknown[],
      overConstrained: false,
      useCaseLabel: USE_CASE_PROFILES[ucKey].label,
      volumeLabel: volumeEntry?.label ?? vol,
      volume,
      candidateCount: 0,
      rankedCount: 0,
      catalogSize: 0,
      roiCalculatorUrl: roiCalculatorUrl({ useCase: ucKey, volume: vol }),
      source: "error",
      eloAsOf: "",
      dataAsOf: undefined as string | undefined,
      provenance: undefined as unknown,
      error: undefined as string | undefined,
    };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const enriched = enrichModels(allModels, vol, ucKey);

      // Only models the value score could rank are candidates: an unscored model
      // has no ELO, so there is nothing to recommend it on.
      const ranked = enriched
        .filter(m => m.efficiencyScore !== null)
        .sort((a, b) => b.efficiencyScore! - a.efficiencyScore! || a.optimizedMonthlyBudget - b.optimizedMonthlyBudget);
      const efficiencyRank = new Map(ranked.map((m, i) => [modelKey(m), i + 1]));

      const checks = (m: EnrichedLLMModel): ConstraintCheck[] => {
        const out: ConstraintCheck[] = [];
        if (maxMonthlyBudget !== undefined) {
          out.push({
            constraint: "maxMonthlyBudget",
            required: `≤ ${formatMonthlyBudget(maxMonthlyBudget)}/mo`,
            actual: `${formatMonthlyBudget(m.monthlyBudget)}/mo list`,
            satisfied: m.monthlyBudget <= maxMonthlyBudget,
          });
        }
        if (minElo !== undefined) {
          out.push({
            constraint: "minElo",
            required: `≥ ${minElo}`,
            actual: m.eloScore !== undefined ? String(m.eloScore) : "no ELO score",
            satisfied: m.eloScore !== undefined && m.eloScore >= minElo,
          });
        }
        if (requiredCapability) {
          out.push({
            constraint: "requiredCapability",
            required: requiredCapability,
            actual: m.capabilities.join(", ") || "none listed",
            satisfied: m.capabilities.some(c => c.toLowerCase() === requiredCapability.toLowerCase()),
          });
        }
        if (openness) {
          // Openness is its own axis, derived from the licence in openness.ts —
          // not a price tier. Asking for "Open weights" must not also constrain
          // what the model costs.
          out.push({
            constraint: "openness",
            required: openness,
            actual: m.openness,
            satisfied: m.openness === openness,
          });
        }
        return out;
      };

      // How far a model is from the numeric constraints, for ordering near
      // misses: a model $17/mo over a $1 budget is more use to the caller than
      // one $125/mo over, even though both violate exactly one constraint.
      // Categorical misses have no distance, so they sit behind any numeric one.
      const shortfall = (m: EnrichedLLMModel): number => {
        let total = 0;
        if (maxMonthlyBudget !== undefined && m.monthlyBudget > maxMonthlyBudget) {
          total += Math.log10(m.monthlyBudget / maxMonthlyBudget);
        }
        if (minElo !== undefined) {
          if (m.eloScore === undefined) total += CATEGORICAL_SHORTFALL;
          else if (m.eloScore < minElo) total += (minElo - m.eloScore) / 100;
        }
        // A categorical miss has no natural distance, so it gets a flat charge
        // big enough to sit behind any numeric near-miss — which is what the
        // comment above always claimed and the code did not do. Charging 0
        // sorted categorical misses *first*: asking for a cheap model with
        // Vision returned a model with no Vision at all, ranked above a Vision
        // model $46/mo over budget.
        if (requiredCapability && !m.capabilities.some(c => c.toLowerCase() === requiredCapability.toLowerCase())) {
          total += CATEGORICAL_SHORTFALL;
        }
        if (openness && m.openness !== openness) {
          total += CATEGORICAL_SHORTFALL;
        }
        return total;
      };

      // A recommendation is a model to start on, so a model whose maker has
      // announced its retirement is set aside here: after the scoring, which
      // stays over the whole catalogue as on the site, and before the picks.
      // It is counted and, where it would have ranked, named: left out is not
      // the same as hidden. No row carries a notice on tiers 2 and 3, so
      // nothing is set aside there and the notice that leads the text says why.
      const evaluatedAll = ranked.map(m => ({ m, constraints: checks(m), shortfall: shortfall(m) }));
      const evaluated = evaluatedAll.filter(e => !e.m.deprecation);
      const retired = evaluatedAll.filter(e => e.m.deprecation);
      const passing = evaluated.filter(e => e.constraints.every(c => c.satisfied));

      // Over-constrained: rather than an empty list, return the models that came
      // closest, each carrying the constraint it failed.
      // "Over-constrained" has to mean the constraints did the excluding. With no
      // constraints at all `checks()` returns [] and every model passes, so an
      // empty `passing` means nothing was RANKABLE — a different failure with a
      // different remedy. Reporting it as over-constraint sent the reader
      // hunting for a constraint to relax that they never set.
      const constraintsSet =
        maxMonthlyBudget !== undefined || minElo !== undefined || !!requiredCapability || !!openness;
      const nothingRankable = ranked.length === 0;
      const overConstrained = constraintsSet && passing.length === 0 && !nothingRankable;
      const shortlist = overConstrained
        ? [...evaluated].sort(
            (a, b) =>
              a.constraints.filter(c => !c.satisfied).length - b.constraints.filter(c => !c.satisfied).length ||
              a.shortfall - b.shortfall ||
              (b.m.efficiencyScore ?? 0) - (a.m.efficiencyScore ?? 0),
          ).slice(0, 3)
        : passing.slice(0, 3);

      const top = shortlist[0];
      const build = (e: (typeof shortlist)[number], i: number): Recommendation => ({
        rank: i + 1,
        provider: e.m.provider,
        model: e.m.model,
        category: e.m.category,
        openness: e.m.openness,
        contextWindow: e.m.contextWindow,
        capabilities: e.m.capabilities,
        license: e.m.license,
        eloScore: e.m.eloScore ?? null,
        efficiencyScore: e.m.efficiencyScore,
        efficiencyRank: efficiencyRank.get(modelKey(e.m)) ?? null,
        rankedOutOf: ranked.length,
        perRequest: roundPerRequestCost(e.m.useCaseCost),
        perRequestOptimized: roundPerRequestCost(e.m.optimizedUseCaseCost),
        monthlyBudget: roundMonthlyCost(e.m.monthlyBudget),
        monthlyOptimizedBudget: roundMonthlyCost(e.m.optimizedMonthlyBudget),
        savingsPct: savingsPct(e.m.monthlyBudget, e.m.optimizedMonthlyBudget),
        isFinOpsFriendly: e.m.isFinOpsFriendly,
        volatilityRisk: e.m.volatilityRisk,
        costDeltaVsTopPct:
          top && top.m.monthlyBudget > 0
            ? Math.round((e.m.monthlyBudget / top.m.monthlyBudget - 1) * 100)
            : 0,
        constraints: e.constraints,
        // A pick resting on a promotional price is the case where the reader
        // most needs the label: the budget it was chosen on will rise.
        outlierListing: e.m.outlierListing,
        promotionalListing: e.m.promotionalListing,
        deprecation: e.m.deprecation,
      });

      const results = shortlist.map(build);
      const useCaseLabel = USE_CASE_PROFILES[ucKey].label;
      const volumeLabel = volumeEntry?.label ?? vol;

      // The retired models that met every constraint and sat above the last
      // pick: the ones a reader could wonder about. With fewer than three
      // picks, any of them would have made the list.
      const rankOf = (e: (typeof evaluatedAll)[number]): number =>
        efficiencyRank.get(modelKey(e.m)) ?? Number.POSITIVE_INFINITY;
      const lastPickRank = shortlist.length === 3 ? rankOf(shortlist[2]) : Number.POSITIVE_INFINITY;
      const retiredResults = overConstrained
        ? []
        : retired
            .filter(e => e.constraints.every(c => c.satisfied) && rankOf(e) < lastPickRank)
            .slice(0, 3)
            .map(build);
      const retiredNote =
        retired.length === 0
          ? ""
          : `\n\nLeft out: ${retired.length} ranked ${retired.length === 1 ? "model" : "models"} whose maker has ` +
            `announced ${retired.length === 1 ? "its" : "their"} retirement` +
            (provenance.deprecationsVerifiedAt ? ` (notices last verified on ${provenance.deprecationsVerifiedAt})` : "") +
            `. A recommendation is a model to start on.` +
            (retiredResults.length > 0
              ? ` Would have ranked here otherwise:\n` +
                retiredResults
                  .map(r =>
                    `  - ${r.provider} ${r.model}${listingTags(r)} — efficiency ${r.efficiencyScore ?? "n/a"} ` +
                    `(rank ${r.efficiencyRank ?? "n/a"} of ${r.rankedOutOf}), ${formatMonthlyBudget(r.monthlyBudget)}/mo list`,
                  )
                  .join("\n")
              : "");

      const lines = results.map(r =>
        `${r.rank}. ${r.provider} ${r.model}${listingTags(r)} — ELO ${r.eloScore ?? "n/a"}, ` +
        `efficiency ${r.efficiencyScore ?? "n/a"} (rank ${r.efficiencyRank ?? "n/a"} of ${r.rankedOutOf}), ` +
        `${formatMicroCost(r.perRequest)}/req list → ${formatMonthlyBudget(r.monthlyBudget)}/mo, ` +
        `${formatMicroCost(r.perRequestOptimized)}/req optimized → ${formatMonthlyBudget(r.monthlyOptimizedBudget)}/mo (−${r.savingsPct}%), ` +
        `FinOps Friendly: ${r.isFinOpsFriendly ? "yes" : "no"}, volatility: ${r.volatilityRisk}, ` +
        `monthly cost vs #1: ${r.costDeltaVsTopPct >= 0 ? "+" : ""}${r.costDeltaVsTopPct}%` +
        (r.constraints.length > 0
          ? `. Constraints: ${r.constraints.map(c => `${c.constraint} ${c.required} vs ${c.actual} — ${c.satisfied ? "met" : "MISSED"}`).join("; ")}`
          : "")
      );

      const preamble = nothingRankable
        ? `No model in the catalogue could be ranked for ${useCaseLabel}: the value score needs an Arena ELO ` +
          `score and none of the ${allModels.length} catalogue entries carries one. That is a data problem, ` +
          `not an over-constrained query${constraintsSet ? " — relaxing the constraints will not help" : ""}.`
        : overConstrained
        ? `No model satisfies every constraint. Closest ${results.length} models for ${useCaseLabel} at ${volumeLabel} requests/month ` +
          `(${ranked.length} ranked of ${allModels.length} catalogue entries), each with the constraint it failed:`
        : `Top ${results.length} models for ${useCaseLabel} at ${volumeLabel} requests/month ` +
          `(${passing.length} of ${evaluated.length} ranked models satisfy all constraints; ${allModels.length} catalogue entries):`;

      const roiUrl = roiCalculatorUrl({
        useCase: ucKey,
        volume: vol,
        model: top ? { provider: top.m.provider, model: top.m.model } : undefined,
      });

      return {
        structuredContent: {
          ...emptyOutput,
          recommendations: overConstrained ? [] : results,
          nearMisses: overConstrained ? results : [],
          retiredExcludedCount: retired.length,
          retiredNotRecommended: retiredResults,
          overConstrained,
          candidateCount: passing.length,
          rankedCount: ranked.length,
          catalogSize: allModels.length,
          roiCalculatorUrl: roiUrl,
          source,
          eloAsOf,
          dataAsOf,
          provenance,
        },
        content: [
          {
            type: "text",
            // The notice leads: a recommendation built on uncorrected prices is
            // exactly the case where the reader must see the caveat first.
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n` +
              `${preamble}\n\n${lines.join("\n")}${retiredNote}` +
              `${listingLegend([...results, ...retiredResults], provenance.deprecationsVerifiedAt)}\n\n` +
              `ROI calculator for this scenario: ${roiUrl}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[recommend-llm-model] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error recommending a model: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 5: Compare Compute Pricing ────────────────────────────────

tool(
  "compare-compute-pricing",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare Cloud Compute Pricing",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Compare cloud compute instance pricing across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba. " +
      "Filter by region, provider, vCPUs, memory, category, processor, or use case. " +
      "Use this for 'the cheapest 8 vCPU / 32 GiB instance in Europe', and for what a commitment saves: " +
      "each row gives the Linux list price in USD per hour on demand, on spot, and under a 1-year and " +
      "3-year commitment (savings plan, Google CUD, reservation) as an effective hourly rate, each with " +
      "its saving against that row's on-demand rate. A row with no commitment rate says so. " +
      "Not every price column is live: `provenance.priceTypes` says which of each provider's price " +
      "columns come from a live API, which are static constants, and which are unavailable, and " +
      "`provenance.staticPriceColumns` lists the non-live ones outright; a savings-plan or reserved " +
      "rate that appears there is a static estimate, not a live quote. Prices are returned as the " +
      "catalogue serves them and dated by `provenance`.",
    inputSchema: {
      region: z.enum(PRICING_REGIONS).optional().describe(`Pricing region: ${PRICING_REGIONS.join(", ")}. Default: ${DEFAULT_PRICING_REGION}`),
      provider: z.string().optional().describe("Cloud provider. Must be one of these exactly (case-insensitive): AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba. Any other string returns zero matches rather than an error."),
      category: z.string().optional().describe("Instance category. Must be one of these exactly (case-insensitive): General Purpose, Compute Optimized, Memory Optimized, Storage Optimized, GPU / Accelerated, Burstable. Any other string returns zero matches rather than an error."),
      minVCPUs: z.number().optional().describe("Minimum number of vCPUs"),
      maxVCPUs: z.number().optional().describe("Maximum number of vCPUs"),
      minMemory: z.number().optional().describe("Minimum memory in GiB"),
      maxMemory: z.number().optional().describe("Maximum memory in GiB"),
      processor: z.string().optional().describe(`Processor. Matched by exact equality (case-insensitive), so a partial value like 'H100' returns nothing. Known values: ${ALL_PROCESSORS.join(", ")}. 'NVIDIA Other' is every NVIDIA GPU without a label of its own (L40S, H200, B200, RTX and older parts).`),
      useCase: z.string().optional().describe("Use case. Must be one of these exactly (case-insensitive): Web App, Database, HPC, ML & AI, Dev/Test, Big Data. Any other string returns zero matches rather than an error."),
      sortBy: z.enum(["price", "vcpus", "memory", "pricePerVCPU"]).optional().describe("Sort by: price, vcpus, memory, pricePerVCPU. Default: price"),
      limit: z.number().min(1).max(50).optional().describe("Max instances to return (default: 20)"),
    },
    outputSchema: outputSchema(computePricingOutputSchema),
  },
  async ({ region, provider, category, minVCPUs, maxVCPUs, minMemory, maxMemory, processor, useCase, sortBy, limit }) => {
    // Matches the other two tools: the shape returned when nothing upstream was
    // reached, so there is no provenance to report.
    const emptyOutput = { instances: [], matchingCount: 0, catalogSize: 0, source: "error" };

    try {
      // The whole regional catalogue, filtered here rather than upstream: the
      // site caches per query string, so narrowing the URL would trade a warm
      // edge hit for a cold rebuild — and "the 20 cheapest matches" is only
      // correct when computed over everything.
      const { instances: catalogue, source, provenance } = await fetchComputeInstances(
        (region as PricingRegion | undefined) ?? DEFAULT_PRICING_REGION,
      );
      const enriched = servableCatalogue(catalogue);

      const filtered = enriched.filter(inst => {
        if (provider && inst.provider.toLowerCase() !== provider.toLowerCase()) return false;
        if (category && inst.category.toLowerCase() !== category.toLowerCase()) return false;
        if (minVCPUs !== undefined && inst.vCPUs < minVCPUs) return false;
        if (maxVCPUs !== undefined && inst.vCPUs > maxVCPUs) return false;
        if (minMemory !== undefined && inst.memory < minMemory) return false;
        if (maxMemory !== undefined && inst.memory > maxMemory) return false;
        if (processor && inst.processor.toLowerCase() !== processor.toLowerCase()) return false;
        if (useCase && !inst.useCases.some(uc => uc.toLowerCase() === useCase.toLowerCase())) return false;
        if (inst.onDemandHourly === null) return false;
        return true;
      });

      // Sort
      const sort = sortBy || "price";
      filtered.sort((a, b) => {
        switch (sort) {
          case "price": return (a.onDemandHourly || 0) - (b.onDemandHourly || 0);
          case "vcpus": return a.vCPUs - b.vCPUs;
          case "memory": return a.memory - b.memory;
          case "pricePerVCPU": return ((a.onDemandHourly || 0) / a.vCPUs) - ((b.onDemandHourly || 0) / b.vCPUs);
          default: return 0;
        }
      });

      const maxCount = limit || 20;
      const results = filtered.slice(0, maxCount);

      // On tier 2 the catalogue is a 137-row subset with no region dimension,
      // so a narrow query ("cheapest AWS GPU instances") can come back empty
      // purely as an artefact of the fallback. The provenance notice says so in
      // prose, which a consumer reading `instances` alone never sees — and an
      // empty array is exactly the case where it most needs saying.
      const unapplied = provenance.unappliedFilters ?? [];
      // Tier 1 has the same trap when the site could not read a provider live:
      // it serves that provider's few static rows under HTTP 200, and "Azure,
      // 64 vCPUs or more" then matches nothing out of 18 rows where the live
      // catalogue holds hundreds.
      const incomplete = filtered.length === 0 ? incompleteCatalogueCaveat(provenance, provider) : null;
      const subsetCaveat =
        provenance.tier === 2 && filtered.length === 0
          ? `\nNOTE: this is the ${enriched.length}-row static snapshot, not the ~5,800-instance ` +
            `live catalogue, so "no match" here does not mean no such instance exists.` +
            (unapplied.length ? ` Filters accepted but NOT applied: ${unapplied.join(", ")}.` : "")
          : incomplete
            ? `\nNOTE: ${incomplete}`
            : "";

      // Build text summary. Every rate the row carries is printed, with its
      // saving against on-demand: the commitment rates used to exist in
      // structuredContent only, where the reader of the text never saw them.
      const lines = results.map((inst, i) =>
        `${i + 1}. ${inst.provider} ${inst.instanceType} — ` +
        `${inst.vCPUs} vCPUs, ${inst.memory} GiB, ${inst.processor}, ` +
        describeRates(inst, provenance.priceTypes) +
        ` [${inst.category}]`
      );

      return {
        structuredContent: {
          instances: results.map(inst => ({ ...inst, ...rateSavings(inst) })),
          matchingCount: filtered.length,
          catalogSize: enriched.length,
          source,
          provenance,
        },
        content: [
          {
            type: "text",
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n` +
              (provenance.unavailablePriceColumns.length
                ? `Unavailable upstream (reported as null): ${provenance.unavailablePriceColumns.join(", ")}.\n`
                : "") +
              (provenance.upstreamErrors?.length
                ? `Reported by the site on this read: ${provenance.upstreamErrors.join("; ")}.\n`
                : "") +
              `${filtered.length} of ${enriched.length} compute instances match (showing ${results.length}). ` +
              `Linux list prices in USD per hour. Spot and commitment rates show their saving against the ` +
              `same row's on-demand rate; commitment rates are effective hourly, no upfront where the ` +
              `provider offers it (CUD is Google's committed use discount).${subsetCaveat}\n\n` +
              lines.join("\n") +
              ratesLegend(results, provenance.priceTypes, provenance.awsSavingsPlansAsOf),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-compute-pricing] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error comparing compute pricing: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 6: Compare Model Hosts ────────────────────────────────────

/** Undefined-tolerant variant, for the standard rate behind a promotion. */
const roundPricePer1MOrUndefined = (price: number | undefined): number | undefined =>
  price === undefined ? undefined : roundPricePer1M(price);

/** How many hosts of one model the text prints. Beyond it the cheapest are
 *  shown and the rest counted: four models with thirty hosts each would bury
 *  the answer. `structuredContent` always carries all of them. */
const MAX_HOST_LINES = 12;

tool(
  "compare-model-hosts",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare Model Hosts",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Who sells a model, and at what price. Most models are sold by several hosts (the model maker, a " +
      "cloud platform such as Amazon Bedrock, Azure or Vertex, or an independent host) at different rates, " +
      "and every other tool here quotes ONE of them. For 1-4 named models this returns how many hosts sell " +
      "each, the cheapest, the dearest, the model maker's own rate, the spread between them, any promotional " +
      "listing, and what a workload costs per request and per month at each. Use it for 'where is Llama 3.3 " +
      "70B cheapest', 'is the price you quoted the maker's own', 'how much does the choice of host matter " +
      "for this model'. To cost a workload at the quoted price with caching and batch, use estimate-llm-cost. " +
      "Read the caveats it returns: the cheapest host may serve a quantized build, which is not the same " +
      "product, or a promotional rate that ends. It also lists every host with its rate, cheapest first, " +
      "the platforms the model is listed on (Direct API, AWS Bedrock, Azure AI Foundry, Google Vertex, " +
      "OpenRouter: a hand-kept estimate for the major models) and the AWS regions where Amazon Bedrock lists " +
      "it. `hostList.available` says whether that full list was read: without it only the cheapest, the " +
      "dearest, the maker's own and promotional listings are known, and the text says so. A missing platform " +
      "or region is not known, never 'not sold there'. Per-host prices are list prices read nightly and dated " +
      "by `provenance.hostPricingAsOf`, and a model with no host data says so rather than reading as sold by " +
      "one host.",
    inputSchema: {
      models: z
        .array(z.string())
        .min(1)
        .max(4)
        .describe("1-4 model names, e.g. ['Llama 3.3 70B'] or ['Claude Sonnet 5', 'DeepSeek V4']"),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload the costs are computed for, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600), callSummary (2k / 700), agentWorkflow (6k / 3k). Default: supportTicket"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
    },
    outputSchema: outputSchema(modelHostsOutputSchema),
  },
  async ({ models: requested, useCasePreset, volumePreset }) => {
    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;
    const volumeLabel = volumeEntry?.label ?? vol;
    const profile = USE_CASE_PROFILES[useCasePreset || "supportTicket"];

    const emptyOutput = {
      models: [] as unknown[],
      resolution: [] as ResolutionEntry[],
      useCaseLabel: profile.label,
      volume,
      volumeLabel,
      source: "error",
      eloAsOf: "",
    };

    try {
      const { models: allModels, hostPricing, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const { selected, resolution } = resolveNames(allModels, requested);
      const describe = (r: ResolutionEntry): string => describeResolution(r, "entry");

      if (selected.length === 0) {
        const message = `No requested name matched a model. ${resolution.map(describe).join(" ")}`;
        return {
          structuredContent: { ...emptyOutput, resolution, source, eloAsOf, dataAsOf, provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      // Raw floats drive the arithmetic; rounding happens once, on the way out.
      const costOf = (input: number, output: number): number => useCaseCost(input, output, profile);
      const costed = (offer: HostOffer, quotedCost: number) => {
        const cost = costOf(offer.input, offer.output);
        return { offer, cost, pct: vsQuotedPct(cost, quotedCost) };
      };
      type Costed = ReturnType<typeof costed>;

      // The full host list is a second request, to the site only, asked by
      // upstream id for the models that have a host summary. It is never worth
      // failing the answer for: when it cannot be read, the summary on the rows
      // still stands and the text says the hosts in between are not shown.
      const hostIds = [
        ...new Set(
          selected
            .map(m => hostPricing.get(hostPricingKey(m))?.openRouterId)
            .filter((id): id is string => !!id),
        ),
      ].slice(0, MAX_MODEL_HOST_IDS);
      let hostList: ModelHostsResult | null = null;
      let hostListUnavailable: string | undefined;
      if (provenance.tier !== 1) {
        hostListUnavailable = "the catalogue came from a fallback tier, which has no per-host prices";
      } else if (hostIds.length === 0) {
        hostListUnavailable = "none of these models has per-host pricing to look up";
      } else {
        try {
          hostList = await fetchModelHosts(hostIds);
        } catch (error) {
          hostListUnavailable = describeHostListFailure(error);
          console.warn("[compare-model-hosts] full host list unavailable:", describeUpstreamFailure(error).summary);
        }
      }

      const entries = selected.map(m => {
        const entry = hostPricing.get(hostPricingKey(m));
        const summary = entry?.summary;
        const quotedCost = costOf(m.inputPricePer1M, m.outputPricePer1M);
        const quotedPair = { input: m.inputPricePer1M, output: m.outputPricePer1M };
        const maker = makerOffer(entry, quotedPair);
        const detail: ModelHostsDetail | undefined = entry?.openRouterId
          ? hostList?.byId.get(entry.openRouterId)
          : undefined;
        // Null, not empty, when the list is not known for this model.
        const offers = summary && detail?.offers ? detail.offers.map(offer => costed(offer, quotedCost)) : null;
        return {
          m,
          summary,
          quotedCost,
          maker,
          priceSource: priceProvenance(quotedPair, summary),
          cheapest: summary ? costed(summary.cheapest, quotedCost) : null,
          dearest: summary ? costed(summary.dearest, quotedCost) : null,
          vendor: maker.offer ? costed(maker.offer, quotedCost) : null,
          promotions: (summary?.promotions ?? []).map(offer => costed(offer, quotedCost)),
          offers,
          matchingHosts: offers
            ? offers.filter(c => matchesOffer(quotedPair, c.offer)).map(c => c.offer.host)
            : undefined,
          platforms: detail?.platforms ?? null,
          bedrockRegions: detail?.bedrockRegions ?? null,
          // Every host's build when the list is known, the named offers' otherwise.
          builds: offers
            ? buildsOf([...offers.map(c => c.offer), ...(summary?.promotions ?? [])])
            : declaredBuilds(summary),
        };
      });
      // True when every model that has host data also has its full list.
      const everyHost = entries.some(e => e.summary) && entries.every(e => !e.summary || e.offers !== null);

      const money = (cost: number): string => `${formatMicroCost(cost)}/req, ${formatMonthlyBudget(cost * volume)}/mo`;
      const offerLine = (c: Costed): string => {
        const delta = describeVsQuoted(c.pct);
        return `${describeOffer(c.offer)} → ${money(c.cost)}${delta ? ` (${delta})` : ""}`;
      };

      const blocks = entries.map(e => {
        const { m, summary } = e;
        const head = `${m.provider} ${m.model}${deprecationTag(m)}` + (m.eloScore ? ` (ELO ${m.eloScore})` : "");
        // Named only when the quoted price is another host's rate: with the
        // full list in hand, "another host" can be said by name.
        const matching =
          e.priceSource === "reference" && e.matchingHosts && e.matchingHosts.length > 0
            ? ` Among the hosts listed below, it is the rate of: ${e.matchingHosts.join(", ")}.`
            : "";
        const quoted =
          `  Quoted by this server: $${m.inputPricePer1M} in / $${m.outputPricePer1M} out per 1M${priceTags(m)}` +
          ` → ${money(e.quotedCost)}. ${provenanceExplanation(e.priceSource, summary)}${matching}`;
        if (!summary || !e.cheapest || !e.dearest) {
          return `${head} — no per-host pricing.\n${quoted}`;
        }

        const lines = [`${head} — sold by ${summary.hosts} ${summary.hosts === 1 ? "host" : "hosts"}.`, quoted];
        // Cheapest and dearest at one rate bound every host between them, so
        // "cheapest" and "dearest" would name two hosts for no difference.
        const oneRate = summary.hosts > 1 && matchesOffer(summary.cheapest, summary.dearest);
        if (summary.hosts === 1) {
          lines.push(`  Only host — ${offerLine(e.cheapest)}`);
        } else if (oneRate) {
          lines.push(
            `  All ${summary.hosts} hosts — one rate, to rounding (${summary.cheapest.host} and ` +
            `${summary.dearest.host} among them): ${offerLine(e.cheapest).replace(`${summary.cheapest.host}: `, "")}`,
          );
        } else {
          lines.push(`  Cheapest host — ${offerLine(e.cheapest)}`);
          lines.push(`  Dearest host — ${offerLine(e.dearest)}`);
        }

        if (e.vendor) {
          lines.push(`  Model maker's own — ${offerLine(e.vendor)}`);
        } else if (e.maker.notStandardRate && summary.vendor) {
          lines.push(
            `  Model maker's own — not quoted: the row listed under the maker's name (${describeOffer(summary.vendor)}) ` +
            `is a discount tier on this model, not its standard rate.`,
          );
        } else {
          // Absence in the listings, not a claim about the maker's business.
          lines.push(`  Model maker's own — none among these listings.`);
        }

        if (summary.hosts > 1 && !oneRate) {
          lines.push(
            summary.spread === undefined
              ? `  Spread — not computed: the cheapest listing is free.`
              : hasNoteworthySpread(summary)
                ? `  Spread — the dearest host is ${summary.spread.toFixed(1)}x the cheapest on the blended price (30% input, 70% output).`
                : `  Spread — under 10%: these hosts publish the same rate, to rounding.`,
          );
        }
        if (e.promotions.length > 0) {
          lines.push(`  Promotional listings — ${e.promotions.map(c => describeOffer(c.offer)).join("; ")}. A promotion can end without notice.`);
        }
        if (e.offers) {
          const shown = e.offers.slice(0, MAX_HOST_LINES);
          // The site's order, which is by blended price and not by the cost
          // of this workload: said here so that costs out of order below do
          // not read as a sorting fault.
          lines.push(`  Every host (${e.offers.length}), cheapest first on the blended price:`);
          shown.forEach((c, i) => lines.push(`    ${i + 1}. ${offerLine(c)}`));
          const rest = e.offers.length - shown.length;
          if (rest > 0) {
            lines.push(
              `    … and ${rest} dearer ${rest === 1 ? "host" : "hosts"}, up to the dearest named above. ` +
              `All ${e.offers.length} are in structuredContent (models[].offers).`,
            );
          }
        }
        if (e.builds.length > 1) {
          lines.push(
            `  Not like-for-like — these listings declare different builds (${e.builds.join(", ")}): a quantized ` +
            `build is not the same product as the full-precision one, and the ELO above was not measured on it.`,
          );
        } else if (e.builds.length === 1) {
          lines.push(`  Build — the listings above that declare one serve ${e.builds[0]}.`);
        }
        if (e.platforms) {
          lines.push(
            `  Platforms — ${e.platforms.names.join(", ")} (the site's hand-kept list, ${e.platforms.provenance}).`,
          );
        }
        if (e.bedrockRegions) {
          lines.push(`  Amazon Bedrock regions (${e.bedrockRegions.length}) — ${e.bedrockRegions.join(", ")}.`);
        }
        return lines.join("\n");
      });

      const offerOut = (c: Costed) => {
        const standard = standardRateOf(c.offer);
        return {
          host: c.offer.host,
          inputPricePer1M: c.offer.input,
          outputPricePer1M: c.offer.output,
          quantization: c.offer.quantization,
          discount: c.offer.discount,
          standardInputPricePer1M: roundPricePer1MOrUndefined(standard?.input),
          standardOutputPricePer1M: roundPricePer1MOrUndefined(standard?.output),
          perRequest: roundPerRequestCost(c.cost),
          monthly: roundMonthlyCost(c.cost * volume),
          vsQuotedPct: c.pct,
        };
      };

      const known = entries.filter(e => e.summary).length;
      const noHostData =
        provenance.tier !== 1
          ? `\nPer-host prices are served by optimtoken.optimnow.io only. This response came from a fallback ` +
            `tier, so none is available: every model below reads "no per-host pricing".`
          : known < entries.length
            ? `\n${entries.length - known} of ${entries.length} models have no per-host pricing: a listing newer ` +
              `than the last nightly read. That is unknown, not "sold by one host".`
            : "";

      // Said only where the list was expected and did not come: on a fallback
      // tier `noHostData` above already covers it.
      const hostListNote =
        provenance.tier === 1 && hostList === null && known > 0
          ? `\nThe full list of hosts could not be read (${hostListUnavailable}): only the cheapest, the dearest, ` +
            `the model maker's own and promotional listings are shown below.`
          : hostList !== null && !everyHost && known > 0
            ? `\nThe full list of hosts is not on record for every model below: where no "Every host" list ` +
              `appears, only the cheapest, the dearest, the maker's own and promotional listings are known.`
            : "";

      // What a platform or a region line is, and what its absence is not.
      const availabilityNote =
        hostList === null
          ? ""
          : `\nPlatforms are the site's hand-kept list for the major models` +
            (hostList.meta.availabilityReviewedAt ? `, reviewed on ${hostList.meta.availabilityReviewedAt}` : "") +
            `: an estimate, not a live check. Amazon Bedrock regions come from AWS's own model list` +
            (hostList.meta.bedrockAvailabilityAsOf ? `, read on ${hostList.meta.bedrockAvailabilityAsOf}` : "") +
            `, in the region or through a geographic inference profile. A model with no Platforms or Bedrock ` +
            `line, and a platform or region missing from one, is not known: never "not sold there".`;

      return {
        structuredContent: {
          ...emptyOutput,
          models: entries.map(e => ({
            provider: e.m.provider,
            model: e.m.model,
            eloScore: e.m.eloScore,
            openness: opennessOf(e.m.license),
            quoted: {
              inputPricePer1M: e.m.inputPricePer1M,
              outputPricePer1M: e.m.outputPricePer1M,
              perRequest: roundPerRequestCost(e.quotedCost),
              monthly: roundMonthlyCost(e.quotedCost * volume),
              priceSource: e.priceSource,
              outlierListing: e.m.outlierListing,
              promotionalListing: e.m.promotionalListing,
              matchingHosts: e.matchingHosts,
            },
            deprecation: e.m.deprecation,
            hostCount: e.summary?.hosts ?? null,
            cheapest: e.cheapest ? offerOut(e.cheapest) : null,
            dearest: e.dearest ? offerOut(e.dearest) : null,
            vendor: e.vendor ? offerOut(e.vendor) : null,
            vendorRowNotStandardRate: e.maker.notStandardRate,
            spread: e.summary?.spread ?? null,
            noteworthySpread: hasNoteworthySpread(e.summary),
            quantizations: e.builds,
            promotions: e.promotions.map(offerOut),
            offers: e.offers ? e.offers.map(offerOut) : null,
            platforms: e.platforms,
            bedrockRegions: e.bedrockRegions,
          })),
          hostList: {
            available: hostList !== null,
            unavailableReason: hostListUnavailable,
            upstreamSchemaVersion: hostList?.meta.schemaVersion,
            hostPricingAsOf: hostList?.meta.hostPricingAsOf,
            availabilityReviewedAt: hostList?.meta.availabilityReviewedAt,
            bedrockAvailabilityAsOf: hostList?.meta.bedrockAvailabilityAsOf,
            notFound: hostList?.notFound ?? [],
          },
          resolution,
          source,
          eloAsOf,
          dataAsOf,
          provenance,
        },
        content: [
          {
            type: "text",
            // The notice leads: a caller told to report prices exactly as
            // returned must see "unverified" before it sees the prices.
            text: (provenance.notice ? `⚠️ ${provenance.notice}\n\n` : "") +
              `Data source: ${provenance.label}` +
              (provenance.upstreamTimestamp ? ` (as of ${provenance.upstreamTimestamp})` : "") + `.\n` +
              `Who sells ${entries.length === 1 ? "this model" : `these ${entries.length} models`}, and what ` +
              `${profile.label} (${profile.inputTokens} in + ${profile.outputTokens} out tokens) costs at each ` +
              `host's list price, at ${volume.toLocaleString()} requests/month.` +
              (provenance.hostPricingAsOf ? ` Per-host prices were read on ${provenance.hostPricingAsOf}.` : "") +
              `${noHostData}${hostListNote}\n\n` +
              `Name resolution:\n${resolution.map(r => `  ${describe(r)}`).join("\n")}\n\n` +
              `${blocks.join("\n\n")}${listingLegend(selected, provenance.deprecationsVerifiedAt)}\n\n` +
              hostFootnote(provenance.hostPricingAsOf, everyHost) +
              availabilityNote,
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-model-hosts] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error comparing model hosts: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 7: Estimate Self-Hosting Break-Even ───────────────────────

/** Null-tolerant variant, for a figure that exists only with a throughput. */
const roundPerRequestCostOrNull = (cost: number | null): number | null =>
  cost === null ? null : roundPerRequestCost(cost);

tool(
  "estimate-self-hosting-breakeven",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Estimate Self-Hosting Break-Even",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "API or own capacity: the monthly volume at which renting GPU instances costs the same as paying a " +
      "model's API per token. An API bill grows with every request, a rented instance costs the same " +
      "whether it is busy or idle, so below the break-even the API is cheaper and above it the fleet is. " +
      "Give a model, a workload and either an instance from the compute catalogue (instanceType) or an " +
      "hourly rate of your own (hourlyRate). The answer costs the fleet at every rate the catalogue lists " +
      "(on demand, spot, 1- and 3-year commitments) against the API at list price, at the optimized price " +
      "with caching and batch, and at the cheapest host known, and compares them at your volume. Use it " +
      "for 'at what volume does self-hosting Llama 3.3 70B on a g6e.4xlarge pay off' or 'is our 2M " +
      "requests a month enough to rent our own GPUs'. " +
      "It assumes neither a throughput nor an operations cost. Without outputTokensPerSecond each " +
      "break-even states the output tokens per second the fleet would have to sustain around the clock; " +
      "with it, the share of the fleet's capacity that volume uses, and whether it is out of reach. " +
      "Without monthlyOperationsCost the fleet figures are hardware rent only: engineer time, storage, " +
      "egress and failover are left out, and the text says so. It does not check that the instance can " +
      "hold the model, and it reports whether the model's weights are published at all. Figures are " +
      "final as returned and dated by `provenance` (API prices) and `computeProvenance` (instance rates).",
    inputSchema: {
      model: z.string().min(1).describe("Model whose API price is the baseline, e.g. 'Llama 3.3 70B'. One name; the best match is used and other matches are reported."),
      instanceType: z.string().min(1).optional().describe("Instance the model would run on, exactly as the compute catalogue names it, e.g. 'g6e.4xlarge' or 'a2-highgpu-1g'. Find one with compare-compute-pricing (category 'GPU / Accelerated'). Give this OR hourlyRate, not both."),
      provider: z.string().optional().describe("Cloud provider of instanceType, needed only when two providers use the same instance name: AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba."),
      region: z.enum(PRICING_REGIONS).optional().describe(`Pricing region of instanceType: ${PRICING_REGIONS.join(", ")}. Default: ${DEFAULT_PRICING_REGION}`),
      hourlyRate: z.number().positive().max(100_000).optional().describe("USD per hour for ONE instance, for hardware the catalogue does not list: a GPU cloud, a quoted rate, owned hardware amortised per hour. Give this OR instanceType, not both."),
      instanceCount: z.number().int().min(1).max(10_000).optional().describe("Instances in the fleet, each billed every hour of the month. Default: 1"),
      outputTokensPerSecond: z.number().positive().max(10_000_000).optional().describe("MEASURED output tokens per second ONE instance generates at full load on this workload, all concurrent requests together. Omit it when it has not been measured: the tool then states the throughput each break-even requires instead of assuming one."),
      monthlyOperationsCost: z.number().min(0).max(1_000_000_000).optional().describe("USD per month for everything the hourly rate leaves out: the engineers who run the stack, storage, egress, failover capacity. Omitted means not included, not zero, and the answer says so."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload shape, which sets tokens per request and the caching and batch assumptions: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k). Default: supportTicket. Ignored when custom token counts are given."),
      customInputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom input tokens per request. Must be supplied TOGETHER with customOutputTokens. A custom shape assumes no caching and no batch unless cacheHitRate / batchEligible say otherwise."),
      customOutputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom output tokens per request. Must be supplied TOGETHER with customInputTokens."),
      cacheHitRate: z.number().min(0).max(1).optional().describe("Share of input tokens served from the prompt cache, 0 to 1. Only valid with customInputTokens and customOutputTokens; the presets carry their own."),
      batchEligible: z.boolean().optional().describe("Whether the workload is asynchronous and can go through the batch API. Only valid with customInputTokens and customOutputTokens; the presets carry their own."),
      monthlyVolume: z.number().int().min(1).max(1_000_000_000_000).optional().describe("Requests per month the two are compared at, any integer. Default: 100,000"),
    },
    outputSchema: outputSchema(selfHostingOutputSchema),
  },
  async ({
    model: modelName, instanceType, provider, region, hourlyRate, instanceCount, outputTokensPerSecond,
    monthlyOperationsCost, useCasePreset, customInputTokens, customOutputTokens, cacheHitRate, batchEligible, monthlyVolume,
  }) => {
    const volume = monthlyVolume ?? 100_000;
    const count = instanceCount ?? 1;
    const operations = monthlyOperationsCost ?? 0;

    const customTokens = customInputTokens !== undefined && customOutputTokens !== undefined;
    const halfCustom = (customInputTokens !== undefined) !== (customOutputTokens !== undefined);
    const leversSupplied = cacheHitRate !== undefined || batchEligible !== undefined;

    // A custom shape carries the caller's caching and batch assumptions or
    // none at all; a preset carries its own. Same rule as estimate-llm-cost.
    const profile: UseCaseProfile = customTokens
      ? {
          label: "Custom", shortLabel: "Custom",
          inputTokens: customInputTokens, outputTokens: customOutputTokens,
          cacheHitRate: cacheHitRate ?? 0,
          batchEligible: batchEligible ?? false,
        }
      : USE_CASE_PROFILES[useCasePreset || "supportTicket"];
    const basis: OptimizationBasis = !customTokens ? "preset" : leversSupplied ? "caller-supplied" : "none-supplied";
    const workload = { inputTokens: profile.inputTokens, outputTokens: profile.outputTokens };

    const emptyOutput = {
      model: null,
      workload: {
        useCase: profile.label,
        inputTokens: profile.inputTokens,
        outputTokens: profile.outputTokens,
        cacheHitRate: profile.cacheHitRate,
        batchEligible: profile.batchEligible,
        optimizationBasis: basis,
        volume,
      },
      api: [] as unknown[],
      fleet: null,
      options: [] as unknown[],
      resolution: [] as ResolutionEntry[],
      source: "error",
      eloAsOf: "",
    };

    // Refused rather than guessed at: each of these would otherwise change the
    // answer without the caller knowing which reading was taken.
    const refusal = halfCustom
      ? "customInputTokens and customOutputTokens describe one workload and must be given together."
      : leversSupplied && !customTokens
        ? "cacheHitRate and batchEligible describe a custom workload, so they need both customInputTokens and " +
          "customOutputTokens alongside them. The use-case presets carry their own cache-hit and batch assumptions."
        : instanceType !== undefined && hourlyRate !== undefined
          ? "Give instanceType (a catalogue instance, costed at every rate it lists) or hourlyRate (a rate of " +
            "your own), not both: they are two different fleets."
          : instanceType === undefined && hourlyRate === undefined
            ? "Nothing to rent: give instanceType (a catalogue instance, e.g. 'g6e.4xlarge'; find one with " +
              "compare-compute-pricing, category 'GPU / Accelerated') or hourlyRate (USD per hour for one instance)."
            : null;
    if (refusal) {
      const message = refusal;
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }

    try {
      const { models: allModels, hostPricing, source, eloAsOf, dataAsOf, provenance } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const { selected, resolution } = resolveNames(allModels, [modelName]);
      const describe = (r: ResolutionEntry): string => describeResolution(r, "estimate");

      if (selected.length === 0) {
        const message = `No model matched. ${resolution.map(describe).join(" ")}`;
        return {
          structuredContent: { ...emptyOutput, resolution, source, eloAsOf, dataAsOf, provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
      const m = selected[0];

      // ── The fleet: a catalogue instance at every rate it lists, or the
      //    caller's own hourly rate.
      let instance: EnrichedComputeInstance | null = null;
      let computeProvenance: ComputeProvenance | undefined;
      let rates: RateOption[] = [];
      let fleetError: string | null = null;

      if (instanceType !== undefined) {
        const compute = await fetchComputeInstances((region as PricingRegion | undefined) ?? DEFAULT_PRICING_REGION);
        computeProvenance = compute.provenance;
        const catalogue = servableCatalogue(compute.instances);
        const wanted = instanceType.trim().toLowerCase();
        const named = catalogue.filter(inst => inst.instanceType.toLowerCase() === wanted);
        const matches = provider ? named.filter(inst => inst.provider.toLowerCase() === provider.toLowerCase()) : named;
        const providers = [...new Set(matches.map(inst => inst.provider))];

        if (matches.length === 0) {
          const incomplete = incompleteCatalogueCaveat(computeProvenance, provider);
          const near = catalogue
            .filter(inst => inst.instanceType.toLowerCase().includes(wanted) || wanted.includes(inst.instanceType.toLowerCase()))
            .slice(0, 5)
            .map(inst => `${inst.provider} ${inst.instanceType}`);
          fleetError =
            `No instance named "${instanceType}"` + (provider ? ` at ${provider}` : "") +
            ` in the ${computeProvenance.region} catalogue (${catalogue.length} Linux instances).` +
            (named.length > 0 ? ` It exists at ${[...new Set(named.map(inst => inst.provider))].join(", ")}.` : "") +
            (near.length > 0 ? ` Close names: ${near.join(", ")}.` : "") +
            ` Instance names are matched exactly; list candidates with compare-compute-pricing ` +
            `(category "GPU / Accelerated"), or pass hourlyRate for hardware the catalogue does not carry.` +
            (computeProvenance.tier === 2 && computeProvenance.catalogueIsSubset
              ? ` This is the static snapshot, a subset of the live catalogue, so "no match" does not mean no such instance exists.`
              : "") +
            (incomplete ? ` ${incomplete}` : "");
        } else if (providers.length > 1) {
          fleetError = `"${instanceType}" is an instance name at ${providers.join(" and ")}: say which with provider.`;
        } else {
          instance = matches[0];
          rates = rateOptions(instance, computeProvenance.priceTypes);
          if (rates.length === 0) {
            fleetError = `${instance.provider} ${instance.instanceType} lists no price in the ${computeProvenance.region} catalogue.`;
          }
        }
      } else {
        rates = [callerRateOption(hourlyRate!)];
      }

      if (fleetError) {
        const message = fleetError;
        return {
          structuredContent: { ...emptyOutput, resolution, source, eloAsOf, dataAsOf, provenance, computeProvenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      // ── The API: list, optimized, and the cheapest host when one is known
      //    to undercut the quoted price. Raw floats; rounded on the way out.
      const listCost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
      const optimizedCost = optimizedUseCaseCost(m, profile);
      const levers = optimizationLevers(m, profile);
      const saving = savingsPct(listCost, optimizedCost);

      const hostEntry = hostPricing.get(hostPricingKey(m));
      const cheapest = hostEntry?.summary.cheapest;
      const cheapestCost = cheapest ? useCaseCost(cheapest.input, cheapest.output, profile) : null;
      const cheaperHost =
        cheapest && cheapestCost !== null && cheapestCost < listCost &&
        !matchesOffer({ input: m.inputPricePer1M, output: m.outputPricePer1M }, cheapest)
          ? { offer: cheapest, cost: cheapestCost }
          : null;

      const baselines: ApiBaseline[] = [
        { basis: "list", costPerRequest: listCost },
        { basis: "optimized", costPerRequest: optimizedCost },
        ...(cheaperHost ? [{ basis: "cheapestHost" as const, costPerRequest: cheaperHost.cost }] : []),
      ];

      const capacity = outputTokensPerSecond !== undefined ? fleetCapacity(outputTokensPerSecond, count, workload) : null;
      const canServe = capacity === null ? null : volume <= capacity;
      const needed = outputTokensPerSecond !== undefined ? instancesNeeded(volume, outputTokensPerSecond, workload) : null;
      const volumeThroughput = throughputForVolume(volume, workload);

      const results: OptionResult[] = rates.map(option =>
        evaluateOption(option, { instanceCount: count, monthlyOperationsCost: operations, workload, volume, capacity, baselines }),
      );

      // ── Text ──
      const openness = opennessOf(m.license);
      const selfHostable = openness === "Open source" || openness === "Open weights" ? true : openness === "Proprietary" ? false : null;
      const weightsLine =
        selfHostable === true
          ? `Weights: ${openness}${m.license ? ` (${m.license})` : ""}. The model can be run on rented hardware; check the licence terms for your use.`
          : selfHostable === false
            ? `Weights: Proprietary. This model's weights are not published, so it cannot be self-hosted: the fleet ` +
              `figures only apply if the workload can move to an open model that this hardware runs.`
            : `Weights: licence not established. Whether this model can be self-hosted is unknown; confirm it before ` +
              `reading the fleet figures as an option.`;
      // A retirement notice ends the API side of the comparison, not the fleet
      // side: published weights do not expire with the maker's endpoint.
      const retirementLine = m.deprecation
        ? `\nAPI retirement: this model is ${describeDeprecation(m.deprecation)}. The API prices below last only ` +
          `as long as a host still serves it` +
          (selfHostable === true ? `; weights you run yourself are not affected.` : `.`)
        : "";

      const money = (cost: number): string => `${formatMicroCost(cost)}/req → ${formatMonthlyBudget(cost * volume)}/mo`;
      const apiLines = [
        `  API list price ($${m.inputPricePer1M} in / $${m.outputPricePer1M} out per 1M${priceTags(m)}): ${money(listCost)}`,
        saving > 0
          ? `  API optimized: ${money(optimizedCost)} — save ${saving}% with ${leverSummary(levers)}`
          : basis === "none-supplied"
            ? `  API optimized: same as list — ${NO_ASSUMPTIONS_NOTE}`
            : `  API optimized: same as list — no saving available (${leverSummary(levers)})`,
        cheaperHost
          ? `  Cheapest host — ${describeOffer(cheaperHost.offer)}: ${money(cheaperHost.cost)}` +
            (provenance.hostPricingAsOf ? ` (read ${provenance.hostPricingAsOf})` : "")
          : hostEntry
            ? `  Cheapest host: none below the quoted price among the listings known.`
            : `  Cheapest host: no per-host pricing for this model.`,
      ];

      const fleetName = instance
        ? `${count} × ${instance.provider} ${instance.instanceType} (${instance.vCPUs} vCPUs, ${instance.memory} GiB, ` +
          `${instance.processor}), ${computeProvenance?.region ?? DEFAULT_PRICING_REGION}`
        : `${count} × an instance at the hourly rate supplied`;
      const fleetLines = [
        `Renting capacity: ${fleetName}, billed ${HOURS_PER_MONTH} hours a month whatever the load.`,
        instance && instance.category !== "GPU / Accelerated"
          ? `Note: ${instance.instanceType} is in the ${instance.category} category, not GPU / Accelerated.`
          : "",
        monthlyOperationsCost !== undefined
          ? `Operations cost: ${formatMonthlyBudget(operations)}/mo supplied, included in every fleet figure below.`
          : `Operations cost: none supplied, so the fleet figures are hardware rent only.`,
        capacity === null
          ? `Throughput: none supplied, and none assumed. ${volume.toLocaleString()} req/mo asks the fleet for ` +
            `${formatThroughput(volumeThroughput)} output tok/s on average around the clock` +
            (count > 1 ? ` (${formatThroughput(volumeThroughput / count)} per instance)` : "") +
            `; the comparisons at that volume hold only if it can generate them.`
          : `Throughput supplied: ${outputTokensPerSecond} output tok/s per instance, so the fleet serves at most ` +
            `${formatCount(capacity)} req/mo flat out. ` +
            (canServe
              ? `${volume.toLocaleString()} req/mo is ${toPct(volume / capacity)}% of that.`
              : `${volume.toLocaleString()} req/mo is beyond it and takes ${needed} instances: re-run with ` +
                `instanceCount ${needed}. The comparison at your volume is left out below, because this fleet cannot serve it.`),
      ].filter(Boolean);

      // An optimized price equal to list would print every break-even twice.
      const shown = (r: OptionResult) => r.points.filter(p => p.basis !== "optimized" || saving > 0);
      const atVolume = `At ${volume.toLocaleString()} req/mo` + (capacity === null ? `, if the fleet can serve it` : "");
      const optionBlocks = results.map(r => {
        const lines = [
          `  ${describeOptionName(r.option)} — $${r.option.hourlyRate.toFixed(4)}/hr` + (count > 1 ? ` per instance` : "") +
            ` → ${formatMonthlyBudget(r.monthlyCost)}/mo` + (monthlyOperationsCost !== undefined ? ` with operations` : ""),
          ...shown(r).map(p => `    Costs the same as ${describePoint(p)}`),
        ];
        if (r.fullLoadCostPerRequest !== null) {
          lines.push(`    Flat out around the clock, one request costs ${formatMicroCost(r.fullLoadCostPerRequest)} on this fleet.`);
        }
        if (canServe !== false) {
          lines.push(`    ${atVolume}: ${shown(r).map(describeDelta).join(", ")}.`);
        }
        return lines.join("\n");
      });

      // The compute notice lists every provider's static columns. It leads
      // only when it bears on this answer: a fallback tier, or a static column
      // at this instance's provider (each such rate is also tagged below).
      const computeNotice =
        computeProvenance && instance &&
        (computeProvenance.tier !== 1 ||
          computeProvenance.staticPriceColumns.some(column => column.startsWith(`${instance.provider}.`)))
          ? computeProvenance.notice
          : undefined;
      const notices = [provenance.notice, computeNotice].filter(Boolean).map(n => `⚠️ ${n}`).join("\n\n");
      const dated = (label: string, timestamp?: string): string => label + (timestamp ? ` (as of ${timestamp})` : "");

      return {
        structuredContent: {
          ...emptyOutput,
          model: {
            provider: m.provider,
            model: m.model,
            parameters: m.parameters,
            eloScore: m.eloScore,
            license: m.license,
            openness,
            selfHostable,
            inputPricePer1M: m.inputPricePer1M,
            outputPricePer1M: m.outputPricePer1M,
            outlierListing: m.outlierListing,
            promotionalListing: m.promotionalListing,
            deprecation: m.deprecation,
          },
          api: [
            {
              basis: "list" as const,
              label: API_BASIS_LABELS.list,
              inputPricePer1M: m.inputPricePer1M,
              outputPricePer1M: m.outputPricePer1M,
              perRequest: roundPerRequestCost(listCost),
              monthly: roundMonthlyCost(listCost * volume),
            },
            {
              basis: "optimized" as const,
              label: API_BASIS_LABELS.optimized,
              perRequest: roundPerRequestCost(optimizedCost),
              monthly: roundMonthlyCost(optimizedCost * volume),
              savingsPct: saving,
              ...levers,
            },
            ...(cheaperHost
              ? [{
                  basis: "cheapestHost" as const,
                  label: API_BASIS_LABELS.cheapestHost,
                  inputPricePer1M: cheaperHost.offer.input,
                  outputPricePer1M: cheaperHost.offer.output,
                  host: cheaperHost.offer.host,
                  quantization: cheaperHost.offer.quantization,
                  discount: cheaperHost.offer.discount,
                  perRequest: roundPerRequestCost(cheaperHost.cost),
                  monthly: roundMonthlyCost(cheaperHost.cost * volume),
                }]
              : []),
          ],
          fleet: {
            provider: instance?.provider ?? null,
            instanceType: instance?.instanceType ?? null,
            region: instance ? computeProvenance?.region ?? null : null,
            vCPUs: instance?.vCPUs ?? null,
            memory: instance?.memory ?? null,
            processor: instance?.processor ?? null,
            category: instance?.category ?? null,
            instanceCount: count,
            hoursPerMonth: HOURS_PER_MONTH,
            monthlyOperationsCost: roundMonthlyCost(operations),
            operationsCostSupplied: monthlyOperationsCost !== undefined,
            outputTokensPerSecond: outputTokensPerSecond ?? null,
            volumeRequiredOutputTokensPerSecond: roundThroughput(volumeThroughput),
            capacityRequestsPerMonth: capacity === null ? null : Math.floor(capacity),
            volumeUtilizationPct: capacity === null ? null : toPct(volume / capacity),
            canServeVolume: canServe,
            instancesNeededForVolume: needed,
          },
          options: results.map(r => ({
            rate: r.option.rate,
            label: r.option.label,
            hourlyRate: roundHourlyRate(r.option.hourlyRate),
            static: r.option.static,
            interruptible: r.option.interruptible,
            monthlyCost: roundMonthlyCost(r.monthlyCost),
            fullLoadCostPerRequest: roundPerRequestCostOrNull(r.fullLoadCostPerRequest),
            breakEven: r.points.map(p => ({
              basis: p.basis,
              requestsPerMonth: p.point ? Math.round(p.point.requestsPerMonth) : null,
              tokensPerDay: p.point ? Math.round(p.point.tokensPerDay) : null,
              requiredOutputTokensPerSecond: p.point ? roundThroughput(p.point.outputTokensPerSecond) : null,
              utilizationPct: p.utilization === null ? null : toPct(p.utilization),
              reachable: p.reachable,
              fleetMinusApiMonthly: roundMonthlyCost(p.fleetMinusApiMonthly),
            })),
          })),
          resolution,
          source,
          eloAsOf,
          dataAsOf,
          provenance,
          computeProvenance,
        },
        content: [
          {
            type: "text",
            // The notices lead: a caller told to report figures exactly as
            // returned must see "unverified" before it sees them.
            text: (notices ? `${notices}\n\n` : "") +
              `Data source: ${dated(provenance.label, provenance.upstreamTimestamp)}.` +
              (computeProvenance ? ` Instance rates: ${dated(computeProvenance.label, computeProvenance.upstreamTimestamp)}.` : "") + `\n` +
              `Name resolution: ${resolution.map(describe).join(" ")}\n\n` +
              `API or own capacity — ${m.provider} ${m.model} for ${profile.label} (${profile.inputTokens} in + ` +
              `${profile.outputTokens} out tokens) at ${volume.toLocaleString()} requests/month.\n` +
              `${weightsLine}${retirementLine}\n\n` +
              `Paying per token:\n${apiLines.join("\n")}\n\n` +
              `${fleetLines.join("\n")}\n\n` +
              `${optionBlocks.join("\n")}` +
              ratesLegend(instance ? [instance] : [], computeProvenance?.priceTypes, computeProvenance?.awsSavingsPlansAsOf) +
              `${listingLegend([m], provenance.deprecationsVerifiedAt)}\n\n` +
              selfHostingFootnote(monthlyOperationsCost !== undefined, capacity !== null),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[estimate-self-hosting-breakeven] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error estimating the self-hosting break-even: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Tool 8: Track LLM Price Changes ────────────────────────────────

/** One decimal, the precision the site's own percentages carry. */
const roundPct = (pct: number): number => Math.round(pct * 10) / 10;

tool(
  "track-llm-price-changes",
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Track LLM Price Changes",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "What moved. Every other tool here quotes today's price; this one says whether it has just changed, " +
      "from the price archive optimtoken.optimnow.io keeps (its first day is `provenance.trackingStart`). " +
      "Without `models` it returns the moves of the last 7 days across the catalogue: each model whose " +
      "quoted price moved by 1% or more, with the price before and after and what the move does to a " +
      "workload's monthly bill. With `models` (1-4 names) it returns each model's quoted price since " +
      "tracking began, change by change. Use it for 'did any LLM price change this week', 'which models " +
      "got cheaper', 'has the price of X moved since the summer', 'is this price stable enough to budget " +
      "on'. Read the flags: most models are sold by several hosts and one of them is quoted, so a move " +
      "flagged `hostSwitch` is a change of the host quoted, not a repricing, and `outlierHost` is an " +
      "outlier listing. The moves with no flag are returned apart, as `priceChanges`; no flag means none " +
      "was established, which is not proof that the model maker repriced. There is no fallback for this " +
      "data: when the archive cannot be read the tool returns an error, never an empty list that would " +
      "read as 'nothing moved'.",
    inputSchema: {
      models: z
        .array(z.string())
        .min(1)
        .max(4)
        .optional()
        .describe("1-4 model names, for each one's price history since tracking began, e.g. ['Llama 3.3 70B']. Leave out for the week's moves across the catalogue."),
      direction: z.enum(["up", "down"]).optional().describe("Week's moves only: keep the rises (up) or the falls (down). Not accepted with `models`."),
      provider: z.string().optional().describe("Week's moves only: keep one provider's models, by exact name (case-insensitive), e.g. OpenAI, Anthropic, Meta. Not accepted with `models`."),
      includeFlagged: z.boolean().optional().describe("Week's moves only: false leaves out the moves flagged as a change of quoted host or an outlier listing. Default: true, returned apart in `flaggedMoves`. Not accepted with `models`."),
      limit: z.number().min(1).max(50).optional().describe("Week's moves: max moves returned in each of the two groups, largest first. History: max changes printed per model, the most recent (structuredContent carries all). Default: 15"),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload the monthly figures are computed for, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600), callSummary (2k / 700), agentWorkflow (6k / 3k). Default: supportTicket"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
    },
    outputSchema: outputSchema(priceChangesOutputSchema),
  },
  async ({ models: requested, direction, provider, includeFlagged, limit, useCasePreset, volumePreset }) => {
    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;
    const volumeLabel = volumeEntry?.label ?? vol;
    const profile = USE_CASE_PROFILES[useCasePreset || "supportTicket"];
    const maxShown = limit ?? 15;

    const emptyOutput = {
      mode: (requested ? "history" : "window") as "window" | "history",
      summary: null as unknown,
      priceChanges: [] as unknown[],
      flaggedMoves: [] as unknown[],
      matchingCount: 0,
      histories: [] as unknown[],
      resolution: [] as ResolutionEntry[],
      useCaseLabel: profile.label,
      volume,
      volumeLabel,
    };

    // A filter that silently did nothing would let "falls only" be read into
    // a history that also lists rises.
    if (requested && (direction !== undefined || provider !== undefined || includeFlagged !== undefined)) {
      const message =
        "direction, provider and includeFlagged filter the week's moves across the catalogue. They do not " +
        "apply to a named model's history: leave them out, or leave `models` out.";
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }

    // Raw floats drive the arithmetic; rounding happens once, on the way out.
    type Pair = { input: number; output: number };
    const costOf = (pair: Pair): number => useCaseCost(pair.input, pair.output, profile);
    const priced = (pair: Pair) => {
      const cost = costOf(pair);
      return {
        inputPricePer1M: pair.input,
        outputPricePer1M: pair.output,
        perRequest: roundPerRequestCost(cost),
        monthly: roundMonthlyCost(cost * volume),
      };
    };
    const perMonth = (pair: Pair): string => `${formatMonthlyBudget(costOf(pair) * volume)}/mo`;
    const pairText = (pair: Pair): string => `$${pair.input} in / $${pair.output} out`;
    const quotedPairOf = (m: LLMModel): Pair => ({ input: m.inputPricePer1M, output: m.outputPricePer1M });
    const workloadLine =
      `Monthly figures: ${profile.label} (${profile.inputTokens} in + ${profile.outputTokens} out tokens) at ` +
      `${volume.toLocaleString()} requests/month, at list price.`;
    const archiveLabel = `optimtoken.optimnow.io price archive (${OPTIMTOKEN_BASE_URL}/api/price-changes)`;
    const noArchive = (error: unknown): string =>
      `Price changes are served by optimtoken.optimnow.io only, and ${describePriceChangesFailure(error)}. ` +
      `No move is reported: that is not "nothing moved".`;

    try {
      // ── The week's moves ──
      if (!requested) {
        let window: PriceChangesWindow;
        try {
          window = await fetchPriceChanges();
        } catch (error) {
          console.warn("[track-llm-price-changes] archive unavailable:", describeUpstreamFailure(error).summary);
          const message = noArchive(error);
          return {
            structuredContent: { ...emptyOutput, error: message },
            content: [{ type: "text", text: message }],
            isError: true,
          };
        }

        // The catalogue adds the retirement notice and today's quoted price to
        // a move. It is not what was asked for, so the answer never waits on
        // more than its memo and never fails with it; only tier 1 is used,
        // because the lower tiers hold neither a notice nor a corrected price.
        const catalogue = await fetchLLMModels().catch(() => null);
        const rows =
          catalogue && catalogue.provenance.tier === 1
            ? new Map(catalogue.models.map(m => [hostPricingKey(m), m]))
            : null;

        const wantedProvider = provider?.trim().toLowerCase();
        const matching = window.changes.filter(
          move =>
            (!wantedProvider || move.provider.toLowerCase() === wantedProvider) &&
            (direction === undefined || (direction === "up" ? move.blendedPct > 0 : move.blendedPct < 0)),
        );
        const unflaggedAll = matching.filter(move => !isFlagged(move));
        const flaggedAll = includeFlagged === false ? [] : matching.filter(isFlagged);

        const annotate = (move: PriceMove) => {
          const row = rows?.get(hostPricingKey(move));
          return {
            move,
            row,
            // Only when it is not the archive's last price: the reader has to
            // know the two disagree, and has nothing to learn when they agree.
            quotedNow:
              row && !matchesOffer(quotedPairOf(row), move.after)
                ? { inputPricePer1M: row.inputPricePer1M, outputPricePer1M: row.outputPricePer1M }
                : undefined,
          };
        };
        type Annotated = ReturnType<typeof annotate>;
        const shownChanges = unflaggedAll.slice(0, maxShown).map(annotate);
        const shownFlagged = flaggedAll.slice(0, maxShown).map(annotate);

        const moveOut = (a: Annotated) => ({
          provider: a.move.provider,
          model: a.move.model,
          before: priced(a.move.before),
          after: priced(a.move.after),
          blendedPct: a.move.blendedPct,
          inputPct: a.move.inputPct,
          outputPct: a.move.outputPct,
          monthlyDelta: roundMonthlyCost((costOf(a.move.after) - costOf(a.move.before)) * volume),
          flags: a.move.flags,
          quotedNow: a.quotedNow,
          deprecation: a.row?.deprecation,
        });
        const moveLine = (a: Annotated, i: number): string =>
          `${i + 1}. ${a.move.provider} ${a.move.model}${flagTags(a.move.flags)}${a.row ? deprecationTag(a.row) : ""} — ` +
          `${pairText(a.move.before)} → ${pairText(a.move.after)} per 1M ` +
          `(blended ${describePct(a.move.blendedPct)}; input ${describePct(a.move.inputPct)}, ` +
          `output ${describePct(a.move.outputPct)}); ${perMonth(a.move.before)} → ${perMonth(a.move.after)}` +
          (a.quotedNow
            ? `. Quoted today: $${a.quotedNow.inputPricePer1M} in / $${a.quotedNow.outputPricePer1M} out`
            : "");

        const s = window.summary;
        const unflaggedTotal = s.moved - s.flagged;
        const meta = window.meta;
        const filters = [
          wantedProvider ? `provider ${provider?.trim()}` : "",
          direction ? (direction === "up" ? "rises only" : "falls only") : "",
          includeFlagged === false ? "flagged moves left out" : "",
        ].filter(Boolean);
        const section = (title: string, total: number, shown: Annotated[]): string =>
          total === 0
            ? `${title}: none${filters.length > 0 ? " with these filters" : ""}.`
            : `${title} (${shown.length === total ? total : `${shown.length} of ${total}`}), largest first:\n` +
              shown.map(moveLine).join("\n");
        const shown = [...shownChanges, ...shownFlagged];
        const legend = [
          ...flagLegend(shown.map(a => a.move)),
          ...deprecationLegend(shown.map(a => a.row ?? {}), catalogue?.provenance.deprecationsVerifiedAt),
        ];

        return {
          structuredContent: {
            ...emptyOutput,
            summary: {
              tracked: s.tracked,
              moved: s.moved,
              up: s.up,
              down: s.down,
              flagged: s.flagged,
              unflagged: unflaggedTotal,
            },
            priceChanges: shownChanges.map(moveOut),
            flaggedMoves: shownFlagged.map(moveOut),
            matchingCount: unflaggedAll.length + flaggedAll.length,
            provenance: {
              source: "optimtoken",
              label: archiveLabel,
              upstreamSchemaVersion: meta.schemaVersion,
              windowStart: meta.windowStart,
              windowEnd: meta.windowEnd,
              trackingStart: meta.trackingStart,
              asOf: meta.asOf,
            },
            catalogueProvenance: catalogue?.provenance,
          },
          content: [
            {
              type: "text",
              text:
                `Data source: ${archiveLabel}` +
                (meta.asOf ? `, as of ${meta.asOf}` : "") +
                (meta.trackingStart ? `; prices tracked since ${meta.trackingStart}` : "") + `.\n` +
                `Window ${meta.windowStart ?? "(start not stated)"} to ${meta.windowEnd ?? "(end not stated)"}: ` +
                (s.tracked !== null ? `${s.tracked} models compared, ` : "") +
                (s.moved === 0
                  ? `none moved by 1% or more on the blended price (30% input, 70% output).`
                  : `${s.moved} moved by 1% or more on the blended price (30% input, 70% output): ${s.up} up, ` +
                    `${s.down} down. ${s.flagged} of them ${s.flagged === 1 ? "is" : "are"} flagged as a change ` +
                    `of what the site quotes, which leaves ${unflaggedTotal} price ` +
                    `${unflaggedTotal === 1 ? "change" : "changes"}.`) +
                (filters.length > 0
                  ? `\nFilters: ${filters.join(", ")}. ${unflaggedAll.length + flaggedAll.length} of the ${s.moved} moves match.`
                  : "") +
                `\n${workloadLine}\n\n` +
                section("Price changes", unflaggedAll.length, shownChanges) +
                (includeFlagged === false
                  ? ""
                  : `\n\n` +
                    section(
                      "Flagged moves, where the quoted price moved without an established repricing",
                      flaggedAll.length,
                      shownFlagged,
                    )) +
                (legend.length > 0 ? `\n\n${legend.join("\n")}` : "") +
                (shown.length > 0
                  ? `\n\nThe blended percentage weighs output at 70%. A workload with another mix of input and ` +
                    `output can move by less, or the other way: the monthly figures on each line are the move ` +
                    `for this workload.`
                  : "") +
                `\n"After" is the price on the window's last day, from a nightly archive. The catalogue's live ` +
                `price can differ, and is given on the line where it does.` +
                (rows === null
                  ? ` The catalogue was not available from optimtoken.optimnow.io, so retirement notices and ` +
                    `today's prices are not shown.`
                  : ""),
            },
          ],
          isError: false,
        };
      }

      // ── Named models: the quoted price since tracking began ──
      const catalogue = await fetchLLMModels();
      if (catalogue.models.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models." },
          content: [{ type: "text", text: "Failed to fetch LLM models." }],
          isError: true,
        };
      }

      const { selected, resolution } = resolveNames(catalogue.models, requested);
      const describe = (r: ResolutionEntry): string => describeResolution(r, "history");

      if (selected.length === 0) {
        const message = `No requested name matched a model. ${resolution.map(describe).join(" ")}`;
        return {
          structuredContent: { ...emptyOutput, resolution, catalogueProvenance: catalogue.provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      if (catalogue.provenance.tier !== 1) {
        const message =
          `A model's price history is asked by its upstream id, which only optimtoken.optimnow.io's catalogue ` +
          `carries. The catalogue came from a fallback tier, so no history can be read. That is not "the price ` +
          `never changed".`;
        return {
          structuredContent: { ...emptyOutput, resolution, catalogueProvenance: catalogue.provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      const fetched = await Promise.all(
        selected.map(async m => {
          const id = catalogue.openRouterIds.get(hostPricingKey(m));
          if (!id) {
            return { m, history: null, failed: false, reason: "the site's catalogue gives no upstream id for this model" };
          }
          try {
            return { m, history: await fetchPriceHistory(id), failed: false, reason: undefined };
          } catch (error) {
            console.warn("[track-llm-price-changes] history unavailable:", describeUpstreamFailure(error).summary);
            return { m, history: null, failed: true, reason: describePriceChangesFailure(error) };
          }
        }),
      );

      // Every read failed: there is no answer to give, and a list of models
      // with "no history" would look like one.
      if (fetched.every(f => f.failed)) {
        const message =
          `Price history is served by optimtoken.optimnow.io only, and ${fetched[0].reason}. No history is ` +
          `reported: that is not "the price never changed".`;
        return {
          structuredContent: { ...emptyOutput, resolution, catalogueProvenance: catalogue.provenance, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      const point = (date: string, pair: Pair, blendedPct: number | null, flags: string[]) => ({
        date,
        ...priced(pair),
        blendedPct,
        flags,
      });
      const histories = fetched.map(({ m, history, reason }) => {
        const first = history && !history.notFound ? history.first : undefined;
        const changes = history && !history.notFound ? history.changes : undefined;
        if (!history || !first || !changes) {
          return {
            m,
            known: false as const,
            why:
              reason ??
              (history?.notFound
                ? "the site's price archive does not list this model"
                : "the site's price archive does not hold this model yet"),
          };
        }
        const latestRaw = changes.length > 0 ? changes[changes.length - 1] : first;
        const firstBlend = blendPair(first.input, first.output);
        return {
          m,
          known: true as const,
          firstSeen: history.firstSeen ?? first.date,
          first,
          changes,
          latestRaw,
          net:
            firstBlend > 0
              ? roundPct((blendPair(latestRaw.input, latestRaw.output) / firstBlend - 1) * 100)
              : null,
          quotedNow: !matchesOffer(quotedPairOf(m), latestRaw)
            ? { inputPricePer1M: m.inputPricePer1M, outputPricePer1M: m.outputPricePer1M }
            : undefined,
        };
      });

      const blocks = histories.map(h => {
        const head = `${h.m.provider} ${h.m.model}${deprecationTag(h.m)}`;
        if (!h.known) return `${head} — no price history: ${h.why}. That is not "the price never changed".`;

        const lines = [
          `${head} — in the archive since ${h.firstSeen}.`,
          `  First price on record (${h.first.date}): ${pairText(h.first)} per 1M → ${perMonth(h.first)}.`,
        ];
        const count = h.changes.length;
        if (count === 0) {
          lines.push(`  The quoted price has not changed since.`);
        } else {
          const flagged = h.changes.filter(isFlagged).length;
          lines.push(
            `  ${count} ${count === 1 ? "change" : "changes"} of the quoted price since, ${flagged} of them flagged.`,
            `  Latest (since ${h.latestRaw.date}): ${pairText(h.latestRaw)} per 1M → ${perMonth(h.latestRaw)}` +
              (h.net !== null ? `; blended ${describePct(h.net)} against the first price on record.` : "."),
          );
          const shownChanges = h.changes.slice(-maxShown);
          lines.push(
            `  Changes, oldest first${shownChanges.length < count ? ` (the last ${shownChanges.length} of ${count})` : ""}:`,
            ...shownChanges.map(
              c =>
                `    ${c.date}: ${pairText(c)} per 1M (blended ${describePct(c.blendedPct)})${flagTags(c.flags)} → ${perMonth(c)}`,
            ),
          );
        }
        if (h.quotedNow) {
          lines.push(
            `  Quoted today by the catalogue: $${h.quotedNow.inputPricePer1M} in / $${h.quotedNow.outputPricePer1M} ` +
              `out per 1M, which is not the archive's latest price.`,
          );
        }
        return lines.join("\n");
      });

      const meta = fetched.find(f => f.history)?.history?.meta ?? {};
      const legend = [
        ...flagLegend(histories.flatMap(h => (h.known ? h.changes.slice(-maxShown) : []))),
        ...deprecationLegend(selected, catalogue.provenance.deprecationsVerifiedAt),
      ];

      return {
        structuredContent: {
          ...emptyOutput,
          histories: histories.map(h =>
            h.known
              ? {
                  provider: h.m.provider,
                  model: h.m.model,
                  known: true,
                  firstSeen: h.firstSeen,
                  first: point(h.first.date, h.first, null, []),
                  changes: h.changes.map(c => point(c.date, c, c.blendedPct, c.flags)),
                  changeCount: h.changes.length,
                  flaggedCount: h.changes.filter(isFlagged).length,
                  latest: point(
                    h.latestRaw.date,
                    h.latestRaw,
                    h.changes.length > 0 ? h.changes[h.changes.length - 1].blendedPct : null,
                    h.changes.length > 0 ? h.changes[h.changes.length - 1].flags : [],
                  ),
                  netBlendedPct: h.net,
                  quotedNow: h.quotedNow,
                  deprecation: h.m.deprecation,
                }
              : {
                  provider: h.m.provider,
                  model: h.m.model,
                  known: false,
                  unavailableReason: h.why,
                  firstSeen: null,
                  first: null,
                  changes: [],
                  changeCount: 0,
                  flaggedCount: 0,
                  latest: null,
                  netBlendedPct: null,
                  deprecation: h.m.deprecation,
                },
          ),
          resolution,
          provenance: {
            source: "optimtoken",
            label: archiveLabel,
            upstreamSchemaVersion: meta.schemaVersion,
            trackingStart: meta.trackingStart,
            asOf: meta.asOf,
          },
          catalogueProvenance: catalogue.provenance,
        },
        content: [
          {
            type: "text",
            text:
              `Data source: ${archiveLabel}` +
              (meta.asOf ? `, as of ${meta.asOf}` : "") +
              (meta.trackingStart ? `; prices tracked since ${meta.trackingStart}` : "") + `.\n` +
              `The price quoted for ${selected.length === 1 ? "this model" : `these ${selected.length} models`} ` +
              `since tracking began. No history goes back before the archive's first day.\n` +
              `${workloadLine}\n\n` +
              `Name resolution:\n${resolution.map(r => `  ${describe(r)}`).join("\n")}\n\n` +
              blocks.join("\n\n") +
              (legend.length > 0 ? `\n\n${legend.join("\n")}` : ""),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[track-llm-price-changes] failed:", error);
      return {
        structuredContent: { ...emptyOutput, error: message },
        content: [{ type: "text", text: `Error tracking price changes: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── Server ─────────────────────────────────────────────────────────

/**
 * A server with every tool registered on it. Called once per request by
 * lib/http.ts, which is the point: the MCP SDK refuses a second connection on
 * a server that already has one, so a shared instance answers every request
 * that overlaps another with HTTP 500.
 */
function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "ai-pricing-hub",
      version: "0.10.1",
    },
    // Said once per connection: what the server is for and how to repeat its
    // figures. The tools' own texts carry the same rules, answer by answer.
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const register of tools) register(server);
  return server;
}

const httpServer = createHttpServer(createServer);

// Fly sets PORT (fly.toml), and a container must listen on all interfaces,
// which is Node's default when no host is given.
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

httpServer.on("error", (error) => {
  console.error("[server] failed to start:", errorMessage(error));
  process.exit(1);
});

httpServer.listen(port, () => {
  console.log(`[server] ai-pricing-hub MCP listening on port ${port}, endpoint /mcp`);
});

// Stop when asked. As PID 1 in a container Node ignores SIGINT and SIGTERM
// unless something handles them, so without this a stopping machine was only
// ever killed at the platform's timeout.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
    // A request still in flight gets a moment to finish, not forever.
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}

/**
 * Fill the caches the first caller would otherwise pay for.
 *
 * Measured against production on 2026-08-18: a freshly deployed process answers
 * `compare-compute-pricing` in **8.4 s** and then in ~250 ms, because the memo
 * in compute-pricing.ts starts empty and the first caller funds the rebuild.
 * The same three MCP sessions minutes apart all reported the same
 * `upstreamTimestamp`, which is what establishes that the process is long-lived
 * and that warming it once is worth anything at all. On a per-request runtime
 * this function would be pure waste.
 *
 * Only the default region is warmed. Warming all four would cost four upstream
 * rebuilds per boot — each one six provider APIs assembled live — for three
 * regions that a given deployment may never be asked about. The other three
 * warm on first use, paying ~7 s once (measured: asia-pacific 7.1 s cold, then
 * 447 ms).
 *
 * The LLM catalogue is warmed too. At 0.19-0.42 s cold it is not a latency
 * problem, but it costs almost nothing to prime and all four LLM tools block on
 * it.
 *
 * Deliberately fire-and-forget: start-up must not wait on an upstream
 * that can take 11 s, or a slow site turns into a failed boot. A failure here
 * is logged and dropped — the fetchers do not cache snapshot fallbacks, so a
 * failed warm leaves the cache empty and the first real caller simply pays what
 * it would have paid anyway.
 */
function warmCaches(): void {
  // Never reach upstream from a test run or a CI build.
  if (process.env.NODE_ENV === "test" || process.env.SKIP_CACHE_WARMUP === "1") return;

  const started = Date.now();
  void fetchLLMModels()
    .then(r => console.log(`[warmup] llm-models: ${r.models.length} models in ${Date.now() - started}ms (tier ${r.provenance.tier})`))
    .catch(error => console.error("[warmup] llm-models failed, first caller will pay for it:", errorMessage(error)));

  void fetchComputeInstances(DEFAULT_PRICING_REGION)
    .then(r => console.log(`[warmup] compute ${DEFAULT_PRICING_REGION}: ${r.instances.length} instances in ${Date.now() - started}ms (tier ${r.provenance.tier})`))
    .catch(error => console.error("[warmup] compute failed, first caller will pay for it:", errorMessage(error)));
}

warmCaches();

