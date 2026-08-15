import { McpServer } from "skybridge/server";
import pkg from "../../package.json" with { type: "json" };
import { fetchLLMModels, filterModels } from "./lib/llm-models.js";
import type { LLMModel } from "./data/pricing-data.js";
import {
  USE_CASE_KEYS,
  USE_CASE_PROFILES,
  type EnrichedLLMModel,
  VOLUME_PRESETS,
  enrichModels,
  useCaseCost,
  optimizedUseCaseCost,
  formatMicroCost,
  formatMonthlyBudget,
} from "./lib/llm-business-metrics.js";
import type { UseCaseProfile, VolumePreset } from "./lib/llm-business-metrics.js";
import { enrichedInstances, type EnrichedComputeInstance } from "./lib/compute-categories.js";
import {
  TOOL_META,
  compareModelsInputSchema,
  compareModelsOutputSchema,
  estimateCostInputSchema,
  estimateCostOutputSchema,
  computePricingInputSchema,
  computePricingOutputSchema,
} from "./schemas.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const server = new McpServer(
  {
    name: "ai-pricing-hub",
    version: pkg.version,
  },
  { capabilities: {} },
)

// ─── Tool 1: Compare LLM Models ─────────────────────────────────────

.registerWidget(
  "compare-llm-models",
  { description: TOOL_META["compare-llm-models"].title },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description: TOOL_META["compare-llm-models"].description,
    inputSchema: compareModelsInputSchema,
    outputSchema: compareModelsOutputSchema,
  },
  async ({ provider, category, capability, maxInputPrice, maxOutputPrice, minElo, useCasePreset, volumePreset, limit }) => {
    // Every return spreads these defaults so success and failure ship the same
    // key set — the widget's inferred output type stays one shape instead of a
    // union where `error` is missing on half the branches.
    const baseOutput = {
      models: [] as EnrichedLLMModel[],
      useCaseLabel: "",
      volumeLabel: "",
      source: "error",
      matchingCount: 0,
      catalogSize: 0,
      eloAsOf: "",
      dataAsOf: undefined as string | undefined,
      error: undefined as string | undefined,
    };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...baseOutput, error: "Failed to fetch LLM models from OpenRouter API." },
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
      const filtered = filterModels(enriched, {
        provider, category, capability, maxInputPrice, maxOutputPrice, minElo,
      });

      const maxCount = limit || 15;
      const results = filtered.slice(0, maxCount);

      const volumeLabel = VOLUME_PRESETS.find(p => p.key === vol)?.label || vol;
      const useCaseLabel = USE_CASE_PROFILES[ucKey].label;

      // Build text summary for LLM consumption
      const lines = results.map((m, i) =>
        `${i + 1}. ${m.provider} ${m.model} — ` +
        `Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M` +
        (m.eloScore ? `, ELO: ${m.eloScore}` : "") +
        `, ${useCaseLabel} cost: ${formatMicroCost(m.useCaseCost)}/req` +
        ` (optimized: ${formatMicroCost(m.optimizedUseCaseCost)}/req)` +
        `, Monthly (${volumeLabel}): ${formatMonthlyBudget(m.monthlyBudget)}` +
        ` (optimized: ${formatMonthlyBudget(m.optimizedMonthlyBudget)})` +
        (m.isFinOpsFriendly ? " ✅ FinOps Friendly" : "")
      );

      return {
        structuredContent: {
          ...baseOutput,
          models: results,
          useCaseLabel,
          volumeLabel,
          source,
          matchingCount: filtered.length,
          catalogSize: allModels.length,
          eloAsOf,
          dataAsOf,
        },
        content: [
          {
            type: "text",
            text: `${filtered.length} of ${allModels.length} models match (showing top ${results.length}). ` +
              `Use case: ${useCaseLabel}, Volume: ${volumeLabel}/mo. ` +
              `Optimized costs assume prompt caching and, where the use case allows, the batch API.\n\n` +
              lines.join("\n"),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-llm-models] failed:", error);
      return {
        structuredContent: { ...baseOutput, error: message },
        content: [{ type: "text", text: `Error comparing models: ${message}` }],
        isError: true,
      };
    }
  },
)

// ─── Tool 2: Estimate LLM Cost ──────────────────────────────────────

.registerWidget(
  "estimate-llm-cost",
  { description: TOOL_META["estimate-llm-cost"].title },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description: TOOL_META["estimate-llm-cost"].description,
    inputSchema: estimateCostInputSchema,
    outputSchema: estimateCostOutputSchema,
  },
  async ({ modelName, useCasePreset, customInputTokens, customOutputTokens, monthlyVolume }) => {
    type CostEntry = {
      useCase: string;
      inputTokens: number;
      outputTokens: number;
      perRequest: number;
      monthly: number;
      perRequestOptimized: number;
      monthlyOptimized: number;
    };

    const volume = monthlyVolume || 100_000;
    const baseOutput = {
      modelCosts: [] as { model: LLMModel; costs: CostEntry[] }[],
      volume,
      source: "error",
      eloAsOf: "",
      dataAsOf: undefined as string | undefined,
      error: undefined as string | undefined,
    };

    try {
      const { models: allModels, source, eloAsOf, dataAsOf } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          structuredContent: { ...baseOutput, error: "Failed to fetch LLM models." },
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
              ...baseOutput,
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
          ...baseOutput,
          modelCosts,
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
        structuredContent: { ...baseOutput, error: message },
        content: [{ type: "text", text: `Error estimating costs: ${message}` }],
        isError: true,
      };
    }
  },
)

// ─── Tool 3: Compare Compute Pricing ────────────────────────────────

.registerWidget(
  "compare-compute-pricing",
  { description: TOOL_META["compare-compute-pricing"].title },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: TOOL_META["compare-compute-pricing"].description,
    inputSchema: computePricingInputSchema,
    outputSchema: computePricingOutputSchema,
  },
  async ({ provider, category, minVCPUs, maxVCPUs, minMemory, maxMemory, processor, useCase, sortBy, limit }) => {
    const baseOutput = {
      instances: [] as EnrichedComputeInstance[],
      matchingCount: 0,
      catalogSize: enrichedInstances.length,
      error: undefined as string | undefined,
    };

    try {
      const filtered = enrichedInstances.filter(inst => {
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
          ...baseOutput,
          instances: results,
          matchingCount: filtered.length,
        },
        content: [
          {
            type: "text",
            text: `${filtered.length} of ${enrichedInstances.length} compute instances match (showing ${results.length}). ` +
              `Linux on-demand list prices.\n\n` + lines.join("\n"),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[compare-compute-pricing] failed:", error);
      return {
        structuredContent: { ...baseOutput, error: message },
        content: [{ type: "text", text: `Error comparing compute pricing: ${message}` }],
        isError: true,
      };
    }
  },
);

server.run();

export type AppType = typeof server;
