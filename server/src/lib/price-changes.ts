/**
 * What moved: the site's `GET /api/price-changes`.
 *
 * Every other tool here quotes today's price. This endpoint says whether that
 * price has just moved, from the site's committed price archive (a nightly
 * job; nothing is fetched with the request). It answers two questions:
 *
 *   no id   the moves of the trend window, the last 7 days at most: what the
 *           site's price barometer lists
 *   ?id=    one model's quoted price since tracking began
 *
 * The site's vocabulary, kept here: a MOVE is a change of 1% or more in the
 * blended price (30% input, 70% output) of the price the site QUOTES. Most
 * models are sold by several hosts at different rates and the site quotes one
 * of them, so the quoted price can move while every host holds its own rate.
 * The site FLAGS the moves it can establish as such: `hostSwitch` (a change of
 * the host quoted) and `outlierHost` (an outlier listing). The unflagged moves
 * are what its barometer counts as PRICE CHANGES.
 *
 * A flag is written only when established. A move without one is not
 * established as either, which is NOT a statement that the model maker
 * repriced. Every sentence built on this file has to keep that.
 *
 * There is no fallback tier: this server holds no price archive and cannot
 * build one. When the site does not answer, the tool says so and returns no
 * move, never an empty list that would read as "nothing moved".
 */
import { UpstreamFetchError, fetchOptimtokenJson, optimtokenUrl } from "./optimtoken-api.js";
import { noteSiteSchema } from "./site-schema.js";

/** The archive is a file the site serves from the edge: a slow answer is a
 *  fault, and nothing else in the response waits on it. */
export const PRICE_CHANGES_TIMEOUT_MS = 10_000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const HISTORY_CACHE_MAX_ENTRIES = 200;

export interface PricePair {
  input: number;
  output: number;
}

export interface PriceChangesMeta {
  schemaVersion?: string;
  /** First and last day of the window the moves are measured over. */
  windowStart?: string;
  windowEnd?: string;
  /** First and newest day of the price archive. */
  trackingStart?: string;
  asOf?: string;
}

export interface PriceMove {
  provider: string;
  model: string;
  openRouterId?: string;
  /** The price quoted on the first and on the last day of the window. */
  before: PricePair;
  after: PricePair;
  blendedPct: number;
  /** Null when the price it starts from is zero. */
  inputPct: number | null;
  outputPct: number | null;
  /** The flags the site established. Empty is "none established", not
   *  "the maker repriced". */
  flags: string[];
}

export interface PriceChangesSummary {
  /** Models the window compared, moved or not. Null when the site did not say. */
  tracked: number | null;
  moved: number;
  up: number;
  down: number;
  flagged: number;
}

export interface PriceChangesWindow {
  meta: PriceChangesMeta;
  summary: PriceChangesSummary;
  /** Every move, largest first, rises and falls together. */
  changes: PriceMove[];
}

export interface PriceHistoryChange {
  /** The day the quoted price changed; the price holds from that day on. */
  date: string;
  input: number;
  output: number;
  blendedPct: number | null;
  flags: string[];
}

export interface PriceHistory {
  meta: PriceChangesMeta;
  openRouterId: string;
  provider?: string;
  model?: string;
  /** True when the site's catalogue does not list the id. Not "does not
   *  exist": the catalogue is a daily snapshot. */
  notFound: boolean;
  /** The first day the model is in the archive. Absent when the archive does
   *  not hold the model yet: not known, which is not "never changed". */
  firstSeen?: string;
  first?: { date: string } & PricePair;
  /** Oldest first. Empty says the price did not change; absent says the
   *  archive does not hold the model. */
  changes?: PriceHistoryChange[];
}

// ── Reading the payloads ────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const day = (v: unknown): string | undefined => (typeof v === "string" && ISO_DATE.test(v) ? v : undefined);
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function coercePair(value: unknown): PricePair | undefined {
  const raw = record(value);
  if (!raw || !finite(raw.input) || !finite(raw.output) || raw.input < 0 || raw.output < 0) return undefined;
  return { input: raw.input, output: raw.output };
}

function coerceFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter((flag): flag is string => flag !== undefined))];
}

function coerceMeta(value: unknown): PriceChangesMeta {
  const raw = record(value) ?? {};
  return {
    schemaVersion: text(raw.schemaVersion),
    windowStart: day(raw.windowStart),
    windowEnd: day(raw.windowEnd),
    trackingStart: day(raw.trackingStart),
    asOf: day(raw.asOf),
  };
}

function coerceMove(value: unknown): PriceMove | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const provider = text(raw.provider);
  const model = text(raw.model);
  const before = coercePair(raw.before);
  const after = coercePair(raw.after);
  // A move with no name, no two prices or no size is not a move this server
  // can state. Dropped, never completed with a guess.
  if (!provider || !model || !before || !after || !finite(raw.blendedPct)) return undefined;
  return {
    provider,
    model,
    openRouterId: text(raw.openRouterId),
    before,
    after,
    blendedPct: raw.blendedPct,
    inputPct: finite(raw.inputPct) ? raw.inputPct : null,
    outputPct: finite(raw.outputPct) ? raw.outputPct : null,
    flags: coerceFlags(raw.flags),
  };
}

/** True when the site flags the move as a change of what it quotes. */
export function isFlagged(move: { flags: readonly string[] }): boolean {
  return move.flags.length > 0;
}

/**
 * Validate the window answer. Throws when it has no `changes` array: an answer
 * in another shape is a failed read, not a week in which nothing moved.
 * Exported for tests.
 */
export function coercePriceChanges(payload: unknown): PriceChangesWindow {
  const body = record(payload) ?? {};
  if (!Array.isArray(body.changes)) {
    throw new Error(`/api/price-changes payload had no "changes" array (saw ${typeof body.changes}).`);
  }
  const changes = body.changes.map(coerceMove).filter((move): move is PriceMove => move !== undefined);

  // The counts are restated from the moves this server kept, so the summary
  // can never disagree with the list printed under it. `tracked` cannot be
  // recounted: it is the site's, or unknown.
  const summary = record(body.summary) ?? {};
  return {
    meta: coerceMeta(body.meta),
    summary: {
      tracked: finite(summary.tracked) && summary.tracked >= changes.length ? summary.tracked : null,
      moved: changes.length,
      up: changes.filter((move) => move.blendedPct > 0).length,
      down: changes.filter((move) => move.blendedPct < 0).length,
      flagged: changes.filter(isFlagged).length,
    },
    changes,
  };
}

/**
 * Validate one model's history. Throws on an answer that is not an object.
 * Exported for tests.
 */
export function coercePriceHistory(payload: unknown, id: string): PriceHistory {
  const body = record(payload);
  if (!body) throw new Error(`/api/price-changes?id= payload was not an object (saw ${typeof payload}).`);

  const notFound = Array.isArray(body.notFound) && body.notFound.includes(id);
  const history: PriceHistory = {
    meta: coerceMeta(body.meta),
    openRouterId: text(body.openRouterId) ?? id,
    provider: text(body.provider),
    model: text(body.model),
    notFound,
  };
  if (notFound) return history;

  const firstSeen = day(body.firstSeen);
  if (firstSeen) history.firstSeen = firstSeen;

  const firstRaw = record(body.first);
  const firstPair = coercePair(firstRaw);
  const firstDate = day(firstRaw?.date);
  if (firstPair && firstDate) history.first = { date: firstDate, ...firstPair };

  // Absent stays absent: a model the archive does not hold has no `changes`
  // key at all, and an empty list here would read as "never changed".
  if (Array.isArray(body.changes)) {
    history.changes = body.changes
      .map((value): PriceHistoryChange | undefined => {
        const raw = record(value);
        const pair = coercePair(raw);
        const date = day(raw?.date);
        if (!raw || !pair || !date) return undefined;
        return { date, ...pair, blendedPct: finite(raw.blendedPct) ? raw.blendedPct : null, flags: coerceFlags(raw.flags) };
      })
      .filter((change): change is PriceHistoryChange => change !== undefined);
  }
  return history;
}

// ── Asking the site ─────────────────────────────────────────────────

let windowCache: { fetchedAt: number; result: PriceChangesWindow } | null = null;
const historyCache = new Map<string, { fetchedAt: number; result: PriceHistory }>();

/** Exported for tests. */
export function resetPriceChangesCache(): void {
  windowCache = null;
  historyCache.clear();
}

async function read<T>(params: Record<string, string> | undefined, coerce: (payload: unknown) => T): Promise<T> {
  const startedAt = Date.now();
  const payload = await fetchOptimtokenJson<unknown>("api/price-changes", {
    params,
    timeoutMs: PRICE_CHANGES_TIMEOUT_MS,
  });
  try {
    return coerce(payload);
  } catch (error) {
    throw new UpstreamFetchError("guard", error instanceof Error ? error.message : String(error), {
      url: optimtokenUrl("api/price-changes", params),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

/** The moves of the trend window. Throws an `UpstreamFetchError`; a failure
 *  is never remembered. */
export async function fetchPriceChanges(): Promise<PriceChangesWindow> {
  if (windowCache && Date.now() - windowCache.fetchedAt < CACHE_TTL_MS) return windowCache.result;
  const result = await read(undefined, coercePriceChanges);
  noteSiteSchema("/api/price-changes", result.meta.schemaVersion);
  windowCache = { fetchedAt: Date.now(), result };
  return result;
}

/** One model's quoted price since tracking began, by upstream id. Throws an
 *  `UpstreamFetchError`; a failure is never remembered. */
export async function fetchPriceHistory(id: string): Promise<PriceHistory> {
  const cached = historyCache.get(id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;
  const result = await read({ id }, (payload) => coercePriceHistory(payload, id));
  noteSiteSchema("/api/price-changes", result.meta.schemaVersion);
  if (historyCache.size >= HISTORY_CACHE_MAX_ENTRIES) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }
  historyCache.set(id, { fetchedAt: Date.now(), result });
  return result;
}

/** Why the archive could not be read, in words a reader of the answer can use. */
export function describePriceChangesFailure(error: unknown): string {
  if (error instanceof UpstreamFetchError) {
    switch (error.kind) {
      case "timeout":
        return `the site did not answer within ${Math.round(PRICE_CHANGES_TIMEOUT_MS / 1000)} seconds`;
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

// ── Saying it ───────────────────────────────────────────────────────

/** "+179.5%", "−20%", "0%". A real minus sign, as the other tools print. */
export function describePct(pct: number | null): string {
  if (pct === null) return "n/a";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

const FLAG_TAGS: Record<string, string> = {
  hostSwitch: "quoted host changed",
  outlierHost: "outlier listing",
};

/** Inline markers for a move's flags, e.g. ` [quoted host changed]`. A flag
 *  this server does not know is printed under its own name, never dropped. */
export function flagTags(flags: readonly string[]): string {
  return flags.map((flag) => ` [${FLAG_TAGS[flag] ?? flag}]`).join("");
}

/**
 * The lines printed once under an answer that shows moves: what each flag
 * shown means, and what the lack of one does not mean.
 */
export function flagLegend(moves: readonly { flags: readonly string[] }[]): string[] {
  const shown = new Set(moves.flatMap((move) => move.flags));
  const lines: string[] = [];
  if (shown.has("hostSwitch")) {
    lines.push(
      "[quoted host changed]: most models are sold by several hosts at different rates and the site quotes one " +
        "of them. This move is flagged as a change of the host quoted, so each host may have held its own rate: " +
        "it is not a repricing by the model maker. compare-model-hosts lists each host's rate.",
    );
  }
  if (shown.has("outlierHost")) {
    lines.push(
      "[outlier listing]: the move is flagged as an outlier listing, a quoted price with input almost free and " +
        "output at or above the usual rate. Not typical of what the model costs elsewhere.",
    );
  }
  if (moves.some((move) => move.flags.length === 0)) {
    lines.push(
      "A move with no flag is not established as either of those. That is not a statement that the model maker " +
        "repriced: check the maker's own pricing page before reporting it as one.",
    );
  }
  return lines;
}
