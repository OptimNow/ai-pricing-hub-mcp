import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guard against the bug class that produced "$44999.99999999999".
 *
 * A derived money value serialised straight out of a handler carries its
 * IEEE-754 representation, and every tool here instructs the caller to report
 * figures EXACTLY as returned — so the noise reaches the end user. It has now
 * happened three times, each time in a field added after the previous fix:
 *
 *   1. perRequest / monthly            (the original report)
 *   2. perRequestOptimized / …         (added by a concurrent PR, missed)
 *   3. maxBlendedPrice                 (found while writing this test)
 *
 * The pattern is always the same: someone adds a money field to an output
 * schema and the spread carries it through unrounded. Nothing fails, because
 * the arithmetic is correct — only the printed form is wrong.
 *
 * So this test refuses to let a money-shaped output field go UNCLASSIFIED.
 * Every one must be either rounded at the boundary or listed below as
 * deliberately passed through, with a reason. A new field is in neither set,
 * so adding one fails this test until its author makes the call.
 */

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

/** The zod output schemas sit above the server declaration. */
const schemaRegion = source.slice(0, source.indexOf("const server = new McpServer"));

/** Anything whose name reads like money. Deliberately broad: the cost of a
 *  false positive is one line in the list below, the cost of a false negative
 *  is a wrong number shown to a customer. */
const MONEY = /cost|budget|price|monthly|perrequest|hourly|spot|reserved|savingsplan/i;

/**
 * Money fields that are correct unrounded, and why.
 *
 * The per-1M token prices are already rounded at ingest in llm-models.ts
 * (`Math.round(p * 10000) / 10000`), so they reach the schema clean. The
 * compute figures are published rates read straight from the catalogue — none
 * is derived, and none was noisy when checked across all 137 rows.
 */
const PASS_THROUGH = new Set([
  // Rounded upstream at ingest (llm-models.ts)
  "inputPricePer1M",
  "outputPricePer1M",
  "batchInputPricePer1M",
  "batchOutputPricePer1M",
  "cachedInputPricePer1M",
  // Published compute rates, not derived
  "onDemandHourly",
  "onDemandMonthly",
  "spot",
  "savingsPlan1yr",
  "savingsPlan3yr",
  "reserved1yr",
  "reserved3yr",
]);

/** Every field name declared in the output schemas. */
function schemaFields(): string[] {
  return [...schemaRegion.matchAll(/^\s+(\w+):\s*z\./gm)].map(m => m[1]);
}

/** Only the scalar numbers, e.g. `  perRequest: z.number(),`. Containers such
 *  as `costs: z.array(...)` carry money-shaped names but hold no value of their
 *  own — it is their leaves that have to be clean. */
function numberFields(): string[] {
  return [...schemaRegion.matchAll(/^\s+(\w+):\s*z\.number\(\)/gm)].map(m => m[1]);
}

/** Field names rounded at a serialisation boundary, e.g. `perRequest: roundPerRequestCost(...)` */
function roundedFields(): Set<string> {
  return new Set([...source.matchAll(/(\w+):\s*round[A-Za-z0-9]*\(/g)].map(m => m[1]));
}

test("every money-shaped output field is rounded or explicitly passed through", () => {
  const rounded = roundedFields();
  const money = [...new Set(numberFields())].filter(f => MONEY.test(f));

  assert.ok(money.length > 0, "sanity: the schema scan found no money fields at all");

  const unclassified = money.filter(f => !rounded.has(f) && !PASS_THROUGH.has(f));
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified money field(s) in the output schemas: ${unclassified.join(", ")}.\n` +
      "Either round it at the boundary where structuredContent is built, or add it to " +
      "PASS_THROUGH here with the reason it is already clean.",
  );
});

test("the fields fixed by each past regression are still rounded", () => {
  // Named explicitly so a refactor that drops one is loud rather than silent.
  const rounded = roundedFields();
  for (const field of [
    "perRequest",
    "monthly",
    "perRequestOptimized",
    "monthlyOptimized",
    "useCaseCost",
    "monthlyBudget",
    "optimizedUseCaseCost",
    "optimizedMonthlyBudget",
    "maxBlendedPrice",
  ]) {
    assert.ok(rounded.has(field), `${field} is no longer rounded at the boundary`);
  }
});

test("the pass-through list has not gone stale", () => {
  // A name left here after its field is renamed would silently widen the
  // exemption, so every entry must still exist in the schemas.
  const declared = new Set(schemaFields());
  for (const field of PASS_THROUGH) {
    assert.ok(declared.has(field), `PASS_THROUGH lists "${field}", which no schema declares`);
  }
});

/**
 * Provenance is only useful if it actually ships.
 *
 * These are source-level checks for the same reason the money checks above are:
 * the failure mode is a field that quietly stops being emitted during a
 * refactor, which no runtime test of the lib layer would catch — the fetchers
 * would still return provenance, the handlers would just stop forwarding it.
 */

/** The bodies of the three `structuredContent: { ... }` blocks in the handlers. */
function structuredContentBlocks(): string[] {
  return [...source.matchAll(/structuredContent:\s*\{/g)].map(m => {
    // Walk braces from the opening one so nested objects are included whole.
    let depth = 0;
    const start = source.indexOf("{", m.index!);
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    return source.slice(start);
  });
}

test("all three tools declare provenance in their output schema", () => {
  for (const schema of [
    "compareModelsOutputSchema",
    "estimateCostOutputSchema",
    "computePricingOutputSchema",
  ]) {
    const start = schemaRegion.indexOf(`const ${schema} = {`);
    assert.ok(start > -1, `${schema} not found`);
    const body = schemaRegion.slice(start, schemaRegion.indexOf("\n};", start));
    assert.match(
      body,
      /^\s+provenance:\s*\w+ProvenanceSchema/m,
      `${schema} no longer declares provenance — callers lose the ability to date a figure they quote`,
    );
  }
});

test("every structuredContent that reached upstream carries provenance", () => {
  const blocks = structuredContentBlocks();
  assert.ok(blocks.length > 0, "sanity: no structuredContent blocks found");

  // A block is allowed to omit provenance only when it never got an answer from
  // upstream — those are the bare error returns, which spread emptyOutput and
  // add nothing but `error`. Anything that reports data, or reports an error
  // *after* a successful fetch, has provenance available and must forward it.
  const reachedUpstream = blocks.filter(
    b => !/^\{\s*\.\.\.emptyOutput,\s*error:[^,}]+\}$/.test(b.trim().replace(/\s+/g, " ")),
  );

  assert.equal(
    reachedUpstream.length,
    4,
    `expected 4 upstream-backed outputs (3 successes + the no-match path), saw ${reachedUpstream.length}`,
  );
  for (const block of reachedUpstream) {
    assert.match(
      block,
      /\bprovenance\b/,
      `a structuredContent block omits provenance:\n${block.slice(0, 200)}`,
    );
  }
});

test("the compute output exposes per-column price provenance", () => {
  // priceTypes is what separates a live on-demand rate from a static Savings
  // Plan constant. Losing it turns an auditable answer into an unauditable one.
  const start = schemaRegion.indexOf("const computeProvenanceSchema");
  assert.ok(start > -1, "computeProvenanceSchema not found");
  const body = schemaRegion.slice(start, schemaRegion.indexOf("\n});", start));

  for (const field of ["priceTypes", "staticPriceColumns", "unavailablePriceColumns", "sources", "sourceRegions"]) {
    assert.match(body, new RegExp(`^\\s+${field}:`, "m"), `computeProvenanceSchema no longer exposes ${field}`);
  }
});

test("the LLM provenance keeps the verified-pricing flag", () => {
  const start = schemaRegion.indexOf("const llmProvenanceSchema");
  assert.ok(start > -1, "llmProvenanceSchema not found");
  const body = schemaRegion.slice(start, schemaRegion.indexOf("\n});", start));

  // Without this, a tier-2 response is indistinguishable from a tier-1 one and
  // the caller quotes uncorrected OpenRouter prices as if they were checked.
  assert.match(body, /^\s+pricesVerified:\s*z\.boolean\(\)/m);
  assert.match(body, /^\s+upstreamTimestamp:/m);
  assert.match(body, /^\s+notice:/m);
});

test("all three tools emit a 2020-12 outputSchema", () => {
  // Passing a bare Zod raw shape makes the SDK declare draft-07, which hosts
  // reject before the handler runs — the bug that made every tool here
  // uncallable from Claude Code. See lib/output-schema.ts.
  const declarations = [...source.matchAll(/outputSchema:\s*([^,\n]+)/g)].map(m => m[1].trim());
  assert.equal(declarations.length, 3, `expected 3 outputSchema declarations, saw ${declarations.length}`);
  for (const declaration of declarations) {
    assert.match(
      declaration,
      /^outputSchema\(/,
      `outputSchema must be wrapped by outputSchema() or the host rejects the tool: saw "${declaration}"`,
    );
  }
});

test("rounding is applied where structuredContent is built, not in the cost functions", () => {
  const metrics = readFileSync(
    fileURLToPath(new URL("./lib/llm-business-metrics.ts", import.meta.url)),
    "utf8",
  );
  // The ranking consumes these raw; rounding inside them would create ties.
  for (const fn of ["export function useCaseCost", "export function optimizedUseCaseCost"]) {
    const start = metrics.indexOf(fn);
    assert.ok(start > -1, `${fn} not found`);
    const body = metrics.slice(start, metrics.indexOf("\n}", start));
    assert.ok(
      !/round[A-Za-z0-9]*\(|toFixed\(/.test(body),
      `${fn} must return the raw float — rounding belongs at serialisation`,
    );
  }
});
