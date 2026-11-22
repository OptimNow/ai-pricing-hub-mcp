import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_MODEL_NAME_LENGTH,
  closeModelNames,
  matchModels,
  normaliseModelName,
  overlongModelName,
  resolveModel,
} from "./llm-models.js";
import { llmModels } from "../data/pricing-data.js";
import type { LLMModel } from "../data/pricing-data.js";

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

// ── 0.14.2 ────────────────────────────────────────────────────────────
// Found by the review of 2026-11-22, each confirmed against production on
// 0.14.1. The named cases run on a catalogue built here, because the snapshot
// is rewritten every Monday and a row can leave it; the properties run on the
// snapshot, whatever it holds that week.

const row = (provider: string, model: string): LLMModel => ({
  provider, model, inputPricePer1M: 1, outputPricePer1M: 2,
  contextWindow: "128K", category: "Mid-tier", capabilities: ["Text"],
});

const catalogue: LLMModel[] = [
  row("Google", "Gemini 4 Carbon"),
  row("OpenAI", "GPT-5.5"),
  row("OpenAI", "GPT-5.5 Pro"),
  row("OpenAI", "GPT-5 Mini"),
  row("OpenAI", "o3"),
  row("Cohere", "Command A"),
  row("Cohere", "Command A+"),
  row("Cohere", "Command R+ (08-2024)"),
  row("Cohere", "Command R (08-2024)"),
  row("upstage", "Solar Pro 4"),
  row("Amazon", "Nova Pro 1.0"),
  row("Meta", "Llama 3.3 70B Instruct"),
];

const label = (m: { provider: string; model: string } | undefined) => (m ? `${m.provider} ${m.model}` : undefined);

test("the label an answer prints for a model resolves to that model", () => {
  // Every answer names a model "OpenAI GPT-5.5", provider first. On 0.14.1
  // that string matched no row, and the close name offered for it was itself.
  const r = resolveModel(catalogue, "OpenAI GPT-5.5");
  assert.equal(label(r.matched), "OpenAI GPT-5.5");
  assert.equal(r.status, "exact");
  // As an API id spells it, and cut short.
  assert.equal(label(resolveModel(catalogue, "openai/gpt-5.5").matched), "OpenAI GPT-5.5");
  assert.equal(label(resolveModel(catalogue, "Meta Llama 3.3 70B").matched), "Meta Llama 3.3 70B Instruct");
  assert.equal(resolveModel(catalogue, "Meta Llama 3.3 70B").status, "unique");
  // A provider and the start of a name is still several models, and says so.
  assert.equal(resolveModel(catalogue, "OpenAI GPT").status, "ambiguous");
});

test("on the snapshot, every model resolves to itself by its name, its label and its id spelling", () => {
  assert.ok(llmModels.length > 100, `snapshot holds ${llmModels.length} models`);
  for (const m of llmModels) {
    const own = `${m.provider} ${m.model}`;
    for (const query of [m.model, own, own.toLowerCase().replace(/\s+/g, "-")]) {
      const r = resolveModel(llmModels, query);
      assert.equal(label(r.matched), own, query);
      assert.equal(r.status, "exact", query);
    }
  }
});

test('a "+" is part of the name', () => {
  // On 0.14.1 "+" was a separator: Command A+ ($0.30 / $1.50) answered as
  // Command A ($2.50 / $10), and no spelling reached it.
  assert.notEqual(normaliseModelName("Command A+"), normaliseModelName("Command A"));
  for (const [query, expected] of [
    ["Command A+", "Cohere Command A+"],
    ["command-a-plus", "Cohere Command A+"],
    ["Command A Plus", "Cohere Command A+"],
    ["Command A", "Cohere Command A"],
    ["Command R+ (08-2024)", "Cohere Command R+ (08-2024)"],
    ["Command R (08-2024)", "Cohere Command R (08-2024)"],
    ["command-r-plus", "Cohere Command R+ (08-2024)"],
  ] as const) {
    assert.equal(label(resolveModel(catalogue, query).matched), expected, query);
  }
  assert.equal(resolveModel(catalogue, "Command A+").status, "exact");
  assert.equal(resolveModel(catalogue, "Command A").status, "exact");
});

test("a name matches from the start of a word, never inside one", () => {
  // On 0.14.1: "o4" was Solar Pro 4 with the status unique ("pr-o 4"), "o1"
  // was Nova Pro 1.0, and "mini" matched every Gemini.
  for (const query of ["o4", "o1"]) {
    const r = resolveModel(catalogue, query);
    assert.equal(r.status, "not-found", query);
    assert.equal(r.matched, undefined, query);
  }
  assert.deepEqual(names(matchModels(catalogue, "mini", 50)), ["GPT-5 Mini"]);
  // What it must not cost: a real short name, a name cut short, and a word
  // that starts where a letter meets a digit.
  assert.equal(label(resolveModel(catalogue, "o3").matched), "OpenAI o3");
  assert.equal(label(resolveModel(catalogue, "gemin").matched), "Google Gemini 4 Carbon");
  assert.equal(label(resolveModel(catalogue, "70B").matched), "Meta Llama 3.3 70B Instruct");
  assert.equal(label(resolveModel(catalogue, "pro 4").matched), "upstage Solar Pro 4");
});

test("a name longer than any model's is not looked up", () => {
  // A miss is weighed against every row for the close names, at a cost that
  // grows with the name. The ceiling bounds it, well above any real name.
  assert.ok(Math.max(...llmModels.map((m) => `${m.provider} ${m.model}`.length)) * 2 < MAX_MODEL_NAME_LENGTH);

  const atLimit = "GPT-5.5".padEnd(MAX_MODEL_NAME_LENGTH, " ");
  assert.equal(label(resolveModel(catalogue, atLimit).matched), "OpenAI GPT-5.5");
  assert.equal(overlongModelName([atLimit, undefined, "GPT-5.5"]), null);
  assert.equal(overlongModelName([]), null);

  // Even one that would match, and one that is close to a name.
  const overlong = "GPT-5.5".padEnd(MAX_MODEL_NAME_LENGTH + 1, " ");
  assert.deepEqual(matchModels(catalogue, overlong), []);
  assert.deepEqual(closeModelNames(catalogue, "Comand A".padEnd(MAX_MODEL_NAME_LENGTH + 1, " ")), []);
  const huge = "claud sonet ".repeat(80_000);
  const started = performance.now();
  const r = resolveModel(llmModels, huge);
  assert.ok(performance.now() - started < 1_000, "an over-long name costs nothing to refuse");
  assert.equal(r.status, "not-found");
  assert.deepEqual(r.alternatives, []);

  // The refusal quotes the start of the name, not the name.
  const message = overlongModelName(["GPT-5.5", huge]);
  assert.ok(message !== null && message.length < 200, String(message?.length));
  assert.match(message, /at most 200 characters/);
  assert.match(message, /starting "claud sonet claud sonet/);
  assert.match(message, /has 960,000\. No model was looked up\./);
});

test("every tool that looks a name up refuses an over-long one first", () => {
  // index.ts listens on import, so it is read as source, like the other
  // source-level guards. The schemas cannot carry the limit (a definition
  // change makes claude.ai ask for the tool to be approved again), so a new
  // lookup with no refusal in front of it is the way the limit gets lost.
  const index = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
  const lookups = [...index.matchAll(/(?<!function )\b(?:resolveNames|matchModels)\(/g)].length;
  const refusals = [...index.matchAll(/\boverlongModelName\(/g)].length;
  assert.ok(lookups >= 5, `found ${lookups} lookups`);
  assert.equal(refusals, lookups);
});
