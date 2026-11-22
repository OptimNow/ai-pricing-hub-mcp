import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY_BYTES,
  OPTIMTOKEN_BASE_URL,
  USER_AGENT,
  UpstreamFetchError,
  fetchOptimtokenJson,
} from "./optimtoken-api.js";
import { SERVER_VERSION } from "./version.js";

const realFetch = globalThis.fetch;

type Seen = { url: string; init: RequestInit | undefined };

/** Answer each request with the next response from the list, recording what was asked. */
function stub(...responses: Response[]): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    return next;
  }) as typeof fetch;
  return seen;
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

async function failure(promise: Promise<unknown>): Promise<UpstreamFetchError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof UpstreamFetchError, String(error));
    return error;
  }
  assert.fail("the read did not fail");
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("every request names this server and its release, and handles redirects itself", async () => {
  const seen = stub(json({ ok: true }));
  assert.deepEqual(await fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }), { ok: true });
  const headers = seen[0].init?.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], USER_AGENT);
  assert.match(USER_AGENT, new RegExp(`^ai-pricing-hub-mcp/${SERVER_VERSION.replace(/\./g, "\\.")} `));
  assert.equal(seen[0].init?.redirect, "manual");
});

test("a redirect on the site's own origin is followed", async () => {
  const seen = stub(
    new Response(null, { status: 308, headers: { location: "/api/llm-models/" } }),
    json({ moved: true }),
  );
  assert.deepEqual(await fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }), { moved: true });
  assert.equal(seen[1].url, `${OPTIMTOKEN_BASE_URL}/api/llm-models/`);
});

test("a redirect to another host is a failed read, and that host is never asked", async () => {
  const seen = stub(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/api" } }));
  const error = await failure(fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }));
  assert.equal(error.kind, "redirect");
  assert.match(error.message, /elsewhere\.example/);
  assert.equal(seen.length, 1);
});

test("a redirect loop on the site stops", async () => {
  const loop = () => new Response(null, { status: 307, headers: { location: "/api/llm-models" } });
  stub(loop(), loop(), loop(), loop(), loop());
  const error = await failure(fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }));
  assert.equal(error.kind, "redirect");
  assert.match(error.message, /more than 3 times/);
});

test("a body declared larger than the cap is refused before it is read", async () => {
  stub(new Response("{}", { headers: { "content-length": String(MAX_BODY_BYTES + 1) } }));
  const error = await failure(fetchOptimtokenJson("api/pricing", { timeoutMs: 1_000 }));
  assert.equal(error.kind, "too-large");
});

test("a body that streams past the cap is refused, not cut", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(0x20); // 1 MiB of spaces
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > MAX_BODY_BYTES) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  stub(new Response(stream));
  const error = await failure(fetchOptimtokenJson("api/pricing", { timeoutMs: 5_000 }));
  assert.equal(error.kind, "too-large");
  assert.ok(sent <= MAX_BODY_BYTES + 2 * chunk.byteLength, "reading stopped at the cap");
});

test("a status, a body that is not JSON, and JSON that is not an object keep their kinds", async () => {
  stub(json({}, { status: 503 }));
  assert.equal((await failure(fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }))).kind, "http-status");
  stub(new Response("<!doctype html>"));
  assert.equal((await failure(fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }))).kind, "parse");
  // An array is an object to typeof, and the callers' own guards refuse it. A
  // string is not an object at all.
  stub(json("text"));
  assert.equal((await failure(fetchOptimtokenJson("api/llm-models", { timeoutMs: 1_000 }))).kind, "not-object");
});
