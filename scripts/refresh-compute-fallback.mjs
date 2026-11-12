// Refreshes the static compute rows in server/src/data/pricing-data.ts, the
// rows this server serves when it cannot reach the site at all.
//
//   npm run refresh-compute-fallback [-- <path to the site's checkout>]
//
// The rows are a fixed sample of the catalogue (137 on 2026-11-12). The script
// keeps the sample and its layout as they are, and rewrites each row's figures:
//
//   1. from the live catalogue, GET /api/pricing?region=us-east&os=Linux, for
//      every row it lists (118 of 137 that day);
//   2. from the site's own static catalogue (src/data/compute-instances.ts in
//      its checkout), for the rows the live catalogue does not list, when a
//      checkout is given or found beside this repository. Those are instance
//      types the site only serves while it cannot read the provider live (16
//      GCP shared-core and older types, 3 DigitalOcean sizes);
//   3. a row found in neither is left as it was, and named.
//
// Until this script existed nobody re-snapshotted these rows: they were dated
// 2026-03-06, and on 2026-11-12 96 of the 137 differed from what the site
// itself serves when a provider fails (on-demand rates by up to 69%).
//
// Safety: nothing is written when the site does not answer, answers for
// another region, or answers with a provider it could not read live. That last
// one matters most: such an answer holds the site's own static rows in place
// of the provider's catalogue, and a snapshot of it would date old figures as
// today's.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The URL the site's compute page and this server both ask for: a URL of this
// script's own would be one more cold fan-out to six provider APIs.
const API_URL = process.env.PRICING_API_URL || "https://optimtoken.optimnow.io/api/pricing?region=us-east&os=Linux";
const FETCH_TIMEOUT_MS = Number(process.env.PRICING_API_TIMEOUT_MS || 60_000);

const START = "// COMPUTE-FALLBACK-START";
const END = "// COMPUTE-FALLBACK-END";

/** Fewer live matches than this and the catalogue has changed shape (a rename
 *  of instance types, a provider gone): look before overwriting anything. */
const MIN_LIVE_MATCH_SHARE = 0.7;

const PRICE_KEYS = ["onDemandHourly", "onDemandMonthly", "spot", "savingsPlan1yr", "savingsPlan3yr", "reserved1yr", "reserved3yr"];
const FIELD_ORDER = ["provider", "instanceType", "os", "vCPUs", "memory", ...PRICE_KEYS];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const DATA_FILE = join(repoRoot, "server", "src", "data", "pricing-data.ts");
const ROW = /^(\s*)\{ provider: "([^"]+)", instanceType: "([^"]+)", os: "Linux", .*\},\s*$/;

const key = (row) => `${row.provider}|${row.instanceType}`;
const fail = (message) => {
  console.error(`${message} Nothing was written.`);
  process.exit(1);
};

// ── The live catalogue ──────────────────────────────────────────────

let payload;
try {
  const response = await fetch(API_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) fail(`${API_URL} returned HTTP ${response.status}.`);
  payload = await response.json();
} catch (error) {
  fail(`${API_URL} could not be read: ${error instanceof Error ? error.message : String(error)}.`);
}

const { instances, meta } = payload ?? {};
if (!Array.isArray(instances) || !meta) fail(`${API_URL} did not answer { instances, meta }.`);
if (meta.region !== "us-east") {
  fail(`The answer is for region "${meta.region}". These rows are US East list prices: the snapshot has no region dimension.`);
}
const counts = meta.liveProviders;
if (!counts || typeof counts.live !== "number" || counts.live < counts.expected) {
  fail(
    `The site could not read every provider live on this answer (${counts?.live ?? "?"} of ${counts?.expected ?? "?"}` +
      `${Array.isArray(meta.errors) ? `: ${meta.errors.join("; ")}` : ""}). Its rows for that provider are its own static ` +
      `sample, not today's prices. Run again in half an hour.`,
  );
}
const live = new Map(instances.filter((row) => row.os === "Linux").map((row) => [key(row), row]));

// ── The site's static catalogue, for the rows the live one does not list ──

const siteCandidates = [process.argv[2], process.env.SITE_CHECKOUT, join(repoRoot, "..", "cloud-sparkle-compare"), join(repoRoot, "..", "ai-pricing-hub")];
const sitePath = siteCandidates.filter(Boolean).map((path) => resolve(path)).find((path) => existsSync(join(path, "src", "data", "compute-instances.ts")));
/**
 * One row of the site's file, read as text: the file is one object literal per
 * line, like the block rewritten below. Field by field, so the script needs
 * neither tsx nor the site's path alias, and runs nothing it reads. A row
 * missing a field is not a row.
 */
function parseRow(line) {
  const match = ROW.exec(line);
  if (!match) return null;
  const row = { provider: match[2], instanceType: match[3], os: "Linux" };
  for (const field of ["vCPUs", "memory", ...PRICE_KEYS]) {
    const value = new RegExp(`[{,] ${field}: (null|-?\\d+(?:\\.\\d+)?)[, ]`).exec(line)?.[1];
    if (value === undefined) return null;
    row[field] = value === "null" ? null : Number(value);
  }
  return row;
}

const siteStatic = new Map();
if (sitePath) {
  const text = readFileSync(join(sitePath, "src", "data", "compute-instances.ts"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const row = parseRow(line);
    if (row) siteStatic.set(key(row), row);
  }
}

// ── Rewrite the block, row by row ───────────────────────────────────

const source = readFileSync(DATA_FILE, "utf8");
const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx < 0 || endIdx < startIdx) fail(`${DATA_FILE} has lost its ${START} / ${END} markers.`);

const eol = source.includes("\r\n") ? "\r\n" : "\n";
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null);
const literal = (row) =>
  "{ " +
  FIELD_ORDER.map((field) => {
    const value = PRICE_KEYS.includes(field) ? number(row[field]) : row[field];
    return `${field}: ${typeof value === "string" ? JSON.stringify(value) : value}`;
  }).join(", ") +
  " },";

const from = { live: [], site: [], kept: [] };
let changedRows = 0;
const lines = source.slice(startIdx, endIdx).split(/\r?\n/);
const rewritten = lines.map((line) => {
  const match = ROW.exec(line);
  if (!match) return line;
  const [, indent, provider, instanceType] = match;
  const id = `${provider}|${instanceType}`;
  const fresh = live.get(id) ?? siteStatic.get(id);
  if (!fresh) {
    from.kept.push(id);
    return line;
  }
  (live.has(id) ? from.live : from.site).push(id);
  if (typeof fresh.onDemandHourly !== "number") fail(`${id} has no on-demand rate in the source it was read from.`);
  const next = indent + literal({ ...fresh, provider, instanceType, os: "Linux" });
  if (next !== line.replace(/\s+$/, "")) changedRows += 1;
  return next;
});

const total = from.live.length + from.site.length + from.kept.length;
if (total === 0) fail(`No row was recognised between the markers of ${DATA_FILE}.`);
if (from.live.length < total * MIN_LIVE_MATCH_SHARE && process.env.ALLOW_FEW_LIVE_MATCHES !== "1") {
  fail(
    `Only ${from.live.length} of the ${total} rows are in the live catalogue (the guard asks for ` +
      `${Math.round(MIN_LIVE_MATCH_SHARE * 100)}%): instance names may have changed upstream. ` +
      `If that is real, re-run with ALLOW_FEW_LIVE_MATCHES=1.`,
  );
}

const day = String(meta.timestamp).slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(`The answer carries no usable timestamp ("${meta.timestamp}").`);

let updated = source.slice(0, startIdx) + rewritten.join(eol) + source.slice(endIdx);
if (changedRows > 0) {
  updated = updated.replace(
    /export const computeDataLastUpdated = "[^"]*";/,
    `export const computeDataLastUpdated = "${day}";`,
  );
}

console.log(
  `${total} rows: ${from.live.length} from the live catalogue (built ${meta.timestamp}), ` +
    `${from.site.length} from the site's static catalogue${sitePath ? ` (${sitePath})` : " (no checkout found)"}, ` +
    `${from.kept.length} left as they were.`,
);
if (from.site.length > 0) console.log(`  From the site's static catalogue: ${from.site.join(", ")}.`);
if (from.kept.length > 0) {
  console.log(
    `  LEFT AS THEY WERE, found in neither source: ${from.kept.join(", ")}.` +
      (sitePath ? "" : " Pass the site's checkout to read them from its static catalogue."),
  );
}

if (updated === source) {
  console.log("No changes.");
  process.exit(0);
}
writeFileSync(DATA_FILE, updated, "utf8");
console.log(`${changedRows} row(s) changed; computeDataLastUpdated is ${day}. Wrote ${DATA_FILE}.`);
