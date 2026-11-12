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
// The path defaults to SITE_CHECKOUT, then to a sibling folder of the repository
// root under either of the site's names: cloud-sparkle-compare, as the owner's
// checkout is still called, or ai-pricing-hub, as the repository is now.
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
const SIBLING_NAMES = ["cloud-sparkle-compare", "ai-pricing-hub"];
const siblings = SIBLING_NAMES.map((name) => join(repoRoot, "..", name));
const sitePath = resolve(
  process.argv[2] ||
    process.env.SITE_CHECKOUT ||
    siblings.find((path) => existsSync(join(path, "tsconfig.app.json"))) ||
    siblings[0],
);
const siteTsconfig = join(sitePath, "tsconfig.app.json");

if (!existsSync(siteTsconfig)) {
  console.error(
    `No site checkout at ${sitePath} (looked for tsconfig.app.json, and for a sibling folder named ` +
      `${SIBLING_NAMES.join(" or ")}).\n` +
      "Pass its path: npm run check-parity -- <path to the site's checkout>",
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
const siteHostView = await load(join(sitePath, "src/lib/host-pricing-view.ts"));
const siteLifecycle = await load(join(sitePath, "src/lib/model-lifecycle.ts"));
const mcpHosts = await load(join(repoRoot, "server/src/lib/host-prices.ts"));

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
const retirementDiff = [];
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
  // Same for retirement: the badge here reads the API's `deprecation`, the
  // site's reads its own table. A difference means the checkout and the
  // deployed site hold two tables, or this server dropped part of a notice.
  const noticeHere = JSON.stringify(a.deprecation ?? null);
  const noticeThere = JSON.stringify(siteLifecycle.deprecationOf(b.provider, b.model) ?? null);
  if (noticeHere !== noticeThere) retirementDiff.push(`${name}: ${noticeHere} here, ${noticeThere} in the site's table`);
});
report("efficiency score", scoreDiff.length, here_.length, scoreDiff);
report("FinOps Friendly badge", badgeDiff.length, here_.length, badgeDiff);
report("openness bucket", opennessDiff.length, here_.length, opennessDiff);
report("outlierListing flag against the site's own rule", outlierDiff.length, here_.length, outlierDiff);
report("retirement notice against the site's own table", retirementDiff.length, here_.length, retirementDiff);
const retiredWithBadge = here_.filter((m) => m.deprecation && m.isFinOpsFriendly).map((m) => `${m.provider} ${m.model}`);
report("retired models holding the badge", retiredWithBadge.length, here_.filter((m) => m.deprecation).length || 1, retiredWithBadge);

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

// 5. Per-host prices: lib/host-prices.ts is a port of the site's reader.
const constantDiff = [];
for (const name of ["SAME_RATE_TOLERANCE", "NOTEWORTHY_SPREAD", "HOST_DEFINITION"]) {
  if (mcpHosts[name] !== siteHosts[name]) constantDiff.push(`${name}: ${mcpHosts[name]} here, ${siteHosts[name]} on the site`);
}
const makerHere = [...mcpHosts.MAKER_ROW_NOT_STANDARD_RATE].sort().join(", ");
const makerThere = [...siteHostView.MAKER_ROW_NOT_STANDARD_RATE].sort().join(", ");
if (makerHere !== makerThere) constantDiff.push(`MAKER_ROW_NOT_STANDARD_RATE: [${makerHere}] here, [${makerThere}] on the site`);
for (const kind of ["vendor", "reference", "adjusted", "unknown"]) {
  const sample = rows.find((r) => r.hostPricing?.vendor)?.hostPricing;
  if (mcpHosts.provenanceExplanation(kind, sample) !== siteHosts.provenanceExplanation(kind, sample)) {
    constantDiff.push(`provenanceExplanation("${kind}")`);
  }
}
report("host-price constants and sentences", constantDiff.length, 8, constantDiff);

const summaryDiff = [];
const provenanceDiff = [];
const spreadDiff = [];
const standardDiff = [];
let promotionCount = 0;
for (const [row] of pairs) {
  const name = `${row.provider} ${row.model}`;
  // What coerceHostPricing lets through must be what the site sent: a field it
  // drops, or one the site has added since, is a difference to decide on.
  const summary = mcpHosts.coerceHostPricing(row.hostPricing);
  if (JSON.stringify(summary) !== JSON.stringify(row.hostPricing)) summaryDiff.push(name);

  const displayed = { input: row.inputPricePer1M, output: row.outputPricePer1M };
  const kindHere = mcpHosts.priceProvenance(displayed, summary);
  const kindThere = siteHosts.priceProvenance(displayed, row.hostPricing);
  if (kindHere !== kindThere) provenanceDiff.push(`${name}: ${kindHere} here, ${kindThere} on the site`);

  if (mcpHosts.hasNoteworthySpread(summary) !== siteHosts.hasNoteworthySpread(row.hostPricing)) spreadDiff.push(name);

  for (const offer of row.hostPricing?.promotions ?? []) {
    promotionCount += 1;
    if (JSON.stringify(mcpHosts.standardRateOf(offer)) !== JSON.stringify(siteHosts.standardRateOf(offer))) {
      standardDiff.push(`${name} at ${offer.host}`);
    }
  }
}
report("host summaries carried as the site sent them", summaryDiff.length, pairs.length, summaryDiff);
report("whose price the quoted one is", provenanceDiff.length, pairs.length, provenanceDiff);
report("noteworthy spread", spreadDiff.length, pairs.length, spreadDiff);
report("standard rate behind a promotion", standardDiff.length, promotionCount || 1, standardDiff);

// 6. Instance categorisation: lib/compute-categories.ts is the site's file,
//    copied whole. On 2026-11-11, before it was copied again, 826 of 3,555
//    Linux rows in us-east carried another processor here than on the site
//    (121 of the 211 GPU rows) and 138 another category. Compared over the
//    live compute catalogue, every operating system.
const PRICING_URL = process.env.PRICING_API_URL || "https://optimtoken.optimnow.io/api/pricing?region=us-east";
const mcpCompute = await load(join(repoRoot, "server/src/lib/compute-categories.ts"));
const siteCompute = await load(join(sitePath, "src/lib/compute-categories.ts"));
const pricingResponse = await fetch(PRICING_URL, { headers: { Accept: "application/json" } });
if (!pricingResponse.ok) {
  console.error(`${PRICING_URL} returned HTTP ${pricingResponse.status}. The compute check did not run.`);
  process.exit(2);
}
const { instances } = await pricingResponse.json();
if (!Array.isArray(instances) || instances.length === 0) {
  console.error(`${PRICING_URL} returned no instances. The compute check did not run.`);
  process.exit(2);
}
const computeDiff = [];
for (const list of ["ALL_CATEGORIES", "ALL_PROCESSORS", "ALL_USE_CASES"]) {
  if (JSON.stringify(mcpCompute[list]) !== JSON.stringify(siteCompute[list])) computeDiff.push(`${list} is not the site's list`);
}
const enrichedHere = mcpCompute.enrichInstances(instances);
const enrichedThere = siteCompute.enrichInstances(instances);
enrichedHere.forEach((a, i) => {
  const b = enrichedThere[i];
  if (a.category !== b.category || a.processor !== b.processor || a.useCases.join() !== b.useCases.join()) {
    computeDiff.push(
      `${a.provider} ${a.instanceType}: ${a.category} / ${a.processor} / ${a.useCases.join("+")} here, ` +
        `${b.category} / ${b.processor} / ${b.useCases.join("+")} on the site`,
    );
  }
});
report("instance category, processor and use cases", computeDiff.length, instances.length, computeDiff);

// Not a pass or fail: fields on the site's rows that this server does not carry.
// New ones show up here before anyone has decided whether they matter.
// hostPricing and openRouterId are carried beside the model rows, not on them
// (LLMFetchResult.hostPricing), so they are counted here by hand.
const siteFields = new Set(rows.flatMap((r) => Object.keys(r)));
const carried = new Set(pairs.flatMap(([, m]) => Object.keys(m).filter((k) => m[k] !== undefined)));
carried.add("hostPricing").add("openRouterId");
const notCarried = [...siteFields].filter((f) => !carried.has(f));
console.log(`\nSite row fields not carried here: ${notCarried.join(", ") || "none"}.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join("; ")}.`);
  process.exit(1);
}
console.log("\nThis server and the site agree on every check.");
