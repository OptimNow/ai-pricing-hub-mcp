import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * What the deploy, rollback and daily checks promise, held where an edit to a
 * workflow would break it. The registry and release rules are in
 * publish-workflow.test.ts.
 */
const dir = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
const read = (name: string) =>
  readFileSync(`${dir}${name}`, "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml"));

test("every action is pinned to a commit, with its release beside it", () => {
  for (const name of workflows) {
    for (const [line] of read(name).matchAll(/^\s*(?:-\s+)?uses:\s*\S+.*$/gm)) {
      if (/uses:\s*\.\//.test(line)) continue; // a workflow of this repository
      assert.match(line, /@[0-9a-f]{40} # \S+/, `${name}: ${line.trim()}`);
    }
  }
});

test("flyctl is one pinned version wherever it deploys", () => {
  const versions = ["ci.yml", "deploy-tag.yml"].map((name) => {
    const text = read(name);
    assert.match(text, /setup-flyctl@[0-9a-f]{40}/, name);
    return /setup-flyctl@[\s\S]*?version:\s*(\d+\.\d+\.\d+)/.exec(text)?.[1];
  });
  assert.ok(versions[0], "ci.yml pins no flyctl version");
  assert.equal(versions[1], versions[0], "deploy-tag.yml and ci.yml deploy with different flyctl versions");
});

test("the build of every pull request is started and called before it can be merged", () => {
  // Until this step nothing ran the server before production: index.ts
  // listens on import, so no test imports it, and the job only compiled it.
  const ci = read("ci.yml");
  const check = ci.slice(ci.indexOf("\n  check:"), ci.indexOf("\n  deploy:"));
  const step = check.slice(check.indexOf("Start the built server and check what it serves"));
  assert.ok(step.length > 0, "the check job no longer starts the server");
  assert.ok(check.indexOf("npm run build") < check.indexOf("Start the built server"), "the server is started before it is built");
  assert.match(step, /node dist\/server\/src\/index\.js/);
  // Waits for the server, and says so when it never comes up.
  assert.match(step, /\/healthz[\s\S]*The built server did not start[\s\S]*exit 1/);
  assert.match(step, /node scripts\/check-connector\.mjs "http:\/\/localhost:\$PORT\/mcp"/);
  // A tool definition that changed shows in the pull request that changes it.
  assert.match(step, /--tools-fingerprint scripts\/tools-fingerprint\.json/);
  // Exit 2 (the site did not answer) is a warning; anything else but 0 fails.
  assert.match(step, /2\) echo "::warning[\s\S]*\*\) exit 1/);
  // The job runs the code of any pull request: no secret, no write permission.
  assert.doesNotMatch(check, /secrets\.|permissions:|id-token|contents: write/);
});

test("only the pull request check holds a server to the pinned tool definitions", () => {
  // deploy-tag.yml puts back tags whose definitions are not this checkout's,
  // and the daily check must not turn red between a merge and its deploy.
  const ci = read("ci.yml");
  const deploy = ci.slice(ci.indexOf("\n  deploy:"));
  for (const text of [deploy, read("deploy-tag.yml"), read("production-check.yml")]) {
    assert.doesNotMatch(text, /--tools-fingerprint/);
  }
});

test("a deploy is checked on what it serves before anything is published", () => {
  const ci = read("ci.yml");
  const deploy = ci.slice(ci.indexOf("\n  deploy:"), ci.indexOf("\n  publish-registry:"));
  assert.match(deploy, /timeout-minutes: \d+/, "the deploy job has no timeout");
  assert.match(deploy, /image_ref\.tag[\s\S]*"\$GITHUB_SHA"/, "the machines' image is not compared with the commit");
  assert.match(deploy, /node scripts\/check-connector\.mjs https:\/\/ai-pricing-hub-mcp\.fly\.dev\/mcp/);
  // Exit 2 (the site not read) is a warning; anything else but 0 fails the job.
  assert.match(deploy, /2\) echo "::warning[\s\S]*\*\) exit 1/);
});

test("a rollback deploys a tag, checks it, and publishes nothing", () => {
  const rollback = read("deploy-tag.yml");
  assert.match(rollback, /group: fly-deploy$/m, "not the deploy lock ci.yml takes");
  assert.match(rollback, /ref: refs\/tags\/\$\{\{ steps\.resolve\.outputs\.tag \}\}/);
  assert.match(rollback, /--image-label "\$SHA"/, "the image is not labelled with the tag's commit");
  assert.match(rollback, /check-connector\.mjs[\s\S]*--expect-version "\$VERSION"/);
  assert.doesNotMatch(rollback, /id-token: write|contents: write|mcp-publisher|gh release/);
  // The tag reaches the shell through the environment only.
  assert.doesNotMatch(rollback, /run:[^\n]*\$\{\{ inputs\.tag \}\}/);
});

test("the daily check opens an issue for a defect, never for an outage of the site", () => {
  const daily = read("production-check.yml");
  assert.match(daily, /cron: "15 6 \* \* \*"/);
  assert.match(daily, /node scripts\/check-connector\.mjs --attempts/);
  const open = daily.slice(daily.indexOf("Open or update the connector-check issue"));
  assert.match(open, /if: steps\.check\.outputs\.exit_code != '0' && steps\.check\.outputs\.exit_code != '2'/);
  assert.match(daily, /Close the issue once the connector passes[\s\S]*?if: steps\.check\.outputs\.exit_code == '0'/);
  assert.match(daily, /^ {2}issues: write$/m);
  assert.doesNotMatch(daily, /contents: write|id-token: write|secrets\./);
});
