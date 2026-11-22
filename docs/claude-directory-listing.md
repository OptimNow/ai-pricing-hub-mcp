# The Claude directory listing, field by field

What to paste into the developer portal (<https://claude.ai/directory/manage>,
**Submit new**, **MCP connector**), in the order of its ten steps.
`claude-directory-submission.md` holds the procedure and the checks on the
server; this file holds the texts.

Status: **published on 2026-11-19, as a Community connector.** Submitted,
approved by an automated review and published the same evening (the
sequence is in `claude-directory-submission.md`). Drafted on 2026-11-12 against 0.11.0 and
Anthropic's pages as they read that day (Sources, at the end); submitted
against 0.11.1, whose one change is the title annotation of step 2. The
four checks below were run again on the day and passed. Where the form
differed from this draft, each step says what was entered.

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

On 2026-11-19, against 0.11.0, all eight were in the read-only group, each
with a suggestion "Missing title annotation. Add annotations.title". The
portal reads the title from `annotations.title` (MCP 2025-03-26), and the
server set only the top-level `title` (2025-06-18). 0.11.1 sets both, and
`check-connector.mjs` now fails a tool without the first.

After a deploy, the portal keeps the tool list it read when the connector was
added: neither "Change" at step 1 nor a reload of the form reads it again.
What does: on claude.ai, Customize, Connectors, Yours, the connector, its ⋯
menu, **Refresh tools list**, then reload the form. The draft then recorded
`all_have_title: true`, which is sent with the submission.

## Step 3. Listing

This is the public part.

### Name

Limit: 100 characters. The owner's choice of 2026-11-12, over `OptimToken`.

```text
AI Economics
```

It says what the connector is about to someone who has never met the brand,
and it follows the Cloud FinOps listing, whose name is its subject too. What it
costs: the site, the documentation page, the privacy policy and the registry
entry all say OptimToken, and every answer names `optimtoken.optimnow.io` as
its source. The description's first paragraph makes the link, so that a
reader who meets both names knows they are one thing. Keep that sentence.

### One-liner

Limit: 200 characters. No count in it, so that it does not go stale between
edits.

```text
Current prices for AI models and cloud compute, each with its source and date: what a workload costs, who sells a model at what price, when self-hosting becomes cheaper, and which prices moved.
```

### Description

Limit: 2,000 characters. The portal renders Markdown lists and links.

```text
AI Economics gives Claude current prices for AI models and cloud compute. A cost question gets a figure with its source and its date, where Claude would otherwise answer from memory. OptimNow, a Cloud Financial Management (FinOps) advisory, builds and maintains it on OptimToken, its price catalogue, refreshed every day.

8 read-only tools. A tool is a function Claude calls while answering. Each one answers a question:

- What is on the market? About 300 models, filtered on price, quality (Arena ELO), openness and capabilities.
- Which model fits our workload and our budget?
- How do 2 to 4 named models compare?
- What does a workload cost per request and per month, and what do caching and batch pricing change?
- Who sells a model, and at what price at each host?
- Which prices moved this week, and what is the price history of a model?
- What does a cloud instance cost on AWS, Azure, GCP, OCI, OVH, DigitalOcean and Alibaba: on demand, spot and with a commitment?
- At what volume does renting capacity cost the same as paying the API?

A promotional price, a retirement notice and a rate that is not live are labelled. A figure that is not known is reported as not known.

Where the figures come from: all 8 tools read OptimNow's own optimtoken.optimnow.io and call no other service. That site compiles public price data every day (OpenRouter's catalogue for models, the providers' price lists for compute) and corrects model prices against vendor pricing pages.

What it does not do: it never connects to your cloud or AI accounts, needs no account or credentials, and does not store your questions. It quotes list prices, not your negotiated rates.

Example questions: "Show me the smartest models for the lowest price.", "How do open-weights models compare with proprietary ones?", "What does an AWS instance cost on spot or with a 3-year savings plan?"

Source code: https://github.com/OptimNow/ai-pricing-hub-mcp.
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
  budgets on a figure should know both. The owner confirmed it on 2026-11-12.
- The example questions are plain ones, as a decision-maker would ask them.
  The detailed ones are in the Use cases step.

### Categories

One to five, from the portal's list. Entered on 2026-11-19: `Data & Analytics`
and `Development tools`. The list had no cost or FinOps category, and
`Financial Services` reads as the finance industry, so it was not taken. The
list that day: Productivity, Communication, Data & Analytics, Development
tools, Financial Services, Consumer Health, Health & Life Sciences, Media &
Entertainment, Commerce & Shopping, Legal, Sales and marketing, Creative,
Nonprofit, Education, Travel, Other.

### Works with

Claude (web & mobile), Claude API, Claude Code, Claude Desktop. The same set as
the Cloud FinOps listing: the server is a plain remote MCP server with no UI.
The form of 2026-11-19 had no such field.

### Links and icon

| Field | Value |
|---|---|
| Documentation URL | `https://optimtoken.optimnow.io/mcp` |
| Privacy policy URL | `https://optimtoken.optimnow.io/privacy` |
| Support | `https://github.com/OptimNow/ai-pricing-hub-mcp/issues` |
| Author name, author URL | `OptimNow`, `https://optimnow.io`. Shown as "by OptimNow"; left blank, they default to the company of step 5 |
| Icon | Custom icon URL `https://raw.githubusercontent.com/OptimNow/ai-pricing-hub-mcp/master/assets/icon.png` (512 × 512). Without one the portal shows the favicon of the server's URL, and `optimtoken-mcp.optimnow.io/favicon.ico` answers 404. The custom icon replaces it in the directory listing only |
| Enterprise managed auth documentation | Left empty: there is no authentication |
| Has an MCP App | Unticked. The server has had no view since 0.5.0. Check the box after every save: on the Cloud FinOps listing it was found ticked again on 2026-11-11. The form of 2026-11-19 showed no such box |

The support field takes the issue tracker, as the Cloud FinOps listing does
(the owner's choice, 2026-11-12). The policy asks for "verified contact information and support channels for
users with product or security concerns": the privacy page also gives
`optimnow.io/contact`.

### URL slug

Permanent once published. The owner's choice of 2026-11-12, to confirm on the
day: it cannot be changed afterwards.

```text
optimnow-ai-economics
```

It follows the Cloud FinOps listing, whose slug is `optimnow-cloud-finops`,
and it holds no product name, so it survives a renaming.

## Step 4. Use cases

Shown to reviewers only. Prerequisites: none (no account, no plan, no setup).
The connector reads data only.

The block has two columns per row, **Use case** and **Example prompt**, and the
reviewer reads a row as the two joined. The policy asks for at least three
working examples. There are twelve here, in two groups, and every tool has at
least one.

The block takes three rows (2026-11-19). Entered: A1, A4 and A6, three plain
questions on three different tools. Prerequisites: "None. No account, plan or
setup: the server is public and read-only." Read/write: Read only. The other
nine are for a reviewer who asks for more.

Plain questions, as a decision-maker asks them:

| # | Use case | Example prompt | Tool |
|---|---|---|---|
| A1 | Find the best value on the market | Show me the smartest models for the lowest price. | `compare-llm-models` |
| A2 | See what the leading models cost | What do the top frontier models cost today? | `compare-llm-models` |
| A3 | Weigh open models against proprietary ones | How do the best open-weights models compare with the best proprietary ones, on quality and on price? | `compare-llm-models` |
| A4 | Pick a model for a workload and a budget | Recommend a model for support tickets under $500 a month. | `recommend-llm-model` |
| A5 | Know when a price moves | Which AI model prices changed this week? | `track-llm-price-changes` |
| A6 | See what a discount is worth on compute | What does an 8-vCPU, 32 GB instance cost on AWS in Europe: on demand, on spot and with a 1-year or 3-year savings plan? | `compare-compute-pricing` |

Detailed questions, as a FinOps practitioner or an engineer asks them:

| # | Use case | Example prompt | Tool |
|---|---|---|---|
| B1 | Compare named models | Compare Claude Sonnet 5.5, GPT-5.5 and Gemini 4 Argon side by side. | `compare-models-side-by-side` |
| B2 | Budget a workload | About 800 input tokens and 200 output tokens per request, 4 million requests a month, 60% of the prompt cached: what does that cost on Claude Sonnet 5.5? | `estimate-llm-cost` |
| B3 | Choose where to buy a model | Who sells Llama 3.3 70B, and what would a coding workload cost at the cheapest host? | `compare-model-hosts` |
| B4 | Tell a price change from a change of host | Which of this week's price moves are real price changes rather than a change of the host quoted? | `track-llm-price-changes` |
| B5 | Compare compute across providers | Compare cloud instances in Europe with at least 8 vCPUs and 32 GB of memory, cheapest first, with what a 3-year commitment saves on each. | `compare-compute-pricing` |
| B6 | Decide between the API and rented capacity | At what monthly volume does renting an AWS g6e.12xlarge cost the same as paying the API for Llama 3.3 70B on support tickets? | `estimate-self-hosting-breakeven` |

B6, the tool's description and the README named a g6e.4xlarge until 0.11.2
(2026-11-20). That instance has one 48 GB GPU, which cannot hold Llama 3.3 70B,
and the tool does not check the fit. A g6e.12xlarge has four L40S, 192 GB in
all, and AWS gives it for models up to 72B parameters in FP16
([instance types](https://aws.amazon.com/ec2/instance-types/accelerated-computing/),
[G6e announcement](https://aws.amazon.com/blogs/machine-learning/amazon-sagemaker-inference-now-supports-g6e-instances/)).
An example the tool prints is quoted by the model that reads it: keep each one
an instance that can run the model it names.

What production answered on 2026-11-12, by the call a model would make:

- A1: `compare-llm-models` with `sortBy: "efficiency"`.
- A2: `compare-llm-models` with `category: "Frontier"`.
- A3: `compare-llm-models` once with `openness: "Open weights"` and once with
  `openness: "Proprietary"`. A third bucket exists, `Open source`: an answer
  that says "open models" should say which it means.
- A6: `compare-compute-pricing` with `region: "europe"`, `provider: "AWS"` and
  8 vCPUs and 32 GB as both minimum and maximum. Each row carries on demand,
  spot and the 1-year and 3-year savings plan and reserved rates, each with
  its saving.
- A4, A5 and B1 to B6: the calls of step 8.

Every model name resolved to one model: "Llama 3.3 70B" to Meta Llama 3.3 70B
Instruct, the three names of B1 to themselves.

**Not used: "Which frontier models were released most recently, and what do
they cost?"** The owner asked for it on 2026-11-12. At 0.11.0 the answers of
`compare-llm-models` do not print a release date and cannot be sorted by it
(the date exists in `structuredContent` only, to the month), so an assistant
would answer the "most recently" part from memory, which is what this
connector exists to prevent. A2 is the nearest question the server answers.
Add the other one when the tool prints the release date and sorts on it.

## Step 5. Company

OptimNow, `https://optimnow.io`. Primary contact for review updates: the
address used for the Cloud FinOps listing.

The portal pre-fills the company name from the account's organisation, spelled
`Optimnow`: it was corrected to `OptimNow`. The contact's name and email are
pre-filled from the Claude account. Role and Anthropic contact were left
empty.

## Step 6. Authentication

**No authentication.** The server serves public, read-only data. Nothing to
configure.

The portal detects it ("no sign-in required") and checks **None**. But on
2026-11-19 the approved listing recorded "Always required" with OAuth
dynamic client registration all the same. Read the listing's Settings tab
before publishing; how to fix it is in `claude-directory-submission.md`,
"After the approval, before publishing".

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

On 2026-11-19 this step was one box, "I have run every tool via MCP Inspector
or as a custom connector in Claude", with no credentials field and no field for
test instructions (the Cloud FinOps submission had a mandatory credentials
field; Anthropic's submission page now says not to put credentials in the
portal). The text below is the self-test to run before ticking the box, and
the answer to a reviewer who asks how to test.

```text
No account or credential exists or is needed: the server is public and read-only.

Add https://optimtoken-mcp.optimnow.io/mcp as a custom connector in Claude, or open it in MCP Inspector, and call each of the 8 tools once. These calls returned content on 2026-11-20:

1. compare-llm-models {"maxInputPrice":1,"minElo":1300,"limit":10}
2. recommend-llm-model {"useCasePreset":"supportTicket","maxMonthlyBudget":500}
3. compare-models-side-by-side {"models":["Claude Sonnet 5.5","GPT-5.5","Gemini 4 Argon"]}
4. estimate-llm-cost {"modelName":"Claude Sonnet 5.5","customInputTokens":800,"customOutputTokens":200,"monthlyVolume":4000000,"cacheHitRate":0.6}
5. compare-model-hosts {"models":["Llama 3.3 70B"],"useCasePreset":"codingTask"}
6. track-llm-price-changes {}
7. compare-compute-pricing {"region":"europe","minVCPUs":8,"minMemory":32,"sortBy":"price","limit":10}
8. estimate-self-hosting-breakeven {"model":"Llama 3.3 70B","instanceType":"g6e.12xlarge","provider":"AWS","useCasePreset":"supportTicket"}

Each answer is a text block, with the same figures as structured content, and it opens with its data source and date.

A model name that matches nothing is reported by name, for example: No models found matching "Zzyzx Nonexistent 9". An invalid argument returns a validation error that names the field, for example: expected number, received string at limit. Neither is a bare 500.

The same questions in plain words, for a chat with the connector on, are the example prompts of the Use cases step.
```

Change the date in that text to the day the calls are run again. Tick "I have
run every tool" only after running them on the deployment that is live that
day. On 2026-11-19 they were run against 0.11.1, after its deploy.

## Step 9. Compliance

Seven acknowledgments, all required, ticked by the owner on 2026-11-19, and
an optional Additional notes field, left empty. How each applies:

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
submitting. Submitted by the owner on 2026-11-19.

## Keeping the listing current

The public listing shows the eight tools by name only, so a description change
shows nowhere on it. The review is another matter. The Software Directory
Policy (3.H) asks a listed connector to report "material changes to their
Software's functionality, tool or capability descriptions, data practices, or
connected endpoints", which "may be subject to re-review". Adding a tool,
rewording a description, changing a schema or what a tool sends, or calling a
new endpoint all qualify. And the reviewers work from the tool list the portal
captured, not from the live server: the Cloud FinOps review of 2026-11-06
quoted wording its server had dropped five weeks before, from an older capture.

The order of a pass, as the Cloud FinOps connector runs it
(`docs/directory-submission.md`, section 4, in `OptimNow/cloud-finops-skills`):

1. The release is merged and the `deploy` job of CI is green: it has checked
   what the live server serves.
2. On claude.ai, Customize, Connectors, Yours, the connector, ⋯, **Refresh
   tools list** (step 2 above), so the account holds the new tools.
3. In the portal, the listing's full editor: make every edit at once, read
   **Has an MCP App** (it must stay unticked; on the Cloud FinOps listing it
   was found ticked again on 2026-11-11), and under **Tools & prompts** choose
   this account's connector, so that a fresh capture is attached. Save once.
4. Check that the Tools tab shows the new date.
5. Email `mcp-review@anthropic.com` what changed on the server since the
   previous capture, release by release. The owner sends it.

Where it stands on 2026-11-22: the listing was approved on the capture of
0.11.1 (2026-11-19). Since then 0.11.2 to 0.12.1 changed tool descriptions,
output schemas (0.12.0) and the text every answer closes with (0.12.1), and no
pass has been made. 0.13.0 changes no tool definition: its `tools/list` and
`instructions` are byte-identical to 0.12.1's. Its answers differ (close names
on a miss) and its requests to the site carry a User-Agent and are held to one
origin. 0.14.0 rewrites the model-facing text so that it gives one order only,
and makes every input schema strict. 0.14.1 and 0.14.2 change no definition.
0.14.3 rewords three clauses 0.14.0 had left, which told the model what to do
with an answer, in three tools. One pass after 0.14.3 covers all of them: it
was held back until then on purpose, so that the capture the reviewers read
holds no such clause.

### Draft of the email to mcp-review@anthropic.com, after 0.14.3

To be sent by the owner, from the address the listing's correspondence uses,
once the pass above is saved. Subject: "AI Economics (optimnow-ai-economics):
server changes since the November 19 capture".

```text
Hello,

AI Economics (claude.ai/directory/optimnow-ai-economics, server
https://optimtoken-mcp.optimnow.io/mcp) was approved on November 19, 2026, on
the tool list of version 0.11.1. I have refreshed the capture in the portal.
The server changes since then, release by release:

- 0.11.2 and 0.11.3: tool descriptions reworded (an instance name in the
  break-even examples; requests for alternatives pointed to recommend-llm-model,
  a tool of this server).
- 0.12.0: fields added to the output schemas of three tools, stating what an
  optimized cost assumes (cache share, batch eligibility). No field removed.
- 0.12.1: every answer's text closes with one line naming the source of its
  figures (OptimToken, with the date of the prices).
- 0.13.0: no definition change. A model name that matches nothing returns up
  to three close catalogue names. Requests to optimtoken.optimnow.io, the only
  host the server calls, now identify the server, follow no redirect to another
  host, and refuse oversized bodies; text from that site is checked to be
  short, single-line labels before it is relayed.
- 0.14.0: the server instructions, descriptions and fixed answer texts were
  rewritten as statements of what the tools return, with one exception kept on
  purpose: the sentence asking that the source be named with the figures (in
  the instructions, and as the closing line of each answer). Measured on
  November 22, the source was named in all test answers with that sentence and
  in 1 to 4 of 6 to 9 without it. Two descriptions no longer link
  optimnow.io. Every tool now refuses an argument it does not declare, and
  declares idempotentHint.
- 0.14.1: recommend-llm-model's answer text no longer links our ROI calculator
  (another OptimNow product). No definition change.
- 0.14.2: no definition change. Corrections to how a model name is matched
  (a name given with its provider, a "+" in a name, a short name matching
  inside a word), and a model name over 200 characters is refused. The compute
  answers say which place each provider's prices are from.
- 0.14.3: three clauses that 0.14.0 had left, and that told the model what to
  do with an answer, are reworded as statements: in the descriptions of
  compare-model-hosts and track-llm-price-changes, and in one parameter of
  compare-llm-models. No schema, argument or output changes.

The tools remain read-only, take no account and call one host, which OptimNow
owns. Happy to adjust anything.

<the owner's name>, OptimNow
```

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
