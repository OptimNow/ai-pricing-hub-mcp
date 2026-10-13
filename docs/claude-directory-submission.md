# Publishing this server in the Claude connectors directory

Status as of 2026-10-13: **not submitted.** The server meets every hard
requirement in Anthropic's docs; what remains is listing material and the
portal run. The tool description change in this PR should be deployed before
you start (see "What this PR changed"), because the portal syncs tool
descriptions from the running server.

The ChatGPT counterpart is `chatgpt-submission.md`. The two directories ask for
much the same material, so prepare it once.

## Where and who

- **Portal:** <https://claude.ai/directory/manage>, **Submit new**, then
  **MCP connector**. There is no separate "Claude Marketplace" submission.
- **Plan:** any paid plan. On Pro and Max you submit from your own account and
  there is no role to check; on Team and Enterprise an Owner submits. The
  listing belongs to the account or organisation you submit from, so if
  OptimNow later moves to a Team plan, ask Anthropic whether a listing can move
  with it before resubmitting.
- **Outcome:** every submission is scanned automatically and, by default,
  listed as a **Community** connector. Anthropic may escalate a listing it
  considers useful to a **Verified** review, where a person runs every tool.
  There is no application for Verified; both labels must meet the same
  criteria.
- **Escalation:** `mcp-review@anthropic.com`. Status and reviewer feedback
  appear in the portal.

## What is already correct

Verified by calling the published URL on 2026-10-13 with
`node scripts/check-connector.mjs` plus a `tools/list` dump, so nothing here
needs changing:

| Requirement | Status |
|---|---|
| Remote server, `https://`, Streamable HTTP | `https://optimtoken-mcp.optimnow.io/mcp`, initialize in 278 ms |
| `title` plus `readOnlyHint` or `destructiveHint` on every tool | All five carry `title`, `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true` |
| Tool names at most 64 characters | Longest is 27 |
| Authentication | `none`; the docs allow it for public data and the portal has a "No authentication" option |
| MCP App resources | `text/html;profile=mcp-app`, `_meta.ui.domain` equals the hash of the published URL, CSP lists only the server's own origin |
| Validation errors are actionable | A bad `limit` returns `-32602` naming the field |
| Live data | `provenance.tier` is 1 for the LLM tools and for compute, Europe included |
| Privacy policy | <https://optimtoken.optimnow.io/privacy> names the MCP server, Fly.io and a GDPR contact |
| Documentation | <https://optimtoken.optimnow.io/mcp>: setup per client, the five tools, five prompts, FAQ, privacy |
| Support contact | <https://www.optimnow.io/contact> |
| Rendering in Claude | All five widgets drew in Claude Desktop on 2026-10-09 with the connector added under exactly the published URL |

## What this PR changed

Every tool description used to end with a paragraph of instructions to the
model: "IMPORTANT: Report all prices EXACTLY as returned. Do NOT add
commentary... Present the results as a table". The pre-submission checklist
says a description must "describe what the tool does, and don't tell Claude
how to behave", and lists "tell Claude to behave in ways unrelated to the
tool's function" among the automatic rejection patterns. Those sentences were
rewritten as statements about the output: figures are rounded and ranked
server-side, dated by `provenance`, and the text block repeats them. The
"use this tool when... use X instead" routing between the five tools stays,
because that is exactly the "when to invoke it" a reviewer wants to see.

The underlying guarantee did not move. The rounding that lets a model quote a
figure verbatim is still pinned by `serialisation-contract.test.ts`; only the
imperative wording went.

## Still recommended, not blocking

None of these is checked by the automated scan. All of them are in the MCP
Apps design guidelines, which is what a Verified reviewer would hold the
widgets against.

- **Theme follows the OS, not Claude.** The widgets paint an opaque
  `body { background: var(--surface) }` from their own palette in
  `web/src/index.css` and switch to dark only on the OS `prefers-color-scheme`.
  Claude passes its own theme and a full token set (`--color-background-*`,
  `--color-text-*`, `--color-border-*`, `--font-*`) through `hostContext`, and
  the guidelines ask for a transparent background, a
  `<meta name="color-scheme" content="light dark">` tag, and those tokens for
  structural colour. Skybridge 0.35.21 receives `hostContext.theme` into a
  store but exports no hook for it, so the practical fix is to map the host
  variables onto the existing tokens with fallbacks, keeping the chartreuse
  for accents only.
- **Horizontal scrolling at phone width.** The side-by-side table forces
  `minWidth: 560px` inside a scrolling card
  (`web/src/widgets/compare-models-side-by-side/index.tsx`). The guidelines
  ask for reflow from 320 px with no horizontal scroll.
- **Cold first call for a reviewer.** `fly.toml` scales to zero, so the first
  call after an idle stop pays the machine boot plus an upstream fetch, up to
  ~8 s on compute. The tool timeout is 240 s so nothing fails, but set
  `min_machines_running = 1` for the review window if the first impression
  matters. About $3 a month while it is on.

## Material to prepare

- **Icon.** The only square asset on the site is `/optimnow-icon.png` at
  96 × 96. Have a larger square PNG ready; the portal does not publish a size,
  so 512 × 512 is safe.
- **Carousel screenshots.** An MCP App listing needs **3 to 5 PNGs, at least
  1000 px wide, cropped to the widget with no prompt in the image**, any aspect
  ratio, and the prompt text for each one supplied separately. No GIF or
  video; one batch covers desktop and mobile. Take them in Claude Desktop with
  the connector attached, one per widget, from these prompts:

  | Widget | Prompt |
  |---|---|
  | `compare-llm-models` | "Show me models under $1 per 1M input tokens with an ELO above 1300, as a cost-versus-quality chart." |
  | `recommend-llm-model` | "Recommend a model for support tickets under $500 a month." |
  | `compare-models-side-by-side` | "Compare GPT-4o, Claude Opus 5 and Gemini 3.1 Pro side by side." |
  | `estimate-llm-cost` | "Estimate the monthly cost of GPT-4o-mini at 800 input tokens and 200 output tokens, four million requests a month." |
  | `compare-compute-pricing` | "Compare cloud instances in Europe with at least 8 vCPUs and 32 GB of memory, cheapest first." |

  Take them in light mode (see the theme note above) and on a window wide
  enough that the widget itself exceeds 1000 px.
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
- **URLs.** Documentation `https://optimtoken.optimnow.io/mcp`, privacy
  `https://optimtoken.optimnow.io/privacy`, support
  `https://www.optimnow.io/contact`, company `https://optimnow.io`.
- **Allowed link URIs.** Optional. The only `ui/open-link` target is the ROI
  deep link in the recommend widget, so list `https://airoicalculator.optimnow.io`
  and the confirmation modal disappears for it. Only origins you own are
  accepted; subdomains are matched exactly.
- **Smoke tests.** Re-run the cases in `chatgpt-app-smoke-tests.md` against
  the Fly URL first; the file still names the retired Alpic host in its
  header. The portal's Test & launch step asks you to confirm every tool was
  run, through MCP Inspector or as a custom connector.

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
7. **Data handling.** The API is your own (`optimtoken.optimnow.io`). Declare
   the one exception honestly: when the site is unreachable, the LLM tools
   fall back to `openrouter.ai`'s public model list, a third-party API you do
   not control, and mark the response unverified. No health data, no sponsored
   content. If a reviewer objects to the third-party call, dropping tier 2 in
   `lib/llm-models.ts` is a small change: the LLM tools then fall straight to
   the embedded snapshot.
8. **Test & launch.** Credentials are a mandatory field. Write that the server
   is public and unauthenticated, no account exists or is needed, and paste
   the prompt table above as the walkthrough. Confirm every tool was run.
9. **Compliance.** Seven acknowledgments: directory guidelines, first-party
   API usage, financial transactions, AI media generation, prompt injection,
   conversation data collection, public documentation. All seven apply
   cleanly to a read-only pricing tool.
10. **Review and submit.** Quality warnings such as very short answers are
    shown here and forwarded to the review team.

## After it is listed

- Changes to the live server, including adding or renaming tools, need no
  resubmission; the directory reads the server. Listing text is edited in the
  portal. The slug cannot change.
- The listing is bound to the URL. `PUBLIC_MCP_URL` in `lib/public-url.ts` is
  the one constant, the widget sandbox domain is a hash of it, and
  `public-url.test.ts` fails if any published copy drifts. Moving the URL means
  a new hash, a listing edit, and every user re-adding the connector.
- The widget resources must stay listed: `_meta.ui.resourceUri` points at
  them, and the carousel screenshots describe them.
- The portal gives a dashboard with server health and usage by tool once the
  listing is live.

## Terms worth knowing before accepting

From the Anthropic Software Directory Terms and Policy, as read on
2026-10-13: Anthropic may test the server at any time and may remove a listing
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
- MCP Apps design guidelines: <https://claude.com/docs/connectors/building/mcp-apps/design-guidelines>
- Theme blending: <https://claude.com/docs/connectors/building/mcp-apps/transparent-theming>
- External links: <https://claude.com/docs/connectors/building/mcp-apps/external-links>
- Software Directory Policy: <https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy>
- Software Directory Terms: <https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms>
