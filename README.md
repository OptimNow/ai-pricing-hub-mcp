# OptimToken — MCP App (by OptimNow)

An MCP (Model Context Protocol) app that compares AI/LLM model pricing and quality, recommends a model under a budget, estimates workload costs, and benchmarks cloud compute instances. Works as an interactive tool inside AI conversations on **Claude**, **ChatGPT**, **VS Code**, and other MCP-compatible clients.

Every response carries a `provenance` block saying which data tier answered, when it was fetched, and — for LLM prices — whether the vendor-verified corrections were applied. A fallback never silently downgrades correctness.

Built by [OptimNow](https://www.optimnow.io) with the [Skybridge](https://docs.skybridge.tech/) framework.

## Tools

| Tool | Use it when | Widget |
|------|-------------|--------|
| `compare-llm-models` | You want to **see the field** — browse and filter the whole catalogue by price, ELO, efficiency, capability, openness | Ranked cards, with a cost-vs-ELO scatter toggle |
| `recommend-llm-model` | You want **an answer** — the best model for one workload under a budget / ELO / capability constraint | Three podium cards with a per-constraint checklist |
| `compare-models-side-by-side` | You want **2-4 named models** weighed against each other across all 8 use cases | Use-case × model cost matrix |
| `estimate-llm-cost` | You have **exact numbers** — your own token counts and monthly volume | List-vs-optimized savings bars |
| `compare-compute-pricing` | You want cloud **compute** instances across AWS, Azure, GCP, DigitalOcean, OCI, OVH, Alibaba | Filterable pricing table |

The first four all answer questions about LLMs, so each tool's description says
when to pick a sibling instead — that routing is what makes a calling model
choose correctly.

### Data Sources

Both tool families read from `optimtoken.optimnow.io`, which is where pricing
*correctness* lives: a committed price archive, an overrides table checked
against vendor pricing pages, and an anomaly alarm for the x0.5 / x2.0 breaks
OpenRouter intermittently serves.

| | Tier 1 (preferred) | Tier 2 | Tier 3 |
|---|---|---|---|
| **LLM models** | `optimtoken.optimnow.io/api/llm-models` — vendor-verified | [OpenRouter](https://openrouter.ai/) direct — **uncorrected** | static snapshot |
| **Compute** | `optimtoken.optimnow.io/api/pricing` — ~6,000 live instances | — | 137-row static snapshot |

Tiers 2 and 3 serve uncorrected prices, so they set `provenance.pricesVerified`
to false and lead their text output with a notice. LLM data is enriched locally
with Chatbot Arena ELO scores and FinOps efficiency metrics.

### Use Case Profiles

Pre-configured token profiles for cost estimation:
- Support Ticket, Knowledge QA, Meeting Summary
- Marketing Content, Coding Task, Invoice Processing
- Call Summary, Agent Workflow

## Getting Started

### Prerequisites

- Node.js 24+

### Install & Run

```bash
npm install
npm run dev
```

This starts the MCP server with Skybridge DevTools at `http://localhost:3000/`.

### Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-pricing-hub": {
      "command": "cmd",
      "args": ["/c", "npx", "mcp-remote", "https://ai-pricing-hub-mcp-9604f763.alpic.live/"]
    }
  }
}
```

Restart Claude Desktop to connect.

Or, from a terminal with Claude Code installed:

```bash
claude mcp add ai-pricing-hub --transport http https://ai-pricing-hub-mcp-9604f763.alpic.live/
```

### Connect to ChatGPT

The server already emits the MCP Apps format ChatGPT expects: widget resources
use `mimeType: "text/html;profile=mcp-app"` and each tool carries
`_meta.ui.resourceUri`. No manifest file is involved.

Add it as a custom connector in developer mode with the endpoint:
`https://ai-pricing-hub-mcp-9604f763.alpic.live/`

To publish it in the ChatGPT directory, see `docs/chatgpt-submission.md`.

### Example Prompts

- "Compare the prices of LLMs from OpenAI and Anthropic"
- "Recommend a model for support tickets under $500 a month"
- "Compare GPT-4o, Claude Opus 5 and Gemini 3.1 Pro side by side"
- "Estimate the monthly cost of using Claude Sonnet for 100k support tickets"
- "What would 800 input and 200 output tokens cost me at 4 million calls a month?"
- "Show me the cheapest GPU instances across all cloud providers"
- "Which LLM has the best quality-to-price ratio for coding tasks?"

## Deployment

Deployed to [Alpic Cloud](https://alpic.ai/):

```bash
npx alpic deploy --yes --project-name ai-pricing-hub-mcp
```

## Related

- [OptimToken](https://optimtoken.optimnow.io) — the web app this server reads its pricing from
- [Skybridge Documentation](https://docs.skybridge.tech/)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [OpenRouter API](https://openrouter.ai/) — the tier-2 fallback

## License

Private repository. All rights reserved.
