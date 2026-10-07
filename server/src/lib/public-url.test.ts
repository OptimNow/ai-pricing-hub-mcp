import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_MCP_URL, UI_DOMAIN, uiDomainFor, pinPublicUrl, FORWARDED_URL_HEADER } from "./public-url.js";

/**
 * The connector URL is chosen once: the widget sandbox domain is a hash of it,
 * and every document, the registry entry and the Claude directory listing
 * carry a copy. These tests pin the URL and the hash to literal values, so a
 * change anywhere shows up as a failing test rather than as a blank widget
 * frame that only a claude.ai render test would reveal.
 */

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");

test("the public URL is the canonical form, byte for byte", () => {
  // The literal is the point: the test must break when the constant moves.
  assert.equal(PUBLIC_MCP_URL, "https://optimtoken-mcp.optimnow.io/mcp");
  const url = new URL(PUBLIC_MCP_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/mcp", "Skybridge mounts the transport at /mcp and nothing configures it");
  assert.ok(!PUBLIC_MCP_URL.endsWith("/"), "Skybridge strips a trailing slash before hashing; keep the canonical form slash-free so the docs and the hash agree");
  assert.equal(url.search, "");
});

test("the sandbox domain is pinned to the literal hash of the canonical URL", () => {
  // sha256("https://optimtoken-mcp.optimnow.io/mcp")[:32], computed
  // independently with node:crypto on 2026-10-01 and reproduced by Skybridge
  // 0.35.21 when the built server was called with that URL in the header.
  assert.equal(UI_DOMAIN, "6bc975b213d359f660adf536cb8cebab.claudemcpcontent.com");
  assert.equal(uiDomainFor(PUBLIC_MCP_URL), UI_DOMAIN);
});

test("the hash function agrees with the sibling connector's pinned value", () => {
  // cloud-finops-skills/mcp_server/tests/test_ui.py pins this for
  // https://mcp.optimnow.io/mcp. Same algorithm, independent implementation.
  assert.equal(uiDomainFor("https://mcp.optimnow.io/mcp"), "5164c823f8a966e5cb0f8571d5141bd9.claudemcpcontent.com");
});

test("pinPublicUrl stamps the canonical URL over whatever the client sent, in both header views", () => {
  const req = {
    headers: { host: "optimtoken-mcp.fly.dev", [FORWARDED_URL_HEADER]: "https://evil.example/mcp" },
    // Node keeps the wire form too, case preserved; the SDK reads this one.
    rawHeaders: ["Host", "optimtoken-mcp.fly.dev", "X-Alpic-Forwarded-Url", "https://evil.example/mcp", "Accept", "*/*"],
  };
  let calls = 0;
  pinPublicUrl(req, undefined, () => { calls += 1; });
  assert.equal(req.headers[FORWARDED_URL_HEADER], PUBLIC_MCP_URL);
  assert.deepEqual(req.rawHeaders, ["Host", "optimtoken-mcp.fly.dev", "Accept", "*/*", FORWARDED_URL_HEADER, PUBLIC_MCP_URL],
    "the client's copy is gone from the raw list and exactly one pinned copy is present");
  assert.equal(calls, 1, "the middleware must hand the request on exactly once");
});

test("pinPublicUrl adds the header when the client sent none", () => {
  const req: { headers: Record<string, string | undefined>; rawHeaders: string[] } = {
    headers: { host: "localhost:3000" },
    rawHeaders: ["Host", "localhost:3000"],
  };
  pinPublicUrl(req, undefined, () => {});
  assert.equal(req.headers[FORWARDED_URL_HEADER], PUBLIC_MCP_URL);
  assert.deepEqual(req.rawHeaders, ["Host", "localhost:3000", FORWARDED_URL_HEADER, PUBLIC_MCP_URL]);
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
