import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_MCP_URL } from "./lib/public-url.js";

/**
 * docs/claude-directory-listing.md holds the texts pasted into Anthropic's
 * developer portal. The portal refuses a field over its limit, Anthropic cannot
 * edit the description afterwards, and the example prompts are what a reviewer
 * runs. Nothing else reads that file, so its limits and its link to the tools
 * the server declares are held here.
 */
const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const listing = repoFile("docs/claude-directory-listing.md");

/** The fenced text under a heading: what is pasted, without the notes around it. */
const pasted = (heading: string): string => {
  const at = listing.indexOf(`\n${heading}\n`);
  assert.ok(at >= 0, `the listing has no "${heading}" section`);
  const open = listing.indexOf("```text\n", at);
  assert.ok(open >= 0, `"${heading}" has no text block`);
  const start = open + "```text\n".length;
  const end = listing.indexOf("\n```", start);
  assert.ok(end > start, `"${heading}" has an empty or unclosed text block`);
  return listing.slice(start, end);
};

/** The tools the server declares, read from the source: tool(\n  "name", */
const declaredTools = [...repoFile("server/src/index.ts").matchAll(/^tool\(\n {2}"([a-z-]+)",/gm)].map((m) => m[1]);

test("the listing texts fit the portal's limits", () => {
  // Limits of the Listing step, as Anthropic's submission page gave them on 2026-11-12.
  for (const [heading, limit] of [
    ["### Name", 100],
    ["### One-liner", 200],
    ["### Description", 2000],
  ] as const) {
    const text = pasted(heading);
    assert.ok(text.length > 0 && text.length <= limit, `${heading}: ${text.length} characters, limit ${limit}`);
  }
  assert.match(pasted("### URL slug"), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("the description says how many tools there are, and which host they call", () => {
  const description = pasted("### Description");
  assert.equal(declaredTools.length, 8, "the count below is written against eight tools");
  // A ninth tool makes "8 read-only tools" false in a text Anthropic cannot edit.
  assert.ok(description.includes(`${declaredTools.length} read-only tools`));
  assert.ok(description.includes("optimtoken.optimnow.io"));
  // The directory terms forbid implying an endorsement.
  assert.doesNotMatch(description, /anthropic|official|endorsed|certified|partner/i);
});

test("every tool has one example prompt and one test call, and no other tool is named", () => {
  const useCases = listing.slice(listing.indexOf("\n## Step 4. Use cases\n"), listing.indexOf("\n## Step 5. Company\n"));
  const promptRows = useCases.split("\n").filter((line) => /^\| \d+ \|/.test(line));
  const prompted = promptRows.map((row) => /`([a-z-]+)` \|$/.exec(row)?.[1]);
  assert.deepEqual([...prompted].sort(), [...declaredTools].sort());
  for (const row of promptRows) {
    const prompt = row.split("|")[3]?.trim() ?? "";
    assert.ok(prompt.length >= 20 && /[.?]$/.test(prompt), `not a full sentence: ${prompt}`);
  }

  const calls = pasted("## Step 8. Test & launch")
    .split("\n")
    .map((line) => /^(\d+)\. ([a-z-]+) (\{.*\})$/.exec(line))
    .filter((match) => match !== null);
  assert.deepEqual(calls.map((call) => call[2]).sort(), [...declaredTools].sort());
  for (const call of calls) {
    // The arguments are pasted as JSON a reviewer can copy.
    assert.doesNotThrow(() => JSON.parse(call[3] ?? ""), `call ${call[1]}`);
    // A prompt and its call carry the same number, so a reviewer can pair them.
    const row = promptRows.find((line) => line.startsWith(`| ${call[1]} |`));
    assert.ok(row?.includes(`\`${call[2]}\``), `call ${call[1]} (${call[2]}) and prompt ${call[1]} name different tools`);
  }
});

test("the listing gives the URL the server is published at", () => {
  assert.ok(listing.includes(`\n${PUBLIC_MCP_URL}\n`), "the Connection step");
  assert.ok(pasted("## Step 8. Test & launch").includes(PUBLIC_MCP_URL), "the Test & launch text");
  assert.ok(!listing.includes("fly.dev") && !listing.includes("alpic.live"));
});
