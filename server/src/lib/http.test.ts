import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHttpServer, HEALTH_PATH, MAX_BODY_BYTES, MCP_PATH } from "./http.js";
import type { ToolCallHooks } from "./http.js";

/**
 * The HTTP layer, exercised over a real socket against a real MCP server.
 *
 * The test that matters most is the concurrent one. The server this replaced
 * connected one shared MCP server to a new transport on every request, and the
 * SDK refuses a second connection on a connected server: in production, eight
 * tool calls arriving behind one slow upstream fetch were answered with seven
 * HTTP 500s. Nothing in the old test suite could have seen it, because nothing
 * sent two requests at once.
 */

/** A server whose one tool takes long enough for concurrent calls to overlap. */
function slowServerFactory(delayMs: number) {
  let built = 0;
  const create = () => {
    built += 1;
    const server = new McpServer({ name: "test", version: "0.0.0" });
    server.registerTool(
      "slow-echo",
      { description: "Echo after a delay.", inputSchema: { value: z.number() } },
      async ({ value }) => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return { content: [{ type: "text" as const, text: `echo ${value}` }] };
      },
    );
    return server;
  };
  return { create, built: () => built };
}

async function listen(create: () => McpServer, hooks?: ToolCallHooks) {
  const server = createHttpServer(create, hooks);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** The transport may answer as plain JSON or as one SSE event; read either. */
async function rpcBody(response: Response): Promise<{ result?: any; error?: any; id?: unknown }> {
  const raw = await response.text();
  const event = raw.split("\n").find(line => line.startsWith("data: "));
  return JSON.parse(event ? event.slice(6) : raw);
}

/** A refusal from the HTTP layer itself, parsed with the shape it documents. */
const refusal = async (response: Response) =>
  (await response.json()) as { error?: { code?: number } & string };

const call = (url: string, id: number, value: number) =>
  fetch(url, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow-echo", arguments: { value } } }),
  });

test("concurrent tool calls all succeed, each on its own MCP server", async (t) => {
  const factory = slowServerFactory(120);
  const app = await listen(factory.create);
  t.after(app.close);

  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => call(app.url(MCP_PATH), i + 1, i)));
  assert.deepEqual(responses.map(r => r.status), Array(8).fill(200), "no request may fail because another is in flight");

  const bodies = await Promise.all(responses.map(rpcBody));
  bodies.forEach((body, i) => {
    assert.equal(body.id, i + 1, "each response answers its own request");
    assert.equal(body.result?.content?.[0]?.text, `echo ${i}`);
  });
  assert.equal(factory.built(), 8, "one MCP server per request: a shared one cannot be connected twice");
});

test("initialize answers with the server's identity", async (t) => {
  const app = await listen(slowServerFactory(0).create);
  t.after(app.close);

  const response = await fetch(app.url(MCP_PATH), {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await rpcBody(response)).result?.serverInfo, { name: "test", version: "0.0.0" });
});

test("the endpoint is accepted with a trailing slash", async (t) => {
  // Users paste URLs. While the widgets existed the exact form mattered; it no
  // longer does, so the server should not be the one to insist.
  const app = await listen(slowServerFactory(0).create);
  t.after(app.close);
  const response = await call(app.url(`${MCP_PATH}/`), 1, 7);
  assert.equal(response.status, 200);
  assert.equal((await rpcBody(response)).result?.content?.[0]?.text, "echo 7");
});

test("GET and DELETE on the endpoint are refused as the transport specifies", async (t) => {
  // Stateless: there is no SSE stream to open and no session to end.
  const app = await listen(slowServerFactory(0).create);
  t.after(app.close);
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(app.url(MCP_PATH), { method, headers: { accept: "text/event-stream" } });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal((await refusal(response)).error?.code, -32000);
  }
});

test("the health check answers without touching MCP", async (t) => {
  const factory = slowServerFactory(0);
  const app = await listen(factory.create);
  t.after(app.close);
  const response = await fetch(app.url(HEALTH_PATH));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(factory.built(), 0, "a liveness probe must not build an MCP server");
});

test("any other path is a 404 that names the endpoint", async (t) => {
  const app = await listen(slowServerFactory(0).create);
  t.after(app.close);
  for (const path of ["/", "/favicon.ico", "/mcpx", "/assets/app.js"]) {
    const response = await fetch(app.url(path));
    assert.equal(response.status, 404, path);
    assert.match(String((await refusal(response)).error), /\/mcp/);
  }
});

test("a body that is not JSON is a parse error, not a crash", async (t) => {
  const factory = slowServerFactory(0);
  const app = await listen(factory.create);
  t.after(app.close);
  const response = await fetch(app.url(MCP_PATH), { method: "POST", headers: MCP_HEADERS, body: "{not json" });
  assert.equal(response.status, 400);
  assert.equal((await refusal(response)).error?.code, -32700);
  assert.equal(factory.built(), 0);
});

test("an oversized body is refused before any work is done", async (t) => {
  const factory = slowServerFactory(0);
  const app = await listen(factory.create);
  t.after(app.close);
  const response = await fetch(app.url(MCP_PATH), {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ padding: "x".repeat(MAX_BODY_BYTES + 1) }),
  });
  assert.equal(response.status, 413);
  assert.equal(factory.built(), 0);
});

// ── Around a tool call ──────────────────────────────────────────────

/** A server whose tools say what reached them, and one whose answer its own
 *  output schema refuses. */
function probeServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool(
    "double",
    { description: "Twice a number.", inputSchema: { value: z.number() } },
    async ({ value }, extra) => ({
      content: [{ type: "text" as const, text: `${value * 2} ${JSON.stringify(extra._meta ?? {})}` }],
    }),
  );
  server.registerTool(
    "broken",
    { description: "An answer its schema refuses.", inputSchema: {}, outputSchema: { n: z.number() } },
    async () => ({ content: [{ type: "text" as const, text: "n" }], structuredContent: { n: "not a number" } }),
  );
  return server;
}

const callTool = (url: string, name: string, args: unknown, meta?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }),
  }).then(rpcBody);

test("a tool call's arguments are read before the SDK validates them", async (t) => {
  const seen: [string, unknown][] = [];
  const app = await listen(probeServer, {
    readArguments: (tool, args) => {
      seen.push([tool, args]);
      const value = (args as { value?: unknown }).value;
      return { arguments: { value: typeof value === "string" ? Number(value) : value }, meta: { "test/read": ["by the hook"] } };
    },
  });
  t.after(app.close);

  // A number sent as text: the schema would refuse it, the reading comes first.
  const read = await callTool(app.url(MCP_PATH), "double", { value: "21" }, { "test/read": "sent by the client", other: 1 });
  assert.equal(read.result?.isError, undefined);
  // What the hook adds to `_meta` reaches the handler, over the client's own value under that key.
  assert.equal(read.result?.content?.[0]?.text, '42 {"test/read":["by the hook"],"other":1}');
  assert.deepEqual(seen, [["double", { value: "21" }]]);

  // What the reading leaves unreadable is still the schema's to refuse.
  const refused = await callTool(app.url(MCP_PATH), "double", { value: "many" });
  assert.equal(refused.result?.isError, true);
  assert.match(refused.result?.content?.[0]?.text, /Input validation error/);

  // Only tools/call is read: initialize passes as it came.
  const before = seen.length;
  await fetch(app.url(MCP_PATH), {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }).then(rpcBody);
  assert.equal(seen.length, before);
});

test("a reading that throws changes nothing: the call goes on as it was sent", async (t) => {
  const app = await listen(probeServer, {
    readArguments: () => {
      throw new Error("the reader is broken");
    },
  });
  t.after(app.close);
  const answer = await callTool(app.url(MCP_PATH), "double", { value: 4 });
  assert.equal(answer.result?.content?.[0]?.text, "8 {}");
});

test("every tool call answered with an error is reported, the SDK's own included", async (t) => {
  const reported: [string, string][] = [];
  const app = await listen(probeServer, { onToolError: (tool, text) => reported.push([tool, text]) });
  t.after(app.close);

  // An answer its output schema refuses: no handler sees this error, and
  // before 0.15.0 nothing recorded it.
  const broken = await callTool(app.url(MCP_PATH), "broken", {});
  assert.equal(broken.result?.isError, true);
  await callTool(app.url(MCP_PATH), "double", { value: "x" });
  await callTool(app.url(MCP_PATH), "double", { value: 1 });
  await callTool(app.url(MCP_PATH), "absent", {});

  assert.deepEqual(reported.map(([tool]) => tool), ["broken", "double", "absent"]);
  assert.match(reported[0][1], /^MCP error -32602: Output validation error/);
  assert.match(reported[1][1], /^MCP error -32602: Input validation error/);
  assert.match(reported[2][1], /not found/);
});
