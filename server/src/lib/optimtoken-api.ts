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
 *
 * Every request names this server (`USER_AGENT`), follows a redirect only on
 * the site's own origin, and reads at most `MAX_BODY_BYTES`. The listing says
 * this server calls optimtoken.optimnow.io and nothing else: a redirect to
 * another host would make that untrue, so it is a failed read.
 */

import { SERVER_VERSION } from "./version.js";

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

/** The one host this server reads from. A redirect is followed only to it. */
const OPTIMTOKEN_ORIGIN = new URL(OPTIMTOKEN_BASE_URL).origin;

/**
 * How this server names itself to the site. Node's fetch sends "node", which
 * the site's logs cannot tell from any other script; this tells MCP traffic
 * apart, and says which release made a request.
 */
export const USER_AGENT = `ai-pricing-hub-mcp/${SERVER_VERSION} (+https://github.com/OptimNow/ai-pricing-hub-mcp)`;

/**
 * The largest body this server reads. The biggest endpoint sent 439 KB on
 * 2026-11-22 (one region of the compute catalogue); 16 MiB is about 36 times
 * that. A body past it is a failed read, not a cut one: it is refused before
 * it is parsed, so a pathological answer cannot fill the machine's 512 MB.
 */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Redirects followed on the site's own origin before giving up. */
const MAX_REDIRECTS = 3;

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
  /** A redirect to another origin, or more redirects than MAX_REDIRECTS. */
  | "redirect"
  /** A body larger than MAX_BODY_BYTES. */
  | "too-large"
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

/** A query parameter: one value, or several for a parameter the site reads
 *  repeated (`?id=a&id=b`). */
export type QueryValue = string | readonly string[] | undefined;

export function optimtokenUrl(path: string, params?: Record<string, QueryValue>): string {
  const url = new URL(path, `${OPTIMTOKEN_BASE_URL}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "string") url.searchParams.set(key, value);
    else for (const item of value) url.searchParams.append(key, item);
  }
  return url.toString();
}

/** A 3xx that names where to go. A 304, or a 3xx without a Location, is not
 *  followed: it is a status like any other, and not a 2xx. */
function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400 && response.status !== 304 && response.headers.has("location");
}

/** The body as text, refused past MAX_BODY_BYTES without reading the rest. */
async function readCapped(response: Response, tooLarge: () => Error): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET a JSON document from the site, under a hard deadline, with the timer
 * cleared on every exit so a slow response cannot leave a handle behind.
 *
 * Throws on transport failure, non-2xx, or a body that is not a JSON object.
 * Callers decide what a *semantically* unusable payload is — that judgement
 * needs the endpoint's own floor, so it does not belong here.
 */
export async function fetchOptimtokenJson<T>(
  path: string,
  options: { params?: Record<string, QueryValue>; timeoutMs: number },
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

  /** One GET, with a timeout or a connection failure classified. */
  const get = async (target: string): Promise<Response> => {
    try {
      return await fetch(target, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        // Redirects are followed below, and only on the site's own origin.
        redirect: "manual",
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
  };

  try {
    let response = await get(url);
    for (let hops = 0; isRedirect(response); hops++) {
      const location = response.headers.get("location") ?? "";
      await response.body?.cancel().catch(() => {});
      let next: URL | undefined;
      try {
        next = new URL(location, response.url || url);
      } catch {
        next = undefined;
      }
      if (!next || next.origin !== OPTIMTOKEN_ORIGIN) {
        throw new UpstreamFetchError(
          "redirect",
          `${url} redirected to ${next ? next.origin : JSON.stringify(location.slice(0, 80))}, which is not ${OPTIMTOKEN_ORIGIN}`,
          { url, elapsedMs: elapsed(), status: response.status },
        );
      }
      if (hops >= MAX_REDIRECTS) {
        throw new UpstreamFetchError("redirect", `${url} redirected more than ${MAX_REDIRECTS} times`, {
          url,
          elapsedMs: elapsed(),
          status: response.status,
        });
      }
      response = await get(next.toString());
    }

    if (!response.ok) {
      throw new UpstreamFetchError("http-status", `${url} returned HTTP ${response.status}`, {
        url,
        elapsedMs: elapsed(),
        status: response.status,
      });
    }

    const tooLarge = (): UpstreamFetchError =>
      new UpstreamFetchError("too-large", `${url} sent a body larger than ${MAX_BODY_BYTES} bytes`, {
        url,
        elapsedMs: elapsed(),
        status: response.status,
      });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw tooLarge();
    }

    let body: string;
    try {
      body = await readCapped(response, tooLarge);
    } catch (error) {
      if (error instanceof UpstreamFetchError) throw error;
      // The body can also time out mid-stream: headers arriving is not the
      // same as the response being in hand.
      if (timedOut) {
        throw new UpstreamFetchError(
          "timeout",
          `${url} sent headers but the body did not finish within ${options.timeoutMs}ms`,
          { url, elapsedMs: elapsed(), timeoutMs: options.timeoutMs, status: response.status },
        );
      }
      throw new UpstreamFetchError(
        "transport",
        `${url} returned HTTP ${response.status} and the connection failed while its body was read: ${error instanceof Error ? error.message : String(error)}`,
        { url, elapsedMs: elapsed(), status: response.status },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch (error) {
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
