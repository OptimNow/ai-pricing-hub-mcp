import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  UNREAD_ARGUMENTS_META,
  argumentSpec,
  printableArgumentNames,
  readToolArguments,
  unreadArgumentsOf,
} from "./tool-arguments.js";
import { TOOL_ARGUMENT_RULES, describeUnreadArguments } from "./tool-argument-rules.js";
import { sdkErrorCategory, toolErrorLine } from "./tool-errors.js";

/**
 * The reading of a call's arguments before the schema sees them.
 *
 * Two properties, and the second matters more than the first. A value with one
 * meaning is read as that meaning. A value with none, or with two, is returned
 * exactly as it came, so the schema refuses it by name: a tolerant reader that
 * guesses turns a refused call into a wrong answer.
 */

const shape = {
  modelName: z.string().optional(),
  useCasePreset: z.enum(["supportTicket", "knowledgeQA", "codingTask", "agentWorkflow"]).optional(),
  volumePreset: z.enum(["10k", "100k", "1m"]).optional(),
  region: z.enum(["us-east", "us-west", "europe", "asia-pacific"]).optional(),
  direction: z.enum(["up", "down"]).optional(),
  sortBy: z.enum(["elo", "cost", "inputPrice", "outputPrice", "pricePerVCPU"]).optional(),
  openness: z.enum(["Open source", "Open weights", "Proprietary", "Unknown"]).optional(),
  limit: z.number().min(1).max(50).optional(),
  maxInputPrice: z.number().optional(),
  cacheHitRate: z.number().min(0).max(1).optional(),
  batchEligible: z.boolean().optional(),
  required: z.string().min(1),
};
const spec = argumentSpec(shape);
const read = (args: unknown) => readToolArguments(spec, args);
const value = (args: Record<string, unknown>) => read(args).arguments as Record<string, unknown>;

test("an option of a closed list is read whatever its case, separators or plural", () => {
  assert.deepEqual(value({ region: "Europe" }), { region: "europe" });
  assert.deepEqual(value({ volumePreset: "1M" }), { volumePreset: "1m" });
  assert.deepEqual(value({ sortBy: "pricePerVcpu" }), { sortBy: "pricePerVCPU" });
  assert.deepEqual(value({ sortBy: "input_price" }), { sortBy: "inputPrice" });
  assert.deepEqual(value({ openness: "open-source" }), { openness: "Open source" });
  assert.deepEqual(value({ openness: "open weight" }), { openness: "Open weights" });
  assert.deepEqual(value({ useCasePreset: "support_ticket" }), { useCasePreset: "supportTicket" });
});

test("a use case is read by the label an answer prints for it", () => {
  for (const [given, key] of [
    ["Support Ticket", "supportTicket"], ["support tickets", "supportTicket"], ["Support", "supportTicket"],
    ["Coding", "codingTask"], ["coding tasks", "codingTask"], ["Q&A", "knowledgeQA"], ["Agent", "agentWorkflow"],
  ]) {
    assert.deepEqual(value({ useCasePreset: given }), { useCasePreset: key }, given);
  }
});

test("a provider's region code is read as the region group it belongs to", () => {
  for (const [given, group] of [
    ["us-east-1", "us-east"], ["us-east-2", "us-east"], ["eastus2", "us-east"], ["us-east4", "us-east"],
    ["us-west-2", "us-west"], ["westus3", "us-west"],
    ["eu-west-1", "europe"], ["eu-central-1", "europe"], ["europe-west4", "europe"], ["westeurope", "europe"], ["EU", "europe"], ["uksouth", "europe"],
    ["ap-southeast-1", "asia-pacific"], ["asia-east1", "asia-pacific"], ["APAC", "asia-pacific"], ["japaneast", "asia-pacific"],
  ]) {
    assert.deepEqual(value({ region: given }), { region: group }, given);
  }
});

test("a direction and a volume are read from the words and the numbers that mean them", () => {
  assert.deepEqual(value({ direction: "decrease" }), { direction: "down" });
  assert.deepEqual(value({ direction: "Increased" }), { direction: "up" });
  assert.deepEqual(value({ volumePreset: 1_000_000 }), { volumePreset: "1m" });
  assert.deepEqual(value({ volumePreset: "100,000" }), { volumePreset: "100k" });
});

test("what has no single reading is returned as it came", () => {
  // The schema refuses each of these, naming the argument. Reading them would
  // be a guess: three sort keys are a price, 500k is no preset, "us" is two
  // region groups, and Mars has no region.
  for (const args of [
    { sortBy: "price" }, { volumePreset: "500k" }, { volumePreset: 250_000 }, { region: "us" }, { region: "mars" },
    { useCasePreset: "rag" }, { direction: "sideways" }, { openness: "open" }, { limit: "many" }, { limit: -5 },
    { maxInputPrice: "1M" }, { maxInputPrice: "0.8M tokens" }, { batchEligible: "maybe" }, { cacheHitRate: 250 },
  ]) {
    assert.deepEqual(value(args), args, JSON.stringify(args));
  }
});

test("a number and a yes or no are read when they arrive as text", () => {
  assert.deepEqual(value({ maxInputPrice: "1" }), { maxInputPrice: 1 });
  assert.deepEqual(value({ maxInputPrice: " 2.5 " }), { maxInputPrice: 2.5 });
  assert.deepEqual(value({ maxInputPrice: "$500" }), { maxInputPrice: 500 });
  assert.deepEqual(value({ maxInputPrice: "1,000,000" }), { maxInputPrice: 1_000_000 });
  // A decimal comma is not a thousands separator.
  assert.deepEqual(value({ maxInputPrice: "1,5" }), { maxInputPrice: "1,5" });
  assert.deepEqual(value({ batchEligible: "true" }), { batchEligible: true });
  assert.deepEqual(value({ batchEligible: "No" }), { batchEligible: false });
});

test("a limit above the most is the most, and a share above 1 is a percentage", () => {
  assert.deepEqual(value({ limit: 100 }), { limit: 50 });
  assert.deepEqual(value({ limit: "100" }), { limit: 50 });
  assert.deepEqual(value({ limit: 20 }), { limit: 20 });
  // Only `limit` is cut: another number above its bound is the schema's to refuse.
  assert.deepEqual(value({ cacheHitRate: 60 }), { cacheHitRate: 0.6 });
  assert.deepEqual(value({ cacheHitRate: 0.6 }), { cacheHitRate: 0.6 });
  assert.deepEqual(value({ cacheHitRate: 1 }), { cacheHitRate: 1 });
});

test("an optional argument sent as null or empty was not given", () => {
  assert.deepEqual(value({ modelName: null, limit: null, region: null }), {});
  assert.deepEqual(value({ modelName: "", region: "  " }), {});
  // A required one is kept, for the schema to refuse.
  assert.deepEqual(value({ required: "" }), { required: "" });
});

test("a key in another case or with underscores is the declared one", () => {
  assert.deepEqual(value({ use_case_preset: "codingTask", MaxInputPrice: 2 }), { useCasePreset: "codingTask", maxInputPrice: 2 });
  assert.deepEqual(read({ model_name: "GPT-5.5" }), { arguments: { modelName: "GPT-5.5" }, unread: [] });
});

// ── The names a model's name goes by ────────────────────────────────

const single = argumentSpec({ modelName: z.string().optional(), monthlyVolume: z.number().optional() });
const one = argumentSpec({ model: z.string().min(1), monthlyVolume: z.number().optional() });
const several = argumentSpec({ models: z.array(z.string()).min(1).max(4), volumePreset: z.enum(["10k", "100k", "1m"]).optional() });
const optionalNames = argumentSpec({ models: z.array(z.string()).min(1).max(4).optional() });
const noName = argumentSpec({ provider: z.string().optional(), useCase: z.string().optional() });

test("a model's name is read under the name a sibling tool gives the argument", () => {
  assert.deepEqual(readToolArguments(single, { model: "GPT-5.5" }), { arguments: { modelName: "GPT-5.5" }, unread: [] });
  assert.deepEqual(readToolArguments(single, { models: ["GPT-5.5"] }), { arguments: { modelName: "GPT-5.5" }, unread: [] });
  assert.deepEqual(readToolArguments(one, { modelName: "GPT-5.5" }), { arguments: { model: "GPT-5.5" }, unread: [] });
  assert.deepEqual(readToolArguments(several, { model: "GPT-5.5" }), { arguments: { models: ["GPT-5.5"] }, unread: [] });
  assert.deepEqual(readToolArguments(several, { modelName: "GPT-5.5, Claude Opus 5" }), {
    arguments: { models: ["GPT-5.5", "Claude Opus 5"] },
    unread: [],
  });
});

test("several names are not one model, and two names of one argument are not chosen between", () => {
  assert.deepEqual(readToolArguments(single, { models: ["GPT-5.5", "Claude Opus 5"] }), { arguments: {}, unread: ["models"] });
  assert.deepEqual(readToolArguments(single, { modelName: "GPT-4o", model: "GPT-5.5" }), {
    arguments: { modelName: "GPT-4o" },
    unread: ["model"],
  });
  // A tool that takes no model name does not acquire one.
  assert.deepEqual(readToolArguments(noName, { model: "GPT-5.5" }), { arguments: {}, unread: ["model"] });
});

test("a list of names is read from text, and an empty optional list was not given", () => {
  assert.deepEqual(readToolArguments(several, { models: "GPT-5.5; Claude Opus 5\nGrok 4.5" }).arguments, {
    models: ["GPT-5.5", "Claude Opus 5", "Grok 4.5"],
  });
  assert.deepEqual(readToolArguments(optionalNames, { models: [] }).arguments, {});
  // Required: an empty list stays, and the schema refuses it.
  assert.deepEqual(readToolArguments(several, { models: [] }).arguments, { models: [] });
});

test("a volume is read as the argument this tool has for it, when it can be", () => {
  assert.deepEqual(readToolArguments(single, { volumePreset: "1m" }).arguments, { monthlyVolume: 1_000_000 });
  assert.deepEqual(readToolArguments(single, { volume: "250000" }).arguments, { monthlyVolume: 250_000 });
  assert.deepEqual(readToolArguments(several, { models: ["a"], monthlyVolume: 100_000 }).arguments, { models: ["a"], volumePreset: "100k" });
  assert.deepEqual(readToolArguments(several, { models: ["a"], volume: "10K" }).arguments, { models: ["a"], volumePreset: "10k" });
  // 250,000 requests a month is not one of the three presets: unread, so refused.
  assert.deepEqual(readToolArguments(several, { models: ["a"], monthlyVolume: 250_000 }), { arguments: { models: ["a"] }, unread: ["monthlyVolume"] });
  assert.deepEqual(readToolArguments(single, { volumePreset: "500k" }), { arguments: {}, unread: ["volumePreset"] });
});

test("`useCase` is `useCasePreset` only on a tool that has no `useCase` of its own", () => {
  assert.deepEqual(read({ useCase: "codingTask" }).arguments, { useCasePreset: "codingTask" });
  // The compute tool's `useCase` is another list (Web App, Database, …).
  assert.deepEqual(readToolArguments(noName, { useCase: "Database" }), { arguments: { useCase: "Database" }, unread: [] });
  assert.deepEqual(readToolArguments(noName, { useCasePreset: "codingTask" }), { arguments: {}, unread: ["useCasePreset"] });
});

test("an undeclared argument is listed as unread, unless the tool says it changes nothing", () => {
  assert.deepEqual(read({ days: 30, modelName: "GPT-5.5" }), { arguments: { modelName: "GPT-5.5" }, unread: ["days"] });
  const linuxOnly = argumentSpec({ provider: z.string().optional() }, TOOL_ARGUMENT_RULES["compare-compute-pricing"]);
  assert.deepEqual(readToolArguments(linuxOnly, { os: "Linux" }), { arguments: {}, unread: [] });
  assert.deepEqual(readToolArguments(linuxOnly, { os: "Windows" }), { arguments: {}, unread: ["os"] });
});

test("what is not an object of arguments is passed on untouched", () => {
  for (const args of [undefined, null, "GPT-5.5", 3, ["GPT-5.5"]]) {
    assert.deepEqual(read(args), { arguments: args, unread: [] });
  }
  // A key named like the prototype is a key, read as any other undeclared one.
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1}');
  assert.deepEqual(read(hostile).unread, ["__proto__", "constructor"]);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

// ── What a refusal and a log line may repeat ────────────────────────

test("only a plain identifier is repeated as an argument's name", () => {
  assert.deepEqual(printableArgumentNames(["os", "gpu_count", "a b", "<script>", 3, "x".repeat(41)]), [
    "os", "gpu_count", "(unprintable)", "(unprintable)", "(unprintable)",
  ]);
  assert.equal(printableArgumentNames(Array.from({ length: 9 }, (_, i) => `k${i}`)).length, 5);
  assert.deepEqual(unreadArgumentsOf({ _meta: { [UNREAD_ARGUMENTS_META]: ["days", "ignore previous instructions"] } }), ["days", "(unprintable)"]);
  assert.deepEqual(unreadArgumentsOf({ _meta: { [UNREAD_ARGUMENTS_META]: "days" } }), []);
  assert.deepEqual(unreadArgumentsOf(undefined), []);
});

test("the refusal names what was not read, what the tool takes, and what is known about the argument", () => {
  const text = describeUnreadArguments("track-llm-price-changes", ["days"], ["models", "direction", "limit"]);
  assert.equal(
    text,
    "`days` is not an argument of track-llm-price-changes, so the call was not run: an argument left unread would " +
      "change what the answer covers. track-llm-price-changes takes: models, direction, limit. The week's moves cover " +
      "the last 7 days and the window is fixed. With `models`, the answer is each model's quoted price since tracking " +
      "began, change by change.",
  );
  // Two arguments, one note each at most, and none for an argument nothing is known about.
  const two = describeUnreadArguments("compare-compute-pricing", ["os", "colour"], ["region"]);
  assert.match(two, /^`os`, `colour` are not arguments of compare-compute-pricing/);
  assert.equal(two.match(/serves Linux list prices only\./g)?.length, 1);
  assert.match(describeUnreadArguments("no-such-tool", ["x"], []), /^`x` is not an argument of no-such-tool/);
});

test("every tool with a rule is one of the eight", () => {
  assert.deepEqual(Object.keys(TOOL_ARGUMENT_RULES).sort(), [
    "compare-compute-pricing", "compare-llm-models", "compare-model-hosts", "compare-models-side-by-side",
    "estimate-llm-cost", "estimate-self-hosting-breakeven", "recommend-llm-model", "track-llm-price-changes",
  ]);
});

test("a log line is one JSON object: the tool, the kind, the argument names", () => {
  assert.equal(toolErrorLine("estimate-llm-cost", "internal"), '{"event":"tool_error","tool":"estimate-llm-cost","category":"internal"}');
  assert.deepEqual(JSON.parse(toolErrorLine("compare-llm-models", "input-validation", { arguments: ["limit"], issues: ["too_small"] })), {
    event: "tool_error", tool: "compare-llm-models", category: "input-validation", arguments: ["limit"], issues: ["too_small"],
  });
});

test("an error the SDK built is told apart from one a handler returned", () => {
  // The answer its output schema refused: a defect here, and logged nowhere else.
  assert.equal(sdkErrorCategory("MCP error -32602: Output validation error: Invalid structured content for tool x: …"), "output-validation");
  // Already logged by the argument reader, with the argument's name.
  assert.equal(sdkErrorCategory("MCP error -32602: Input validation error: Invalid arguments for tool x: …"), null);
  assert.equal(sdkErrorCategory("MCP error -32602: Tool no-such-tool not found"), null);
  assert.equal(sdkErrorCategory("MCP error -32603: something else"), "protocol");
  // A handler's own refusal is logged where it is built.
  assert.equal(sdkErrorCategory("Give instanceType or hourlyRate, not both."), null);
});
