import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { llmModels, LLM_CAPABILITIES } from "../data/pricing-data.js";
import { coerceSiteModel } from "./llm-models.js";

/**
 * "Code" left the capability list on 2026-10-05, on the site first (its LLM
 * schemaVersion 2.5) and here the same day. It was assigned to any model whose
 * output cost $0.50 per 1M tokens or more: a price threshold, not a capability.
 * These tests hold the places that state the list to the one declaration.
 *
 * Until 0.11.0 this server also inferred capabilities itself, on its OpenRouter
 * tier, and three tests here held that copy of the site's rule (Reasoning from
 * the upstream parameter, never from a name; no Code by name or by price). The
 * tier is gone: every capability now arrives from the site, or from the
 * snapshot taken of it, and is filtered to the declared list on the way in.
 */

test("the declared list has no Code", () => {
  assert.deepEqual([...LLM_CAPABILITIES], ["Text", "Vision", "Reasoning", "Agents", "Image Gen", "Audio"]);
});

test("a site row from an older deployment loses the values this server does not declare", () => {
  const row = coerceSiteModel({
    provider: "OpenAI",
    model: "GPT-5.5",
    inputPricePer1M: 1,
    outputPricePer1M: 10,
    contextWindow: "400K",
    category: "Mid-tier",
    capabilities: ["Text", "Code", "Agents", 7],
  });
  assert.ok(row);
  assert.deepEqual(row.capabilities, ["Text", "Agents"]);
});

test("the snapshot carries only declared capabilities", () => {
  const declared = new Set<string>(LLM_CAPABILITIES);
  const undeclared = llmModels.flatMap((m) =>
    m.capabilities.filter((c) => !declared.has(c)).map((c) => `${m.model}: ${c}`),
  );
  assert.deepEqual(undeclared, []);
});

test("both tool descriptions are built from the declared list", () => {
  const source = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
  // A typed-out list is how "Code" stayed in the descriptions; none may remain.
  assert.doesNotMatch(source, /Text, Vision, (Code, )?Reasoning/);
  const built = source.match(/\$\{LLM_CAPABILITIES\.join\(", "\)\}/g) ?? [];
  assert.equal(built.length, 2);
});
