# Publishing this server in the ChatGPT directory

Status as of 2026-08-18: **not submitted.** The server is technically ready;
three non-code prerequisites are outstanding.

> **2026-11-11: the server is tools only from 0.5.0.** This page was written
> when every tool rendered a widget, and ChatGPT's directory was being
> approached as an *app*. The widgets and the Skybridge framework are gone, so
> what would be submitted now is a plain MCP server with five read-only tools.
> Whether the plugin portal accepts that, and under which heading, has not been
> re-checked. The passages below that depended on the widgets are marked.
> The Claude directory runbook, `claude-directory-submission.md`, is current.

ChatGPT apps are now submitted and published as *plugins*. You submit the
production MCP server itself, not a manifest. The old `app.json` and its
migration guide described a flow that no longer exists and have been deleted.

## What is already correct

Verified against the live endpoint, so nothing here needs changing:

- (No longer true from 0.5.0: there are no widget resources and no
  `_meta.ui.resourceUri` on the tools.)
- All five tools declare `readOnlyHint`, `destructiveHint` and
  `openWorldHint`. Missing annotations are a common rejection reason.
- Transport is streamable HTTP at a stable public HTTPS URL.
- Test cases are prepared in `chatgpt-app-smoke-tests.md`.

## Blockers to clear first

**1. Domain verification.** The portal requires a token served at
`/.well-known/openai-apps-challenge` on the MCP server's own domain. The server
now answers on a domain we control, `optimtoken-mcp.optimnow.io` (a CNAME to
`ai-pricing-hub-mcp.fly.dev` with a Fly certificate), so the first half of this
blocker is gone. It still returns 404 at that path: the server answers `/mcp`
and `/healthz` only. The token would be one more route in
`server/src/lib/http.ts`, beside the health check. Add it when the portal
issues the token.

**2. Terms of service page.** The portal wants website, support, privacy and
terms URLs. We have the site, `optimtoken.optimnow.io/privacy`, and
`optimnow.io/contact`. `/terms` currently 404s and needs creating.

**3. Developer identity verification.** Individual or business verification in
the OpenAI Platform settings, required before any submission.

## Submission flow

At <https://platform.openai.com/plugins>, with an org role that has
Apps Management write access. Create a plugin, choose "With MCP", then:

1. **Info**: name, descriptions, logo, category, and the four URLs above.
2. **MCP**: choose Universal (one fixed URL for all users), enter the
   production URL, set the UI content security policy domains, confirm domain
   ownership, then run **Scan Tools** to have OpenAI discover the five tools
   and validate their metadata.
3. **Tool annotations**: confirm the three hints per tool. All three are
   `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.
   `compare-compute-pricing` was still declaring `openWorldHint: false` from
   the era when its pricing was a static array; it now fetches
   `optimtoken.optimnow.io/api/pricing`, so the flag was corrected. Incorrect
   action labels are the first rejection reason OpenAI lists.
4. **Prompts**: starter prompts showing realistic workflows.
5. **Testing**: the five positive and three negative cases from
   `chatgpt-app-smoke-tests.md`. No demo account needed, the server is public.
6. **Global**: country availability.
7. **Submit**: release notes and policy attestations.

Review timelines are not guaranteed. After approval you choose when to
publish, and the plugin then appears in the directory for ChatGPT and Codex.

## Latency risk to address before submitting

OpenAI requires low latency and tests "across a wide range of scenarios". A cold
`/api/pricing` measured **50.5 seconds** on 2026-08-17 against a 55s client
budget, because the site assembles a region from six live provider APIs. Warm
hits are 80 to 350 ms, but the edge cache is per-key and per-PoP and this server
carries no steady traffic of its own, so it keeps meeting cold entries.

A reviewer who happens to hit a cold path waits nearly a minute for a compute
comparison. Worth warming the endpoint on a schedule, or accepting the fallback
tier faster for the first call, before putting it in front of a reviewer. The
LLM tools are unaffected: cold `/api/llm-models` is 209 ms.

## Keep in mind

This section used to say the widget resources must stay listed, because the
custom UI was what made the server worth submitting as an app. They were
removed in 0.5.0, deliberately. A ChatGPT submission is now a tools-only
connector or nothing; decide which before spending time on the blockers above.

The latency section above also predates two changes: the site's cold
`/api/pricing` rebuild fell from about 50 s to 6 to 11 s in August 2026 and
measured 9 to 20 s on 2026-11-12, and this server's budget for it is 40 s.
