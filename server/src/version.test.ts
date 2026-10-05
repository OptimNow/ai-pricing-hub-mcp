import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The server's version is written in four places: package.json, its lockfile,
 * server.json (what the MCP registry lists) and the version the server announces
 * to a client when it connects (index.ts). Nothing at runtime compares them, so
 * a bump that misses one ships a registry entry and a server that disagree.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("every place that states the version states the same one", () => {
  const pkg = JSON.parse(read("../../package.json")).version;
  const lock = JSON.parse(read("../../package-lock.json"));
  const registry = JSON.parse(read("../../server.json")).version;
  const announced = /\bversion: "([^"]+)"/.exec(read("./index.ts"))?.[1];

  assert.match(pkg, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    { lock: lock.version, lockRoot: lock.packages[""].version, registry, announced },
    { lock: pkg, lockRoot: pkg, registry: pkg, announced: pkg },
  );
});
