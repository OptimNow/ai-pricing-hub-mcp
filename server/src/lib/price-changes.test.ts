import test from "node:test";
import assert from "node:assert/strict";
import {
  coercePriceChanges,
  coercePriceHistory,
  describePct,
  describePriceChangesFailure,
  fetchPriceChanges,
  fetchPriceHistory,
  flagLegend,
  flagTags,
  isFlagged,
  resetPriceChangesCache,
} from "./price-changes.js";
import { OPTIMTOKEN_BASE_URL, UpstreamFetchError } from "./optimtoken-api.js";

/**
 * "The price of X went up 180% this week" is the kind of sentence a reader
 * repeats to a budget owner. Two ways it goes wrong without anything crashing:
 * a change of the host the site quotes is reported as a repricing, and a
 * failed read is reported as a quiet week. These tests hold both.
 */

const META = {
  schemaVersion: "1.0",
  windowStart: "2026-11-04",
  windowEnd: "2026-11-11",
  trackingStart: "2026-08-15",
  asOf: "2026-11-11",
};

const HOST_SWITCH = {
  provider: "Meta",
  model: "Llama 3.3 70B Instruct",
  openRouterId: "meta-llama/llama-3.3-70b-instruct",
  before: { input: 0.1, output: 0.32 },
  after: { input: 0.71, output: 0.71 },
  blendedPct: 179.5,
  inputPct: 610,
  outputPct: 121.9,
  flags: ["hostSwitch"],
};

const REPRICED = {
  provider: "DeepSeek",
  model: "DeepSeek V4 Flash 0423",
  openRouterId: "deepseek/deepseek-v4-flash",
  before: { input: 0.091, output: 0.182 },
  after: { input: 0.09, output: 0.18 },
  blendedPct: -1.1,
  inputPct: -1.1,
  outputPct: -1.1,
};

// ── The week's moves ────────────────────────────────────────────────

test("a move is read as sent, and a flag is carried only when the site set one", () => {
  const result = coercePriceChanges({
    meta: META,
    summary: { tracked: 302, moved: 2, up: 1, down: 1, flagged: 1 },
    changes: [HOST_SWITCH, REPRICED],
  });

  assert.deepEqual(result.meta, META);
  assert.deepEqual(result.changes[0], HOST_SWITCH);
  // The site writes no `flags` key when none is established. Here that is an
  // empty list, and it must stay empty: a flag invented on the way in would
  // move a repricing into the "not a repricing" group.
  assert.deepEqual(result.changes[1].flags, []);
  assert.equal(isFlagged(result.changes[0]), true);
  assert.equal(isFlagged(result.changes[1]), false);
  assert.deepEqual(result.summary, { tracked: 302, moved: 2, up: 1, down: 1, flagged: 1 });
});

test("the counts are the moves this server kept, so the summary cannot contradict the list", () => {
  const result = coercePriceChanges({
    meta: META,
    // The site's counts describe four moves; two of the rows below are unusable.
    summary: { tracked: 302, moved: 4, up: 3, down: 1, flagged: 3 },
    changes: [
      HOST_SWITCH,
      REPRICED,
      { ...REPRICED, model: "No size", blendedPct: "big" },
      { provider: "Nameless", before: REPRICED.before, after: REPRICED.after, blendedPct: 5 },
      { ...REPRICED, model: "Half a price", after: { input: 1 } },
      "not a move",
    ],
  });
  assert.equal(result.changes.length, 2, "a move with no name, no size or half a price is dropped, not guessed");
  assert.deepEqual(result.summary, { tracked: 302, moved: 2, up: 1, down: 1, flagged: 1 });
});

test("how many models were compared is the site's figure, or unknown", () => {
  const withSummary = (summary: unknown) => coercePriceChanges({ changes: [HOST_SWITCH, REPRICED], summary }).summary;
  assert.equal(withSummary({ tracked: 302 }).tracked, 302);
  // It cannot be recounted from the moves, and a figure smaller than the number
  // of moves is not one to print.
  assert.equal(withSummary(undefined).tracked, null);
  assert.equal(withSummary({ tracked: "302" }).tracked, null);
  assert.equal(withSummary({ tracked: 1 }).tracked, null);
});

test("a percentage from a zero price is unknown, not zero", () => {
  const [move] = coercePriceChanges({
    changes: [{ ...REPRICED, before: { input: 0, output: 0.2 }, inputPct: null, outputPct: -10 }],
  }).changes;
  assert.equal(move.inputPct, null);
  assert.equal(move.outputPct, -10);
});

test("an answer with no changes array is a failed read, not a quiet week", () => {
  for (const bad of [{}, { changes: null }, { changes: "none" }, { meta: META }, null, undefined, []]) {
    assert.throws(() => coercePriceChanges(bad), /no "changes" array/, JSON.stringify(bad));
  }
  // A quiet week is said with an empty list, and only with one.
  assert.deepEqual(coercePriceChanges({ meta: META, changes: [] }).summary, {
    tracked: null,
    moved: 0,
    up: 0,
    down: 0,
    flagged: 0,
  });
});

// ── One model's history ─────────────────────────────────────────────

const HISTORY = {
  meta: { schemaVersion: "1.0", trackingStart: "2026-08-15", asOf: "2026-11-11" },
  openRouterId: "meta-llama/llama-3.3-70b-instruct",
  provider: "Meta",
  model: "Llama 3.3 70B Instruct",
  firstSeen: "2026-08-19",
  first: { date: "2026-08-19", input: 0.1, output: 0.32 },
  changes: [
    { date: "2026-08-26", input: 0.71, output: 0.71, blendedPct: 179.5 },
    { date: "2026-09-03", input: 0.1, output: 0.32, blendedPct: -64.2, flags: ["hostSwitch"] },
  ],
};

test("a history is read as sent, oldest change first", () => {
  const history = coercePriceHistory(HISTORY, HISTORY.openRouterId);
  assert.equal(history.notFound, false);
  assert.equal(history.firstSeen, "2026-08-19");
  assert.deepEqual(history.first, HISTORY.first);
  assert.deepEqual(history.changes, [
    { date: "2026-08-26", input: 0.71, output: 0.71, blendedPct: 179.5, flags: [] },
    { date: "2026-09-03", input: 0.1, output: 0.32, blendedPct: -64.2, flags: ["hostSwitch"] },
  ]);
  assert.equal(history.meta.trackingStart, "2026-08-15");
});

test("no change, no record and no such model are three different answers", () => {
  // In the archive, and the price never moved: an empty list, kept.
  const stable = coercePriceHistory({ ...HISTORY, changes: [] }, HISTORY.openRouterId);
  assert.deepEqual(stable.changes, []);
  assert.ok(stable.first);

  // Listed by the site, not yet in the archive: no first price, no changes
  // key. An empty list here would read as "never changed".
  const unheld = coercePriceHistory(
    { meta: HISTORY.meta, openRouterId: "vendor/new", provider: "Vendor", model: "New" },
    "vendor/new",
  );
  assert.equal(unheld.notFound, false);
  assert.equal(unheld.first, undefined);
  assert.equal(unheld.changes, undefined);
  assert.equal(unheld.firstSeen, undefined);

  // Not in the site's catalogue at all.
  const unknown = coercePriceHistory({ meta: HISTORY.meta, notFound: ["nobody/nothing"] }, "nobody/nothing");
  assert.equal(unknown.notFound, true);
  assert.equal(unknown.changes, undefined);
  assert.equal(unknown.openRouterId, "nobody/nothing");

  assert.throws(() => coercePriceHistory(null, "x"), /not an object/);
});

test("a change with no date or half a price is dropped from a history", () => {
  const history = coercePriceHistory(
    {
      ...HISTORY,
      changes: [
        HISTORY.changes[0],
        { date: "26/08/2026", input: 1, output: 2 },
        { date: "2026-09-10", input: 1 },
        { input: 1, output: 2 },
      ],
      first: { date: "soon", input: 0.1, output: 0.32 },
    },
    HISTORY.openRouterId,
  );
  assert.equal(history.changes?.length, 1);
  assert.equal(history.first, undefined, "a first price with no usable date is not a first price");
});

// ── Asking the site ─────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const requested: string[] = [];

function stubFetch(responder: (url: string) => { status?: number; body?: unknown; throws?: boolean }) {
  requested.length = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    const r = responder(url);
    if (r.throws) throw new Error("network down");
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

function restore() {
  globalThis.fetch = realFetch;
  resetPriceChangesCache();
}

test("the week is asked with no id, a history with one, and each is remembered", async (t) => {
  t.after(restore);
  resetPriceChangesCache();
  stubFetch(url => (url.includes("?id=") ? { body: HISTORY } : { body: { meta: META, changes: [HOST_SWITCH] } }));

  const week = await fetchPriceChanges();
  assert.equal(requested[0], `${OPTIMTOKEN_BASE_URL}/api/price-changes`);
  assert.equal(await fetchPriceChanges(), week, "the second call is answered from memory");
  assert.equal(requested.length, 1);

  const history = await fetchPriceHistory(HISTORY.openRouterId);
  assert.equal(new URL(requested[1]).searchParams.get("id"), HISTORY.openRouterId);
  assert.equal(await fetchPriceHistory(HISTORY.openRouterId), history);
  assert.equal(requested.length, 2);
});

test("a failed read throws, classified, and is not remembered", async (t) => {
  t.after(restore);
  resetPriceChangesCache();

  stubFetch(() => ({ status: 404 }));
  await assert.rejects(
    () => fetchPriceChanges(),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "http-status" && error.status === 404,
  );

  // 200 with a body in another shape: a guard failure. Returning an empty
  // list here is the bug this module exists to prevent.
  stubFetch(() => ({ body: { error: "nope" } }));
  await assert.rejects(
    () => fetchPriceChanges(),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "guard",
  );

  stubFetch(() => ({ throws: true }));
  await assert.rejects(
    () => fetchPriceHistory("vendor/model"),
    (error: unknown) => error instanceof UpstreamFetchError && error.kind === "transport",
  );

  stubFetch(() => ({ body: { meta: META, changes: [REPRICED] } }));
  assert.equal((await fetchPriceChanges()).changes.length, 1, "the next call asks again and succeeds");
});

test("what the answer says about a failed read is short, and carries no URL", () => {
  const context = { url: "https://example.test/secret?id=a", elapsedMs: 3 };
  assert.deepEqual(
    [
      new UpstreamFetchError("timeout", "x", { ...context, timeoutMs: 10000 }),
      new UpstreamFetchError("http-status", "x", { ...context, status: 503 }),
      new UpstreamFetchError("transport", "x", context),
      new UpstreamFetchError("guard", "x", context),
      new Error("anything else"),
    ].map(describePriceChangesFailure),
    [
      "the site did not answer within 10 seconds",
      "the site answered HTTP 503",
      "the site could not be reached",
      "the site's answer could not be read",
      "the site's answer could not be read",
    ],
  );
});

// ── Saying it ───────────────────────────────────────────────────────

test("a percentage is printed with its sign, to one decimal", () => {
  assert.equal(describePct(179.5), "+179.5%");
  assert.equal(describePct(-64.24), "−64.2%");
  assert.equal(describePct(20), "+20%");
  assert.equal(describePct(0), "0%");
  assert.equal(describePct(-0.04), "0%", "a rounding residue is not a fall");
  assert.equal(describePct(null), "n/a");
});

test("each flag has a tag, and a flag this server does not know is printed, not dropped", () => {
  assert.equal(flagTags([]), "");
  assert.equal(flagTags(["hostSwitch"]), " [quoted host changed]");
  assert.equal(flagTags(["hostSwitch", "outlierHost"]), " [quoted host changed] [outlier listing]");
  assert.equal(flagTags(["somethingNew"]), " [somethingNew]");
});

test("the legend explains the flags shown, and what no flag does not mean", () => {
  assert.deepEqual(flagLegend([]), [], "no boilerplate under an empty answer");

  const flaggedOnly = flagLegend([{ flags: ["hostSwitch"] }]).join("\n");
  assert.match(flaggedOnly, /a change of the host quoted/);
  assert.match(flaggedOnly, /not a repricing by the model maker/);
  assert.doesNotMatch(flaggedOnly, /outlier listing/);
  assert.doesNotMatch(flaggedOnly, /A move with no flag/);

  const mixed = flagLegend([{ flags: ["outlierHost"] }, { flags: [] }]).join("\n");
  assert.match(mixed, /\[outlier listing\]/);
  // The sentence that keeps an unflagged move from being reported as a
  // repricing: no flag is "none established", nothing more.
  assert.match(mixed, /A move with no flag is not established as either/);
  assert.match(mixed, /not a statement that the model maker\s+repriced/);
});
