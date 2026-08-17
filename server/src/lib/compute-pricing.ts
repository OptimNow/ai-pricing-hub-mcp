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
import { fetchOptimtokenJson, OPTIMTOKEN_BASE_URL } from "./optimtoken-api.js";

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

/** Generous relative to a warm hit (~0.3s), short enough that a cold upstream
 *  miss (~50s) degrades to the snapshot instead of hanging the tool call. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/** Compute list prices move on a scale of weeks, so this can be long. It also
 *  keeps the ~1.4 MB payload off the wire for repeat calls in one session. */
const CACHE_TTL_MS = 60 * 60 * 1000;

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

async function fetchFromSite(region: PricingRegion): Promise<ComputeFetchResult> {
  const payload = await fetchOptimtokenJson<SitePricingResponse>("api/pricing", {
    params: { region },
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  if (!Array.isArray(payload.instances)) {
    throw new Error(
      `Site payload had no "instances" array (saw ${typeof payload.instances}). Refusing to serve an empty catalogue.`,
    );
  }

  const instances = (payload.instances as unknown[])
    .map(coerceSiteInstance)
    .filter((i): i is ComputeInstance => i !== null);

  if (instances.length < MIN_PLAUSIBLE_COMPUTE_CATALOGUE) {
    throw new Error(
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

function fetchFromSnapshot(region: PricingRegion): ComputeFetchResult {
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
      dataAsOf: dataLastUpdated,
      notice:
        `STALE PRICING: optimtoken.optimnow.io was unreachable, so these ${computeInstances.length} ` +
        `instances come from a snapshot committed ${dataLastUpdated}, against ~5,800 upstream. ` +
        `The snapshot has no region dimension — the "${region}" filter was NOT applied and these ` +
        `are US East list prices.`,
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
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const result = await fetchFromSite(region);
    cache.set(region, { result, fetchedAt: Date.now() });
    return result;
  } catch (error) {
    console.error(`[compute-pricing] site API failed for region "${region}", serving static snapshot:`, error);
    // Deliberately not cached, for the same reason as the LLM snapshot: it
    // would keep answering from frozen data for the full TTL after recovery.
    return fetchFromSnapshot(region);
  }
}
