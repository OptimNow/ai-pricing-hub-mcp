import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * The HTTP side of the server: Streamable HTTP at /mcp, stateless, and nothing
 * else but a health check.
 *
 * Plain `node:http` and the MCP SDK's own transport, no framework. Until
 * 0.5.0 this was Skybridge, which also served five widget bundles; when the
 * widgets went, the only thing left for it to do was the forty lines below.
 *
 * **One MCP server per request.** The SDK refuses a second `connect()` on a
 * server that is already connected ("Already connected to a transport"), and a
 * stateless transport serves exactly one request. Skybridge 0.35 connected one
 * shared server to a fresh transport on every request, so while one call was in
 * flight every other call was answered HTTP 500 "Internal server error":
 * measured against production on 2026-11-11, eight concurrent tool calls behind
 * one cold upstream fetch gave seven 500s. Assistants issue tool calls in
 * parallel as a matter of course. `createMcpServer` is therefore a factory,
 * called per request, and `http.test.ts` holds it to that.
 */

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";

/** Largest request body read. A tool call here is a few hundred bytes; the cap
 *  is what stops an unauthenticated public endpoint buffering whatever it is
 *  sent. */
export const MAX_BODY_BYTES = 1_000_000;

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** A JSON-RPC error with no request to attach it to, the shape MCP clients
 *  expect on a transport-level refusal. */
function sendRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);
}

type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: number; message: string };

/** Read and parse the request body, refusing one over MAX_BODY_BYTES. */
async function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      return { ok: false, status: 413, code: -32600, message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` };
    }
    chunks.push(buffer);
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, code: -32700, message: "Parse error: the request body is not valid JSON." };
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  createMcpServer: () => McpServer,
): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname === HEALTH_PATH) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." }, { allow: "GET, HEAD" });
      return;
    }
    // Liveness only: the process is up and accepting connections. It says
    // nothing about upstream, which every tool response reports for itself in
    // `provenance`, and a fallback tier is a working answer, not an outage.
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // A trailing slash is accepted. It used to matter (the widget sandbox domain
  // was a hash of the URL exactly as pasted); with no widgets it does not.
  if (pathname !== MCP_PATH && pathname !== `${MCP_PATH}/`) {
    sendJson(res, 404, { error: `Not found. The MCP endpoint is ${MCP_PATH} (Streamable HTTP, POST).` });
    return;
  }

  // Stateless: no SSE stream to open with GET, no session to end with DELETE.
  // 405 is what the Streamable HTTP transport specifies for a server that
  // offers neither.
  if (req.method !== "POST") {
    sendRpcError(res, 405, -32000, "Method not allowed.", { allow: "POST" });
    return;
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendRpcError(res, parsed.status, parsed.code, parsed.message);
    return;
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed.body);
  } catch (error) {
    console.error("[http] error handling an MCP request:", error);
    sendRpcError(res, 500, -32603, "Internal server error.");
  }
}

/**
 * The HTTP server, not yet listening.
 *
 * `createMcpServer` must return a NEW server on every call: see the note at
 * the head of this file.
 */
export function createHttpServer(createMcpServer: () => McpServer): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res, createMcpServer).catch((error: unknown) => {
      console.error("[http] unhandled error:", error);
      sendRpcError(res, 500, -32603, "Internal server error.");
    });
  });
}
