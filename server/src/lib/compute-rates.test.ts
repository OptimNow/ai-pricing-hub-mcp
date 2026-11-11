import test from "node:test";
import assert from "node:assert/strict";

import {
  commitmentLabel,
  describeRates,
  rateSavings,
  ratesLegend,
  savingVsOnDemand,
} from "./compute-rates.js";
import type { InstanceRates, PriceTypes } from "./compute-rates.js";

/**
 * The commitment rates were in `structuredContent` and nowhere in the text
 * until 0.6.0, so an assistant asked "what does a 3-year commitment save on
 * this instance" answered from the on-demand and spot figures alone.
 */

const row = (over: Partial<InstanceRates> = {}): InstanceRates => ({
  provider: "AWS",
  onDemandHourly: 0.1,
  onDemandMonthly: 73,
  spot: 0.03,
  savingsPlan1yr: 0.073,
  savingsPlan3yr: 0.05,
  reserved1yr: 0.063,
  reserved3yr: 0.043,
  ...over,
});

const NO_COMMITMENT = { savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null };

const allLive = (provider: string): PriceTypes => ({
  [provider]: {
    onDemand: "live", spot: "live", savingsPlan1yr: "live", savingsPlan3yr: "live", reserved1yr: "live", reserved3yr: "live",
  },
});

// ── The saving ───────────────────────────────────────────────────────

test("a saving is a whole percentage of the on-demand rate", () => {
  assert.equal(savingVsOnDemand(0.073, 0.1), 27);
  assert.equal(savingVsOnDemand(0.05, 0.1), 50);
  assert.equal(savingVsOnDemand(0.0999, 0.1), 0, "a saving under half a percent is 0, not missing");
});

test("no saving is stated when there is none to state", () => {
  assert.equal(savingVsOnDemand(null, 0.1), null, "no rate");
  assert.equal(savingVsOnDemand(0.05, null), null, "no on-demand rate to compare with");
  assert.equal(savingVsOnDemand(0, 0.1), null, "a zero rate is a missing rate, not a 100% saving");
  assert.equal(savingVsOnDemand(0.1, 0.1), null, "equal to on-demand");
  assert.equal(savingVsOnDemand(0.12, 0.1), null, "dearer than on-demand is never a negative saving");
  assert.equal(savingVsOnDemand(Number.NaN, 0.1), null);
});

test("structuredContent gets the same five savings the text prints", () => {
  assert.deepEqual(rateSavings(row()), {
    spotSavingsPct: 70,
    savingsPlan1yrSavingsPct: 27,
    savingsPlan3yrSavingsPct: 50,
    reserved1yrSavingsPct: 37,
    reserved3yrSavingsPct: 57,
  });
  assert.deepEqual(rateSavings(row({ spot: null, ...NO_COMMITMENT })), {
    spotSavingsPct: null,
    savingsPlan1yrSavingsPct: null,
    savingsPlan3yrSavingsPct: null,
    reserved1yrSavingsPct: null,
    reserved3yrSavingsPct: null,
  });
});

// ── The text of one row ──────────────────────────────────────────────

test("a row prints every rate it carries, each with its saving", () => {
  assert.equal(
    describeRates(row(), allLive("AWS")),
    "On-demand: $0.1000/hr ($73.00/mo), Spot: $0.0300/hr (-70%), " +
      "Savings plan 1-yr: $0.0730/hr (-27%), 3-yr: $0.0500/hr (-50%), " +
      "Reserved 1-yr: $0.0630/hr (-37%), 3-yr: $0.0430/hr (-57%)",
  );
});

test("a row with no commitment rate says so instead of going quiet", () => {
  // DigitalOcean and OVH sell neither; without the words, the row looked like
  // every other and the absence read as "nothing to add".
  assert.equal(
    describeRates(row({ provider: "DigitalOcean", spot: null, ...NO_COMMITMENT })),
    "On-demand: $0.1000/hr ($73.00/mo), no commitment rate listed",
  );
  // Spot alone is not a commitment.
  assert.match(describeRates(row({ provider: "OCI", ...NO_COMMITMENT })), /Spot: \$0\.0300\/hr \(-70%\), no commitment rate listed$/);
});

test("one term alone is still named with its term", () => {
  const text = describeRates(row({ savingsPlan1yr: null, reserved3yr: null }));
  assert.match(text, /Savings plan 3-yr: \$0\.0500\/hr \(-50%\)/);
  assert.match(text, /Reserved 1-yr: \$0\.0630\/hr \(-37%\)/);
  assert.doesNotMatch(text, /Savings plan 1-yr|Reserved .*3-yr/);
});

test("Google's commitment is called a CUD", () => {
  assert.equal(commitmentLabel("GCP"), "CUD");
  assert.equal(commitmentLabel("AWS"), "Savings plan");
  assert.equal(commitmentLabel("Azure"), "Savings plan");
  assert.match(describeRates(row({ provider: "GCP", reserved1yr: null, reserved3yr: null })), /CUD 1-yr: .*, 3-yr: /);
});

test("a rate that is not below on-demand says so in words", () => {
  const text = describeRates(row({ savingsPlan1yr: 0.1, savingsPlan3yr: 0.0999 }));
  assert.match(text, /Savings plan 1-yr: \$0\.1000\/hr \(not below on-demand\)/);
  assert.match(text, /3-yr: \$0\.0999\/hr \(under 1% below on-demand\)/);
  assert.doesNotMatch(text, /-0%/, "never a zero discount");
});

test("a static figure is tagged where it is printed", () => {
  // What the site reports for GCP: live on-demand and spot, static CUDs.
  const gcp: PriceTypes = {
    GCP: {
      onDemand: "live", spot: "live", savingsPlan1yr: "static", savingsPlan3yr: "static",
      reserved1yr: "unavailable", reserved3yr: "unavailable",
    },
  };
  assert.equal(
    describeRates(row({ provider: "GCP", reserved1yr: null, reserved3yr: null }), gcp),
    "On-demand: $0.1000/hr ($73.00/mo), Spot: $0.0300/hr (-70%), " +
      "CUD 1-yr: $0.0730/hr (-27%, static), 3-yr: $0.0500/hr (-50%, static)",
  );

  // A provider served wholly from constants is tagged on every figure.
  const azure: PriceTypes = {
    Azure: {
      onDemand: "static", spot: "static", savingsPlan1yr: "static", savingsPlan3yr: "static",
      reserved1yr: "static", reserved3yr: "static",
    },
  };
  const text = describeRates(row({ provider: "Azure" }), azure);
  assert.match(text, /^On-demand: \$0\.1000\/hr \(\$73\.00\/mo, static\)/);
  assert.equal(text.match(/static/g)?.length, 6, "on-demand, spot and the four commitment rates");

  // Another provider's types do not leak onto this row.
  assert.doesNotMatch(describeRates(row(), gcp), /static/);
});

test("without price types nothing is tagged and nothing breaks", () => {
  // Tier 2, the snapshot: no per-column provenance exists.
  assert.doesNotMatch(describeRates(row()), /static/);
  assert.equal(ratesLegend([row()], undefined, undefined), "");
});

test("a row with no on-demand rate prints its other rates without a saving", () => {
  const text = describeRates(row({ onDemandHourly: null, onDemandMonthly: null }));
  assert.match(text, /^On-demand: not listed, Spot: \$0\.0300\/hr, Savings plan 1-yr: \$0\.0730\/hr, 3-yr/);
  assert.doesNotMatch(text, /%|not below/);
});

// ── The lines under the table ────────────────────────────────────────

test("the legend explains static only when a static figure was printed", () => {
  const types: PriceTypes = {
    ...allLive("AWS"),
    GCP: { onDemand: "live", spot: "live", savingsPlan1yr: "static", savingsPlan3yr: "static" },
  };
  assert.doesNotMatch(ratesLegend([row()], types), /static/, "AWS rows alone: nothing static shown");
  assert.match(ratesLegend([row(), row({ provider: "GCP" })], types), /^\n\nstatic: a curated estimate/);
  // The column is static, but this GCP row has no CUD rate to print.
  assert.equal(ratesLegend([row({ provider: "GCP", ...NO_COMMITMENT })], types), "");
});

test("AWS savings plan rates carry AWS's own publication date", () => {
  const legend = ratesLegend([row()], allLive("AWS"), "2026-11-10T21:57:13Z");
  assert.match(legend, /Compute Savings Plans, No Upfront, shared tenancy, from the price files AWS published on 2026-11-10\./);

  // No AWS row shown, no AWS sentence.
  assert.equal(ratesLegend([row({ provider: "GCP" })], allLive("GCP"), "2026-11-10T21:57:13Z"), "");
  // An AWS row with no savings plan rate: the date describes nothing printed.
  assert.equal(ratesLegend([row({ savingsPlan1yr: null, savingsPlan3yr: null })], allLive("AWS"), "2026-11-10T21:57:13Z"), "");
  // No date from upstream: nothing is claimed.
  assert.equal(ratesLegend([row()], allLive("AWS"), undefined), "");
});

test("a static AWS savings plan rate is not given a publication date", () => {
  // Upstream fell back to the scaled US East estimate: the figure is tagged
  // static, and dating it by the price files would contradict the tag.
  const types: PriceTypes = { AWS: { ...allLive("AWS")!.AWS, savingsPlan1yr: "static", savingsPlan3yr: "static" } };
  const legend = ratesLegend([row()], types, "2026-11-10T21:57:13Z");
  assert.match(legend, /static: a curated estimate/);
  assert.doesNotMatch(legend, /published on/);
});
