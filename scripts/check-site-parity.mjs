// Manual check: does this server still compute what the site computes?
//
// The LLM business logic here is a port of the site's (cloud-sparkle-compare),
// not a shared module, so it drifts unless someone looks. This script looks: it
// loads BOTH implementations, feeds them the same live catalogue, and counts
// where they disagree. On 2026-11-11, three months after the previous sync, it
// found 307 of 2,512 optimized costs apart, 37 efficiency scores, 3 FinOps
// badges and 17 openness buckets. After the resync: none.
//
//   npm run check-parity -- <path to the cloud-sparkle-compare checkout>
//
// The path defaults to a sibling folder of the repository root, or SITE_CHECKOUT.
// Exits 1 on any difference. Outside CI on purpose: the site's repository is
// private, and the check needs the live catalogue.
//
// How it loads the site's files: they import each other through the "@/" path
// alias, which tsx resolves from the tsconfig named in TSX_TSCONFIG_PATH. tsx
// reads that variable when it registers, before any script runs, so this file
// re-launches itself once with the variable set.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const sitePath = resolve(
  process.argv[2] || process.env.SITE_CHECKOUT || join(repoRoot, "..", "cloud-sparkle-compare"),
);
const siteTsconfig = join(sitePath, "tsconfig.app.json");

if (!existsSync(siteTsconfig)) {
  console.error(
    `No site checkout at ${sitePath} (looked for tsconfig.app.json).\n` +
      "Pass its path: npm run check-parity -- <path to cloud-sparkle-compare>",
  );
  process.exit(2);
}

if (process.env.TSX_TSCONFIG_PATH !== siteTsconfig) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(import.meta.url), sitePath],
    { stdio: "inherit", env: { ...process.env, TSX_TSCONFIG_PATH: siteTsconfig } },
  );
  process.exit(child.status ?? 1);
}

const API_URL = process.env.LLM_API_URL || "https://optimtoken.optimnow.io/api/llm-models";
const load = (path) => import(pathToFileURL(path).href);

const mcp = await load(join(repoRoot, "server/src/lib/llm-business-metrics.ts"));
const mcpModels = await load(join(repoRoot, "server/src/lib/llm-models.ts"));
const mcpOpenness = await load(join(repoRoot, "server/src/lib/openness.ts"));
const site = await load(join(sitePath, "src/lib/llm-business-metrics.ts"));
const siteOpenness = await load(join(sitePath, "src/lib/openness.ts"));
const siteHosts = await load(join(sitePath, "src/lib/host-prices.ts"));

const response = await fetch(API_URL, { headers: { Accept: "application/json" } });
if (!response.ok) {
  console.error(`${API_URL} returned HTTP ${response.status}. Nothing was compared.`);
  process.exit(2);
}
const { models: rows, meta } = await response.json();
if (!Array.isArray(rows) || meta?.source !== "openrouter") {
  console.error(`The site is not serving live data (meta.source: ${meta?.source}). Nothing was compared.`);
  process.exit(2);
}

// This server's side sees each row the way its own pipeline would: through
// coerceSiteModel. A field that function drops is a difference this must find.
const pairs = rows.map((row) => [row, mcpModels.coerceSiteModel(row)]).filter(([, m]) => m !== null);
console.log(
  `Catalogue: ${rows.length} rows, ${pairs.length} accepted here. Site schema ${meta.schemaVersion}, ` +
    `as of ${meta.timestamp}.`,
);

const failures = [];
const report = (label, count, total, detail = []) => {
  console.log(`${count === 0 ? "PASS" : "FAIL"}  ${label}: ${count} of ${total} differ`);
  for (const line of detail.slice(0, 8)) console.log(`        ${line}`);
  if (detail.length > 8) console.log(`        ... and ${detail.length - 8} more`);
  if (count > 0) failures.push(label);
};

if (pairs.length !== rows.length) {
  report("rows accepted by coerceSiteModel", rows.length - pairs.length, rows.length);
}

// 1. Use-case profiles: the same workloads, or nothing below means anything.
const profilesDiffer = JSON.stringify(site.USE_CASE_PROFILES) !== JSON.stringify(mcp.USE_CASE_PROFILES);
report("use-case profiles", profilesDiffer ? 1 : 0, 1);
const profiles = Object.entries(site.USE_CASE_PROFILES);

// 2. Costs. A relative tolerance of 1e-9 forgives the last float digit, which
//    the two formulas reach by different routes, and nothing a reader could see.
const differs = (a, b) => Math.abs(a - b) > 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const listDiff = [];
const optimizedDiff = [];
for (const [row, model] of pairs) {
  for (const [key, profile] of profiles) {
    const name = `${row.provider} ${row.model} / ${key}`;
    const listHere = mcp.useCaseCost(model.inputPricePer1M, model.outputPricePer1M, profile);
    const listThere = site.useCaseCost(row.inputPricePer1M, row.outputPricePer1M, profile);
    if (differs(listHere, listThere)) listDiff.push(`${name}: ${listHere} here, ${listThere} on the site`);
    const here_ = mcp.optimizedUseCaseCost(model, profile);
    const there = site.optimizedUseCaseCost(row, profile);
    if (differs(here_, there)) optimizedDiff.push(`${name}: ${here_} here, ${there} on the site`);
  }
}
const pairCount = pairs.length * profiles.length;
report("list cost per request", listDiff.length, pairCount, listDiff);
report("optimized cost per request", optimizedDiff.length, pairCount, optimizedDiff);

// 3. Scores, badge, openness. The site's enrichModels takes the host summary as
//    a fourth argument, because its outlier verdict is computed, not read.
const here_ = mcp.enrichModels(pairs.map(([, m]) => m), "100k", "supportTicket");
const there = site.enrichModels(pairs.map(([row]) => row), "100k", "supportTicket", (m) => m.hostPricing);
const scoreDiff = [];
const badgeDiff = [];
const opennessDiff = [];
const outlierDiff = [];
here_.forEach((a, i) => {
  const b = there[i];
  const name = `${a.provider} ${a.model}`;
  if (a.efficiencyScore !== b.costEfficiency) scoreDiff.push(`${name}: ${a.efficiencyScore} here, ${b.costEfficiency} on the site`);
  if (a.isFinOpsFriendly !== b.isFinOpsFriendly) badgeDiff.push(`${name}: ${a.isFinOpsFriendly} here, ${b.isFinOpsFriendly} on the site`);
  const opennessThere = siteOpenness.opennessOf(b.license);
  if (a.openness !== opennessThere) opennessDiff.push(`${name} [${b.license}]: ${a.openness} here, ${opennessThere} on the site`);
  // The badge here reads the API's outlierListing flag; the site's pages test
  // the price they display. The two have to be the same verdict.
  const outlierThere = siteHosts.isOutlierQuote({ input: b.inputPricePer1M, output: b.outputPricePer1M }, b.hostPricing);
  if ((a.outlierListing === true) !== outlierThere) outlierDiff.push(`${name}: flag ${a.outlierListing === true}, isOutlierQuote ${outlierThere}`);
});
report("efficiency score", scoreDiff.length, here_.length, scoreDiff);
report("FinOps Friendly badge", badgeDiff.length, here_.length, badgeDiff);
report("openness bucket", opennessDiff.length, here_.length, opennessDiff);
report("outlierListing flag against the site's own rule", outlierDiff.length, here_.length, outlierDiff);

const unknownLicences = [...new Set(rows.map((r) => r.license).filter((l) => l && !mcpOpenness.isRecognisedLicence(l)))];
report("licence strings openness.ts cannot bucket", unknownLicences.length, unknownLicences.length || 1, unknownLicences);

// 4. Formatters, swept across every unit boundary.
const formatDiff = [];
const samples = [0, 0.009999, 999.4, 999.5, 999.9999, 999_949, 999_950, 999_999];
for (let v = 1e-7; v < 5e6; v *= 1.0137) samples.push(v);
for (const v of samples) {
  if (mcp.formatMonthlyBudget(v) !== site.formatMonthlyBudget(v)) formatDiff.push(`formatMonthlyBudget(${v})`);
  if (mcp.formatMicroCost(v) !== site.formatMicroCost(v)) formatDiff.push(`formatMicroCost(${v})`);
}
report("cost formatters", formatDiff.length, samples.length * 2, formatDiff);

// Not a pass or fail: fields on the site's rows that this server does not carry.
// New ones show up here before anyone has decided whether they matter.
const siteFields = new Set(rows.flatMap((r) => Object.keys(r)));
const carried = new Set(pairs.flatMap(([, m]) => Object.keys(m).filter((k) => m[k] !== undefined)));
const notCarried = [...siteFields].filter((f) => !carried.has(f));
console.log(`\nSite row fields not carried here: ${notCarried.join(", ") || "none"}.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join("; ")}.`);
  process.exit(1);
}
console.log("\nThis server and the site agree on every check.");
