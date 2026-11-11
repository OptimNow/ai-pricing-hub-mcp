# Publishing this server in the Claude connectors directory

Status as of 2026-11-11: **not submitted, and not ready to be.** Version 0.5.0
makes the server tools only (no MCP App, no widgets) and fixes a defect that
would have failed review, but **0.5.0 is not deployed yet**: production still
runs 0.4.2. The portal reads the live server, so deploy first, then work
through "Before you submit" below.

The ChatGPT counterpart is `chatgpt-submission.md`. The two directories ask for
much the same material, so prepare it once.

## Where and who

- **Portal:** <https://claude.ai/directory/manage>, **Submit new**, then
  **MCP connector**. There is no separate "Claude Marketplace" submission.
- **Plan:** any paid plan (Pro, Max, Ultra, Team or Enterprise). On an
  individual plan you submit from your own account; on Team and Enterprise an
  Owner submits. The listing belongs to the account or organisation you submit
  from, so if OptimNow later moves to a Team plan, ask Anthropic whether a
  listing can move with it before resubmitting.
- **Outcome:** every submission is scanned automatically and, by default,
  listed as a **Community** connector. Anthropic may escalate a listing it
  considers useful to a **Verified** review, where a person runs every tool.
  There is no application for Verified; both labels must meet the same
  criteria.
- **Escalation:** `mcp-review@anthropic.com`. Status and reviewer feedback
  appear in the portal.

## What tools-only changes

Up to 0.4.2 this was an MCP App: five widgets, and with them a second set of
requirements. They no longer apply:

| Was required for the MCP App | Now |
|---|---|
| 3 to 5 carousel screenshots, PNG, 1000 px wide | Not asked of a connector without an app |
| Widgets follow Claude's theme through host tokens (a "must" in the design guidelines; ours followed the OS) | No UI to theme |
| No horizontal scroll from 320 px, 44 pt tap targets, WCAG AA | No UI |
| `_meta.ui.domain` equal to a hash of the pasted URL, so the URL had to be pasted exactly | Gone. `/mcp` and `/mcp/` both answer |
| Allowed link URIs for `ui/open-link` | No widget opens a link. The ROI calculator URL is plain text in the answer |

What it costs: the listing has no visual carousel, and an answer is the
assistant's text rather than a card. The figures are the same; each tool still
returns them as `structuredContent` too.

## Before you submit

In this order. The first three are blocking.

1. **Deploy 0.5.0 and run `node scripts/check-connector.mjs`.** It must pass
   against the published URL. Against 0.4.2 it fails on two counts, both of
   which a reviewer would meet:
   - **Concurrent calls fail.** Under 0.4.2, a tool call that overlaps another
     is answered HTTP 500 "Internal server error": eight concurrent calls
     behind one slow upstream fetch gave seven 500s in production on
     2026-11-11. The checklist says "every tool must return a successful
     response when called with valid parameters" and that "generic errors such
     as Internal Server Error ... fail review"; the listing's health badge
     turns Degraded above a 5% error rate. Fixed in 0.5.0 (one MCP server per
     request).
   - The five widget resources are still listed.
2. **Make the documentation and privacy pages readable without a browser.**
   `https://optimtoken.optimnow.io/mcp` and `/privacy` answered HTTP 429 with a
   "Vercel Security Checkpoint" page to every non-browser client tried on
   2026-11-11 (curl, with and without a browser or `Claude-User` user agent).
   They render normally in a browser, and `/api/*`, `/llms.txt` and
   `/openapi.json` are not challenged. Whether Anthropic's automatic scan
   fetches the two URLs is not documented; a reviewer in a browser will see
   them. Exempt the public pages from the challenge in the site's Vercel
   firewall rather than find out.
3. **Update the site's `/mcp` page** (in the site's repository, not this one).
   It still says "the widgets render only for that form" and lists the old
   `estimate-llm-cost` parameters (`cacheHitRate` and `batchEligible` are
   new). The policy asks that documentation "precisely match actual
   functionality". Its registry name is also lower-cased
   (`io.github.optimnow/...`); the registry entry is `io.github.OptimNow/ai-pricing-hub`.
4. **Decide what to do with the OpenRouter fallback.** The checklist says
   "your server must call your own first-party APIs, or APIs you legitimately
   proxy". Tier 1 is our own API. Tier 2 calls `openrouter.ai`'s public model
   list directly when the site is unreachable. Either declare it in the portal's
   data-handling step as a third-party API used only as a fallback, or remove
   tier 2 so the LLM tools fall straight to the embedded snapshot. Removing it
   is the safer answer and also deletes the largest block of ported code.
5. **Run `npm run check-parity`** so the figures the listing will show are the
   site's. See "Keeping in sync" in `DESIGN.md`.

## What is already correct

Checked on 2026-11-11 against the 0.5.0 build running locally, and against the
documentation as it read that day:

| Requirement | Status |
|---|---|
| Remote server, `https://`, Streamable HTTP | `https://optimtoken-mcp.optimnow.io/mcp` on Fly.io |
| `title` plus `readOnlyHint` or `destructiveHint` on every tool | All five carry `title`, `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true` |
| Tool names at most 64 characters | Longest is 27 |
| Descriptions say what the tool does and when to use it, with no instructions to the model | Reworded in October; the routing between the five tools stays |
| Authentication | `none`; allowed for public data, and the portal has a "No authentication" option |
| Validation errors are actionable | A bad `limit` returns `-32602` naming the field; an unknown model name says so |
| Responses reasonably sized | Largest observed about 10,000 tokens (`compare-llm-models` at `limit: 50`), against a ceiling of about 150,000 characters in claude.ai and 25,000 tokens in Claude Code |
| Every response validates against its `outputSchema` | 14 of 14 sampled calls, error paths included |
| Live data | `provenance.tier` is 1 for the LLM tools and for compute |
| Privacy policy | <https://optimtoken.optimnow.io/privacy> names the MCP server, Fly.io and a GDPR contact (see item 2 above) |
| Support contact | <https://www.optimnow.io/contact> |

Open, and not blocking: the compute tool opens every answer with about 1,300
characters of provenance notices whichever providers the result contains. The
policy asks a server to be "frugal with their use of tokens".

## Material to prepare

- **Icon.** The only square asset on the site is `/optimnow-icon.png` at
  96 × 96. Have a larger square PNG ready; the portal does not publish a size,
  so 512 × 512 is safe.
- **Listing copy.** Limits: name up to 100 characters, one-liner up to 200,
  description up to 2,000, one to five categories from the portal's list, and a
  URL slug that is **permanent once published**. Suggested:
  - Name: `OptimToken`
  - Slug: `optimtoken`
  - One-liner: "Live, verified LLM and cloud compute prices: cost per request, monthly budget, and a ranked model pick for your workload."
  - Description: start from the "Why this exists" and "Tools" sections of
    `README.md`. State that it is read-only, needs no account, stores nothing,
    and that every answer carries a `provenance` block saying which source
    served it and whether the prices are vendor-verified. Do not claim or
    imply Anthropic endorsement; the terms forbid it.
- **Example prompts.** The policy asks for at least three that work. Model
  names age: on 2026-11-11 "Gemini 3.1 Pro" resolved to a Preview model with an
  ambiguity note, and GPT-4o is two generations old. Check each still resolves
  cleanly the day you paste it.

  | Tool | Prompt |
  |---|---|
  | `compare-llm-models` | "Show me models under $1 per 1M input tokens with an ELO above 1300." |
  | `recommend-llm-model` | "Recommend a model for support tickets under $500 a month." |
  | `compare-models-side-by-side` | "Compare Claude Opus 5.5 and Gemini 4 Argon side by side." |
  | `estimate-llm-cost` | "About 800 input tokens and 200 output, four million requests a month, 60% of the prompt cached: what does that cost on Claude Opus 5.5?" |
  | `compare-compute-pricing` | "Compare cloud instances in Europe with at least 8 vCPUs and 32 GB of memory, cheapest first." |
- **URLs.** Documentation `https://optimtoken.optimnow.io/mcp`, privacy
  `https://optimtoken.optimnow.io/privacy`, support
  `https://www.optimnow.io/contact`, company `https://optimnow.io`.
- **Smoke tests.** Re-run the cases in `chatgpt-app-smoke-tests.md` against
  the published URL. The portal's Test & launch step asks you to confirm every
  tool was run, through MCP Inspector or as a custom connector.

## The portal, step by step

Progress saves in the browser between steps.

1. **Connection.** Paste `https://optimtoken-mcp.optimnow.io/mcp`, or pick
   the custom connector already on the account. Universal URL: every user
   connects to the same one.
2. **Tools.** Synced from the server. All five should land in the read-only
   group with no "missing title or annotation" flag. If one is flagged, fix
   the server before continuing; the portal reads the live tool list.
3. **Listing.** Name, one-liner, description, categories, documentation URL,
   privacy URL, support contact, icon, slug, from the material above.
4. **Use cases.** Reads data only. No prerequisite: no account, plan or setup.
5. **Company.** OptimNow, `https://optimnow.io`, and the contact that should
   receive review updates.
6. **Authentication.** No authentication.
7. **Data handling.** The API is your own (`optimtoken.optimnow.io`). If tier 2
   is still in the server, declare it: when the site is unreachable, the LLM
   tools fall back to `openrouter.ai`'s public model list, a third-party API
   you do not control, and mark the response unverified. No health data, no
   sponsored content.
8. **Test & launch.** Credentials are a mandatory field. Write that the server
   is public and unauthenticated, no account exists or is needed, and paste
   the prompt table above as the walkthrough. Confirm every tool was run.
9. **Compliance.** Seven acknowledgments: directory guidelines, first-party
   API usage, financial transactions, AI media generation, prompt injection,
   conversation data collection, public documentation. All seven apply
   cleanly to a read-only pricing tool, first-party API usage subject to the
   tier 2 decision.
10. **Review and submit.** Quality warnings such as very short answers are
    shown here and forwarded to the review team.

## After it is listed

- Changes to the live server need no resubmission; the directory reads the
  server. Listing text is edited in the portal, and an edit is re-reviewed.
  The tool names shown on the listing are part of the listing details. The
  slug cannot change.
- The policy asks the developer to tell Anthropic of material changes to
  functionality, descriptions, data practices or connected endpoints.
- The listing is bound to the URL. `PUBLIC_MCP_URL` in `lib/public-url.ts` is
  the one constant and `public-url.test.ts` fails if any published copy
  drifts. Moving the URL means a listing edit and every user re-adding the
  connector.
- The portal gives a dashboard with server health and usage by tool once the
  listing is live. Healthy is an error rate of 2% or less.

## Terms worth knowing before accepting

From the Anthropic Software Directory Terms and Policy, as read on
2026-11-11: Anthropic may test the server at any time and may remove a listing
for any reason without liability; the developer indemnifies Anthropic for
claims arising from the software and from users' interactions with it; the
developer must keep a channel for security-vulnerability reports and act on
them with reasonable care (the GitHub issue tracker and the contact page
cover this); the terms can change without notice; and nothing in the listing
may imply partnership, sponsorship or endorsement by Anthropic.

## Sources

- Submit a connector: <https://claude.com/docs/connectors/building/submission>
- Pre-submission checklist: <https://claude.com/docs/connectors/building/review-criteria>
- Publish to the directory: <https://claude.com/docs/directory/publish>
- Authentication: <https://claude.com/docs/connectors/building/authentication>
- Testing: <https://claude.com/docs/connectors/building/testing>
- Software Directory Policy: <https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy>
- Software Directory Terms: <https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms>
