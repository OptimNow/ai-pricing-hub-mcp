# ChatGPT submission test cases

The plugin submission portal asks for **five positive** and **three negative**
test cases on the Testing tab. The cases below are the ones to paste there.

All eight were executed against the production endpoint
`https://ai-pricing-hub-mcp-9604f763.alpic.live/` on 2026-08-18, so the expected
behaviour describes what the server actually did, not what it ought to do.

No test account is needed: the server is public and unauthenticated.

> **Re-run these after the next deploy.** They were validated against a build
> that served the 137-row static compute fallback. On `master`,
> `compare-compute-pricing` fetches roughly 6,000 instances from
> `optimtoken.optimnow.io` and accepts a `region` argument, so match counts will
> change even though pass/fail should not. Confirm before pasting into the portal.

## Positive cases

| # | Tool | Prompt to enter | Expected behaviour |
|---|---|---|---|
| P1 | `compare-llm-models` | "Compare LLM models by price and quality." | Table of models with `inputPricePer1M`, `outputPricePer1M`, `eloScore` and `efficiencyScore`. Widget renders. |
| P2 | `compare-llm-models` | "Show only models under $0.10 per 1M input tokens and $0.30 output, with an ELO of at least 1300." | Narrow but non-empty result set. Succeeds rather than erroring on a restrictive filter. |
| P3 | `estimate-llm-cost` | "Estimate my monthly LLM cost for a support-ticket workload." | Returns `modelCosts` and `volume` using the default use-case profile. |
| P4 | `estimate-llm-cost` | "Estimate the monthly cost of GPT-4o-mini at 100 input tokens and 50 output tokens, one million requests a month." | A concrete monthly figure for the named model. |
| P5 | `compare-compute-pricing` | "Compare cloud instances in Europe with at least 8 vCPUs and 32 GB of memory, cheapest first, top 5." | Five instances sorted ascending by monthly price, spanning several providers, with a `provenance` block stating which tier served the prices. |

## Negative cases

All three return a clean MCP validation error (`-32602`) with `isError: true`.
None crash the server or leave the session unusable. These are schema-level
rejections, so they are stable across data-source changes.

| # | Tool | Prompt to enter | Expected behaviour |
|---|---|---|---|
| N1 | `compare-llm-models` | "Compare LLM models with a limit of -5." | Validation error naming the `limit` field. No partial results. |
| N2 | `estimate-llm-cost` | "Estimate LLM cost with a monthly volume of -100." | Validation error naming `monthlyVolume`. |
| N3 | `compare-compute-pricing` | "Compare compute pricing with a limit of 0." | Validation error naming `limit`. |

## Schema notes

`compare-compute-pricing` accepts `region` (`us-east` | `us-west` | `europe` |
`asia-pacific`, default `us-east`) plus `provider`, `category`, `minVCPUs`,
`maxVCPUs`, `minMemory`, `maxMemory`, `processor`, `useCase`, `sortBy`
(`price` | `vcpus` | `memory` | `pricePerVCPU`) and `limit`.

There is **no operating-system filter**. The tool serves Linux only and upstream
Windows rows are filtered out, so `os` appears in results but cannot be filtered
on. Do not write test prompts asking for "Linux instances" or "macOS": they read
as supported filters that silently do nothing, which invites a reviewer to file
it as misleading behaviour.

Responses carry `provenance`. On tiers 2 and 3 the prices are uncorrected and a
`notice` leads the text output. If a reviewer hits a fallback tier, the notice
is expected behaviour, not a defect.

## Result template

```text
Run date:
Endpoint:
Commit:

P1: PASS/FAIL - notes
P2: PASS/FAIL - notes
P3: PASS/FAIL - notes
P4: PASS/FAIL - notes
P5: PASS/FAIL - notes
N1: PASS/FAIL - notes
N2: PASS/FAIL - notes
N3: PASS/FAIL - notes
```
