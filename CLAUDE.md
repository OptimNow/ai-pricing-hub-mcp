# CLAUDE.MD - AI Pricing Hub MCP

**Project:** AI Pricing Hub MCP
**Stack:** Node and the official MCP SDK (`@modelcontextprotocol/sdk`). No framework, no UI.
**Repo:** github.com/OptimNow/ai-pricing-hub-mcp (public, MIT)
**Deployed:** https://optimtoken-mcp.optimnow.io/mcp (Fly.io app ai-pricing-hub-mcp). A push to `master` deploys it once CI passes (`.github/workflows/ci.yml`), so merging a pull request is a production release.

## Commits and pull requests

Do not add `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines to commit messages or pull request descriptions.

## What This Project Does

A remote MCP (Model Context Protocol) server that gives an AI assistant eight read-only tools: LLM model comparison, cost estimation, model recommendation, who sells a model and at what price, cloud compute pricing, the break-even between paying an API and renting capacity, and which prices just moved. It works in any MCP client (Claude, ChatGPT, Claude Code, VS Code, Goose). Each tool answers with a text block the model reads and the same figures as `structuredContent`.

**It is not an MCP App.** The server is tools only, on the owner's decision: the React widgets and the Skybridge framework went in 0.5.0 (see Architecture in `docs/DESIGN.md`). Do not add a UI layer back, a `ui://` resource, or a framework around the SDK, unless that decision is reopened.

**Origin:** Business logic copied from the standalone web app cloud-sparkle-compare, which has since been renamed to [OptimNow/ai-pricing-hub](https://github.com/OptimNow/ai-pricing-hub) (private). The local checkout is still the `cloud-sparkle-compare` folder, and this file uses the old name throughout. It is deployed at `optimtoken.optimnow.io`, which is what this app reads its pricing from. The original app remains untouched.

## MCP Tools

### Tool 1: `compare-llm-models`
- **Input:** Optional filters (provider, category = price tier, openness, capability, price range, min ELO, use-case preset, volume) plus `sortBy`: `elo` (default), `efficiency`, `cost`, `optimizedCost`, `inputPrice`, `outputPrice`. Each reads best first; a missing figure or a zero price sorts last.
- **Output:** Sorted/filtered model comparison with pricing, ELO scores, efficiency, monthly costs, the order it is in (`sortedBy`), and the concrete thresholds behind the FinOps Friendly badge
- **Data Source:** optimtoken API → direct OpenRouter → static fallback

### Tool 2: `estimate-llm-cost`
- **Input:** Model name + use-case preset (or custom token counts + volume). A custom shape may carry its own `cacheHitRate` and `batchEligible`; passing either with a preset is an error, not ignored.
- **Output:** Per-request and monthly cost breakdown per model, plus `savingsPct`, the four optimization-lever booleans (`batchEligible`/`cacheEligible`/`batchApplied`/`cacheApplied`), `cacheHitRate` and `optimizationBasis` (`preset` / `caller-supplied` / `none-supplied`) per entry. `none-supplied` is a custom shape with no assumptions: its optimized cost repeats list price because nothing was assumed, and the text says so.

### Tool 3: `compare-models-side-by-side`
- **Input:** `models` (2-4 free-text names) + optional `volumePreset`
- **Output:** Each named model against all 8 use-case profiles, list and optimized, plus a `resolution` entry per name. A name that matched nothing, matched several models, or duplicated an earlier pick is reported rather than silently changing the columns — a missing column is not a free model.

### Tool 4: `recommend-llm-model`
- **Input:** `useCasePreset` (required) + optional `volumePreset`, `maxMonthlyBudget`, `minElo`, `requiredCapability`, `openness`
- **Output:** Top 3 by value score as structured facts — efficiency rank, ELO, list and optimized cost, FinOps flag, volatility, and a per-constraint satisfied/violated breakdown — leaving the narrative to the calling model. An over-constrained query sets `overConstrained` and returns `nearMisses` instead, ordered by how far each is from the *numeric* constraints, each carrying the constraint it failed. A model with a retirement notice is in neither list: it is counted in `retiredExcludedCount` and, where it would have ranked, named in `retiredNotRecommended`. Also carries `roiCalculatorUrl`.

### Tool 5: `compare-compute-pricing`
- **Input:** `region` (us-east | us-west | europe | asia-pacific, default us-east) plus filters (provider, vCPUs, memory, category, processor, use case, sort). No OS filter: the tool serves Linux only, and the upstream Windows rows are filtered out.
- **Output:** Filtered cloud compute instance comparison across 7 providers. Each row carries on-demand, spot and the 1- and 3-year commitment rates (savings plan / CUD, reserved) with the saving of each against on-demand (`*SavingsPct`), in the text as well as in `structuredContent`; a row with no commitment rate says so. Plus `provenance.priceTypes` — which price columns are live, which are static constants, and which are unavailable
- **Data Source:** `GET /api/pricing` (~6,000 instances) with the 137-row static array as fallback only

### Tool 6: `compare-model-hosts`
- **Input:** `models` (1-4 free-text names) + optional `useCasePreset` (default supportTicket) and `volumePreset`
- **Output:** Per model: the quoted price and whose rate it is (`priceSource`: vendor / reference / adjusted / unknown), host count, the cheapest, dearest and maker's own listing, the spread, promotional listings, the builds declared (quantization), each offer costed for the workload and compared with the quoted cost. Then every host (`offers`), `platforms`, `bedrockRegions` and the hosts at the quoted rate, when `hostList.available`. Plus a `resolution` entry per name.
- **Data Source:** `hostPricing` on the rows of `/api/llm-models` for the summary (tier 1 only, dated by `provenance.hostPricingAsOf`), and `GET /api/model-hosts?id=` for every host. When that second request fails the summary still answers and the text says the hosts in between are not shown. An absent list, platform or region is not known, never "no".

### Tool 7: `estimate-self-hosting-breakeven`
- **Input:** `model` (one name) + a fleet: `instanceType` from the compute catalogue (with `provider`, `region`) OR `hourlyRate` of the caller's own; optional `instanceCount`, `outputTokensPerSecond` (measured, per instance), `monthlyOperationsCost`; a workload (`useCasePreset`, default supportTicket, or custom tokens with `cacheHitRate` / `batchEligible`) and `monthlyVolume`.
- **Output:** The fleet's monthly cost at every rate the instance lists (on demand, spot, commitments), and for each the volume at which it costs the same as the API at list price, at the optimized price and at the cheapest host known: requests/month, tokens/day, and the output tokens per second that volume asks of the fleet. With a throughput: the fleet's capacity, each break-even as a share of it and whether it is out of reach. Plus the difference at the caller's volume, and whether the model's weights are published at all.
- **Data Source:** both catalogues (`provenance` for the API prices, `computeProvenance` for the instance rates). The arithmetic is local and has no counterpart on the site.

### Tool 8: `track-llm-price-changes`
- **Input:** nothing for the week's moves, with optional `direction` (up | down), `provider`, `includeFlagged`, `limit`; OR `models` (1-4 free-text names) for each one's price history. Plus `useCasePreset` and `volumePreset` for the monthly figures. A week's filter passed with `models` is an error, not ignored.
- **Output:** `mode` (window | history). Window: `summary` (tracked, moved, up, down, flagged, unflagged), then the moves with no flag (`priceChanges`) and the flagged ones (`flaggedMoves`), each with the price before and after, the blended, input and output change, and the workload's monthly bill before and after. History: per model the first price on record, every change since, the latest price and the net change, plus a `resolution` entry per name.
- **Data Source:** `GET /api/price-changes` (the site's nightly price archive, dated by `provenance`). No fallback tier: when it cannot be read the tool returns an error.

## Key Design Decisions

1. **One MCP server per request.** Tools are declared once with `tool()` in `index.ts` and registered on a new `McpServer` for every HTTP request (`createServer`, called by `lib/http.ts`). The SDK refuses a second `connect()` on a connected server, so a shared instance answers every request that overlaps another with HTTP 500, and assistants call tools in parallel (the production incident is in `docs/DESIGN.md`, Architecture). `lib/http.test.ts` holds this with eight concurrent requests; do not hoist the server to module scope.
1b. **The text block is what the model reads.** With no widget, `content` is the answer and `structuredContent` is the same figures for a host that uses them. A fact that exists only in `structuredContent` may never reach the reader, so anything a FinOps answer depends on (a caveat, a label, which lever applied) goes in the text too.
2. **optimtoken.optimnow.io is the source of truth** for both LLM and compute pricing. Direct OpenRouter is kept as a working second tier for LLM models only, never as the preferred one.
3. **Static fallback** in `data/pricing-data.ts` ensures the app works without network access
3b. **Provenance ships with every response.** `structuredContent.provenance` carries the upstream timestamp, which tier served, and — for compute — `sources`, `sourceRegions` and `priceTypes`. Some columns are `static` upstream (GCP CUDs always: us-east-1 constants scaled by a region multiplier; a whole provider when its API did not answer); serving those beside live on-demand rates without saying which is which gives a FinOps answer nobody can audit. `provenance.staticPriceColumns` pre-walks `priceTypes` so the non-live columns are one field away, and the compute text tags each static figure where it prints it. AWS Savings Plan rates come from AWS's price files, read weekly upstream: `provenance.awsSavingsPlansAsOf` is their date, not the response's timestamp.
3c. **Tool `outputSchema`s must go through `outputSchema()`** in `lib/output-schema.ts`. The MCP SDK's `toJsonSchemaCompat()` defaults its target to `draft-7` (still true at SDK 1.32.1), and hosts that validate 2020-12 only — Claude Code among them — reject such a tool *before its handler runs*. Passing a pre-built JSON Schema object is not an alternative: `AnySchema` is Zod-only, so a plain object makes `normalizeObjectSchema()` return `undefined` and the schema is silently dropped.
3d. **`structuredContent` is a contract: add fields, do not rename or drop them.** Every field a handler returns must also be declared in that tool's output schema, because a strict host validates the response against it and Zod emits `additionalProperties: false`.
3f. **Optimized cost is conditional, and the text must say so.** Batch pricing
needs an async workload *and* a model that publishes batch rates; cache savings
need a cacheable prefix *and* a published cache-read rate, and must still pay
once the cache *write* is charged (`cacheWritePricePer1M`, amortised over
`CACHE_READS_PER_WRITE`). A lever that would raise the cost is not pulled and
not named. `optimizationLevers()`
returns which of the four conditions held, and `leverSummary()` turns that into a
sentence. A bare 0% saving reads as a bug; "this model publishes no batch rate"
reads as an answer.
6. **Compute pricing** comes from `GET /api/pricing` (~6,000 instances across 7 providers), with the 137-row static array in `data/pricing-data.ts` as fallback only. Category, processor and use-case enrichment is applied locally to whichever rows arrive. The tool reads a live source, so its `openWorldHint` is `true`.
7. **Price tier and openness are separate axes.** `category` is Frontier / Mid-tier / Budget / Image and answers "what does it cost". `openness` (derived from the licence in `openness.ts`) answers "whose hardware can run it". They used to be folded together as an "Open Weights" category, which forced every open model to give up one label to earn the other — do not reintroduce it.
8. **The FinOps Friendly badge gates on percentiles, not fixed numbers:** top 40% on ELO, top 30% on efficiency, cheapest 70% on list price, a stable release, a price the site does not flag as an outlier listing, and no retirement notice. Ties share a rank. The tool also returns what those percentiles land on today (`finopsBadge.minElo`, `finopsBadge.maxBlendedPrice`) so the badge is auditable.
9. **A price the site flags is labelled, never hidden.** `promotionalListing` (a temporary discounted rate) and `outlierListing` (one host's rate, input near free) arrive on the site's rows and are repeated in `structuredContent` and in every text block, with one line saying what the label means. A budget built on a promotional price rises when the promotion ends.
9b. **Host prices travel beside the model rows, never on them.** `fetchLLMModels()` returns `hostPricing` as a map keyed by `hostPricingKey()`. Every tool spreads a model row into `structuredContent`, and the output schemas refuse undeclared properties, so a field added to `LLMModel` reaches all of them at once and a strict host rejects them. A model with no entry is unknown, never "sold by one host". The maker's row is not quoted for the ids in `MAKER_ROW_NOT_STANDARD_RATE`, but only while that row differs from the quoted price (`makerOffer`).
9c. **A retirement notice is read from the site, never kept here.** `deprecation` arrives on the row (site schema 2.8, dated by `provenance.deprecationsVerifiedAt`), is tagged in every text, refuses the badge and keeps the model out of `recommend-llm-model`'s picks. Absent means no notice on record, never "safe". Do not add a table of retired models and do not record the field in the snapshot: a copy ages in silence, and tiers 2 and 3 say they carry none.
10. **The cost, score, badge, host-price and instance-categorisation logic is a port of the site's, and `npm run check-parity` is how it is held to it.** It runs both implementations over the live catalogues and must report no difference before a release. `lib/compute-categories.ts` is the site's file copied whole: change the rules there, then copy again. See "Keeping in sync" in `docs/DESIGN.md` for the one rule that is stricter here.
11. **The break-even assumes nothing it cannot read.** `lib/self-hosting.ts` is the one calculation that is not a port. It never supplies a throughput, an operations cost or a GPU memory: this server holds no measurement of any of them, and a default would be an invented fact in an answer the caller is told to quote. Without a throughput it states the one each break-even requires, and says a comparison at the caller's volume holds only if the fleet can serve it. Do not add default tokens-per-second tables or a default staffing cost.
12. **A price move is not a repricing unless nothing says otherwise, and a failed read is not a quiet week.** The site flags the moves it can establish as a change of the host it quotes (`hostSwitch`) or an outlier listing (`outlierHost`); `track-llm-price-changes` repeats the flags, lists the flagged moves apart and never calls an unflagged one a repricing by the maker. The archive has no fallback here: on a failed read the tool errors. Do not return an empty list, and do not build a local price history.

## Dependencies

- `@modelcontextprotocol/sdk` — the MCP server and its Streamable HTTP transport. The only runtime dependency besides `zod`: the HTTP side is `node:http` in `lib/http.ts`.
- `zod` — input and output schemas
- `typescript`, `tsx`, `@types/node` (devDependencies) — `npm run build` is `tsc`, `npm test` runs `node --test` through `tsx`, `npm run dev` is `tsx watch`. `tsx` does not type-check: run `npm run typecheck` as well, CI does.

## Where the rest lives

`docs/DESIGN.md` holds the reference sections, the history and the reasoning. It is not
loaded automatically: read the section your task touches.

Sections in `docs/DESIGN.md`:

- Architecture
- Development
- Keeping in sync with cloud-sparkle-compare
- Data Flow
- Constraints

## Maintaining this file

Keep this file under 200 lines. It holds what an agent needs in every session. A new decision, its reasoning or its history goes into the matching section of `docs/DESIGN.md`, or a new section listed above. Add a rule here only if an agent would break something without it.
