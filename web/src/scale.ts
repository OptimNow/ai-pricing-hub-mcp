/** Axis maths for the inline SVG charts.
 *
 *  Kept free of React so the mapping can be reasoned about — and checked — on
 *  its own. Model prices span four to five orders of magnitude, which is why the
 *  cost axis is log10 rather than linear.
 */

/** Map a domain onto a pixel range. Returns the identity midpoint for a
 *  zero-width domain rather than NaN. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!(span > 0)) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Same, on log10. Values ≤ 0 are clamped to the low end: a free model has no
 *  logarithm, and dropping it silently would be worse than pinning it. */
export function logScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const span = l1 - l0;
  if (!(span > 0)) return () => (r0 + r1) / 2;
  return (v) => {
    if (!(v > 0)) return r0;
    return r0 + ((Math.log10(v) - l0) / span) * (r1 - r0);
  };
}

/** Log domain covering `values`, padded outward so the cheapest and dearest
 *  points never sit on the axis line. A single value gets a decade either side.
 *
 *  The domain is never narrower than one decade: a tightly clustered set (all
 *  models within, say, 1.5x of each other) otherwise spans no round number at
 *  all and the axis comes out with no labels on it. */
export function logDomain(values: number[]): [number, number] {
  const positive = values.filter((v) => v > 0 && Number.isFinite(v));
  if (positive.length === 0) return [0.0001, 1];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  if (min === max) return [min / 10, max * 10];

  const pad = (Math.log10(max) - Math.log10(min)) * 0.08;
  let lo = Math.log10(min) - pad;
  let hi = Math.log10(max) + pad;
  if (hi - lo < 1) {
    const centre = (lo + hi) / 2;
    lo = centre - 0.5;
    hi = centre + 0.5;
  }
  return [Math.pow(10, lo), Math.pow(10, hi)];
}

/** Linear domain covering `values`, padded by `fraction` of the span. A single
 *  value gets ±1 so the axis does not collapse. */
export function linearDomain(values: number[], fraction = 0.1): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * fraction;
  return [min - pad, max + pad];
}

/** Decade ticks inside [min, max]; falls back to a 1/2/5 progression when the
 *  domain is too narrow to contain three decades. */
export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const decades: number[] = [];
  for (let e = lo; e <= hi; e++) {
    const v = Math.pow(10, e);
    if (v >= min && v <= max) decades.push(v);
  }
  if (decades.length >= 3) return decades;

  const fine: number[] = [];
  for (let e = lo; e <= hi; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= min && v <= max) fine.push(v);
    }
  }
  if (fine.length >= 2) return fine;
  // Last resort: label the bounds so the axis is never bare.
  return decades.length > 0 ? decades : [min, max];
}

/** Round ticks inside [min, max], roughly `count` of them. */
export function linearTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const rough = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
