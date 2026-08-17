# CLAUDE.MD - AI Pricing Hub MCP App

**Project:** AI Pricing Hub MCP
**Framework:** Skybridge (MCP App Framework)
**Repo:** github.com/OptimNow/ai-pricing-hub-mcp (private)
**Deployed:** https://ai-pricing-hub-mcp-9604f763.alpic.live

---

## What This Project Does

An MCP (Model Context Protocol) app that provides AI/LLM model comparison, cost estimation, and cloud compute pricing tools as interactive widgets inside AI conversations (Claude, ChatGPT, VS Code, Goose). Built with Skybridge framework.

**Origin:** Business logic copied from the standalone web app `cloud-sparkle-compare` (private). Note the local checkout name does not match its remote: it pushes to [OptimNow/ai-pricing-hub](https://github.com/OptimNow/ai-pricing-hub) (default branch `main`), while this repo is [OptimNow/ai-pricing-hub-mcp](https://github.com/OptimNow/ai-pricing-hub-mcp) (default branch `master`).

---

## Architecture

```
Framework:    Skybridge (MCP App Framework)
Language:     TypeScript
Build:        Vite + Skybridge plugins
UI:           React widgets (rendered via structuredContent)
Deployment:   Alpic Cloud
Transport:    streamable-http at root URL / (per server.json `remotes[].type`)
Data:         optimtoken.optimnow.io API (source of truth)
              → direct OpenRouter (LLM only, uncorrected)
              → static fallback in data/pricing-data.ts
```

### Data sources and the fallback chain

`https://optimtoken.optimnow.io` is the single source of truth for both LLM and
compute pricing. It is the deployed face of `cloud-sparkle-compare`, and it is
where pricing *correctness* lives: a committed price archive, a `PRICE_OVERRIDES`
table verified against vendor pricing pages, and `scripts/check-price-anomalies.mjs`,
which alarms on the ×0.5 / ×2.0 ratio breaks OpenRouter intermittently serves.
This app has no archive and cannot build one, so it asks rather than re-derives.

The base URL is one constant, `OPTIMTOKEN_BASE_URL` in `lib/optimtoken-api.ts`,
overridable with the `OPTIMTOKEN_API_BASE_URL` env var. Do not hard-code a
second host.

| Tool | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| LLM tools | `GET /api/llm-models` | `openrouter.ai` direct | static snapshot |
| Compute tool | `GET /api/pricing?region=` | static snapshot (137 rows) | — |

The compute chain has **two** tiers, not three — there is no direct-provider
equivalent of OpenRouter — so its snapshot is `provenance.tier === 2`, matching
what `fetchFromSnapshot()` sets in `lib/compute-pricing.ts`.

**Tiers 2 and 3 serve uncorrected prices.** That is not a detail: OpenRouter has
published GPT-5.6 Sol at $2.50/$15 against OpenAI's actual $5/$30, halving every
derived monthly figure. Every response therefore carries a `provenance` object
with `pricesVerified`, and the lower tiers set a `notice` that leads the text
output. A fallback must never silently downgrade correctness.

Tier 1 is only accepted when the site reports `meta.source === "openrouter"` —
anything else means the site is itself serving its own fallback and carries no
fresh corrections.

### Project Structure

```
ai-pricing-hub-mcp/
├── server/
│   └── src/
│       ├── index.ts                  # MCP server — 3 tool/widget definitions
│       ├── serialisation-contract.test.ts # structuredContent shape + rounding contract
│       ├── lib/
│       │   ├── optimtoken-api.ts     # Base URL constant, shared fetch, failure classification
│       │   ├── compute-pricing.ts    # /api/pricing fetch, region, per-column provenance
│       │   ├── output-schema.ts      # Forces JSON Schema 2020-12 on tool outputSchemas
│       │   ├── llm-models.ts         # 3-tier model fetch + ELO enrichment
│       │   ├── llm-business-metrics.ts # Efficiency scoring, use-case profiles, FinOps badge
│       │   ├── openness.ts           # Licence → self-hostability bucket
│       │   ├── pricing-normalize.ts  # Publishable-pricing guard (rejects -1 router rows)
│       │   ├── compute-categories.ts # Compute instance categorization + enrichment
│       │   ├── data-sources.test.ts  # Fallback-chain tiers, timeouts, provenance
│       │   ├── llm-business-metrics.test.ts
│       │   └── output-schema.test.ts
│       └── data/
│           ├── pricing-data.ts       # Static fallback LLM pricing + compute instances
│           └── region-api-map.ts     # Cloud region mappings
├── web/
│   ├── src/
│   │   ├── helpers.ts                # Skybridge widget helpers
│   │   ├── index.css                 # Widget styles
│   │   └── widgets/
│   │       ├── compare-llm-models/
│   │       │   └── index.tsx         # Model comparison table widget
│   │       ├── estimate-llm-cost/
│   │       │   └── index.tsx         # Cost estimation cards widget
│   │       └── compare-compute-pricing/
│   │           └── index.tsx         # Compute pricing table widget
│   └── vite.config.ts                # Skybridge Vite plugin (widget build — NOT at repo root)
├── scripts/
│   ├── refresh-llm-fallback.mjs      # Re-snapshots the static LLM list (npm run refresh-fallback)
│   └── check-serialisation-precision.mjs
├── docs/
│   ├── chatgpt-app-migration.md
│   └── chatgpt-app-smoke-tests.md
├── .github/workflows/ci.yml          # typecheck → test → build, on PR and push to master
├── alpic.json                        # Alpic deployment config
├── app.json                          # Connector manifest — bound to structuredContent shape
├── server.json                       # MCP registry manifest
├── package.json
├── tsconfig.json                     # Build config — excludes *.test.ts
└── tsconfig.test.json                # Type-checks the tests, noEmit
```

---

## MCP Tools

### Tool 1: `compare-llm-models`
- **Type:** Widget (has UI)
- **Input:** Optional filters (provider, category = price tier, openness, capability, price range, min ELO, use-case preset, volume)
- **Output:** Sorted/filtered model comparison with pricing, ELO scores, efficiency, monthly costs, and the concrete thresholds behind the FinOps Friendly badge
- **Data Source:** optimtoken API → direct OpenRouter → static fallback
- **Widget:** Interactive comparison table

### Tool 2: `estimate-llm-cost`
- **Type:** Widget (has UI)
- **Input:** Model name + use-case preset (or custom token counts + volume)
- **Output:** Per-request and monthly cost breakdown per model
- **Widget:** Cost comparison cards

### Tool 3: `compare-compute-pricing`
- **Type:** Widget (has UI)
- **Input:** `region` (us-east | us-west | europe | asia-pacific, default us-east) plus filters (provider, vCPUs, memory, category, processor, use case, sort). No OS filter: the tool serves Linux only, and the upstream Windows rows are filtered out.
- **Output:** Filtered cloud compute instance comparison across 7 providers, plus `provenance.priceTypes` — which price columns are live, which are static constants, and which are unavailable. On tier 2 it also carries `fallbackReason` (the classified upstream failure, with elapsed time), `unappliedFilters` (`["region"]` — the snapshot has no region dimension) and `catalogueIsSubset`.
- **Data Source:** `GET /api/pricing` — ~4,800–6,000 instances depending on region (us-east ~6,050, asia-pacific ~4,800) — with the 137-row static array as fallback only
- **Widget:** Compute pricing table

---

## Development

```bash
npm install
npm run dev        # Skybridge dev server with DevTools emulator (port 3000)
npm run typecheck  # tsc on server+widgets, then on the tests separately
npm test           # node --test over server/src/**/*.test.ts — offline, no server
npm run build      # Production build
npm run start      # Start production server
```

`.github/workflows/ci.yml` runs `typecheck` → `test` → `build` on every PR and on
push to `master`, on Node 24 to match the `engines` field. Run all three locally
before pushing; the tests are deterministic and need no network.

### Deployment

```bash
npx alpic deploy
```

Deploys to Alpic Cloud. The MCP endpoint is served at root `/`, registered as
`streamable-http` in `server.json`.

`.alpic/project.json` already links this checkout to project `ai-pricing-hub-mcp`
/ environment **Production**, so a bare `alpic deploy` targets prod — run it
without `--yes` and read the confirmation. Do **not** pass `--project-name`: that
flag names a *new* project and will fork a second one. `npx alpic login` first if
`npx alpic whoami` says you are not authenticated.

Deploys the working directory, not a branch — so deploying from a feature branch
ships code that is not on `master`, and a later deploy from `master` will roll it
back.

### Connecting to Claude Desktop

Add to `claude_desktop_config.json`:
```json
"ai-pricing-hub": {
  "command": "cmd",
  "args": ["/c", "npx", "mcp-remote", "https://ai-pricing-hub-mcp-9604f763.alpic.live/"]
}
```

---

## Key Design Decisions

1. **All 3 tools use `registerWidget()`** — each has a React widget UI
2. **optimtoken.optimnow.io is the source of truth** for both LLM and compute pricing. Direct OpenRouter is kept as a working second tier for LLM models only, never as the preferred one.
3. **Static fallback** in `data/pricing-data.ts` ensures the app works without network access
3b. **Provenance ships with every response.** `structuredContent.provenance` carries the upstream timestamp, which tier served, and — for compute — `sources`, `sourceRegions` and `priceTypes`. AWS Savings Plans and GCP CUDs are `static` upstream (us-east-1 constants scaled by a region multiplier); serving those beside live on-demand rates without saying which is which gives a FinOps answer nobody can audit. `provenance.staticPriceColumns` pre-walks `priceTypes` so the non-live columns are one field away.
3c. **Tool `outputSchema`s must go through `outputSchema()`** in `lib/output-schema.ts`. The MCP SDK's `toJsonSchemaCompat()` defaults its target to `draft-7` (still true at the pinned `^1.27.1`, resolving to 1.27.1), and hosts that validate 2020-12 only — Claude Code among them — reject such a tool *before its handler runs*. Passing a pre-built JSON Schema object is not an alternative: `AnySchema` is Zod-only, so a plain object makes `normalizeObjectSchema()` return `undefined` and the schema is silently dropped.
4. **ELO scores** from Chatbot Arena are merged with pricing data for quality ranking
5. **Business metrics** (use-case profiles, efficiency scoring) from `llm-business-metrics.ts` add FinOps context
6. **Compute pricing is live from `/api/pricing`**, ~4,800–6,000 instances across 7 providers (AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba), with `compute-categories.ts` enrichment applied locally to the site's rows. The 137-row static array is the fallback only — it was the primary source before the tier-1 switch, and describing it as the source of truth is how a silent degradation to it goes unnoticed.
7. **Price tier and openness are separate axes.** `category` is Frontier / Mid-tier / Budget / Image and answers "what does it cost". `openness` (derived from the licence in `openness.ts`) answers "whose hardware can run it". They used to be folded together as an "Open Weights" category, which forced every open model to give up one label to earn the other — do not reintroduce it.
8. **The FinOps Friendly badge gates on percentiles, not fixed numbers:** top 40% on ELO, top 30% on efficiency, cheapest 70% on list price, and a stable release. The tool also returns what those percentiles land on today (`finopsBadge.minElo`, `finopsBadge.maxBlendedPrice`) so the badge is auditable.

---

## Keeping in sync with cloud-sparkle-compare

The surface that could drift has shrunk, but it has not gone.

**No longer a concern.** The taxonomy (`category`, `license`) and the corrected
prices now arrive from the site on tier 1 rather than being re-derived here.
That closes the class of bug that produced a retired `Open Weights` category and
an unrecognised `Llama 4` licence in this repo — both of which had already
diverged before the switch.

**Still a manual port, and still able to drift:**

- `lib/llm-business-metrics.ts` — the cost formulas, efficiency scoring, use-case
  profiles and FinOps badge. The site does not expose these, so this app computes
  them. Kept **character-identical** to the original's; the coherence test is that
  both apps produce the same cost to the cent for the same model and use case.
- `lib/openness.ts` — the licence → self-hostability buckets. The site sends the
  licence *string*; the bucketing is local, so a new licence string upstream
  silently becomes `Unknown` here until it is added. This is exactly how `Llama 4`
  broke.
- `lib/llm-models.ts` tier 2 — the whole OpenRouter transform (ELO table,
  categories, exclusions, licence prefixes) is a port and only runs when the site
  is unreachable, so its drift is invisible until the day it matters.
- `lib/compute-categories.ts` — instance categorisation, processor and use-case
  inference. Applied locally to the site's rows.

Two things keep the two honest:

- `npm run refresh-fallback` re-snapshots the static model list from `https://optimtoken.optimnow.io/api/llm-models` into the `LLM-FALLBACK-START/END` markers in `server/src/data/pricing-data.ts`. It refuses to write on a collapsed catalogue, and re-derives the price tier for any row still carrying the retired `Open Weights` category (a deployment on schemaVersion 1.0).
- The cost formulas in `llm-business-metrics.ts` are kept **character-identical** to the original's. The coherence test is that both apps produce the same cost to the cent for the same model and use case.

Before adding LLM business logic here, check whether `cloud-sparkle-compare` already has it and port rather than reinvent.

---

## Data Flow

```
optimtoken /api/llm-models → fetchLLMModels() → enrichModels() → filterModels() → structuredContent
        ↓ (tier 2, uncorrected)                                          + provenance
openrouter.ai/api/v1/models
        ↓ (tier 3)
pricing-data.ts (static snapshot)

optimtoken /api/pricing?region= → fetchComputeInstances() → enrichInstances() → filter/sort
        ↓ (tier 2)                                                      → structuredContent
pricing-data.ts computeInstances                                          + provenance
```

Note the ordering on the LLM path: `enrichModels()` runs over the **full**
catalogue before `filterModels()`, because the efficiency score and the FinOps
badge are percentile ranks. Filtering first would make the badge mean something
different depending on which filters the caller happened to pass.

### Use Case Profiles (for cost estimation)
- supportTicket, knowledgeQA, meetingSummary, marketingContent
- codingTask, invoiceProcessing, callSummary, agentWorkflow

Each profile defines typical input/output token counts per request.

### Volume Presets
- 10k, 100k, 1m requests/month

---

## Constraints

- No API keys required — both optimtoken endpoints are public, unauthenticated and CORS-open
- No database — stateless tool execution
- `/api/pricing` costs ~0.3s on an edge-cache HIT and ~50s on a MISS, and every distinct query string is its own cache entry. Always request the canonical `?region=` URL and filter locally: narrowing the URL trades a warm hit for a cold rebuild *and* returns less data. Results are memoised per region for 60 minutes, then served stale for up to 12 hours while a refresh runs in the background.
- **The two endpoints need different timeouts, and conflating them is a shipped bug.** Measured 2026-08-17: `/api/llm-models` is 209 ms cold / 31 ms warm; `/api/pricing` is **50.5 s cold** / 80–350 ms warm, because the site assembles six provider APIs inside a `maxDuration: 60` function. `compare-compute-pricing` shipped with the LLM endpoint's 20 s budget, which is *shorter than the cold path always takes* — so a cold edge entry could not reach tier 1 at all and the tool served the static snapshot on every call. `UPSTREAM_TIMEOUT_MS` in `lib/compute-pricing.ts` is now 55 s and guarded by a test against `MEASURED_COLD_REBUILD_MS`. Do not "tune it down" to match the LLM side.
- **A short budget plus a retry does not work here, and this was measured, not assumed.** Aborting at 20 s against a guaranteed-cold cache key and re-probing every 5 s left the key cold at t+236 s: an abandoned request leaves no warm entry behind, and each short probe just starts another rebuild it also abandons. One request has to see the rebuild through.
- **Do not rename or drop `structuredContent` fields.** `app.json` and the `ui://widget/*` resources are bound to the current shape. Add fields; do not reshape.
- Brand color is Chartreuse `#ACE849` for OptimNow identity, but **the widgets do not currently use it** — `web/src/` ships a neutral grey palette with Tailwind-style accents (`#16a34a` for positive, `#6b7280` for muted). Treat the chartreuse as the target if someone brands the widgets, not as a description of what is there.
- Widget UIs consume `useToolInfo()` hook from Skybridge (not React props)

---

## Dependencies

- `skybridge` — MCP app framework
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `zod` — Input schema validation
- `react`, `react-dom` — Widget UI rendering
- `vite` — Build tooling
- `alpic` — Deployment CLI (devDependency)
- `tsx` — TypeScript loader; `npm test` runs `node --import tsx --test` (devDependency)
- `typescript`, `@skybridge/devtools`, `@types/*` (devDependencies)

Node **>= 24.14** per `engines`, matched by CI. A lower local Node still runs
`tsx` and the tests, but do not assume it matches the deployed runtime.
