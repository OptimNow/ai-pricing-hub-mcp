/**
 * What the server tells a calling model once, when it connects: the MCP
 * `instructions` field of the initialize result, which a host places in the
 * model's context beside the tool list. In a host that loads tools on demand
 * it is, with the tool names, all the model has to decide whether this server
 * bears on a question.
 *
 * A tool's description says what that tool takes and returns. This says what
 * holds across all of them: what the server is for, and how to repeat a figure
 * with the date, the source and the label that qualify it. Every sentence
 * restates a rule the tools already apply in their own text (decisions 1b, 3b,
 * 3f, 9, 9b, 9c, 11 and 12 in CLAUDE.md). None adds one.
 *
 * It names no tool, so a new tool does not make it stale. A new label does:
 * add it here when a text starts printing it. server-instructions.test.ts
 * holds the labels quoted here to the ones the texts print.
 */
export const SERVER_INSTRUCTIONS = [
  "OptimToken answers FinOps questions about AI spend from dated, sourced prices: what a workload costs " +
    "on a model, which model fits a budget, who sells a model and at what rate, what a cloud instance " +
    "costs across providers, when renting capacity beats paying an API, and which prices just moved. " +
    "It is read-only and needs no account.",
  "",
  "When you report its answers:",
  "- The text of an answer is the answer. `structuredContent` holds the same figures, and in places more " +
    "rows than the text prints.",
  "- Quote a price with the date and the source the answer gives (`provenance`). When an answer says it " +
    "was served from a fallback, say so: those prices are older and carry fewer labels.",
  "- Keep each label with the figure it qualifies: [promotional price], [outlier listing], a retirement " +
    "notice, `static` on a compute rate, [quoted host changed] on a price move. The answer explains each " +
    "label it prints.",
  "- An optimized cost counts a batch or cache discount only where the answer says it applies. It is not " +
    "the price every workload pays.",
  '- Absent means not known, never "no": a model with no host list, no retirement notice or no price ' +
    "history is not thereby unsold, safe or unchanged. A failed read is an error, not an empty result.",
  "- A price move with no label is not established as a repricing by the model's maker.",
  "- The break-even between an API and rented capacity assumes no throughput and no operations cost. Do " +
    "not supply one for the user: give the throughput each break-even requires, or ask for a measured one.",
  "- A figure you derive from these answers is your own arithmetic. Say so.",
].join("\n");

/**
 * This server's own budget, in characters. The text is paid for in the context
 * of every conversation the connector is enabled in, and a host cuts what runs
 * past its limit without saying so: Claude Code documents 4,096 characters for
 * server instructions (code.claude.com/docs/en/mcp, read 2026-11-12). Half of
 * that leaves room for a host that is stricter.
 */
export const SERVER_INSTRUCTIONS_MAX_LENGTH = 2_000;
