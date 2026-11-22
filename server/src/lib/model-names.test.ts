import test from "node:test";
import assert from "node:assert/strict";
import { closeModelNames, matchModels, normaliseModelName, resolveModel } from "./llm-models.js";
import { llmModels } from "../data/pricing-data.js";

const names = (rows: { provider: string; model: string }[]) => rows.map((m) => m.model);

test("one name, however it is typed", () => {
  for (const spelling of ["GPT-5.5", "gpt 5.5", "GPT5.5", "gpt_5.5", "  Gpt-5.5 "]) {
    assert.equal(normaliseModelName(spelling), "gpt 5.5", spelling);
  }
  assert.equal(normaliseModelName("Llama-3.3-70B"), normaliseModelName("Llama 3.3 70B"));
  assert.equal(normaliseModelName("GPT-4o-mini"), "gpt 4 o mini");
  // The version dot is kept: 5.5 is not 55, and not 5 then 5.
  assert.notEqual(normaliseModelName("GPT-5.5"), normaliseModelName("GPT-55"));
});

test("the spellings that matched nothing before 0.13.0 resolve to the model", () => {
  // Measured on 0.12.1 against production on 2026-11-22: each was not-found.
  for (const [query, expected] of [
    ["gpt 5.5", "GPT-5.5"],
    ["GPT5.5", "GPT-5.5"],
    ["Llama-3.3-70B", "Llama 3.3 70B Instruct"],
    ["claude-sonnet-5.5", "Claude Sonnet 5.5"],
  ] as const) {
    const r = resolveModel(llmModels, query);
    assert.equal(r.matched?.model, expected, query);
    assert.notEqual(r.status, "not-found", query);
  }
});

test("what matched before still matches, and an exact name still wins", () => {
  assert.equal(resolveModel(llmModels, "GPT-4o").matched?.model, "GPT-4o");
  assert.equal(resolveModel(llmModels, "GPT-4o").status, "exact");
  assert.ok(names(matchModels(llmModels, "4o", 10)).includes("GPT-4o-mini"));
  assert.equal(resolveModel(llmModels, "Claude Sonnet 5.5").status, "exact");
  // A partial name is still ambiguous and still says so.
  assert.equal(resolveModel(llmModels, "Sonnet").status, "ambiguous");
  // Provider names still match.
  assert.ok(matchModels(llmModels, "anthropic", 50).length > 1);
});

test("a miss names the closest catalogue entries, and uses none of them", () => {
  const r = resolveModel(llmModels, "Claud Sonet 5.5");
  assert.equal(r.status, "not-found");
  assert.equal(r.matched, undefined);
  assert.equal(r.totalMatches, 0);
  assert.ok(r.alternatives.length >= 1 && r.alternatives.length <= 3, String(r.alternatives));
  assert.equal(r.alternatives[0], "Anthropic Claude Sonnet 5.5");
});

test("nothing close is offered for a name that resembles nothing", () => {
  assert.deepEqual(closeModelNames(llmModels, "zzqx 9000"), []);
  assert.deepEqual(closeModelNames(llmModels, ""), []);
  assert.deepEqual(resolveModel(llmModels, "zzqx 9000").alternatives, []);
});
