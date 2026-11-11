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
  // Meta split the Llama licence line: the site now labels Llama 4 models
  // "Llama 4", distinct from "Llama 3.x". Both publish weights under an
  // acceptable-use policy plus a monthly-active-user threshold, so both land in
  // the same bucket — but the *string* is new, and an unrecognised string falls
  // through to "Unknown". Before this entry, asking the site for its catalogue
  // reported Llama 4 Maverick, Scout and Guard as unknown-licence.
  "Llama 4",
  "Gemma",
  "Qwen",
  "Mistral",
  "CC-BY-NC-4.0",
  "Modified MIT",
  // The site's list as of 2026-11-11, in its order. Named after each model's
  // own LICENSE file, read 2026-10-18 on the site's side. Each publishes the
  // weights and limits something: a revenue threshold for model-as-a-service
  // operators (Kimi K3, GLM-5.3), non-commercial use or prior authorisation
  // (MiniMax), use-based restrictions (DeepSeek), or terms of the lab's own
  // (the rest). Until they were added here, 17 catalogue models read "Unknown"
  // in this server and "Open weights" on the site.
  "Kimi K3 License",
  "GLM-5.3 License",
  "MiniMax Community License",
  "MiniMax Non-Commercial License",
  "DeepSeek License",
  "NVIDIA Open Model License",
  "LFM Open License",
  "Moondream Model License",
  "Muse Model License",
  "Reka Edge License",
  // Does not apply in the EU, the UK or South Korea, and needs Tencent's
  // permission above 100 million monthly users (Hunyuan A13B).
  "Tencent Hunyuan Community License",
  // A separate commercial licence for a model-as-a-service operator above
  // $20M revenue, or a device maker (Step 5 Preview).
  "StepFun Model License",
  // Production use allowed, except a hosted or embedded service competing with
  // the licensor's own (Moondream 3 Preview).
  "Business Source License 1.1",
  // Permissive, but not OSI-approved, and the site calls a licence open source
  // only when it is. Read as open weights until that changes.
  "OpenMDW 1.1",
]);

/** True for a licence string this file can bucket.
 *
 *  The site sends the licence as a string and the bucketing is local, so a
 *  string added upstream reads "Unknown" here with nothing failing: that is how
 *  "Llama 4" broke, and then fourteen more. `fetchFromSite` logs the strings
 *  that fail this test, so the next one shows up in the server log on the day
 *  it arrives instead of in a review three months later. */
export function isRecognisedLicence(license: string): boolean {
  return (
    license === "Proprietary" ||
    OPEN_SOURCE_LICENSES.has(license) ||
    OPEN_WEIGHTS_LICENSES.has(license)
  );
}

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
