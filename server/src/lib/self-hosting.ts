/**
 * Break-even between paying an API per token and renting capacity by the hour.
 *
 * An API bill grows with every request. A rented GPU costs the same whether it
 * serves one request or runs flat out, so there is a monthly volume at which
 * the two cost the same: below it the API is cheaper, above it the fleet is,
 * provided the fleet can physically serve that volume.
 *
 * That last clause is where break-even calculators go wrong, and it decides
 * what this module will and will not do:
 *
 *  - It never assumes a throughput. How many tokens a second a GPU generates
 *    depends on the model, its quantization, the serving stack and the batch
 *    size, and this server holds no measurement of any of them. Given none, it
 *    states the throughput the break-even REQUIRES, which the reader can hold
 *    against a benchmark. Given one, it says what share of the fleet's capacity
 *    the break-even volume is, and that it is out of reach when above 100%.
 *  - It never assumes an operations cost. Engineer time usually outweighs the
 *    hardware rent, and a default would be an invented fact about someone's
 *    payroll. Without one the figures are hardware rent only, and the text
 *    says so.
 *  - It does not check that the instance can hold the model. The compute
 *    catalogue carries no GPU count or memory.
 *
 * The site has no counterpart: this is the one calculation here that is not a
 * port, so `check-parity` does not cover it. Its inputs are: the API cost per
 * request (llm-business-metrics.ts, which is a port) and the hourly rates of
 * the compute catalogue.
 */
import type { PriceTypes, InstanceRates } from "./compute-rates.js";
import { commitmentLabel } from "./compute-rates.js";
import { formatMonthlyBudget, roundCost } from "./llm-business-metrics.js";

/** Hours billed in a month. The compute catalogue's own convention: its
 *  `onDemandMonthly` is `onDemandHourly` x 730. */
export const HOURS_PER_MONTH = 730;
export const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

/** The ways a fleet can be paid for. `callerSupplied` is an hourly rate the
 *  caller gave, for hardware the catalogue does not list. */
export const FLEET_RATES = [
  "onDemand",
  "spot",
  "savingsPlan1yr",
  "savingsPlan3yr",
  "reserved1yr",
  "reserved3yr",
  "callerSupplied",
] as const;
export type FleetRate = (typeof FLEET_RATES)[number];

/** What the fleet is compared with: the quoted list price, that price with the
 *  caching and batch levers the workload allows, and the cheapest host known. */
export const API_BASES = ["list", "optimized", "cheapestHost"] as const;
export type ApiBasis = (typeof API_BASES)[number];

export const API_BASIS_LABELS: Record<ApiBasis, string> = {
  list: "API list price",
  optimized: "API optimized",
  cheapestHost: "the cheapest host",
};

export interface RateOption {
  rate: FleetRate;
  label: string;
  hourlyRate: number;
  /** Upstream marks the column a curated estimate, not a rate read this cycle. */
  static: boolean;
  /** Spot capacity can be reclaimed by the provider at short notice. */
  interruptible: boolean;
}

export interface Workload {
  inputTokens: number;
  outputTokens: number;
}

const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

const isStatic = (priceTypes: PriceTypes, provider: string, column: string): boolean =>
  priceTypes?.[provider]?.[column] === "static";

/** Every rate the catalogue lists for one instance, on-demand first. */
export function rateOptions(inst: InstanceRates, priceTypes?: PriceTypes): RateOption[] {
  const commitment = commitmentLabel(inst.provider);
  const candidates: [FleetRate, string, number | null, string][] = [
    ["onDemand", "On-demand", inst.onDemandHourly, "onDemand"],
    ["spot", "Spot", inst.spot, "spot"],
    ["savingsPlan1yr", `${commitment} 1-yr`, inst.savingsPlan1yr, "savingsPlan1yr"],
    ["savingsPlan3yr", `${commitment} 3-yr`, inst.savingsPlan3yr, "savingsPlan3yr"],
    ["reserved1yr", "Reserved 1-yr", inst.reserved1yr, "reserved1yr"],
    ["reserved3yr", "Reserved 3-yr", inst.reserved3yr, "reserved3yr"],
  ];
  return candidates
    .filter((c): c is [FleetRate, string, number, string] => usable(c[2]))
    .map(([rate, label, hourlyRate, column]) => ({
      rate,
      label,
      hourlyRate,
      static: isStatic(priceTypes, inst.provider, column),
      interruptible: rate === "spot",
    }));
}

/** The single option of a fleet priced by the caller. */
export function callerRateOption(hourlyRate: number): RateOption {
  return { rate: "callerSupplied", label: "Your rate", hourlyRate, static: false, interruptible: false };
}

/** What the fleet costs a month: every instance billed every hour, plus
 *  whatever the caller says it costs to run. */
export function fleetMonthlyCost(hourlyRate: number, instanceCount: number, monthlyOperationsCost = 0): number {
  return hourlyRate * HOURS_PER_MONTH * instanceCount + monthlyOperationsCost;
}

export interface BreakEvenPoint {
  /** Monthly requests at which the fleet and the API cost the same. */
  requestsPerMonth: number;
  /** The same volume as input + output tokens a day. */
  tokensPerDay: number;
  /** Output tokens the fleet must generate each second, averaged over every
   *  hour of the month, to serve that volume. */
  outputTokensPerSecond: number;
}

/**
 * The volume at which a fixed monthly cost equals a per-request one.
 *
 * Null when the API costs nothing per request: no volume then makes a paid
 * fleet the cheaper of the two.
 */
export function breakEvenPoint(fleetMonthly: number, apiCostPerRequest: number, workload: Workload): BreakEvenPoint | null {
  if (!usable(apiCostPerRequest) || !Number.isFinite(fleetMonthly) || fleetMonthly < 0) return null;
  const requestsPerMonth = fleetMonthly / apiCostPerRequest;
  return {
    requestsPerMonth,
    tokensPerDay: (requestsPerMonth * (workload.inputTokens + workload.outputTokens)) / DAYS_PER_MONTH,
    outputTokensPerSecond: (requestsPerMonth * workload.outputTokens) / SECONDS_PER_MONTH,
  };
}

/** Requests a month the fleet serves running flat out around the clock, at the
 *  output throughput the caller measured for ONE instance. */
export function fleetCapacity(outputTokensPerSecond: number, instanceCount: number, workload: Workload): number {
  return (outputTokensPerSecond * instanceCount * SECONDS_PER_MONTH) / workload.outputTokens;
}

/** Output tokens a second the whole fleet must generate, averaged over every
 *  hour of the month, to serve `volume` requests. What a comparison "at your
 *  volume" silently assumes the fleet can do when no throughput was measured. */
export function throughputForVolume(volume: number, workload: Workload): number {
  return (volume * workload.outputTokens) / SECONDS_PER_MONTH;
}

/** `293` or `7.6`: a throughput as it is printed. */
export const formatThroughput = (tokensPerSecond: number): string =>
  tokensPerSecond < 100 ? tokensPerSecond.toFixed(1) : Math.round(tokensPerSecond).toLocaleString("en-US");

/** Instances it takes to serve `volume` at that throughput. */
export function instancesNeeded(volume: number, outputTokensPerSecond: number, workload: Workload): number {
  return Math.max(1, Math.ceil(volume / fleetCapacity(outputTokensPerSecond, 1, workload)));
}

export interface ApiBaseline {
  basis: ApiBasis;
  costPerRequest: number;
}

export interface OptionPoint {
  basis: ApiBasis;
  /** Null when the API costs nothing per request on this basis. */
  point: BreakEvenPoint | null;
  /** Break-even volume as a share of the fleet's capacity (1 = flat out).
   *  Null when no throughput was supplied, or there is no break-even. */
  utilization: number | null;
  /** Whether the fleet can serve the break-even volume. Null as above. */
  reachable: boolean | null;
  /** At the caller's volume: fleet cost minus API cost. Positive means the
   *  fleet is the dearer of the two. */
  fleetMinusApiMonthly: number;
}

export interface OptionResult {
  option: RateOption;
  /** Hardware rent plus the operations cost supplied, per month. */
  monthlyCost: number;
  /** What one request costs with the fleet flat out around the clock: the
   *  lowest the fleet can go. Null when no throughput was supplied. */
  fullLoadCostPerRequest: number | null;
  points: OptionPoint[];
}

export interface FleetInputs {
  instanceCount: number;
  monthlyOperationsCost: number;
  workload: Workload;
  /** The caller's monthly requests. */
  volume: number;
  /** Requests a month the fleet can serve; null when no throughput was given. */
  capacity: number | null;
  baselines: readonly ApiBaseline[];
}

/** One way of paying for the fleet, against every API baseline. */
export function evaluateOption(option: RateOption, inputs: FleetInputs): OptionResult {
  const monthlyCost = fleetMonthlyCost(option.hourlyRate, inputs.instanceCount, inputs.monthlyOperationsCost);
  const capacity = usable(inputs.capacity) ? inputs.capacity : null;
  return {
    option,
    monthlyCost,
    fullLoadCostPerRequest: capacity === null ? null : monthlyCost / capacity,
    points: inputs.baselines.map(baseline => {
      const point = breakEvenPoint(monthlyCost, baseline.costPerRequest, inputs.workload);
      const utilization = point && capacity !== null ? point.requestsPerMonth / capacity : null;
      return {
        basis: baseline.basis,
        point,
        utilization,
        reachable: utilization === null ? null : utilization <= 1,
        fleetMinusApiMonthly: monthlyCost - baseline.costPerRequest * inputs.volume,
      };
    }),
  };
}

// ── Rounding, at the serialisation boundary only ─────────────────────

/** Catalogue rates carry four decimals; a caller's rate is held to the same. */
export const roundHourlyRate = (rate: number): number => roundCost(rate, 4);

/** A share as a percentage with one decimal: 0.1934 -> 19.3. */
export const toPct = (share: number): number => Math.round(share * 1000) / 10;

/** Throughput with one decimal. */
export const roundThroughput = (tokensPerSecond: number): number => Math.round(tokensPerSecond * 10) / 10;

// ── Text ─────────────────────────────────────────────────────────────

/** A count a reader can hold: 1,540,000 -> "1.54M", 82,300 -> "82.3K". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 999_500_000) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 999_500) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** `Spot (interruptible, static)`: the option's name with what qualifies it. */
export function describeOptionName(option: RateOption): string {
  const notes = [option.interruptible ? "interruptible" : "", option.static ? "static" : ""].filter(Boolean);
  return option.label + (notes.length ? ` (${notes.join(", ")})` : "");
}

/**
 * One break-even, as a sentence fragment after "Costs the same as ":
 *
 *   API list price at 1.54M req/mo (101.27M tokens/day; 293 output tok/s around the clock)
 *   API list price at 1.54M req/mo (101.27M tokens/day; 19.5% of what the fleet can serve)
 *   API list price at 9.80M req/mo (...; out of reach: 124.1% of what the fleet can serve)
 */
export function describePoint(p: OptionPoint): string {
  const label = API_BASIS_LABELS[p.basis];
  if (!p.point) return `${label}: never, the API costs nothing per request at this price`;
  const reach =
    p.utilization === null
      ? `${formatThroughput(p.point.outputTokensPerSecond)} output tok/s around the clock`
      : p.reachable
        ? `${toPct(p.utilization)}% of what the fleet can serve`
        : `out of reach: ${toPct(p.utilization)}% of what the fleet can serve`;
  return `${label} at ${formatCount(p.point.requestsPerMonth)} req/mo (${formatCount(p.point.tokensPerDay)} tokens/day; ${reach})`;
}

/** `$793/mo more than API list price`, `$283/mo less than ...`, or the same. */
export function describeDelta(p: OptionPoint): string {
  const label = API_BASIS_LABELS[p.basis];
  const delta = p.fleetMinusApiMonthly;
  if (Math.abs(delta) < 0.005) return `the same as ${label}`;
  return `${formatMonthlyBudget(Math.abs(delta))}/mo ${delta > 0 ? "more" : "less"} than ${label}`;
}

/** What the hourly rate leaves out, said once under the figures. */
export function selfHostingFootnote(operationsCostSupplied: boolean, throughputSupplied: boolean): string {
  return [
    "A break-even is the monthly volume at which the fleet and the API cost the same: below it the API is " +
      "cheaper, above it the fleet is. The fleet is billed every hour of the month whatever it serves.",
    operationsCostSupplied
      ? "The fleet figures include the operations cost supplied."
      : "Not in the fleet figures: the engineers who run the stack, storage for the weights, egress, and a " +
        "second instance for failover. Pass monthlyOperationsCost to include them; they often decide the answer.",
    throughputSupplied
      ? "Capacity is the supplied throughput held flat out for every hour of the month, which no real fleet " +
        "does: traffic has peaks and nights, so plan on a share of it."
      : "No throughput was assumed. Each break-even states the output tokens per second the fleet must " +
        "generate on average, day and night, to get there; if the hardware cannot sustain it, self-hosting " +
        "does not break even on this fleet, and the comparison at your volume does not hold either. Pass " +
        "outputTokensPerSecond once it is measured.",
    "This tool does not check that the instance can hold the model: the catalogue carries no GPU count or " +
      "memory. API prices are list prices and move; test the break-even again when they do.",
  ].join("\n");
}
