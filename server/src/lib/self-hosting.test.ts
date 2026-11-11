import test from "node:test";
import assert from "node:assert/strict";

import {
  API_BASES,
  DAYS_PER_MONTH,
  FLEET_RATES,
  HOURS_PER_MONTH,
  breakEvenPoint,
  callerRateOption,
  describeDelta,
  describeOptionName,
  describePoint,
  evaluateOption,
  fleetCapacity,
  fleetMonthlyCost,
  formatCount,
  formatThroughput,
  instancesNeeded,
  rateOptions,
  roundHourlyRate,
  roundThroughput,
  selfHostingFootnote,
  throughputForVolume,
  toPct,
} from "./self-hosting.js";
import type { FleetInputs, OptionPoint } from "./self-hosting.js";

/**
 * An API bill grows with volume; a rented GPU does not. These tests hold the
 * arithmetic of where the two meet, and the two things the module refuses to
 * invent: a throughput and an operations cost.
 */

/** As the site served AWS g6e.4xlarge in us-east on 2026-11-11. */
const g6e = {
  provider: "AWS",
  onDemandHourly: 3.0042,
  onDemandMonthly: 2193.1,
  spot: 1.6625,
  savingsPlan1yr: 2.2712,
  savingsPlan3yr: 1.5574,
  reserved1yr: 1.8927,
  reserved3yr: 1.2978,
};

/** Customer support ticket: 1,500 tokens in, 500 out. */
const workload = { inputTokens: 1500, outputTokens: 500 };

const inputs = (over: Partial<FleetInputs> = {}): FleetInputs => ({
  instanceCount: 1,
  monthlyOperationsCost: 0,
  workload,
  volume: 1_000_000,
  capacity: null,
  baselines: [{ basis: "list", costPerRequest: 0.00146 }],
  ...over,
});

// ── The rates a fleet can be paid at ─────────────────────────────────

test("every rate the catalogue lists is an option, on-demand first", () => {
  const options = rateOptions(g6e);
  assert.deepEqual(
    options.map(o => [o.rate, o.label, o.hourlyRate]),
    [
      ["onDemand", "On-demand", 3.0042],
      ["spot", "Spot", 1.6625],
      ["savingsPlan1yr", "Savings plan 1-yr", 2.2712],
      ["savingsPlan3yr", "Savings plan 3-yr", 1.5574],
      ["reserved1yr", "Reserved 1-yr", 1.8927],
      ["reserved3yr", "Reserved 3-yr", 1.2978],
    ],
  );
  assert.deepEqual(options.filter(o => o.interruptible).map(o => o.rate), ["spot"], "only spot can be reclaimed");
  assert.ok(options.every(o => !o.static), "no priceTypes: nothing is known to be static");
  for (const option of options) assert.ok((FLEET_RATES as readonly string[]).includes(option.rate));
});

test("a rate the catalogue does not list is not an option", () => {
  const options = rateOptions({ ...g6e, spot: null, savingsPlan1yr: 0, reserved1yr: null, reserved3yr: Number.NaN });
  assert.deepEqual(options.map(o => o.rate), ["onDemand", "savingsPlan3yr"]);
  assert.deepEqual(rateOptions({ ...g6e, onDemandHourly: null, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null }), []);
});

test("Google's commitment is a CUD, and a static column is tagged", () => {
  const gcp = { ...g6e, provider: "GCP", reserved1yr: null, reserved3yr: null };
  const options = rateOptions(gcp, { GCP: { onDemand: "live", savingsPlan1yr: "static", savingsPlan3yr: "static" } });
  assert.deepEqual(options.map(o => o.label), ["On-demand", "Spot", "CUD 1-yr", "CUD 3-yr"]);
  assert.deepEqual(options.map(o => o.static), [false, false, true, true]);
  assert.equal(describeOptionName(options[2]), "CUD 1-yr (static)");
  assert.equal(describeOptionName(options[1]), "Spot (interruptible)");
  assert.equal(describeOptionName(options[0]), "On-demand");
});

test("a rate the caller gives is one option, and nothing is said about it", () => {
  assert.deepEqual(callerRateOption(2.5), {
    rate: "callerSupplied",
    label: "Your rate",
    hourlyRate: 2.5,
    static: false,
    interruptible: false,
  });
});

// ── What the fleet costs ─────────────────────────────────────────────

test("a fleet is billed every hour of the month, whatever it serves", () => {
  assert.equal(HOURS_PER_MONTH, 730, "the compute catalogue's own month");
  assert.equal(fleetMonthlyCost(3, 1), 2190);
  assert.equal(fleetMonthlyCost(3, 4), 8760);
  assert.equal(fleetMonthlyCost(3, 2, 5000), 9380, "operations cost is added once, not per instance");
  // The catalogue's own monthly figure is the same sum.
  assert.ok(Math.abs(fleetMonthlyCost(g6e.onDemandHourly, 1) - g6e.onDemandMonthly) < 0.05);
});

// ── Where the two meet ───────────────────────────────────────────────

test("the break-even is the fleet's monthly cost over the API's cost per request", () => {
  const point = breakEvenPoint(2190, 0.00146, workload)!;
  assert.ok(Math.abs(point.requestsPerMonth - 1_500_000) < 1e-6);
  // 1.5M requests x 2,000 tokens over a 730-hour month.
  assert.ok(Math.abs(point.tokensPerDay - (1_500_000 * 2000) / DAYS_PER_MONTH) < 1e-6);
  assert.ok(Math.abs(point.tokensPerDay - 98_630_136.99) < 1);
  // 1.5M requests x 500 output tokens over 2,628,000 seconds.
  assert.ok(Math.abs(point.outputTokensPerSecond - 285.388) < 0.001);
});

test("at the break-even volume the two bills are the same", () => {
  const point = breakEvenPoint(fleetMonthlyCost(g6e.onDemandHourly, 1), 0.00146, workload)!;
  const result = evaluateOption(rateOptions(g6e)[0], inputs({ volume: point.requestsPerMonth }));
  assert.ok(Math.abs(result.points[0].fleetMinusApiMonthly) < 1e-6);
});

test("a free API has no break-even, and neither has a nonsense input", () => {
  assert.equal(breakEvenPoint(2190, 0, workload), null, "no volume makes a paid fleet cheaper than free");
  assert.equal(breakEvenPoint(2190, -1, workload), null);
  assert.equal(breakEvenPoint(2190, Number.NaN, workload), null);
  assert.equal(breakEvenPoint(Number.NaN, 0.001, workload), null);
});

test("below the break-even the fleet is dearer, above it cheaper", () => {
  const onDemand = rateOptions(g6e)[0];
  const below = evaluateOption(onDemand, inputs({ volume: 1_000_000 })).points[0];
  const above = evaluateOption(onDemand, inputs({ volume: 3_000_000 })).points[0];
  assert.ok(below.fleetMinusApiMonthly > 0);
  assert.ok(above.fleetMinusApiMonthly < 0);
  assert.equal(describeDelta(below), "$733/mo more than API list price");
  assert.equal(describeDelta(above), "$2.2K/mo less than API list price");
  assert.equal(describeDelta({ ...below, fleetMinusApiMonthly: 0.001 }), "the same as API list price");
});

test("a cheaper API baseline pushes the break-even out", () => {
  const result = evaluateOption(
    rateOptions(g6e)[0],
    inputs({
      baselines: [
        { basis: "list", costPerRequest: 0.00146 },
        { basis: "optimized", costPerRequest: 0.0011 },
        { basis: "cheapestHost", costPerRequest: 0.00031 },
      ],
    }),
  );
  const volumes = result.points.map(p => p.point!.requestsPerMonth);
  assert.deepEqual(result.points.map(p => p.basis), [...API_BASES]);
  assert.ok(volumes[0] < volumes[1] && volumes[1] < volumes[2], "the less the API costs, the more volume the fleet needs");
});

test("an operations cost moves the break-even by exactly its share", () => {
  const bare = evaluateOption(rateOptions(g6e)[0], inputs());
  const run = evaluateOption(rateOptions(g6e)[0], inputs({ monthlyOperationsCost: bare.monthlyCost }));
  assert.ok(Math.abs(run.monthlyCost - 2 * bare.monthlyCost) < 1e-9);
  assert.ok(Math.abs(run.points[0].point!.requestsPerMonth - 2 * bare.points[0].point!.requestsPerMonth) < 1e-6);
});

// ── What the fleet can serve ─────────────────────────────────────────

test("capacity is the measured throughput held for every second of the month", () => {
  // 1,000 output tok/s x 2,628,000 s over 500 output tokens a request.
  assert.equal(fleetCapacity(1000, 1, workload), 5_256_000);
  assert.equal(fleetCapacity(1000, 3, workload), 15_768_000);
  assert.equal(instancesNeeded(5_256_000, 1000, workload), 1);
  assert.equal(instancesNeeded(5_256_001, 1000, workload), 2);
  assert.equal(instancesNeeded(10, 1000, workload), 1, "never fewer than one");
});

test("a volume asks the fleet for a throughput, whether or not one was measured", () => {
  // 5,256,000 requests x 500 output tokens over the month's 2,628,000 seconds.
  assert.equal(throughputForVolume(5_256_000, workload), 1000);
  assert.ok(Math.abs(throughputForVolume(3_000_000, { inputTokens: 4000, outputTokens: 1000 }) - 1141.55) < 0.01);
  // The inverse of capacity: what the fleet serves flat out asks for exactly its throughput.
  assert.ok(Math.abs(throughputForVolume(fleetCapacity(750, 2, workload), workload) - 1500) < 1e-9);
  assert.equal(formatThroughput(1141.55), "1,142");
  assert.equal(formatThroughput(38.64), "38.6");
});

test("with no throughput, nothing is said about what the fleet can serve", () => {
  const result = evaluateOption(rateOptions(g6e)[0], inputs());
  assert.equal(result.fullLoadCostPerRequest, null);
  assert.equal(result.points[0].utilization, null);
  assert.equal(result.points[0].reachable, null);
});

test("a break-even inside the fleet's capacity is a share of it", () => {
  const capacity = fleetCapacity(1000, 1, workload);
  const result = evaluateOption(rateOptions(g6e)[0], inputs({ capacity }));
  const point = result.points[0];
  assert.ok(Math.abs(point.utilization! - point.point!.requestsPerMonth / capacity) < 1e-12);
  assert.equal(point.reachable, true);
  assert.ok(Math.abs(result.fullLoadCostPerRequest! - result.monthlyCost / capacity) < 1e-12);
  assert.ok(result.fullLoadCostPerRequest! < 0.00146, "flat out, the fleet undercuts the API");
});

test("a break-even beyond the fleet's capacity is out of reach, and says so", () => {
  // 100 output tok/s: flat out, a request costs more on the fleet than on the API.
  const capacity = fleetCapacity(100, 1, workload);
  const result = evaluateOption(rateOptions(g6e)[0], inputs({ capacity }));
  const point = result.points[0];
  assert.ok(point.utilization! > 1);
  assert.equal(point.reachable, false);
  assert.ok(result.fullLoadCostPerRequest! > 0.00146);
  assert.match(describePoint(point), /out of reach: \d+(\.\d)?% of what the fleet can serve/);
});

test("more instances scale the break-even and the capacity alike", () => {
  const one = evaluateOption(rateOptions(g6e)[0], inputs({ capacity: fleetCapacity(1000, 1, workload) }));
  const three = evaluateOption(rateOptions(g6e)[0], inputs({ instanceCount: 3, capacity: fleetCapacity(1000, 3, workload) }));
  assert.ok(Math.abs(three.points[0].point!.requestsPerMonth - 3 * one.points[0].point!.requestsPerMonth) < 1e-6);
  assert.ok(Math.abs(three.points[0].utilization! - one.points[0].utilization!) < 1e-12, "the share of capacity does not move");
  assert.ok(Math.abs(three.fullLoadCostPerRequest! - one.fullLoadCostPerRequest!) < 1e-12);
});

// ── The text ─────────────────────────────────────────────────────────

const point = (over: Partial<OptionPoint> = {}): OptionPoint => ({
  basis: "list",
  point: { requestsPerMonth: 1_540_000, tokensPerDay: 101_260_274, outputTokensPerSecond: 292.99 },
  utilization: null,
  reachable: null,
  fleetMinusApiMonthly: 793,
  ...over,
});

test("a break-even with no throughput states the one it requires", () => {
  assert.equal(
    describePoint(point()),
    "API list price at 1.54M req/mo (101.26M tokens/day; 293 output tok/s around the clock)",
  );
  assert.match(
    describePoint(point({ point: { requestsPerMonth: 40_000, tokensPerDay: 2_630_137, outputTokensPerSecond: 7.61 } })),
    /at 40\.0K req\/mo \(2\.63M tokens\/day; 7\.6 output tok\/s around the clock\)/,
  );
});

test("a break-even with a throughput states the share of capacity", () => {
  assert.equal(
    describePoint(point({ basis: "optimized", utilization: 0.2931, reachable: true })),
    "API optimized at 1.54M req/mo (101.26M tokens/day; 29.3% of what the fleet can serve)",
  );
  assert.equal(
    describePoint(point({ basis: "cheapestHost", utilization: 1.241, reachable: false })),
    "the cheapest host at 1.54M req/mo (101.26M tokens/day; out of reach: 124.1% of what the fleet can serve)",
  );
});

test("no break-even reads as a sentence, not as a blank", () => {
  assert.equal(describePoint(point({ point: null })), "API list price: never, the API costs nothing per request at this price");
});

test("counts are written the way a reader says them", () => {
  assert.equal(formatCount(950), "950");
  assert.equal(formatCount(9_999), "9,999");
  assert.equal(formatCount(82_300), "82.3K");
  assert.equal(formatCount(1_540_000), "1.54M");
  assert.equal(formatCount(999_600), "1.00M", "never 999.6K next to 1.00M");
  assert.equal(formatCount(2_400_000_000), "2.40B");
  assert.equal(formatCount(Number.POSITIVE_INFINITY), "n/a");
});

test("figures are rounded once, on the way out", () => {
  assert.equal(roundHourlyRate(3.00419999), 3.0042);
  assert.equal(toPct(0.19345), 19.3);
  assert.equal(toPct(1.241), 124.1);
  assert.equal(roundThroughput(292.987), 293);
  assert.equal(roundThroughput(7.61), 7.6);
});

test("the footnote says what was left out, and stops saying it once supplied", () => {
  const bare = selfHostingFootnote(false, false);
  assert.match(bare, /below it the API is cheaper, above it the fleet is/);
  assert.match(bare, /Not in the fleet figures: the engineers who run the stack/);
  assert.match(bare, /No throughput was assumed/);
  assert.match(bare, /does not check that the instance can hold the model/);

  const full = selfHostingFootnote(true, true);
  assert.match(full, /include the operations cost supplied/);
  assert.match(full, /which no real fleet does/);
  assert.doesNotMatch(full, /Not in the fleet figures/);
  assert.doesNotMatch(full, /No throughput was assumed/);
  assert.match(full, /does not check that the instance can hold the model/, "true whatever was supplied");
});
