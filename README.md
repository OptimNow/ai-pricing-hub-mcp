# AI Pricing Hub — MCP App

An MCP (Model Context Protocol) app that compares AI/LLM model pricing, estimates costs, and benchmarks cloud compute instances. Works as an interactive tool inside AI conversations on **Claude**, **ChatGPT**, **VS Code**, and other MCP-compatible clients.

Built by [OptimNow](https://www.optimnow.io) with the [Skybridge](https://docs.skybridge.tech/) framework.

## Tools

| Tool | Description |
|------|-------------|
| `compare-llm-models` | Compare AI/LLM models by price, quality (ELO), efficiency, and capabilities with live data |
| `estimate-llm-cost` | Estimate per-request and monthly costs for AI models across different use cases and volumes |
| `compare-compute-pricing` | Compare cloud compute instances across AWS, Azure, GCP, DigitalOcean, OCI, OVH, and Alibaba |

### Data Sources

- **LLM Models:** Live data from [OpenRouter API](https://openrouter.ai/) enriched with Chatbot Arena ELO scores and FinOps efficiency metrics. Static fallback included for offline use.
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

1. Go to **Settings > Connected Apps**
2. Add the MCP server URL: `https://ai-pricing-hub-mcp-9604f763.alpic.live/`
3. ChatGPT will render interactive widget UIs for each tool

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
