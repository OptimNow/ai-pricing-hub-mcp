# Publishing this server in the Claude connectors directory

Status as of 2026-11-19: **published, as a Community connector.** The owner
submitted "AI Economics" (slug `optimnow-ai-economics`) from the OptimNow
organisation that evening, against 0.11.1. About ten minutes later an
automated review approved it as a Community connector, and an email said so
("Anthropic MCP Directory Follow-Up", sent through Intercom for Anthropic's
Platform Operations). The portal then showed "Ready to publish". Publishing
is the owner's click, not Anthropic's. The listing was published at about
21:20 CET, once its authentication was corrected (see "After the approval"),
and the portal says a new listing takes up to an hour to appear at
<https://claude.ai/directory/connectors/optimnow-ai-economics>. What was
entered at each step is in `claude-directory-listing.md`.

The listing was drafted on 2026-11-12, when the six checks of "Before you
submit" passed against 0.11.0 (each says how it was checked).

Re-run on 2026-11-19, against 0.11.0 still: `check-connector.mjs` passed
(eight concurrent calls, eight answers), `/mcp` and `/privacy` answered 200
with their full text to curl, the docs page names the eight tools, no issue
is open on either repository, and the eight calls of the Test & launch step
answered, every model name resolving to one model. Anthropic's five pages
(Sources) read the same as on 2026-11-12, with one difference: the
submission page says not to put credentials in the portal, and that
Community listings need no test account. At the Tools step the portal then
flagged every tool "Missing title annotation": 0.11.1 was released the same
evening to fix it, and the checks passed again against it before the
submission.

The ChatGPT counterpart is `chatgpt-submission.md`. The two directories ask for
much the same material, so prepare it once.

## Where and who

- **Portal:** <https://claude.ai/directory/manage>, **Submit new**, then
  **MCP connector**. There is no separate "Claude Marketplace" submission.
- **Not the MCP registry.** `server.json` is published to
  <https://registry.modelcontextprotocol.io> after each deploy (`DESIGN.md`,
  "Publishing to the MCP registry"). That is another listing, kept by another
  party, and publishing there submits nothing here: the portal asks for the URL
  and reads the live server.
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

In this order. All six were checked on 2026-11-12, against 0.11.0 in
production.

1. **Done, last on 2026-11-12: `node scripts/check-connector.mjs` passes against
   the published URL** (0.11.0, after the deploy of that day). Run it again
   after every deploy. Against 0.4.2 it failed on two counts, both of which a
   reviewer would have met:
   - **Concurrent calls fail.** Under 0.4.2, a tool call that overlaps another
     is answered HTTP 500 "Internal server error": eight concurrent calls
     behind one slow upstream fetch gave seven 500s in production on
     2026-11-11. The checklist says "every tool must return a successful
     response when called with valid parameters" and that "generic errors such
     as Internal Server Error ... fail review"; the listing's health badge
     turns Degraded above a 5% error rate. Fixed in 0.5.0 (one MCP server per
     request).
   - The five widget resources were still listed.
2. **Check that the documentation and privacy pages are readable without a
   browser.** On 2026-11-12 `https://optimtoken.optimnow.io/mcp` and `/privacy`
   answered HTTP 200 with their full text to curl (26 KB and 6 KB, no challenge
   page). The day before, both answered HTTP 429 with a "Vercel Security
   Checkpoint" page to every non-browser client tried (curl, with and without
   a browser or `Claude-User` user agent), while rendering normally in a
   browser; `/api/*`, `/llms.txt` and `/openapi.json` were not challenged.
   What lifted the challenge is not known, and the check of 2026-11-12 is one
   client from one network: repeat the two requests on the day of the
   submission. Whether Anthropic's automatic scan fetches the two URLs is not
   documented. If the challenge is back, exempt the public pages from it in
   the site's Vercel firewall rather than find out.
3. **Done on 2026-11-12: the site's `/mcp` page describes this server** (in the
   site's repository, not this one). It lists the eight tools and the two
   tiers, names `cacheHitRate`, carries no sentence about widgets, and writes
   the registry name as the registry does (`io.github.OptimNow/ai-pricing-hub`).
   The policy asks that documentation "precisely match actual functionality",
   so the page moves with every tool or parameter added here.
4. **Done in 0.11.0: the OpenRouter fallback is removed.** The checklist says
   "your server must call your own first-party APIs, or APIs you legitimately
   proxy". Tier 1 is our own API, and since 0.11.0 it is the only API this
   server calls: when the site is unreachable the LLM tools answer from the
   embedded snapshot. Until then a second tier called `openrouter.ai`'s public
   model list directly, which would have had to be declared.
5. **Done on 2026-11-12, and daily since: `npm run check-parity` reports no
   difference**, so the figures the listing will show are the site's. The
   site's repository runs it every day (`mcp-parity.yml` there) and opens an
   issue on a difference: check that no `mcp-parity` issue is open. See
   "Keeping in sync" in `DESIGN.md`.
6. **Done on 2026-11-12: the repository's description on GitHub says what the
   server reads.** The About box of `OptimNow/ai-pricing-hub-mcp` read "Live
   data from OpenRouter, AWS, Azure, GCP, OCI, OVH, DigitalOcean" that morning.
   The server reads none of them: since 0.11.0 it calls
   `optimtoken.optimnow.io` and nothing else, which is also what item 4 and
   the Data handling step declare, and a reviewer who opens the repository
   reads that line first. The owner replaced it the same day; it now names
   the eight read-only tools and `optimtoken.optimnow.io` as the source. It is
   a setting of the repository, edited on github.com (the gear beside About):
   nothing in this checkout holds it, so re-read it after any change to what
   the server calls.

## What is already correct

Checked on 2026-11-11 against the 0.5.0 build running locally, and against the
documentation as it read that day:

| Requirement | Status |
|---|---|
| Remote server, `https://`, Streamable HTTP | `https://optimtoken-mcp.optimnow.io/mcp` on Fly.io |
| `title` plus `readOnlyHint` or `destructiveHint` on every tool | All eight carry `title`, at the top level and, since 0.11.1, in `annotations.title` too (the portal reads the second and flagged its absence on 2026-11-19), `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true` (`compare-model-hosts` was added in 0.6.0, `estimate-self-hosting-breakeven` in 0.7.0, `track-llm-price-changes` in 0.9.0) |
| Tool names at most 64 characters | Longest is 31 (`estimate-self-hosting-breakeven`) |
| Descriptions say what the tool does and when to use it, with no instructions to the model | Reworded in October; the routing between the eight tools stays |
| Authentication | `none`; allowed for public data, and the portal has a "No authentication" option |
| Validation errors are actionable | A bad `limit` returns `-32602` naming the field; an unknown model name says so |
| Responses reasonably sized | Largest observed about 43,000 characters, roughly 11,000 tokens (`compare-llm-models` at `limit: 50`, measured on the 0.6.0 build; `compare-compute-pricing` at `limit: 50` is about 36,000 characters now that each row prints its commitment rates), against a ceiling of about 150,000 characters in claude.ai and 25,000 tokens in Claude Code |
| Every response validates against its `outputSchema` | 14 of 14 sampled calls, error paths included |
| Live data | `provenance.tier` is 1 for the LLM tools and for compute |
| Privacy policy | <https://optimtoken.optimnow.io/privacy> names the MCP server, Fly.io and a GDPR contact (see item 2 above) |
| Support contact | <https://www.optimnow.io/contact> |

Open, and not blocking: the compute tool opens every answer with about 1,300
characters of provenance notices whichever providers the result contains. The
policy asks a server to be "frugal with their use of tokens".

## Material to prepare

- **Icon.** `assets/icon.png`, 512 × 512, square, in this repository since
  2026-11-12 (the portal does not publish a size). It is rendered from
  `assets/icon.svg`, the OptimNow mark as the Cloud FinOps connector's listing
  uses it (`plugins/cloud-finops/.claude-plugin/icon.svg` in
  `OptimNow/cloud-finops-skills`; that listing uploaded a 96 × 96 PNG of the
  same mark). To upload it, or to give the portal an address:
  `https://raw.githubusercontent.com/OptimNow/ai-pricing-hub-mcp/master/assets/icon.png`.
- **Listing copy, example prompts and test instructions.** In
  `claude-directory-listing.md`, field by field, since 2026-11-12: the name,
  (`AI Economics`), the one-liner, the description, the slug
  (`optimnow-ai-economics`), twelve example prompts in two groups (plain
  questions and detailed ones, every tool covered), and the text of the Test
  & launch step.
  `listing.test.ts` holds the three length limits and fails when a tool has no
  prompt. The suggestions that stood here until then are replaced by that
  file.
- **URLs.** Documentation `https://optimtoken.optimnow.io/mcp`, privacy
  `https://optimtoken.optimnow.io/privacy`, company `https://optimnow.io`.
  Support: the repository's issue tracker in the listing's Support field, as
  the Cloud FinOps listing has it; the privacy page gives
  `https://www.optimnow.io/contact` as well.
- **Smoke tests.** Re-run the cases in `chatgpt-app-smoke-tests.md` against
  the published URL. The portal's Test & launch step asks you to confirm every
  tool was run, through MCP Inspector or as a custom connector.

## The portal, step by step

What each step asks for. The text to paste at each one is in
`claude-directory-listing.md`, under the same step numbers.

Progress saves in the browser tab between steps (its `sessionStorage`): the
draft survives a reload of the tab, not a new tab.

1. **Connection.** Add `https://optimtoken-mcp.optimnow.io/mcp` as a custom
   connector, or pick the one already on the account. The connector stays in
   the account's connectors afterwards. Universal URL: every user connects to
   the same one.
2. **Tools.** Read from the connector. All eight should land in the
   read-only group with no "missing title or annotation" flag; the portal
   reads the title from `annotations.title`. If one is flagged, fix the
   server, deploy, then refresh the connector's tool list (Customize,
   Connectors, the connector's ⋯ menu, **Refresh tools list**) and reload the
   form: the portal does not read the tools again by itself.
3. **Listing.** Name, slug, one-liner, description, categories, author name
   and URL, icon, documentation URL, support, privacy URL, from the material
   above.
4. **Use cases.** Three rows at most. Prerequisites: none. Read only.
5. **Company.** OptimNow, `https://optimnow.io`, and the contact that should
   receive review updates.
6. **Authentication.** No authentication. Check what the listing recorded
   once it is approved: see "After the approval".
7. **Data handling.** The API is your own (`optimtoken.optimnow.io`), and it is
   the only one the server calls (the OpenRouter fallback went in 0.11.0). No
   health data, no sponsored content.
8. **Test & launch.** One box: confirm every tool was run, through MCP
   Inspector or as a custom connector. Run the eight calls of the listing's
   step 8 against the live deployment first. (On the Cloud FinOps
   submission this step also had a mandatory credentials field; on
   2026-11-19 it had none.)
9. **Compliance.** Seven acknowledgments: directory guidelines, first-party
   API usage, financial transactions, AI media generation, prompt injection,
   conversation data collection, public documentation. All seven apply
   cleanly to a read-only pricing tool. First-party API usage holds since
   0.11.0: the site's API is the only one the server calls.
10. **Review and submit.** Quality warnings such as very short answers are
    shown here and forwarded to the review team.

## After the approval, before publishing

An approved listing is not public until the owner clicks **Publish** on its
page in the portal. Read its **Settings** tab first.

On 2026-11-19 it read "Users sign in with: OAuth 2.0 with dynamic client
registration", and the edit page had **Always required** checked. Yet the
form had "None" at step 6, its draft held `authType: "none"`, and the portal's
own probe had found no sign-in. The server publishes no OAuth metadata
(`/.well-known/oauth-protected-resource` answers 404), so a published listing
asking for an OAuth sign-in risked leaving users unable to connect. Cloud
FinOps, whose server behaves the same way, read "No sign-in. Anyone can
connect."

The fix: **Edit listing**, then "Connection & authentication", then **Edit
authentication** (the radio buttons do nothing until it is clicked), then
**None**, then **Save**. Before publishing, a change to the authentication
applies at once and keeps the approval; a change to the URL or the request
headers withdraws it. Settings then read "No sign-in. Anyone can connect.",
and the Overview read "Authentication: None".

## After it is listed

- A new listing takes up to an hour to appear in the directory. Until then
  its public URL answers "This connector doesn't exist".
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
