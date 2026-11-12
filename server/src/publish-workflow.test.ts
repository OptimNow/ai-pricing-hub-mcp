import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * .github/workflows/publish-registry.yml publishes server.json to the MCP
 * registry, where a published version can never be edited. ci.yml calls it
 * after each deploy, and it can be started by hand. Nothing exercises it before
 * a merge, so what makes it safe is held here, as text: what may start it, that
 * it stores no secret, that only its own job holds the registry credential,
 * and that it publishes only after it has checked the registry and the live
 * server and verified the CLI it downloads.
 */
const workflowFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), "utf8")
    .split(/\r?\n/)
    // The files explain themselves at length, and their comments name what they must not do.
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const workflow = workflowFile("publish-registry.yml");
const ci = workflowFile("ci.yml");

const position = (needle: string) => {
  const at = workflow.indexOf(needle);
  assert.ok(at >= 0, `the workflow no longer contains: ${needle}`);
  return at;
};

/** The body of one job of ci.yml: its lines, indented under the job's name. */
const ciJob = (name: string) => {
  const body = new RegExp(`^  ${name}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(`${ci}\n`)?.[1];
  assert.ok(body, `ci.yml has no ${name} job`);
  return body;
};

test("the registry publish starts from a deploy or by hand, and from nothing else", () => {
  const triggers = /^on:\n((?: .*\n|\n)+)/m.exec(workflow)?.[1] ?? "";
  const names = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
  // A push, pull_request or schedule trigger here would publish without a deploy before it.
  assert.deepEqual(names, ["workflow_dispatch", "workflow_call"]);

  // Its one caller is the job of ci.yml that waits for the deploy.
  const callers = [...ci.matchAll(/uses: \.\/\.github\/workflows\/publish-registry\.yml/g)];
  assert.equal(callers.length, 1);
  const job = ciJob("publish-registry");
  assert.match(job, /^ {4}needs: deploy$/m);
  assert.match(job, /^ {4}uses: \.\/\.github\/workflows\/publish-registry\.yml$/m);
  assert.match(job, /^ {6}after_deploy: true$/m);
});

test("the registry credential is one job's, and no secret is stored", () => {
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /^ {2}id-token: write/m);
  assert.match(workflow, /^ {2}contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  position("./mcp-publisher login github-oidc");

  // In ci.yml the token is granted to the publish job and to nothing else:
  // `check` installs and runs a pull request's code.
  assert.equal([...ci.matchAll(/id-token/g)].length, 1);
  assert.match(ciJob("publish-registry"), /^ {6}id-token: write$/m);
  assert.doesNotMatch(ciJob("check"), /id-token|permissions:/);
});

test("the registry CLI is a pinned release, verified before it runs", () => {
  assert.match(workflow, /MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+$/m);
  assert.doesNotMatch(workflow, /releases\/latest/);
  // An action from outside GitHub's own is pinned to a commit, not a tag.
  assert.match(workflow, /uses: sigstore\/cosign-installer@[0-9a-f]{40}\b/);
  assert.ok(position("cosign verify-blob") < position("./mcp-publisher validate"));
});

test("nothing is published before the registry and the live server have been asked", () => {
  const publish = position("run: ./mcp-publisher publish");
  assert.ok(position("Ask the registry whether it holds this version") < publish);
  assert.ok(position("Refuse a version the live server does not announce") < publish);
  assert.ok(position("./mcp-publisher validate") < publish);
  assert.ok(publish < position("Confirm what the registry holds"));

  // Every step from the live-server check on runs only when the registry said
  // it does not hold the version: a version it holds, or a registry that did
  // not answer, reaches neither the login nor the publish.
  const steps = workflow.slice(position("Refuse a version the live server does not announce")).split(/\n {6}- /);
  assert.ok(steps.length >= 7, `${steps.length} steps`);
  for (const step of steps) {
    assert.match(step, /if: steps\.registry\.outputs\.state == 'publish'/, step.split("\n")[0]);
  }
});

test("after a deploy, a registry that does not answer is a warning and not a failure", () => {
  assert.match(workflow, /AFTER_DEPLOY: \$\{\{ inputs\.after_deploy \}\}/);
  const unreadable = workflow.slice(position('if [ "$AFTER_DEPLOY" = "true" ]; then'), position('echo "state=$state"'));
  assert.ok(unreadable.indexOf("::warning") < unreadable.indexOf("else"), "the deploy path warns");
  assert.ok(unreadable.indexOf("exit 1") > unreadable.indexOf("else"), "the run by hand fails");
});

/**
 * The github-release job of ci.yml creates the tag v<version> and its GitHub
 * release after a deploy. It holds the one token of this workflow that can
 * write to the repository, so what bounds it is held here too.
 */
test("the GitHub release follows the deploy, and only its job can write to the repository", () => {
  const job = ciJob("github-release");
  assert.match(job, /^ {4}needs: deploy$/m);
  assert.match(job, /^ {6}contents: write/m);
  assert.equal([...ci.matchAll(/contents: write/g)].length, 1, "no other job of ci.yml can write");
  assert.match(job, /persist-credentials: false/);
  // It runs git, gh, jq and curl, and nothing the repository ships.
  assert.doesNotMatch(job, /\bnpm\b|\bnode\b|\bnpx\b/);
});

test("a release is created only for a version GitHub has no release of", () => {
  const job = ciJob("github-release");
  const create = job.indexOf("gh release create");
  assert.ok(create > 0, "the job no longer creates a release");
  // The one release is asked for first; found, or not readable, ends the step before the create.
  const asked = job.indexOf("/releases/tags/$tag");
  assert.ok(asked > 0 && asked < create);
  const before = job.slice(asked, create);
  assert.match(before, /200\)[\s\S]*?exit 0/);
  assert.match(before, /\*\)[\s\S]*?::warning[\s\S]*?exit 0/);
  // The tag is put on the commit that set the version, read from the history.
  assert.match(job, /fetch-depth: 0/);
  assert.match(job, /--target "\$target"/);
});

test("a request that is retried never writes to /dev/null", () => {
  // With --retry and --output /dev/null, curl 8.5 exits 23 at its first retry:
  // the retry never happens and a passing 502 reads as no answer at all.
  for (const [name, text] of [["publish-registry.yml", workflow], ["ci.yml", ci]] as const) {
    for (const command of text.split(/\n(?=\s*(?:[a-z_]+=\$\()?curl )/)) {
      const call = command.split(/\n\s*\n/)[0] ?? "";
      if (call.includes("--retry")) assert.doesNotMatch(call, /\/dev\/null/, `${name}: ${call.slice(0, 80)}`);
    }
  }
});
