/**
 * The LLM catalogue: read from the site, or from the snapshot taken of it.
 *
 * Until 0.11.0 this file also held a port of the site's own transform of
 * OpenRouter's catalogue (cloud-sparkle-compare/api/llm-models.ts: the Arena
 * table, the exclusion rules, the licence prefixes, 700 lines of it), run as a
 * second tier when the site could not be reached. It was removed, on the
 * owner's decision, once it was measured against the site's transform of the
 * same payload (2026-11-12, 288 models listed by both): the openness label
 * differed on 84, the licence on 113, and 23 models the site lists were
 * missing. It was ahead of a days-old snapshot on price freshness and behind
 * on everything else. Do not bring a second live source back without
 * something that holds it to the site: a port that only runs when the site is
 * down drifts unseen. docs/DESIGN.md, "Data sources and the fallback chain".
 */

// ── Types ──────────────────────────────────────────────────────────

import { llmModels, dataLastUpdated, llmEloAsOf, LLM_CAPABILITIES } from "../data/pricing-data.js";
import type { LLMModel, LLMCapability, LLMCategory } from "../data/pricing-data.js";
import { hasPublishableTokenPricing } from "./pricing-normalize.js";
import { isRecognisedLicence, opennessOf } from "./openness.js";
import { OPTIMTOKEN_BASE_URL, fetchOptimtokenJson } from "./optimtoken-api.js";
import { coerceHostPricing } from "./host-prices.js";
import type { ModelHostPricing } from "./host-prices.js";
import { NO_DEPRECATION_DATA, coerceDeprecation } from "./deprecation.js";
import { noteSiteSchema } from "./site-schema.js";

export type { LLMModel, LLMCapability, LLMCategory };

/** The key `LLMFetchResult.hostPricing` is indexed by. */
export function hostPricingKey(m: { provider: string; model: string }): string {
  return `${m.provider}/${m.model}`;
}

/**
 * Which source served the response: the site, or the snapshot.
 *
 * `"static-fallback"` keeps the meaning it has always had. A third value,
 * `"openrouter"`, was served by the tier removed in 0.11.0 and is never sent.
 */
export type ModelSource = "optimtoken" | "static-fallback";

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
 * A 200 response with a missing, renamed or collapsed `models` array used to
 * become an empty catalogue that looked perfectly healthy. Anything below this
 * floor is treated as an upstream failure and hands over to the static
 * snapshot. Mirrors ABSOLUTE_MODEL_FLOOR in the web app's pipeline.
 */
const MIN_PLAUSIBLE_CATALOGUE = 80;

/** Upstream must answer within this, well inside the platform's own ceiling. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** How long the site's catalogue is reused before we ask upstream again. */
export const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * How long the snapshot is reused before the SITE is asked again.
 *
 * Not the site's 15 minutes: one failed read of the site (a single 502, one
 * answer past the deadline) must not hold this server on a snapshot for a
 * quarter of an hour while the site answers again a second later. That is
 * what happened to the tier that stood here until 0.11.0, reproduced on
 * 2026-11-12. Not zero either: while the site hangs, each attempt costs its
 * whole timeout, and a minute's memo keeps that to one caller a minute
 * instead of every caller.
 */
export const FALLBACK_CACHE_TTL_MS = 60 * 1000;

// Best-effort only: this survives just as long as the process does (on Fly.io,
// until the idle machine stops), and a cold start simply refetches.
let cache: { result: LLMFetchResult; fetchedAt: number; ttlMs: number } | null = null;

/** Drop the memo. Tests drive the two tiers by stubbing fetch, so they need to
 *  be able to ask again rather than get the previous answer back. */
export function resetLLMModelCache(): void {
  cache = null;
}

/**
 * Where a set of prices came from, and whether anyone has checked them.
 *
 * The site is where correctness lives: OpenRouter, its upstream, intermittently
 * publishes a model at exactly half its vendor's list rate across every price
 * field at once, and the corrections for that are the site's (PRICE_OVERRIDES,
 * verified against the vendors' own pricing pages), as are the licences it
 * verifies model by model. A response that could not be read from the site is
 * the snapshot of an earlier day, and has to say so and say which day: a
 * silent downgrade is worse than an outage, because the caller quotes the
 * number either way.
 */
export interface LLMProvenance {
  /** 1 = the site, 2 = the static snapshot: the numbering the compute tools
   *  use. Until 0.11.0 the snapshot was 3, and 2 was direct OpenRouter. */
  tier: 1 | 2;
  source: ModelSource;
  /** One-line human description of the tier that served. */
  label: string;
  /** True only on tier 1: the site's corrected prices, as it serves them now.
   *  False on the snapshot, whose prices were the site's on the day it was
   *  taken (`dataAsOf`) and may have moved since. */
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
  /** The day the site last read each model's hosts (tier 1 only). It dates
   *  `hostPricing`, and the outlier and promotional flags decided from it:
   *  those come from a nightly job, not from the request. */
  hostPricingAsOf?: string;
  /** The day the site last re-read its table of retirement notices against
   *  each model maker's own page (tier 1 only). It dates every `deprecation`
   *  on a row, and the absence of one. Absent on the snapshot, which carries
   *  no notice at all. */
  deprecationsVerifiedAt?: string;
  dataAsOf?: string;
  /** Loud warning when the prices are not the site's corrected ones. */
  notice?: string;
}

export interface LLMFetchResult {
  models: LLMModel[];
  /**
   * Who sells each model and at what range, keyed by `hostPricingKey()`.
   *
   * Kept beside the models rather than on them: every tool spreads a model
   * row into `structuredContent`, whose schemas refuse undeclared properties,
   * so a field added to `LLMModel` reaches all of them at once. Empty on
   * the snapshot, which has no host data, and missing a model whose listing
   * is newer than the site's last read. Absent means unknown, never "one host".
   */
  hostPricing: ReadonlyMap<string, ModelHostPricing>;
  /**
   * Each model's upstream (OpenRouter) id, keyed by `hostPricingKey()`: what
   * the site's per-model endpoints are asked by. Beside the rows for the same
   * reason as `hostPricing`, and for every model the site gives an id, not
   * only those with a host summary. Empty on the snapshot.
   */
  openRouterIds: ReadonlyMap<string, string>;
  source: ModelSource;
  eloAsOf: string;
  dataAsOf?: string;
  provenance: LLMProvenance;
}

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
    hostPricingAsOf?: unknown;
    deprecationsVerifiedAt?: unknown;
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
/** Exported for tests. */
export function coerceSiteModel(row: unknown): LLMModel | null {
  if (row === null || typeof row !== "object") return null;
  const m = row as Record<string, unknown>;

  if (typeof m.provider !== "string" || !m.provider) return null;
  if (typeof m.model !== "string" || !m.model) return null;
  if (typeof m.inputPricePer1M !== "number" || typeof m.outputPricePer1M !== "number") return null;
  if (!hasPublishableTokenPricing(m.inputPricePer1M, m.outputPricePer1M)) return null;

  const optionalNumber = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  // The two listing flags are `true` or absent upstream. Anything else is
  // dropped rather than coerced: a flag that refuses a badge must not be set by
  // a truthy string.
  const flag = (v: unknown): true | undefined => (v === true ? true : undefined);

  const cacheWrite = optionalNumber(m.cacheWritePricePer1M);

  return {
    provider: m.provider,
    model: m.model,
    parameters: typeof m.parameters === "string" ? m.parameters : undefined,
    inputPricePer1M: m.inputPricePer1M,
    outputPricePer1M: m.outputPricePer1M,
    batchInputPricePer1M: optionalNumber(m.batchInputPricePer1M),
    batchOutputPricePer1M: optionalNumber(m.batchOutputPricePer1M),
    cachedInputPricePer1M: optionalNumber(m.cachedInputPricePer1M),
    // Schema 2.3. Dropping it is not neutral: the optimized cost then credits
    // every cache read without charging the write that made it possible, which
    // understated the figure for 37 models until this field was carried.
    cacheWritePricePer1M: cacheWrite !== undefined && cacheWrite > 0 ? cacheWrite : undefined,
    contextWindow: typeof m.contextWindow === "string" ? m.contextWindow : "",
    // The site owns the taxonomy: its `category` is the price tier
    // (Frontier | Mid-tier | Budget | Image) and its `license` drives our
    // openness axis. Neither is re-derived here — deriving it locally is what
    // put a retired "Open Weights" category and an unrecognised "Llama 4"
    // licence into this repo in the first place.
    category: (typeof m.category === "string" ? m.category : "Budget") as LLMCategory,
    // Only the values this server declares. A site deployment a release behind
    // (or rolled back) can still send "Code", and a filter on a value the tool
    // descriptions say does not exist must not quietly match.
    capabilities: Array.isArray(m.capabilities)
      ? m.capabilities.filter((c): c is LLMCapability =>
          (LLM_CAPABILITIES as readonly unknown[]).includes(c),
        )
      : [],
    releaseDate: typeof m.releaseDate === "string" ? m.releaseDate : undefined,
    eloScore: optionalNumber(m.eloScore),
    license: typeof m.license === "string" ? m.license : undefined,
    // Schema 2.6 and 2.7: what kind of price this row quotes. The site decides
    // both from its per-host fan-out; this server only repeats the verdict.
    outlierListing: flag(m.outlierListing),
    promotionalListing: flag(m.promotionalListing),
    // Schema 2.8: the maker's retirement notice, from the site's hand-kept
    // table. Repeated as sent; this server keeps no copy of that table.
    deprecation: coerceDeprecation(m.deprecation),
  };
}

/** Licence strings already reported, so a string the buckets do not know is
 *  logged once per process rather than on every 15-minute refetch. */
const reportedLicences = new Set<string>();

/** Say so in the log when the site sends a licence `openness.ts` cannot bucket.
 *  Nothing else notices: the model simply reads "Unknown". */
function reportUnrecognisedLicences(models: LLMModel[]): void {
  const unknown = new Set<string>();
  for (const m of models) {
    if (m.license && !isRecognisedLicence(m.license) && !reportedLicences.has(m.license)) {
      unknown.add(m.license);
    }
  }
  if (unknown.size === 0) return;
  for (const licence of unknown) reportedLicences.add(licence);
  console.warn(
    `[llm-models] ${unknown.size} licence string(s) from the site are not in openness.ts and read ` +
      `"Unknown": ${[...unknown].join(", ")}. Copy the site's lists (src/lib/openness.ts).`,
  );
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
  // it is no more authoritative than our own snapshot and carries no fresh
  // corrections. Treat it as a tier-1 failure rather than pass it off as live.
  if (meta.source !== "openrouter") {
    throw new Error(
      `Site reported meta.source="${meta.source ?? "undefined"}" rather than "openrouter" — it is serving its own fallback, not live corrected data.`,
    );
  }

  // One pass, so each host summary stays with the row it arrived on. It goes
  // into a map beside the models, not onto them: see LLMFetchResult.hostPricing.
  const accepted: LLMModel[] = [];
  const hostPricing = new Map<string, ModelHostPricing>();
  const openRouterIds = new Map<string, string>();
  for (const row of payload.models as unknown[]) {
    const model = coerceSiteModel(row);
    if (model === null) continue;
    accepted.push(model);
    const raw = row as Record<string, unknown>;
    const openRouterId = typeof raw.openRouterId === "string" && raw.openRouterId ? raw.openRouterId : undefined;
    if (openRouterId) openRouterIds.set(hostPricingKey(model), openRouterId);
    const summary = coerceHostPricing(raw.hostPricing);
    if (summary) hostPricing.set(hostPricingKey(model), { summary, openRouterId });
  }
  const models = sortModels(accepted);

  if (models.length < MIN_PLAUSIBLE_CATALOGUE) {
    throw new Error(
      `Only ${models.length} models survived validation (minimum ${MIN_PLAUSIBLE_CATALOGUE}) out of ${(payload.models as unknown[]).length} site entries.`,
    );
  }

  reportUnrecognisedLicences(models);
  noteSiteSchema("/api/llm-models", meta.schemaVersion);

  // The site publishes the vintage of the Arena scores on its rows. Should a
  // deployment not state one, the snapshot's is the latest this server knows.
  const eloAsOf = typeof meta.eloAsOf === "string" && meta.eloAsOf ? meta.eloAsOf : llmEloAsOf;

  return {
    models,
    hostPricing,
    openRouterIds,
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
      hostPricingAsOf:
        typeof meta.hostPricingAsOf === "string" && meta.hostPricingAsOf ? meta.hostPricingAsOf : undefined,
      deprecationsVerifiedAt:
        typeof meta.deprecationsVerifiedAt === "string" && meta.deprecationsVerifiedAt
          ? meta.deprecationsVerifiedAt
          : undefined,
    },
  };
}

// ── Tier 2: the snapshot of the site ────────────────────────────────

function fetchFromSnapshot(): LLMFetchResult {
  return {
    models: staticFallback(),
    hostPricing: new Map(),
    openRouterIds: new Map(),
    source: "static-fallback",
    eloAsOf: llmEloAsOf,
    dataAsOf: dataLastUpdated,
    provenance: {
      tier: 2,
      source: "static-fallback",
      label: `static snapshot of optimtoken.optimnow.io taken ${dataLastUpdated} — no network`,
      pricesVerified: false,
      eloAsOf: llmEloAsOf,
      dataAsOf: dataLastUpdated,
      notice:
        `STALE PRICING: optimtoken.optimnow.io could not be read, so these figures are the snapshot of it ` +
        `taken on ${dataLastUpdated}: the prices, licences and Arena scores the site served that day. ` +
        `Any of them may have moved since, and a model listed since is missing. ${NO_DEPRECATION_DATA}`,
    },
  };
}

/**
 * Fetch the model catalogue: the site, or the snapshot of it when the site
 * cannot be read.
 *
 * Each reports what it is in `provenance`, and the snapshot carries an explicit
 * notice with the day it was taken. A caller instructed to report prices
 * exactly as returned must be able to tell today's figures from that day's.
 */
export async function fetchLLMModels(): Promise<LLMFetchResult> {
  if (cache && Date.now() - cache.fetchedAt < cache.ttlMs) {
    return cache.result;
  }

  // One fetch shared between concurrent callers. Cheaper here than on the
  // compute side (~200 ms cold rather than ~10 s) but free to do, and it stops
  // a burst of tool calls on a cold process from asking the site several times
  // over.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      return await fetchAllTiers();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

let inflight: Promise<LLMFetchResult> | null = null;

async function fetchAllTiers(): Promise<LLMFetchResult> {
  try {
    const result = await fetchFromSite();
    cache = { result, fetchedAt: Date.now(), ttlMs: CACHE_TTL_MS };
    return result;
  } catch (siteError) {
    console.error("[llm-models] site API failed, serving the static snapshot:", siteError);
    // Remembered for a minute, never for the site's quarter of an hour: see
    // FALLBACK_CACHE_TTL_MS. Until 0.11.0 the snapshot was not remembered at
    // all, which was right while a live second tier stood in front of it and
    // absorbed the wait; without one, every caller would pay the site's whole
    // timeout for as long as the site hangs.
    const result = fetchFromSnapshot();
    cache = { result, fetchedAt: Date.now(), ttlMs: FALLBACK_CACHE_TTL_MS };
    return result;
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
   *  rather than silently made. Capped — see `totalMatches` for the real count. */
  alternatives: string[];
  /** How many rows the query hit in total, before `alternatives` was capped.
   *  Reporting `alternatives.length + 1` as the total told the caller six models
   *  were weighed when thirty had been dropped. */
  totalMatches: number;
}

/** How many alternatives a resolution carries. Enough to show the caller what
 *  else the name could have meant, without pasting the catalogue at them. */
const MAX_ALTERNATIVES = 5;

/** Resolve one free-text name to a single row, recording how confident that was. */
export function resolveModel<T extends LLMModel>(models: T[], query: string): ModelResolution<T> {
  const all = matchModels(models, query, Number.POSITIVE_INFINITY);
  if (all.length === 0) return { query, status: "not-found", alternatives: [], totalMatches: 0 };

  const search = query.trim().toLowerCase();
  // Exact hits are promoted to the front by matchModels, so counting them here
  // tells us whether "exact" is actually unambiguous. Two providers shipping the
  // same model name is a real case, and picking the first silently is the bug.
  const exactCount = all.filter((m) => m.model.toLowerCase() === search).length;

  const status: ResolutionStatus =
    exactCount === 1 ? "exact" : all.length > 1 ? "ambiguous" : "unique";

  return {
    query,
    status,
    matched: all[0],
    alternatives: all.slice(1, 1 + MAX_ALTERNATIVES).map((m) => `${m.provider} ${m.model}`),
    totalMatches: all.length,
  };
}
