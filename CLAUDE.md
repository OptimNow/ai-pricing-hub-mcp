# CLAUDE.MD - AI Pricing Hub MCP App

**Project:** AI Pricing Hub MCP
**Framework:** Skybridge (MCP App Framework)
**Repo:** github.com/OptimNow/ai-pricing-hub-mcp (public, MIT)
**Deployed:** https://ai-pricing-hub-mcp-9604f763.alpic.live

---

## What This Project Does

An MCP (Model Context Protocol) app that provides AI/LLM model comparison, cost estimation, and cloud compute pricing tools as interactive widgets inside AI conversations (Claude, ChatGPT, VS Code, Goose). Built with Skybridge framework.

**Origin:** Business logic copied from the standalone web app cloud-sparkle-compare, which has since been renamed to [OptimNow/ai-pricing-hub](https://github.com/OptimNow/ai-pricing-hub) (private). The local checkout is still the `cloud-sparkle-compare` folder, and this file uses the old name throughout. It is deployed at `optimtoken.optimnow.io`, which is what this app reads its pricing from. The original app remains untouched.

---

## Architecture

```
Framework:    Skybridge (MCP App Framework)
Language:     TypeScript
Build:        Vite + Skybridge plugins
UI:           React widgets (rendered via structuredContent)
Deployment:   Alpic Cloud
Transport:    Streamable HTTP at root URL /
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
| Compute tool | `GET /api/pricing?region=` | — | static snapshot (137 rows) |

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
│       ├── index.ts                  # MCP server — 5 tool/widget definitions
│       ├── serialisation-contract.test.ts  # Source-level guard: rounding + provenance
│       ├── lib/
│       │   ├── optimtoken-api.ts     # Base URL constant + shared fetch/timeout discipline
│       │   ├── compute-pricing.ts    # /api/pricing fetch, region, per-column provenance
│       │   ├── output-schema.ts      # Forces JSON Schema 2020-12 on tool outputSchemas
│       │   ├── llm-models.ts         # 3-tier model fetch, ELO enrichment, name resolution
│       │   ├── llm-business-metrics.ts # Efficiency scoring, use-case profiles, FinOps badge
│       │   ├── roi-link.ts           # Deep link into the sister AI ROI Calculator
│       │   ├── openness.ts           # Licence → self-hostability bucket
│       │   ├── pricing-normalize.ts  # Publishable-pricing guard (rejects -1 router rows)
│       │   ├── compute-categories.ts # Compute instance categorization + enrichment
│       │   └── *.test.ts             # data-sources, llm-business-metrics, output-schema, scale
│       └── data/
│           ├── pricing-data.ts       # Static fallback LLM pricing + 137 compute instances
│           └── region-api-map.ts     # Cloud region mappings — currently unimported
├── web/
│   ├── src/
│   │   ├── helpers.ts                # Skybridge widget helpers (generateHelpers)
│   │   ├── index.css                 # Colour tokens on :root + dark-mode overrides
│   │   ├── format.ts                 # formatCost / formatBudget / savingsPct / leverSummary
│   │   ├── scale.ts                  # log10 axis maths for the cost/ELO scatter
│   │   ├── components/index.tsx      # WidgetShell, Badge, Card, Notice, error/empty states
│   │   └── widgets/
│   │       ├── compare-llm-models/index.tsx
│   │       ├── estimate-llm-cost/index.tsx
│   │       ├── compare-models-side-by-side/index.tsx
│   │       ├── recommend-llm-model/index.tsx
│   │       └── compare-compute-pricing/index.tsx
│   └── vite.config.ts                # Skybridge Vite plugin
├── docs/
│   ├── chatgpt-submission.md         # Blockers + portal run for the ChatGPT directory
│   └── chatgpt-app-smoke-tests.md    # The positive / negative cases the portal asks for
├── scripts/
│   ├── refresh-llm-fallback.mjs      # Re-snapshots the static model list
│   └── check-serialisation-precision.mjs  # Manual: walk a live server for float noise
├── .github/workflows/ci.yml          # typecheck + test + build on every PR
├── alpic.json                        # Alpic deployment config
├── server.json                       # Manifest for the official MCP registry
├── AGENTS.md
├── package.json
├── tsconfig.json                     # Build + typecheck (excludes *.test.ts)
└── tsconfig.test.json                # Type-checks the tests
```

Tests live beside their subjects: `lib/data-sources.test.ts`,
`lib/llm-business-metrics.test.ts`, `lib/output-schema.test.ts` and
`serialisation-contract.test.ts`.

---

## MCP Tools

### Tool 1: `compare-llm-models`
- **Type:** Widget (has UI)
- **Input:** Optional filters (provider, category = price tier, openness, capability, price range, min ELO, use-case preset, volume)
- **Output:** Sorted/filtered model comparison with pricing, ELO scores, efficiency, monthly costs, and the concrete thresholds behind the FinOps Friendly badge
- **Data Source:** optimtoken API → direct OpenRouter → static fallback
- **Widget:** Comparison cards, with a local List / Cost-vs-ELO toggle. The scatter is inline SVG (log10 cost on x, Arena ELO on y, chartreuse for FinOps Friendly); axis maths lives in `web/src/scale.ts`. Models without an ELO score are counted as "not plotted", never silently dropped.

### Tool 2: `estimate-llm-cost`
- **Type:** Widget (has UI)
- **Input:** Model name + use-case preset (or custom token counts + volume)
- **Output:** Per-request and monthly cost breakdown per model, plus `savingsPct` and the four optimization-lever booleans (`batchEligible`/`cacheEligible`/`batchApplied`/`cacheApplied`) per entry
- **Widget:** Paired list-vs-optimized bars per use case. Both levers are conditional, so when neither applies the row says *why* — "this model publishes no batch rate" — instead of drawing a 0% saving.

### Tool 3: `compare-models-side-by-side`
- **Type:** Widget (has UI)
- **Input:** `models` (2-4 free-text names) + optional `volumePreset`
- **Output:** Each named model against all 8 use-case profiles, list and optimized, plus a `resolution` entry per name. A name that matched nothing, matched several models, or duplicated an earlier pick is reported rather than silently changing the columns — a missing column is not a free model.
- **Widget:** Use-case × model cost matrix, cheapest cell per row highlighted

### Tool 4: `recommend-llm-model`
- **Type:** Widget (has UI)
- **Input:** `useCasePreset` (required) + optional `volumePreset`, `maxMonthlyBudget`, `minElo`, `requiredCapability`, `openness`
- **Output:** Top 3 by value score as structured facts — efficiency rank, ELO, list and optimized cost, FinOps flag, volatility, and a per-constraint satisfied/violated breakdown — leaving the narrative to the calling model. An over-constrained query sets `overConstrained` and returns `nearMisses` instead, ordered by how far each is from the *numeric* constraints, each carrying the constraint it failed. Also carries `roiCalculatorUrl`.
- **Widget:** Three podium cards with a per-constraint checklist

### Tool 5: `compare-compute-pricing`
- **Type:** Widget (has UI)
- **Input:** `region` (us-east | us-west | europe | asia-pacific, default us-east) plus filters (provider, vCPUs, memory, category, processor, use case, sort). No OS filter: the tool serves Linux only, and the upstream Windows rows are filtered out.
- **Output:** Filtered cloud compute instance comparison across 7 providers, plus `provenance.priceTypes` — which price columns are live, which are static constants, and which are unavailable
- **Data Source:** `GET /api/pricing` (~6,000 instances) with the 137-row static array as fallback only
- **Widget:** Compute pricing table

---

## Development

```bash
npm install
npm run dev        # Skybridge dev server with DevTools emulator
npm run typecheck  # tsc --noEmit over both tsconfigs (src and tests)
npm test           # node --test over server/src/**/*.test.ts
npm run build      # Production build
npm run start      # Start production server (serves /mcp locally)
```

`.github/workflows/ci.yml` runs typecheck, test and build on every PR.

Note: `npm run typecheck` writes `dist/tsconfig.tsbuildinfo`. Because it does not
emit, a following `npm run build` can believe the server output is already up to
date and skip compiling it — if `dist/server/` looks stale, delete it and rebuild.

`scripts/check-serialisation-precision.mjs` is deliberately outside CI: it needs a
running server and the live catalogue. Run it by hand after touching cost code.

### Deployment

```bash
npm run deploy     # alpic deploy
```

Deploys to Alpic Cloud. The streamable HTTP endpoint is served at root `/` — that
is the URL `server.json` publishes. Locally, `npm run start` serves it at `/mcp`.

**Alpic collects files through the git index, not the working tree.** Deleting a
tracked file without staging the deletion makes the deploy fail with `ENOENT` on
a path that is no longer on disk. Commit deletions before deploying.

### Connecting to Claude Desktop

Add to `claude_desktop_config.json`, using the app's native HTTP transport:
```json
"ai-pricing-hub": {
  "type": "http",
  "url": "https://ai-pricing-hub-mcp-9604f763.alpic.live/"
}
```

Prefer this over an `npx mcp-remote` wrapper. The wrapper opens a GET SSE stream
this server answers with 400, which stalls startup behind a Cloudflare timeout.

---

## Key Design Decisions

1. **All 5 tools use `registerWidget()`** — each has a React widget UI, and each is restricted to `hosts: ["mcp-app"]`. Omitting `hosts` publishes every widget twice (`ui://widgets/apps-sdk/` *and* `ui://widgets/ext-apps/`), which listed each one twice in Claude's attachment picker; the apps-sdk variant is the legacy shape.
2. **optimtoken.optimnow.io is the source of truth** for both LLM and compute pricing. Direct OpenRouter is kept as a working second tier for LLM models only, never as the preferred one.
3. **Static fallback** in `data/pricing-data.ts` ensures the app works without network access
3b. **Provenance ships with every response.** `structuredContent.provenance` carries the upstream timestamp, which tier served, and — for compute — `sources`, `sourceRegions` and `priceTypes`. AWS Savings Plans and GCP CUDs are `static` upstream (us-east-1 constants scaled by a region multiplier); serving those beside live on-demand rates without saying which is which gives a FinOps answer nobody can audit. `provenance.staticPriceColumns` pre-walks `priceTypes` so the non-live columns are one field away.
3c. **Tool `outputSchema`s must go through `outputSchema()`** in `lib/output-schema.ts`. The MCP SDK's `toJsonSchemaCompat()` defaults its target to `draft-7` (still true at SDK 1.30.0), and hosts that validate 2020-12 only — Claude Code among them — reject such a tool *before its handler runs*. Passing a pre-built JSON Schema object is not an alternative: `AnySchema` is Zod-only, so a plain object makes `normalizeObjectSchema()` return `undefined` and the schema is silently dropped.
3d. **The widgets share one component set and one palette.** `web/src/components/` holds the shell,
badges, cards and empty/error states; `web/src/index.css` defines every colour as a custom property on
`:root`, redefined under `prefers-color-scheme: dark`. No widget may contain a hard-coded hex literal —
there were 95, and they made dark mode impossible. `--brand` (#ACE849) is invariant for fills;
`--brand-text` darkens in light mode, where the pure hue fails contrast on white.
3e. **One set of cost formatters.** `web/src/format.ts` is character-identical to `formatMicroCost` /
`formatMonthlyBudget` in `llm-business-metrics.ts`. There were previously three implementations that
disagreed, so the widget could render `$450.00` where the text the model reads said `$450`. Change one
side, change the other.
3f. **Optimized cost is conditional, and the widgets must say so.** Batch pricing
needs an async workload *and* a model that publishes batch rates; cache savings
need a cacheable prefix *and* a published cache-read rate. `optimizationLevers()`
returns which of the four conditions held, and `leverSummary()` turns that into a
sentence. A bare 0% saving reads as a bug; "this model publishes no batch rate"
reads as an answer. `leverSummary()` is duplicated in the estimate widget — keep
the two in step.
4. **ELO scores** from Chatbot Arena are merged with pricing data for quality ranking
5. **Business metrics** (use-case profiles, efficiency scoring) from `llm-business-metrics.ts` add FinOps context
6. **Compute pricing** comes from `GET /api/pricing` (~6,000 instances across 7 providers), with the 137-row static array in `data/pricing-data.ts` as fallback only. Category, processor and use-case enrichment is applied locally to whichever rows arrive. It stopped being a static-only tool when optimtoken became the source of truth, and `openWorldHint` was corrected to `true` to match.
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

**One divergence that is now dormant, and must stay.** `optimizationLevers()`
here refuses to apply a lever that *raises* the cost, and `optimizedUseCaseCost()`
returns the list cost exactly when no lever is pulled. The original applies batch
pricing whenever both batch fields are present, which for Zhipu GLM 5.2 — batch
$0.70/$2.20 against list $0.49/$1.54 — produced an "optimized" cost 34% dearer
than list, reported as a 0% saving with both levers named as the reason.

Upstream PR #60 (2026-08-19) closed the gap from the other end: it drops any
`:batch` row whose rate sits above list, so GLM 5.2 now publishes no batch row at
all and the bad input never reaches either formula. Measured 2026-08-19 over
258 models x 8 profiles, against both the live API and the refreshed snapshot: the
two formulas differ on **0 of 2,064 pairs**, so the two apps agree to the cent
again.

The guard is therefore dormant, not redundant — it is the only thing standing
between a future upstream data regression and an "optimized" price dearer than
list. Do not delete it to close a divergence that no longer shows up in the
numbers. It stays pinned by four tests in `llm-business-metrics.test.ts`: two on
synthetic dear-batch/dear-cache models, which is what keeps them meaningful now
that no real row triggers them, and two whole-catalogue sweeps.

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
- `/api/pricing` costs ~0.3s on an edge-cache HIT and 6–11s on a MISS (re-measured 2026-08-18; it was ~50s before upstream PR #57), and every distinct query string is its own cache entry. Always request the canonical `?region=` URL and filter locally: narrowing the URL trades a warm hit for a cold rebuild *and* returns less data. Results are memoised per region for 60 minutes, then served stale for up to 12 hours while a refresh runs in the background.
- **The two endpoints need different timeouts, and conflating them is a shipped bug.** Re-measured 2026-08-18 (24 cold samples across all four regions, over three separate runs — the first 8 gave a max of 8.9 s and two later runs both beat it, so the sample had to be widened): `/api/llm-models` is 0.19–0.42 s cold / 31 ms warm; `/api/pricing` is **6.1–10.7 s cold** / 80–350 ms warm, because the site assembles six provider APIs inside a `maxDuration: 60` function. `compare-compute-pricing` shipped with the LLM endpoint's 20 s budget against a cold path that then took 50.5 s — *shorter than the cold path always took* — so a cold edge entry could not reach tier 1 at all and the tool served the static snapshot on every call. `UPSTREAM_TIMEOUT_MS` in `lib/compute-pricing.ts` is **25 s**, guarded by two tests: it must exceed `MEASURED_COLD_REBUILD_MS`, and it must keep `MIN_COLD_PATH_HEADROOM` (2x) over it.
  **This paragraph used to say 55 s and "do not tune it down"; that was correct advice against a 50.5 s cold path, and upstream PR #57 (2026-08-18) cut that path by ~6x.** The rule it was protecting has not changed — never size this budget from the LLM endpoint's profile — but the number that satisfies it has. Re-measure before moving it again, and move all four places together (the two constants, the guard tests, and this bullet). Do not restore 55 s just because this paragraph once said so.
- **A short budget plus a retry does not work here, and this was measured, not assumed.** Aborting at 20 s against a guaranteed-cold cache key and re-probing every 5 s left the key cold at t+236 s (measured 2026-08-17, against the 50.5 s rebuild; not re-run since PR #57, but the mechanism does not depend on the rebuild's duration): an abandoned request leaves no warm entry behind, and each short probe just starts another rebuild it also abandons. One request has to see the rebuild through.
- **The compute catalogue is enriched once, not per request.** `servableCatalogue()`
  in `index.ts` memoises `enrichInstances()` + the Linux filter in a `WeakMap`
  keyed by the catalogue array's identity — the memo in `compute-pricing.ts` hands
  back the same array for the life of an entry and a fresh one after a refresh, so
  identity is exactly the right invalidation key. Enriching per request cost 7 ms
  and ~2.6 MB every call, 41% of it on Windows rows the tool discards immediately.
  `catalogSize` counts servable rows (~3,573), not the raw catalogue (~6,052):
  a denominator that includes rows no query can reach is not a denominator.
- **The caches are warmed at boot, for one region only.** `warmCaches()` at the
  foot of `index.ts` fires `fetchLLMModels()` and `fetchComputeInstances(us-east)`
  after `server.run()`, fire-and-forget. Measured against production on
  2026-08-18: a freshly deployed process answered `compare-compute-pricing` in
  **8.4 s** and then in ~250 ms — the first caller was funding the rebuild.
  Locally, first call after boot is **231 ms without the warm-up and 23 ms with
  it** (that gap is small only because the upstream edge cache happened to be
  warm; on the edge MISS that follows a deploy it is the full ~8 s).

  This is only worth doing because **the Alpic process outlives a request** —
  three MCP sessions minutes apart all reported the same
  `provenance.upstreamTimestamp`, which is what proves the memo survives between
  requests. On a per-request runtime the warm-up would be pure waste, so
  re-check that before trusting this.

  It does **not** outlive a deploy: the production logs show two boots 50
  seconds apart during the rollout of this change, each re-running the warm-up,
  so budget two upstream fetches per restart rather than per day. That is cheap
  while the upstream edge cache is warm (measured 205-324 ms per fetch) and
  would be 7-11 s per fetch if it is cold. If restarts ever become frequent for
  reasons other than deploys, re-measure before assuming this is still free.

  Three rules it must keep:
  - **Never block `server.run()`.** The upstream can take 11 s; awaiting it turns
    a slow site into a failed boot.
  - **Never cache a failure.** The fetchers do not cache snapshot fallbacks, so a
    failed warm leaves the cache empty and the first real caller pays what it
    would have paid anyway. Keep it that way.
  - **Never reach upstream from a test or a CI build.** Guarded by
    `NODE_ENV === "test"` and `SKIP_CACHE_WARMUP=1`.

- **Alpic's `duration` field is not application latency.** In the production
  logs, the first request after each boot reported `duration: 3618ms` and
  `duration: 3127ms` while only 6-7 ms elapsed between its own START and END
  timestamps. It appears to include container start-up. So there is a ~3 s
  cold-start on the first request after a restart that `warmCaches()` cannot
  remove — it runs after the app has booted — and that field should not be used
  to judge handler performance. Time calls from the client instead.

- **Warming that was considered and deliberately rejected.** Each of these is a
  plausible next step that costs more than it returns; do not add them without
  new measurements that contradict the ones below.
  - **All four regions at boot.** Four upstream rebuilds per process start — each
    one six provider APIs assembled live — for three regions a given deployment
    may never be asked about. The other three warm on first use for ~7 s once
    (measured: asia-pacific 7.1 s cold, then 447 ms). Paying a known cost against
    the site to avoid a maybe-cost is the wrong trade.
  - **A periodic refresh timer.** The 60-minute TTL is already invisible to
    callers: `fetchComputeInstances` serves the stale entry immediately and
    refreshes behind it for up to 12 hours. A timer would only cover a gap longer
    than 12 hours, at ~26 upstream rebuilds a day per region on an otherwise idle
    server. Wrong ratio.
  - **An external cron pinging the endpoint.** Same effect as the timer, plus
    infrastructure, and it only earns its keep if Alpic scales the process to
    zero between requests — which the measurement above says it does not.
  - **Warming from `primeComputePricingCache()`.** That export is a test seam
    that takes an already-built result; it is not a fetch and cannot warm
    anything on its own.

- **Both fetchers dedupe in-flight requests.** Five concurrent cold callers used
  to produce five upstream rebuilds each. The `refreshing` set only ever covered
  the stale-while-revalidate branch; the cold branch — the one callers wait on —
  had none. Keep the `finally` that clears the shared promise, or one failure
  pins every later caller to it.
- **Do not rename or drop `structuredContent` fields.** The widgets and the `ui://widgets/ext-apps/*` resources are bound to the current shape. Add fields; do not reshape. (`app.json` used to be bound to it too; it was deleted once ChatGPT moved to submitting the MCP server directly.)
- **Widgets are registered for the `mcp-app` host only.** Omitting `hosts` on `registerWidget` publishes each widget twice, under `ui://widgets/apps-sdk/` *and* `ui://widgets/ext-apps/`, with the same display name, so hosts list every widget twice in their resource pickers. `mcp-app` emits `text/html;profile=mcp-app` and `_meta.ui.resourceUri`, which is what both Claude and current ChatGPT want; `apps-sdk` is the legacy shape. See `docs/chatgpt-submission.md`.
- Brand color: Chartreuse (#ACE849) for OptimNow identity
- Widget UIs consume `useToolInfo()` hook from Skybridge (not React props)

---

## Dependencies

- `skybridge` — MCP app framework
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `zod` — Input schema validation
- `react`, `react-dom` — Widget UI rendering
- `vite` — Build tooling
- `alpic` — Deployment CLI (devDependency)
- `tsx` — TypeScript loader `npm test` runs node --test through (devDependency)
