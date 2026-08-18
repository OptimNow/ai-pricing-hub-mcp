import test from "node:test";
import assert from "node:assert/strict";
import {
  linearScale,
  logScale,
  logDomain,
  linearDomain,
  logTicks,
  linearTicks,
} from "../../../web/src/scale.js";

// web/src/scale.ts is deliberately React-free so the axis maths can be checked
// on its own. Model prices span four to five orders of magnitude and a free
// model prices at 0, so the interesting cases here are the degenerate ones: a
// zero-width domain, a non-positive value on a log axis, and a set of values
// too tightly clustered to contain a round number.

test("linearScale maps the domain onto the range", () => {
  const s = linearScale(0, 10, 0, 100);
  assert.equal(s(0), 0);
  assert.equal(s(5), 50);
  assert.equal(s(10), 100);
});

test("a zero-width linear domain returns the range midpoint, not NaN", () => {
  const s = linearScale(5, 5, 0, 100);
  assert.equal(s(5), 50);
  assert.ok(Number.isFinite(s(999)));
});

test("logScale maps decades evenly", () => {
  const s = logScale(0.01, 100, 0, 100);
  assert.ok(Math.abs(s(0.01) - 0) < 1e-9);
  assert.ok(Math.abs(s(1) - 50) < 1e-9);
  assert.ok(Math.abs(s(100) - 100) < 1e-9);
});

test("a free model pins to the low end of a log axis instead of vanishing", () => {
  // log10(0) is -Infinity. Dropping the point silently would be worse than
  // pinning it, because a $0 model is exactly the one a reader is looking for.
  const s = logScale(0.01, 100, 0, 100);
  assert.equal(s(0), 0);
  assert.equal(s(-1), 0);
});

test("logDomain pads outward so extremes never sit on the axis line", () => {
  const [lo, hi] = logDomain([1, 100]);
  assert.ok(lo < 1, `expected ${lo} < 1`);
  assert.ok(hi > 100, `expected ${hi} > 100`);
});

test("logDomain never returns a domain narrower than one decade", () => {
  // A tightly clustered set spans no round number, so the axis would come out
  // with no labels at all.
  const [lo, hi] = logDomain([10, 11, 12]);
  assert.ok(Math.log10(hi) - Math.log10(lo) >= 1 - 1e-9);
});

test("logDomain ignores non-positive and non-finite values", () => {
  assert.deepEqual(logDomain([0, -5, Number.NaN, Infinity]), [0.0001, 1]);
  const [lo, hi] = logDomain([0, 5]);
  assert.ok(lo > 0 && Number.isFinite(hi));
});

test("a single value still yields a usable log domain", () => {
  assert.deepEqual(logDomain([5]), [0.5, 50]);
});

test("linearDomain pads, and a single value does not collapse the axis", () => {
  assert.deepEqual(linearDomain([0, 10], 0.1), [-1, 11]);
  assert.deepEqual(linearDomain([7]), [6, 8]);
  assert.deepEqual(linearDomain([]), [0, 1]);
});

test("logTicks returns decades when the domain spans enough of them", () => {
  assert.deepEqual(logTicks(0.001, 1000), [0.001, 0.01, 0.1, 1, 10, 100, 1000]);
});

test("logTicks falls back to 1/2/5 when the domain is too narrow for decades", () => {
  const ticks = logTicks(1, 30);
  assert.ok(ticks.length >= 2, `expected a populated axis, got ${JSON.stringify(ticks)}`);
  for (const t of ticks) {
    assert.ok(t >= 1 && t <= 30, `tick ${t} outside the domain`);
  }
});

test("logTicks never returns a bare axis", () => {
  assert.ok(logTicks(1.1, 1.2).length > 0);
});

test("linearTicks lands on round numbers inside the domain", () => {
  const ticks = linearTicks(0, 100, 4);
  assert.ok(ticks.length > 0);
  for (const t of ticks) {
    assert.ok(t >= 0 && t <= 100, `tick ${t} outside the domain`);
  }
});

test("linearTicks handles a zero-width domain", () => {
  assert.deepEqual(linearTicks(5, 5), [5]);
});
