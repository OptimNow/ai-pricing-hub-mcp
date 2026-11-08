# CLAUDE.MD - AI Pricing Hub MCP App

**Project:** AI Pricing Hub MCP
**Framework:** Skybridge (MCP App Framework)
**Repo:** github.com/OptimNow/ai-pricing-hub-mcp (public, MIT)
**Deployed:** https://optimtoken-mcp.optimnow.io/mcp (Fly.io app ai-pricing-hub-mcp, since 2026-10-07)

---

## Commits and pull requests

Do not add `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines to commit messages or pull request descriptions.

## What This Project Does

An MCP (Model Context Protocol) app that provides AI/LLM model comparison, cost estimation, and cloud compute pricing tools as interactive widgets inside AI conversations (Claude, ChatGPT, VS Code, Goose). Built with Skybridge framework.

**Origin:** Business logic copied from the standalone web app cloud-sparkle-compare, which has since been renamed to [OptimNow/ai-pricing-hub](https://github.com/OptimNow/ai-pricing-hub) (private). The local checkout is still the `cloud-sparkle-compare` folder, and this file uses the old name throughout. It is deployed at `optimtoken.optimnow.io`, which is what this app reads its pricing from. The original app remains untouched.

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
side, change the other — `lib/web-mirror.test.ts` fails if they drift.
3f. **Optimized cost is conditional, and the widgets must say so.** Batch pricing
needs an async workload *and* a model that publishes batch rates; cache savings
need a cacheable prefix *and* a published cache-read rate. `optimizationLevers()`
returns which of the four conditions held, and `leverSummary()` turns that into a
sentence. A bare 0% saving reads as a bug; "this model publishes no batch rate"
reads as an answer. `leverSummary()` is duplicated in `web/src/format.ts` for the
widgets — `lib/web-mirror.test.ts` keeps the two in step.
4. **ELO scores** from Chatbot Arena are merged with pricing data for quality ranking
5. **Business metrics** (use-case profiles, efficiency scoring) from `llm-business-metrics.ts` add FinOps context
6. **Compute pricing** comes from `GET /api/pricing` (~6,000 instances across 7 providers), with the 137-row static array in `data/pricing-data.ts` as fallback only. Category, processor and use-case enrichment is applied locally to whichever rows arrive. It stopped being a static-only tool when optimtoken became the source of truth, and `openWorldHint` was corrected to `true` to match.
7. **Price tier and openness are separate axes.** `category` is Frontier / Mid-tier / Budget / Image and answers "what does it cost". `openness` (derived from the licence in `openness.ts`) answers "whose hardware can run it". They used to be folded together as an "Open Weights" category, which forced every open model to give up one label to earn the other — do not reintroduce it.
8. **The FinOps Friendly badge gates on percentiles, not fixed numbers:** top 40% on ELO, top 30% on efficiency, cheapest 70% on list price, and a stable release. The tool also returns what those percentiles land on today (`finopsBadge.minElo`, `finopsBadge.maxBlendedPrice`) so the badge is auditable.

---

## Dependencies

- `skybridge`: MCP app framework. Pinned `^0.35.21`: at least 0.35.21 because that
  release started hashing the `x-alpic-forwarded-url` header for `ui.domain`,
  which `pinPublicUrl` relies on to make widgets pass claude.ai's validation,
  and below 0.36.0 because 0.36 removes the `mountWidget` API the five widgets
  are built on. Moving past it is a migration, not a bump; re-read
  `dist/server/server.js` (`registerWidgetResource`) for the domain derivation
  before trusting the pin on a new version.
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `zod` — Input schema validation
- `react`, `react-dom` — Widget UI rendering
- `vite` — Build tooling
- `tsx` — TypeScript loader `npm test` runs node --test through (devDependency)

## Where the rest lives

`docs/DESIGN.md` holds the other sections of this file, moved verbatim on 2026-11-08. It is not
loaded automatically: read the section your task touches. A reference to "CLAUDE.md, <section>"
means that section in `docs/DESIGN.md`.

Sections in `docs/DESIGN.md`:

- Architecture
- Development
- Keeping in sync with cloud-sparkle-compare
- Data Flow
- Constraints

## Maintaining this file

Keep this file under 200 lines. It holds what an agent needs in every session. A new decision, its reasoning or its history goes into the matching section of `docs/DESIGN.md`, or a new section listed above. Add a rule here only if an agent would break something without it.

