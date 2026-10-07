import { createHash } from "node:crypto";

/**
 * The one public URL of this server, and the widget sandbox domain derived
 * from it.
 *
 * claude.ai renders a widget only when the resource's `_meta.ui.domain` equals
 * sha256(<connector URL exactly as the user pasted it>)[:32] +
 * ".claudemcpcontent.com". Skybridge 0.35.21 computes that hash per request
 * (node_modules/skybridge/dist/server/server.js, registerWidgetResource): from
 * the `x-alpic-forwarded-url` header when present, else from the forwarded or
 * Host header plus the request path. Alpic's ingress injected that header.
 * Fly's proxy does not, so without help the hash would follow whichever
 * hostname the request came in on: right on the custom domain, wrong on the
 * deprecated *.fly.dev host, and anchored to no constant anywhere.
 *
 * `pinPublicUrl` sets the header itself, from this constant, before Skybridge
 * sees the request. The hash is then a function of one string, and the test
 * beside this file pins both the string and the hash to their literal values.
 *
 * Change this and move every copy together: README.md ("Connect in 30
 * seconds"), server.json `remotes`, CLAUDE.md ("Deployed:"), docs/*.md, the
 * fly.toml comment, and the literals in public-url.test.ts (which fails until
 * they all agree). Outside the repo: the DNS CNAME, the Fly certificate, the
 * MCP Registry entry and the Claude directory listing follow it.
 */
export const PUBLIC_MCP_URL = "https://optimtoken-mcp.optimnow.io/mcp";

/** The sandbox domain claude.ai expects for a connector pasted as `url`. */
export function uiDomainFor(url: string): string {
  return `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.claudemcpcontent.com`;
}

/** What every `ui://widgets/ext-apps/*` resource must carry in `_meta.ui.domain`. */
export const UI_DOMAIN = uiDomainFor(PUBLIC_MCP_URL);

/**
 * The header Skybridge 0.35.21 prefers when hashing the connector URL. It is
 * Alpic's name for it, but Skybridge reads it on every host.
 */
export const FORWARDED_URL_HEADER = "x-alpic-forwarded-url";

/** The subset of a Node `IncomingMessage` this middleware touches. Typed
 *  structurally because express ships no types of its own and this project
 *  does not install @types/express. */
interface IncomingRequest {
  /** Parsed, lower-cased, what Express handlers read. */
  headers: Record<string, string | string[] | undefined>;
  /** The wire form, [name, value, name, value, ...], case preserved. */
  rawHeaders: string[];
}

/**
 * Express middleware: make every request look as if it arrived at
 * `PUBLIC_MCP_URL`, whatever the Host header says.
 *
 * Registered with `server.use("/mcp", pinPublicUrl)` in index.ts, which
 * Skybridge mounts ahead of the MCP transport. It overwrites any value the
 * client sent: the header is an internal hint, not something a caller should
 * be able to steer the sandbox domain with.
 *
 * Both header views are written. The MCP SDK (1.30) wraps the Node request
 * through @hono/node-server, which rebuilds the web-standard `Request` from
 * `rawHeaders`, so a change to `req.headers` alone never reaches Skybridge:
 * that was observed on the first container run, where the hash still followed
 * the Host header. Existing copies of the header are removed from the raw list
 * first so a client-sent value cannot survive beside the pinned one.
 */
export function pinPublicUrl(req: IncomingRequest, _res: unknown, next: (error?: unknown) => void): void {
  req.headers[FORWARDED_URL_HEADER] = PUBLIC_MCP_URL;
  const raw = req.rawHeaders;
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    if (raw[i]?.toLowerCase() === FORWARDED_URL_HEADER) raw.splice(i, 2);
  }
  raw.push(FORWARDED_URL_HEADER, PUBLIC_MCP_URL);
  next();
}
