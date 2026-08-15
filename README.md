# OptimToken — MCP App (by OptimNow)

An MCP (Model Context Protocol) app that compares AI/LLM model pricing, estimates costs, and benchmarks cloud compute instances. Results render as widgets inside AI conversations on **Claude**, **ChatGPT**, **VS Code**, and other MCP-compatible clients. The widgets are display-only — they follow the host's light or dark theme, and changing a filter means asking the model to run the tool again.

Built by [OptimNow](https://www.optimnow.io) with the [Skybridge](https://docs.skybridge.tech/) framework.

## Tools

| Tool | Description |
|------|-------------|
| `compare-llm-models` | Compare AI/LLM models by price, quality (ELO), efficiency, and capabilities with live data |
| `estimate-llm-cost` | Estimate per-request and monthly costs for AI models across different use cases and volumes |
| `compare-compute-pricing` | Compare cloud compute instances across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba |

### Data Sources

- **LLM Models:** Live data from [OpenRouter API](https://openrouter.ai/) enriched with Chatbot Arena ELO scores and FinOps efficiency metrics. If the fetch fails, times out, or returns an implausibly small catalogue, the server serves a static snapshot instead and labels it `static-fallback` in the widget.
- **Compute Instances:** Static pricing data covering 7 cloud providers with category enrichment.

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
The transport is streamable-http, served at the root URL.

### Other scripts

| Script | What it does |
|--------|--------------|
| `npm run typecheck` | `tsc --noEmit` over server and web |
| `npm run build` | Production build, then regenerates `app.json` from the zod schemas |
| `npm run refresh-fallback` | Refetches the static LLM snapshot into `server/src/data/pricing-data.ts` |

`app.json` is generated — edit `server/src/schemas.ts` instead.

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

### Connect to ChatGPT

This repo now includes a ChatGPT App manifest (`app.json`) that maps the existing MCP tools and widgets.

1. Register the app manifest with your ChatGPT Apps SDK flow (run `npm run build` first — `app.json` is generated).
2. Configure the backend MCP endpoint as: `https://ai-pricing-hub-mcp-9604f763.alpic.live/`
3. Ensure the 3 UI resources in `app.json` are registered (`ui://widget/*`).

See `docs/chatgpt-app-migration.md` for the full migration mapping.

### Example Prompts

- "Compare the prices of LLMs from OpenAI and Anthropic"
- "Estimate the monthly cost of using Claude Sonnet for 100k support tickets"
- "Show me the cheapest GPU instances across all cloud providers"
- "Which LLM has the best quality-to-price ratio for coding tasks?"

## Deployment

Deployed to [Alpic Cloud](https://alpic.ai/):

```bash
npx alpic deploy --yes --project-name ai-pricing-hub-mcp
```

## Related

- [Skybridge Documentation](https://docs.skybridge.tech/)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [OpenRouter API](https://openrouter.ai/)

## License

Private repository. All rights reserved.
