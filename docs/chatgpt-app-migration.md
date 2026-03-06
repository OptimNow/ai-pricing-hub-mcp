# Migrating this MCP server into a ChatGPT App

This repository already has the core pieces needed for a ChatGPT App:

- MCP backend tools (`server/src/index.ts`)
- Structured widget outputs (`structuredContent`)
- UI widgets (`web/src/widgets/*`)

To run it as a ChatGPT App in production, use this mapping:

1. `app.json` (added at repo root)
2. tool schemas (mirrored from existing Zod schemas)
3. UI resource mapping (`ui://widget/*` URIs mapped to existing widget sources)

## Resulting architecture

```text
ChatGPT
  ↓
ChatGPT App (app.json manifest)
  ↓
MCP adapter / Apps SDK registration
  ↓
Skybridge MCP server (this repo)
  ↓
AI Pricing Hub tools + widgets
```

## Notes for Apps SDK registration

When registering with the ChatGPT Apps SDK:

- Keep your tool names identical to MCP tool names:
  - `compare-llm-models`
  - `estimate-llm-cost`
  - `compare-compute-pricing`
- Point each tool to a corresponding `ui://widget/...` output template/resource.
- Keep `input_schema` in sync with the Zod input schema in `server/src/index.ts`.
- Use your deployed MCP endpoint as the backend transport target:
  - `https://ai-pricing-hub-mcp-9604f763.alpic.live/`

## Maintenance checklist

Any time a tool schema changes in `server/src/index.ts`:

1. Update the Zod schema in MCP server code.
2. Update the matching tool `input_schema` in `app.json`.
3. Validate with `npm run build`.
4. Re-register/redeploy the ChatGPT App manifest.
