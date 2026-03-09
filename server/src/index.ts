import { McpServer } from "skybridge/server";
import { z } from "zod";
import { fetchLLMModels, filterModels } from "./lib/llm-models.js";
import type { LLMModel } from "./data/pricing-data.js";
import {
  USE_CASE_PROFILES,
  VOLUME_PRESETS,
  enrichModels,
  useCaseCost,
  formatMicroCost,
  formatMonthlyBudget,
} from "./lib/llm-business-metrics.js";
import type { VolumePreset } from "./lib/llm-business-metrics.js";
import { computeInstances } from "./data/pricing-data.js";
import { enrichInstances } from "./lib/compute-categories.js";

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
    description:
      "Compare AI/LLM models by price, quality (ELO), efficiency, and capabilities. " +
      "Fetches live data from OpenRouter API. Filter by provider, category, capability, " +
      "price range, or minimum ELO score. Optionally enrich with business metrics for a use case. " +
      "IMPORTANT: Report all prices, costs, and scores EXACTLY as returned. " +
      "Do NOT add commentary, opinions, or recommendations beyond what the data shows. " +
      "Present the results as a table and let the user draw conclusions.",
    inputSchema: {
      provider: z.string().optional().describe("Filter by provider name (e.g. 'OpenAI', 'Anthropic', 'Google')"),
      category: z.string().optional().describe("Filter by category: Frontier, Mid-tier, Budget, Open Weights, Image"),
      capability: z.string().optional().describe("Filter by capability: Text, Vision, Code, Reasoning, Agents, Image Gen, Audio"),
      maxInputPrice: z.number().optional().describe("Max input price per 1M tokens in USD"),
      maxOutputPrice: z.number().optional().describe("Max output price per 1M tokens in USD"),
      minElo: z.number().optional().describe("Minimum ELO score (quality benchmark from Chatbot Arena)"),
      useCasePreset: z.string().optional().describe(
        "Use case for cost estimation: supportTicket, knowledgeQA, meetingSummary, " +
        "marketingContent, codingTask, invoiceProcessing, callSummary, agentWorkflow"
      ),
      volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
      limit: z.number().min(1).max(50).optional().describe("Max models to return (default: 15)"),
    },
  },
  async ({ provider, category, capability, maxInputPrice, maxOutputPrice, minElo, useCasePreset, volumePreset, limit }) => {
    try {
      const { models: allModels, source } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
          content: [{ type: "text", text: "Failed to fetch LLM models from OpenRouter API." }],
          isError: true,
        };
      }

      const filtered = filterModels(allModels, {
        provider, category, capability, maxInputPrice, maxOutputPrice, minElo,
      });

      const vol = (volumePreset || "100k") as VolumePreset;
      const ucKey = useCasePreset || "supportTicket";
      const enriched = enrichModels(filtered, vol, ucKey);

      const maxCount = limit || 15;
      const results = enriched.slice(0, maxCount);

      const volumeLabel = VOLUME_PRESETS.find(p => p.key === vol)?.label || vol;
      const useCaseLabel = USE_CASE_PROFILES[ucKey]?.label || ucKey;

      // Build text summary for LLM consumption
      const lines = results.map((m, i) =>
        `${i + 1}. ${m.provider} ${m.model} — ` +
        `Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M` +
        (m.eloScore ? `, ELO: ${m.eloScore}` : "") +
        `, ${useCaseLabel} cost: ${formatMicroCost(m.useCaseCost)}/req` +
        `, Monthly (${volumeLabel}): ${formatMonthlyBudget(m.monthlyBudget)}` +
        (m.isFinOpsFriendly ? " ✅ FinOps Friendly" : "")
      );

      return {
        structuredContent: {
          models: results,
          useCaseLabel,
          volumeLabel,
          source,
          totalAvailable: filtered.length,
        },
        content: [
          {
            type: "text",
            text: `Found ${filtered.length} models (showing top ${results.length}). ` +
              `Use case: ${useCaseLabel}, Volume: ${volumeLabel}/mo.\n\n` +
              lines.join("\n"),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error comparing models: ${error}` }],
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
    description:
      "Estimate per-request and monthly costs for AI/LLM models across different use cases and volumes. " +
      "Provide a model name to get detailed cost breakdowns, or compare costs across all use case presets. " +
      "IMPORTANT: Report all cost figures EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      modelName: z.string().optional().describe("Model name to estimate costs for (e.g. 'GPT-4o', 'Claude Sonnet 4'). If omitted, shows top models."),
      useCasePreset: z.string().optional().describe(
        "Use case preset: supportTicket, knowledgeQA, meetingSummary, " +
        "marketingContent, codingTask, invoiceProcessing, callSummary, agentWorkflow. Default: all."
      ),
      customInputTokens: z.number().optional().describe("Custom input tokens per request (overrides preset)"),
      customOutputTokens: z.number().optional().describe("Custom output tokens per request (overrides preset)"),
      monthlyVolume: z.number().optional().describe("Custom monthly volume (default: 100,000)"),
    },
  },
  async ({ modelName, useCasePreset, customInputTokens, customOutputTokens, monthlyVolume }) => {
    try {
      const { models: allModels } = await fetchLLMModels();

      if (allModels.length === 0) {
        return {
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
            content: [{ type: "text", text: `No models found matching "${modelName}".` }],
            isError: true,
          };
        }
      } else {
        targetModels = allModels.slice(0, 8);
      }

      const volume = monthlyVolume || 100_000;

      // Calculate costs for each use case (or custom)
      type CostEntry = { useCase: string; inputTokens: number; outputTokens: number; perRequest: number; monthly: number };
      const modelCosts: { model: LLMModel; costs: CostEntry[] }[] = targetModels.map(m => {
        const costs: CostEntry[] = [];

        if (customInputTokens !== undefined && customOutputTokens !== undefined) {
          const profile = { label: "Custom", shortLabel: "Custom", inputTokens: customInputTokens, outputTokens: customOutputTokens };
          const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
          costs.push({ useCase: "Custom", inputTokens: customInputTokens, outputTokens: customOutputTokens, perRequest: cost, monthly: cost * volume });
        } else if (useCasePreset) {
          const profile = USE_CASE_PROFILES[useCasePreset];
          if (profile) {
            const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
            costs.push({ useCase: profile.label, inputTokens: profile.inputTokens, outputTokens: profile.outputTokens, perRequest: cost, monthly: cost * volume });
          }
        } else {
          // Show all use cases
          for (const [, profile] of Object.entries(USE_CASE_PROFILES)) {
            const cost = useCaseCost(m.inputPricePer1M, m.outputPricePer1M, profile);
            costs.push({ useCase: profile.label, inputTokens: profile.inputTokens, outputTokens: profile.outputTokens, perRequest: cost, monthly: cost * volume });
          }
        }

        return { model: m, costs };
      });

      // Build text summary
      const lines = modelCosts.map(({ model: m, costs }) => {
        const costLines = costs.map(c =>
          `  ${c.useCase}: ${formatMicroCost(c.perRequest)}/req → ${formatMonthlyBudget(c.monthly)}/mo (${c.inputTokens} in + ${c.outputTokens} out tokens)`
        );
        return `${m.provider} ${m.model} (Input: $${m.inputPricePer1M}/1M, Output: $${m.outputPricePer1M}/1M)\n${costLines.join("\n")}`;
      });

      return {
        structuredContent: {
          modelCosts,
          volume,
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
      return {
        content: [{ type: "text", text: `Error estimating costs: ${error}` }],
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
    description:
      "Compare cloud compute instance pricing across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba. " +
      "Filter by provider, vCPUs, memory, category, processor, use case, or operating system. " +
      "IMPORTANT: Report all prices EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
    inputSchema: {
      provider: z.string().optional().describe("Cloud provider: AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba"),
      category: z.string().optional().describe("Instance category: General Purpose, Compute Optimized, Memory Optimized, Storage Optimized, GPU / Accelerated, Burstable"),
      minVCPUs: z.number().optional().describe("Minimum number of vCPUs"),
      maxVCPUs: z.number().optional().describe("Maximum number of vCPUs"),
      minMemory: z.number().optional().describe("Minimum memory in GiB"),
      maxMemory: z.number().optional().describe("Maximum memory in GiB"),
      os: z.enum(["Linux", "Windows"]).optional().describe("Operating system filter. Default: Linux"),
      processor: z.string().optional().describe("Processor filter: Intel, AMD, Graviton, Ampere, NVIDIA A100, NVIDIA H100, etc."),
      useCase: z.string().optional().describe("Use case filter: Web App, Database, HPC, ML & AI, Dev/Test, Big Data"),
      sortBy: z.enum(["price", "vcpus", "memory", "pricePerVCPU"]).optional().describe("Sort by: price, vcpus, memory, pricePerVCPU. Default: price"),
      limit: z.number().min(1).max(50).optional().describe("Max instances to return (default: 20)"),
    },
  },
  async ({ provider, category, minVCPUs, maxVCPUs, minMemory, maxMemory, os, processor, useCase, sortBy, limit }) => {
    try {
      const enriched = enrichInstances(computeInstances);

      let filtered = enriched.filter(inst => {
        if (provider && inst.provider.toLowerCase() !== provider.toLowerCase()) return false;
        if (category && inst.category.toLowerCase() !== category.toLowerCase()) return false;
        if (os && inst.os !== os) return false;
        if (!os && inst.os !== "Linux") return false; // Default to Linux
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
          totalAvailable: filtered.length,
        },
        content: [
          {
            type: "text",
            text: `Found ${filtered.length} compute instances (showing ${results.length}).\n\n` + lines.join("\n"),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error comparing compute pricing: ${error}` }],
        isError: true,
      };
    }
  },
);

server.run();

export type AppType = typeof server;
