/**
 * The one public URL of this server.
 *
 * Nothing at runtime reads it: the server answers on whatever host the request
 * arrived at. It is a constant because the URL is published in many places,
 * and the test beside this file fails unless they all carry this exact string.
 *
 * Change this and move every copy together: README.md ("Connect in 30
 * seconds"), server.json `remotes`, CLAUDE.md ("Deployed:"), docs/*.md and the
 * fly.toml comment. Outside the repo: the DNS CNAME, the Fly certificate, the
 * MCP Registry entry, the site's /mcp page and the Claude directory listing
 * follow it.
 *
 * Until 0.5.0 this file also pinned a widget sandbox domain, a hash of the URL
 * that claude.ai compared against the address the user had pasted. That went
 * with the widgets, and with it the rule that the URL be pasted exactly: the
 * server now accepts /mcp with or without a trailing slash, on any hostname
 * that reaches it.
 */
export const PUBLIC_MCP_URL = "https://optimtoken-mcp.optimnow.io/mcp";
