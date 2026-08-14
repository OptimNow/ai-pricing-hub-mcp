# ChatGPT App Smoke Tests (Automation-Ready)

Use this document to validate the AI Pricing Hub app in ChatGPT.

## How to use

1. Open ChatGPT with your `AI Pricing Hub` app enabled.
2. Run each prompt in order.
3. Mark each test as `PASS` or `FAIL`.
4. For failed tests, save the exact error message.

## Pass criteria

- App responds without connection errors.
- Valid prompts return tool-backed results.
- Strict prompts return reduced or empty results gracefully.
- Invalid prompts return clear validation errors (no crash).

## Test suite (JSON)

```json
[
  {
    "id": "T001",
    "tool": "compare-llm-models",
    "type": "default",
    "prompt": "Compare LLM models with default settings.",
    "expected": "Returns a normal comparison result."
  },
  {
    "id": "T002",
    "tool": "compare-llm-models",
    "type": "strict_filter",
    "prompt": "Show me only models with max input price 0.1, max output price 0.3, and minimum ELO 1300.",
    "expected": "Returns fewer results or no results, but no failure."
  },
  {
    "id": "T003",
    "tool": "compare-llm-models",
    "type": "invalid_input",
    "prompt": "Compare LLM models with limit -5.",
    "expected": "Returns a validation error message."
  },
  {
    "id": "T004",
    "tool": "estimate-llm-cost",
    "type": "default",
    "prompt": "Estimate LLM cost with default settings.",
    "expected": "Returns cost estimate output."
  },
  {
    "id": "T005",
    "tool": "estimate-llm-cost",
    "type": "strict_filter",
    "prompt": "Estimate monthly cost for model GPT-4o-mini with 100 input tokens, 50 output tokens, and monthly volume 1000000.",
    "expected": "Returns a concrete monthly estimate."
  },
  {
    "id": "T006",
    "tool": "estimate-llm-cost",
    "type": "invalid_input",
    "prompt": "Estimate LLM cost with monthlyVolume -100.",
    "expected": "Returns a validation error message."
  },
  {
    "id": "T007",
    "tool": "compare-compute-pricing",
    "type": "default",
    "prompt": "Compare cloud compute pricing with default settings.",
    "expected": "Returns normal instance comparison results."
  },
  {
    "id": "T008",
    "tool": "compare-compute-pricing",
    "type": "strict_filter",
    "prompt": "Show Linux instances with at least 16 vCPUs, at least 64 GB memory, sorted by price, limit 5.",
    "expected": "Returns filtered results sorted by price."
  },
  {
    "id": "T009",
    "tool": "compare-compute-pricing",
    "type": "invalid_input",
    "prompt": "Compare compute pricing with limit 0 and OS macOS.",
    "expected": "Returns a validation error message."
  }
]
```

## Result template

```text
Run date:
Environment:
App name: AI Pricing Hub

T001: PASS/FAIL - notes
T002: PASS/FAIL - notes
T003: PASS/FAIL - notes
T004: PASS/FAIL - notes
T005: PASS/FAIL - notes
T006: PASS/FAIL - notes
T007: PASS/FAIL - notes
T008: PASS/FAIL - notes
T009: PASS/FAIL - notes
```
