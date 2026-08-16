/**
 * Manual check: walk every number a running server actually returns and report
 * any that carries more precision than intended.
 *
 * The unit tests and the contract guard in server/src/*.test.ts run offline and
 * cover the helpers and the wiring. This covers the third thing neither can:
 * what the live catalogue plus the live handlers actually put on the wire. It
 * needs a running server and the OpenRouter API, so it is deliberately NOT part
 * of `npm test` or CI — run it by hand after touching anything cost-related.
 *
 *   npx skybridge start
 *   node scripts/check-serialisation-precision.mjs http://localhost:3000/mcp
 *
 * Exits non-zero if any field is over-precise.
 */

const URL_ = process.argv[2] || "http://localhost:3000/mcp";

const PER_REQUEST_DECIMALS = 6;

let sessionId;

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(URL_, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  sessionId = res.headers.get("mcp-session-id") || sessionId;

  const text = await res.text();
  // Streamable HTTP may answer as SSE.
  const payload = text.includes("data: ")
    ? text.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("")
    : text;
  return payload ? JSON.parse(payload) : null;
}

async function handshake() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "precision-check", version: "0" },
  });
  await fetch(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}

/** field path -> { count, sample } for anything over the intended precision. */
const noisy = new Map();
let numbersSeen = 0;

function walk(node, path) {
  if (node === null || node === undefined) return;

  if (typeof node === "number") {
    numbersSeen++;
    const serialised = JSON.stringify(node);
    const decimals = (serialised.split(".")[1] ?? "").length;
    if (decimals > PER_REQUEST_DECIMALS || serialised.includes("e")) {
      // Collapse array indices so 50 bad rows report as one field.
      const key = path.replace(/\[\d+\]/g, "[]");
      if (!noisy.has(key)) noisy.set(key, { count: 0, sample: serialised });
      noisy.get(key).count++;
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((value, i) => walk(value, `${path}[${i}]`));
    return;
  }

  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  }
}

const USE_CASES = [
  "supportTicket", "knowledgeQA", "meetingSummary", "marketingContent",
  "codingTask", "invoiceProcessing", "callSummary", "agentWorkflow",
];

const calls = [];
for (const volumePreset of ["10k", "100k", "1m"]) {
  for (const useCasePreset of USE_CASES) {
    calls.push(["compare-llm-models", { volumePreset, useCasePreset, limit: 50 }]);
  }
}
for (const monthlyVolume of [10_000, 100_000, 1_000_000]) {
  calls.push(["estimate-llm-cost", { monthlyVolume }]);
  calls.push(["estimate-llm-cost", {
    customInputTokens: 3000, customOutputTokens: 2000, monthlyVolume,
  }]);
}
calls.push(["compare-compute-pricing", { limit: 50 }]);
for (const provider of ["AWS", "Azure", "GCP", "OCI", "OVH", "DigitalOcean", "Alibaba"]) {
  calls.push(["compare-compute-pricing", { provider, limit: 50 }]);
}

await handshake();

for (const [name, args] of calls) {
  const response = await rpc("tools/call", { name, arguments: args });
  walk(response?.result?.structuredContent, "");
}

console.log(`walked ${numbersSeen} numbers across ${calls.length} tool calls`);

if (noisy.size === 0) {
  console.log(`PASS: no field exceeds ${PER_REQUEST_DECIMALS} decimals`);
  process.exit(0);
}

console.error(`FAIL: ${noisy.size} field(s) over ${PER_REQUEST_DECIMALS} decimals`);
for (const [field, { count, sample }] of [...noisy].sort((a, b) => b[1].count - a[1].count)) {
  console.error(`  ${field}  x${count}  e.g. ${sample}`);
}
process.exit(1);
