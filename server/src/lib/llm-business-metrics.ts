import type { LLMModel } from "../data/pricing-data.js";

// ── Types ──

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

// ── Business metric functions ──

/** Cost per single request for a use case profile */
export function useCaseCost(inputPrice: number, outputPrice: number, profile: UseCaseProfile): number {
  return (profile.inputTokens / 1e6) * inputPrice + (profile.outputTokens / 1e6) * outputPrice;
}

/** Unit cost assuming the FinOps optimizations this use case allows:
 *  - batch API pricing when the workload is async (batchEligible)
 *  - prompt-cache read pricing on the cacheHitRate share of input tokens
 *  Falls back to list prices when a model doesn't publish batch/cache rates,
 *  so the optimized cost is never lower than what is actually achievable. */
export function optimizedUseCaseCost(model: LLMModel, profile: UseCaseProfile): number {
  const useBatch =
    profile.batchEligible &&
    model.batchInputPricePer1M !== undefined &&
    model.batchOutputPricePer1M !== undefined;

  const baseIn = useBatch ? model.batchInputPricePer1M! : model.inputPricePer1M;
  const baseOut = useBatch ? model.batchOutputPricePer1M! : model.outputPricePer1M;

  // Cache reads: published rate only, applied as-is even under batch.
  // (Some providers also discount cache reads in batch, but we don't have a
  // published batch-cache rate — using the standard cache rate is the
  // conservative, defensible choice. No published rate -> no cache discount.)
  const cacheRead =
    model.cachedInputPricePer1M !== undefined ? model.cachedInputPricePer1M : baseIn;

  const effectiveIn = cacheRead * profile.cacheHitRate + baseIn * (1 - profile.cacheHitRate);
  return (profile.inputTokens / 1e6) * effectiveIn + (profile.outputTokens / 1e6) * baseOut;
}

/** Compute percentile-rank-based value scores for all models.
 *  Blends ELO quality (60%) with price affordability (40%) so frontier
 *  models aren't crushed by budget models in the ranking. */
export function computeValueScores(models: LLMModel[]): (number | null)[] {
  const withElo = models
    .map((m, i) => ({ i, elo: m.eloScore, price: m.inputPricePer1M * 0.3 + m.outputPricePer1M * 0.7, category: m.category }))
    .filter((e) => e.elo && e.category !== "Image");

  if (withElo.length === 0) return models.map(() => null);
  if (withElo.length === 1) {
    const result: (number | null)[] = models.map(() => null);
    result[withElo[0].i] = 50;
    return result;
  }

  const denom = withElo.length - 1;

  // Rank by ELO descending → percentile (highest ELO = 100)
  const eloSorted = [...withElo].sort((a, b) => b.elo! - a.elo!);
  const eloPercentile = new Map<number, number>();
  eloSorted.forEach((e, rank) => eloPercentile.set(e.i, ((denom - rank) / denom) * 100));

  // Rank by price ascending → percentile (cheapest = 100)
  const priceSorted = [...withElo].sort((a, b) => a.price - b.price);
  const pricePercentile = new Map<number, number>();
  priceSorted.forEach((e, rank) => pricePercentile.set(e.i, ((denom - rank) / denom) * 100));

  return models.map((_, i) => {
    const ep = eloPercentile.get(i);
    const pp = pricePercentile.get(i);
    if (ep === undefined || pp === undefined) return null;
    return Math.round(ep * 0.6 + pp * 0.4);
  });
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

/** Check if model qualifies as FinOps Friendly (all 3 criteria required):
 *  1. ELO ≥ 1250 (proven quality)
 *  2. Efficiency in top 30% (good value)
 *  3. Stable release (no preview/beta/experimental) */
export function checkFinOpsFriendly(
  elo: number | undefined,
  valueScore: number | null,
  top30Threshold: number,
  modelName: string,
): boolean {
  if (!elo || elo < 1250) return false;
  if (valueScore === null || valueScore < top30Threshold) return false;
  const nameLower = modelName.toLowerCase();
  if (nameLower.includes("preview") || nameLower.includes("beta") || nameLower.includes("experimental")) return false;
  return true;
}

// ── Formatting helpers ──

/** Format sub-cent costs: $0.0042 */
export function formatMicroCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Format monthly budget: $1.2K, $450, $0.14 */
export function formatMonthlyBudget(cost: number): string {
  if (cost >= 1_000_000) return `$${(cost / 1_000_000).toFixed(1)}M`;
  if (cost >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`;
  if (cost >= 1) return `$${cost.toFixed(0)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

// ── Enrichment pipeline ──

/** Enrich filtered models with business metrics for the selected use case */
export function enrichModels(
  models: LLMModel[],
  volumePreset: VolumePreset,
  useCaseKey: UseCaseKey,
): EnrichedLLMModel[] {
  const volume = VOLUME_PRESETS.find((p) => p.key === volumePreset)?.value ?? 100_000;
  const profile = USE_CASE_PROFILES[useCaseKey];

  // 1. Compute percentile-rank value scores
  const valueScores = computeValueScores(models);

  // 2. Find top-30% threshold for FinOps badge.
  // ceil(n*0.3)-1 is the last zero-based index inside the top 30% — floor()
  // admitted up to 40% of small populations (e.g. 4 of 10 models).
  const validScores = valueScores.filter((v): v is number => v !== null);
  const top30Threshold =
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
      efficiencyScore: valueScores[i],
      useCaseCost: cost,
      optimizedUseCaseCost: optimized,
      monthlyBudget: cost * volume,
      optimizedMonthlyBudget: optimized * volume,
      volatilityRisk: getVolatilityRisk(m.model, m.releaseDate, m.category),
      isFinOpsFriendly: checkFinOpsFriendly(m.eloScore, valueScores[i], top30Threshold, m.model),
    } as EnrichedLLMModel;
  });
}
