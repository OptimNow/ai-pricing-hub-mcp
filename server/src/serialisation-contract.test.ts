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

/** The zod output schemas sit above the tool declarations, which open with a
 *  "Tools" heading. Stopping there keeps the tools' INPUT schemas out of the
 *  scan: `maxInputPrice: z.number()` is an argument, not a figure we serialise. */
const TOOLS_HEADING = "// ─── Tools ─";
assert.ok(source.includes(TOOLS_HEADING), "index.ts lost the heading that ends the output schemas");
const schemaRegion = source.slice(0, source.indexOf(TOOLS_HEADING));

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
  "cacheWritePricePer1M",
  // A whole-number percentage from Math.round(), not a currency amount. It
  // matches the money-name pattern because it is *about* cost, but it carries
  // no cents to be noisy in.
  "costDeltaVsTopPct",
  // Published compute rates, not derived
  "onDemandHourly",
  "onDemandMonthly",
  "spot",
  "savingsPlan1yr",
  "savingsPlan3yr",
  "reserved1yr",
  "reserved3yr",
  // Whole-number percentages from Math.round() in lib/compute-rates.ts: the
  // saving of the rate above against on-demand. They match the pattern on the
  // column name they carry, and hold no cents to be noisy in.
  "spotSavingsPct",
  "savingsPlan1yrSavingsPct",
  "savingsPlan3yrSavingsPct",
  "reserved1yrSavingsPct",
  "reserved3yrSavingsPct",
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
    // estimate-self-hosting-breakeven: every one is derived (a rate times 730
    // hours, a difference of two bills), so every one can carry float noise.
    "hourlyRate",
    "monthlyCost",
    "monthlyOperationsCost",
    "fullLoadCostPerRequest",
    "fleetMinusApiMonthly",
    // track-llm-price-changes: a difference of two monthly bills.
    "monthlyDelta",
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

/**
 * What a call to `refusal(…)` or `nothingFound(…)` hands the helper as
 * `structuredContent`, when it is more than the bare `emptyOutput`.
 *
 * Since 0.15.0 an error and a lookup that found nothing are built by those two
 * helpers, so their `structuredContent` is no longer a literal the scan above
 * can see: it is the object in the call. A call that passes `emptyOutput`
 * alone never reached upstream and owes no provenance.
 */
function helperCallBlocks(): string[] {
  const blocks: string[] = [];
  for (const m of source.matchAll(/(?<!function )\b(?:refusal|nothingFound)\(/g)) {
    // The call, to its closing parenthesis.
    let depth = 0;
    let end = source.length;
    for (let i = m.index! + m[0].length - 1; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) { end = i; break; }
    }
    const call = source.slice(m.index!, end + 1);
    const start = call.search(/\{\s*\.\.\.emptyOutput/);
    if (start === -1) continue;
    let braces = 0;
    for (let i = start; i < call.length; i++) {
      if (call[i] === "{") braces++;
      else if (call[i] === "}" && --braces === 0) { blocks.push(call.slice(start, i + 1)); break; }
    }
  }
  return blocks;
}

test("every tool declares provenance in its output schema", () => {
  for (const schema of [
    "compareModelsOutputSchema",
    "estimateCostOutputSchema",
    "computePricingOutputSchema",
    "sideBySideOutputSchema",
    "recommendOutputSchema",
    "modelHostsOutputSchema",
    "selfHostingOutputSchema",
    "priceChangesOutputSchema",
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
  // The answers written out in full, without the two helpers' own bodies
  // (`{ ...structured, error: message }`), which are what the calls below fill.
  const literal = structuredContentBlocks().filter(b => !/^\{\s*\.\.\.structured,/.test(b.trim()));
  assert.ok(literal.length > 0, "sanity: no structuredContent blocks found");

  // A block is allowed to omit provenance only when it never got an answer from
  // upstream — those are the bare error returns, which hand `emptyOutput` to
  // `refusal()` and add nothing but `error`. Anything that reports data, or
  // reports a miss or an error *after* a successful fetch, has provenance
  // available and must forward it.
  const reachedUpstream = [...literal, ...helperCallBlocks()];

  // 10 answers written in full: the 9 successes (track-llm-price-changes has
  // two: the week's moves and a model's history) and the break-even with no
  // fleet priced, which still carries the API side. Plus seven paths that end
  // *after* a good fetch and so still owe the caller provenance, built by
  // `nothingFound()` or `refusal()`: estimate-llm-cost's no-match,
  // compare-models-side-by-side's and compare-model-hosts's "no name
  // resolved", estimate-self-hosting-breakeven's "no model matched", and
  // track-llm-price-changes's "no name resolved", "catalogue on a fallback
  // tier" and "no history could be read", which have the catalogue's
  // provenance to give.
  assert.equal(literal.length, 10, `expected 10 answers written in full, saw ${literal.length}`);
  assert.equal(
    reachedUpstream.length,
    17,
    `expected 17 upstream-backed outputs (10 answers + 7 post-fetch misses and failures), saw ${reachedUpstream.length}`,
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

test("an incomplete compute catalogue is declared, and said in the text of both tools that search it", () => {
  const start = schemaRegion.indexOf("const computeProvenanceSchema");
  const body = schemaRegion.slice(start, schemaRegion.indexOf("\n});", start));
  // A strict host refuses a response carrying a field its schema does not
  // declare, and lib/compute-pricing.ts returns all three on a degraded read.
  for (const field of ["liveProviders", "degradedProviders", "catalogueIsSubset", "upstreamErrors"]) {
    assert.match(body, new RegExp(`^\\s+${field}:`, "m"), `computeProvenanceSchema no longer declares ${field}`);
  }

  // "No match" out of a provider's 18 static rows is not "no such instance":
  // the comparison says it beside an empty result, the break-even beside an
  // instance it did not find.
  const uses = source.match(/incompleteCatalogueCaveat\(/g) ?? [];
  assert.ok(uses.length >= 2, `incompleteCatalogueCaveat is called ${uses.length} time(s), by fewer than two tools`);
  // What the site reported exists in structuredContent; the text has to say it.
  assert.match(source, /Reported by the site on this read: \$\{provenance\.upstreamErrors\.join/);
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

test("every tool emits a 2020-12 outputSchema", () => {
  // Passing a bare Zod raw shape makes the SDK declare draft-07, which hosts
  // reject before the handler runs — the bug that made every tool here
  // uncallable from Claude Code. See lib/output-schema.ts.
  const declarations = [...source.matchAll(/outputSchema:\s*([^,\n]+)/g)].map(m => m[1].trim());
  assert.equal(declarations.length, 8, `expected 8 outputSchema declarations, saw ${declarations.length}`);
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

test("every text that prints an optimized cost says what it assumes", () => {
  // compare-llm-models, estimate-llm-cost, compare-models-side-by-side,
  // recommend-llm-model and estimate-self-hosting-breakeven each print an
  // optimized figure. A saving whose cache share is not stated cannot be
  // checked against the reader's workload (CLAUDE.md, decisions 1b and 3f).
  const tools = source.slice(source.indexOf(TOOLS_HEADING));
  const calls = tools.match(/optimizationAssumption\(/g) ?? [];
  assert.ok(calls.length >= 5, `optimizationAssumption is called ${calls.length} times in the tools, expected 5`);
});

test("every structuredContent that carries an optimized cost says what it assumes, too", () => {
  // Claude Code hands the model `structuredContent` and never the text block
  // (90 of 90 results in the probe battery of 2026-11-20); claude.ai hands it
  // the text. 0.11.3 put the assumption in the text only, and in Claude Code
  // the answer to the demo question said the cached figure "assumes the tool's
  // preset cache-hit rate, which it doesn't state".
  const schemaOf = (name: string, close: string): string => {
    const start = schemaRegion.indexOf(`const ${name} = `);
    assert.ok(start > -1, `${name} not found`);
    return schemaRegion.slice(start, schemaRegion.indexOf(close, start));
  };
  // compare-llm-models and recommend-llm-model: once for the whole answer.
  for (const name of ["compareModelsOutputSchema", "recommendOutputSchema"]) {
    assert.match(
      schemaOf(name, "\n};"),
      /^\s+optimizationAssumption:\s*optimizationAssumptionSchema/m,
      `${name} does not declare what its optimized costs assume`,
    );
  }
  // estimate-llm-cost and compare-models-side-by-side: on every cost cell;
  // estimate-self-hosting-breakeven: on its workload.
  assert.match(schemaOf("estimateCostOutputSchema", "\n};"), /^\s+cacheHitRate:\s*z\.number\(\)/m);
  assert.match(schemaOf("useCaseCostSchema", "\n});"), /^\s+cacheHitRate:\s*z\.number\(\)/m);
  assert.match(schemaOf("selfHostingOutputSchema", "\n};"), /^\s+cacheHitRate:\s*z\.number\(\)/m);
  const tools = source.slice(source.indexOf(TOOLS_HEADING));
  const filled = tools.match(/optimizationAssumption:\s*optimizationAssumptionOf\(/g) ?? [];
  assert.equal(filled.length, 2, `optimizationAssumption is filled in ${filled.length} answer(s), expected 2`);
  assert.match(tools, /cacheHitRate:\s*profile\.cacheHitRate/, "the side-by-side cells lost their cache share");
});

test("the side-by-side comparison sends a request for alternatives to recommend-llm-model", () => {
  // It compares only the names it is given. In the rehearsal of 2026-11-20 the
  // question ended "or something else if it is better", Claude called this
  // tool alone and never looked at the rest of the catalogue.
  const at = source.indexOf('"compare-models-side-by-side",');
  const description = source.slice(at, source.indexOf("inputSchema", at));
  assert.match(description, /another model would be better or cheaper, call recommend-llm-model/);
  // And in the result, read at the moment the next call is chosen: on
  // claude.ai on 2026-11-21, Claude once picked its own alternatives instead.
  const handler = source.slice(at, source.indexOf("// ─── Tool 4", at));
  assert.match(handler, /is answered by recommend-llm-model, which ranks all \$\{allModels\.length\} models/);
});
