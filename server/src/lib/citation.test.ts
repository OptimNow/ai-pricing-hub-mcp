import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeWithSource, sourceToCite } from "./citation.js";

test("an LLM answer names OptimToken and the day of its prices", () => {
  const line = sourceToCite({ provenance: { tier: 1, upstreamTimestamp: "2026-11-21T08:14:00.000Z", eloAsOf: "2026-11-11" } });
  assert.equal(
    line,
    "Source to name with any figure quoted from this answer: OptimToken (optimtoken.optimnow.io), prices as of 2026-11-21.",
  );
});

test("a fallback answer says it is the snapshot, and of which day", () => {
  const line = sourceToCite({ provenance: { tier: 2, dataAsOf: "2026-11-16" } });
  assert.match(line ?? "", /OptimToken \(optimtoken\.optimnow\.io\), prices from its snapshot of 2026-11-16, not live\.$/);
});

test("the break-even dates both catalogues", () => {
  const line = sourceToCite({
    provenance: { tier: 1, upstreamTimestamp: "2026-11-21T08:14:00.000Z" },
    computeProvenance: { tier: 1, region: "us-east", upstreamTimestamp: "2026-11-20T23:00:00.000Z" },
  });
  assert.match(line ?? "", /API prices as of 2026-11-21 and instance rates as of 2026-11-20\.$/);
});

test("compute and the price archive say what they date", () => {
  assert.match(sourceToCite({ provenance: { tier: 1, region: "europe", upstreamTimestamp: "2026-11-21T01:00:00Z" } }) ?? "", /instance rates as of 2026-11-21\.$/);
  assert.match(sourceToCite({ provenance: { source: "optimtoken", asOf: "2026-11-21" } }) ?? "", /price archive as of 2026-11-21\.$/);
});

test("the line closes a successful answer's text, and never an error", () => {
  const ok = closeWithSource({
    structuredContent: { provenance: { tier: 1, upstreamTimestamp: "2026-11-21T08:14:00Z" } },
    content: [{ type: "text", text: "Data source: …\n\nfigures" }],
    isError: false,
  });
  assert.match(ok.content[0].text, /figures\n\nSource to name with any figure quoted from this answer: OptimToken/);

  const failed = closeWithSource({
    structuredContent: { provenance: { tier: 1 }, error: "No model matched" },
    content: [{ type: "text", text: "No model matched" }],
    isError: true,
  });
  assert.equal(failed.content[0].text, "No model matched");

  const unreached = closeWithSource({ structuredContent: { error: "down" }, content: [{ type: "text", text: "down" }] });
  assert.equal(unreached.content[0].text, "down");
});

test("every tool's handler goes through it, and the output schemas are untouched", () => {
  const index = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
  // In tool(), the one place every registration passes through: the wrapper
  // around every handler ends on it, and nothing else calls it.
  assert.match(index, /^    return closeWithSource\(result\);\r?$/m);
  assert.equal([...index.matchAll(/\bcloseWithSource\(/g)].length, 1);
  assert.match(index, /server\.registerTool\(name, \{ \.\.\.config, inputSchema, annotations \}, handler\)/);
  // No `citation` field: a schema change makes claude.ai ask every user who
  // chose "Always allow" to approve each changed tool again.
  assert.doesNotMatch(index, /^\s+citation:\s*z\./m);
});
