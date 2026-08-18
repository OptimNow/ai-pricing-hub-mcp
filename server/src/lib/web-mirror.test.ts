import test from "node:test";
import assert from "node:assert/strict";

import {
  formatMicroCost,
  formatMonthlyBudget,
  savingsPct as savingsPctServer,
  leverSummary as leverSummaryServer,
} from "./llm-business-metrics.js";
import {
  formatCost,
  formatBudget,
  savingsPct as savingsPctWeb,
  leverSummary as leverSummaryWeb,
} from "../../../web/src/format.js";

/**
 * The server and the widgets are separate bundles, so four functions are
 * deliberately duplicated across the boundary rather than shared: importing
 * llm-business-metrics.ts into a widget would drag the whole static catalogue
 * in with it, and a shared/ directory would need its own tsconfig plumbing for
 * ~60 lines of arithmetic.
 *
 * What was enforcing that duplication until now was a comment saying "change
 * one, change the other". This file replaces the comment with a failure. The
 * test runner already crosses the boundary — scale.test.ts imports from
 * web/src — so this costs nothing to run.
 *
 * The contract is exact string equality, not approximate agreement: the whole
 * point is that the number the model reads in the text summary and the number
 * the user sees in the widget are the same number.
 */

/** Values chosen to land on both sides of every branch in both formatters:
 *  zero, sub-micro-cent, the 0.001 / 0.01 / 1 / 1000 / 1e6 boundaries, and a
 *  few values that expose float noise. */
const MONEY = [
  0, 1e-9, 1e-7, 0.0001, 0.0009, 0.000999, 0.001, 0.0015, 0.009, 0.0099, 0.01,
  0.0101, 0.1, 0.4567, 0.999, 1, 1.005, 2, 9.994, 10, 99.999, 100, 450, 999,
  999.99, 1000, 1000.01, 1234.5, 12_345, 999_999, 1_000_000, 1_234_567,
  0.1 + 0.2, 1 / 3, 2 / 3,
];

test("formatCost mirrors formatMicroCost exactly", () => {
  for (const v of MONEY) {
    assert.equal(formatCost(v), formatMicroCost(v), `diverged at ${v}`);
  }
});

test("formatBudget mirrors formatMonthlyBudget exactly", () => {
  for (const v of MONEY) {
    assert.equal(formatBudget(v), formatMonthlyBudget(v), `diverged at ${v}`);
  }
});

test("savingsPct mirrors across the boundary", () => {
  const pairs: [number, number][] = [
    [0, 0], [0, 1], [1, 0], [100, 80], [100, 100], [100, 120],
    [1, 0.5], [0.001, 0.0009], [1e6, 999_999], [-1, 1], [1, -1],
    [Number.NaN, 1], [1, Number.NaN], [Infinity, 1], [1, Infinity],
  ];
  for (const [list, optimized] of pairs) {
    assert.equal(
      savingsPctWeb(list, optimized),
      savingsPctServer(list, optimized),
      `diverged at list=${list} optimized=${optimized}`,
    );
  }
});

test("leverSummary mirrors across the boundary for every lever combination", () => {
  // All 16 combinations, including the impossible ones (applied without
  // eligible) — a mirror has to hold on inputs the callers never produce too,
  // or it is only being tested where the two happen to agree.
  for (const batchEligible of [false, true]) {
    for (const cacheEligible of [false, true]) {
      for (const batchApplied of [false, true]) {
        for (const cacheApplied of [false, true]) {
          const l = { batchEligible, cacheEligible, batchApplied, cacheApplied };
          assert.equal(
            leverSummaryWeb(l),
            leverSummaryServer(l),
            `diverged at ${JSON.stringify(l)}`,
          );
        }
      }
    }
  }
});

test("leverSummary says something usable in every combination", () => {
  for (const batchEligible of [false, true]) {
    for (const cacheEligible of [false, true]) {
      for (const batchApplied of [false, true]) {
        for (const cacheApplied of [false, true]) {
          const out = leverSummaryServer({ batchEligible, cacheEligible, batchApplied, cacheApplied });
          assert.ok(out.length > 0, "never empty");
          // "no ... rate" with nothing named would be a sentence with a hole in it.
          assert.ok(!/publishes no  ?rate/.test(out), `malformed: "${out}"`);
        }
      }
    }
  }
});
