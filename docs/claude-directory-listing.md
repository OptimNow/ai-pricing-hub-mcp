# The Claude directory listing, field by field

What to paste into the developer portal (<https://claude.ai/directory/manage>,
**Submit new**, **MCP connector**), in the order of its ten steps.
`claude-directory-submission.md` holds the procedure and the checks on the
server; this file holds the texts.

Status: **drafted on 2026-11-12, not submitted.** Written against 0.11.0 in
production and against Anthropic's pages as they read that day (Sources, at
the end).

Three things here cannot be corrected afterwards, so read them twice:

- **The URL slug** is permanent once published.
- **The description** is written by the submitter, and Anthropic cannot edit it.
- **The listing is bound to the URL** of step 1.

`server/src/listing.test.ts` holds the lengths of the name, the one-liner and
the description to the portal's limits, and the example prompts to the tools
the server declares: a ninth tool without a prompt fails it.

## On the day of the submission

1. Run `node scripts/check-connector.mjs` against production.
2. Run the eight calls of step 8 again. Model and instance names age: each
   must still resolve to one model, with no ambiguity note.
3. Re-read the counts in the description (the number of tools, "about 300
   models", the seven compute providers) against what the server answers.
4. Paste each field as plain text and look at its end. On the Cloud FinOps
   submission of 2026-11-06 the review found a stray label and a tab pasted
   into a use-case row.

## Step 1. Connection

One URL for every user:

```text
https://optimtoken-mcp.optimnow.io/mcp
```

## Step 2. Tools

Nothing to type. The portal reads the tools from the live server. All eight
should land in the read-only group, with no "missing title or annotation"
flag.

## Step 3. Listing

This is the public part.

### Name

Limit: 100 characters.

```text
OptimToken
```

### One-liner

Limit: 200 characters. No count in it, so that it does not go stale between
edits.

```text
Current prices for AI models and cloud compute, each with its source and date: what a workload costs, who sells a model at what price, when self-hosting becomes cheaper, and which prices moved.
```

### Description

Limit: 2,000 characters. The portal renders Markdown lists and links.

```text
OptimToken gives Claude current prices for AI models and cloud compute. A cost question gets a figure with its source and its date, where Claude would otherwise answer from memory. It is built and maintained by OptimNow, a Cloud Financial Management (FinOps) advisory, and its catalogue is refreshed every day.

8 read-only tools. A tool is a function Claude calls while answering. Each one answers a question:

- What is on the market? About 300 models, filtered on price, quality (Arena ELO) and capabilities.
- Which model fits our workload and our budget?
- How do 2 to 4 named models compare?
- What does a workload cost per request and per month, and what do caching and batch pricing change?
- Who sells a model, and at what price at each host?
- Which prices moved this week, and what is the price history of a model?
- What does a cloud instance cost on AWS, Azure, GCP, OCI, OVH, DigitalOcean and Alibaba: on demand, spot and with a commitment?
- At what volume does renting capacity cost the same as paying the API?

Every answer says which source served it and when. A promotional price, a retirement notice and a rate that is not live are labelled. A figure that is not known is reported as not known.

Where the figures come from: all 8 tools read OptimNow's own optimtoken.optimnow.io and call no other service. That site compiles public price data every day (OpenRouter's catalogue for models, the providers' price lists for compute) and corrects model prices against vendor pricing pages.

What it does not do: it never connects to your cloud or AI accounts, needs no account or credentials, and does not store your questions. It quotes list prices, not your negotiated rates.

Example questions: "Recommend a model for support tickets under $500 a month.", "Who sells Llama 3.3 70B, and at what price?", "Which LLM prices changed this week?"

Documentation: https://optimtoken.optimnow.io/mcp. Source: https://github.com/OptimNow/ai-pricing-hub-mcp.
```

Rules this text follows, to keep at the next edit. The first six are the ones
the maintainer set for the Cloud FinOps listing on 2026-11-11:

- Open with a sentence a newcomer understands, then say who builds it, who
  maintains it and how often it is refreshed.
- Say what a tool is before listing the tools.
- Numbers as figures, and the counts corrected at every edit.
- Lists run from the least to the most technical item.
- Name the host the tools call. The review of the Cloud FinOps submission
  asked for it.
- Say what the connector does not do.
- No sentence that claims or implies an endorsement by Anthropic: the
  directory terms forbid it.
- Say where the site's figures come from. The server calls OptimNow's API
  only, and that API compiles data other parties publish: a reader who
  budgets on a figure should know both.

### Categories

One to five, from the portal's list. `Data & Analytics` first. The Cloud FinOps
listing also took `Productivity` and `Other`; take a finance or developer
category instead if the list offers one.

### Works with

Claude (web & mobile), Claude API, Claude Code, Claude Desktop. The same set as
the Cloud FinOps listing: the server is a plain remote MCP server with no UI.

### Links and icon

| Field | Value |
|---|---|
| Documentation URL | `https://optimtoken.optimnow.io/mcp` |
| Privacy policy URL | `https://optimtoken.optimnow.io/privacy` |
| Support | `https://github.com/OptimNow/ai-pricing-hub-mcp/issues` |
| Icon | `https://raw.githubusercontent.com/OptimNow/ai-pricing-hub-mcp/master/assets/icon.png` (512 × 512, or upload `assets/icon.png`) |
| Has an MCP App | Unticked. The server has had no view since 0.5.0. Check the box after every save: on the Cloud FinOps listing it was found ticked again on 2026-11-11 |

The support field takes the issue tracker, as the Cloud FinOps listing does.
The policy asks for "verified contact information and support channels for
users with product or security concerns": the privacy page also gives
`optimnow.io/contact`.

### URL slug

Permanent once published. **The owner's decision.**

```text
optimnow-optimtoken
```

It follows the Cloud FinOps listing, whose slug is `optimnow-cloud-finops`.
The alternative is `optimtoken`, shorter, and the name of the site.

## Step 4. Use cases

Shown to reviewers only. Prerequisites: none (no account, no plan, no setup).
The connector reads data only.

The block has two columns per row, **Use case** and **Example prompt**, and the
reviewer reads a row as the two joined. The policy asks for at least three
working examples; these are eight, one for each tool. If the block takes fewer
rows, keep rows 2, 5, 6 and 8: they are the least like a plain price lookup.

| # | Use case | Example prompt | Tool |
|---|---|---|---|
| 1 | Survey the market under a price and a quality bar | Show me the models under $1 per million input tokens with an Arena ELO above 1300. | `compare-llm-models` |
| 2 | Pick a model for a workload and a budget | Recommend a model for support tickets under $500 a month. | `recommend-llm-model` |
| 3 | Compare named models | Compare Claude Sonnet 5.5, GPT-5.5 and Gemini 4 Argon side by side. | `compare-models-side-by-side` |
| 4 | Budget a workload | About 800 input tokens and 200 output tokens per request, 4 million requests a month, 60% of the prompt cached: what does that cost on Claude Sonnet 5.5? | `estimate-llm-cost` |
| 5 | Choose where to buy a model | Who sells Llama 3.3 70B, and what would a coding workload cost at the cheapest host? | `compare-model-hosts` |
| 6 | Follow price changes | Which LLM prices changed this week, and which of those are real price changes rather than a change of host? | `track-llm-price-changes` |
| 7 | Compare compute instances | Compare cloud instances in Europe with at least 8 vCPUs and 32 GB of memory, cheapest first, with what a 3-year commitment saves on each. | `compare-compute-pricing` |
| 8 | Decide between the API and rented capacity | At what monthly volume does renting an AWS g6e.4xlarge cost the same as paying the API for Llama 3.3 70B on support tickets? | `estimate-self-hosting-breakeven` |

Each prompt was answered by production on 2026-11-12 through the call of step
8 with the same number. Every model name resolved to one model: "Llama 3.3
70B" to Meta Llama 3.3 70B Instruct, the three names of row 3 to themselves.

## Step 5. Company

OptimNow, `https://optimnow.io`. Primary contact for review updates: the
address used for the Cloud FinOps listing.

## Step 6. Authentication

**No authentication.** The server serves public, read-only data. Nothing to
configure.

## Step 7. Data handling

The underlying API is OptimNow's own: `optimtoken.optimnow.io`, which OptimNow
owns and operates, and the only host the server calls since 0.11.0 (the policy
asks the developer to own or control every endpoint the software connects to).
Nothing is proxied for a partner. No personal health data, no sponsored
content.

If a reviewer asks where the prices originate: the site compiles public price
data (OpenRouter's public model catalogue, the cloud providers' public price
lists) and corrects it. The connector never calls those sources.

## Step 8. Test & launch

The credentials field is mandatory. Text to paste:

```text
No account or credential exists or is needed: the server is public and read-only.

Add https://optimtoken-mcp.optimnow.io/mcp as a custom connector in Claude, or open it in MCP Inspector, and call each of the 8 tools once. These calls returned content on 2026-11-12:

1. compare-llm-models {"maxInputPrice":1,"minElo":1300,"limit":10}
2. recommend-llm-model {"useCasePreset":"supportTicket","maxMonthlyBudget":500}
3. compare-models-side-by-side {"models":["Claude Sonnet 5.5","GPT-5.5","Gemini 4 Argon"]}
4. estimate-llm-cost {"modelName":"Claude Sonnet 5.5","customInputTokens":800,"customOutputTokens":200,"monthlyVolume":4000000,"cacheHitRate":0.6}
5. compare-model-hosts {"models":["Llama 3.3 70B"],"useCasePreset":"codingTask"}
6. track-llm-price-changes {}
7. compare-compute-pricing {"region":"europe","minVCPUs":8,"minMemory":32,"sortBy":"price","limit":10}
8. estimate-self-hosting-breakeven {"model":"Llama 3.3 70B","instanceType":"g6e.4xlarge","provider":"AWS","useCasePreset":"supportTicket"}

Each answer is a text block, with the same figures as structured content, and it opens with its data source and date.

A model name that matches nothing is reported by name, for example: "Zzyzx Nonexistent 9" matched no model. An invalid argument returns a validation error that names the field, for example: expected number, received string at limit. Neither is a bare 500.

The same 8 questions in plain words, for a chat with the connector on, are the example prompts of the Use cases step.
```

Change the date in that text to the day the calls are run again. Tick "I have
run every tool" only after running them on the deployment that is live that
day.

## Step 9. Compliance

Seven acknowledgments, all required. How each applies:

| Acknowledgment | Here |
|---|---|
| Directory guidelines | Read on 2026-11-12 (Sources) |
| First-party API usage | The server calls `optimtoken.optimnow.io` and nothing else |
| Financial transactions | None. The tools read prices; nothing is bought or transferred |
| AI media generation | None. The tools return text and figures |
| Prompt injection | Tool descriptions say what a tool does and when to use it. The server's `instructions` say how to repeat a figure the tools return (with its date, its source and its label), which is the tools' own function. They name no other tool or product and point to no external source |
| Conversation data collection | None. A tool receives its arguments and nothing else of the conversation |
| Public documentation | `https://optimtoken.optimnow.io/mcp` and this repository's README |

## Step 10. Review and submit

Read the whole submission once more. Quality warnings such as "very short
answer" appear here and are forwarded to the reviewers: fix them before
submitting.

## Sources

Read on 2026-11-12.

- Submit a connector: <https://claude.com/docs/connectors/building/submission>
  (the ten steps, the limits of the Listing step)
- Connector pre-submission checklist: <https://claude.com/docs/connectors/building/review-criteria>
  (API ownership, functional quality, what to include)
- Software Directory Policy: <https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy>
  (at least three working examples, support channels, token frugality)
- The Cloud FinOps connector's submission, for what the portal's fields look
  like once filled: `docs/directory-submission.md`, section 2, in
  `OptimNow/cloud-finops-skills`
