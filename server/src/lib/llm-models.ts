/**
 * LLM model fetching, filtering, and enrichment logic.
 * Extracted from the original Vercel API route (api/llm-models.ts).
 * Fetches live data from OpenRouter API, enriches with ELO scores and metadata.
 */

// ── Types ──────────────────────────────────────────────────────────

import type { LLMModel, LLMCapability } from "../data/pricing-data.js";

export type { LLMModel, LLMCapability };
export type LLMCategory = "Frontier" | "Mid-tier" | "Budget" | "Open Weights" | "Image";

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
  pricing: { prompt: string; completion: string };
  top_provider: { context_length: number; max_completion_tokens: number };
  supported_parameters: string[];
  hugging_face_id?: string;
}

// ── Static ELO scores (from Chatbot Arena, updated periodically) ──

const ELO_SCORES: Record<string, number> = {
  "google/gemini-3-pro-preview": 1430,
  "x-ai/grok-4": 1410,
  "anthropic/claude-opus-4.6": 1395,
  "google/gemini-2.5-pro-preview": 1392,
  "google/gemini-3-flash-preview": 1385,
  "anthropic/claude-opus-4": 1381,
  "anthropic/claude-sonnet-4.6": 1380,
  "anthropic/claude-opus-4.5": 1375,
  "deepseek/deepseek-v3.2": 1370,
  "openai/gpt-5": 1370,
  "anthropic/claude-sonnet-4.5": 1370,
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
  "anthropic/claude-haiku-4.5": 1245,
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
  "z-ai/glm-5": 1412,
  "minimax/minimax-m2.5": 1215,
  "minimax/minimax-m2.5-lightning": 1215,
};

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google",
  "meta-llama": "Meta", mistralai: "Mistral", deepseek: "DeepSeek",
  "x-ai": "xAI", cohere: "Cohere", amazon: "Amazon",
  microsoft: "Microsoft", alibaba: "Alibaba", nvidia: "Nvidia",
  ai21: "AI21", perplexity: "Perplexity", moonshotai: "Moonshot",
  minimax: "MiniMax", qwen: "Alibaba", writer: "Writer",
  "bytedance-seed": "ByteDance", inflection: "Inflection",
  stepfun: "StepFun", inception: "Inception", baidu: "Baidu",
  tencent: "Tencent", xiaomi: "Xiaomi", "z-ai": "Zhipu",
};

const EXCLUDE_PATTERNS = [
  /:free$/, /:extended$/, /:exacto$/, /:thinking$/,
  /\d{4}-\d{2}-\d{2}/, /-preview$/, /instruct$/, /turbo-preview$/,
  /gpt-3\.5/, /gpt-4-0314/, /gpt-4-1106/, /gpt-4$/,
  /gpt-4o-search/, /gpt-4o-mini-search/, /gpt-4o-audio/, /gpt-oss/,
  /-deep-research$/, /safeguard/,
  /roleplay|mancer|sao10k|undi95|thedrummer|gryphe|nousresearch|alpindale|anthracite|cognitivecomputations|neversleep/,
];

const FORCE_INCLUDE = [
  "google/gemini-3-pro-preview", "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro-preview", "google/gemini-2.5-flash-preview",
  "google/gemini-2.0-flash-001", "qwen/qwen3.5-flash-02-23", "qwen/qwen3.5-plus-02-15",
];

const FORCE_EXCLUDE = [
  "openai/gpt-4o-2024-08-06", "openai/gpt-4o-2024-05-13", "openai/gpt-4o-2024-11-20",
  "openai/gpt-4o-mini-2024-07-18", "openai/gpt-4-turbo-preview",
  "openai/gpt-3.5-turbo-0613", "openai/gpt-3.5-turbo-16k", "openai/gpt-3.5-turbo-instruct",
  "anthropic/claude-3.5-sonnet", "anthropic/claude-opus-4.1",
];

const KNOWN_PARAMETERS: Record<string, string> = {
  "meta-llama/llama-4-maverick": "400B", "meta-llama/llama-4-scout": "109B",
  "meta-llama/llama-3.3-70b-instruct": "70B", "meta-llama/llama-3.1-405b-instruct": "405B",
  "meta-llama/llama-3.1-70b-instruct": "70B", "meta-llama/llama-3.1-8b-instruct": "8B",
  "deepseek/deepseek-r1": "671B", "deepseek/deepseek-v3": "671B", "deepseek/deepseek-v3.2": "685B",
  "mistralai/mistral-large": "675B", "mistralai/mistral-small": "24B", "mistralai/mistral-nemo": "12B",
  "alibaba/qwq-32b": "32B", "alibaba/qwen-2.5-72b-instruct": "72B",
  "qwen/qwen3.5-397b-a17b": "397B", "qwen/qwen3.5-122b-a10b": "122B",
  "qwen/qwen3.5-35b-a3b": "35B", "qwen/qwen3.5-27b": "27B",
  "qwen/qwen3.5-flash-02-23": "MoE", "qwen/qwen3.5-plus-02-15": "MoE",
  "qwen/qwen3-max-thinking": "685B", "qwen/qwen3-coder-next": "80B",
  "google/gemma-2-27b-it": "27B", "google/gemma-2-9b-it": "9B",
  "cohere/command-r-plus": "104B", "microsoft/phi-4": "14B",
  "moonshotai/kimi-k2": "1T", "moonshotai/kimi-k2.5": "1T",
  "inflection/inflection-3-pi": "175B", "inflection/inflection-3-productivity": "175B",
  "z-ai/glm-5": "744B", "minimax/minimax-m2.5": "230B", "minimax/minimax-m2.5-lightning": "230B",
};

const KNOWN_RELEASE_DATES: Record<string, string> = {
  "anthropic/claude-opus-4.6": "2026-02", "anthropic/claude-sonnet-4.6": "2026-02",
  "anthropic/claude-opus-4.5": "2025-09", "anthropic/claude-sonnet-4.5": "2025-09",
  "anthropic/claude-haiku-4.5": "2025-10", "anthropic/claude-opus-4": "2025-05",
  "anthropic/claude-sonnet-4": "2025-05", "anthropic/claude-3.7-sonnet": "2025-02",
  "anthropic/claude-3.5-sonnet": "2024-10", "anthropic/claude-3.5-haiku": "2024-10",
  "anthropic/claude-3-haiku": "2024-03",
  "qwen/qwen3.5-397b-a17b": "2026-03", "qwen/qwen3.5-122b-a10b": "2026-03",
  "qwen/qwen3.5-35b-a3b": "2026-03", "qwen/qwen3.5-27b": "2026-03",
  "qwen/qwen3.5-plus-02-15": "2026-02", "qwen/qwen3.5-flash-02-23": "2026-02",
  "qwen/qwen3-max-thinking": "2026-02", "qwen/qwen3-coder-next": "2026-03",
  "x-ai/grok-4": "2025-08", "x-ai/grok-3": "2025-02", "x-ai/grok-3-mini": "2025-02",
  "deepseek/deepseek-v3.2": "2025-10", "deepseek/deepseek-r1": "2025-01", "deepseek/deepseek-v3": "2024-12",
  "openai/gpt-5": "2025-06", "openai/gpt-5-mini": "2025-09", "openai/o3": "2025-04", "openai/o4-mini": "2025-04",
  "google/gemini-3-pro-preview": "2025-11", "google/gemini-3-flash-preview": "2025-12",
  "moonshotai/kimi-k2": "2025-07", "moonshotai/kimi-k2.5": "2025-12",
  "z-ai/glm-5": "2026-02", "minimax/minimax-m2.5": "2026-02", "minimax/minimax-m2.5-lightning": "2026-02",
};

const LICENSE_PREFIXES: [string, string][] = [
  ["openai/", "Proprietary"], ["anthropic/", "Proprietary"],
  ["google/gemini", "Proprietary"], ["google/gemma", "Gemma"],
  ["meta-llama/", "Llama 3.x"], ["deepseek/", "Apache 2.0"],
  ["mistralai/mistral-nemo", "Apache 2.0"], ["mistralai/codestral", "Apache 2.0"],
  ["mistralai/", "Mistral"], ["x-ai/", "Proprietary"],
  ["alibaba/", "Qwen"], ["qwen/", "Qwen"],
  ["microsoft/phi", "MIT"], ["nvidia/", "CC-BY-NC-4.0"],
  ["cohere/", "Proprietary"], ["amazon/", "Proprietary"],
  ["ai21/", "Proprietary"], ["moonshotai/", "Proprietary"],
  ["perplexity/", "Proprietary"], ["minimax/", "Proprietary"],
  ["inflection/", "Proprietary"], ["bytedance-seed/", "Proprietary"],
  ["stepfun/", "Proprietary"], ["baidu/", "Proprietary"],
  ["tencent/", "Proprietary"], ["xiaomi/", "Proprietary"],
  ["z-ai/", "Apache 2.0"], ["inception/", "Apache 2.0"], ["writer/", "Proprietary"],
];

function inferLicense(modelId: string): string | undefined {
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
  const idAfterProvider = id.split("/")[1] || "";
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(id) || pattern.test(idAfterProvider)) return false;
  }
  const inp = parseFloat(model.pricing.prompt);
  const out = parseFloat(model.pricing.completion);
  if (inp === 0 && out === 0) return false;
  if (!model.context_length || model.context_length < 1000) return false;
  return true;
}

function formatContextWindow(ctx: number): string {
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return String(ctx);
}

function extractParameters(model: OpenRouterModel): string | undefined {
  if (KNOWN_PARAMETERS[model.id]) return KNOWN_PARAMETERS[model.id];
  const nameMatch = model.name.match(/(\d+(?:\.\d+)?)\s*[Bb]\b/);
  if (nameMatch) return `${nameMatch[1]}B`;
  const hfMatch = (model.hugging_face_id || "").match(/(\d+)[Bb]/);
  if (hfMatch) return `${hfMatch[1]}B`;
  const descMatch = (model.description || "").match(/(\d+(?:\.\d+)?)\s*(?:billion|B)\s*param/i);
  if (descMatch) return `${descMatch[1]}B`;
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

  if (inputMods.includes("text") && outputMods.includes("text")) caps.push("Text");
  if (inputMods.includes("image") || inputMods.includes("video")) caps.push("Vision");
  if (inputMods.includes("audio") || outputMods.includes("audio")) caps.push("Audio");
  if (outputMods.includes("image")) caps.push("Image Gen");

  const reasoningIndicators = ["o1", "o3", "o4", "r1", "qwq", "thinking", "reason", "-pro"];
  if (reasoningIndicators.some((r) => id.includes(r)) || name.includes("reason")) caps.push("Reasoning");

  const codeIndicators = ["code", "codex", "coder", "codestral"];
  const isCodeSpecialist = codeIndicators.some((c) => id.includes(c));
  const outPrice = parseFloat(model.pricing.completion) * 1e6;
  if (isCodeSpecialist || outPrice >= 0.5) caps.push("Code");

  if (params.includes("tools") || params.includes("tool_choice")) caps.push("Agents");
  if (caps.length === 0 && outputMods.includes("image")) caps.push("Image Gen");

  return caps;
}

function inferModelCategory(model: OpenRouterModel): LLMCategory {
  const outPrice = parseFloat(model.pricing.completion) * 1e6;
  const inPrice = parseFloat(model.pricing.prompt) * 1e6;
  const id = model.id.toLowerCase();
  const outputMods = model.architecture.output_modalities || [];

  if (outputMods.includes("image") && !outputMods.includes("text")) return "Image";

  const openWeightsProviders = ["meta-llama", "deepseek", "alibaba", "qwen", "nvidia", "microsoft"];
  const openWeightsIndicators = ["llama", "gemma", "mixtral", "phi-", "qwen", "nemotron", "dbrx", "yi-", "gpt-oss"];
  if (
    openWeightsProviders.includes(model.id.split("/")[0]) ||
    openWeightsIndicators.some((i) => id.includes(i))
  ) {
    if (outPrice >= 10) return "Frontier";
    return "Open Weights";
  }

  if (outPrice >= 15 || inPrice >= 10) return "Frontier";
  if (outPrice >= 2) return "Mid-tier";
  return "Budget";
}

function formatReleaseDate(created: number): string | undefined {
  if (!created || created < 1000000000) return undefined;
  const d = new Date(created * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function cleanModelName(model: OpenRouterModel): string {
  let name = model.name;
  name = name.replace(/^[^:]+:\s*/, "");
  name = name.replace(/\s+\d{2}-\d{2}$/, "");
  name = name.replace(/\s+Preview\s+\d{2}-\d{2}$/, "");
  return name.trim();
}

function transformModels(orModels: OpenRouterModel[]): LLMModel[] {
  return orModels.filter(shouldInclude).map((m) => {
    const providerSlug = m.id.split("/")[0];
    const provider = PROVIDER_NAMES[providerSlug] || providerSlug;
    const inputPrice = parseFloat(m.pricing.prompt) * 1e6;
    const outputPrice = parseFloat(m.pricing.completion) * 1e6;

    return {
      provider,
      model: cleanModelName(m),
      parameters: extractParameters(m),
      inputPricePer1M: Math.round(inputPrice * 100) / 100,
      outputPricePer1M: Math.round(outputPrice * 100) / 100,
      contextWindow: formatContextWindow(m.context_length),
      category: inferModelCategory(m),
      capabilities: inferCapabilities(m),
      releaseDate: KNOWN_RELEASE_DATES[m.id] || formatReleaseDate(m.created),
      eloScore: ELO_SCORES[m.id],
      license: inferLicense(m.id),
    };
  });
}

// ── Public API ──

export async function fetchLLMModels(): Promise<{ models: LLMModel[]; source: string }> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`);
    }

    const data = await response.json();
    const models = transformModels(data.data || []);

    models.sort((a, b) => {
      if (a.eloScore && b.eloScore) return b.eloScore - a.eloScore;
      if (a.eloScore) return -1;
      if (b.eloScore) return 1;
      return a.outputPricePer1M - b.outputPricePer1M;
    });

    return { models, source: "openrouter" };
  } catch {
    return { models: [], source: "error" };
  }
}

export function filterModels(
  models: LLMModel[],
  filters?: {
    provider?: string;
    category?: string;
    capability?: string;
    maxInputPrice?: number;
    maxOutputPrice?: number;
    minElo?: number;
  }
): LLMModel[] {
  if (!filters) return models;
  return models.filter((m) => {
    if (filters.provider && m.provider.toLowerCase() !== filters.provider.toLowerCase()) return false;
    if (filters.category && m.category.toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.capability && !m.capabilities.some(c => c.toLowerCase() === filters.capability!.toLowerCase())) return false;
    if (filters.maxInputPrice !== undefined && m.inputPricePer1M > filters.maxInputPrice) return false;
    if (filters.maxOutputPrice !== undefined && m.outputPricePer1M > filters.maxOutputPrice) return false;
    if (filters.minElo !== undefined && (!m.eloScore || m.eloScore < filters.minElo)) return false;
    return true;
  });
}
