import { McpServer } from "skybridge/server";
import { z } from "zod";
import { fetchLLMModels, filterModels, matchModels, resolveModel } from "./lib/llm-models.js";
import type { ResolutionStatus } from "./lib/llm-models.js";
import type { LLMModel, ComputeInstance } from "./data/pricing-data.js";
import {
  USE_CASE_KEYS,
  USE_CASE_PROFILES,
  VOLUME_PRESETS,
  enrichModels,
  summarizeFinOpsBadge,
  useCaseCost,
  optimizedUseCaseCost,
  formatMicroCost,
  formatMonthlyBudget,
  roundPerRequestCost,
  roundMonthlyCost,
  roundPricePer1MOrNull,
  optimizationLevers,
  savingsPct,
  leverSummary,
} from "./lib/llm-business-metrics.js";
import { OPENNESS_VALUES } from "./lib/openness.js";
import type {
  UseCaseProfile,
  VolumePreset,
  UseCaseKey,
  EnrichedLLMModel,
  OptimizationLevers,
} from "./lib/llm-business-metrics.js";
import { roiCalculatorUrl } from "./lib/roi-link.js";
import { enrichInstances } from "./lib/compute-categories.js";
import type { EnrichedComputeInstance } from "./lib/compute-categories.js";
import { outputSchema } from "./lib/output-schema.js";
import {
  PRICING_REGIONS,
  DEFAULT_PRICING_REGION,
  fetchComputeInstances,
} from "./lib/compute-pricing.js";
import type { PricingRegion } from "./lib/compute-pricing.js";

// ─── Output schemas ─────────────────────────────────────────────────
// Mirror the structuredContent each tool returns, error paths included, so the
// widgets and any downstream consumer get a contract instead of a guess.

const modelShape = {
  provider: z.string(),
  model: z.string(),
  parameters: z.string().optional(),
  inputPricePer1M: z.number(),
  outputPricePer1M: z.number(),
  batchInputPricePer1M: z.number().optional(),
  batchOutputPricePer1M: z.number().optional(),
  cachedInputPricePer1M: z.number().optional(),
  contextWindow: z.string(),
  category: z.string(),
  capabilities: z.array(z.string()),
  releaseDate: z.string().optional(),
  eloScore: z.number().optional(),
  license: z.string().optional(),
};

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
   *  the widget can name them instead of assuming caching. */
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
  upstreamErrors: z.array(z.string()).optional(),
  // Tier-2 diagnostics. `fallbackReason` says why tier 1 was missed, classified
  // and timed; `unappliedFilters` names the arguments this tier accepted and
  // then could not honour, so a consumer reading only `instances` is not left
  // to infer that from an empty array.
  fallbackReason: z.string().optional(),
  unappliedFilters: z.array(z.string()).optional(),
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
 *  optimization levers actually applied. The levers ship so the widget can say
 *  *why* a saving is 0% instead of drawing an empty bar. */
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
});

const recommendOutputSchema = {
  recommendations: z.array(recommendationSchema),
  /** Populated only when `overConstrained` — the nearest models, each carrying
   *  the constraint it failed, so an impossible query still answers something. */
  nearMisses: z.array(recommendationSchema),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const server = new McpServer(
  {
    name: "ai-pricing-hub",
    version: "0.3.0",
  },
  { capabilities: {} },
)

// ─── Tool 1: Compare LLM Models ─────────────────────────────────────

.registerWidget(
  "compare-llm-models",
  { description: "Compare LLM Models", hosts: ["mcp-app"], annotations: { audience: ["assistant"] } },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare LLM Models",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Browse and filter the whole LLM catalogue and get back a ranked table: price, quality (ELO), " +
      "efficiency and capabilities. Use this when the user wants to SEE THE FIELD — 'show me models " +
      "under $1/1M', 'which providers have vision models', 'list open-weight models above ELO 1300'. " +
      "For a single PICK under a budget use recommend-llm-model; to weigh 2-4 NAMED models against " +
      "each other use compare-models-side-by-side. " +
      "Prices come from optimtoken.optimnow.io where reachable; the response's `provenance` says which tier served them and whether they are vendor-verified. Filter by provider, price tier (category), openness, " +
      "capability, price range, or minimum ELO score. Optionally enrich with business metrics for a use case. " +
      "Price tier and openness are independent: a model can be Frontier-priced and open-weight at once. " +
      "Reports both list-price cost and the optimized cost achievable with prompt caching and the batch API. " +
      "IMPORTANT: Report all prices, costs, and scores EXACTLY as returned. " +
      "Do NOT add commentary, opinions, or recommendations beyond what the data shows. " +
      "Present the results as a table and let the user draw conclusions.",
    inputSchema: {
      provider: z.string().optional().describe("Filter by provider name (e.g. 'OpenAI', 'Anthropic', 'Google')"),
      category: z.string().optional().describe("Price tier, matched by exact equality (case-insensitive): Frontier, Mid-tier, Budget, Image. This is cost only — self-hostability is the separate `openness` axis."),
      openness: z.enum(OPENNESS_VALUES as [string, ...string[]]).optional().describe("Filter by self-hostability, derived from the licence: Open source, Open weights, Proprietary, Unknown"),
      capability: z.string().optional().describe("Capability, matched by exact equality (case-insensitive): Text, Vision, Code, Reasoning, Agents, Image Gen, Audio. Any other string returns zero matches."),
      maxInputPrice: z.number().optional().describe("Max input price per 1M tokens in USD"),
      maxOutputPrice: z.number().optional().describe("Max output price per 1M tokens in USD"),
      minElo: z.number().positive().optional().describe("Minimum Chatbot Arena ELO score. Typical range 1000-1500; ~1400 is roughly frontier-class. Models with no ELO score never satisfy this."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k). Default: supportTicket"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      limit: z.number().min(1).max(50).optional().describe("Max models to return (default: 15)"),
    },
    outputSchema: outputSchema(compareModelsOutputSchema),
  },
  async ({ provider, category, openness, capability, maxInputPrice, maxOutputPrice, minElo, useCasePreset, volumePreset, limit }) => {
    const emptyOutput = {
      models: [],
      useCaseLabel: "",
      volumeLabel: "",
      source: "error",
      matchingCount: 0,
      catalogSize: 0,
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

      const maxCount = limit || 15;
      const results = filtered.slice(0, maxCount);

      const volumeLabel = VOLUME_PRESETS.find(p => p.key === vol)?.label || vol;
      const useCaseLabel = USE_CASE_PROFILES[ucKey].label;

      // Build text summary for LLM consumption
      const lines = results.map((m, i) =>
        `${i + 1}. ${m.provider} ${m.model} — ` +
        `${m.category}, ${m.openness}` +
        `, Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M` +
        (m.eloScore ? `, ELO: ${m.eloScore}` : "") +
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
              `${filtered.length} of ${allModels.length} models match (showing top ${results.length}). ` +
              `Use case: ${useCaseLabel}, Volume: ${volumeLabel}/mo. ` +
              `Optimized costs assume prompt caching and, where the use case allows, the batch API.\n` +
              `FinOps Friendly today means ELO ≥ ${finopsBadge.minElo ?? "n/a"} and a blended list price ` +
              `≤ $${finopsBadge.maxBlendedPrice?.toFixed(2) ?? "n/a"}/1M, plus a top-30% efficiency score ` +
              `and a stable release — ${finopsBadge.qualifying} of ${finopsBadge.ranked} ranked models qualify.\n\n` +
              lines.join("\n"),
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
)

// ─── Tool 2: Estimate LLM Cost ──────────────────────────────────────

.registerWidget(
  "estimate-llm-cost",
  { description: "Estimate LLM Cost", hosts: ["mcp-app"], annotations: { audience: ["assistant"] } },
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
      "IMPORTANT: Report all cost figures EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      modelName: z.string().optional().describe("Model name, e.g. 'GPT-4o'. A partial name matches up to 5 models and ALL of them are costed. If omitted, the first 8 catalogue entries are used — that is catalogue order, not a quality ranking."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k). Default: every preset."),
      customInputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom input tokens per request. Must be supplied TOGETHER with customOutputTokens — either alone is ignored and the preset is used. A custom shape assumes no cacheable prefix and no batch eligibility, so its optimized cost equals its list cost."),
      customOutputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom output tokens per request. Must be supplied TOGETHER with customInputTokens — either alone is ignored and the preset is used."),
      monthlyVolume: z.number().int().min(1).max(1_000_000_000).optional().describe("Exact monthly request count, any integer (default 100,000). This tool does not take the 10k/100k/1m presets the other cost tools use."),
    },
    outputSchema: outputSchema(estimateCostOutputSchema),
  },
  async ({ modelName, useCasePreset, customInputTokens, customOutputTokens, monthlyVolume }) => {
    const volume = monthlyVolume || 100_000;
    const emptyOutput = { modelCosts: [], volume, source: "error", eloAsOf: "" };

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
      } & OptimizationLevers;

      const entry = (m: LLMModel, useCase: string, profile: UseCaseProfile): CostEntry => {
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
        };
      };

      const modelCosts: { model: LLMModel; costs: CostEntry[] }[] = targetModels.map(m => {
        const costs: CostEntry[] = [];

        if (customInputTokens !== undefined && customOutputTokens !== undefined) {
          // No caching or batch assumption on a custom shape: we know nothing
          // about how repetitive or async the caller's workload is.
          const profile: UseCaseProfile = {
            label: "Custom", shortLabel: "Custom",
            inputTokens: customInputTokens, outputTokens: customOutputTokens,
            cacheHitRate: 0, batchEligible: false,
          };
          costs.push(entry(m, "Custom", profile));
        } else if (useCasePreset) {
          const profile = USE_CASE_PROFILES[useCasePreset];
          costs.push(entry(m, profile.label, profile));
        } else {
          for (const key of USE_CASE_KEYS) {
            const profile = USE_CASE_PROFILES[key];
            costs.push(entry(m, profile.label, profile));
          }
        }

        return { model: m, costs };
      });

      // Build text summary
      const lines = modelCosts.map(({ model: m, costs }) => {
        const costLines = costs.map(c =>
          `  ${c.useCase}: ${formatMicroCost(c.perRequest)}/req → ${formatMonthlyBudget(c.monthly)}/mo ` +
          `(${c.inputTokens} in + ${c.outputTokens} out tokens)
` +
          `    optimized: ${formatMicroCost(c.perRequestOptimized)}/req → ${formatMonthlyBudget(c.monthlyOptimized)}/mo` +
          (c.savingsPct > 0
            ? ` — save ${c.savingsPct}% with ${leverSummary(c)}`
            : ` — no saving available (${leverSummary(c)})`)
        );
        return `${m.provider} ${m.model} (Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M)\n${costLines.join("\n")}`;
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
              `Cost estimates for ${targetModels.length} model(s) at ${volume.toLocaleString()} requests/month:\n\n` + lines.join("\n\n"),
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
)

// ─── Tool 3: Compare Models Side by Side ────────────────────────────

.registerWidget(
  "compare-models-side-by-side",
  { description: "Compare Models Side by Side", hosts: ["mcp-app"], annotations: { audience: ["assistant"] } },
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
      "Every name is resolved against the catalogue and the result is reported: a name that matched " +
      "nothing, matched several models, or duplicated an earlier pick is stated explicitly. " +
      "IMPORTANT: Report all prices and costs EXACTLY as returned, and repeat any name-resolution " +
      "warning to the user — a missing column is not the same as a model that costs nothing.",
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

      // One pass per requested name, keeping the caller's order and recording
      // every miss: dropping a column silently is the failure mode to avoid.
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

      const describe = (r: ResolutionEntry): string => {
        switch (r.status) {
          case "not-found": return `"${r.query}" matched no model — no column for it.`;
          case "duplicate": return `"${r.query}" resolved to ${r.resolved}, already selected by an earlier name — no extra column.`;
          case "ambiguous": {
            const undisclosed = r.totalMatches - 1 - r.alternatives.length;
            return `"${r.query}" matched ${r.totalMatches} models; used ${r.resolved}` +
              (r.alternatives.length > 0
                ? ` (also matched: ${r.alternatives.join(", ")}${undisclosed > 0 ? `, and ${undisclosed} more` : ""})`
                : "") + ".";
          }
          default: return `"${r.query}" → ${r.resolved}.`;
        }
      };

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
              `${header.join("\n")}\n\n${rows.join("\n\n")}`,
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
)

// ─── Tool 4: Recommend an LLM Model ─────────────────────────────────

.registerWidget(
  "recommend-llm-model",
  { description: "Recommend an LLM Model", hosts: ["mcp-app"], annotations: { audience: ["assistant"] } },
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
      "When nothing satisfies every constraint the query is reported as over-constrained and the " +
      "nearest misses are returned instead, each carrying the constraint it failed. " +
      "IMPORTANT: Report the returned facts EXACTLY. The ranking is already computed — do not " +
      "re-rank, and do not present a near miss as if it satisfied the constraints.",
    inputSchema: {
      useCasePreset: z.enum(USE_CASE_KEYS).describe("Workload shape, which sets tokens per request: supportTicket (1.5k in / 500 out), knowledgeQA (2k / 800), meetingSummary (10k / 1.2k, batch-eligible), marketingContent (2.5k / 1.8k), codingTask (3k / 2k), invoiceProcessing (1.5k / 600, batch-eligible), callSummary (2k / 700, batch-eligible), agentWorkflow (6k / 3k)."),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      maxMonthlyBudget: z.number().positive().optional().describe("Maximum monthly budget in USD at the given volume. Tested against the LIST-price monthly cost, not the caching/batch-optimized cost."),
      minElo: z.number().positive().optional().describe("Minimum Chatbot Arena ELO score. Typical range 1000-1500; ~1400 is roughly frontier-class. Models with no ELO score never satisfy this."),
      requiredCapability: z.string().optional().describe("Capability the model must have: Text, Vision, Code, Reasoning, Agents, Image Gen, Audio"),
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

      const evaluated = ranked.map(m => ({ m, constraints: checks(m), shortfall: shortfall(m) }));
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
      });

      const results = shortlist.map(build);
      const useCaseLabel = USE_CASE_PROFILES[ucKey].label;
      const volumeLabel = volumeEntry?.label ?? vol;

      const lines = results.map(r =>
        `${r.rank}. ${r.provider} ${r.model} — ELO ${r.eloScore ?? "n/a"}, ` +
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
          `(${passing.length} of ${ranked.length} ranked models satisfy all constraints; ${allModels.length} catalogue entries):`;

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
              `${preamble}\n\n${lines.join("\n")}\n\n` +
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
)

// ─── Tool 5: Compare Compute Pricing ────────────────────────────────

.registerWidget(
  "compare-compute-pricing",
  { description: "Compare Cloud Compute Pricing", hosts: ["mcp-app"], annotations: { audience: ["assistant"] } },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    title: "Compare Cloud Compute Pricing",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Compare cloud compute instance pricing across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba. " +
      "Filter by region, provider, vCPUs, memory, category, processor, or use case. " +
      "All prices are Linux on-demand list prices in USD. " +
      "Not every price column is live: `provenance.priceTypes` says which of each provider's price " +
      "columns come from a live API, which are static constants, and which are unavailable, and " +
      "`provenance.staticPriceColumns` lists the non-live ones outright. When you report a savings " +
      "plan or reserved rate that appears there, say that it is a static estimate. " +
      "IMPORTANT: Report all prices EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      region: z.enum(PRICING_REGIONS).optional().describe(`Pricing region: ${PRICING_REGIONS.join(", ")}. Default: ${DEFAULT_PRICING_REGION}`),
      provider: z.string().optional().describe("Cloud provider. Must be one of these exactly (case-insensitive): AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba. Any other string returns zero matches rather than an error."),
      category: z.string().optional().describe("Instance category. Must be one of these exactly (case-insensitive): General Purpose, Compute Optimized, Memory Optimized, Storage Optimized, GPU / Accelerated, Burstable. Any other string returns zero matches rather than an error."),
      minVCPUs: z.number().optional().describe("Minimum number of vCPUs"),
      maxVCPUs: z.number().optional().describe("Maximum number of vCPUs"),
      minMemory: z.number().optional().describe("Minimum memory in GiB"),
      maxMemory: z.number().optional().describe("Maximum memory in GiB"),
      processor: z.string().optional().describe("Processor. Matched by exact equality (case-insensitive), so a partial value like 'H100' returns nothing. Known values: Intel, AMD, Graviton, Ampere, NVIDIA A100, NVIDIA H100, NVIDIA L4, NVIDIA T4, NVIDIA V100, NVIDIA Other."),
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
      const subsetCaveat =
        provenance.tier === 2 && filtered.length === 0
          ? `\nNOTE: this is the ${enriched.length}-row static snapshot, not the ~5,800-instance ` +
            `live catalogue, so "no match" here does not mean no such instance exists.` +
            (unapplied.length ? ` Filters accepted but NOT applied: ${unapplied.join(", ")}.` : "")
          : "";

      // Build text summary
      const lines = results.map((inst, i) =>
        `${i + 1}. ${inst.provider} ${inst.instanceType} — ` +
        `${inst.vCPUs} vCPUs, ${inst.memory} GiB, ${inst.processor}, ` +
        `$${inst.onDemandHourly?.toFixed(4)}/hr ($${inst.onDemandMonthly?.toFixed(2)}/mo)` +
        (inst.spot ? `, Spot: $${inst.spot.toFixed(4)}/hr` : "") +
        ` [${inst.category}]`
      );

      return {
        structuredContent: {
          instances: results,
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
              `${filtered.length} of ${enriched.length} compute instances match (showing ${results.length}). ` +
              `Linux on-demand list prices.${subsetCaveat}\n\n` + lines.join("\n"),
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

server.run();

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
 * Deliberately fire-and-forget: `server.run()` must not wait on an upstream
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

export type AppType = typeof server;
