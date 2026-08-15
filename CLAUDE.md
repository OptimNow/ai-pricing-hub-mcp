# CLAUDE.MD - AI Pricing Hub MCP App

**Project:** AI Pricing Hub MCP
**Framework:** Skybridge (MCP App Framework)
**Repo:** github.com/OptimNow/ai-pricing-hub-mcp (private)
**Deployed:** https://ai-pricing-hub-mcp-9604f763.alpic.live

---

## What This Project Does

An MCP (Model Context Protocol) app that provides AI/LLM model comparison, cost estimation, and cloud compute pricing tools as interactive widgets inside AI conversations (Claude, ChatGPT, VS Code, Goose). Built with Skybridge framework.

**Origin:** Business logic copied from the standalone web app [cloud-sparkle-compare](https://github.com/jlati/cloud-sparkle-compare) (private). The original app remains untouched.

---

## Architecture

```
Framework:    Skybridge (MCP App Framework)
Language:     TypeScript
Build:        Vite + Skybridge plugins
UI:           React widgets (rendered via structuredContent)
Deployment:   Alpic Cloud
Transport:    SSE (Server-Sent Events) at root URL /
Data:         OpenRouter API (live) + static fallback pricing data
```

### Project Structure

```
ai-pricing-hub-mcp/
├── server/
│   └── src/
│       ├── index.ts                  # MCP server — 3 tool/widget definitions
│       ├── lib/
│       │   ├── llm-models.ts         # OpenRouter API fetching + ELO enrichment
│       │   ├── llm-business-metrics.ts # Efficiency scoring, use-case profiles, FinOps badge
│       │   ├── openness.ts           # Licence → self-hostability bucket
│       │   ├── pricing-normalize.ts  # Publishable-pricing guard (rejects -1 router rows)
│       │   └── compute-categories.ts  # Compute instance categorization + enrichment
│       └── data/
│           ├── pricing-data.ts       # Static fallback LLM pricing + compute instances
│           └── region-api-map.ts     # Cloud region mappings
├── web/
│   └── src/
│       ├── helpers.ts                # Skybridge widget helpers
│       ├── index.css                 # Widget styles
│       └── widgets/
│           ├── compare-llm-models/
│           │   └── index.tsx         # Model comparison table widget
│           ├── estimate-llm-cost/
│           │   └── index.tsx         # Cost estimation cards widget
│           └── compare-compute-pricing/
│               └── index.tsx         # Compute pricing table widget
├── alpic.json                        # Alpic deployment config
├── package.json
├── tsconfig.json
└── vite.config.ts                    # Skybridge Vite plugin
```

---

## MCP Tools

### Tool 1: `compare-llm-models`
- **Type:** Widget (has UI)
- **Input:** Optional filters (provider, category = price tier, openness, capability, price range, min ELO, use-case preset, volume)
- **Output:** Sorted/filtered model comparison with pricing, ELO scores, efficiency, monthly costs, and the concrete thresholds behind the FinOps Friendly badge
- **Data Source:** OpenRouter API (live) with static fallback
- **Widget:** Interactive comparison table

### Tool 2: `estimate-llm-cost`
- **Type:** Widget (has UI)
- **Input:** Model name + use-case preset (or custom token counts + volume)
- **Output:** Per-request and monthly cost breakdown per model
- **Widget:** Cost comparison cards

### Tool 3: `compare-compute-pricing`
- **Type:** Widget (has UI)
- **Input:** Filters (provider, vCPUs, memory, category, processor, use case, sort). No OS filter: the dataset is 100% Linux, so offering one only ever returned zero rows.
- **Output:** Filtered cloud compute instance comparison across 7 providers
- **Data Source:** Static pricing data (AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba)
- **Widget:** Compute pricing table

---

## Development

```bash
npm install
npm run dev        # Skybridge dev server with DevTools emulator (port 3000)
npm run build      # Production build
npm run start      # Start production server
```

### Deployment

```bash
npx alpic deploy --yes --project-name ai-pricing-hub-mcp
```

Deploys to Alpic Cloud. SSE endpoint is served at root `/`.

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
2. **OpenRouter API** is the primary data source for LLM models (public, no auth needed)
3. **Static fallback** in `data/pricing-data.ts` ensures the app works without network access
4. **ELO scores** from Chatbot Arena are merged with pricing data for quality ranking
5. **Business metrics** (use-case profiles, efficiency scoring) from `llm-business-metrics.ts` add FinOps context
6. **Compute pricing** is static data from 7 cloud providers with category enrichment
7. **Price tier and openness are separate axes.** `category` is Frontier / Mid-tier / Budget / Image and answers "what does it cost". `openness` (derived from the licence in `openness.ts`) answers "whose hardware can run it". They used to be folded together as an "Open Weights" category, which forced every open model to give up one label to earn the other — do not reintroduce it.
8. **The FinOps Friendly badge gates on percentiles, not fixed numbers:** top 40% on ELO, top 30% on efficiency, cheapest 70% on list price, and a stable release. The tool also returns what those percentiles land on today (`finopsBadge.minElo`, `finopsBadge.maxBlendedPrice`) so the badge is auditable.

---

## Keeping in sync with cloud-sparkle-compare

The LLM logic here is a **manual port** of [cloud-sparkle-compare](https://github.com/OptimNow/cloud-sparkle-compare) — `api/llm-models.ts`, `src/lib/llm-business-metrics.ts`, `src/lib/openness.ts`, `src/lib/pricing-normalize.ts`. No code is shared, so drift is the default state: that repo ships daily, this one does not.

Two things keep the two honest:

- `npm run refresh-fallback` re-snapshots the static model list from `https://optimtoken.optimnow.io/api/llm-models` into the `LLM-FALLBACK-START/END` markers in `server/src/data/pricing-data.ts`. It refuses to write on a collapsed catalogue, and re-derives the price tier for any row still carrying the retired `Open Weights` category (a deployment on schemaVersion 1.0).
- The cost formulas in `llm-business-metrics.ts` are kept **character-identical** to the original's. The coherence test is that both apps produce the same cost to the cent for the same model and use case.

Before adding LLM business logic here, check whether `cloud-sparkle-compare` already has it and port rather than reinvent.

---

## Data Flow

```
OpenRouter API → fetchLLMModels() → filterModels() → enrichModels() → structuredContent
                       ↓ (fallback)
              pricing-data.ts (static)
```

### Use Case Profiles (for cost estimation)
- supportTicket, knowledgeQA, meetingSummary, marketingContent
- codingTask, invoiceProcessing, callSummary, agentWorkflow

Each profile defines typical input/output token counts per request.

### Volume Presets
- 10k, 100k, 1m requests/month

---

## Constraints

- No API keys required — OpenRouter public endpoint, no auth
- No database — stateless tool execution
- Compute pricing is static (no live cloud API calls)
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
