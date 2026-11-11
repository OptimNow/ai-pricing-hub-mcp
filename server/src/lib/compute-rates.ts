/**
 * How a compute row's prices read in the text block, and what each one saves.
 *
 * Until 0.6.0 the text of compare-compute-pricing printed the on-demand rate
 * and the spot rate. The savings-plan, CUD and reserved rates were returned in
 * `structuredContent` only, and with no widget the text is what the model
 * reads: the commitment discount, which is the first thing a FinOps answer
 * about compute is asked for, usually never reached the reader.
 *
 * Three rules, all applied here:
 *
 *  - Every rate that is not on-demand states its saving against the same row's
 *    on-demand rate. A rate that is not below on-demand says so in words
 *    rather than showing a negative or a zero discount.
 *  - A row with no commitment rate says so. An absent figure is "not listed",
 *    never "no discount exists".
 *  - A figure upstream marks `static` (a curated estimate, not fetched from
 *    the provider this cycle) is tagged where it is printed, not only in the
 *    notice at the top: a reader quoting one row must not need the header.
 */
import type { ComputeInstance } from "../data/pricing-data.js";

/** `provenance.priceTypes`: per provider, per column, "live" | "static" | "unavailable". */
export type PriceTypes = Record<string, Record<string, string>> | undefined;

/** The fields this module reads, so tests need not build a whole instance. */
export type InstanceRates = Pick<
  ComputeInstance,
  "onDemandHourly" | "onDemandMonthly" | "spot" | "savingsPlan1yr" | "savingsPlan3yr" | "reserved1yr" | "reserved3yr"
> & { provider: string };

/** The rates that are a discount on on-demand, in the order they are printed. */
export const DISCOUNTED_COLUMNS = ["spot", "savingsPlan1yr", "savingsPlan3yr", "reserved1yr", "reserved3yr"] as const;
export type DiscountedColumn = (typeof DISCOUNTED_COLUMNS)[number];

/** Whole-percent saving of each discounted rate against on-demand. */
export interface RateSavings {
  spotSavingsPct: number | null;
  savingsPlan1yrSavingsPct: number | null;
  savingsPlan3yrSavingsPct: number | null;
  reserved1yrSavingsPct: number | null;
  reserved3yrSavingsPct: number | null;
}

const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Saving of `rate` against `onDemand`, as a whole percentage.
 *
 * Null when either figure is missing, and when the rate is not below
 * on-demand: there is then no saving to state, and a negative number in a
 * field called "savings" is one a reader gets backwards.
 */
export function savingVsOnDemand(rate: number | null | undefined, onDemand: number | null | undefined): number | null {
  if (!usable(rate) || !usable(onDemand) || rate >= onDemand) return null;
  return Math.round((1 - rate / onDemand) * 100);
}

/** The five savings of one row, for `structuredContent`. */
export function rateSavings(inst: InstanceRates): RateSavings {
  const saving = (column: DiscountedColumn) => savingVsOnDemand(inst[column], inst.onDemandHourly);
  return {
    spotSavingsPct: saving("spot"),
    savingsPlan1yrSavingsPct: saving("savingsPlan1yr"),
    savingsPlan3yrSavingsPct: saving("savingsPlan3yr"),
    reserved1yrSavingsPct: saving("reserved1yr"),
    reserved3yrSavingsPct: saving("reserved3yr"),
  };
}

/** What the `savingsPlan*` columns hold for a provider. Google sells the same
 *  thing as a committed use discount; the others call it a savings plan. */
export function commitmentLabel(provider: string): string {
  return provider === "GCP" ? "CUD" : "Savings plan";
}

const isStatic = (priceTypes: PriceTypes, provider: string, column: string): boolean =>
  priceTypes?.[provider]?.[column] === "static";

const hourly = (rate: number): string => `$${rate.toFixed(4)}/hr`;

/** `$0.0031/hr (-27%)`, with `static` added when upstream marks the column so. */
function discounted(inst: InstanceRates, column: DiscountedColumn, priceTypes: PriceTypes): string | null {
  const rate = inst[column];
  if (!usable(rate)) return null;

  const notes: string[] = [];
  const pct = savingVsOnDemand(rate, inst.onDemandHourly);
  if (pct !== null) notes.push(pct === 0 ? "under 1% below on-demand" : `-${pct}%`);
  else if (usable(inst.onDemandHourly)) notes.push("not below on-demand");
  if (isStatic(priceTypes, inst.provider, column)) notes.push("static");

  return hourly(rate) + (notes.length ? ` (${notes.join(", ")})` : "");
}

/** `Savings plan 1-yr: $… (-27%), 3-yr: $… (-50%)`, or null when neither term is listed. */
function commitment(
  inst: InstanceRates,
  label: string,
  oneYear: DiscountedColumn,
  threeYear: DiscountedColumn,
  priceTypes: PriceTypes,
): string | null {
  const terms = [
    ["1-yr", discounted(inst, oneYear, priceTypes)],
    ["3-yr", discounted(inst, threeYear, priceTypes)],
  ].filter((term): term is [string, string] => term[1] !== null);
  if (terms.length === 0) return null;
  return `${label} ${terms.map(([term, text]) => `${term}: ${text}`).join(", ")}`;
}

/**
 * Every price of one row, as it is printed in the text block:
 *
 *   On-demand: $0.0832/hr ($60.74/mo), Spot: $0.0250/hr (-70%),
 *   Savings plan 1-yr: $0.0607/hr (-27%), 3-yr: $0.0416/hr (-50%),
 *   Reserved 1-yr: $0.0524/hr (-37%), 3-yr: $0.0358/hr (-57%)
 */
export function describeRates(inst: InstanceRates, priceTypes?: PriceTypes): string {
  const parts: string[] = [];

  if (usable(inst.onDemandHourly)) {
    const inBrackets = [
      usable(inst.onDemandMonthly) ? `$${inst.onDemandMonthly.toFixed(2)}/mo` : null,
      isStatic(priceTypes, inst.provider, "onDemand") ? "static" : null,
    ].filter(Boolean);
    parts.push(`On-demand: ${hourly(inst.onDemandHourly)}` + (inBrackets.length ? ` (${inBrackets.join(", ")})` : ""));
  } else {
    parts.push("On-demand: not listed");
  }

  const spot = discounted(inst, "spot", priceTypes);
  if (spot) parts.push(`Spot: ${spot}`);

  const commitments = [
    commitment(inst, commitmentLabel(inst.provider), "savingsPlan1yr", "savingsPlan3yr", priceTypes),
    commitment(inst, "Reserved", "reserved1yr", "reserved3yr", priceTypes),
  ].filter((text): text is string => text !== null);
  parts.push(...(commitments.length ? commitments : ["no commitment rate listed"]));

  return parts.join(", ");
}

/** Whether any figure printed for these rows carries the `static` tag. */
function printsStatic(instances: readonly InstanceRates[], priceTypes: PriceTypes): boolean {
  return instances.some(inst =>
    (usable(inst.onDemandHourly) && isStatic(priceTypes, inst.provider, "onDemand")) ||
    DISCOUNTED_COLUMNS.some(column => usable(inst[column]) && isStatic(priceTypes, inst.provider, column)),
  );
}

/**
 * The lines under the table that say what the tags and the AWS rates mean.
 * Each appears only when the rows shown need it, so an ordinary answer carries
 * no boilerplate. Starts with a blank line when there is anything to say.
 *
 * `awsSavingsPlansAsOf` is AWS's own publication date of the Savings Plan
 * price files, which the site reads weekly: those two columns are as fresh as
 * that date and no fresher, whatever the response's own timestamp says.
 */
export function ratesLegend(
  instances: readonly InstanceRates[],
  priceTypes: PriceTypes,
  awsSavingsPlansAsOf?: string,
): string {
  const lines: string[] = [];

  if (printsStatic(instances, priceTypes)) {
    lines.push(
      "static: a curated estimate carried from the site's built-in catalogue, not fetched from the provider " +
      "this cycle. Do not quote it as a live rate.",
    );
  }

  const awsPlanShown = instances.some(inst =>
    inst.provider === "AWS" &&
    ((usable(inst.savingsPlan1yr) && !isStatic(priceTypes, "AWS", "savingsPlan1yr")) ||
      (usable(inst.savingsPlan3yr) && !isStatic(priceTypes, "AWS", "savingsPlan3yr"))),
  );
  if (awsPlanShown && awsSavingsPlansAsOf) {
    lines.push(
      `AWS Savings plan rates are Compute Savings Plans, No Upfront, shared tenancy, from the price files AWS ` +
      `published on ${awsSavingsPlansAsOf.slice(0, 10)}.`,
    );
  }

  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}
