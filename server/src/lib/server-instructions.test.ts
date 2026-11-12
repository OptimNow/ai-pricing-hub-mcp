import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_MAX_LENGTH } from "./server-instructions.js";

/**
 * The instructions are prose a model reads once per connection. Nothing at
 * runtime checks them against the tools, so these tests hold the three ways
 * they can go wrong in silence: cut by a host, never sent, or quoting a label
 * no text prints any more.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const index = read("../index.ts");

test("the instructions fit this server's budget", () => {
  assert.ok(SERVER_INSTRUCTIONS.trim().length > 0);
  assert.ok(
    SERVER_INSTRUCTIONS.length <= SERVER_INSTRUCTIONS_MAX_LENGTH,
    `${SERVER_INSTRUCTIONS.length} characters, the budget is ${SERVER_INSTRUCTIONS_MAX_LENGTH}`,
  );
});

test("the server sends them when a client connects", () => {
  // index.ts listens on import, so it is read as source, like the other
  // source-level guards. scripts/check-connector.mjs asks a running server.
  assert.match(index, /instructions: SERVER_INSTRUCTIONS\b/);
});

test("they name no tool, so a new tool cannot make them stale", () => {
  const names = [...index.matchAll(/^tool\(\r?\n\s*"([a-z-]+)"/gm)].map((match) => match[1]);
  assert.ok(names.length >= 8, `found ${names.length} tool declarations`);
  for (const name of names) assert.ok(!SERVER_INSTRUCTIONS.includes(name), name);
});

test("every label they quote is one a text prints", () => {
  const quoted = SERVER_INSTRUCTIONS.match(/\[[a-z ]+\]/g) ?? [];
  assert.deepEqual(quoted, ["[promotional price]", "[outlier listing]", "[quoted host changed]"]);
  const texts = index + read("./price-changes.ts");
  for (const label of quoted) assert.ok(texts.includes(` ${label}`), label);
  // The compute tag is a bare word inside a rate's parentheses.
  assert.match(SERVER_INSTRUCTIONS, /`static` on a compute rate/);
  assert.match(read("./compute-rates.ts"), /notes\.push\("static"\)/);
});
