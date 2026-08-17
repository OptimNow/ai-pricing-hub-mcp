/**
 * Cloud compute pricing, fetched from optimtoken.optimnow.io.
 *
 * The static array in ../data/pricing-data.ts is 137 frozen rows against the
 * site's ~5,800, has no region dimension, and nobody re-snapshots it. It stays
 * as a fallback so the server still answers without network, and nothing more.
 *
 * Two upstream properties shape this module:
 *
 *  - The site assembles each region from six live provider APIs. A cache MISS
 *    costs ~50s; a HIT costs ~0.3s. Every distinct query string is its own
 *    cache entry, so we always request the *canonical* per-region URL and do
 *    all filtering locally. Adding `?provider=` to the URL would trade a warm
 *    hit for a cold 50s miss and return less data.
 *  - Prices are per-column, not per-row: `meta.priceTypes` says which of a
 *    provider's six price columns are live, which are static constants, and
 *    which are unavailable. AWS Savings Plans and GCP CUDs are `static` —
 *    us-east-1 numbers scaled by a region multiplier. Serving those next to a
 *    live on-demand rate without saying which is which produces a FinOps answer
 *    nobody can audit, so that distinction is carried through to the caller.
 */

import { computeInstances, dataLastUpdated } from "../data/pricing-data.js";
import type { ComputeInstance, CloudProvider, OperatingSystem } from "../data/pricing-data.js";
import {
  fetchOptimtokenJson,
  optimtokenUrl,
  describeUpstreamFailure,
  UpstreamFetchError,
  OPTIMTOKEN_BASE_URL,
} from "./optimtoken-api.js";

/** Regions the site's `?region=` parameter accepts. */
export const PRICING_REGIONS = ["us-east", "us-west", "europe", "asia-pacific"] as const;
export type PricingRegion = (typeof PRICING_REGIONS)[number];

export const DEFAULT_PRICING_REGION: PricingRegion = "us-east";

export type ComputeSource = "optimtoken" | "static-fallback";

/** The six price columns `meta.priceTypes` reports on, in output order. */
const PRICE_COLUMNS = [
  "onDemand",
  "spot",
  "savingsPlan1yr",
  "savingsPlan3yr",
  "reserved1yr",
  "reserved3yr",
] as const;

/**
 * Smallest catalogue we will serve as live data.
 *
 * Well under the ~5,800 upstream and under the 137-row static array, but high
 * enough that a 200 with an empty or truncated body is caught rather than
 * published as "no instances found". Mirrors MIN_PLAUSIBLE_CATALOGUE on the
 * LLM side.
 */
const MIN_PLAUSIBLE_COMPUTE_CATALOGUE = 100;

/**
 * How long we wait for `/api/pricing`.
 *
 * This is not the same number as the LLM endpoint's, and assuming it was is
 * what kept this tool pinned to tier 2. Measured against the live endpoint on
 * 2026-08-17:
 *
 *   /api/llm-models   cold 209 ms   warm  31 ms    (68 KB)
 *   /api/pricing      cold 50.5 s   warm 80-350 ms (1.4 MB)
 *
 * A cold `/api/pricing` is 240x slower than a cold `/api/llm-models`, because
 * the site assembles the region from six live provider APIs inside a function
 * whose own ceiling is `maxDuration: 60`. The old 20s budget was shorter than
 * the cold path *always* takes, so a cold edge entry could not produce tier 1
 * at all — the fallback was not a timeout risk, it was a certainty.
 *
 * And this server keeps meeting cold entries. The edge cache is per-key and
 * per-PoP: the deployed server returned tier 2 at a moment when the same URL
 * was serving a warm 200ms hit from another location, so it is not sharing
 * whatever entry ambient traffic has warmed. With no steady traffic of its
 * own to hold an entry open, it pays the rebuild — and then aborted at 20s.
 *
 * 55s leaves the site its full 60s budget minus transfer, and is the honest
 * price of a correct answer: the data cannot arrive faster than upstream can
 * assemble it. The memo below is what stops anyone paying it twice.
 */
export const UPSTREAM_TIMEOUT_MS = 55_000;

/** The cold-path time this budget has to cover, measured against the live
 *  endpoint (50.8s / 50.5s / 50.5s on 2026-08-17). Exported so a test can fail
 *  if the budget is ever trimmed back below the only path the endpoint takes —
 *  which is precisely the regression that pinned this tool to tier 2. */
export const MEASURED_COLD_REBUILD_MS = 50_500;

/**
 * Deliberately no retry-on-timeout, and this is the measurement that decided it.
 *
 * The tempting design is a short budget plus a retry: abort early, let the
 * site's function finish and fill the edge cache, then pick the result up
 * cheaply a moment later. Tested against the live endpoint on a guaranteed-cold
 * cache key (a fresh query string), aborting at 20s and then re-probing every
 * 5s: the key was *still cold at t+236s*, nearly five times the ~50s a rebuild
 * takes.
 *
 * An abandoned request does not leave a warm entry behind — each short probe
 * merely starts another rebuild it then abandons too. That is the production
 * trap in miniature: a client that always gives up early can never bootstrap
 * the warm entry that would have made it fast. One request has to be willing to
 * see the rebuild through, which is what UPSTREAM_TIMEOUT_MS above now does.
 */

/**
 * Test seam for the budget above.
 *
 * The timeout path is the one that broke, so it has to be covered — and
 * covering it honestly at production values would mean a 55-second test. This
 * shrinks the budget, never the logic: what a timeout is classified as, and
 * what a fallback reports, are exercised exactly as they run in production.
 */
let budgetOverrideMs: number | null = null;

export function setComputeTimeoutForTest(ms: number | null): void {
  budgetOverrideMs = ms;
}

const upstreamBudget = () => budgetOverrideMs ?? UPSTREAM_TIMEOUT_MS;

/** Compute list prices move on a scale of weeks, so this can be long. It also
 *  keeps the ~1.4 MB payload off the wire for repeat calls in one session. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * How long a *stale* memo may still be served while a refresh runs behind it.
 *
 * Past CACHE_TTL_MS the data wants refreshing, but a 50s cold rebuild is a bad
 * thing to make a caller sit through when an hour-old compute list price is
 * almost certainly still correct — these move on a scale of weeks. Within this
 * window we answer from the memo immediately and refresh in the background, so
 * only the first call in a cold process ever pays the rebuild. Beyond it, the
 * data is old enough that waiting is the right trade.
 */
const CACHE_STALE_MS = 12 * 60 * 60 * 1000;

export interface ComputeProvenance {
  /** 1 = site API, 2 = static snapshot. */
  tier: 1 | 2;
  source: ComputeSource;
  label: string;
  region: PricingRegion;
  upstreamTimestamp?: string;
  upstreamSchemaVersion?: string;
  /** Catalogue size upstream reports, before our filters. */
  catalogTotal?: number;
  /** Per-provider: "live" or "static". */
  sources?: Record<string, string>;
  /** Per-provider: which physical region the figures describe. */
  sourceRegions?: Record<string, string>;
  /** Per-provider, per-column: "live" | "static" | "unavailable". */
  priceTypes?: Record<string, Record<string, string>>;
  /** Flattened "Provider.column" list of every column served from constants
   *  rather than a live API — the audit surface, pre-computed so a caller does
   *  not have to walk `priceTypes` to find it. */
  staticPriceColumns: string[];
  /** Flattened "Provider.column" list of every column upstream cannot supply. */
  unavailablePriceColumns: string[];
  /** Non-fatal upstream failures, e.g. a provider API that 404'd this run. */
  upstreamErrors?: string[];
  /**
   * On tier 2 only: why tier 1 was not reached, classified and timed —
   * e.g. `timeout after 20003ms/20000ms budget`.
   *
   * A fallback that works well and reports itself politely is invisible: this
   * tool served tier 2 for every call while saying only that the site "was
   * unreachable", which is equally true of a 50s cold rebuild against a 20s
   * budget and of a dead host. Those need different fixes, so the response has
   * to distinguish them.
   */
  fallbackReason?: string;
  /**
   * On tier 2 only: filters the caller passed that this tier physically cannot
   * apply. The snapshot has no region dimension, so a region argument is
   * accepted and then ignored.
   *
   * The `notice` has always said so in prose. A consumer that reads only
   * `instances` — and sees a plausible, well-formed, empty array — never got
   * that sentence.
   */
  unappliedFilters?: string[];
  /**
   * On tier 2 only: this tier serves a 137-row subset of the ~5,800 upstream,
   * so an empty result means "no match in the snapshot", never "no such
   * instance exists".
   */
  catalogueIsSubset?: boolean;
  /** Age of the memo entry that answered, when a stale one was served while a
   *  refresh ran behind it. Absent on a fresh fetch. */
  servedFromCacheAgeMs?: number;
  dataAsOf?: string;
  notice?: string;
}

export interface ComputeFetchResult {
  instances: ComputeInstance[];
  source: ComputeSource;
  provenance: ComputeProvenance;
}

interface SitePricingResponse {
  instances?: unknown;
  meta?: {
    schemaVersion?: string;
    region?: string;
    timestamp?: string;
    sources?: Record<string, string>;
    sourceRegions?: Record<string, string>;
    priceTypes?: Record<string, Record<string, string>>;
    total?: number;
    catalogTotal?: number;
    errors?: string[];
  };
}

const cache = new Map<PricingRegion, { result: ComputeFetchResult; fetchedAt: number }>();

/** Drop the memo. Tests drive the tiers by stubbing fetch, so they need to be
 *  able to ask again rather than get the previous tier's answer back. */
export function resetComputePricingCache(): void {
  cache.clear();
  refreshing.clear();
}

/** Seed the memo directly. Lets a test exercise the stale-while-revalidate path
 *  without waiting out a real TTL. */
export function primeComputePricingCache(
  region: PricingRegion,
  result: ComputeFetchResult,
  fetchedAt: number,
): void {
  cache.set(region, { result, fetchedAt });
}

const KNOWN_PROVIDERS = new Set<string>([
  "AWS", "Azure", "GCP", "DigitalOcean", "OCI", "OVH", "Alibaba",
]);

/**
 * Validate one instance row from the site.
 *
 * Prices are nullable by design — not every provider sells every commitment
 * type — but `null` and "the field went missing" have to stay distinguishable,
 * so an absent or non-numeric price becomes an explicit null rather than being
 * dropped or coerced to zero.
 */
function coerceSiteInstance(row: unknown): ComputeInstance | null {
  if (row === null || typeof row !== "object") return null;
  const i = row as Record<string, unknown>;

  if (typeof i.provider !== "string" || !KNOWN_PROVIDERS.has(i.provider)) return null;
  if (typeof i.instanceType !== "string" || !i.instanceType) return null;
  if (typeof i.vCPUs !== "number" || !Number.isFinite(i.vCPUs)) return null;
  if (typeof i.memory !== "number" || !Number.isFinite(i.memory)) return null;

  const price = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    provider: i.provider as CloudProvider,
    instanceType: i.instanceType,
    os: (i.os === "Windows" ? "Windows" : "Linux") as OperatingSystem,
    vCPUs: i.vCPUs,
    memory: i.memory,
    onDemandHourly: price(i.onDemandHourly),
    onDemandMonthly: price(i.onDemandMonthly),
    spot: price(i.spot),
    savingsPlan1yr: price(i.savingsPlan1yr),
    savingsPlan3yr: price(i.savingsPlan3yr),
    reserved1yr: price(i.reserved1yr),
    reserved3yr: price(i.reserved3yr),
  };
}

/** Walk `priceTypes` once, collecting the columns that are not live. */
function classifyPriceColumns(priceTypes: Record<string, Record<string, string>> | undefined) {
  const staticPriceColumns: string[] = [];
  const unavailablePriceColumns: string[] = [];

  for (const [provider, columns] of Object.entries(priceTypes ?? {})) {
    if (columns === null || typeof columns !== "object") continue;
    for (const column of PRICE_COLUMNS) {
      const kind = columns[column];
      if (kind === "static") staticPriceColumns.push(`${provider}.${column}`);
      else if (kind === "unavailable") unavailablePriceColumns.push(`${provider}.${column}`);
    }
  }

  return { staticPriceColumns, unavailablePriceColumns };
}

async function fetchFromSite(region: PricingRegion, timeoutMs: number): Promise<ComputeFetchResult> {
  const url = optimtokenUrl("api/pricing", { region });
  const startedAt = Date.now();

  const payload = await fetchOptimtokenJson<SitePricingResponse>("api/pricing", {
    params: { region },
    timeoutMs,
  });

  // The guard rejections below are upstream failures too, and have to be
  // classified as such: "the shape was wrong" and "the request timed out" are
  // both tier-2 outcomes, and telling them apart is the whole point.
  const guardFailure = (message: string) =>
    new UpstreamFetchError("guard", message, { url, elapsedMs: Date.now() - startedAt });

  if (!Array.isArray(payload.instances)) {
    throw guardFailure(
      `Site payload had no "instances" array (saw ${typeof payload.instances}). Refusing to serve an empty catalogue.`,
    );
  }

  const instances = (payload.instances as unknown[])
    .map(coerceSiteInstance)
    .filter((i): i is ComputeInstance => i !== null);

  if (instances.length < MIN_PLAUSIBLE_COMPUTE_CATALOGUE) {
    throw guardFailure(
      `Only ${instances.length} instances survived validation (minimum ${MIN_PLAUSIBLE_COMPUTE_CATALOGUE}) out of ${(payload.instances as unknown[]).length} site entries.`,
    );
  }

  const meta = payload.meta ?? {};
  const { staticPriceColumns, unavailablePriceColumns } = classifyPriceColumns(meta.priceTypes);

  const notice = staticPriceColumns.length
    ? `Not every price is live. These columns are served from constants rather than a ` +
      `provider API and may be stale or region-approximated: ${staticPriceColumns.join(", ")}. ` +
      `See priceTypes for the full per-column breakdown.`
    : undefined;

  return {
    instances,
    source: "optimtoken",
    provenance: {
      tier: 1,
      source: "optimtoken",
      label: `optimtoken.optimnow.io (${OPTIMTOKEN_BASE_URL}) — ${region}`,
      region,
      upstreamTimestamp: meta.timestamp,
      upstreamSchemaVersion: meta.schemaVersion,
      catalogTotal: typeof meta.catalogTotal === "number" ? meta.catalogTotal : undefined,
      sources: meta.sources,
      sourceRegions: meta.sourceRegions,
      priceTypes: meta.priceTypes,
      staticPriceColumns,
      unavailablePriceColumns,
      upstreamErrors: Array.isArray(meta.errors) && meta.errors.length ? meta.errors : undefined,
      notice,
    },
  };
}

function fetchFromSnapshot(region: PricingRegion, fallbackReason?: string): ComputeFetchResult {
  return {
    instances: computeInstances,
    source: "static-fallback",
    provenance: {
      tier: 2,
      source: "static-fallback",
      label: `static snapshot committed ${dataLastUpdated} — no network`,
      region,
      // The snapshot has no region dimension at all, so saying which region it
      // describes would be a guess. It is US East list pricing by construction.
      sourceRegions: { "All providers": "US East list price (snapshot has no region dimension)" },
      staticPriceColumns: [],
      unavailablePriceColumns: [],
      fallbackReason,
      unappliedFilters: ["region"],
      catalogueIsSubset: true,
      dataAsOf: dataLastUpdated,
      notice:
        `STALE PRICING: optimtoken.optimnow.io was unreachable, so these ${computeInstances.length} ` +
        `instances come from a snapshot committed ${dataLastUpdated}, against ~5,800 upstream. ` +
        `The snapshot has no region dimension — the "${region}" filter was NOT applied and these ` +
        `are US East list prices. Because it is a ${computeInstances.length}-row subset, an empty ` +
        `result means "not in the snapshot", not "no such instance exists".` +
        (fallbackReason ? ` Upstream failure: ${fallbackReason}.` : ""),
    },
  };
}

/**
 * Fetch compute instances for a region, degrading site -> static snapshot.
 *
 * Returns the full catalogue; filtering and sorting happen at the call site,
 * because "the 20 cheapest matching instances" is only correct when computed
 * over everything rather than over whatever slice upstream happened to return.
 */
export async function fetchComputeInstances(
  region: PricingRegion = DEFAULT_PRICING_REGION,
): Promise<ComputeFetchResult> {
  const cached = cache.get(region);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;

  if (cached && age < CACHE_TTL_MS) {
    return cached.result;
  }

  // Stale but usable: answer now, refresh behind the caller. Without this,
  // every TTL expiry hands some unlucky caller a 50s rebuild.
  if (cached && age < CACHE_STALE_MS) {
    void refreshInBackground(region);
    return {
      ...cached.result,
      provenance: { ...cached.result.provenance, servedFromCacheAgeMs: age },
    };
  }

  try {
    const result = await fetchFromSite(region, upstreamBudget());
    cache.set(region, { result, fetchedAt: Date.now() });
    return result;
  } catch (error) {
    const { summary } = describeUpstreamFailure(error);
    console.error(
      `[compute-pricing] site API failed for region "${region}" (${summary}), serving static snapshot`,
    );
    // Deliberately not cached, for the same reason as the LLM snapshot: it
    // would keep answering from frozen data for the full TTL after recovery.
    return fetchFromSnapshot(region, summary);
  }
}

/** In-flight refreshes, so N concurrent callers trigger one rebuild rather than
 *  N — each of which would cost upstream a 50s six-provider assembly. */
const refreshing = new Set<PricingRegion>();

function refreshInBackground(region: PricingRegion): Promise<void> {
  if (refreshing.has(region)) return Promise.resolve();
  refreshing.add(region);

  return fetchFromSite(region, upstreamBudget())
    .then(result => {
      cache.set(region, { result, fetchedAt: Date.now() });
    })
    .catch(error => {
      // A failed refresh leaves the stale entry in place: hour-old list prices
      // beat a snapshot from a different month. It ages out at CACHE_STALE_MS.
      const { summary } = describeUpstreamFailure(error);
      console.error(`[compute-pricing] background refresh for "${region}" failed (${summary})`);
    })
    .finally(() => {
      refreshing.delete(region);
    });
}
