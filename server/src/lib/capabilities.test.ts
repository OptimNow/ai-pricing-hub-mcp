import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { llmModels, LLM_CAPABILITIES } from "../data/pricing-data.js";
import { coerceSiteModel, inferCapabilities } from "./llm-models.js";

/**
 * "Code" left the capability list on 2026-10-05, on the site first (its LLM
 * schemaVersion 2.5) and here the same day. It was assigned to any model whose
 * output cost $0.50 per 1M tokens or more: a price threshold, not a capability.
 * These tests hold the four places that state the list to the one declaration.
 */

type UpstreamModel = Parameters<typeof inferCapabilities>[0];
const upstream = (id: string, completion: string) =>
  ({
    id,
    name: id,
    created: 0,
    description: "",
    context_length: 128000,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.000001", completion },
    supported_parameters: [],
  }) as unknown as UpstreamModel;

test("the declared list has no Code", () => {
  assert.deepEqual([...LLM_CAPABILITIES], ["Text", "Vision", "Reasoning", "Agents", "Image Gen", "Audio"]);
});

test("the OpenRouter tier assigns Code neither by name nor by price", () => {
  // Both halves of the removed rule: a code-named id, and an output price of
  // $0.50 per 1M tokens or more.
  assert.deepEqual(inferCapabilities(upstream("mistralai/codestral-2508", "0.0000009")), ["Text"]);
  assert.deepEqual(inferCapabilities(upstream("openai/gpt-5.5", "0.00003")), ["Text"]);
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
