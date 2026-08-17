/**
 * Client for optimtoken.optimnow.io — the source of truth for this server's data.
 *
 * Both of the endpoints wrapped here are public, unauthenticated, CORS-open and
 * edge-cached. They are the deployed face of cloud-sparkle-compare, which is
 * where pricing *correctness* lives: it keeps a committed price archive, a
 * PRICE_OVERRIDES table verified against vendor pricing pages, and an anomaly
 * detector (scripts/check-price-anomalies.mjs) that alarms on the x0.5 / x2.0
 * ratio breaks OpenRouter intermittently serves.
 *
 * This app can build none of that: it has no archive to diff against. So it
 * asks the site rather than re-deriving, and when it cannot reach the site it
 * says so in the response instead of quietly serving uncorrected figures.
 */

/**
 * Base URL for the site API, overridable for local development or for pointing
 * a preview deployment at a preview of the site.
 *
 * One constant, read once: a second hard-coded host is how the two apps drifted
 * in the first place.
 */
export const OPTIMTOKEN_BASE_URL = (
  process.env.OPTIMTOKEN_API_BASE_URL || "https://optimtoken.optimnow.io"
).replace(/\/+$/, "");

/** Shape shared by both endpoints' `meta` block. Fields beyond these exist and
 *  are endpoint-specific; they are typed at each call site. */
export interface OptimtokenMeta {
  schemaVersion?: string;
  timestamp?: string;
  total?: number;
  catalogTotal?: number;
}

export function optimtokenUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path, `${OPTIMTOKEN_BASE_URL}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * GET a JSON document from the site, with the same abort discipline the direct
 * OpenRouter path has always used: a hard deadline, and the timer cleared on
 * every exit so a slow response cannot leave a handle behind.
 *
 * Throws on transport failure, non-2xx, or a body that is not a JSON object.
 * Callers decide what a *semantically* unusable payload is — that judgement
 * needs the endpoint's own floor, so it does not belong here.
 */
export async function fetchOptimtokenJson<T>(
  path: string,
  options: { params?: Record<string, string | undefined>; timeoutMs: number },
): Promise<T> {
  const url = optimtokenUrl(path, options.params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (payload === null || typeof payload !== "object") {
      throw new Error(`${url} returned ${payload === null ? "null" : typeof payload}, not a JSON object`);
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}
