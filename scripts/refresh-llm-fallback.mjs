// Refreshes the static LLM fallback in server/src/data/pricing-data.ts from the
// deployed API (which already applies filtering, enrichment, ELO scores, and
// batch/cache merging). Adapted from cloud-sparkle-compare/scripts/refresh-llm-fallback.mjs.
//
//   npm run refresh-fallback
//
// Safety: aborts without touching the file if the API is down, times out, returns
// non-live data, or returns a catalogue that has collapsed relative to what is
// already committed.
//
// Escape hatch: ALLOW_CATALOGUE_SHRINK=1 skips the relative guard when a large
// drop is genuine. The absolute floor still applies.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_URL = process.env.LLM_API_URL || "https://optimtoken.optimnow.io/api/llm-models";
const FETCH_TIMEOUT_MS = Number(process.env.LLM_API_TIMEOUT_MS || 30_000);

const START = "// LLM-FALLBACK-START";
const END = "// LLM-FALLBACK-END";

/** Absolute floor: a catalogue smaller than this is broken regardless of history. */
const ABSOLUTE_MODEL_FLOOR = 80;
/** The new catalogue must retain at least this share of what is committed. */
const RELATIVE_MODEL_FLOOR = 0.85;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "server", "src", "data", "pricing-data.ts");

// Keys in output order; undefined values are omitted from the generated literal
const FIELD_ORDER = [
  "provider",
  "model",
  "parameters",
  "inputPricePer1M",
  "outputPricePer1M",
  "batchInputPricePer1M",
  "batchOutputPricePer1M",
  "cachedInputPricePer1M",
  "contextWindow",
  "category",
  "capabilities",
  "releaseDate",
  "eloScore",
  "license",
];

function toTsLiteral(model) {
  const parts = [];
  for (const key of FIELD_ORDER) {
    const value = model[key];
    if (value === undefined || value === null) continue;
    parts.push(`${key}: ${JSON.stringify(value)}`);
  }
  return `  { ${parts.join(", ")} },`;
}

/** Same guard as server/src/lib/pricing-normalize.ts: the router rows the API
 *  publishes with -1 pricing must never reach the fallback snapshot. */
function hasPublishableTokenPricing(input, output) {
  if (!Number.isFinite(input) || !Number.isFinite(output)) return false;
  if (input < 0 || output < 0) return false;
  if (input === 0 && output === 0) return false;
  return true;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request to ${url} returned HTTP ${response.status}.`);
    return await response.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function countCommittedFallbackModels(source) {
  const startIdx = source.indexOf(START);
  const endIdx = source.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  const matches = source.slice(startIdx, endIdx).match(/^\s*\{\s*provider:/gm);
  return matches ? matches.length : 0;
}

let payload;
try {
  payload = await fetchJsonWithTimeout(API_URL, FETCH_TIMEOUT_MS);
} catch (err) {
  console.error(`${err.message} Fallback left untouched.`);
  process.exit(1);
}
const { models: rawModels, meta } = payload;

if (meta?.source !== "openrouter") {
  console.error(`API source is "${meta?.source}" (not live). Fallback left untouched.`);
  process.exit(1);
}
if (!Array.isArray(rawModels)) {
  console.error("API response had no models array. Fallback left untouched.");
  process.exit(1);
}

const models = rawModels.filter((m) =>
  hasPublishableTokenPricing(m.inputPricePer1M, m.outputPricePer1M),
);
const skipped = rawModels.length - models.length;

const source = readFileSync(DATA_FILE, "utf8");
const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error("Markers LLM-FALLBACK-START/END not found. Fallback left untouched.");
  process.exit(1);
}

// Relative-change guard: the absolute floor alone would wave through a drop from
// 255 models to 85, quietly gutting the offline catalogue.
const committedCount = countCommittedFallbackModels(source);
if (models.length < ABSOLUTE_MODEL_FLOOR) {
  console.error(
    `Catalogue collapse: the API returned ${models.length} usable models, below the absolute floor ` +
      `of ${ABSOLUTE_MODEL_FLOOR}. Nothing was written.`,
  );
  process.exit(1);
}
if (committedCount > 0 && process.env.ALLOW_CATALOGUE_SHRINK !== "1") {
  const threshold = Math.floor(committedCount * RELATIVE_MODEL_FLOOR);
  if (models.length < threshold) {
    console.error(
      `Catalogue collapse: the API returned ${models.length} models but the committed fallback holds ` +
        `${committedCount}. The guard requires at least ${threshold}. Nothing was written. ` +
        `If this drop is real, re-run with ALLOW_CATALOGUE_SHRINK=1.`,
    );
    process.exit(1);
  }
}
console.log(
  `Guard passed: ${models.length} models fetched, ${committedCount ?? "unknown"} committed` +
    (skipped > 0 ? `, ${skipped} skipped for unpublishable pricing.` : "."),
);

const today = new Date().toISOString().slice(0, 10);
const block = [
  START + " — this array is regenerated by scripts/refresh-llm-fallback.mjs",
  "// (npm run refresh-fallback). Manual edits between the markers survive only until",
  "// the next successful refresh.",
  `// Snapshot of ${API_URL} taken ${today}.`,
  "export const llmModels: LLMModel[] = [",
  ...models.map(toTsLiteral),
  "];",
  "",
].join("\n");

let updated = source.slice(0, startIdx) + block + source.slice(endIdx);
updated = updated.replace(
  /export const dataLastUpdated = "[^"]*";/,
  `export const dataLastUpdated = "${today}";`,
);

if (updated === source) {
  console.log("No changes.");
  process.exit(0);
}

writeFileSync(DATA_FILE, updated, "utf8");
console.log(`Refreshed ${models.length} models into ${DATA_FILE}.`);
