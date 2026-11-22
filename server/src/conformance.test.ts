import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SERVER_INSTRUCTIONS } from "./lib/server-instructions.js";

/**
 * The connector's model-facing text describes; it does not order the model.
 *
 * The Claude directory review of 2026-11-06 asked the Cloud FinOps connector
 * (OptimNow/cloud-finops-skills) to remove from its tool descriptions, its
 * server instructions and its response payloads every sentence that told
 * Claude how to behave beyond the tool's function ("ALWAYS call this", "FIRST
 * anyway", "say which day it is from"), and its portal acknowledgement reads
 * "Tool descriptions contain no instructions about model behavior, other
 * tools, or external instruction sources". That connector pins the rule in
 * `mcp_server/tests/test_conformance.py`; this is the same test, read from the
 * source because importing index.ts starts the server.
 *
 * ONE EXCEPTION, MEASURED. The sentence that names the source to cite, once in
 * the server instructions and once at the end of every answer. Probe cycle c4
 * (2026-11-22, the battery's README): worded as a statement or as a citation
 * label, the source was named in 2 to 4 answers of 9 as claude.ai reads them
 * and 1 to 4 of 6 as Claude Code reads them; as an order, 9 of 9 and 6 of 6.
 * The exception is listed below, word for word, and may not grow without this
 * test being edited.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const index = read("./index.ts");
const libFiles = readdirSync(fileURLToPath(new URL("./lib/", import.meta.url)))
  .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map(f => [`lib/${f}`, read(`./lib/${f}`)] as const);

/** The text a run of string literals joined by `+` spells out. */
function joined(run: string): string {
  return [...run.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)]
    .map(m => m[1] ?? m[2] ?? m[3] ?? "")
    .join("");
}
const LITERAL_RUN = String.raw`((?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`" + String.raw`)\s*\+?\s*)+)`;

/** Every tool's title and description, and every parameter's description. */
function definitionTexts(): [string, string][] {
  const out: [string, string][] = [];
  for (const m of index.matchAll(new RegExp(String.raw`\btitle:\s*` + LITERAL_RUN, "g"))) out.push(["title", joined(m[1])]);
  for (const m of index.matchAll(new RegExp(String.raw`\bdescription:\s*` + LITERAL_RUN, "g"))) out.push(["description", joined(m[1])]);
  for (const m of index.matchAll(new RegExp(String.raw`\.describe\(\s*` + LITERAL_RUN + String.raw`\)`, "g"))) out.push(["parameter", joined(m[1])]);
  return out;
}

/** Every string literal outside comments: the fixed parts of what the tools answer. */
function payloadLiterals(): [string, string][] {
  const out: [string, string][] = [];
  for (const [file, source] of [["index.ts", index] as const, ...libFiles]) {
    // Comments are where this repository explains itself; they reach no model.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const text = m[1] ?? m[2] ?? "";
      if (text.length >= 12) out.push([file, text]);
    }
  }
  return out;
}

/** Case-sensitive markers of an order, the forms the Cloud FinOps test refuses. */
const MARKERS = ["ALWAYS", "NEVER", "MUST", "FIRST", "do NOT", "IS the answer"];
/** Phrases the review quoted or that script the reply. Case-insensitive. */
const PHRASES = [
  "outranks", "instinct", "override", "lack account access", "data export",
  "pricing tool", "if one is connected",
  "say so", "say which", "when quoting", "tell the user", "do not supply", "do not quote",
  "your own arithmetic",
];

/** The measured exception, word for word, with the one file each may live in. */
const SOURCE_RULE: [file: string, text: string][] = [
  ["lib/server-instructions.ts", "Name the source in every answer that gives a price"],
  ["lib/citation.ts", "Source to name with any figure quoted from this answer"],
];

test("no title, description or parameter description orders the model", () => {
  const texts = definitionTexts();
  assert.ok(texts.filter(([kind]) => kind === "description").length >= 8, "fewer than eight tool descriptions found");
  for (const [kind, text] of texts) {
    for (const marker of MARKERS) assert.ok(!text.includes(marker), `${kind} contains ${JSON.stringify(marker)}: ${text.slice(0, 120)}`);
    const lower = text.toLowerCase();
    for (const phrase of PHRASES) assert.ok(!lower.includes(phrase), `${kind} contains ${JSON.stringify(phrase)}: ${text.slice(0, 120)}`);
  }
});

/**
 * A clause that opens by telling the model what to do with an answer. The
 * markers and phrases above let three through until 0.14.3: "Read the caveats
 * it returns:" and "Read the flags:" in two descriptions, and "read the ELO
 * beside each row" in a parameter. They are the form the directory review
 * refused ("say which day it is from"), in other words; a review of 0.14.1
 * found the first two on 2026-11-22, and a scan of every clause the third.
 *
 * Not in the list, on purpose: the verbs that say what a tool does, when it
 * applies or what an argument takes ("Compare", "Filter by", "Use it for",
 * "Give this OR hourlyRate, not both", "Leave out for the week's moves"). That
 * is what a description and a parameter description are for.
 */
const ANSWER_ORDERS = [
  "read", "check", "note", "remember", "tell", "say", "quote", "cite", "report", "state", "mention", "repeat",
  "keep", "warn", "explain", "treat", "flag", "show", "look", "see", "consider", "assume", "trust", "verify",
  "confirm", "make sure", "ensure", "do not", "don't", "never", "always", "avoid", "prefer",
];

test("no definition opens a clause by telling the model what to do with an answer", () => {
  const opener = new RegExp(`^(?:${ANSWER_ORDERS.join("|")})\\b`, "i");
  const hits: string[] = [];
  for (const [kind, text] of definitionTexts()) {
    // A clause opens the text, or follows a full stop, a colon or a semicolon.
    for (const clause of text.split(/(?<=[.;:!?])\s+/)) {
      if (opener.test(clause.trim())) hits.push(`${kind}: ${clause.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("no title or description links an optimnow.io address", () => {
  // The source a tool reads is named (OptimToken), as the Cloud FinOps
  // connector names it in get_live_figures; the address is carried by the
  // answers, as data, not by the definitions. A first-party link in a
  // definition can be read as promotion (the review criteria).
  for (const [kind, text] of definitionTexts()) assert.ok(!/optimnow\.io/i.test(text), `${kind}: ${text.slice(0, 120)}`);
});

test("the server instructions order nothing but the measured source rule", () => {
  const lines = SERVER_INSTRUCTIONS.split("\n");
  const rule = lines.filter(line => line.includes(SOURCE_RULE[0][1]));
  assert.equal(rule.length, 1, "the source rule is stated once");
  const rest = lines.filter(line => !line.includes(SOURCE_RULE[0][1])).join("\n");
  for (const marker of MARKERS) assert.ok(!rest.includes(marker), marker);
  for (const phrase of PHRASES) assert.ok(!rest.toLowerCase().includes(phrase), phrase);
  // An imperative opening a sentence: the forms the 0.12.1 wording used.
  assert.doesNotMatch(rest, /(^|[.:]\s+|-\s+)(Do not|Don't|Say|Keep|Give|Ask|Tell|Quote|Cite|Name)\b/m);
  assert.doesNotMatch(rest, /optimnow\.io/);
});

test("no fixed text of an answer scripts the reply, except the measured source line", () => {
  const hits: string[] = [];
  for (const [file, text] of payloadLiterals()) {
    const lower = text.toLowerCase();
    for (const phrase of PHRASES) if (lower.includes(phrase)) hits.push(`${file}: ${JSON.stringify(phrase)} in ${text.slice(0, 100)}`);
    for (const marker of MARKERS) if (text.includes(marker)) hits.push(`${file}: ${JSON.stringify(marker)} in ${text.slice(0, 100)}`);
  }
  assert.deepEqual(hits, []);
});

test("every tool refuses an argument it does not declare, and says it only reads", () => {
  // In tool(), the one place every registration passes through. Measured on
  // 2026-11-22: `model` for `modelName` was stripped and answered as if no
  // model had been named; refused, it is an error that names the key.
  assert.match(index, /z\.strictObject\(config\.inputSchema as ZodRawShapeCompat\)/);
  assert.match(index, /const annotations: ToolAnnotations = \{ title: config\.title, idempotentHint: true, \.\.\.config\.annotations \}/);
  for (const m of index.matchAll(/annotations: \{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /idempotentHint:\s*false|readOnlyHint:\s*false|destructiveHint:\s*true/, m[1]);
  }
});

test("no answer's text links another OptimNow product", () => {
  // The ROI calculator link left the recommend-llm-model text in 0.14.1 (the
  // owner's decision of 2026-11-22). The JSON keeps `roiCalculatorUrl`, a
  // declared field (decision 3d), so the schema is unchanged.
  for (const [file, text] of payloadLiterals()) {
    assert.doesNotMatch(text, /ROI calculator/i, `${file}: ${text.slice(0, 100)}`);
    // The address is built in one file, for the JSON field alone.
    if (file !== "lib/roi-link.ts") assert.doesNotMatch(text, /airoicalculator/i, `${file}: ${text.slice(0, 100)}`);
  }
  assert.doesNotMatch(index, /\$\{roiUrl\}/, "the recommend text prints the ROI link");
  assert.match(index, /^\s+roiCalculatorUrl: z\.string\(\),$/m);
});

test("the source rule is the only exception, and lives where it is measured", () => {
  for (const [file, text] of SOURCE_RULE) {
    const where = [["index.ts", index] as const, ...libFiles].filter(([, source]) => source.includes(text)).map(([name]) => name);
    assert.deepEqual(where, [file], `${JSON.stringify(text)} is in ${where.join(", ") || "no file"}`);
  }
});
