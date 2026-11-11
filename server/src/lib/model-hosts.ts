/**
 * Every host of a model: the site's `GET /api/model-hosts`.
 *
 * The rows of `/api/llm-models` carry a summary per model (the cheapest host,
 * the dearest, the maker's own, promotional listings: see `host-prices.ts`).
 * This endpoint carries the rest: every host with its rate, the platforms the
 * site lists the model on, and the AWS regions where Amazon Bedrock lists it.
 * It is asked per model, 4 ids at most, by the upstream (OpenRouter) id.
 *
 * It is a second request, made only by the tool that prints the list, and
 * never worth failing an answer for: the caller catches what this throws and
 * serves the summary it already has, saying the list could not be read.
 *
 * Absent means not known, for each of `hosts`, `offers`, `platforms` and
 * `bedrockRegions`: the site leaves a key out when nothing is on record and
 * never writes an empty list. No platforms is not "sold nowhere" (the model is
 * not in the hand-kept list), no Bedrock regions is not "not on Bedrock" (no
 * Bedrock model id matched the model's name). The coercion below keeps that:
 * an empty or malformed list becomes an absent one.
 */
import { UpstreamFetchError, fetchOptimtokenJson, optimtokenUrl } from "./optimtoken-api.js";
import { coerceHostOffer } from "./host-prices.js";
import type { HostOffer } from "./host-prices.js";

/** The site answers 400 beyond this many ids. */
export const MAX_MODEL_HOST_IDS = 4;

/** Short on purpose: the endpoint reads nothing at request time (it serves a
 *  nightly file from the edge), and the answer can be given without it. */
export const MODEL_HOSTS_TIMEOUT_MS = 8_000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/** Where the site lists a model as sold, from a list it keeps by hand. */
export interface ModelPlatforms {
  names: string[];
  /** How the list was established. "estimated" today: reviewed by hand. */
  provenance: string;
}

export interface ModelHostsDetail {
  openRouterId: string;
  /** How many hosts publish a usable rate. */
  hosts?: number;
  /** Every host, cheapest first on the 30/70 blended price, the model maker
   *  first among hosts at one price. */
  offers?: HostOffer[];
  platforms?: ModelPlatforms;
  /** AWS regions where Amazon Bedrock lists the model, in the region or
   *  through a geographic inference profile. */
  bedrockRegions?: string[];
}

export interface ModelHostsMeta {
  schemaVersion?: string;
  /** The day the per-host rates were read (a nightly job). */
  hostPricingAsOf?: string;
  /** The day the platforms list was last reviewed by hand. */
  availabilityReviewedAt?: string;
  /** The day AWS's model list was last read (weekly). */
  bedrockAvailabilityAsOf?: string;
}

export interface ModelHostsResult {
  byId: ReadonlyMap<string, ModelHostsDetail>;
  /** Ids the site's catalogue does not hold. Not "does not exist": the
   *  catalogue is a daily snapshot. */
  notFound: string[];
  meta: ModelHostsMeta;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const textList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(text).filter((item): item is string => item !== undefined);
  return items.length > 0 ? items : undefined;
};

function coerceDetail(value: unknown): ModelHostsDetail | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const openRouterId = text(raw.openRouterId);
  if (!openRouterId) return undefined;

  const detail: ModelHostsDetail = { openRouterId };

  const offers = Array.isArray(raw.offers)
    ? raw.offers.map(coerceHostOffer).filter((offer): offer is HostOffer => offer !== undefined)
    : [];
  if (offers.length > 0) detail.offers = offers;

  if (typeof raw.hosts === "number" && Number.isInteger(raw.hosts) && raw.hosts >= 1) detail.hosts = raw.hosts;

  const platforms = raw.platforms as Record<string, unknown> | null | undefined;
  if (platforms && typeof platforms === "object") {
    const names = textList(platforms.names);
    // Without a stated provenance the list is still the hand-kept one.
    if (names) detail.platforms = { names, provenance: text(platforms.provenance) ?? "estimated" };
  }

  const regions = textList(raw.bedrockRegions);
  if (regions) detail.bedrockRegions = regions;

  return detail;
}

/**
 * Validate the endpoint's payload. Throws when it has no `models` array: an
 * answer in another shape is a failed read, not "no host for any model".
 * Exported for tests.
 */
export function coerceModelHosts(payload: unknown): ModelHostsResult {
  const body = (payload ?? {}) as { models?: unknown; notFound?: unknown; meta?: unknown };
  if (!Array.isArray(body.models)) {
    throw new Error(`/api/model-hosts payload had no "models" array (saw ${typeof body.models}).`);
  }

  const byId = new Map<string, ModelHostsDetail>();
  for (const row of body.models) {
    const detail = coerceDetail(row);
    if (detail) byId.set(detail.openRouterId, detail);
  }

  const meta = (body.meta && typeof body.meta === "object" ? body.meta : {}) as Record<string, unknown>;
  return {
    byId,
    notFound: textList(body.notFound) ?? [],
    meta: {
      schemaVersion: text(meta.schemaVersion),
      hostPricingAsOf: text(meta.hostPricingAsOf),
      availabilityReviewedAt: text(meta.availabilityReviewedAt),
      bedrockAvailabilityAsOf: text(meta.bedrockAvailabilityAsOf),
    },
  };
}

/**
 * Why the list could not be read, in words a reader of the answer can use.
 * The full diagnosis (URL, timing) goes to the log, not into the answer.
 */
export function describeHostListFailure(error: unknown): string {
  if (error instanceof UpstreamFetchError) {
    switch (error.kind) {
      case "timeout":
        return `the site did not answer within ${Math.round(MODEL_HOSTS_TIMEOUT_MS / 1000)} seconds`;
      case "http-status":
        return `the site answered HTTP ${error.status}`;
      case "transport":
        return "the site could not be reached";
      default:
        return "the site's answer could not be read";
    }
  }
  return "the site's answer could not be read";
}

const cache = new Map<string, { fetchedAt: number; result: ModelHostsResult }>();

/** Exported for tests. */
export function resetModelHostsCache(): void {
  cache.clear();
}

/**
 * Every host of up to MAX_MODEL_HOST_IDS models, by upstream id.
 *
 * Throws an `UpstreamFetchError` (timeout, transport, HTTP status, parse) or a
 * plain `Error` (a payload in another shape). The caller decides what to say:
 * this function never substitutes a guess.
 */
export async function fetchModelHosts(ids: readonly string[]): Promise<ModelHostsResult> {
  const wanted = [...new Set(ids.filter((id) => id))].sort();
  if (wanted.length === 0) return { byId: new Map(), notFound: [], meta: {} };
  if (wanted.length > MAX_MODEL_HOST_IDS) {
    throw new Error(`fetchModelHosts takes ${MAX_MODEL_HOST_IDS} ids at most, got ${wanted.length}.`);
  }

  const key = wanted.join("\n");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

  const params = { id: wanted };
  const startedAt = Date.now();
  const payload = await fetchOptimtokenJson<unknown>("api/model-hosts", {
    params,
    timeoutMs: MODEL_HOSTS_TIMEOUT_MS,
  });

  let result: ModelHostsResult;
  try {
    result = coerceModelHosts(payload);
  } catch (error) {
    throw new UpstreamFetchError("guard", error instanceof Error ? error.message : String(error), {
      url: optimtokenUrl("api/model-hosts", params),
      elapsedMs: Date.now() - startedAt,
    });
  }

  // A bounded memo: the keys are sets of model ids a caller chose, so the map
  // would otherwise grow with every distinct combination asked for.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { fetchedAt: Date.now(), result });
  return result;
}
