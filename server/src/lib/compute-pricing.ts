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
 *    cost 9 to 20 s on 2026-11-12; a HIT costs ~0.3s. Every distinct query
 *    string is its own cache entry, and every miss is a fan-out to those six
 *    APIs: three misses inside a minute were enough, that day, for Azure to
 *    answer 429. So this module asks for exactly the URL the site's own
 *    compute page asks for, `?region=<slug>&os=Linux`, and filters the rest
 *    locally: one entry for the two of them, warmed by whichever asks first.
 *    Until 0.10.1 it asked for the region alone. That had been the page's URL
 *    until the site added `?os=`; from then on it was an entry of this
 *    server's own, cold whenever this server was, and 1.44 MB of which the
 *    Windows 42% was dropped on arrival. Adding `?provider=` would be the same
 *    mistake again: a warm hit traded for a cold miss, and less data.
 *  - Prices are per-column, not per-row: `meta.priceTypes` says which of a
 *    provider's six price columns are live, which are static constants, and
 *    which are unavailable. GCP CUDs are `static` (us-east-1 numbers scaled by
 *    a region multiplier), and so were AWS Savings Plans until the site's
 *    schema 1.3: those now come from AWS's published price files, read weekly
 *    and dated by `meta.awsSavingsPlansAsOf`, and fall back to the scaled
 *    estimate when a region's file could not be read. Serving a static figure
 *    next to a live on-demand rate without saying which is which produces a
 *    FinOps answer nobody can audit, so that distinction, and that date, are
 *    carried through to the caller.
 *  - A provider API that fails does not fail the site's answer. The site serves
 *    that provider from its built-in static rows instead (18 Linux rows for
 *    Azure against about 1,700 live ones on 2026-11-12), still under HTTP 200,
 *    and says so in `meta.liveProviders`, `meta.sources` and `meta.errors`. It
 *    keeps such an answer for minutes where it keeps a complete one for a day.
 *    This module reads the three, says the catalogue is incomplete, and keeps
 *    it for minutes too: see `isDegradedCatalogue` and DEGRADED_CACHE_TTL_MS.
 */

import { computeInstances, computeDataLastUpdated } from "../data/pricing-data.js";
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

/**
 * The operating system asked for, spelled as the site's canonical query spells
 * it. The tools serve Linux only, and `region` then `os=Linux` is the compute
 * page's default request. Any other spelling ("linux", `os` before `region`) is
 * answered with a 308 to this one: a round trip, and nothing else gained.
 */
export const PRICING_OS = "Linux";

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
 * 2026-08-18 — 8 cold samples, two in each of the four regions, each on a
 * guaranteed-cold cache key:
 *
 *   /api/llm-models   cold 0.19-0.42 s   warm  31 ms    (68 KB)
 *   /api/pricing      cold 6.1-10.7 s    warm 80-350 ms (1.4 MB)
 *
 * A cold `/api/pricing` is ~28x slower than a cold `/api/llm-models`, because
 * the site assembles the region from six live provider APIs inside a function
 * whose own ceiling is `maxDuration: 60`.
 *
 * Those numbers replaced the 50.5 s cold path measured on 2026-08-17, which is
 * what bought the original 55 s budget. Upstream PR #57 landed on 2026-08-18
 * and cut the cold path by ~6x, and the budget came down to 25 s.
 *
 * Re-measured on 2026-11-12, and the cold path had moved again. Six complete
 * cold answers, from outside the Fly region and through a proxy that adds
 * about half a second:
 *
 *   us-east       13.4 s, 13.9 s
 *   us-west       19.5 s,  8.8 s
 *   europe        14.8 s
 *   asia-pacific   8.9 s
 *
 * Four of the six are past the 11 s this file took as the worst case, and the
 * slowest left a 25 s budget 1.3x of headroom where the guard below asks for
 * 2x. Why it slowed is not established (the catalogue went from about 5,800
 * rows to 6,140 in the interval). A seventh sample is left out: it came back
 * in 8.1 s because Azure answered 429 and the site served the region without
 * it. That one was this measurement's own doing, three cold requests inside a
 * minute, so take cold samples one at a time and minutes apart.
 *
 * 40 s is 2x the worst complete cold answer observed, and the margin is the
 * whole point: a throttled or failing provider API upstream can still push the
 * rebuild past it, and the data cannot arrive faster than upstream can
 * assemble it. A budget that gives up first does not save the caller the wait
 * next time either: an abandoned request leaves no warm entry behind (see the
 * note under these constants). Do not trim this to the LLM endpoint's profile:
 * that is the regression the guard below exists to catch.
 *
 * This server should also meet fewer cold entries than it did. The edge cache
 * is per-key and per-PoP, and until 0.10.1 its key was its own (see the head
 * of this file); it now shares the compute page's.
 */
export const UPSTREAM_TIMEOUT_MS = 40_000;

/** The cold-path time this budget has to cover.
 *
 *  First set to 8.9 s from 8 samples on 2026-08-18. Two independent re-measures
 *  the same day both exceeded it — 10.7 s and 9.3 s, on europe and asia-pacific
 *  — so 8 samples across 4 regions was not enough to characterise an endpoint
 *  that assembles six provider APIs live. Raised to 11 s, which covered every
 *  sample seen until then, and to 20 s on 2026-11-12, when four of six cold
 *  samples were past 11 s and the slowest took 19.5 s (the table above).
 *
 *  The lesson is the file's own: a measurement here is load-bearing, so sample
 *  until the max stops moving rather than until the numbers look tidy. Six
 *  samples is not that. They were not extended because each one is a fan-out
 *  to six provider APIs, and the seventh drew a 429.
 *
 *  Exported so a test can fail if the budget is ever trimmed back toward the
 *  cold path — precisely the regression that pinned this tool to tier 2 when a
 *  20 s budget met a 50.5 s rebuild. */
export const MEASURED_COLD_REBUILD_MS = 20_000;

/** How much headroom the budget must keep over the measured cold path.
 *
 *  When the budget was 55 s against a 50.5 s rebuild, "budget > measured" was
 *  a tight and therefore meaningful assertion. At 25 s against 8.9 s it would
 *  pass at a 9 s budget too — which would be one slow provider API away from
 *  re-pinning the tool to tier 2. The ratio is what carries the guarantee now
 *  that the two numbers are no longer a hair apart. It is also what caught the
 *  2026-11-12 re-measure: 25 s still exceeded 19.5 s, and no longer by 2x. */
export const MIN_COLD_PATH_HEADROOM = 2;

/**
 * Deliberately no retry-on-timeout, and this is the measurement that decided it.
 *
 * The tempting design is a short budget plus a retry: abort early, let the
 * site's function finish and fill the edge cache, then pick the result up
 * cheaply a moment later. Tested against the live endpoint on a guaranteed-cold
 * cache key (a fresh query string), aborting at 20s and then re-probing every
 * 5s: the key was *still cold at t+236s*, nearly five times the ~50s a rebuild
 * cost at the time (2026-08-17). The rebuild is 9 to 20 s now, and this experiment
 * has not been repeated against it — but the mechanism it exposed is not a
 * function of how long the rebuild takes.
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

/**
 * How long an INCOMPLETE catalogue is reused before the site is asked again.
 *
 * The site keeps a complete answer for a day at its edge, one with a provider
 * missing for 30 minutes, and one that is mostly static for 2 (`cacheControlFor`
 * in its api/pricing.ts): an answer holding 18 static Azure rows in place of
 * 1,700 live ones "must not outlive the outage". Memoising it here for the full
 * hour undid that. Asking again is cheap while the site still holds the same
 * answer (an edge hit), and it is what brings the complete catalogue back within
 * minutes of the site having it. The refresh runs behind the caller, as for any
 * stale memo.
 */
export const DEGRADED_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The shortest gap between two background refreshes of one region.
 *
 * A refresh that fails, or that comes back incomplete while the memo is
 * complete, leaves the memo as it was. Without a gap every call past the TTL
 * would then start another request for a 1.4 MB document, for as long as the
 * site stays degraded.
 */
const REFRESH_RETRY_MS = DEGRADED_CACHE_TTL_MS;

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
  /** AWS's own publication date of the Savings Plan price files behind every
   *  AWS savingsPlan1yr/3yr in the response. The site reads them weekly, so
   *  those columns are as fresh as this date, not as `upstreamTimestamp`.
   *  Absent when upstream could not read the region's files. */
  awsSavingsPlansAsOf?: string;
  /** Non-fatal upstream failures, e.g. a provider API that 404'd this run. */
  upstreamErrors?: string[];
  /** How many of the providers the site reads live answered it on this read
   *  (its `meta.liveProviders`, compute schema 1.2), repeated as sent. */
  liveProviders?: { live: number; expected: number };
  /**
   * On tier 1 only: the providers the site normally reads live and could not
   * on this read, with the number of Linux rows each is left with. Those rows
   * are the site's built-in static sample, a small part of the provider's
   * catalogue, so a missing instance is not evidence that it does not exist.
   * Absent when every such provider answered. A provider the site never reads
   * live (Alibaba) is static in `sources` and is not listed here.
   */
  degradedProviders?: { provider: string; rows: number }[];
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
   * True when the rows served are a part of the catalogue: on tier 2, the
   * 137-row snapshot against ~6,000 upstream; on tier 1, an answer in which a
   * provider could not be read live (`degradedProviders`). An empty result then
   * means "no match in what was served", never "no such instance exists".
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
    awsSavingsPlansAsOf?: unknown;
    liveProviders?: unknown;
    total?: number;
    catalogTotal?: number;
    errors?: string[];
  };
}

const cache = new Map<PricingRegion, { result: ComputeFetchResult; fetchedAt: number }>();

/** Drop the memo. Tests drive the tiers by stubbing fetch, so they need to be
 *  able to ask again rather than get the previous tier's answer back. */
export function resetComputePricingCache(): void {
  inflight.clear();
  cache.clear();
  refreshing.clear();
  lastRefreshAt.clear();
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

/** `meta.liveProviders`, when it is two counts that make sense together. */
function coerceLiveProviders(value: unknown): { live: number; expected: number } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { live, expected } = value as Record<string, unknown>;
  const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return count(live) && count(expected) && live <= expected ? { live, expected } : undefined;
}

/**
 * The providers the site normally reads live and could not on this read.
 *
 * Read from the answer itself, so no list of "live-capable" providers is kept
 * here to drift: a provider counts when `meta.sources` says its rows are static
 * AND `meta.errors` carries an entry under its name. The site writes that entry
 * for every provider whose fetch it did not adopt ("Azure: throttled"), and
 * none for a provider it never reads live (Alibaba). An entry for a part of a
 * provider ("AWS Spot: timeout") names no provider and matches nothing.
 */
function degradedProvidersOf(
  meta: NonNullable<SitePricingResponse["meta"]>,
  instances: ComputeInstance[],
): { provider: string; rows: number }[] {
  const sources = meta.sources !== null && typeof meta.sources === "object" ? meta.sources : {};
  const failed = new Set(
    (Array.isArray(meta.errors) ? meta.errors : [])
      .filter((entry): entry is string => typeof entry === "string")
      .map(entry => entry.split(":")[0].trim()),
  );
  return Object.entries(sources)
    .filter(([provider, kind]) => kind === "static" && failed.has(provider))
    .map(([provider]) => ({
      provider,
      rows: instances.filter(i => i.provider === provider && i.os === "Linux").length,
    }));
}

/**
 * True when the site answered (tier 1) with a provider it could not read live:
 * part of what it served is its static sample, not that provider's catalogue.
 *
 * Either signal is enough. The names come from `meta.errors`; the count comes
 * from `meta.liveProviders`, which still says so if the errors are not worded
 * as this module expects.
 */
export function isDegradedCatalogue(provenance: ComputeProvenance): boolean {
  if (provenance.tier !== 1) return false;
  const counts = provenance.liveProviders;
  return (provenance.degradedProviders?.length ?? 0) > 0 || (counts !== undefined && counts.live < counts.expected);
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The sentence that leads an answer built on an incomplete catalogue. */
function degradedNotice(
  liveProviders: { live: number; expected: number } | undefined,
  degraded: { provider: string; rows: number }[],
): string | undefined {
  const missing = liveProviders ? liveProviders.expected - liveProviders.live : degraded.length;
  if (degraded.length === 0 && missing <= 0) return undefined;

  const answered = liveProviders
    ? ` (${liveProviders.live} of the ${liveProviders.expected} providers it reads live answered)`
    : "";
  const tail =
    ` An instance this answer does not list is not thereby unavailable, and an empty result does not ` +
    `mean no such instance exists.`;

  if (degraded.length === 0) {
    return (
      `INCOMPLETE CATALOGUE: optimtoken.optimnow.io could not read ${missing} provider${missing === 1 ? "" : "s"} ` +
      `live on this read${answered}. Their rows are its built-in static sample, a small part of each ` +
      `provider's catalogue; \`provenance.sources\` says which providers are static.` + tail
    );
  }
  const names = degraded.map(d => d.provider);
  const rows = degraded.map(d => `${d.rows} ${d.provider} row${d.rows === 1 ? "" : "s"}`);
  return (
    `INCOMPLETE CATALOGUE: optimtoken.optimnow.io could not read ${listNames(names)} live on this read${answered}. ` +
    `It served its built-in static sample instead (${listNames(rows)}, Linux), a small part of ` +
    `${names.length === 1 ? "that provider's" : "each provider's"} catalogue, at static prices.` + tail
  );
}

/**
 * What to say beside "no match" when the catalogue searched has a provider the
 * site could not read live. Null when every provider answered, on the snapshot
 * tier (each tool words that case itself), and when `provider` names one that
 * WAS read live: its rows are all there, and the gap cannot bear on the answer.
 */
export function incompleteCatalogueCaveat(provenance: ComputeProvenance, provider?: string): string | null {
  if (!isDegradedCatalogue(provenance)) return null;
  const degraded = provenance.degradedProviders ?? [];
  if (degraded.length === 0) {
    return `Some providers could not be read live and are served from a small static sample, so "no match" does not mean no such instance exists.`;
  }
  // With a provider named, only that one bears on the answer.
  const wanted = provider?.trim().toLowerCase();
  const concerned = wanted ? degraded.filter(d => d.provider.toLowerCase() === wanted) : degraded;
  if (concerned.length === 0) return null;
  const names = concerned.map(d => d.provider);
  return (
    `${listNames(names)} could not be read live and ${names.length === 1 ? "is" : "are"} served from a small ` +
    `static sample, so "no match" does not mean no such instance exists.`
  );
}

async function fetchFromSite(region: PricingRegion, timeoutMs: number): Promise<ComputeFetchResult> {
  // `region` then `os`, in that order and that case: the site's canonical
  // spelling, and the compute page's own request (see the head of this file).
  const params = { region, os: PRICING_OS };
  const url = optimtokenUrl("api/pricing", params);
  const startedAt = Date.now();

  const payload = await fetchOptimtokenJson<SitePricingResponse>("api/pricing", { params, timeoutMs });

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

  const liveProviders = coerceLiveProviders(meta.liveProviders);
  const degradedProviders = degradedProvidersOf(meta, instances);
  const incomplete = degradedNotice(liveProviders, degradedProviders);

  const staticNotice = staticPriceColumns.length
    ? `Not every price is live. These columns are served from constants rather than a ` +
      `provider API and may be stale or region-approximated: ${staticPriceColumns.join(", ")}. ` +
      `See priceTypes for the full per-column breakdown.`
    : undefined;
  // The incomplete catalogue first: it changes what "no match" and "cheapest"
  // mean, where the static columns only qualify figures the answer does print.
  const notice = [incomplete, staticNotice].filter(Boolean).join(" ") || undefined;

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
      awsSavingsPlansAsOf:
        typeof meta.awsSavingsPlansAsOf === "string" && meta.awsSavingsPlansAsOf ? meta.awsSavingsPlansAsOf : undefined,
      upstreamErrors: Array.isArray(meta.errors) && meta.errors.length ? meta.errors : undefined,
      liveProviders,
      degradedProviders: degradedProviders.length ? degradedProviders : undefined,
      catalogueIsSubset: incomplete ? true : undefined,
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
      label: `static snapshot committed ${computeDataLastUpdated} — no network`,
      region,
      // The snapshot has no region dimension at all, so saying which region it
      // describes would be a guess. It is US East list pricing by construction.
      sourceRegions: { "All providers": "US East list price (snapshot has no region dimension)" },
      staticPriceColumns: [],
      unavailablePriceColumns: [],
      fallbackReason,
      unappliedFilters: ["region"],
      catalogueIsSubset: true,
      dataAsOf: computeDataLastUpdated,
      notice:
        `STALE PRICING: optimtoken.optimnow.io was unreachable, so these ${computeInstances.length} ` +
        `instances come from a snapshot committed ${computeDataLastUpdated}, against ~5,800 upstream. ` +
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
  // An incomplete catalogue is worth minutes, not the hour: see the constant.
  const ttl = cached && isDegradedCatalogue(cached.result.provenance) ? DEGRADED_CACHE_TTL_MS : CACHE_TTL_MS;

  if (cached && age < ttl) {
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

  // Cold miss. Share one rebuild between every caller that arrives while it is
  // running: measured, 5 concurrent cold callers fired 5 separate /api/pricing
  // requests, each a six-provider assembly upstream costing 9-20s. The stale
  // branch above was already deduped; this one was not, which is the branch
  // that actually costs money.
  const existing = inflight.get(region);
  if (existing) return existing;

  const attempt = (async () => {
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
    } finally {
      // Always clear, or one failure pins every later caller to it.
      inflight.delete(region);
    }
  })();

  inflight.set(region, attempt);
  return attempt;
}

/** In-flight cold fetches, keyed by region. Distinct from `refreshing` below:
 *  that one guards the background refresh of a stale entry, this one guards the
 *  foreground rebuild that callers are actually waiting on. */
const inflight = new Map<PricingRegion, Promise<ComputeFetchResult>>();

/** In-flight refreshes, so N concurrent callers trigger one rebuild rather than
 *  N — each of which would cost upstream a 50s six-provider assembly. */
const refreshing = new Set<PricingRegion>();

/** When the last background refresh of each region started: REFRESH_RETRY_MS. */
const lastRefreshAt = new Map<PricingRegion, number>();

function refreshInBackground(region: PricingRegion): Promise<void> {
  if (refreshing.has(region)) return Promise.resolve();
  const last = lastRefreshAt.get(region);
  if (last !== undefined && Date.now() - last < REFRESH_RETRY_MS) return Promise.resolve();
  refreshing.add(region);
  lastRefreshAt.set(region, Date.now());

  return fetchFromSite(region, upstreamBudget())
    .then(result => {
      // An incomplete answer does not replace a complete memo. Compute list
      // prices move on a scale of weeks, so the hours-old rows of a provider
      // the site cannot read right now beat the 18 static ones it would send in
      // their place. The memo is still inside CACHE_STALE_MS, or this refresh
      // would not have been started; past it, the cold path takes what the site
      // has and says it is incomplete.
      const held = cache.get(region);
      if (held && !isDegradedCatalogue(held.result.provenance) && isDegradedCatalogue(result.provenance)) {
        const who = (result.provenance.degradedProviders ?? []).map(d => d.provider).join(", ") || "a provider";
        console.error(
          `[compute-pricing] refresh for "${region}" came back without ${who} read live; keeping the complete memo`,
        );
        return;
      }
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
