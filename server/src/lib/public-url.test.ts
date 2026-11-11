import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_MCP_URL } from "./public-url.js";
import { MCP_PATH } from "./http.js";

/**
 * The connector URL is chosen once, and every document, the registry entry and
 * the Claude directory listing carry a copy. These tests pin the URL to its
 * literal value and hold every copy in the repository to it, so a change
 * anywhere shows up as a failing test rather than as a user pasting a URL that
 * no longer answers.
 */

// Line endings are normalised: a Windows checkout with core.autocrlf holds these
// files as CRLF, and the checks below look for "\n" around the URL. The test
// is about the URL, so it must not fail on the checkout's line endings.
const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("the public URL is the canonical form, byte for byte", () => {
  // The literal is the point: the test must break when the constant moves.
  assert.equal(PUBLIC_MCP_URL, "https://optimtoken-mcp.optimnow.io/mcp");
  const url = new URL(PUBLIC_MCP_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, MCP_PATH, "the published path is the one the server answers on");
  assert.ok(!PUBLIC_MCP_URL.endsWith("/"), "published without a trailing slash, the form every document uses");
  assert.equal(url.search, "");
});

test("every published copy of the URL matches the constant", () => {
  const readme = repoFile("README.md");
  assert.ok(readme.includes(`\n${PUBLIC_MCP_URL}\n`), "README connect block");
  assert.ok(readme.includes(`claude mcp add --transport http optimtoken ${PUBLIC_MCP_URL}`), "README Claude Code command");

  const serverJson = JSON.parse(repoFile("server.json")) as { remotes: { type: string; url: string }[] };
  assert.equal(serverJson.remotes.length, 1);
  assert.equal(serverJson.remotes[0]?.type, "streamable-http");
  assert.equal(serverJson.remotes[0]?.url, PUBLIC_MCP_URL, "server.json remotes (republished to the MCP Registry)");

  assert.ok(repoFile("CLAUDE.md").includes(`**Deployed:** ${PUBLIC_MCP_URL}`), "CLAUDE.md Deployed line");
  assert.ok(repoFile("fly.toml").includes(PUBLIC_MCP_URL), "fly.toml comment");

  // The retired hosts must not survive where a reader would copy a URL from.
  // CLAUDE.md and docs/ may name them as history; the connect surfaces may not.
  for (const file of ["README.md", "server.json", "fly.toml"]) {
    const text = repoFile(file);
    assert.ok(!text.includes("alpic.live"), `${file} still names the retired Alpic host`);
    assert.ok(!text.includes("ai-pricing-hub-mcp.fly.dev/mcp"), `${file} still publishes the fly.dev form of the URL`);
  }
});
