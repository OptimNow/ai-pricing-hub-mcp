/** How freely a model can be self-hosted and redeployed.
 *
 *  Ported verbatim from cloud-sparkle-compare/src/lib/openness.ts. Keep the
 *  buckets identical: the two apps must answer "can I self-host this" the same
 *  way for the same licence string.
 *
 *  This is a *separate axis* from the price tier in `category`. A model can be
 *  frontier-grade and open-weight at the same time, so folding openness into
 *  the tier list (as a fifth "Open Weights" category) forced every open model
 *  to give up one label to earn the other, and left open-licensed models
 *  scattered across Mid-tier and Budget where nobody could find them.
 *
 *  Keep the two apart: `category` answers "what does it cost", `openness`
 *  answers "whose infrastructure can it run on".
 */
export type Openness = "Open source" | "Open weights" | "Proprietary" | "Unknown";

export const OPENNESS_VALUES: Openness[] = [
  "Open source",
  "Open weights",
  "Proprietary",
  "Unknown",
];

/** OSI-approved licences: weights published AND no field-of-use restriction.
 *  Commercially the safest tier, which is the distinction a buyer cares about. */
const OPEN_SOURCE_LICENSES = new Set(["Apache 2.0", "MIT"]);

/** Weights are published, but the licence restricts something: acceptable-use
 *  clauses, user-count thresholds, non-commercial terms, or an attribution
 *  requirement. Self-hostable, but the terms need reading before production. */
const OPEN_WEIGHTS_LICENSES = new Set([
  "Llama 3.x",
  "Gemma",
  "Qwen",
  "Mistral",
  "CC-BY-NC-4.0",
  "Modified MIT",
]);

/** Bucket a licence string. Anything unrecognised is reported as Unknown rather
 *  than assumed proprietary: guessing here would put a confident label on the
 *  ~15% of the catalogue whose licence was never established, and a wrong
 *  "Open source" badge is a commercial risk for whoever acts on it. */
export function opennessOf(license: string | undefined): Openness {
  if (!license) return "Unknown";
  if (OPEN_SOURCE_LICENSES.has(license)) return "Open source";
  if (OPEN_WEIGHTS_LICENSES.has(license)) return "Open weights";
  if (license === "Proprietary") return "Proprietary";
  return "Unknown";
}
