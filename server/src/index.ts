import { McpServer } from "skybridge/server";
import { z } from "zod";
import { fetchLLMModels, filterModels } from "./lib/llm-models.js";
import type { LLMModel } from "./data/pricing-data.js";
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
} from "./lib/llm-business-metrics.js";
import { OPENNESS_VALUES } from "./lib/openness.js";
import type { UseCaseProfile, VolumePreset } from "./lib/llm-business-metrics.js";
import { computeInstances } from "./data/pricing-data.js";
import { enrichInstances } from "./lib/compute-categories.js";

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
        }),
      ),
    }),
  ),
  volume: z.number(),
  source: z.string(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
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
  error: z.string().optional(),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const server = new McpServer(
  {
    name: "ai-pricing-hub",
    version: "0.1.0",
  },
  { capabilities: {} },
)

// ─── Tool 1: Compare LLM Models ─────────────────────────────────────

.registerWidget(
  "compare-llm-models",
  { description: "Compare LLM Models" },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Compare AI/LLM models by price, quality (ELO), efficiency, and capabilities. " +
      "Fetches live data from OpenRouter API. Filter by provider, price tier (category), openness, " +
      "capability, price range, or minimum ELO score. Optionally enrich with business metrics for a use case. " +
      "Price tier and openness are independent: a model can be Frontier-priced and open-weight at once. " +
      "Reports both list-price cost and the optimized cost achievable with prompt caching and the batch API. " +
      "IMPORTANT: Report all prices, costs, and scores EXACTLY as returned. " +
      "Do NOT add commentary, opinions, or recommendations beyond what the data shows. " +
      "Present the results as a table and let the user draw conclusions.",
    inputSchema: {
      provider: z.string().optional().describe("Filter by provider name (e.g. 'OpenAI', 'Anthropic', 'Google')"),
      category: z.string().optional().describe("Filter by price tier: Frontier, Mid-tier, Budget, Image"),
      openness: z.enum(OPENNESS_VALUES as [string, ...string[]]).optional().describe("Filter by self-hostability, derived from the licence: Open source, Open weights, Proprietary, Unknown"),
      capability: z.string().optional().describe("Filter by capability: Text, Vision, Code, Reasoning, Agents, Image Gen, Audio"),
      maxInputPrice: z.number().optional().describe("Max input price per 1M tokens in USD"),
      maxOutputPrice: z.number().optional().describe("Max output price per 1M tokens in USD"),
      minElo: z.number().optional().describe("Minimum ELO score (quality benchmark from Chatbot Arena)"),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Use case for cost estimation. Default: supportTicket"),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      limit: z.number().min(1).max(50).optional().describe("Max models to return (default: 15)"),
    },
    outputSchema: compareModelsOutputSchema,
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
      const { models: allModels, source, eloAsOf, dataAsOf } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...emptyOutput, error: "Failed to fetch LLM models from OpenRouter API." },
          content: [{ type: "text", text: "Failed to fetch LLM models from OpenRouter API." }],
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
          models: results,
          useCaseLabel,
          volumeLabel,
          source,
          matchingCount: filtered.length,
          catalogSize: allModels.length,
          eloAsOf,
          dataAsOf,
          finopsBadge,
        },
        content: [
          {
            type: "text",
            text: `${filtered.length} of ${allModels.length} models match (showing top ${results.length}). ` +
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
  { description: "Estimate LLM Cost" },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Estimate per-request and monthly costs for AI/LLM models across different use cases and volumes. " +
      "Provide a model name to get detailed cost breakdowns, or compare costs across all use case presets. " +
      "Each figure comes twice: list price, and the optimized price achievable with prompt caching and the batch API. " +
      "IMPORTANT: Report all cost figures EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      modelName: z.string().optional().describe("Model name to estimate costs for (e.g. 'GPT-4o', 'Claude Sonnet 4'). If omitted, shows top models."),
      useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Use case preset. Default: all presets."),
      customInputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom input tokens per request (overrides preset)"),
      customOutputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom output tokens per request (overrides preset)"),
      monthlyVolume: z.number().int().min(1).max(1_000_000_000).optional().describe("Custom monthly volume (default: 100,000)"),
    },
    outputSchema: estimateCostOutputSchema,
  },
  async ({ modelName, useCasePreset, customInputTokens, customOutputTokens, monthlyVolume }) => {
    const volume = monthlyVolume || 100_000;
    const emptyOutput = { modelCosts: [], volume, source: "error", eloAsOf: "" };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf } = await fetchLLMModels();

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
        const search = modelName.toLowerCase();
        targetModels = allModels.filter(
          m => m.model.toLowerCase().includes(search) || m.provider.toLowerCase().includes(search)
        ).slice(0, 5);
        if (targetModels.length === 0) {
          return {
            structuredContent: {
              ...emptyOutput,
              source,
              eloAsOf,
              dataAsOf,
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
      };

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
          `(optimized: ${formatMicroCost(c.perRequestOptimized)}/req → ${formatMonthlyBudget(c.monthlyOptimized)}/mo) ` +
          `(${c.inputTokens} in + ${c.outputTokens} out tokens)`
        );
        return `${m.provider} ${m.model} (Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M)\n${costLines.join("\n")}`;
      });

      return {
        structuredContent: {
          modelCosts,
          volume,
          source,
          eloAsOf,
          dataAsOf,
        },
        content: [
          {
            type: "text",
            text: `Cost estimates for ${targetModels.length} model(s) at ${volume.toLocaleString()} requests/month:\n\n` + lines.join("\n\n"),
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

// ─── Tool 3: Compare Compute Pricing ────────────────────────────────

.registerWidget(
  "compare-compute-pricing",
  { description: "Compare Cloud Compute Pricing" },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description:
      "Compare cloud compute instance pricing across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba. " +
      "Filter by provider, vCPUs, memory, category, processor, or use case. " +
      "All prices are Linux on-demand list prices in USD. " +
      "IMPORTANT: Report all prices EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      provider: z.string().optional().describe("Cloud provider: AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba"),
      category: z.string().optional().describe("Instance category: General Purpose, Compute Optimized, Memory Optimized, Storage Optimized, GPU / Accelerated, Burstable"),
      minVCPUs: z.number().optional().describe("Minimum number of vCPUs"),
      maxVCPUs: z.number().optional().describe("Maximum number of vCPUs"),
      minMemory: z.number().optional().describe("Minimum memory in GiB"),
      maxMemory: z.number().optional().describe("Maximum memory in GiB"),
      processor: z.string().optional().describe("Processor filter: Intel, AMD, Graviton, Ampere, NVIDIA A100, NVIDIA H100, etc."),
      useCase: z.string().optional().describe("Use case filter: Web App, Database, HPC, ML & AI, Dev/Test, Big Data"),
      sortBy: z.enum(["price", "vcpus", "memory", "pricePerVCPU"]).optional().describe("Sort by: price, vcpus, memory, pricePerVCPU. Default: price"),
      limit: z.number().min(1).max(50).optional().describe("Max instances to return (default: 20)"),
    },
    outputSchema: computePricingOutputSchema,
  },
  async ({ provider, category, minVCPUs, maxVCPUs, minMemory, maxMemory, processor, useCase, sortBy, limit }) => {
    try {
      const enriched = enrichInstances(computeInstances);

      const filtered = enriched.filter(inst => {
        if (provider && inst.provider.toLowerCase() !== provider.toLowerCase()) return false;
        if (category && inst.category.toLowerCase() !== category.toLowerCase()) return false;
        if (inst.os !== "Linux") return false;
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
        },
        content: [
          {
            type: "text",
            text: `${filtered.length} of ${enriched.length} compute instances match (showing ${results.length}). ` +
              `Linux on-demand list prices.\n\n` + lines.join("\n"),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-compute-pricing] failed:", error);
      return {
        structuredContent: { instances: [], matchingCount: 0, catalogSize: 0, error: message },
        content: [{ type: "text", text: `Error comparing compute pricing: ${message}` }],
        isError: true,
      };
    }
  },
);

server.run();

export type AppType = typeof server;
