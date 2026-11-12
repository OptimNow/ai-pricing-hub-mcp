<p align="center">
  <img src="assets/icon.png" alt="OptimNow" width="96" height="96">
</p>

# OptimToken MCP

Ask your AI assistant what a model, a host or a cloud instance costs today. It
answers with a dated, sourced figure, where it would otherwise give a number it
remembers from its training data.

Built by [OptimNow](https://optimnow.io). The server is hosted and read-only, and
it asks for no account or API key.

[![CI](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OptimNow/ai-pricing-hub-mcp/actions/workflows/ci.yml)
[![MCP Server](https://img.shields.io/badge/MCP-Server-7C3AED)](https://modelcontextprotocol.io/)
[![Prices](https://img.shields.io/badge/prices-OptimToken-ACE849?labelColor=2C2C2C)](https://optimtoken.optimnow.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/OptimNow/ai-pricing-hub-mcp?style=flat)](https://github.com/OptimNow/ai-pricing-hub-mcp/stargazers)

---

## Connect in 30 seconds

The server is hosted. Give your assistant this address:

```
https://optimtoken-mcp.optimnow.io/mcp
```

| Client | How to add it |
|---|---|
| <img src="https://img.shields.io/badge/-Claude%20Code-D97757?logo=anthropic&logoColor=white" alt="Claude Code" height="22"/> | `claude mcp add --transport http optimtoken https://optimtoken-mcp.optimnow.io/mcp` |
| <img src="https://img.shields.io/badge/-Claude.ai%20%2F%20Desktop-D97757?logo=anthropic&logoColor=white" alt="Claude.ai / Desktop" height="22"/> | **Settings → Connectors → Add custom connector**, paste the URL above |
| <img src="https://img.shields.io/badge/-ChatGPT-10A37F?logo=openai&logoColor=white" alt="ChatGPT" height="22"/> | **Settings → Connectors → Add**, paste the URL |
| <img src="https://img.shields.io/badge/-Cursor-000000?logo=cursor&logoColor=white" alt="Cursor" height="22"/> <img src="https://img.shields.io/badge/-Windsurf-3DDC91?logoColor=white" alt="Windsurf" height="22"/> <img src="https://img.shields.io/badge/-VS%20Code-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code" height="22"/> | Add an HTTP MCP server entry pointing at the URL |

The path is `/mcp`. Then ask a question in plain words:

> *"We handle 200,000 support tickets a month, about 1,500 input tokens each. Which model gives the best quality for the money, and what would it cost?"*

---

## What you can ask

| Your question | What comes back | Tool |
|---|---|---|
| What is on the market? | About 300 models, filtered and sorted on price, quality (Arena ELO), efficiency and capabilities. Each one says whether its weights are published. | `compare-llm-models` |
| Which model should we start on? | A ranked top 3 for your workload and your constraints (budget, minimum quality, capability), with the evidence for each. Models whose maker has announced their retirement are left out and counted. | `recommend-llm-model` |
| How do these 2 to 4 models compare? | The named models side by side across 8 workload profiles, at list price and at the optimized price. | `compare-models-side-by-side` |
| What will this cost us per month? | Cost per request and per month for your volume and your token counts, with what caching and batch pricing change, and whether they apply. | `estimate-llm-cost` |
| Where do we buy it? | Every host that sells a model, the cheapest, the dearest and the model maker's own rate, and your workload costed at each. It says when the cheap host serves a quantized build. | `compare-model-hosts` |
| Did the price just move? | The models whose price moved by 1% or more in the last 7 days, before and after, with the effect on your monthly bill. Or the price history of a named model. | `track-llm-price-changes` |
| What should we run it on? | Linux instance rates across AWS, Azure, GCP, OCI, OVH, DigitalOcean and Alibaba in 4 regions: on demand, spot, and 1-year and 3-year commitments with what each saves. | `compare-compute-pricing` |
| The API, or our own GPUs? | The monthly volume at which renting an instance costs the same as paying per token, at every rate the instance lists. | `estimate-self-hosting-breakeven` |

The 8 workload profiles carry realistic token counts, so you do not have to
invent them: Support Ticket, Knowledge Q&A, Meeting Summary, Marketing Content,
Coding Task, Invoice Processing, Call Summary, Agent Workflow.

More questions that work as written. Plain ones:

- *"Show me the smartest models for the lowest price."*
- *"How do the best open-weights models compare with the best proprietary ones, on quality and on price?"*
- *"Which AI model prices changed this week?"*
- *"What does an 8-vCPU, 32 GB instance cost on AWS in Europe: on demand, on spot and with a 3-year savings plan?"*

And detailed ones:

- *"Who sells Llama 3.3 70B, and what would a coding workload cost at the cheapest host?"*
- *"Which of this week's price moves are real price changes rather than a change of the host quoted?"*
- *"At what monthly volume does renting an AWS g6e.4xlarge cost the same as paying the API for Llama 3.3 70B?"*

---

## What an answer looks like

The question: *"Recommend a model for support tickets, 100,000 requests a month,
under $500 a month, with an Arena ELO of 1350 or more."* The server's figures on
2026-11-12:

| Rank | Model | Arena ELO | List price | Optimized price |
|---|---|---|---|---|
| 1 | Zhipu GLM 5.3 Flash | 1471 | $10 a month | $9 a month (−9%) |
| 2 | Xiaomi MiMo-V2.6-Pro | 1492 | $109 a month | $70 a month (−36%) |
| 3 | Xiaomi MiMo-V2.6-Flash | 1451 | $35 a month | $23 a month (−35%) |

With them came what makes the figures usable in a budget:

- **The source and the date.** `optimtoken.optimnow.io`, prices as of 2026-11-12.
- **The count behind the ranking.** Of 139 ranked models, 82 met both constraints.
- **What was left out.** The 21 models whose maker has announced their retirement.
- **Why the optimized price is lower.** Which discount applied (caching, batch),
  and only where the model publishes that rate.

These prices have moved since. Ask the server for today's figures and do not
quote this table.

---

## Why not ask the model directly

Model prices change every week. A language model's idea of them stops at its
training cutoff, so it answers with a figure that was true some months ago, with
no date attached. Cloud instance rates add a second problem: they vary by region.

This server replaces recall with a lookup.

- **Today's prices.** Every figure comes from the
  [OptimToken](https://optimtoken.optimnow.io) catalogue, which is refreshed daily.
- **Corrected prices.** OptimToken keeps a price archive, a table of rates checked
  against vendor pricing pages, and an alarm on the half-price and double-price
  errors that upstream feeds sometimes publish.
- **Cost per request, not per million tokens.** A price per token hides what you
  pay for. The tools apply your token counts, your cache hit rate and batch
  eligibility, and return a cost per request and per month.
- **Labels you can repeat.** A promotional price, one host's unusually low rate, a
  retirement notice and a static rate are each labelled, with one line on what
  the label means.
- **"Not known" stays "not known".** A missing figure is reported as missing. It is
  never turned into a zero or a "no".

---

## What it does not do

- **It does not see your bill.** You give the volume and the token counts, or pick
  a profile. The server holds no usage data.
- **It quotes list prices.** A negotiated discount, a private offer or committed
  spend is yours to apply.
- **Arena ELO is a public benchmark.** It ranks general quality. It does not
  replace a test on your own task.
- **The self-hosting break-even is hardware rent only.** The server assumes no
  throughput and no staffing cost. Give yours, or it states the tokens per
  second the break-even would require.

---

## Where the numbers come from

`optimtoken.optimnow.io` is the single source. When it cannot be reached, the
server answers from a dated snapshot of it and says so at the top of the answer.

| Tools | Live source | When the site cannot be reached |
|---|---|---|
| LLM tools | `GET /api/llm-models` | embedded snapshot of it |
| Compute tools | `GET /api/pricing?region=&os=Linux` | embedded snapshot (137 rows) |
| Every host of a model | `GET /api/model-hosts?id=` | none: the summary on the model rows answers |
| Price changes | `GET /api/price-changes` | none: the tool says so, never "nothing moved" |

Every response carries a `provenance` object: which source served it, its date,
and `pricesVerified`, true for the live source only. For compute it also names
the price columns that are static and any provider the site could not read live.

The server calls no other API. Until version 0.11.0 it could also read
OpenRouter's catalogue directly. That path was removed after a measurement
against the site: the open source, open weights or proprietary label differed
for 84 of 288 models.

---

## Privacy and hosting

- **Read-only, no credentials.** The 8 tools read public pricing data. None of them
  writes, and none asks for a key.
- **Nothing you send is stored.** [Privacy policy](https://optimtoken.optimnow.io/privacy).
- **Hosted on [Fly.io](https://fly.io/), in Paris.** This repository is the source:
  a change is deployed when it is merged, after the tests pass.
- **Listed in the [MCP registry](https://registry.modelcontextprotocol.io)** as
  `io.github.OptimNow/ai-pricing-hub`.

Documentation for users: <https://optimtoken.optimnow.io/mcp>.

---

## For developers

Requires **Node.js 24+**.

```bash
npm install
npm run dev              # the server with reload, at http://localhost:3000/mcp
npm test                 # cost logic, schema conformance, data sources, the HTTP layer
npm run build            # tsc, to dist/server/src/index.js
```

The two snapshots are refreshed every Monday by the `Refresh fallback snapshots`
workflow, which runs the two commands below, tests the result and pushes it to
`master`; `ci.yml` then deploys it. They also run by hand:

```bash
npm run refresh-fallback
```

```bash
npm run refresh-compute-fallback
```

A snapshot is still up to a week old, and older if a refresh was refused: check
the snapshot's `dataAsOf` before trusting a snapshot answer.

```text
ai-pricing-hub-mcp/
├─ server/src/index.ts              # the eight tools
├─ server/src/lib/http.ts           # Streamable HTTP at /mcp, one MCP server per request
├─ server/src/lib/optimtoken-api.ts # the one base URL constant, fetch and timeout discipline
├─ server/src/lib/                  # ranking, efficiency scoring, provenance, normalisation
└─ server/src/data/                 # static fallback pricing + region maps
```

Built on the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk),
with no framework and no UI layer. The design decisions and their history are in
[`docs/DESIGN.md`](./docs/DESIGN.md).

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
