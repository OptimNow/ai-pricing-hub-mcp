# OptimToken MCP

> Built by [OptimNow](https://optimnow.io). Ask an AI assistant what a model or an
> instance actually costs, and get a dated, sourced figure instead of a number the
> model remembers from its training data.

[![CI](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml)
[![MCP Server](https://img.shields.io/badge/MCP-Server-7C3AED)](https://modelcontextprotocol.io/)
[![Node](https://img.shields.io/badge/Node-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Prices](https://img.shields.io/badge/prices-OptimToken-ACE849?labelColor=2C2C2C)](https://optimtoken.optimnow.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/OptimNow/ai-pricing-hub-mcp?style=flat)](https://github.com/OptimNow/ai-pricing-hub-mcp/stargazers)

---

## Connect in 30 seconds

The server is hosted, so there is nothing to install.

```
https://optimtoken-mcp.optimnow.io/mcp
```

The path is `/mcp`. The server is tools only: answers come back as text in the
conversation, with the same figures as structured data.

| Client | How to add it |
|---|---|
| <img src="https://img.shields.io/badge/-Claude%20Code-D97757?logo=anthropic&logoColor=white" alt="Claude Code" height="22"/> | `claude mcp add --transport http optimtoken https://optimtoken-mcp.optimnow.io/mcp` |
| <img src="https://img.shields.io/badge/-Claude.ai%20%2F%20Desktop-D97757?logo=anthropic&logoColor=white" alt="Claude.ai / Desktop" height="22"/> | **Settings → Connectors → Add custom connector**, paste the URL above |
| <img src="https://img.shields.io/badge/-ChatGPT-10A37F?logo=openai&logoColor=white" alt="ChatGPT" height="22"/> | **Settings → Connectors → Add**, paste the URL |
| <img src="https://img.shields.io/badge/-Cursor-000000?logo=cursor&logoColor=white" alt="Cursor" height="22"/> <img src="https://img.shields.io/badge/-Windsurf-3DDC91?logoColor=white" alt="Windsurf" height="22"/> <img src="https://img.shields.io/badge/-VS%20Code-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code" height="22"/> | Add an HTTP MCP server entry pointing at the URL |

Then just ask:

> *"We send 200k support tickets a month at about 1,500 input tokens each. Which model gives me the best quality per euro, and what would it cost?"*

---

## Why this exists

Model prices change weekly, and a language model's idea of them is frozen at its
training cutoff. Ask one what Claude or GPT costs and you get a confident answer that
was true some months ago, with no date attached and no way to tell. The same applies to
cloud instance rates, which additionally vary by region in ways nobody memorises.

This server replaces recall with a lookup:

- **Live prices, not remembered ones.** Every LLM figure comes from the
  [OptimToken](https://optimtoken.optimnow.io) catalogue, which tracks 250+ models and
  refreshes daily.
- **Corrected prices.** OptimToken keeps a committed price archive, a verified overrides
  table checked against vendor pricing pages, and an anomaly check that alarms on the
  half-price and double-price breaks upstream feeds occasionally publish. This server
  asks that catalogue rather than re-deriving prices itself.
- **Cost per request, not cost per million tokens.** Price-per-token comparisons hide
  the thing you actually pay for. The tools apply your token shape, your cache hit rate
  and batch eligibility, and return a figure per request and per month.
- **Every answer carries its provenance.** Which tier served it, and whether the prices
  were verified.

---

## Tools

| Tool | What it answers |
|---|---|
| **`compare-llm-models`** | "What is out there?" Browse and filter the catalogue on price, quality (Chatbot Arena ELO), efficiency and capabilities, with a self-hostability read from the licence. Ordered by ELO, or by efficiency, cost for a workload, or price with `sortBy`. |
| **`recommend-llm-model`** | "Just tell me which one." A ranked top 3 for one workload under your constraints (budget, minimum ELO, required capability, self-hostability), each with a per-constraint satisfied or violated breakdown as the evidence. Over-constrained queries return the nearest misses, labelled as such. A model whose maker has announced its retirement is never recommended, and the ones that would have ranked are named. |
| **`compare-models-side-by-side`** | "How do these specific ones compare?" 2 to 4 named models across all 8 use case profiles at a chosen monthly volume, list and optimized cost for each. |
| **`estimate-llm-cost`** | "What will this cost us per month?" Per-request and monthly cost for your own volume, token shape, cache hit rate and batch eligibility. |
| **`compare-compute-pricing`** | "What should we run it on?" Compute instance rates across AWS, Azure, GCP, OCI, OVH, DigitalOcean and Alibaba, by region and category: on-demand, spot, and 1- and 3-year commitments, each with what it saves against on-demand. |
| **`compare-model-hosts`** | "Where do we buy it?" For 1 to 4 named models: how many hosts sell each, the cheapest, the dearest, the model maker's own rate, promotional listings, then every host with its rate, the platforms that list the model and its Amazon Bedrock regions, and what your workload costs at each. Says when the cheap host serves a quantized build. |
| **`estimate-self-hosting-breakeven`** | "API, or our own GPUs?" The monthly volume at which renting an instance costs the same as paying a model's API per token, at every rate the instance lists (on demand, spot, commitments) and against the API at list price, optimized, and at the cheapest host. It assumes no throughput and no staffing cost: give yours, or it states the tokens per second the break-even would require and says the figures are hardware rent only. |
| **`track-llm-price-changes`** | "Did the price just move?" The models whose quoted price moved by 1% or more over the last 7 days, with the price before and after and what the move does to your monthly bill; or the price history of 1 to 4 named models since tracking began. Sets apart the moves that are a change of the host quoted, not a repricing. |

All eight are read-only and take no credentials. Nothing you send is stored.

**The server says how to read its answers.** When an assistant connects, it receives a
short set of instructions: which questions the server answers, and to repeat each figure
with its date, its source and its label (a promotion, a retirement notice, a static
rate), without turning "not known" into "no".

**End of life is on every answer.** A model whose maker has announced the retirement of
its API is labelled with the date and the replacement the maker names, wherever it
appears, and loses the FinOps Friendly badge. The notices are read by hand from each
maker's deprecation page and dated in the response; a model with no label has no notice
on record, which is not a guarantee.

**Use case profiles** ship with realistic token shapes, so you do not have to invent them:
Support Ticket, Knowledge Q&A, Meeting Summary, Marketing Content, Coding Task,
Invoice Processing, Call Summary, Agent Workflow.

---

## Where the numbers come from

`optimtoken.optimnow.io` is the single source of truth. When it cannot be reached, the
server answers from a snapshot of it rather than failing, and says so.

| Tool | Tier 1 | Tier 2 |
|---|---|---|
| LLM tools | `GET /api/llm-models` | embedded snapshot of it |
| Compute tools | `GET /api/pricing?region=&os=Linux` | embedded snapshot (137 rows) |
| Every host of a model | `GET /api/model-hosts?id=` | none: the summary on the model rows answers |
| Price changes | `GET /api/price-changes` | none: the tool says so, never "nothing moved" |

**The snapshot holds the site's figures of the day it was taken**: its corrected prices,
its verified licences and its Arena scores, any of which may have moved since. So every
response carries a `provenance` object with `pricesVerified`, true on tier 1 only, and a
snapshot answer opens with a notice stating its day. A fallback should never quietly
downgrade correctness.

Until 0.11.0 the LLM tools had a tier between the two: OpenRouter's catalogue, read
directly. It was removed once it was measured against the site's own reading of the same
payload: the open source, open weights or proprietary label differed for 84 of 288 models.

Tier 1 is accepted only when the catalogue reports that it is itself serving fresh
upstream data. If the site is on its own fallback, it carries no corrections, and this
server treats it accordingly.

---

## Local development

Requires **Node.js 24+**.

```bash
npm install
npm run dev              # the server with reload, at http://localhost:3000/mcp
npm test                 # cost logic, schema conformance, data sources, the HTTP layer
npm run build            # tsc, to dist/server/src/index.js
```

The two snapshots are refreshed by hand, not on a schedule, and before each release:

```bash
npm run refresh-fallback
```

```bash
npm run refresh-compute-fallback
```

Because it is manual, check its `dataAsOf` before trusting a snapshot response. An
unrefreshed snapshot ages silently.

```text
ai-pricing-hub-mcp/
├─ server/src/index.ts              # the eight tools
├─ server/src/lib/http.ts           # Streamable HTTP at /mcp, one MCP server per request
├─ server/src/lib/optimtoken-api.ts # the one base URL constant, fetch and timeout discipline
├─ server/src/lib/                  # ranking, efficiency scoring, provenance, normalisation
└─ server/src/data/                 # static fallback pricing + region maps
```

Built on the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), with no framework and no UI layer. Deployed on [Fly.io](https://fly.io/).

---

## The rest of the family

| | |
|---|---|
| [**OptimToken**](https://optimtoken.optimnow.io) | The web app. Same catalogue, full UI, an AI advisor and a public JSON API. |
| [**AI ROI Calculator**](https://github.com/OptimNow/ai-roi-calculator-mcp) | Does the AI business case pay for itself. Same prices, plus harness costs and value modelling. |
| [**cloud-finops-skills**](https://github.com/OptimNow/cloud-finops-skills) | FinOps knowledge for AI agents: AWS, Azure, GCP, AI inference, SaaS. |
| [**finops-mcp-resources**](https://github.com/OptimNow/finops-mcp-resources) | MCP servers, tutorials and client guides for cloud cost work. |

---

## License

Released under the [MIT License](./LICENSE).

Prices served by this server come from third-party sources and are provided as is,
without warranty. Verify against vendor pricing pages before committing spend.

---

Questions about your own AI or cloud bill? [Talk to OptimNow](https://www.optimnow.io/contact).
