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

/**
 * Why an upstream call did not produce usable data.
 *
 * The fallback chain is deliberately quiet about *which* failure it absorbed —
 * every tier degrades to the next one the same way. That is fine for serving
 * and useless for diagnosis: a 20s timeout against a 50s cold rebuild and a
 * genuine outage produce byte-identical tier-2 responses. Classifying the
 * failure is what turns "the site was unreachable" into an actionable fact.
 */
export type UpstreamFailureKind =
  /** The request hit our own deadline. The upstream may still be working. */
  | "timeout"
  /** DNS, TLS, connection reset — the request never got an HTTP response. */
  | "transport"
  /** An HTTP response arrived, but not a 2xx. */
  | "http-status"
  /** 2xx, but the body was not parseable JSON. */
  | "parse"
  /** Parseable JSON, but not a JSON object. */
  | "not-object"
  /** A well-formed response the caller's own plausibility guard rejected. */
  | "guard";

export class UpstreamFetchError extends Error {
  readonly kind: UpstreamFailureKind;
  readonly url: string;
  /** Wall-clock time spent before giving up. The number that tells a timeout
   *  apart from a fast failure without re-running anything. */
  readonly elapsedMs: number;
  readonly status?: number;
  readonly timeoutMs?: number;

  constructor(
    kind: UpstreamFailureKind,
    message: string,
    context: { url: string; elapsedMs: number; status?: number; timeoutMs?: number },
  ) {
    super(message);
    this.name = "UpstreamFetchError";
    this.kind = kind;
    this.url = context.url;
    this.elapsedMs = context.elapsedMs;
    this.status = context.status;
    this.timeoutMs = context.timeoutMs;
  }

  /** One line, safe to log and to put in a provenance field. */
  get summary(): string {
    const status = this.status !== undefined ? ` status=${this.status}` : "";
    const budget = this.kind === "timeout" && this.timeoutMs !== undefined ? `/${this.timeoutMs}ms budget` : "";
    return `${this.kind} after ${this.elapsedMs}ms${budget}${status}: ${this.message}`;
  }
}

/** Classify anything thrown out of the fetch path, so callers never have to
 *  string-match on an error message to know what happened. */
export function describeUpstreamFailure(error: unknown): {
  kind: UpstreamFailureKind | "unknown";
  summary: string;
  elapsedMs?: number;
  status?: number;
} {
  if (error instanceof UpstreamFetchError) {
    return { kind: error.kind, summary: error.summary, elapsedMs: error.elapsedMs, status: error.status };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "unknown", summary: `unknown: ${message}` };
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
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  const elapsed = () => Date.now() - startedAt;

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      // An abort raised by our own timer and a connection reset both surface
      // here, and they mean opposite things: the first says upstream is slow
      // (and probably still building), the second says it is unreachable.
      if (timedOut) {
        throw new UpstreamFetchError("timeout", `${url} did not respond within ${options.timeoutMs}ms`, {
          url,
          elapsedMs: elapsed(),
          timeoutMs: options.timeoutMs,
        });
      }
      throw new UpstreamFetchError(
        "transport",
        `${url} failed before any HTTP response: ${error instanceof Error ? error.message : String(error)}`,
        { url, elapsedMs: elapsed() },
      );
    }

    if (!response.ok) {
      throw new UpstreamFetchError("http-status", `${url} returned HTTP ${response.status}`, {
        url,
        elapsedMs: elapsed(),
        status: response.status,
      });
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch (error) {
      // The body can also time out mid-stream — this endpoint ships ~1.4 MB, so
      // headers arriving is not the same as the response being in hand.
      if (timedOut) {
        throw new UpstreamFetchError(
          "timeout",
          `${url} sent headers but the body did not finish within ${options.timeoutMs}ms`,
          { url, elapsedMs: elapsed(), timeoutMs: options.timeoutMs, status: response.status },
        );
      }
      throw new UpstreamFetchError(
        "parse",
        `${url} returned HTTP ${response.status} with a body that is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { url, elapsedMs: elapsed(), status: response.status },
      );
    }

    if (payload === null || typeof payload !== "object") {
      throw new UpstreamFetchError(
        "not-object",
        `${url} returned ${payload === null ? "null" : typeof payload}, not a JSON object`,
        { url, elapsedMs: elapsed(), status: response.status },
      );
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}
