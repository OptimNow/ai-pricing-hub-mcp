# OptimToken MCP

> Built by [OptimNow](https://optimnow.io). Ask an AI assistant what a model or an
> instance actually costs, and get a dated, sourced figure instead of a number the
> model remembers from its training data.

[![CI](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml)
[![MCP Server](https://img.shields.io/badge/MCP-Server-7C3AED)](https://modelcontextprotocol.io/)
[![ChatGPT Apps](https://img.shields.io/badge/ChatGPT-Apps%20SDK-10A37F?logo=openai&logoColor=white)](https://platform.openai.com/docs/apps)
[![Node](https://img.shields.io/badge/Node-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Prices](https://img.shields.io/badge/prices-OptimToken-ACE849?labelColor=2C2C2C)](https://optimtoken.optimnow.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/OptimNow/ai-pricing-hub-mcp?style=flat)](https://github.com/OptimNow/ai-pricing-hub-mcp/stargazers)

---

## Connect in 30 seconds

The server is hosted, so there is nothing to install.

```
https://ai-pricing-hub-mcp-9604f763.alpic.live/
```

| Client | How to add it |
|---|---|
| <img src="https://img.shields.io/badge/-Claude%20Code-D97757?logo=anthropic&logoColor=white" alt="Claude Code" height="22"/> | `claude mcp add --transport http optimtoken https://ai-pricing-hub-mcp-9604f763.alpic.live/` |
| <img src="https://img.shields.io/badge/-Claude.ai%20%2F%20Desktop-D97757?logo=anthropic&logoColor=white" alt="Claude.ai / Desktop" height="22"/> | **Settings → Connectors → Add custom connector**, paste the URL above |
| <img src="https://img.shields.io/badge/-ChatGPT-10A37F?logo=openai&logoColor=white" alt="ChatGPT" height="22"/> | **Settings → Connectors → Add**, paste the URL. Comparisons render as interactive widgets |
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
| **`compare-llm-models`** | "What is out there?" Browse and filter the catalogue on price, quality (Chatbot Arena ELO), efficiency and capabilities, with a self-hostability read from the licence. |
| **`recommend-llm-model`** | "Just tell me which one." A ranked top 3 for one workload under your constraints (budget, minimum ELO, required capability, self-hostability), each with a per-constraint satisfied or violated breakdown as the evidence. Over-constrained queries return the nearest misses, labelled as such. |
| **`compare-models-side-by-side`** | "How do these specific ones compare?" 2 to 4 named models across all 8 use case profiles at a chosen monthly volume, list and optimized cost for each. |
| **`estimate-llm-cost`** | "What will this cost us per month?" Per-request and monthly cost for your own volume, token shape, cache hit rate and batch eligibility. |
| **`compare-compute-pricing`** | "What should we run it on?" Compute instance rates across AWS, Azure, GCP, OCI, OVH, DigitalOcean and Alibaba, by region and category. |

All five are read-only and take no credentials. Nothing you send is stored.

**Use case profiles** ship with realistic token shapes, so you do not have to invent them:
Support Ticket, Knowledge Q&A, Meeting Summary, Marketing Content, Coding Task,
Invoice Processing, Call Summary, Agent Workflow.

---

## Where the numbers come from

`optimtoken.optimnow.io` is the single source of truth. When it cannot be reached, the
server degrades in tiers rather than failing, and says which tier it used.

| Tool | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| LLM tools | `GET /api/llm-models` | OpenRouter direct | embedded snapshot |
| Compute tool | `GET /api/pricing?region=` | not available | embedded snapshot (137 rows) |

**Tiers 2 and 3 serve uncorrected prices**, and that matters more than it sounds. An
upstream feed once published a frontier model at half its real list price, which halves
every monthly figure derived from it. So every response carries a `provenance` object
with `pricesVerified`, and the lower tiers put a notice at the top of the answer. A
fallback should never quietly downgrade correctness.

Tier 1 is accepted only when the catalogue reports that it is itself serving fresh
upstream data. If the site is on its own fallback, it carries no corrections, and this
server treats it accordingly.

---

## Local development

Requires **Node.js 24+**.

```bash
npm install
npm run dev              # Skybridge dev server + MCP inspector at localhost:3000
npm test                 # schema conformance, serialisation precision, data sources
npm run build            # widgets + server
```

The static fallback catalogue is refreshed by hand, not on a schedule:

```bash
npm run refresh-fallback
```

Because it is manual, check its `dataAsOf` before trusting a tier-3 response. An
unrefreshed fallback ages silently.

```text
ai-pricing-hub-mcp/
├─ server/src/index.ts              # tool + widget registrations
├─ server/src/lib/optimtoken-api.ts # the one base URL constant, fetch and timeout discipline
├─ server/src/lib/                  # ranking, efficiency scoring, provenance, normalisation
├─ server/src/data/                 # static fallback pricing + region maps
└─ web/src/widgets/                 # React widgets rendered in the client
```

Built with [Skybridge](https://docs.skybridge.tech/), deployed on [Alpic](https://alpic.ai/).

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
