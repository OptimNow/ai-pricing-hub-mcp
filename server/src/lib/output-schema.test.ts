import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { outputSchema, JSON_SCHEMA_2020_12 } from "./output-schema.js";

/**
 * Guard the preflight fix.
 *
 * Every tool in this server was rejected by Claude Code before its handler ran,
 * because the SDK emits `"$schema": "http://json-schema.org/draft-07/schema#"`
 * and the host validates 2020-12 only. `outputSchema()` overrides the declared
 * dialect via Zod's `.meta()`.
 *
 * That override is only honest if draft-07 and 2020-12 emission are otherwise
 * identical for the shapes we actually declare — which holds until someone adds
 * a tuple or a registered sub-schema. These tests pin both halves: that the
 * dialect really is 2020-12 after the SDK's own conversion, and that the body
 * matches what Zod's native 2020-12 emitter produces.
 */

/** Exactly what `mcp.js` does to a registered `outputSchema`. */
function asTheSdkWouldEmit(schema: unknown): Record<string, unknown> {
  const normalized = normalizeObjectSchema(schema as never);
  assert.ok(normalized, "the SDK could not normalise this schema — it would be dropped silently");
  return toJsonSchemaCompat(normalized, {
    strictUnions: true,
    pipeStrategy: "output",
  }) as Record<string, unknown>;
}

/** The real shapes, kept structurally representative of index.ts: nested
 *  objects, arrays of objects, nullables, optionals, records and enums. */
const representativeShape = {
  models: z.array(
    z.object({
      provider: z.string(),
      efficiencyScore: z.number().nullable(),
      capabilities: z.array(z.string()),
      parameters: z.string().optional(),
    }),
  ),
  provenance: z
    .object({
      tier: z.number(),
      pricesVerified: z.boolean(),
      priceTypes: z.record(z.string(), z.record(z.string(), z.string())).optional(),
      staticPriceColumns: z.array(z.string()),
      notice: z.string().optional(),
    })
    .optional(),
  source: z.string(),
  error: z.string().optional(),
};

test("the SDK emits 2020-12 for a schema built by outputSchema()", () => {
  const emitted = asTheSdkWouldEmit(outputSchema(representativeShape));
  assert.equal(
    emitted.$schema,
    JSON_SCHEMA_2020_12,
    "the emitted dialect is not 2020-12 — hosts will reject every tool again",
  );
});

test("a bare raw shape still emits draft-07 (the bug this works around)", () => {
  // Pinned deliberately: if the SDK ever fixes its `target` default, this test
  // fails and tells us outputSchema() is no longer load-bearing.
  const emitted = asTheSdkWouldEmit(representativeShape);
  assert.equal(emitted.$schema, "http://json-schema.org/draft-07/schema#");
});

test("overriding the dialect does not misdescribe the schema body", () => {
  // The claim in output-schema.ts is that only the `$schema` line differs for
  // these shapes. Verify against Zod's own native 2020-12 emitter rather than
  // asserting it by eye.
  const viaMeta = asTheSdkWouldEmit(outputSchema(representativeShape));
  const native = z.toJSONSchema(z.object(representativeShape), {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;

  assert.deepEqual(
    viaMeta,
    native,
    "draft-07 and 2020-12 emission have diverged for these shapes — the declared " +
      "dialect no longer matches the body, so this needs a real conversion rather " +
      "than a metadata override",
  );
});

test("outputSchema() still validates structuredContent", () => {
  // The override must not cost us the output contract — that contract is the
  // reason we did not simply drop outputSchema.
  const schema = outputSchema({ source: z.string(), count: z.number() });

  assert.equal(schema.safeParse({ source: "optimtoken", count: 3 }).success, true);
  assert.equal(schema.safeParse({ source: "optimtoken", count: "3" }).success, false);
  assert.equal(schema.safeParse({ source: "optimtoken" }).success, false);
});
