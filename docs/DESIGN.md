# ai-pricing-hub-mcp: design reference

Sections moved verbatim from `CLAUDE.md` on 2026-11-08 to keep that file short. `CLAUDE.md`
keeps what an agent needs in every session and lists the sections below.

## Architecture

```
Runtime:      Node, the official MCP SDK, node:http. No framework.
Language:     TypeScript
Build:        tsc (dist/server/src/index.js)
UI:           none. Seven tools; each answers with text and structuredContent
Deployment:   Fly.io (app ai-pricing-hub-mcp, region cdg, scale-to-zero)
Transport:    Streamable HTTP at /mcp, stateless (https://optimtoken-mcp.optimnow.io/mcp)
Data:         optimtoken.optimnow.io API (source of truth)
              → direct OpenRouter (LLM only, uncorrected)
              → static fallback in data/pricing-data.ts
```

### Why there is no framework and no UI (0.5.0, 2026-11-11)

Up to 0.4.2 this was an MCP App on Skybridge (Alpic's framework): every tool
also rendered a React widget, built with Vite and served from `/assets`. Both
went in 0.5.0, on the owner's decision to run a plain MCP server. What that
removed, so nobody rebuilds it by accident:

- `web/` (five widgets, a shared component set, `format.ts`, `scale.ts`), and
  with it React, Vite and Skybridge: `npm ci` went from 280 packages to 99.
- The `ui://widgets/ext-apps/*` resources and each tool's `_meta.ui.resourceUri`.
  `resources/list` is now "Method not found".
- `pinPublicUrl` and the pinned `_meta.ui.domain` hash. claude.ai compared that
  hash with the URL the user had pasted, which is why the URL had to be pasted
  exactly. It no longer has to be: `/mcp` and `/mcp/` both answer, on any
  hostname that reaches the machine.
- `web-mirror.test.ts` and `scale.test.ts`, which held the widget bundle to the
  server.

What it fixed on the way: Skybridge 0.35 connected one shared MCP server to a
new transport on every request, and the MCP SDK refuses a second `connect()` on
a connected server. Any request that overlapped another was answered HTTP 500
"Internal server error". Measured against production on 2026-11-11: eight
concurrent `compare-compute-pricing` calls behind a cold `europe` fetch, seven
500s. `lib/http.ts` builds one server per request instead, which is the SDK's
own stateless pattern, and `lib/http.test.ts` sends eight at once.

The HTTP surface is three things: `POST /mcp` (and `/mcp/`), `GET /healthz`
(200, liveness only), and 404 for everything else. `GET` and `DELETE` on `/mcp`
are 405, as the transport specifies for a server with no SSE stream and no
sessions. Request bodies over 1 MB are refused with 413.

### Data sources and the fallback chain

`https://optimtoken.optimnow.io` is the single source of truth for both LLM and
compute pricing. It is the deployed face of `cloud-sparkle-compare`, and it is
where pricing *correctness* lives: a committed price archive, a `PRICE_OVERRIDES`
table verified against vendor pricing pages, and `scripts/check-price-anomalies.mjs`,
which alarms on the ×0.5 / ×2.0 ratio breaks OpenRouter intermittently serves.
This app has no archive and cannot build one, so it asks rather than re-derives.

The base URL is one constant, `OPTIMTOKEN_BASE_URL` in `lib/optimtoken-api.ts`,
overridable with the `OPTIMTOKEN_API_BASE_URL` env var. Do not hard-code a
second host.

| Tool | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| LLM tools | `GET /api/llm-models` | `openrouter.ai` direct | static snapshot |
| Compute tool | `GET /api/pricing?region=` | — | static snapshot (137 rows) |
| Every host of a model (`compare-model-hosts`) | `GET /api/model-hosts?id=` | — | — (the summary on the model rows answers instead) |

The compute tool served the static array alone until optimtoken became the
source of truth. Its `openWorldHint` was corrected to `true` at that point.

**Tiers 2 and 3 serve uncorrected prices.** That is not a detail: OpenRouter has
published GPT-5.6 Sol at $2.50/$15 against OpenAI's actual $5/$30, halving every
derived monthly figure. Every response therefore carries a `provenance` object
with `pricesVerified`, and the lower tiers set a `notice` that leads the text
output. A fallback must never silently downgrade correctness.

Tier 1 is only accepted when the site reports `meta.source === "openrouter"` —
anything else means the site is itself serving its own fallback and carries no
fresh corrections.

### Project Structure

```
ai-pricing-hub-mcp/
├── server/
│   └── src/
│       ├── index.ts                  # The 7 tools, createServer(), listen, cache warm-up
│       ├── serialisation-contract.test.ts  # Source-level guard: rounding + provenance
│       ├── lib/
│       │   ├── http.ts               # node:http: POST /mcp on a per-request MCP server, /healthz
│       │   ├── optimtoken-api.ts     # Base URL constant + shared fetch/timeout discipline
│       │   ├── public-url.ts         # PUBLIC_MCP_URL, the one published URL
│       │   ├── compute-pricing.ts    # /api/pricing fetch, region, per-column provenance
│       │   ├── compute-rates.ts      # A compute row's rates as text, and what each saves on on-demand
│       │   ├── host-prices.ts        # Per-host prices: port of the site's reader, coercion, wording
│       │   ├── model-hosts.ts        # Every host of a model: the site's /api/model-hosts, read on demand
│       │   ├── deprecation.ts        # Retirement notices: reading the site's, and wording them
│       │   ├── output-schema.ts      # Forces JSON Schema 2020-12 on tool outputSchemas
│       │   ├── llm-models.ts         # 3-tier model fetch, ELO enrichment, name resolution
│       │   ├── llm-business-metrics.ts # Efficiency scoring, use-case profiles, FinOps badge
│       │   ├── roi-link.ts           # Deep link into the sister AI ROI Calculator
│       │   ├── openness.ts           # Licence → self-hostability bucket
│       │   ├── pricing-normalize.ts  # Publishable-pricing guard (rejects -1 router rows)
│       │   ├── compute-categories.ts # Instance category, processor, use cases: the site's file, copied whole
│       │   ├── azure-size-name.ts    # How an Azure size name reads; port of the site's parser
│       │   ├── self-hosting.ts       # Break-even between an API and a rented fleet. Not a port
│       │   └── *.test.ts             # capabilities, compute-categories, compute-rates, data-sources, deprecation, host-prices, http, llm-business-metrics, model-hosts, output-schema, public-url, self-hosting
│       └── data/
│           └── pricing-data.ts       # Static fallback LLM pricing + 137 compute instances
├── docs/
│   ├── chatgpt-submission.md         # Blockers + portal run for the ChatGPT directory
│   ├── claude-directory-submission.md # Status, portal run and listing material for the Claude directory
│   └── chatgpt-app-smoke-tests.md    # The positive / negative cases the portal asks for
├── scripts/
│   ├── refresh-llm-fallback.mjs      # Re-snapshots the static model list
│   ├── check-site-parity.mjs         # Manual: run this server's logic and the site's over the live catalogue
│   ├── check-connector.mjs           # Manual: call a deployed connector: tools, tier, eight calls at once
│   └── check-serialisation-precision.mjs  # Manual: walk a live server for float noise
├── .github/workflows/ci.yml          # typecheck + test + build on every PR; deploys master to Fly
├── Dockerfile                        # Image for Fly.io (two-stage build)
├── fly.toml                          # Fly.io app config (cdg, scale-to-zero)
├── server.json                       # Manifest for the official MCP registry
├── AGENTS.md
├── package.json
├── tsconfig.json                     # Build + typecheck (excludes *.test.ts)
└── tsconfig.test.json                # Type-checks the tests
```

Tests live beside their subjects: `lib/data-sources.test.ts`,
`lib/llm-business-metrics.test.ts`, `lib/output-schema.test.ts`,
`lib/http.test.ts` (the HTTP layer over a real socket, eight requests at
once), `lib/public-url.test.ts` (pins the connector URL and every published
copy of it), `lib/capabilities.test.ts`, `serialisation-contract.test.ts` and
`version.test.ts`.

---

## Development

```bash
npm install
npm run dev        # tsx watch on server/src/index.ts, http://localhost:3000/mcp
npm run typecheck  # tsc --noEmit over both tsconfigs (src and tests)
npm test           # node --test over server/src/**/*.test.ts
npm run build      # Empties dist/, then tsc: dist/server/src/index.js
npm run start      # node dist/server/src/index.js (serves /mcp on $PORT, default 3000)
```

`.github/workflows/ci.yml` runs typecheck, test and build on every PR, and on
every push to `master` deploys to Fly.io once those pass (see below).

The port comes from `PORT` (Fly sets 8080), default 3000. `npm run build`
deletes `dist/` first, so a stale file from an earlier build cannot be started
by mistake.

`scripts/check-serialisation-precision.mjs` is deliberately outside CI: it needs a
running server and the live catalogue. Run it by hand after touching cost code.

### Deployment

```bash
fly deploy    # by hand, from the repo root; master normally deploys itself
              # (`npm run deploy` runs the same)
```

The connector URL is **`https://optimtoken-mcp.optimnow.io/mcp`**. That is the
URL `README.md` and `server.json` publish, and it is **one constant**,
`PUBLIC_MCP_URL` in `lib/public-url.ts`; `public-url.test.ts` fails if any
published copy drifts from it. It is a custom domain on the Fly app: a CNAME
`optimtoken-mcp.optimnow.io -> ai-pricing-hub-mcp.fly.dev` in the `optimnow.io`
zone (hosted on Wix DNS) plus a certificate from
`fly certs add optimtoken-mcp.optimnow.io`. The `ai-pricing-hub-mcp.fly.dev`
host answers too (the `deploy` job reads its version) but is not published.
Locally, `npm run start` serves the same `/mcp` path.

**Releases deploy themselves.** The `deploy` job in `ci.yml` runs
`flyctl deploy --remote-only` on every push to `master`, after the `check` job
has passed, then asks the live server for its `serverInfo.version` and fails
unless it matches the `version` in `server/src/index.ts`. It needs the
`FLY_API_TOKEN` repository secret (`fly tokens create deploy --app
ai-pricing-hub-mcp`). It was added because the manual step was forgotten: see
the 0.3.0 deploy below.

Dependabot merges do **not** trigger it. Auto-merge is queued with
`GITHUB_TOKEN`, and GitHub starts no workflow from a push made with that token.
Those bumps ship with the next human merge, or at once from Actions → CI → Run
workflow on `master`.

**Docs-only pushes do not redeploy.** Every CI deploy labels its image with the
commit SHA (`--image-label`), which the machines report back as
`image_ref.tag`. Before deploying, the job diffs that live commit against
`HEAD` and skips the rollout when every changed file is documentation:
Markdown anywhere, `docs/`, or `LICENSE`. The version check still runs.
It diffs against the **live commit, not the previous push**, because of the
Dependabot rule above: a docs-only merge that follows Dependabot merges still
carries their lockfile changes, so it deploys them. Whatever it cannot
establish deploys: a manual run, an unlabelled image (any `fly deploy` by
hand), machines on different images, or flyctl failing. A skip shows as a
notice on the run. Before changing the file patterns, check the build context
in `.dockerignore`: a file the image copies must never count as documentation.

The Fly app already exists, so do not run `fly launch` in this repo again. On a
Node project it generates its own `Dockerfile`, `fly.toml`, `.dockerignore` and
`.github/workflows/fly-deploy.yml`, and adds `@flydotio/dockerfile` to
`package.json`; all of that collides with the committed files.

`Dockerfile` builds in two stages (`npm run build`, then production
dependencies plus `dist/`) and starts `node dist/server/src/index.js`,
`fly.toml` runs one `shared-cpu-1x` / 512 MB machine in `cdg` that scales to
zero, and `.dockerignore` keeps the context to what the build copies. The
Skybridge-era image was verified on 2026-10-07 by building it and calling it
(compute tier 1, cold `europe` call 7.8 s, ~140 MB resident after a compute
call). The tools-only image was first built by the CI deploy of 2026-11-11 (0.5.0)
and checked in production the same day with `scripts/check-connector.mjs`:
every check passed, eight concurrent calls answered. Its cold start and memory
have not been measured the way the Skybridge-era image's were.

**The app runs one machine, and `fly.toml` does not enforce that.** On an app's
first deploy Fly creates two machines for redundancy, whatever `fly.toml` says;
later deploys update the machines that exist and keep the count. This app got
two on 2026-10-07 and was scaled back with `fly scale count 1 --app
ai-pricing-hub-mcp`. One is deliberate: each machine holds its own warm caches,
so a second one makes a cold upstream fetch twice as likely, for redundancy a
pricing lookup does not need. Check with `fly machine list`.

**A manual `fly deploy` builds what is on disk, not what is on `master`.** The first
deploy on 2026-10-07 answered `initialize` with `serverInfo.version` 0.3.0 and
still offered the `Code` capability, while `master` was at 0.4.0: it had been
run from a checkout that predated PR #42. Pull first, deploy, then check the
version the live server announces against `package.json`:

```bash
curl -s -X POST https://ai-pricing-hub-mcp.fly.dev/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
  | grep -o '"serverInfo":{[^}]*}'
```

**Verify by calling, not by reading.** `node scripts/check-connector.mjs` runs
`initialize` and `tools/list` against the published URL (or a URL you pass),
checks each tool's title, annotations and schema dialect, checks that no
`ui://` resource is offered, calls `compare-llm-models` and checks
`provenance.tier` is 1, sends eight tool calls at once and expects eight
answers, and reads `/healthz`. Run it after every deploy and before touching
the registry entry or the directory listing. Against 0.4.2 in production it
fails on purpose: the widget resources are still listed, and the eight
concurrent calls are not all answered.

Three things about Fly that matter here:

- **The connector URL ends in `/mcp`.** The root is a 404 on Fly. Alpic mapped
  the root to the MCP endpoint, which is why older connectors and docs used the
  bare origin.
- **No Host allow-list.** The server answers on any hostname that reaches it,
  so the 421 the Python FinOps server hit on Fly does not apply here. Nothing
  depends on the hostname any more: the pinned `ui.domain` hash went with the
  widgets.
- **Scale-to-zero drops the warm caches.** The boot warm-up assumes the process
  outlives requests. With `min_machines_running = 0`, an idle machine stops, and
  the next caller pays the machine start plus an upstream fetch (up to ~8 s on
  `compare-compute-pricing`). Set it to 1 if that latency matters.

The server handles SIGINT and SIGTERM itself (it stops accepting connections
and exits, with a 3 s ceiling for a request in flight), so it should stop
cleanly as PID 1 without `--init`. That is new in 0.5.0 and has not been
exercised in a container yet; under Skybridge, `docker run` needed `--init` or
the process was only killed at the stop timeout.

#### Publishing to the MCP registry

`server.json` is what <https://registry.modelcontextprotocol.io> lists. Nothing
publishes it automatically: it is a manual `mcp-publisher` run (the CLI is
downloaded locally and git-ignored). **A published version can never be
edited**, so any change to `server.json` (a new connector URL, a description)
needs a version bump before the registry will show it. 0.4.0 went up on
2026-10-05 with the Alpic URL, which is why the Fly URL shipped as 0.4.1, and
the custom domain ships as 0.4.2.

The version lives in four places — `package.json`, `package-lock.json`,
`server.json`, and `version:` in `server/src/index.ts` — and `version.test.ts`
fails if they disagree. Release order:

1. Merge the bump and wait for the `deploy` job in `ci.yml` to go green. It
   deploys `master` and fails unless the live server announces the version this
   commit declares, so green means the new version is live. Publishing first
   would list a version the endpoint does not serve yet.
2. `git pull` (`server.json` is read from disk), then from the repo root:
   `mcp-publisher login github`, then `mcp-publisher publish`.
3. Confirm the entry and its `remotes` URL:
   `https://registry.modelcontextprotocol.io/v0/servers/io.github.OptimNow%2Fai-pricing-hub/versions/latest`
   Not the `?search=` listing: right after the 0.4.1 publish on 2026-10-07 it
   still showed 0.4.0 as latest while this endpoint already returned 0.4.1, so
   it can make a successful publish look failed.

#### Alpic (retired)

Until 2026-10-07 the connector was `https://ai-pricing-hub-mcp-9604f763.alpic.live/`.
That endpoint answered `initialize` with HTTP 402 from 2026-09-09: Alpic's
shared free quota, which took every OptimNow connector down that day. The Cloud
FinOps connector moved to Fly.io then (`OptimNow/cloud-finops-skills` PR #195).
`alpic.json`, `.alpic/` and the `alpic` CLI were removed from the repo on
2026-10-07, and `npm run deploy` now runs `fly deploy`. The Alpic project itself
is not deleted by that: it lives on Alpic's side until removed in its dashboard.
The Alpic-era measurements in **Constraints** below were taken on that platform.

### Connecting to Claude Desktop

Add it as a **custom connector** (Settings → Connectors → Add custom connector),
pasting the URL above. Connectors are stored account-side and use the native
HTTP transport.

Two paths that look equivalent and are not (both verified 2026-08-19, against
the Skybridge-era server):

- `claude_desktop_config.json` does **not** accept `"type": "http"` entries —
  Desktop silently drops them from the file on its next config rewrite. This
  section used to recommend exactly that; it never worked.
- An `npx mcp-remote` wrapper in that file does connect, but its OAuth discovery
  plus a GET SSE stream this server rejects push `initialize` past Desktop's
  ~6 s timeout, so every conversation shows "Unable to reach" even though calls
  then succeed.

A connector added before 0.5.0 keeps working: the tool names, arguments and
`structuredContent` fields are unchanged. It simply stops drawing a widget, and
the assistant answers from the text block.

---

## Keeping in sync with cloud-sparkle-compare

The surface that could drift has shrunk, but it has not gone.

**No longer a concern.** The taxonomy (`category`, `license`) and the corrected
prices now arrive from the site on tier 1 rather than being re-derived here.
That closes the class of bug that produced a retired `Open Weights` category and
an unrecognised `Llama 4` licence in this repo — both of which had already
diverged before the switch.

**Still a manual port, and still able to drift:**

- `lib/llm-business-metrics.ts` — the cost formulas, efficiency scoring, use-case
  profiles and FinOps badge. The site does not expose these, so this app computes
  them. The test is the result, not the text: both apps must produce the same
  cost to the cent, the same score and the same badge for the same model and use
  case, and `npm run check-parity` (below) measures exactly that.
- `lib/openness.ts` — the licence → self-hostability buckets. The site sends the
  licence *string*; the bucketing is local, so a new licence string upstream
  silently becomes `Unknown` here until it is added. This is how `Llama 4` broke,
  and then fourteen more strings (17 models) by 2026-11-11. Two things now catch
  the next one: `fetchFromSite` logs any licence string the buckets do not know,
  and a test holds the buckets to every licence in the snapshot, so a
  `refresh-fallback` that brings a new string in fails until it is added.
- `lib/llm-models.ts` tier 2 — the whole OpenRouter transform (ELO table,
  categories, exclusions, licence prefixes) is a port and only runs when the site
  is unreachable, so its drift is invisible until the day it matters.
- `lib/compute-categories.ts` — instance categorisation, processor and use-case
  inference, applied locally to the site's rows. It is the site's file copied
  whole (only its two imports differ), with `lib/azure-size-name.ts` holding the
  one function it needs from the site's `azure-vm-sizes.ts`. It had not been
  copied since March 2026 while the site rewrote its rules in October (its
  review finding C6), and nothing compared the two: on 2026-11-11, 826 of the
  3,555 Linux rows in us-east carried another processor here than on the site
  (121 of the 211 GPU rows: `g6e` read "NVIDIA L4", it is an L40S; every
  `m6gd`, `c7gn` and `m5ad` read Intel) and 138 another category (`trn1` read
  Burstable, `hpc7g` Storage Optimized). Copied again that day at the site's
  commit `c4a6916`; `check-parity` now compares all three labels over the live
  compute catalogue. Do not edit the rules here: a fix made in this copy does
  not reach the site, and the next copy erases it.
- `lib/host-prices.ts`, first half — whose price the quoted one is
  (`priceProvenance`, the 2% `sameRate` tolerance), when a spread is worth
  saying, the standard rate behind a promotion, and
  `MAKER_ROW_NOT_STANDARD_RATE`, which the site keeps in
  `src/lib/host-pricing-view.ts`. `check-parity` compares all of them over the
  live catalogue, and also that `coerceHostPricing` lets a summary through
  exactly as the site sent it: a field the site adds to `hostPricing` fails
  that check until someone decides what to do with it.

**The optimized cost charges the cache write.** A cache read is only possible
after a cache write, which vendors that publish a write rate bill above ordinary
input (typically 1.25x). The site added that term on 2026-09-21 (its API schema
2.3, `cacheWritePricePer1M`); this server followed on 2026-11-11, synced to the
site's commit `eb24b8f`, having spent the interval crediting the read without
charging the write. `cachedInputRate()` is
the site's formula term for term, including `CACHE_READS_PER_WRITE = 5` and the
clamp at the base rate. The site publishes the formula as a spec (its
cost-per-request methodology guide), so the constant moves there first.

**One rule is stricter here than on the site, on purpose.** The site takes the
batch branch whenever batch rates are published and the workload is async, then
clamps the result at list. This server takes batch only when the batch branch is
the cheaper of the two, takes caching only when it pays on the branch chosen, and
returns the list cost as the very same float when no lever is pulled. The two
agree on every pair unless a batch branch lands between the standard branch and
list, which no catalogue row does. The rule exists because `optimizationLevers()`
names the levers behind each saving: Zhipu GLM 5.2 once listed batch above list
($0.70/$2.20 against $0.49/$1.54), and OpenAI's gpt-oss-120b lists a cache read
($0.075) above its batch input rate ($0.0296), which under batch raised the cost
16% while the text credited "caching + batch API". A lever that costs money must
not be reported as applied. Do not relax it to match the site's text; it is
pinned by tests on synthetic dear-batch, dear-cache and dear-cache-under-batch
models, and by two whole-catalogue sweeps.

**The retirement gate is applied since 0.8.0.** The site refuses the FinOps
Friendly badge to a model whose maker has announced its retirement, from a
table it keeps by hand (`model-lifecycle.ts`, 48 entries). Until its schema 2.8
the API did not publish that table, and this server left the rule out rather
than copy a list that drifts in silence. Since 2.8 the notice arrives on the row
(`deprecation`), `checkFinOpsFriendly` reads it, and `check-parity` compares
both the notice and the badge. The table is still not copied here: see
"Retirement notices" under Data Flow.

**What the site sends that this server only repeats.** `outlierListing` and
`promotionalListing` (schema 2.6 and 2.7) are verdicts the site reaches from its
nightly per-host price fan-out. `coerceSiteModel` carries them, the badge refuses
an outlier listing, and every text block labels both. Tiers 2 and 3 cannot
compute either; the snapshot keeps the flags it was taken with. `deprecation`
(schema 2.8) is carried the same way, on tier 1 only: the snapshot does not keep
it. `hostPricing` and `openRouterId` travel beside the rows, not on them
(decision 9b in `CLAUDE.md`).

Three things keep the two honest:

- `npm run check-parity -- <path to the cloud-sparkle-compare checkout>` loads
  both implementations, feeds them the live catalogue and counts where they
  disagree: list and optimized cost over every model x use case, efficiency
  score, badge, openness bucket, the outlier flag against the site's own rule,
  the retirement notice against the site's own table,
  the formatters, the per-host price rules, and the category, processor and
  use cases of every row of the live compute catalogue. It exits 1 on any
  difference and lists the site's row fields this server does not carry. Outside CI because the site's repository
  is private. **Run it before each release and after any change to the cost
  code.** 2026-11-11, before the resync: 307 of 2,512 optimized costs apart, 37
  scores, 3 badges, 17 openness buckets. After: none.
- `npm run refresh-fallback` re-snapshots the static model list from `https://optimtoken.optimnow.io/api/llm-models` into the `LLM-FALLBACK-START/END` markers in `server/src/data/pricing-data.ts`. It refuses to write on a collapsed catalogue, and re-derives the price tier for any row still carrying the retired `Open Weights` category (a deployment on schemaVersion 1.0). It moves `dataLastUpdated` only: the static compute rows have their own date, `computeDataLastUpdated`, because the script never touches them.
- The tier-2 ELO table in `lib/llm-models.ts` is the site's, copied whole between the `ELO-SCORES-START/END` markers together with `ELO_AS_OF`. The site rewrites every value weekly from one read of Arena's leaderboard; a partial copy would mix two scales. The rest of the tier-2 transform (exclusions, licence prefixes, release dates) was last ported in August 2026 and has not been re-read since.

Before adding LLM business logic here, check whether `cloud-sparkle-compare` already has it and port rather than reinvent.

### Capabilities: there is no `Code`

The values are `LLM_CAPABILITIES` in `data/pricing-data.ts`: Text, Vision,
Reasoning, Agents, Image Gen, Audio. The site removed `Code` on 2026-10-05 (its
LLM schemaVersion 2.5): it was assigned to any model whose output cost $0.50 per
1M tokens or more, 225 of 292 models, so it described a price and not an
ability. This repo followed the same day. Three things hold it:

- **One list.** The `LLMCapability` type and both tool descriptions
  (`capability`, `requiredCapability`) are built from `LLM_CAPABILITIES`, so a
  description cannot offer a value the data does not carry.
- **The site's payload is filtered to that list** (`coerceSiteModel`). A
  deployment a release behind, or rolled back, would otherwise put `Code` back
  on its rows while the descriptions say it does not exist.
- **The OpenRouter tier no longer assigns it** (`inferCapabilities`).

`lib/capabilities.test.ts` pins all three and the snapshot.

**`Reasoning` means the model exposes a reasoning control upstream**: OpenRouter
lists `reasoning` in its `supported_parameters` (a thinking budget or effort
setting). It is not a quality claim. The site moved to that rule on 2026-09-21;
the OpenRouter tier here kept a name match ("-pro", "thinking", "o4", ...) until
2026-10-05, so a caller filtering on `Reasoning` got a different set depending on
which tier answered. Both tiers now use the parameter, and the same test file
pins that a name alone never fires.

---

## Data Flow

```
optimtoken /api/llm-models → fetchLLMModels() → enrichModels() → filterModels() → sortEnrichedModels() → structuredContent
        ↓ (tier 2, uncorrected)                                                                 + provenance
openrouter.ai/api/v1/models
        ↓ (tier 3)
pricing-data.ts (static snapshot)

optimtoken /api/pricing?region= → fetchComputeInstances() → enrichInstances() → filter/sort
        ↓ (tier 2)                                                      → structuredContent
pricing-data.ts computeInstances                                          + provenance
```

Note the ordering on the LLM path: `enrichModels()` runs over the **full**
catalogue before `filterModels()`, because the efficiency score and the FinOps
badge are percentile ranks. Filtering first would make the badge mean something
different depending on which filters the caller happened to pass.

### Table order in `compare-llm-models` (0.6.0)

The catalogue arrives in Arena ELO order (`sortModels` in `llm-models.ts`: ELO
descending, then unranked models newest first). Until 0.6.0 that was the only
order the tool could return, and nothing in the response said so: "the ten
cheapest models for a coding task" meant fetching 50 rows and sorting them by
hand. `sortBy` now takes `elo` (default, unchanged), `efficiency`, `cost`,
`optimizedCost`, `inputPrice` or `outputPrice`. The rules, all in
`sortEnrichedModels()`:

- **Best first, no direction argument.** Quality and value descend, costs and
  prices ascend. "The dearest first" is not a question this tool is asked.
- **Sorted after filtering, before `limit`,** on the unrounded figures, so
  `limit` keeps the first rows of the order asked for.
- **A missing figure sorts last**, and a price of zero is missing, not
  cheapest: the same reading `computeScoreComponents` takes of an unpriced
  model. A model with no ELO has no efficiency score either.
- **Ties keep the ELO order**, because the sort is stable and the input arrives
  in it.
- **The response states its order**: `sortedBy` in `structuredContent`, and
  "sorted by ..." in the text. Each row also prints its ELO and efficiency
  score, `n/a` included, since a table sorted by price otherwise shows an
  unranked model as if it were a ranked one.

`cost` and `optimizedCost` depend on `useCasePreset`, so the same catalogue
orders differently for a support ticket and for a meeting summary. That is the
point of them over `inputPrice` and `outputPrice`.

### Commitment rates in the compute text (0.6.0)

`compare-compute-pricing` has always returned `savingsPlan1yr/3yr` and
`reserved1yr/3yr`, but its text printed on-demand and spot only. With no widget
the text is what the model reads (decision 1b), so the commitment discount,
the first thing a FinOps answer about compute is asked for, usually never
reached the reader. `lib/compute-rates.ts` now writes every rate a row
carries:

```
On-demand: $0.0832/hr ($60.74/mo), Spot: $0.0250/hr (-70%),
Savings plan 1-yr: $0.0607/hr (-27%), 3-yr: $0.0416/hr (-50%),
Reserved 1-yr: $0.0524/hr (-37%), 3-yr: $0.0358/hr (-57%)
```

- **Each saving is against the same row's on-demand rate**, as a whole
  percentage, and is also returned as `spotSavingsPct`,
  `savingsPlan1yrSavingsPct` and so on. Null when the rate is missing or is not
  below on-demand: the field is never negative, and the text then says "not
  below on-demand" in words. No such row existed in `us-east` on 2026-11-11.
- **A row with no commitment rate says "no commitment rate listed".**
  DigitalOcean, OVH and OCI publish none here; silence read as "nothing to add".
- **The `savingsPlan*` columns are called CUD on GCP rows** and Savings plan
  elsewhere. What they hold, per the site's OpenAPI: effective hourly, no
  upfront where the provider offers it; `reserved*` is the published no-upfront
  hourly rate on AWS and the term total divided by term hours on Azure.
- **A `static` figure is tagged where it is printed**, `(-37%, static)`, with
  one line under the table saying what static means. The notice at the top
  already lists the static columns of the whole catalogue; the tag is for a
  reader who quotes one row. On tier 2 there are no price types and no tags:
  the notice says the whole response is the snapshot.
- **AWS Savings Plan rates are dated separately.** Since the site's pricing
  schema 1.3 they come from AWS's published Compute Savings Plan price files
  (No Upfront, shared tenancy), read by a weekly job, and
  `meta.awsSavingsPlansAsOf` is AWS's publication date. It is carried as
  `provenance.awsSavingsPlansAsOf` and quoted under the table when an AWS
  savings plan rate is shown. If upstream could not read a region's files the
  date is absent and the columns fall back to the scaled estimate, marked
  static.

Not done: the table cannot be sorted by a commitment rate, so "the cheapest
3-year commitment" is read off the cheapest on-demand rows.

### Per-host prices: `compare-model-hosts` (0.6.0)

Every other tool quotes one price per model. It is one host's rate. On
2026-11-11, 145 of 311 models were sold by at least two hosts, 50 by at least
five, and on 34 the dearest cost twice the cheapest or more. The site reads
each model's hosts nightly from OpenRouter and publishes a compact summary on
every row of `/api/llm-models`: `hostPricing` (host count, cheapest, dearest,
the maker's own, spread, promotional listings), dated by
`meta.hostPricingAsOf`. This tool is a reader of that summary.

- **One more tool, not more fields on the others.** At `limit: 50`,
  `compare-llm-models` is already about 43,000 characters; a host summary per
  row would add roughly half again. And "where do we buy it" is a question
  about named models, like `compare-models-side-by-side`, with which it shares
  name resolution (`resolveNames`, `describeResolution`).
- **The summary travels beside the rows** (decision 9b in `CLAUDE.md`). A
  model with no entry prints "no per-host pricing", and the text says that is
  unknown, not one host. Tiers 2 and 3 have none at all and say so.
- **Each offer is costed for a workload** (`useCasePreset`, `volumePreset`) and
  compared with the cost at the quoted price: "−25% vs quoted". List price
  only: the site publishes no cache or batch rate per host.
- **The quoted price is classified**, with the site's own function and
  sentences: the maker's own rate, another host's, or a figure no host
  currently publishes.
- **The caveats are in the text**, because they decide whether the cheap host
  is a bargain: a promotional listing prints its discount and the standard
  rate behind it; listings that declare different builds (fp8, bf16, int4)
  are called not like-for-like, and the ELO was not measured on a quantized
  build; negotiated rates and provisioned capacity are not shown.
- **Hosts at one rate are said to be at one rate.** When the cheapest and the
  dearest match to within 2%, every host between them does too, and naming a
  "cheapest" and a "dearest" would invent a difference. Claude Opus 5.5 read
  that way on 2026-11-11: five hosts, Amazon Bedrock and Anthropic among them,
  one rate.
- **The maker's row is not always the maker's price.** For the ids in
  `MAKER_ROW_NOT_STANDARD_RATE` the row upstream lists under the maker's name
  has been a discount tier (OpenAI's flex rate, from 30 August to 14 October
  2026). The API does not flag it; the site keeps the list in its reader, and
  this server keeps the same one, held equal by `check-parity`. `vendor` is
  then null, `vendorRowNotStandardRate` true, and the text says why.
  **The exception bites only while that row differs from the quoted price**
  (`makerOffer`). The site pins the quoted price of these models to what it
  read on the maker's own page, so a maker row at that rate is the standard
  rate. This is not a refinement for its own sake: the list is kept upstream
  until a re-check due on 2026-11-21, the row has read $4/$20 since 15
  October, and applied blindly the list made this tool state, on 2026-11-11,
  that OpenAI's row "is not its standard rate" on a day when it was.

Until 0.8.0 this tool could not name the hosts between the cheapest and the
dearest, because the rows do not carry them. It now reads them from a second
endpoint: see the next section.

### Every host: `/api/model-hosts` (0.8.0)

The site published `GET /api/model-hosts?id=` on 2026-11-11 (its own schema,
1.0): for 1 to 4 upstream ids, every host with its rate, the platforms the
model is listed on and the AWS regions where Amazon Bedrock lists it.
`compare-model-hosts` asks it for the models it resolved
(`lib/model-hosts.ts`) and adds to each: `offers`, `platforms`,
`bedrockRegions`, and `quoted.matchingHosts`. `hostList` at the top level says
whether the list was read and carries its three dates.

- **A second request, never worth failing the answer for.** It is asked after
  the catalogue, with an 8-second budget, on tier 1 only. When it fails, the
  summary on the rows still answers, `hostList.available` is false with the
  reason in a few words, and the text says only the cheapest, the dearest, the
  maker's own and promotional listings are shown. The footnote keeps its
  cautious wording unless every model with host data got its full list
  (`hostFootnote(asOf, everyHost)`).
- **Absent is not known, never "no".** The site leaves a key out when nothing
  is on record. `coerceModelHosts` keeps that: an empty or malformed list
  becomes an absent one, and the three fields are `null` in
  `structuredContent`. No `platforms` is a model outside the site's hand-kept
  list, not one sold nowhere. No `bedrockRegions` is a model whose name matched
  no Bedrock model id, not one absent from Bedrock. The text says so once.
- **The site's order is kept.** Offers arrive cheapest first on the 30/70
  blended price, the maker first among hosts at one price. The workload cost
  printed beside each is not always in that order (a host cheap on input and
  dear on output moves with the token mix), so the heading names the order.
- **Twelve hosts in the text, all of them in `structuredContent`.** One model
  had 34 hosts on 2026-11-11. Beyond `MAX_HOST_LINES` the text prints the
  cheapest and counts the rest; the dearest is already named above the list.
- **"Another host" gets a name.** When the quoted price is not the maker's,
  the hosts in the list publishing that rate are named
  (`quoted.matchingHosts`): Llama 3.3 70B read "CoreWeave, Google".
- **`platforms` is an estimate and is labelled as one.** It is the site's
  curated list for the major models (Direct API, AWS Bedrock, Azure AI Foundry,
  Google Vertex, OpenRouter), reviewed by hand on
  `hostList.availabilityReviewedAt`. Bedrock regions come from AWS's own model
  list, read weekly.
- **Not cached like the catalogue.** A bounded memo keyed by the set of ids,
  15 minutes. A failure is never remembered.

### Retirement notices (0.8.0)

A model maker announces the end of a model's API months ahead. The site keeps
those notices in a table it re-reads by hand against each maker's deprecation
page, and since schema 2.8 publishes them: `deprecation` on a row (`shutdown`,
`replacement`, each only when the maker gives it) and
`meta.deprecationsVerifiedAt`. On 2026-11-11: 35 of 311 models, verified on
2026-10-20.

- **Read, never copied.** `coerceSiteModel` carries the notice
  (`lib/deprecation.ts`). There is no table here, and the snapshot does not
  record the field (a test holds that): a notice kept in two places ages in
  silence, and a stale one is worse than none. Tiers 2 and 3 therefore carry no
  notice, and the warning that leads their answers says that this silence
  proves nothing.
- **What a notice is.** The maker's date for its own API. A cloud platform or
  another host can set a later one, which is why a retired model still has a
  price and hosts. The legend printed under any answer that shows one says so,
  dates the notices, and says that no tag is "none on record", not a guarantee.
- **The tag says whether the date has passed**: "retired by its maker on
  2026-08-10" or "to be retired by its maker on 2026-11-30", with the
  replacement. Compared against today's date in UTC.
- **Labelled everywhere, removed from one place.** Every tool that prints a
  model prints the tag, and `structuredContent` carries `deprecation` beside
  the listing flags. `compare-llm-models` keeps retired models in the table.
  `recommend-llm-model` does not recommend them: a recommendation is a model to
  start on. They are set aside after the scoring (which stays over the whole
  catalogue, as on the site) and before the picks, counted in
  `retiredExcludedCount`, and the ones that met every constraint and outranked
  the last pick are named in `retiredNotRecommended` with their notice. On
  2026-11-11 that removed 21 ranked models; with a $3 budget on support tickets
  it named GPT-5 Nano, which would otherwise have been the first pick.
- **The badge refuses on the notice, not on its date.** As on the site: a
  shutdown a year out is still a model not to start on.
- **Self-hosting.** A notice ends the API side of the break-even, not the fleet
  side: published weights do not expire with the maker's endpoint. The tool
  says so when the model is open.

### API or own capacity: `estimate-self-hosting-breakeven` (0.7.0)

The server already held both halves of the question: what a model's API costs
per request, and what a GPU instance costs per hour. The seventh tool puts them
on one line. An API bill grows with every request and a rented instance costs
the same busy or idle, so there is a monthly volume at which the two are equal:
`fleet monthly cost / API cost per request`. Below it the API is cheaper, above
it the fleet is.

**The fleet** is `instanceCount` instances billed 730 hours a month (the compute
catalogue's own month: its `onDemandMonthly` is the hourly rate times 730), at
every rate the instance lists: on demand, spot, and the 1- and 3-year
commitments, each tagged `static` or `interruptible` where that applies. A
caller with hardware the catalogue does not list (a GPU cloud, a quoted rate,
owned hardware amortised per hour) passes `hourlyRate` instead and gets one
option. Giving both, or neither, is refused.

**The API** is three baselines: the quoted list price, that price with the
caching and batch levers the workload allows (`optimizedUseCaseCost`, so the
conditions of decision 3f apply), and the cheapest host when the per-host data
knows one below the quoted price. Comparing a fleet with the list price alone
flatters the fleet; the cheapest host of an open model is often several times
below the quoted rate, and the break-even moves out by the same factor.

**What it refuses to assume**, and why the answer is shaped the way it is:

- **A throughput.** Tokens per second depend on the model, its quantization, the
  serving stack and the batch size, and this server holds no measurement of any
  of them. A default table would put an invented number at the centre of an
  answer callers are told to quote. Without `outputTokensPerSecond` each
  break-even states the output tokens per second the fleet would have to
  generate around the clock to reach it, which a reader can hold against a
  benchmark; the caller's own volume states the same, and the comparison at
  that volume is worded "if the fleet can serve it". With a measured
  throughput the tool gives the fleet's capacity, each break-even as a share
  of it (`utilizationPct`, `reachable`), the cost of one request flat out, and
  the instances the caller's volume takes. A fleet too small for the volume
  says so and leaves the comparison at that volume out of the text.
- **An operations cost.** Engineer time usually outweighs the hardware rent
  (OptimNow's own reference on self-hosted inference makes this its main
  point). `monthlyOperationsCost` is added once to the fleet's rent when
  given; when it is not, the text says the figures are hardware rent only.
- **That the instance can hold the model.** The catalogue carries no GPU count
  or memory. The text says so on every answer.

It also reports whether the model's weights are published (`selfHostable`, from
`opennessOf`). A proprietary model is still costed, because the question "what
would our Claude bill buy in GPUs" is a real one, but the text says the fleet
figures only apply if the workload can move to an open model.

**Not a port.** The site has no break-even page, so `lib/self-hosting.ts` is the
one calculation `check-parity` does not cover. Its inputs are ported
(`useCaseCost`, `optimizedUseCaseCost`) or read (`hostPricing`, the instance
rates); the arithmetic on top is held by `lib/self-hosting.test.ts`. If the
site gains a break-even calculator, port it here rather than keep two.

**Two provenances.** The answer draws on both catalogues, so `structuredContent`
carries `provenance` (API prices) and `computeProvenance` (instance rates). The
compute notice lists every provider's static columns; it leads the text only on
a fallback tier or when one of them belongs to the instance's own provider.

### Use Case Profiles (for cost estimation)
- supportTicket, knowledgeQA, meetingSummary, marketingContent
- codingTask, invoiceProcessing, callSummary, agentWorkflow

Each profile defines typical input/output token counts per request.

### Volume Presets
- 10k, 100k, 1m requests/month

---

## Constraints

- No API keys required — both optimtoken endpoints are public, unauthenticated and CORS-open
- No database — stateless tool execution
- `/api/pricing` costs ~0.3s on an edge-cache HIT and 6–11s on a MISS (re-measured 2026-08-18; it was ~50s before upstream PR #57), and every distinct query string is its own cache entry. Always request the canonical `?region=` URL and filter locally: narrowing the URL trades a warm hit for a cold rebuild *and* returns less data. Results are memoised per region for 60 minutes, then served stale for up to 12 hours while a refresh runs in the background.
- **The two endpoints need different timeouts, and conflating them is a shipped bug.** Re-measured 2026-08-18 (24 cold samples across all four regions, over three separate runs — the first 8 gave a max of 8.9 s and two later runs both beat it, so the sample had to be widened): `/api/llm-models` is 0.19–0.42 s cold / 31 ms warm; `/api/pricing` is **6.1–10.7 s cold** / 80–350 ms warm, because the site assembles six provider APIs inside a `maxDuration: 60` function. `compare-compute-pricing` shipped with the LLM endpoint's 20 s budget against a cold path that then took 50.5 s — *shorter than the cold path always took* — so a cold edge entry could not reach tier 1 at all and the tool served the static snapshot on every call. `UPSTREAM_TIMEOUT_MS` in `lib/compute-pricing.ts` is **25 s**, guarded by two tests: it must exceed `MEASURED_COLD_REBUILD_MS`, and it must keep `MIN_COLD_PATH_HEADROOM` (2x) over it.
  **This paragraph used to say 55 s and "do not tune it down"; that was correct advice against a 50.5 s cold path, and upstream PR #57 (2026-08-18) cut that path by ~6x.** The rule it was protecting has not changed — never size this budget from the LLM endpoint's profile — but the number that satisfies it has. Re-measure before moving it again, and move all four places together (the two constants, the guard tests, and this bullet). Do not restore 55 s just because this paragraph once said so.
- **A short budget plus a retry does not work here, and this was measured, not assumed.** Aborting at 20 s against a guaranteed-cold cache key and re-probing every 5 s left the key cold at t+236 s (measured 2026-08-17, against the 50.5 s rebuild; not re-run since PR #57, but the mechanism does not depend on the rebuild's duration): an abandoned request leaves no warm entry behind, and each short probe just starts another rebuild it also abandons. One request has to see the rebuild through.
- **The compute catalogue is enriched once, not per request.** `servableCatalogue()`
  in `index.ts` memoises `enrichInstances()` + the Linux filter in a `WeakMap`
  keyed by the catalogue array's identity — the memo in `compute-pricing.ts` hands
  back the same array for the life of an entry and a fresh one after a refresh, so
  identity is exactly the right invalidation key. Enriching per request cost 7 ms
  and ~2.6 MB every call, 41% of it on Windows rows the tool discards immediately.
  `catalogSize` counts servable rows (~3,573), not the raw catalogue (~6,052):
  a denominator that includes rows no query can reach is not a denominator.
- **The caches are warmed at boot, for one region only.** `warmCaches()` at the
  foot of `index.ts` fires `fetchLLMModels()` and `fetchComputeInstances(us-east)`
  once the server is listening, fire-and-forget. Measured against production on
  2026-08-18: a freshly deployed process answered `compare-compute-pricing` in
  **8.4 s** and then in ~250 ms — the first caller was funding the rebuild.
  Locally, first call after boot is **231 ms without the warm-up and 23 ms with
  it** (that gap is small only because the upstream edge cache happened to be
  warm; on the edge MISS that follows a deploy it is the full ~8 s).

  This is only worth doing because **the process outlives a request**. On Alpic
  that was proven by three MCP sessions minutes apart reporting the same
  `provenance.upstreamTimestamp`. On Fly.io it is true **per wake, not per
  deploy**: `fly.toml` sets `auto_stop_machines = "stop"` and
  `min_machines_running = 0`, so the machine stops after a few idle minutes and
  restarts, with empty caches, on the next request. The warm-up then runs on
  every wake, and it still earns its keep for the same reason: the first caller
  of a wake would otherwise fund the fetch. Budget two upstream fetches per
  wake plus two per deploy. That is cheap while the upstream edge cache is warm
  (measured 205-324 ms per fetch on Alpic, 2026-08-18) and 7-11 s per fetch if
  it is cold. Not yet re-measured on Fly: when the wake rate is known, decide
  whether `min_machines_running = 1` (one machine always on, roughly $3 a
  month) buys a memo that is worth more than the stopped machine saves. On a
  per-request runtime the warm-up would be pure waste, so re-check this
  before moving hosts again.

  Three rules it must keep:
  - **Never block start-up.** The upstream can take 11 s; awaiting it turns
    a slow site into a failed boot.
  - **Never cache a failure.** The fetchers do not cache snapshot fallbacks, so a
    failed warm leaves the cache empty and the first real caller pays what it
    would have paid anyway. Keep it that way.
  - **Never reach upstream from a test or a CI build.** Guarded by
    `NODE_ENV === "test"` and `SKIP_CACHE_WARMUP=1`.

- **Platform logs do not measure handler latency.** On Alpic, the `duration`
  field of the first request after each boot read 3.1-3.6 s while 6-7 ms
  elapsed between the handler's own START and END timestamps: it included
  container start-up. Fly has no such field; `fly logs` carries the app's
  stdout plus the proxy's machine start and stop lines, which is where the
  cold-start cost of a wake shows up (the machine boot, then the warm-up).
  Neither is something `warmCaches()` can remove, since it runs after the app
  has booted. Time calls from the client instead, as `check-connector.mjs`
  prints.

- **Warming that was considered and deliberately rejected.** Each of these is a
  plausible next step that costs more than it returns; do not add them without
  new measurements that contradict the ones below.
  - **All four regions at boot.** Four upstream rebuilds per process start — each
    one six provider APIs assembled live — for three regions a given deployment
    may never be asked about. The other three warm on first use for ~7 s once
    (measured: asia-pacific 7.1 s cold, then 447 ms). Paying a known cost against
    the site to avoid a maybe-cost is the wrong trade.
  - **A periodic refresh timer.** The 60-minute TTL is already invisible to
    callers: `fetchComputeInstances` serves the stale entry immediately and
    refreshes behind it for up to 12 hours. A timer would only cover a gap longer
    than 12 hours, at ~26 upstream rebuilds a day per region on an otherwise idle
    server. Wrong ratio.
  - **An external cron pinging the endpoint.** Same effect as the timer, plus
    infrastructure. On Fly it would also keep the machine awake around the
    clock, which is `min_machines_running = 1` with extra steps and none of the
    savings; set that instead if a warm memo is ever worth paying for. (A
    stopped machine runs no timers either, so the timer above cannot run on
    Fly at all.)
  - **Warming from `primeComputePricingCache()`.** That export is a test seam
    that takes an already-built result; it is not a fetch and cannot warm
    anything on its own.

- **Both fetchers dedupe in-flight requests.** Five concurrent cold callers used
  to produce five upstream rebuilds each. The `refreshing` set only ever covered
  the stale-while-revalidate branch; the cold branch — the one callers wait on —
  had none. Keep the `finally` that clears the shared promise, or one failure
  pins every later caller to it.
- **Do not rename or drop `structuredContent` fields.** Each tool publishes an `outputSchema`, and callers that read the fields are bound to the current shape. Add fields; do not reshape. A field a handler returns must also be declared in the schema: Zod emits `additionalProperties: false`, so a strict host rejects a response carrying an undeclared one.
- **No `ui://` resources and no `_meta` on the tools.** The server declares the `tools` capability only. A host that finds a widget template on a tool tries to render it; `check-connector.mjs` fails if one reappears.

---

