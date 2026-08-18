/**
 * LLM model fetching, filtering, and enrichment logic.
 *
 * Ported from cloud-sparkle-compare/api/llm-models.ts (the endpoint behind
 * optimtoken.optimnow.io), minus its Vercel HTTP wrapper. Keep the two in sync:
 * divergence here is what let the MCP drift half a year behind the web app.
 */

// ── Types ──────────────────────────────────────────────────────────

import { llmModels, dataLastUpdated } from "../data/pricing-data.js";
import type { LLMModel, LLMCapability, LLMCategory } from "../data/pricing-data.js";
import { hasPublishableTokenPricing } from "./pricing-normalize.js";
import { opennessOf } from "./openness.js";
import { OPTIMTOKEN_BASE_URL, fetchOptimtokenJson } from "./optimtoken-api.js";

export type { LLMModel, LLMCapability, LLMCategory };

/**
 * Which tier of the fallback chain served the response.
 *
 * `"openrouter"` and `"static-fallback"` keep the exact meaning they have
 * always had — direct OpenRouter, and the frozen snapshot — so the widgets'
 * `source === "static-fallback"` check and anything downstream reading this
 * field keep working. `"optimtoken"` is the new preferred tier.
 */
export type ModelSource = "optimtoken" | "openrouter" | "static-fallback";

interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
  };
  pricing: { prompt: string; completion: string; input_cache_read?: string };
  top_provider: { context_length: number; max_completion_tokens: number };
  supported_parameters: string[];
  hugging_face_id?: string;
}

// ── Static ELO scores (from Arena, ex-LMArena — updated periodically) ──
// Post-January-2026 recalibrated scale for 2025+ models (public snapshots, Aug 2026).
// Older models keep legacy-scale values; ordering across the boundary stays correct.
// Bump ELO_AS_OF whenever the map is refreshed — it is surfaced in the widgets.

export const ELO_AS_OF = "2026-08-13";

const ELO_SCORES: Record<string, number> = {
  // ── Tier 1: Top-tier frontier (new scale, 1430+) ──
  "anthropic/claude-fable-5": 1495,
  "openai/gpt-5.5-pro": 1485,
  "anthropic/claude-opus-4.8": 1483,
  "google/gemini-3.1-pro-preview": 1480,
  "anthropic/claude-opus-5": 1478,
  "google/gemini-3.5-flash": 1472,
  "openai/gpt-5.4": 1470,
  "openai/gpt-5.5": 1468,
  "qwen/qwen3.7-max": 1466,
  "anthropic/claude-opus-4.7": 1465,
  "google/gemini-3.6-flash": 1462,
  "qwen/qwen3.7-plus": 1460,
  "google/gemini-3.7-flash": 1458,
  "anthropic/claude-sonnet-4.6": 1457,
  "anthropic/claude-sonnet-5": 1455,
  "x-ai/grok-4.20": 1455,
  "moonshotai/kimi-k2.6": 1452,
  "anthropic/claude-opus-4.6": 1470,
  "anthropic/claude-opus-4.5": 1450,
  "x-ai/grok-4.20-multi-agent": 1450,
  "deepseek/deepseek-v4-pro": 1449,
  "x-ai/grok-4.6": 1445,
  "moonshotai/kimi-k3": 1445,
  "x-ai/grok-4.5": 1440,
  "anthropic/claude-sonnet-4.5": 1438,
  "openai/gpt-5.2": 1440,
  "deepseek/deepseek-v4-flash": 1431,
  "z-ai/glm-5.2": 1430,
  "openai/gpt-5.1": 1428,
  "z-ai/glm-5.1": 1420,
  "google/gemini-3-pro-preview": 1479,
  "x-ai/grok-4": 1410,
  "google/gemini-2.5-pro-preview": 1392,
  "google/gemini-3-flash-preview": 1385,
  "anthropic/claude-opus-4": 1381,
  "deepseek/deepseek-v3.2": 1370,
  "openai/gpt-5": 1370,
  "anthropic/claude-haiku-4.5": 1392,
  "minimax/minimax-m3": 1390,
  "anthropic/claude-sonnet-4": 1363,
  "anthropic/claude-3.7-sonnet": 1363,
  "deepseek/deepseek-r1": 1358,
  "openai/o3": 1350,
  "openai/o1": 1350,
  "x-ai/grok-3": 1346,
  "moonshotai/kimi-k2.5": 1345,
  "openai/o4-mini-high": 1345,
  "openai/o4-mini": 1340,
  "google/gemini-2.5-flash-preview": 1340,
  "openai/o3-mini": 1337,
  "openai/o3-mini-high": 1337,
  "moonshotai/kimi-k2": 1330,
  "meta-llama/llama-4-maverick": 1325,
  "deepseek/deepseek-v3": 1318,
  "x-ai/grok-3-mini": 1316,
  "alibaba/qwq-32b": 1316,
  "openai/gpt-5-mini": 1310,
  "openai/gpt-4.1": 1305,
  "openai/o1-mini": 1304,
  "google/gemini-2.0-flash-001": 1298,
  "anthropic/claude-3.5-sonnet": 1290,
  "meta-llama/llama-4-scout": 1287,
  "openai/gpt-4o": 1285,
  "meta-llama/llama-3.1-405b-instruct": 1266,
  "qwen/qwen3.5-397b-a17b": 1380,
  "qwen/qwen3-max-thinking": 1370,
  "qwen/qwen3.5-122b-a10b": 1340,
  "qwen/qwen3.5-27b": 1310,
  "qwen/qwen3.5-35b-a3b": 1300,
  "qwen/qwen3.5-plus-02-15": 1295,
  "qwen/qwen3.5-flash-02-23": 1285,
  "qwen/qwen3-coder-next": 1290,
  "alibaba/qwen-2.5-72b-instruct": 1261,
  "x-ai/grok-2": 1260,
  "google/gemini-1.5-pro": 1260,
  "openai/gpt-4.1-mini": 1260,
  "openai/gpt-4-turbo": 1257,
  "mistralai/mistral-large": 1250,
  "meta-llama/llama-3.3-70b-instruct": 1247,
  "anthropic/claude-3.5-haiku": 1231,
  "meta-llama/llama-3.1-70b-instruct": 1227,
  "microsoft/phi-4": 1220,
  "openai/gpt-4o-mini": 1219,
  "amazon/nova-pro-v1": 1214,
  "mistralai/mistral-small": 1204,
  "google/gemma-2-27b-it": 1187,
  "cohere/command-r-plus": 1187,
  "anthropic/claude-3-haiku": 1178,
  "mistralai/mistral-nemo": 1177,
  "meta-llama/llama-3.1-8b-instruct": 1152,
  "google/gemma-2-9b-it": 1146,
  // Zhipu (GLM)
  "z-ai/glm-5": 1412,
  // MiniMax
  "minimax/minimax-m2.5": 1215,
  "minimax/minimax-m2.5-lightning": 1215,
};

// ── Provider name mapping ──

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  cohere: "Cohere",
  amazon: "Amazon",
  microsoft: "Microsoft",
  alibaba: "Alibaba",
  nvidia: "Nvidia",
  ai21: "AI21",
  perplexity: "Perplexity",
  moonshotai: "Moonshot",
  minimax: "MiniMax",
  qwen: "Alibaba",
  writer: "Writer",
  "bytedance-seed": "ByteDance",
  inflection: "Inflection",
  stepfun: "StepFun",
  inception: "Inception",
  baidu: "Baidu",
  tencent: "Tencent",
  xiaomi: "Xiaomi",
  "z-ai": "Zhipu",
};

// ── Models to exclude (variants, legacy, niche) ──

const EXCLUDE_PATTERNS = [
  /:free$/,
  /:extended$/,
  /:exacto$/,
  /:thinking$/,
  /:batch$/, // batch variants are merged into the parent model, not listed
  /-fast$/, // "Fast" priority tiers (e.g. claude-opus-5-fast)
  /^~/, // provider alias entries like ~anthropic/claude-opus-latest
  /-latest$/, // rolling aliases (gpt-chat-latest, ...)
  /\d{4}-\d{2}-\d{2}/, // date-stamped variants like gpt-4o-2024-11-20
  /-preview$/, // preview variants (we keep the canonical)
  /instruct$/,
  /turbo-preview$/,
  /gpt-3\.5/,
  /gpt-4-0314/,
  /gpt-4-1106/,
  /gpt-4$/,
  /gpt-4o-search/,
  /gpt-4o-mini-search/,
  /gpt-4o-audio/, // audio-specific variant
  /gpt-oss/, // open-source guard models
  /-deep-research$/,
  /safeguard/,
  /roleplay|mancer|sao10k|undi95|thedrummer|gryphe|nousresearch|alpindale|anthracite|cognitivecomputations|neversleep/,
];

// Models to explicitly include even if they match an exclude pattern
const FORCE_INCLUDE = [
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro-preview",
  "google/gemini-2.5-flash-preview",
  "google/gemini-2.0-flash-001",
  "qwen/qwen3.5-flash-02-23",
  "qwen/qwen3.5-plus-02-15",
];

// Models to explicitly exclude (deduplicates, old versions)
const FORCE_EXCLUDE = [
  "openai/gpt-4o-2024-08-06",
  "openai/gpt-4o-2024-05-13",
  "openai/gpt-4o-2024-11-20",
  "openai/gpt-4o-mini-2024-07-18",
  "openai/gpt-4-turbo-preview",
  "openai/gpt-3.5-turbo-0613",
  "openai/gpt-3.5-turbo-16k",
  "openai/gpt-3.5-turbo-instruct",
  "anthropic/claude-3.5-sonnet", // older version, keep 3.7
  "anthropic/claude-opus-4.1", // keep 4 and 4.5+
];

// ── Known parameter counts (for models where name/description lacks it) ──

const KNOWN_PARAMETERS: Record<string, string> = {
  // Meta Llama 4 (MoE)
  "meta-llama/llama-4-maverick": "400B",
  "meta-llama/llama-4-scout": "109B",
  // Meta Llama 3
  "meta-llama/llama-3.3-70b-instruct": "70B",
  "meta-llama/llama-3.1-405b-instruct": "405B",
  "meta-llama/llama-3.1-70b-instruct": "70B",
  "meta-llama/llama-3.1-8b-instruct": "8B",
  // DeepSeek (MoE)
  "deepseek/deepseek-r1": "671B",
  "deepseek/deepseek-v3": "671B",
  "deepseek/deepseek-v3.2": "685B",
  // Mistral
  "mistralai/mistral-large": "675B",
  "mistralai/mistral-small": "24B",
  "mistralai/mistral-nemo": "12B",
  // Alibaba / Qwen
  "alibaba/qwq-32b": "32B",
  "alibaba/qwen-2.5-72b-instruct": "72B",
  "qwen/qwen3.5-397b-a17b": "397B",
  "qwen/qwen3.5-122b-a10b": "122B",
  "qwen/qwen3.5-35b-a3b": "35B",
  "qwen/qwen3.5-27b": "27B",
  "qwen/qwen3.5-flash-02-23": "MoE",
  "qwen/qwen3.5-plus-02-15": "MoE",
  "qwen/qwen3-max-thinking": "685B",
  "qwen/qwen3-coder-next": "80B",
  // Google
  "google/gemma-2-27b-it": "27B",
  "google/gemma-2-9b-it": "9B",
  // Cohere
  "cohere/command-r-plus": "104B",
  // Microsoft
  "microsoft/phi-4": "14B",
  // Moonshot (MoE)
  "moonshotai/kimi-k2": "1T",
  "moonshotai/kimi-k2.5": "1T",
  // Inflection
  "inflection/inflection-3-pi": "175B",
  "inflection/inflection-3-productivity": "175B",
  // Zhipu (GLM) — MoE
  "z-ai/glm-5": "744B",
  // MiniMax — MoE
  "minimax/minimax-m2.5": "230B",
  "minimax/minimax-m2.5-lightning": "230B",
};

// ── Known release dates (YYYY-MM) — overrides OpenRouter's `created` timestamp ──
// OpenRouter's `created` often reflects when *they* added the model, not the
// actual public release date. This map corrects the most prominent mismatches.

const KNOWN_RELEASE_DATES: Record<string, string> = {
  // Anthropic — Claude 5 family + Opus 4.7/4.8
  "anthropic/claude-fable-5": "2026-06",
  "anthropic/claude-sonnet-5": "2026-06",
  "anthropic/claude-opus-5": "2026-07",
  "anthropic/claude-opus-4.7": "2026-04",
  "anthropic/claude-opus-4.8": "2026-05",
  // OpenAI — GPT-5.x series
  "openai/gpt-5.1": "2025-11",
  "openai/gpt-5.2": "2025-12",
  "openai/gpt-5.4": "2026-02",
  "openai/gpt-5.5": "2026-04",
  "openai/gpt-5.5-pro": "2026-04",
  "openai/gpt-5.6-luna": "2026-07",
  "openai/gpt-5.6-terra": "2026-07",
  "openai/gpt-5.6-sol": "2026-07",
  // Google — Gemini 3.1+
  "google/gemini-3.1-pro-preview": "2026-02",
  "google/gemini-3.1-flash-lite": "2026-05",
  "google/gemini-3.5-flash": "2026-05",
  "google/gemini-3.6-flash": "2026-06",
  "google/gemini-3.7-flash": "2026-07",
  // DeepSeek V4
  "deepseek/deepseek-v4-pro": "2026-04",
  "deepseek/deepseek-v4-flash": "2026-04",
  // xAI
  "x-ai/grok-4.20": "2026-04",
  "x-ai/grok-4.20-multi-agent": "2026-04",
  "x-ai/grok-4.5": "2026-06",
  "x-ai/grok-4.6": "2026-07",
  // Moonshot
  "moonshotai/kimi-k2.6": "2026-03",
  "moonshotai/kimi-k2.7-code": "2026-05",
  "moonshotai/kimi-k3": "2026-06",
  // MiniMax
  "minimax/minimax-m2.7": "2026-04",
  "minimax/minimax-m3": "2026-06",
  // Zhipu
  "z-ai/glm-5.1": "2026-04",
  "z-ai/glm-5.2": "2026-06",
  // Anthropic
  "anthropic/claude-opus-4.6": "2026-02",
  "anthropic/claude-sonnet-4.6": "2026-02",
  "anthropic/claude-opus-4.5": "2025-09",
  "anthropic/claude-sonnet-4.5": "2025-09",
  "anthropic/claude-haiku-4.5": "2025-10",
  "anthropic/claude-opus-4": "2025-05",
  "anthropic/claude-sonnet-4": "2025-05",
  "anthropic/claude-3.7-sonnet": "2025-02",
  "anthropic/claude-3.5-sonnet": "2024-10",
  "anthropic/claude-3.5-haiku": "2024-10",
  "anthropic/claude-3-haiku": "2024-03",
  // Alibaba / Qwen 3.5 series — released March 2026
  "qwen/qwen3.5-397b-a17b": "2026-03",
  "qwen/qwen3.5-122b-a10b": "2026-03",
  "qwen/qwen3.5-35b-a3b": "2026-03",
  "qwen/qwen3.5-27b": "2026-03",
  "qwen/qwen3.5-plus-02-15": "2026-02",
  "qwen/qwen3.5-flash-02-23": "2026-02",
  "qwen/qwen3-max-thinking": "2026-02",
  "qwen/qwen3-coder-next": "2026-03",
  // xAI
  "x-ai/grok-4": "2025-08",
  "x-ai/grok-3": "2025-02",
  "x-ai/grok-3-mini": "2025-02",
  // DeepSeek
  "deepseek/deepseek-v3.2": "2025-10",
  "deepseek/deepseek-r1": "2025-01",
  "deepseek/deepseek-v3": "2024-12",
  // OpenAI
  "openai/gpt-5": "2025-06",
  "openai/gpt-5-mini": "2025-09",
  "openai/o3": "2025-04",
  "openai/o4-mini": "2025-04",
  // Google
  "google/gemini-3-pro-preview": "2025-11",
  "google/gemini-3-flash-preview": "2025-12",
  // Moonshot
  "moonshotai/kimi-k2": "2025-07",
  "moonshotai/kimi-k2.5": "2025-12",
  // Zhipu (GLM)
  "z-ai/glm-5": "2026-02",
  // MiniMax
  "minimax/minimax-m2.5": "2026-02",
  "minimax/minimax-m2.5-lightning": "2026-02",
};

// ── License mapping ──

/** Per-model licences, checked before the org-wide prefixes below.
 *
 *  The prefix table assumes a lab ships everything under one licence. That is
 *  false for any lab publishing a mix, and it silently freezes a lab that moved
 *  to open weights after the table was written. Prefer an exact-id entry here
 *  over widening a prefix, and say what was checked.
 *
 *  The licence drives the openness axis (see ./openness.ts), so a wrong value
 *  here is not cosmetic: it tells a reader they may or may not self-host a
 *  model. */
const LICENSE_OVERRIDES: [string, string][] = [
  // Kimi K2 published its weights under a Modified MIT licence (MIT plus an
  // attribution requirement above a deployment threshold), so the blanket
  // moonshotai/ -> Proprietary below was wrong for the entire K2 line.
  // K3 is deliberately not covered: its terms have not been verified.
  ["moonshotai/kimi-k2", "Modified MIT"],
];

const LICENSE_PREFIXES: [string, string][] = [
  ["openai/", "Proprietary"],
  ["anthropic/", "Proprietary"],
  ["google/gemini", "Proprietary"],
  ["google/gemma", "Gemma"],
  // Longest-prefix-first: Llama 4 carries its own licence string, which the
  // site emits and ./openness.ts buckets separately. Leaving these to the
  // meta-llama/ catch-all would label them "Llama 3.x" here and "Llama 4" on
  // the site — the exact kind of same-model-two-answers drift this file warns
  // about at the top.
  ["meta-llama/llama-4", "Llama 4"],
  ["meta-llama/llama-guard-4", "Llama 4"],
  ["meta-llama/", "Llama 3.x"],
  ["deepseek/", "Apache 2.0"],
  ["mistralai/mistral-nemo", "Apache 2.0"],
  ["mistralai/codestral", "Apache 2.0"],
  ["mistralai/", "Mistral"],
  ["x-ai/", "Proprietary"],
  ["alibaba/", "Qwen"],
  ["qwen/", "Qwen"],
  ["microsoft/phi", "MIT"],
  ["nvidia/", "CC-BY-NC-4.0"],
  ["cohere/", "Proprietary"],
  ["amazon/", "Proprietary"],
  ["ai21/", "Proprietary"],
  ["moonshotai/", "Proprietary"],
  ["perplexity/", "Proprietary"],
  ["minimax/", "Proprietary"],
  ["inflection/", "Proprietary"],
  ["bytedance-seed/", "Proprietary"],
  ["stepfun/", "Proprietary"],
  ["baidu/", "Proprietary"],
  ["tencent/", "Proprietary"],
  ["xiaomi/", "Proprietary"],
  ["z-ai/", "Apache 2.0"],
  ["inception/", "Apache 2.0"],
  ["writer/", "Proprietary"],
];

function inferLicense(modelId: string): string | undefined {
  for (const [prefix, license] of LICENSE_OVERRIDES) {
    if (modelId.startsWith(prefix)) return license;
  }
  for (const [prefix, license] of LICENSE_PREFIXES) {
    if (modelId.startsWith(prefix)) return license;
  }
  return undefined;
}

// ── Helpers ──

function shouldInclude(model: OpenRouterModel): boolean {
  const id = model.id;

  if (FORCE_INCLUDE.includes(id)) return true;
  if (FORCE_EXCLUDE.includes(id)) return false;

  // Exclude by pattern
  const idAfterProvider = id.split("/")[1] || "";
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(id) || pattern.test(idAfterProvider)) return false;
  }

  // Exclude free models (price = 0 for both) and variable/router pricing, which
  // OpenRouter encodes as "-1" and which would publish as -$1,000,000 per 1M tokens.
  const inp = parseFloat(model.pricing.prompt);
  const out = parseFloat(model.pricing.completion);
  if (!hasPublishableTokenPricing(inp, out)) return false;

  // Exclude models with no context length
  if (!model.context_length || model.context_length < 1000) return false;

  return true;
}

function formatContextWindow(ctx: number): string {
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return String(ctx);
}

function extractParameters(model: OpenRouterModel): string | undefined {
  // 1. Check static lookup first (most reliable)
  if (KNOWN_PARAMETERS[model.id]) return KNOWN_PARAMETERS[model.id];

  // 2. Try to extract from name (e.g., "Llama 3.1 70B")
  const nameMatch = model.name.match(/(\d+(?:\.\d+)?)\s*[Bb]\b/);
  if (nameMatch) return `${nameMatch[1]}B`;

  // 3. Check HuggingFace ID for parameter count
  const hfMatch = (model.hugging_face_id || "").match(/(\d+)[Bb]/);
  if (hfMatch) return `${hfMatch[1]}B`;

  // 4. Check description for "X billion parameters" or "XB parameters"
  const descMatch = (model.description || "").match(/(\d+(?:\.\d+)?)\s*(?:billion|B)\s*param/i);
  if (descMatch) return `${descMatch[1]}B`;

  // 5. Check description for standalone "XB" pattern (e.g., "a 70B model")
  const descLoose = (model.description || "").match(/\b(\d+(?:\.\d+)?)\s*[Bb]\b/);
  if (descLoose) return `${descLoose[1]}B`;

  return undefined;
}

function inferCapabilities(model: OpenRouterModel): LLMCapability[] {
  const caps: LLMCapability[] = [];
  const inputMods = model.architecture.input_modalities || [];
  const outputMods = model.architecture.output_modalities || [];
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  const params = model.supported_parameters || [];

  // Text — virtually all models
  if (inputMods.includes("text") && outputMods.includes("text")) {
    caps.push("Text");
  }

  // Vision — accepts image input
  if (inputMods.includes("image") || inputMods.includes("video")) {
    caps.push("Vision");
  }

  // Audio
  if (inputMods.includes("audio") || outputMods.includes("audio")) {
    caps.push("Audio");
  }

  // Image Gen — produces images
  if (outputMods.includes("image")) {
    caps.push("Image Gen");
  }

  // Reasoning — reasoning/thinking models
  const reasoningIndicators = ["o1", "o3", "o4", "r1", "qwq", "thinking", "reason", "-pro"];
  if (reasoningIndicators.some((r) => id.includes(r)) || name.includes("reason")) {
    caps.push("Reasoning");
  }

  // Code
  const codeIndicators = ["code", "codex", "coder", "codestral"];
  const isCodeSpecialist = codeIndicators.some((c) => id.includes(c));
  // Most frontier/mid models can code; be generous
  const outPrice = parseFloat(model.pricing.completion) * 1e6;
  if (isCodeSpecialist || outPrice >= 0.5) {
    caps.push("Code");
  }

  // Agents — supports tool use
  if (params.includes("tools") || params.includes("tool_choice")) {
    caps.push("Agents");
  }

  // Image-only models (DALL-E, SD, Flux)
  if (caps.length === 0 && outputMods.includes("image")) {
    caps.push("Image Gen");
  }

  return caps;
}

/** Price tier only. Openness is a separate axis, derived from the licence in
 *  ./openness.ts.
 *
 *  There used to be an "Open Weights" category here, short-circuiting the price
 *  tiers for anything from a known open lab. It made openness and price
 *  mutually exclusive: an open model could be labelled open OR priced, never
 *  both, so 28 open-licensed models sat in Mid-tier and Budget with no way to
 *  find them, and open models were sorted against a different Frontier
 *  threshold ($10) than proprietary ones ($15). Do not reintroduce it: the
 *  question "what does it cost" and the question "whose hardware can run it"
 *  need to be answerable independently. */
function inferCategory(model: OpenRouterModel): LLMCategory {
  const outPrice = parseFloat(model.pricing.completion) * 1e6;
  const inPrice = parseFloat(model.pricing.prompt) * 1e6;
  const outputMods = model.architecture.output_modalities || [];

  // Image generation models. Matches the "Image Gen" capability rule: any model
  // that can produce an image belongs here, including hybrids that also emit
  // text (Nano Banana, GPT Image). Requiring image-only output left those in
  // the text tiers, where their cost-per-request landed in support-ticket and
  // coding comparisons they have no business appearing in.
  if (outputMods.includes("image")) {
    return "Image";
  }

  if (outPrice >= 15 || inPrice >= 10) return "Frontier";
  if (outPrice >= 2) return "Mid-tier";
  return "Budget";
}

function formatReleaseDate(created: number): string | undefined {
  if (!created || created < 1000000000) return undefined;
  const d = new Date(created * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function cleanModelName(model: OpenRouterModel): string {
  let name = model.name;
  // Remove provider prefix like "OpenAI: ", "Google: "
  name = name.replace(/^[^:]+:\s*/, "");
  // Remove trailing version dates
  name = name.replace(/\s+\d{2}-\d{2}$/, "");
  // Remove "Preview" suffix when it's a version marker
  name = name.replace(/\s+Preview\s+\d{2}-\d{2}$/, "");
  return name.trim();
}

// ── Main transform ──

function transformModels(orModels: OpenRouterModel[]): LLMModel[] {
  // Index `:batch` variants by parent id — they are merged as columns, not listed as rows
  const batchPricing = new Map<string, { input: number; output: number }>();
  for (const m of orModels) {
    if (m.id.endsWith(":batch")) {
      batchPricing.set(m.id.slice(0, -6), {
        input: parseFloat(m.pricing.prompt) * 1e6,
        output: parseFloat(m.pricing.completion) * 1e6,
      });
    }
  }

  return orModels.filter(shouldInclude).map((m) => {
    const providerSlug = m.id.split("/")[0];
    const provider = PROVIDER_NAMES[providerSlug] || providerSlug;
    const inputPrice = parseFloat(m.pricing.prompt) * 1e6;
    const outputPrice = parseFloat(m.pricing.completion) * 1e6;
    const batch = batchPricing.get(m.id);
    const cacheRead = m.pricing.input_cache_read
      ? parseFloat(m.pricing.input_cache_read) * 1e6
      : undefined;

    return {
      provider,
      model: cleanModelName(m),
      parameters: extractParameters(m),
      // 4-decimal precision: rounding to cents would misstate sub-cent rates
      // (e.g. $0.0275/M). Display-side formatting decides what users see.
      inputPricePer1M: Math.round(inputPrice * 10000) / 10000,
      outputPricePer1M: Math.round(outputPrice * 10000) / 10000,
      batchInputPricePer1M: batch ? Math.round(batch.input * 10000) / 10000 : undefined,
      batchOutputPricePer1M: batch ? Math.round(batch.output * 10000) / 10000 : undefined,
      cachedInputPricePer1M:
        cacheRead && cacheRead > 0 ? Math.round(cacheRead * 10000) / 10000 : undefined,
      contextWindow: formatContextWindow(m.context_length),
      category: inferCategory(m),
      capabilities: inferCapabilities(m),
      releaseDate: KNOWN_RELEASE_DATES[m.id] || formatReleaseDate(m.created),
      eloScore: ELO_SCORES[m.id],
      license: inferLicense(m.id),
    };
  });
}

function sortModels(models: LLMModel[]): LLMModel[] {
  // ELO descending; models without ELO by release date (newest first), then price
  return models.sort((a, b) => {
    if (a.eloScore && b.eloScore) return b.eloScore - a.eloScore;
    if (a.eloScore) return -1;
    if (b.eloScore) return 1;
    const dateCmp = (b.releaseDate || "").localeCompare(a.releaseDate || "");
    if (dateCmp !== 0) return dateCmp;
    return a.outputPricePer1M - b.outputPricePer1M;
  });
}

// ── Public API ──

/**
 * Smallest catalogue we will serve as live data.
 *
 * `transformModels(data.data || [])` used to turn a 200 response with a missing
 * or renamed `data` array into an empty catalogue that looked perfectly healthy.
 * Anything below this floor is treated as an upstream failure and hands over to
 * the static snapshot. Mirrors ABSOLUTE_MODEL_FLOOR in the web app's pipeline.
 */
const MIN_PLAUSIBLE_CATALOGUE = 80;

/** Upstream must answer within this, well inside the platform's own ceiling. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** How long a successful catalogue is reused before we ask upstream again. */
const CACHE_TTL_MS = 15 * 60 * 1000;

// Best-effort only: on Alpic's serverless runtime this survives just as long as
// the warm instance does, and a cold start simply refetches.
let cache: { result: LLMFetchResult; fetchedAt: number } | null = null;

/** Drop the memo. Tests drive the tiers by stubbing fetch, so they need to be
 *  able to ask again rather than get the previous tier's answer back. */
export function resetLLMModelCache(): void {
  cache = null;
}

/**
 * Where a set of prices came from, and whether anyone has checked them.
 *
 * This is the whole point of preferring the site: OpenRouter intermittently
 * publishes a model at exactly half its vendor's list rate across every price
 * field at once, and the corrections for that live in the site's
 * PRICE_OVERRIDES table, verified against the vendors' own pricing pages. A
 * response that fell back past the site is serving uncorrected figures, and has
 * to say so — a silent downgrade of correctness is worse than an outage,
 * because the caller quotes the number either way.
 */
export interface LLMProvenance {
  /** 1 = site API, 2 = direct OpenRouter, 3 = static snapshot. */
  tier: 1 | 2 | 3;
  source: ModelSource;
  /** One-line human description of the tier that served. */
  label: string;
  /** True only on tier 1, where the site's price corrections have been applied. */
  pricesVerified: boolean;
  /** When upstream assembled the data it served (site `meta.timestamp`). */
  upstreamTimestamp?: string;
  /** The site's own liveness flag: "openrouter" when live, "error" when it fell
   *  back to its own static data. */
  upstreamSource?: string;
  upstreamSchemaVersion?: string;
  /** Catalogue size upstream reports, before our filters. */
  catalogTotal?: number;
  eloAsOf: string;
  dataAsOf?: string;
  /** Loud warning when the prices are not the site's corrected ones. */
  notice?: string;
}

export interface LLMFetchResult {
  models: LLMModel[];
  source: ModelSource;
  eloAsOf: string;
  dataAsOf?: string;
  provenance: LLMProvenance;
}

const UNVERIFIED_PRICING_NOTICE =
  "UNVERIFIED PRICING: these figures come straight from OpenRouter and have NOT " +
  "been through optimtoken.optimnow.io's price corrections. OpenRouter " +
  "intermittently publishes a model at exactly half its vendor's list rate on " +
  "every field at once. Treat these as unverified upstream figures.";

/** The static snapshot, run through the same pricing guard as live data. */
function staticFallback(): LLMModel[] {
  return sortModels(
    llmModels.filter((m) => hasPublishableTokenPricing(m.inputPricePer1M, m.outputPricePer1M)),
  );
}

// ── Tier 1: the site API ────────────────────────────────────────────

interface SiteModelsResponse {
  models?: unknown;
  meta?: {
    schemaVersion?: string;
    total?: number;
    catalogTotal?: number;
    source?: string;
    timestamp?: string;
    eloAsOf?: string;
  };
}

/**
 * Validate one row from the site.
 *
 * The site's schema is the same shape as `LLMModel`, but "same shape today" is
 * not a guarantee, and a row that silently loses its prices would serve a $0
 * model. Anything that fails here is dropped rather than coerced; if enough
 * rows drop, the catalogue floor below hands over to the next tier.
 */
function coerceSiteModel(row: unknown): LLMModel | null {
  if (row === null || typeof row !== "object") return null;
  const m = row as Record<string, unknown>;

  if (typeof m.provider !== "string" || !m.provider) return null;
  if (typeof m.model !== "string" || !m.model) return null;
  if (typeof m.inputPricePer1M !== "number" || typeof m.outputPricePer1M !== "number") return null;
  if (!hasPublishableTokenPricing(m.inputPricePer1M, m.outputPricePer1M)) return null;

  const optionalNumber = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  return {
    provider: m.provider,
    model: m.model,
    parameters: typeof m.parameters === "string" ? m.parameters : undefined,
    inputPricePer1M: m.inputPricePer1M,
    outputPricePer1M: m.outputPricePer1M,
    batchInputPricePer1M: optionalNumber(m.batchInputPricePer1M),
    batchOutputPricePer1M: optionalNumber(m.batchOutputPricePer1M),
    cachedInputPricePer1M: optionalNumber(m.cachedInputPricePer1M),
    contextWindow: typeof m.contextWindow === "string" ? m.contextWindow : "",
    // The site owns the taxonomy: its `category` is the price tier
    // (Frontier | Mid-tier | Budget | Image) and its `license` drives our
    // openness axis. Neither is re-derived here — deriving it locally is what
    // put a retired "Open Weights" category and an unrecognised "Llama 4"
    // licence into this repo in the first place.
    category: (typeof m.category === "string" ? m.category : "Budget") as LLMCategory,
    capabilities: Array.isArray(m.capabilities)
      ? (m.capabilities.filter((c): c is LLMCapability => typeof c === "string") as LLMCapability[])
      : [],
    releaseDate: typeof m.releaseDate === "string" ? m.releaseDate : undefined,
    eloScore: optionalNumber(m.eloScore),
    license: typeof m.license === "string" ? m.license : undefined,
  };
}

async function fetchFromSite(): Promise<LLMFetchResult> {
  const payload = await fetchOptimtokenJson<SiteModelsResponse>("api/llm-models", {
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  if (!Array.isArray(payload.models)) {
    throw new Error(
      `Site payload had no "models" array (saw ${typeof payload.models}). Refusing to serve an empty catalogue.`,
    );
  }

  const meta = payload.meta ?? {};

  // The site's refresh scripts abort unless meta.source says "openrouter";
  // anything else means the site is itself serving its own static fallback, so
  // it is no more authoritative than our tier 2 and carries no fresh
  // corrections. Treat it as a tier-1 failure rather than pass it off as live.
  if (meta.source !== "openrouter") {
    throw new Error(
      `Site reported meta.source="${meta.source ?? "undefined"}" rather than "openrouter" — it is serving its own fallback, not live corrected data.`,
    );
  }

  const models = sortModels(
    (payload.models as unknown[]).map(coerceSiteModel).filter((m): m is LLMModel => m !== null),
  );

  if (models.length < MIN_PLAUSIBLE_CATALOGUE) {
    throw new Error(
      `Only ${models.length} models survived validation (minimum ${MIN_PLAUSIBLE_CATALOGUE}) out of ${(payload.models as unknown[]).length} site entries.`,
    );
  }

  // The site publishes the ELO vintage it actually used; prefer it over our
  // local constant, which only describes the tier-2 enrichment table.
  const eloAsOf = typeof meta.eloAsOf === "string" && meta.eloAsOf ? meta.eloAsOf : ELO_AS_OF;

  return {
    models,
    source: "optimtoken",
    eloAsOf,
    provenance: {
      tier: 1,
      source: "optimtoken",
      label: `optimtoken.optimnow.io (${OPTIMTOKEN_BASE_URL}) — price-corrected`,
      pricesVerified: true,
      upstreamTimestamp: meta.timestamp,
      upstreamSource: meta.source,
      upstreamSchemaVersion: meta.schemaVersion,
      catalogTotal: typeof meta.catalogTotal === "number" ? meta.catalogTotal : undefined,
      eloAsOf,
    },
  };
}

// ── Tier 2: direct OpenRouter (kept — a working second tier) ─────────

async function fetchFromOpenRouter(): Promise<LLMFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`);
    }

    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload?.data)) {
      throw new Error(
        `OpenRouter payload had no "data" array (saw ${typeof payload?.data}). Refusing to serve an empty catalogue.`,
      );
    }

    const upstream = payload.data as OpenRouterModel[];
    const models = sortModels(transformModels(upstream));

    if (models.length < MIN_PLAUSIBLE_CATALOGUE) {
      throw new Error(
        `Only ${models.length} models survived transform (minimum ${MIN_PLAUSIBLE_CATALOGUE}) out of ${upstream.length} upstream entries.`,
      );
    }

    return {
      models,
      source: "openrouter",
      eloAsOf: ELO_AS_OF,
      provenance: {
        tier: 2,
        source: "openrouter",
        label: "openrouter.ai direct — list prices as published, uncorrected",
        pricesVerified: false,
        eloAsOf: ELO_AS_OF,
        notice: UNVERIFIED_PRICING_NOTICE,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Tier 3: the frozen snapshot ─────────────────────────────────────

function fetchFromSnapshot(): LLMFetchResult {
  return {
    models: staticFallback(),
    source: "static-fallback",
    eloAsOf: ELO_AS_OF,
    dataAsOf: dataLastUpdated,
    provenance: {
      tier: 3,
      source: "static-fallback",
      label: `static snapshot committed ${dataLastUpdated} — no network`,
      pricesVerified: false,
      eloAsOf: ELO_AS_OF,
      dataAsOf: dataLastUpdated,
      notice:
        `STALE PRICING: both live sources were unreachable, so these figures come from a ` +
        `snapshot taken on ${dataLastUpdated} and may be out of date.`,
    },
  };
}

/**
 * Fetch the model catalogue, degrading site -> direct OpenRouter -> snapshot.
 *
 * Every tier reports what it is in `provenance`, and the two lower tiers carry
 * an explicit notice that their prices are unverified. A caller instructed to
 * report prices exactly as returned must be able to tell corrected figures from
 * uncorrected ones.
 */
export async function fetchLLMModels(): Promise<LLMFetchResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  try {
    const result = await fetchFromSite();
    cache = { result, fetchedAt: Date.now() };
    return result;
  } catch (siteError) {
    console.error("[llm-models] site API failed, falling back to direct OpenRouter:", siteError);

    try {
      const result = await fetchFromOpenRouter();
      cache = { result, fetchedAt: Date.now() };
      return result;
    } catch (openRouterError) {
      console.error("[llm-models] OpenRouter fetch failed, serving static snapshot:", openRouterError);
      // Deliberately not cached: the snapshot is the answer of last resort, and
      // memoising it would keep serving stale data for the full TTL after the
      // network recovered.
      return fetchFromSnapshot();
    }
  }
}

export function filterModels<T extends LLMModel>(
  models: T[],
  filters?: {
    provider?: string;
    category?: string;
    /** Self-hostability, derived from the licence — orthogonal to `category` */
    openness?: string;
    capability?: string;
    maxInputPrice?: number;
    maxOutputPrice?: number;
    minElo?: number;
  },
): T[] {
  if (!filters) return models;
  return models.filter((m) => {
    if (filters.provider && m.provider.toLowerCase() !== filters.provider.toLowerCase()) return false;
    if (filters.category && m.category.toLowerCase() !== filters.category.toLowerCase()) return false;
    // Derived rather than read off the model, so this works on a plain LLMModel
    // as well as on an enriched one.
    if (filters.openness && opennessOf(m.license).toLowerCase() !== filters.openness.toLowerCase()) return false;
    if (filters.capability && !m.capabilities.some(c => c.toLowerCase() === filters.capability!.toLowerCase())) return false;
    if (filters.maxInputPrice !== undefined && m.inputPricePer1M > filters.maxInputPrice) return false;
    if (filters.maxOutputPrice !== undefined && m.outputPricePer1M > filters.maxOutputPrice) return false;
    if (filters.minElo !== undefined && (!m.eloScore || m.eloScore < filters.minElo)) return false;
    return true;
  });
}

/** Substring match on model or provider name, shared by every tool that takes a
 *  free-text model name. An exact model-name hit is promoted to the front so
 *  "GPT-4o" resolves to GPT-4o and not to GPT-4o-mini. */
export function matchModels<T extends LLMModel>(models: T[], query: string, limit = 5): T[] {
  const search = query.trim().toLowerCase();
  if (!search) return [];
  const matches = models.filter(
    (m) => m.model.toLowerCase().includes(search) || m.provider.toLowerCase().includes(search),
  );
  const exact = matches.filter((m) => m.model.toLowerCase() === search);
  if (exact.length === 0) return matches.slice(0, limit);
  return [...exact, ...matches.filter((m) => m.model.toLowerCase() !== search)].slice(0, limit);
}

export type ResolutionStatus = "exact" | "unique" | "ambiguous" | "not-found" | "duplicate";

export interface ModelResolution<T> {
  query: string;
  status: ResolutionStatus;
  matched?: T;
  /** The other rows the query also hit, so an ambiguous pick can be reported
   *  rather than silently made. */
  alternatives: string[];
}

/** Resolve one free-text name to a single row, recording how confident that was. */
export function resolveModel<T extends LLMModel>(models: T[], query: string): ModelResolution<T> {
  const matches = matchModels(models, query, 6);
  if (matches.length === 0) return { query, status: "not-found", alternatives: [] };
  const exact = matches[0].model.toLowerCase() === query.trim().toLowerCase();
  return {
    query,
    status: exact ? "exact" : matches.length > 1 ? "ambiguous" : "unique",
    matched: matches[0],
    alternatives: matches.slice(1).map((m) => `${m.provider} ${m.model}`),
  };
}
