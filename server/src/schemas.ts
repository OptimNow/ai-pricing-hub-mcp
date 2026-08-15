import { z } from "zod";
import { USE_CASE_KEYS } from "./lib/llm-business-metrics.js";

// The single source of truth for every tool contract: index.ts registers from
// here and scripts/generate-app-json.mjs renders the same shapes to JSON Schema,
// so app.json can no longer drift away from what the server actually accepts.

// ─── Input schemas ──────────────────────────────────────────────────

export const compareModelsInputSchema = {
  provider: z.string().optional().describe("Filter by provider name (e.g. 'OpenAI', 'Anthropic', 'Google')"),
  category: z.string().optional().describe("Filter by category: Frontier, Mid-tier, Budget, Open Weights, Image"),
  capability: z.string().optional().describe("Filter by capability: Text, Vision, Code, Reasoning, Agents, Image Gen, Audio"),
  maxInputPrice: z.number().optional().describe("Max input price per 1M tokens in USD"),
  maxOutputPrice: z.number().optional().describe("Max output price per 1M tokens in USD"),
  minElo: z.number().optional().describe("Minimum ELO score (quality benchmark from Chatbot Arena)"),
  useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Use case for cost estimation. Default: supportTicket"),
  volumePreset: z.enum(["10k", "100k", "1m"]).optional().describe("Monthly request volume: 10k, 100k, or 1m. Default: 100k"),
  limit: z.number().min(1).max(50).optional().describe("Max models to return (default: 15)"),
};

export const estimateCostInputSchema = {
  modelName: z.string().optional().describe("Model name to estimate costs for (e.g. 'GPT-4o', 'Claude Sonnet 4'). If omitted, shows top models."),
  useCasePreset: z.enum(USE_CASE_KEYS).optional().describe("Use case preset. Default: all presets."),
  customInputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom input tokens per request (overrides preset)"),
  customOutputTokens: z.number().int().min(1).max(10_000_000).optional().describe("Custom output tokens per request (overrides preset)"),
  monthlyVolume: z.number().int().min(1).max(1_000_000_000).optional().describe("Custom monthly volume (default: 100,000)"),
};

export const computePricingInputSchema = {
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
};

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
  efficiencyScore: z.number().nullable(),
  useCaseCost: z.number(),
  optimizedUseCaseCost: z.number(),
  monthlyBudget: z.number(),
  optimizedMonthlyBudget: z.number(),
  volatilityRisk: z.string(),
  isFinOpsFriendly: z.boolean(),
});

export const compareModelsOutputSchema = {
  models: z.array(enrichedModelSchema),
  useCaseLabel: z.string(),
  volumeLabel: z.string(),
  source: z.string(),
  matchingCount: z.number(),
  catalogSize: z.number(),
  eloAsOf: z.string(),
  dataAsOf: z.string().optional(),
  error: z.string().optional(),
};

export const estimateCostOutputSchema = {
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

export const computePricingOutputSchema = {
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

// ─── Tool descriptions ──────────────────────────────────────────────

export const TOOL_META = {
  "compare-llm-models": {
    title: "Compare LLM Models",
    description:
      "Compare AI/LLM models by price, quality (ELO), efficiency, and capabilities. " +
      "Fetches live data from OpenRouter API. Filter by provider, category, capability, " +
      "price range, or minimum ELO score. Optionally enrich with business metrics for a use case. " +
      "Reports both list-price cost and the optimized cost achievable with prompt caching and the batch API. " +
      "IMPORTANT: Report all prices, costs, and scores EXACTLY as returned. " +
      "Do NOT add commentary, opinions, or recommendations beyond what the data shows. " +
      "Present the results as a table and let the user draw conclusions.",
  },
  "estimate-llm-cost": {
    title: "Estimate LLM Cost",
    description:
      "Estimate per-request and monthly costs for AI/LLM models across different use cases and volumes. " +
      "Provide a model name to get detailed cost breakdowns, or compare costs across all use case presets. " +
      "Each figure comes twice: list price, and the optimized price achievable with prompt caching and the batch API. " +
      "IMPORTANT: Report all cost figures EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
  },
  "compare-compute-pricing": {
    title: "Compare Cloud Compute Pricing",
    description:
      "Compare cloud compute instance pricing across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba. " +
      "Filter by provider, vCPUs, memory, category, processor, or use case. " +
      "All prices are Linux on-demand list prices in USD. " +
      "IMPORTANT: Report all prices EXACTLY as returned. Do NOT add commentary or recommendations beyond the data.",
  },
} as const;

/** Consumed by scripts/generate-app-json.mjs — keep the order stable so the
 *  generated app.json diffs cleanly. */
export const TOOL_INPUT_SCHEMAS = {
  "compare-llm-models": compareModelsInputSchema,
  "estimate-llm-cost": estimateCostInputSchema,
  "compare-compute-pricing": computePricingInputSchema,
};
