import { z } from "zod";

/**
 * Build a tool `outputSchema` that declares JSON Schema 2020-12.
 *
 * Why this exists: hosts that validate `outputSchema` (Claude Code among them)
 * support the 2020-12 dialect only, and reject a tool outright — before its
 * handler ever runs — when the schema declares draft-07:
 *
 *   Tool 'compare-llm-models' has an invalid outputSchema: JSON Schema declares
 *   an unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#")
 *
 * The draft-07 declaration is not ours. `@modelcontextprotocol/sdk` converts
 * every registered Zod schema through `toJsonSchemaCompat()`, and its
 * `mapMiniTarget()` helper falls back to `'draft-7'` whenever the caller passes
 * no `target` — which `mcp.js` never does, on either the input or the output
 * path. That is still true as of SDK 1.30.0, so upgrading does not fix it, and
 * Skybridge only forwards to `super.registerTool()`, so it cannot fix it either.
 *
 * Two non-fixes, ruled out by inspection rather than assumption:
 *
 *  - Passing an already-built JSON Schema object. `outputSchema` is typed
 *    `ZodRawShapeCompat | AnySchema`, and `AnySchema` is `z3.ZodTypeAny |
 *    z4.$ZodType` — Zod only. A plain object makes `normalizeObjectSchema()`
 *    return `undefined`, which *silently drops the schema entirely*. That
 *    trades a loud error for a quiet loss of the contract.
 *  - Patching `node_modules`, with or without a postinstall step. Out of scope
 *    by instruction, and it would not survive a fresh install on Alpic.
 *
 * What does work: Zod v4 merges a schema's `.meta()` into the JSON Schema it
 * emits, and `$schema` is written from the metadata rather than re-stamped
 * afterwards. So the declared dialect becomes 2020-12 while the SDK still does
 * the conversion and Zod stays the single source of truth — no hand-written
 * JSON Schema, no vendored copy to drift.
 *
 * This is only sound because, for the shapes these tools declare, Zod's
 * draft-07 and 2020-12 output are otherwise byte-identical: the dialects differ
 * on `$defs`/`definitions` and tuple `prefixItems`, and none of these schemas
 * uses a registered sub-schema or a tuple. `output-schema.test.ts` asserts that
 * equivalence against Zod's own native 2020-12 emitter for the real schemas, so
 * if a future field breaks it, the test fails rather than the claim quietly
 * becoming a lie.
 */
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

export function outputSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).meta({ $schema: JSON_SCHEMA_2020_12 });
}
