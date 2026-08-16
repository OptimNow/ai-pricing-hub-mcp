import type { LLMModel } from "../data/pricing-data.js";

// ── Types ──

export type ViewMode = "business" | "technical";
export type VolumePreset = "10k" | "100k" | "1m";
export type VolatilityLevel = "High" | "Medium" | "Stable" | "Unknown";

export interface UseCaseProfile {
  label: string;
  shortLabel: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EnrichedLLMModel extends LLMModel {
  costEfficiency: number | null;
  useCaseCost: number;
  monthlyBudget: number;
  volatilityRisk: VolatilityLevel;
  isFinOpsFriendly: boolean;
}

// ── Constants ──

export const USE_CASE_PROFILES: Record<string, UseCaseProfile> = {
  supportTicket:     { label: "Support Ticket",     shortLabel: "Support",   inputTokens: 1500,  outputTokens: 500   },
  knowledgeQA:       { label: "Knowledge Q&A",      shortLabel: "Q&A",       inputTokens: 2000,  outputTokens: 800   },
  meetingSummary:    { label: "Meeting Summary",     shortLabel: "Meeting",   inputTokens: 10000, outputTokens: 1200  },
  marketingContent:  { label: "Marketing Content",   shortLabel: "Marketing", inputTokens: 2500,  outputTokens: 1800  },
  codingTask:        { label: "Coding Task",         shortLabel: "Coding",    inputTokens: 3000,  outputTokens: 2000  },
  invoiceProcessing: { label: "Invoice Processing",  shortLabel: "Invoice",   inputTokens: 1500,  outputTokens: 600   },
  callSummary:       { label: "Call Summary",         shortLabel: "Call",      inputTokens: 2000,  outputTokens: 700   },
  agentWorkflow:     { label: "Agent Workflow",       shortLabel: "Agent",     inputTokens: 6000,  outputTokens: 3000  },
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
  if (elo >= 1350) return { label: "S", className: "bg-[hsl(0,65%,55%,0.2)] text-[hsl(0,65%,70%)] ring-1 ring-[hsl(0,65%,55%,0.3)]", title: "S-Tier: Elite (ELO 1350+)" };
  if (elo >= 1280) return { label: "A", className: "bg-[hsl(35,80%,55%,0.2)] text-[hsl(35,80%,70%)] ring-1 ring-[hsl(35,80%,55%,0.3)]", title: "A-Tier: High quality (ELO 1280–1349)" };
  if (elo >= 1200) return { label: "B", className: "bg-[hsl(210,70%,55%,0.2)] text-[hsl(210,70%,70%)] ring-1 ring-[hsl(210,70%,55%,0.3)]", title: "B-Tier: Good quality (ELO 1200–1279)" };
  return { label: "C", className: "bg-[hsl(0,0%,50%,0.15)] text-[hsl(0,0%,65%)]", title: "C-Tier: Standard (ELO below 1200)" };
}

// ── Business metric functions ──

/** Parse context window string like "200K" or "2M" → numeric tokens */
export function parseContextWindow(ctx: string): number {
  const match = ctx.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") return num * 1_000;
  if (suffix === "M") return num * 1_000_000;
  if (suffix === "B") return num * 1_000_000_000;
  return num;
}

/** Cost per single request for a use case profile */
export function useCaseCost(inputPrice: number, outputPrice: number, profile: UseCaseProfile): number {
  return (profile.inputTokens / 1e6) * inputPrice + (profile.outputTokens / 1e6) * outputPrice;
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

// ── Serialisation helpers ──

/** Decimal places a cost keeps when it crosses the wire as JSON.
 *  Per-request costs are routinely sub-cent, so they keep 6 places — the same
 *  floor formatMicroCost() uses. Monthly budgets are dollars, so 2 is cents. */
export const PER_REQUEST_DECIMALS = 6;
export const MONTHLY_DECIMALS = 2;

/** Drop IEEE-754 representation noise from a cost that is about to be
 *  serialised into structuredContent.
 *
 *  useCaseCost() is arithmetically right; the binary float it returns is what
 *  is ugly. 3000/1e6 × $15 + 2000/1e6 × $120 is exactly 0.45, yet lands on
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

// ── Enrichment pipeline ──

/** Enrich filtered models with business metrics for the selected use case */
export function enrichModels(
  models: LLMModel[],
  volumePreset: VolumePreset,
  useCaseKey: string,
): EnrichedLLMModel[] {
  const volume = VOLUME_PRESETS.find((p) => p.key === volumePreset)?.value ?? 100_000;
  const profile = USE_CASE_PROFILES[useCaseKey] ?? USE_CASE_PROFILES.supportTicket;

  // 1. Compute percentile-rank value scores
  const valueScores = computeValueScores(models);

  // 2. Find top-30% threshold for FinOps badge
  const validScores = valueScores.filter((v): v is number => v !== null);
  const top30Threshold = validScores.length > 0
    ? [...validScores].sort((a, b) => b - a)[Math.floor(validScores.length * 0.3)] ?? 65
    : 65;

  // 3. Enrich each model
  return models.map((m, i) => {
    const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
    return {
      ...m,
      costEfficiency: valueScores[i],
      useCaseCost: cost,
      monthlyBudget: cost * volume,
      volatilityRisk: getVolatilityRisk(m.model, m.releaseDate, m.category),
      isFinOpsFriendly: checkFinOpsFriendly(m.eloScore, valueScores[i], top30Threshold, m.model),
    } as EnrichedLLMModel;
  });
}
