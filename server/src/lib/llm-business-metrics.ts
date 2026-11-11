import type { LLMModel } from "../data/pricing-data.js";
import { opennessOf } from "./openness.js";
import type { Openness } from "./openness.js";

// ── Types ──

export type ViewMode = "business" | "technical";
export type VolumePreset = "10k" | "100k" | "1m";
export type VolatilityLevel = "High" | "Medium" | "Stable" | "Unknown";

export interface UseCaseProfile {
  label: string;
  shortLabel: string;
  inputTokens: number;
  outputTokens: number;
  /** Share of input tokens typically served from prompt cache in production
   *  (system prompt, knowledge base, tool definitions). 0..1 */
  cacheHitRate: number;
  /** Whether this workload is typically async and batch-API eligible (-50%) */
  batchEligible: boolean;
}

export interface EnrichedLLMModel extends LLMModel {
  /** Self-hostability, derived from the licence. A separate axis from
   *  `category`, which is a price tier and nothing else. */
  openness: Openness;
  efficiencyScore: number | null;
  useCaseCost: number;
  /** Unit cost assuming prompt caching + batch API where the use case allows it */
  optimizedUseCaseCost: number;
  monthlyBudget: number;
  /** Monthly budget at the optimized unit cost */
  optimizedMonthlyBudget: number;
  volatilityRisk: VolatilityLevel;
  isFinOpsFriendly: boolean;
}

// ── Constants ──

/** The only accepted `useCasePreset` values — the tool input enums are built
 *  from this, so a profile can never exist that callers cannot select. */
export const USE_CASE_KEYS = [
  "supportTicket",
  "knowledgeQA",
  "meetingSummary",
  "marketingContent",
  "codingTask",
  "invoiceProcessing",
  "callSummary",
  "agentWorkflow",
] as const;

export type UseCaseKey = (typeof USE_CASE_KEYS)[number];

export const USE_CASE_PROFILES: Record<UseCaseKey, UseCaseProfile> = {
  supportTicket:     { label: "Support Ticket",     shortLabel: "Support",   inputTokens: 1500,  outputTokens: 500,   cacheHitRate: 0.6, batchEligible: false },
  knowledgeQA:       { label: "Knowledge Q&A",      shortLabel: "Q&A",       inputTokens: 2000,  outputTokens: 800,   cacheHitRate: 0.7, batchEligible: false },
  meetingSummary:    { label: "Meeting Summary",     shortLabel: "Meeting",   inputTokens: 10000, outputTokens: 1200,  cacheHitRate: 0.1, batchEligible: true  },
  marketingContent:  { label: "Marketing Content",   shortLabel: "Marketing", inputTokens: 2500,  outputTokens: 1800,  cacheHitRate: 0.2, batchEligible: false },
  codingTask:        { label: "Coding Task",         shortLabel: "Coding",    inputTokens: 3000,  outputTokens: 2000,  cacheHitRate: 0.5, batchEligible: false },
  invoiceProcessing: { label: "Invoice Processing",  shortLabel: "Invoice",   inputTokens: 1500,  outputTokens: 600,   cacheHitRate: 0.3, batchEligible: true  },
  callSummary:       { label: "Call Summary",         shortLabel: "Call",      inputTokens: 2000,  outputTokens: 700,   cacheHitRate: 0.1, batchEligible: true  },
  agentWorkflow:     { label: "Agent Workflow",       shortLabel: "Agent",     inputTokens: 6000,  outputTokens: 3000,  cacheHitRate: 0.7, batchEligible: false },
};

export const VOLUME_PRESETS: { key: VolumePreset; value: number; label: string }[] = [
  { key: "10k", value: 10_000, label: "10K" },
  { key: "100k", value: 100_000, label: "100K" },
  { key: "1m", value: 1_000_000, label: "1M" },
];

// ── Helpers ──

export const SIZE_BUCKETS = ["Small (<15B)", "Medium (15-99B)", "Large (100-499B)", "XL (500B+)", "Undisclosed"] as const;

export function parseParamSize(param?: string): number | null {
  if (!param || param === "Undisclosed") return null;
  const match = param.replace("~", "").match(/([\d.]+)\s*([BT])/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "T" ? num * 1000 : num;
}

export function getSizeBucket(param?: string): string {
  const size = parseParamSize(param);
  if (size === null) return "Undisclosed";
  if (size < 15) return "Small (<15B)";
  if (size < 100) return "Medium (15-99B)";
  if (size < 500) return "Large (100-499B)";
  return "XL (500B+)";
}

export function eloTier(elo?: number): { label: string; className: string; title: string } | null {
  if (!elo) return null;
  // Red at 70% lightness only reached 4.36:1 over the composited badge
  // background; 78% brings the S badge to 5.75:1, clear of the 4.5:1 AA bar.
  if (elo >= 1350) return { label: "S", className: "bg-[hsl(0,65%,55%,0.2)] text-[hsl(0,65%,78%)] ring-1 ring-[hsl(0,65%,55%,0.3)]", title: "S-Tier: Elite (ELO 1350+)" };
  if (elo >= 1280) return { label: "A", className: "bg-[hsl(35,80%,55%,0.2)] text-[hsl(35,80%,70%)] ring-1 ring-[hsl(35,80%,55%,0.3)]", title: "A-Tier: High quality (ELO 1280–1349)" };
  if (elo >= 1200) return { label: "B", className: "bg-[hsl(210,70%,55%,0.2)] text-[hsl(210,70%,70%)] ring-1 ring-[hsl(210,70%,55%,0.3)]", title: "B-Tier: Good quality (ELO 1200–1279)" };
  return { label: "C", className: "bg-[hsl(0,0%,50%,0.15)] text-[hsl(0,0%,65%)]", title: "C-Tier: Standard (ELO below 1200)" };
}

// ── Business metric functions ──

/** Cost per single request for a use case profile */
export function useCaseCost(inputPrice: number, outputPrice: number, profile: UseCaseProfile): number {
  return (profile.inputTokens / 1e6) * inputPrice + (profile.outputTokens / 1e6) * outputPrice;
}

/**
 * How many times a token written into the prompt cache is read back before it
 * has to be written again. **A modelling assumption, not a measurement**: no
 * vendor publishes it, because it is a property of the customer's traffic.
 *
 * Why it exists: a cache read is only possible after a cache WRITE, and vendors
 * that publish a write rate charge MORE for it than for ordinary input
 * (typically 1.25x at the default ~5-minute lifetime). Crediting the read
 * without charging the write understates the cost of every cached token.
 *
 * The same constant, for the same reasons, as the site's
 * (cloud-sparkle-compare/src/lib/llm-business-metrics.ts, where the choice of 5
 * is argued in full, and whose cost-per-request methodology guide prints it).
 * It is the low, conservative end of a per-conversation prefix (an 11-turn
 * session) and far below a shared prefix at volume, so the figure errs toward
 * overstating cost. Change it there first, then here.
 */
export const CACHE_READS_PER_WRITE = 5;

/** Which of the two optimization levers actually apply to this (model, workload)
 *  pair. Both are conditional: batch pricing needs an async workload AND a model
 *  that publishes batch rates, cache savings need a cacheable prefix AND a
 *  published cache-read rate. When neither applies the optimized cost is simply
 *  the list cost — the text says so rather than reporting a bare 0% saving. */
export interface OptimizationLevers {
  /** Workload is async enough for the batch API */
  batchEligible: boolean;
  /** Workload has a reusable prefix (cacheHitRate > 0) */
  cacheEligible: boolean;
  /** Batch eligible, the model publishes batch rates, AND they lower the cost */
  batchApplied: boolean;
  /** Cache eligible, the model publishes a cache-read rate, AND caching pays
   *  once the cache write is charged */
  cacheApplied: boolean;
}

/**
 * The input rate once prompt caching is priced in, against one base rate (the
 * list input rate, or the batch one).
 *
 * The site's formula, term for term (its optimizedUseCaseCost()):
 *
 *   effectiveIn = h * R + (1 - h) * B + writtenShare * max(0, W - B)
 *   writtenShare = min(h / CACHE_READS_PER_WRITE, 1 - h)
 *
 * with h the cache hit rate, R the published read rate, W the published write
 * rate and B the base rate. For every CACHE_READS_PER_WRITE tokens read from
 * cache one token was written; that token is one of the (1 - h) misses, which
 * the read-only formula bills at B and the vendor bills at W.
 *
 *  - No published read rate -> no caching in the estimate, hence no write.
 *  - Published read but no finite write rate above B -> the write costs the
 *    ordinary input rate. Vendors with automatic caching genuinely charge no
 *    premium, so this is not merely a gap.
 *  - Under batch the read AND the write are taken at their published standard
 *    rates as-is: no vendor publishes a batch-cache rate, so the premium is
 *    measured against the batch input rate and comes out larger.
 *
 * Clamped at B: caching that does not pay is caching you would not enable. That
 * also neutralises a read rate published above the base rate, which happens for
 * real under batch (a $0.075 cache read against a $0.0296 batch input rate).
 */
function cachedInputRate(model: LLMModel, profile: UseCaseProfile, baseIn: number): number {
  const read = model.cachedInputPricePer1M;
  const h = profile.cacheHitRate;
  if (read === undefined || !(h > 0)) return baseIn;

  let effectiveIn = read * h + baseIn * (1 - h);

  const write = model.cacheWritePricePer1M;
  if (write !== undefined && Number.isFinite(write) && write > baseIn) {
    // Written tokens are cache misses, so their share cannot exceed (1 - h).
    const writtenShare = Math.min(h / CACHE_READS_PER_WRITE, 1 - h);
    if (writtenShare > 0) effectiveIn += writtenShare * (write - baseIn);
  }

  // Written as a comparison, not Math.min, so a NaN never replaces a number.
  return baseIn < effectiveIn ? baseIn : effectiveIn;
}

/** The use-case cost on one side of the batch choice, with caching priced in
 *  where it pays. */
function branchCost(
  model: LLMModel,
  profile: UseCaseProfile,
  useBatch: boolean,
): { cost: number; cachePays: boolean } {
  const baseIn = useBatch ? model.batchInputPricePer1M! : model.inputPricePer1M;
  const baseOut = useBatch ? model.batchOutputPricePer1M! : model.outputPricePer1M;
  const effectiveIn = cachedInputRate(model, profile, baseIn);
  return {
    cost: (profile.inputTokens / 1e6) * effectiveIn + (profile.outputTokens / 1e6) * baseOut,
    cachePays: effectiveIn < baseIn,
  };
}

/**
 * The optimized cost and the levers that produced it, decided together so the
 * figure and its explanation cannot disagree.
 *
 * A published rate is not automatically a saving. Zhipu GLM 5.2 once listed
 * batch at $0.70/$2.20 against a list price of $0.49/$1.54: applying it raised
 * the cost by a third. "Optimized" means the best achievable price, so batch is
 * taken only when its branch is cheaper than the standard one, caching only
 * when it pays on the branch chosen, and a lever that is not pulled is not
 * reported as applied. Every tool names the applied levers as the reason for a
 * saving, and naming one that cost money is worse than naming none.
 *
 * This is one step stricter than the site, which takes the batch branch
 * whenever batch rates are published and then clamps at list. The two agree on
 * every pair unless a batch branch lands between the standard branch and list,
 * which no catalogue row does (re-measured 2026-11-11: 0 of 2,512 pairs).
 */
function resolveOptimization(
  model: LLMModel,
  profile: UseCaseProfile,
): { cost: number; batchApplied: boolean; cacheApplied: boolean } {
  const list = useCaseCost(model.inputPricePer1M, model.outputPricePer1M, profile);
  const standard = branchCost(model, profile, false);

  const batchPublished =
    profile.batchEligible &&
    model.batchInputPricePer1M !== undefined &&
    model.batchOutputPricePer1M !== undefined;
  const batch = batchPublished ? branchCost(model, profile, true) : null;

  const useBatch = batch !== null && batch.cost < standard.cost;
  const chosen = useBatch ? batch : standard;

  // With no lever pulled the optimized cost IS the list cost, returned as the
  // same float: a branch that blends the input price with itself can land a few
  // ULPs off, invisible in the numbers but enough to draw a longer bar. This is
  // also the "never above list" guarantee.
  if (!(chosen.cost < list)) return { cost: list, batchApplied: false, cacheApplied: false };

  return { cost: chosen.cost, batchApplied: useBatch, cacheApplied: chosen.cachePays };
}

export function optimizationLevers(model: LLMModel, profile: UseCaseProfile): OptimizationLevers {
  const { batchApplied, cacheApplied } = resolveOptimization(model, profile);
  return {
    batchEligible: profile.batchEligible,
    cacheEligible: profile.cacheHitRate > 0,
    batchApplied,
    cacheApplied,
  };
}

/** Unit cost assuming the FinOps optimizations this use case allows:
 *  - batch API pricing when the workload is async (batchEligible)
 *  - prompt-cache pricing on the cacheHitRate share of input tokens: the READ
 *    rate, plus the amortised premium of the WRITE that made the read possible
 *  Falls back to list prices when a model doesn't publish batch/cache rates,
 *  so the optimized cost is never lower than what is actually achievable, and
 *  never above list. The site publishes this formula as a spec (its
 *  cost-per-request methodology guide): change both together. */
export function optimizedUseCaseCost(model: LLMModel, profile: UseCaseProfile): number {
  return resolveOptimization(model, profile).cost;
}

/** Single price figure used to rank a model, mixing input and output at a fixed
 *  30/70 ratio. List prices only: cache and batch discounts are conditional on
 *  the customer actually implementing them, so they stay out of the ranking and
 *  are surfaced separately as the optimized cost. */
export function blendedPrice(model: LLMModel): number {
  return model.inputPricePer1M * 0.3 + model.outputPricePer1M * 0.7;
}

export interface ScoreComponents {
  /** Blended 0–100 value score, or null when the model isn't ranked */
  score: number | null;
  /** 100 = best ELO of the ranked population */
  eloPercentile: number | null;
  /** 100 = cheapest of the ranked population */
  pricePercentile: number | null;
}

/** Rank every model on quality and on price independently, then blend.
 *  Both percentiles are kept because the FinOps badge gates on each of them
 *  separately: a blended score alone lets an elite-but-ruinous model through
 *  on quality points, which is exactly what the price gate exists to stop. */
export function computeScoreComponents(models: LLMModel[]): ScoreComponents[] {
  const none: ScoreComponents = { score: null, eloPercentile: null, pricePercentile: null };

  // A non-positive blended price is not a very cheap model, it is a model with
  // no published price: an unpriced evaluation endpoint, or a free promo tier.
  // It is excluded for the same reason Image models are: the number is not
  // comparable with the rest of the population. Left in, a $0 row would take
  // the cheapest slot, award itself pricePercentile 100 and push every other
  // model's price rank down one. hasPublishableTokenPricing() keeps such rows
  // out of the catalogue today, so this is the guard for the day that changes.
  const withElo = models
    .map((m, i) => ({ i, elo: m.eloScore, price: blendedPrice(m), category: m.category }))
    .filter((e) => e.elo && e.category !== "Image" && e.price > 0);

  if (withElo.length === 0) return models.map(() => none);
  if (withElo.length === 1) {
    const result: ScoreComponents[] = models.map(() => none);
    result[withElo[0].i] = { score: 50, eloPercentile: 50, pricePercentile: 50 };
    return result;
  }

  const denom = withElo.length - 1;

  // Competition ranking: models at one value share the rank of the first of
  // them, so the percentile is (denom − models strictly better) / denom. The
  // sort position used to be the rank, so a tie was broken by the catalogue's
  // array order: of two models at the same blended price, one could clear the
  // cost gate and the other not. Same rule as the site (its review finding S4);
  // for untied values the percentile is unchanged.
  const percentiles = (sorted: typeof withElo, value: (e: (typeof withElo)[number]) => number) => {
    const out = new Map<number, number>();
    let better = 0;
    sorted.forEach((e, position) => {
      if (position > 0 && value(e) !== value(sorted[position - 1])) better = position;
      out.set(e.i, ((denom - better) / denom) * 100);
    });
    return out;
  };

  // Rank by ELO descending → percentile (highest ELO = 100)
  const eloPercentile = percentiles([...withElo].sort((a, b) => b.elo! - a.elo!), (e) => e.elo!);

  // Rank by price ascending → percentile (cheapest = 100)
  const pricePercentile = percentiles([...withElo].sort((a, b) => a.price - b.price), (e) => e.price);

  return models.map((_, i) => {
    const ep = eloPercentile.get(i);
    const pp = pricePercentile.get(i);
    if (ep === undefined || pp === undefined) return none;
    return { score: Math.round(ep * 0.6 + pp * 0.4), eloPercentile: ep, pricePercentile: pp };
  });
}

/** Compute percentile-rank-based value scores for all models.
 *  Blends ELO quality (60%) with price affordability (40%) so frontier
 *  models aren't crushed by budget models in the ranking. */
export function computeValueScores(models: LLMModel[]): (number | null)[] {
  return computeScoreComponents(models).map((c) => c.score);
}

/** Determine volatility risk level for a model */
export function getVolatilityRisk(modelName: string, releaseDate?: string, category?: string): VolatilityLevel {
  const nameLower = modelName.toLowerCase();
  if (nameLower.includes("preview") || nameLower.includes("beta") || nameLower.includes("experimental")) {
    return "High";
  }
  if (releaseDate) {
    const months = monthsAgo(releaseDate);
    if (months !== null && months < 3 && category === "Frontier") return "Medium";
  }
  if (!releaseDate) return "Unknown";
  return "Stable";
}

function monthsAgo(dateStr: string): number | null {
  const match = dateStr.match(/(\d{4})-(\d{2})/);
  if (!match) return null;
  const then = new Date(+match[1], +match[2] - 1);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

/** Quality floor: the model must rank in the top 40% on Arena ELO.
 *  Relative, not absolute — the old fixed ELO ≥ 1250 excluded nothing once the
 *  Arena scale was recalibrated, so it read as a criterion while doing no work.
 *  A percentile floor recalibrates itself as the market moves.
 *  It is deliberately a floor, not a podium: tightening it further pushes the
 *  badge back toward expensive frontier models, which is the bias the price
 *  gate exists to remove. */
export const FINOPS_MIN_ELO_PERCENTILE = 60;

/** Cost ceiling: the model must sit in the cheapest 70% on list price.
 *  This is an eliminating gate rather than extra weight in the blended score,
 *  because a weight can always be overwhelmed — at 60% quality weighting a
 *  top-ranked model clears the efficiency threshold on ELO points alone, which
 *  is how the most expensive model in the catalogue used to earn the badge. */
export const FINOPS_MIN_PRICE_PERCENTILE = 30;

/** Check if a model qualifies as FinOps Friendly. All 4 criteria required:
 *  1. Quality   — Arena ELO in the top 40% of ranked models
 *  2. Value     — Efficiency score in the top 30%. Scores are whole numbers,
 *                 so every model tied on the cut-off score clears it
 *  3. Cost      — list price among the cheapest 70% of ranked models, and
 *                 that price not an outlier listing
 *  4. Stability — no preview/beta/experimental label, and not a frontier model
 *                 released in the last 3 months
 *  Criterion 4 defers to getVolatilityRisk() so the badge and the reported
 *  volatility can never disagree about the same model.
 *
 *  Criterion 3's second half follows the site (2026-10-18). An outlier listing
 *  is one reseller's rate with input near free and output at or above the going
 *  rate; a badge promising a price a reader can budget against cannot rest on
 *  one. The site decides it from its nightly per-host fan-out and publishes the
 *  verdict as `outlierListing` on the row, which is what is read here. The
 *  listing stays IN the ranking, exactly as on the site: its own score and
 *  every other model's percentile are unchanged.
 *
 *  One site rule is NOT applied here: the site also refuses the badge to a
 *  model with a vendor-announced deprecation, from a hand-curated table
 *  (its model-lifecycle.ts) that its API does not publish. Copying the table
 *  would add a list that drifts in silence; the fix is for the API to carry a
 *  deprecation flag. Until then a deprecated model can hold the badge here and
 *  not there. None did when this was written (2026-11-11). */
export function checkFinOpsFriendly(
  model: LLMModel,
  components: ScoreComponents,
  efficiencyThreshold: number,
): boolean {
  const { score, eloPercentile, pricePercentile } = components;
  if (score === null || eloPercentile === null || pricePercentile === null) return false;
  if (eloPercentile < FINOPS_MIN_ELO_PERCENTILE) return false;
  if (score < efficiencyThreshold) return false;
  if (pricePercentile < FINOPS_MIN_PRICE_PERCENTILE) return false;
  if (model.outlierListing === true) return false;

  // "Unknown" (no release date published) still passes: a metadata gap is not
  // evidence of instability, and dropping those models would silently penalise
  // providers for incomplete catalogue data rather than for volatility.
  const risk = getVolatilityRisk(model.model, model.releaseDate, model.category);
  return risk !== "High" && risk !== "Medium";
}

export interface FinOpsBadgeSummary {
  /** Models earning the badge */
  qualifying: number;
  /** Models ranked at all — an ELO score and not an Image model */
  ranked: number;
  /** Lowest Arena ELO still clearing the quality gate */
  minElo: number | null;
  /** Highest blended list price still clearing the cost gate */
  maxBlendedPrice: number | null;
}

/** Restate the badge's percentile gates as the concrete ELO and price they
 *  currently land on, so a caller can show what "top 40%" means today rather
 *  than leaving the reader to take the percentile on faith. Both move with the
 *  market, which is the point of ranking rather than hardcoding thresholds. */
export function summarizeFinOpsBadge(models: EnrichedLLMModel[]): FinOpsBadgeSummary {
  const ranked = models.filter((m) => m.efficiencyScore !== null);
  const qualifying = models.filter((m) => m.isFinOpsFriendly).length;
  if (ranked.length === 0) {
    return { qualifying, ranked: 0, minElo: null, maxBlendedPrice: null };
  }

  // The gate admits every rank whose percentile is >= the cut, so the last
  // admitted index is (100 - cut)% of the way down the sorted population.
  const lastAdmitted = (percentile: number) =>
    Math.floor(((100 - percentile) / 100) * (ranked.length - 1));

  const elosDesc = ranked.map((m) => m.eloScore!).sort((a, b) => b - a);
  const pricesAsc = ranked.map(blendedPrice).sort((a, b) => a - b);

  return {
    qualifying,
    ranked: ranked.length,
    minElo: elosDesc[lastAdmitted(FINOPS_MIN_ELO_PERCENTILE)] ?? null,
    maxBlendedPrice: pricesAsc[lastAdmitted(FINOPS_MIN_PRICE_PERCENTILE)] ?? null,
  };
}

// ── Formatting helpers ──

/** Format sub-cent costs: $0.0042 */
export function formatMicroCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Name the levers behind a saving — or the reason there isn't one. A 0% figure
 *  on its own reads like a bug; "not batch-eligible" reads like an answer. */
export function leverSummary(l: OptimizationLevers): string {
  const applied = [l.cacheApplied ? "caching" : "", l.batchApplied ? "batch API" : ""].filter(Boolean);
  if (applied.length > 0) return applied.join(" + ");
  if (!l.cacheEligible && !l.batchEligible) {
    return "this workload has no cacheable prefix and is not batch-eligible";
  }
  const missing = [l.cacheEligible ? "cache-read" : "", l.batchEligible ? "batch" : ""].filter(Boolean);
  return `this model publishes no ${missing.join(" or ")} rate`;
}

/** Why a custom token shape shows no saving when the caller passed neither a
 *  cache-hit rate nor batch eligibility. Said in these words because the other
 *  reading, "this workload cannot be optimized", is false for any model that
 *  publishes a cache or batch rate: nothing was assumed, so nothing was found. */
export const NO_ASSUMPTIONS_NOTE =
  "no caching or batch assumption was supplied for this custom workload, so optimized repeats " +
  "list price; pass cacheHitRate and/or batchEligible to model the discounts it can reach";

/** Percentage saved going from `list` to `optimized`, 0 when there is no gain. */
export function savingsPct(list: number, optimized: number): number {
  if (!(list > 0) || optimized >= list) return 0;
  return Math.round((1 - optimized / list) * 100);
}

/** Format monthly budget: $1.2K, $450, $0.14. The unit is chosen on the value
 *  as it would round in the smaller unit, so 999.9999 is "$1.0K", not "$1000",
 *  and 999,999 is "$1.0M", not "$1000.0K". Same function as the site's. */
export function formatMonthlyBudget(cost: number): string {
  if (cost >= 1_000_000 || Number((cost / 1_000).toFixed(1)) >= 1_000) return `$${(cost / 1_000_000).toFixed(1)}M`;
  if (cost >= 1_000 || Math.round(cost) >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`;
  if (cost >= 1) return `$${cost.toFixed(0)}`;
  if (cost >= 0.01 || Number(cost.toFixed(4)) >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

// ── Serialisation helpers ──

/** Decimal places a cost keeps when it crosses the wire as JSON.
 *  Per-request costs are routinely sub-cent, so they keep 6 places — the same
 *  floor formatMicroCost() uses. Monthly budgets are dollars, so 2 is cents. */
export const PER_REQUEST_DECIMALS = 6;
export const MONTHLY_DECIMALS = 2;
/** Per-1M prices are cheap enough at the bottom of the catalogue ($0.01/1M) that
 *  6 places is ample, and they are derived too: blendedPrice() mixes input and
 *  output at 30/70, which is noisy for roughly 40% of the catalogue. */
export const PRICE_DECIMALS = 6;

/** Drop IEEE-754 representation noise from a cost that is about to be
 *  serialised into structuredContent.
 *
 *  useCaseCost() is arithmetically right; the binary float it returns is what
 *  is ugly. 3000/1e6 × $30 + 2000/1e6 × $180 is exactly 0.45, yet lands on
 *  0.44999999999999996, and ×100,000 on 44999.99999999999. Every tool here
 *  tells the calling model to report figures EXACTLY as returned, so that noise
 *  is printed verbatim to an end user.
 *
 *  Round here and nowhere else. The raw values feed sorting and percentile
 *  ranking, where rounding would manufacture ties. */
export function roundCost(cost: number, decimals: number): number {
  if (!Number.isFinite(cost)) return cost;
  return Number(cost.toFixed(decimals));
}

export const roundPerRequestCost = (cost: number): number => roundCost(cost, PER_REQUEST_DECIMALS);
export const roundMonthlyCost = (cost: number): number => roundCost(cost, MONTHLY_DECIMALS);
export const roundPricePer1M = (price: number): number => roundCost(price, PRICE_DECIMALS);

/** Null-tolerant variant, for the optional figures on the badge summary. */
export const roundPricePer1MOrNull = (price: number | null): number | null =>
  price === null ? null : roundPricePer1M(price);

// ── Enrichment pipeline ──

/** Enrich filtered models with business metrics for the selected use case */
export function enrichModels(
  models: LLMModel[],
  volumePreset: VolumePreset,
  useCaseKey: UseCaseKey,
): EnrichedLLMModel[] {
  const volume = VOLUME_PRESETS.find((p) => p.key === volumePreset)?.value ?? 100_000;
  const profile = USE_CASE_PROFILES[useCaseKey];

  // 1. Compute percentile-rank value scores and their components
  const components = computeScoreComponents(models);

  // 2. Find top-30% threshold for FinOps badge.
  // ceil(n*0.3)-1 is the last zero-based index inside the top 30% — floor()
  // admitted up to 40% of small populations (e.g. 4 of 10 models).
  const validScores = components
    .map((c) => c.score)
    .filter((v): v is number => v !== null);
  const efficiencyThreshold =
    validScores.length > 0
      ? [...validScores].sort((a, b) => b - a)[
          Math.max(0, Math.ceil(validScores.length * 0.3) - 1)
        ] ?? 65
      : 65;

  // 3. Enrich each model
  return models.map((m, i) => {
    const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
    const optimized = optimizedUseCaseCost(m, profile);
    return {
      ...m,
      openness: opennessOf(m.license),
      efficiencyScore: components[i].score,
      useCaseCost: cost,
      optimizedUseCaseCost: optimized,
      monthlyBudget: cost * volume,
      optimizedMonthlyBudget: optimized * volume,
      volatilityRisk: getVolatilityRisk(m.model, m.releaseDate, m.category),
      isFinOpsFriendly: checkFinOpsFriendly(m, components[i], efficiencyThreshold),
    } as EnrichedLLMModel;
  });
}

// ── Ordering ──

/** The orders compare-llm-models can return its table in. Each reads best
 *  first, so there is no direction argument: quality and value descend, costs
 *  and prices ascend. */
export const LLM_SORT_KEYS = ["elo", "efficiency", "cost", "optimizedCost", "inputPrice", "outputPrice"] as const;
export type LLMSortKey = (typeof LLM_SORT_KEYS)[number];

/** The order the catalogue arrives in (`sortModels` in llm-models.ts), and what
 *  the tool returned before it took a `sortBy`. */
export const DEFAULT_LLM_SORT: LLMSortKey = "elo";

/** A figure that is missing sorts last, whatever the direction. For a price
 *  that includes zero: a non-positive price is a side with no published rate,
 *  not the cheapest one, the same reading `computeScoreComponents` takes. */
const priced = (value: number): number | null => (Number.isFinite(value) && value > 0 ? value : null);

const SORT_SPECS: Record<LLMSortKey, { value: (m: EnrichedLLMModel) => number | null; descending: boolean }> = {
  elo: { value: (m) => m.eloScore || null, descending: true },
  efficiency: { value: (m) => m.efficiencyScore, descending: true },
  cost: { value: (m) => priced(m.useCaseCost), descending: false },
  optimizedCost: { value: (m) => priced(m.optimizedUseCaseCost), descending: false },
  inputPrice: { value: (m) => priced(m.inputPricePer1M), descending: false },
  outputPrice: { value: (m) => priced(m.outputPricePer1M), descending: false },
};

/**
 * Order an enriched table by one of `LLM_SORT_KEYS`, best first.
 *
 * Returns a new array. The sort is stable, so models tied on the sorted figure,
 * and models missing it, keep the order they came in: handed the catalogue as
 * `fetchLLMModels` returns it, that is Arena ELO descending, and `elo` gives
 * the input back unchanged. Costs are compared as raw floats, before the
 * rounding applied at serialisation, which would manufacture ties.
 */
export function sortEnrichedModels<T extends EnrichedLLMModel>(
  models: readonly T[],
  sortBy: LLMSortKey = DEFAULT_LLM_SORT,
): T[] {
  const { value, descending } = SORT_SPECS[sortBy];
  return [...models].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return descending ? vb - va : va - vb;
  });
}

/** How an order reads after "sorted by", for the text block. The two cost
 *  orders depend on the workload, so they name it. */
export function describeSort(sortBy: LLMSortKey, useCaseLabel: string): string {
  switch (sortBy) {
    case "elo":
      return "Arena ELO, highest first (models with no score last)";
    case "efficiency":
      return "efficiency score, highest first (models with no score last)";
    case "cost":
      return `${useCaseLabel} cost per request at list price, cheapest first`;
    case "optimizedCost":
      return `${useCaseLabel} optimized cost per request, cheapest first`;
    case "inputPrice":
      return "input price per 1M tokens, cheapest first";
    case "outputPrice":
      return "output price per 1M tokens, cheapest first";
  }
}
