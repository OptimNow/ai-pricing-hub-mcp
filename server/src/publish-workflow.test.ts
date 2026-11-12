import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * .github/workflows/publish-registry.yml publishes server.json to the MCP
 * registry, where a published version can never be edited. Nothing runs that
 * workflow in CI, so what makes it safe is held here, as text: it is started by
 * hand, it stores no secret, and it publishes only after it has checked that
 * the live server announces the version and verified the CLI it downloads.
 */
const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/publish-registry.yml", import.meta.url)),
  "utf8",
)
  .split(/\r?\n/)
  // The file explains itself at length, and its comments name what it must not do.
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const position = (needle: string) => {
  const at = workflow.indexOf(needle);
  assert.ok(at >= 0, `the workflow no longer contains: ${needle}`);
  return at;
};

test("the registry publish is started by hand and by nothing else", () => {
  const triggers = /^on:\n((?: .*\n|\n)+)/m.exec(workflow)?.[1] ?? "";
  const names = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
  // A push or schedule trigger here would publish on every merge, for good.
  assert.deepEqual(names, ["workflow_dispatch"]);
});

test("the registry publish holds no stored credential", () => {
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /^ {2}id-token: write/m);
  assert.match(workflow, /^ {2}contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  position("./mcp-publisher login github-oidc");
});

test("the registry CLI is a pinned release, verified before it runs", () => {
  assert.match(workflow, /MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+$/m);
  assert.doesNotMatch(workflow, /releases\/latest/);
  // An action from outside GitHub's own is pinned to a commit, not a tag.
  assert.match(workflow, /uses: sigstore\/cosign-installer@[0-9a-f]{40}\b/);
  assert.ok(position("cosign verify-blob") < position("./mcp-publisher validate"));
});

test("nothing is published before the live server is seen to announce the version", () => {
  const publish = position("run: ./mcp-publisher publish");
  assert.ok(position("Refuse a version the live server does not announce") < publish);
  assert.ok(position("Stop if the registry already lists this version") < publish);
  assert.ok(position("./mcp-publisher validate") < publish);
  assert.ok(publish < position("Confirm what the registry lists"));
});
