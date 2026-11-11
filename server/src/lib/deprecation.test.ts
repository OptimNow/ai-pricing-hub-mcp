import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_DEPRECATION_DATA,
  coerceDeprecation,
  deprecationLegend,
  deprecationTag,
  describeDeprecation,
  isPastShutdown,
  isoDay,
} from "./deprecation.js";

/**
 * A retirement notice is the one fact here that turns "the cheapest model for
 * this workload" into "a model you should not start on". So the properties
 * worth holding are the ones a reader acts on: a notice is never invented, it
 * is never dropped, a past date reads as past, and the absence of a notice is
 * never worded as a guarantee.
 */

const TODAY = "2026-11-11";

test("a notice is read as sent, and only an object is a notice", () => {
  assert.deepEqual(coerceDeprecation({ shutdown: "2026-11-30", replacement: "Claude Sonnet 5.5" }), {
    shutdown: "2026-11-30",
    replacement: "Claude Sonnet 5.5",
  });
  // The site sends each key only when the maker publishes it: an empty object
  // is still a notice, with nothing more known about it.
  assert.deepEqual(coerceDeprecation({}), {});
  assert.deepEqual(coerceDeprecation({ replacement: "  Next  " }), { replacement: "Next" });

  // Absent stays absent. Nothing truthy becomes a notice by accident: this is
  // the field that refuses a badge and removes a model from a recommendation.
  for (const notANotice of [undefined, null, true, false, 1, "2026-11-30", ["2026-11-30"]]) {
    assert.equal(coerceDeprecation(notANotice), undefined, JSON.stringify(notANotice));
  }
});

test("a date in another form is dropped, and the notice stands", () => {
  // A date this server cannot compare is not printed as one: "30/11/2026" would
  // sort as a string and read as past or future at random.
  for (const bad of ["30/11/2026", "2026-11", "soon", "", 20261130, null]) {
    assert.deepEqual(coerceDeprecation({ shutdown: bad, replacement: "Next" }), { replacement: "Next" }, String(bad));
  }
  assert.deepEqual(coerceDeprecation({ shutdown: "2026-11-30", replacement: 42 }), { shutdown: "2026-11-30" });
});

test("a shutdown date is past from the day itself", () => {
  assert.equal(isPastShutdown({ shutdown: "2026-11-10" }, TODAY), true);
  assert.equal(isPastShutdown({ shutdown: TODAY }, TODAY), true, "the day of the shutdown is not a day to start");
  assert.equal(isPastShutdown({ shutdown: "2026-11-12" }, TODAY), false);
  assert.equal(isPastShutdown({}, TODAY), false, "no date is not a past date");
  assert.match(isoDay(new Date("2026-11-11T23:59:59Z")), /^2026-11-11$/);
});

test("the wording says whether the date has passed", () => {
  assert.equal(
    describeDeprecation({ shutdown: "2026-08-10", replacement: "GPT-5.6 Sol" }, TODAY),
    "retired by its maker on 2026-08-10, replacement: GPT-5.6 Sol",
  );
  assert.equal(
    describeDeprecation({ shutdown: "2026-11-30", replacement: "Claude Sonnet 5.5" }, TODAY),
    "to be retired by its maker on 2026-11-30, replacement: Claude Sonnet 5.5",
  );
  assert.equal(describeDeprecation({ shutdown: "2027-01-14" }, TODAY), "to be retired by its maker on 2027-01-14");
  assert.equal(describeDeprecation({}, TODAY), "retirement announced by its maker");
  assert.equal(describeDeprecation({ replacement: "Next" }, TODAY), "retirement announced by its maker, replacement: Next");
});

test("the tag is on a model with a notice and on no other", () => {
  assert.equal(deprecationTag({}, TODAY), "");
  assert.equal(deprecationTag({ deprecation: undefined }, TODAY), "");
  assert.equal(
    deprecationTag({ deprecation: { shutdown: "2026-08-10" } }, TODAY),
    " [retired by its maker on 2026-08-10]",
  );
});

test("the legend appears only with a retired model, and dates the notices", () => {
  assert.deepEqual(deprecationLegend([{}, { deprecation: undefined }], "2026-10-20"), [], "no boilerplate otherwise");

  const legend = deprecationLegend([{}, { deprecation: {} }], "2026-10-20").join("\n");
  // Whose notice it is, and why the model still has a price.
  assert.match(legend, /the maker's shutdown date for its own API/);
  assert.match(legend, /may still serve the model/);
  // What to do about it, and what it costs the model here.
  assert.match(legend, /Not a model to start on/);
  assert.match(legend, /Not eligible for the FinOps Friendly badge/);
  // How old the notices are, and that no tag is not a clean bill of health.
  assert.match(legend, /last on 2026-10-20/);
  assert.match(legend, /no notice on record, which is not a guarantee/);

  assert.doesNotMatch(deprecationLegend([{ deprecation: {} }], undefined).join("\n"), /last on/);
});

test("a tier without notices says that silence is not an all-clear", () => {
  assert.match(NO_DEPRECATION_DATA, /optimtoken\.optimnow\.io only/);
  assert.match(NO_DEPRECATION_DATA, /says nothing about whether its maker has announced its retirement/);
});
