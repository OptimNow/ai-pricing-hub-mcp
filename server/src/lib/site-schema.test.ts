import test from "node:test";
import assert from "node:assert/strict";
import { SYNCED_SITE_SCHEMAS, noteSiteSchema, resetSiteSchemaNotes } from "./site-schema.js";
import { fetchLLMModels, resetLLMModelCache } from "./llm-models.js";
import { OPTIMTOKEN_BASE_URL } from "./optimtoken-api.js";

/**
 * The site bumps `meta.schemaVersion` with every field it adds or whose meaning
 * it changes. This server recorded the version and compared it with nothing,
 * so each bump was followed by hand on the day someone noticed. These tests
 * hold the one thing that makes a bump visible here: a line in the log.
 * (`npm run check-parity` is what fails on it, and the site runs that.)
 */

function captureWarnings(t: { after: (fn: () => void) => void }): string[] {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  t.after(() => {
    console.warn = original;
  });
  return lines;
}

test("every endpoint this server reads has a version it was read against", () => {
  assert.deepEqual(Object.keys(SYNCED_SITE_SCHEMAS).sort(), [
    "/api/llm-models",
    "/api/model-hosts",
    "/api/price-changes",
    "/api/pricing",
  ]);
  for (const version of Object.values(SYNCED_SITE_SCHEMAS)) assert.match(version, /^\d+\.\d+$/);
});

test("the version this server was read against is not reported, and no version is not a version", (t) => {
  const warnings = captureWarnings(t);
  resetSiteSchemaNotes();

  noteSiteSchema("/api/llm-models", SYNCED_SITE_SCHEMAS["/api/llm-models"]);
  noteSiteSchema("/api/pricing", undefined);
  noteSiteSchema("/api/pricing", "");
  noteSiteSchema("/api/pricing", 13);

  assert.deepEqual(warnings, []);
});

test("another version is reported once per endpoint and version, naming both", (t) => {
  const warnings = captureWarnings(t);
  resetSiteSchemaNotes();

  // The memo is refetched every 15 minutes: one line, not one per fetch.
  for (let i = 0; i < 3; i += 1) noteSiteSchema("/api/llm-models", "2.9");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\/api\/llm-models answers under schema 2\.9/);
  assert.match(warnings[0], new RegExp(`last read against ${SYNCED_SITE_SCHEMAS["/api/llm-models"].replace(".", "\\.")}`));

  // A further bump, and another endpoint, are each their own line.
  noteSiteSchema("/api/llm-models", "3.0");
  noteSiteSchema("/api/pricing", "2.9");
  assert.equal(warnings.length, 3);
});

test("a catalogue read from the site reports the version it came under, and is still served", async (t) => {
  const warnings = captureWarnings(t);
  resetSiteSchemaNotes();
  resetLLMModelCache();
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    resetLLMModelCache();
  });

  const models = Array.from({ length: 120 }, (_, i) => ({
    provider: "TestVendor",
    model: `Alpha ${i}`,
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: "128K",
    category: "Budget",
    capabilities: ["Text"],
  }));
  globalThis.fetch = (async (input: unknown) => {
    assert.ok(String(input).startsWith(OPTIMTOKEN_BASE_URL));
    const body = { models, meta: { schemaVersion: "9.9", source: "openrouter", timestamp: "2026-11-12T00:00:00.000Z" } };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;

  const result = await fetchLLMModels();

  // A version this server has not seen is not evidence that its prices are
  // wrong: the coercion refuses what it cannot read, row by row.
  assert.equal(result.provenance.tier, 1);
  assert.equal(result.provenance.upstreamSchemaVersion, "9.9");
  assert.equal(warnings.filter(line => line.includes("[site-schema]")).length, 1);
  assert.match(warnings.join("\n"), /\/api\/llm-models answers under schema 9\.9/);
});
