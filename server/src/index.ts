import { McpServer } from "skybridge/server";
import pkg from "../../package.json" with { type: "json" };
import { fetchLLMModels, filterModels, matchModels, resolveModel } from "./lib/llm-models.js";
import type { ResolutionStatus } from "./lib/llm-models.js";
import type { LLMModel } from "./data/pricing-data.js";
import {
  USE_CASE_KEYS,
  USE_CASE_PROFILES,
  type EnrichedLLMModel,
  type OptimizationLevers,
  VOLUME_PRESETS,
  enrichModels,
  useCaseCost,
  optimizedUseCaseCost,
  optimizationLevers,
  savingsPct,
  formatMicroCost,
  formatMonthlyBudget,
} from "./lib/llm-business-metrics.js";
import type { UseCaseKey, UseCaseProfile, VolumePreset } from "./lib/llm-business-metrics.js";
import { roiCalculatorUrl } from "./lib/roi-link.js";
import { enrichedInstances, type EnrichedComputeInstance } from "./lib/compute-categories.js";
import {
  TOOL_META,
  compareModelsInputSchema,
  compareModelsOutputSchema,
  estimateCostInputSchema,
  estimateCostOutputSchema,
  sideBySideInputSchema,
  sideBySideOutputSchema,
  recommendInputSchema,
  recommendOutputSchema,
  computePricingInputSchema,
  computePricingOutputSchema,
} from "./schemas.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Name the lever behind a saving — or the reason there isn't one. A 0% figure
 *  on its own reads like a bug; "not batch-eligible" reads like an answer. */
function leverSummary(l: OptimizationLevers): string {
  const applied = [l.cacheApplied ? "caching" : "", l.batchApplied ? "batch API" : ""].filter(Boolean);
  if (applied.length > 0) return applied.join(" + ");
  if (!l.cacheEligible && !l.batchEligible) {
    return "this workload has no cacheable prefix and is not batch-eligible";
  }
  const missing = [l.cacheEligible ? "cache-read" : "", l.batchEligible ? "batch" : ""].filter(Boolean);
  return `this model publishes no ${missing.join(" or ")} rate`;
}

function modelKey(m: { provider: string; model: string }): string {
  return `${m.provider}/${m.model}`;
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
      savingsPct: number;
    } & OptimizationLevers;

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
        targetModels = matchModels(allModels, modelName, 5);
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
          `(${c.inputTokens} in + ${c.outputTokens} out tokens)\n` +
          `    optimized: ${formatMicroCost(c.perRequestOptimized)}/req → ${formatMonthlyBudget(c.monthlyOptimized)}/mo` +
          (c.savingsPct > 0
            ? ` — save ${c.savingsPct}% with ${leverSummary(c)}`
            : ` — no saving available (${leverSummary(c)})`)
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

// ─── Tool 3: Compare Models Side by Side ────────────────────────────

.registerWidget(
  "compare-models-side-by-side",
  { description: TOOL_META["compare-models-side-by-side"].title },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description: TOOL_META["compare-models-side-by-side"].description,
    inputSchema: sideBySideInputSchema,
    outputSchema: sideBySideOutputSchema,
  },
  async ({ models: requested, volumePreset }) => {
    type UseCaseCost = {
      key: string;
      label: string;
      inputTokens: number;
      outputTokens: number;
      perRequest: number;
      perRequestOptimized: number;
      monthly: number;
      monthlyOptimized: number;
      savingsPct: number;
    } & OptimizationLevers;
    type ResolutionEntry = {
      query: string;
      status: ResolutionStatus;
      resolved?: string;
      alternatives: string[];
    };

    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;

    const baseOutput = {
      models: [] as (LLMModel & { useCaseCosts: UseCaseCost[] })[],
      resolution: [] as ResolutionEntry[],
      volume,
      volumeLabel: volumeEntry?.label ?? vol,
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

      // One pass per requested name, keeping the caller's order and recording
      // every miss: dropping a column silently is the failure mode to avoid.
      const seen = new Set<string>();
      const resolution: ResolutionEntry[] = [];
      const selected: LLMModel[] = [];

      for (const query of requested) {
        const r = resolveModel(allModels, query);
        if (!r.matched) {
          resolution.push({ query, status: "not-found", alternatives: [] });
          continue;
        }
        const resolved = `${r.matched.provider} ${r.matched.model}`;
        if (seen.has(modelKey(r.matched))) {
          resolution.push({ query, status: "duplicate", resolved, alternatives: r.alternatives });
          continue;
        }
        seen.add(modelKey(r.matched));
        selected.push(r.matched);
        resolution.push({ query, status: r.status, resolved, alternatives: r.alternatives });
      }

      const describe = (r: ResolutionEntry): string => {
        switch (r.status) {
          case "not-found": return `"${r.query}" matched no model — no column for it.`;
          case "duplicate": return `"${r.query}" resolved to ${r.resolved}, already selected by an earlier name — no extra column.`;
          case "ambiguous": return `"${r.query}" matched ${r.alternatives.length + 1} models; used ${r.resolved} (also matched: ${r.alternatives.join(", ")}).`;
          default: return `"${r.query}" → ${r.resolved}.`;
        }
      };

      if (selected.length < 2) {
        const message =
          `Need at least 2 distinct models to compare, resolved ${selected.length}. ` +
          resolution.map(describe).join(" ");
        return {
          structuredContent: { ...baseOutput, resolution, source, eloAsOf, dataAsOf, error: message },
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      const withCosts = selected.map(m => ({
        ...m,
        useCaseCosts: USE_CASE_KEYS.map((key): UseCaseCost => {
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
          ...baseOutput,
          models: withCosts,
          resolution,
          source,
          eloAsOf,
          dataAsOf,
        },
        content: [
          {
            type: "text",
            text: `Side-by-side comparison of ${withCosts.length} models at ${volume.toLocaleString()} requests/month.\n\n` +
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
        structuredContent: { ...baseOutput, error: message },
        content: [{ type: "text", text: `Error comparing models: ${message}` }],
        isError: true,
      };
    }
  },
)

// ─── Tool 4: Recommend an LLM Model ─────────────────────────────────

.registerWidget(
  "recommend-llm-model",
  { description: TOOL_META["recommend-llm-model"].title },
  {
    // Anthropic connectors directory requires explicit tool annotations:
    // all tools here only read public pricing data.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description: TOOL_META["recommend-llm-model"].description,
    inputSchema: recommendInputSchema,
    outputSchema: recommendOutputSchema,
  },
  async ({ useCasePreset, volumePreset, maxMonthlyBudget, minElo, requiredCapability, openWeightsOnly }) => {
    type ConstraintCheck = { constraint: string; required: string; actual: string; satisfied: boolean };
    type Recommendation = {
      rank: number;
      provider: string;
      model: string;
      category: string;
      contextWindow: string;
      capabilities: string[];
      license?: string;
      eloScore: number | null;
      efficiencyScore: number | null;
      efficiencyRank: number | null;
      rankedOutOf: number;
      perRequest: number;
      perRequestOptimized: number;
      monthlyBudget: number;
      monthlyOptimizedBudget: number;
      savingsPct: number;
      isFinOpsFriendly: boolean;
      volatilityRisk: string;
      costDeltaVsTopPct: number;
      constraints: ConstraintCheck[];
    };

    const vol = (volumePreset || "100k") as VolumePreset;
    const volumeEntry = VOLUME_PRESETS.find(p => p.key === vol);
    const volume = volumeEntry?.value ?? 100_000;
    const ucKey = useCasePreset as UseCaseKey;

    const baseOutput = {
      recommendations: [] as Recommendation[],
      nearMisses: [] as Recommendation[],
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
        if (openWeightsOnly) {
          out.push({
            constraint: "openWeightsOnly",
            required: "non-proprietary licence",
            actual: m.license ?? "unknown licence",
            satisfied: m.license !== undefined && m.license !== "Proprietary",
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
          if (m.eloScore === undefined) total += 10;
          else if (m.eloScore < minElo) total += (minElo - m.eloScore) / 100;
        }
        return total;
      };

      const evaluated = ranked.map(m => ({ m, constraints: checks(m), shortfall: shortfall(m) }));
      const passing = evaluated.filter(e => e.constraints.every(c => c.satisfied));

      // Over-constrained: rather than an empty list, return the models that came
      // closest, each carrying the constraint it failed.
      const overConstrained = passing.length === 0;
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
        contextWindow: e.m.contextWindow,
        capabilities: e.m.capabilities,
        license: e.m.license,
        eloScore: e.m.eloScore ?? null,
        efficiencyScore: e.m.efficiencyScore,
        efficiencyRank: efficiencyRank.get(modelKey(e.m)) ?? null,
        rankedOutOf: ranked.length,
        perRequest: e.m.useCaseCost,
        perRequestOptimized: e.m.optimizedUseCaseCost,
        monthlyBudget: e.m.monthlyBudget,
        monthlyOptimizedBudget: e.m.optimizedMonthlyBudget,
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

      const preamble = overConstrained
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
          ...baseOutput,
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
        },
        content: [
          {
            type: "text",
            text: `${preamble}\n\n${lines.join("\n")}\n\n` +
              `ROI calculator for this scenario: ${roiUrl}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("[recommend-llm-model] failed:", error);
      return {
        structuredContent: { ...baseOutput, error: message },
        content: [{ type: "text", text: `Error recommending a model: ${message}` }],
        isError: true,
      };
    }
  },
)

// ─── Tool 5: Compare Compute Pricing ────────────────────────────────

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
