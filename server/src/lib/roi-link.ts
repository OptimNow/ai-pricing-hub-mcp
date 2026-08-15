// Deep link into the sister AI ROI Calculator. This hub answers "what would this
// model cost?"; the calculator answers "is it worth it?". Carrying the scenario
// across means nobody retypes the model, workload and volume.
//
// Ported from cloud-sparkle-compare/src/lib/roi-calculator.ts so both sides build
// the same URL. The calculator validates each parameter independently and ignores
// what it doesn't recognise, so an outdated link degrades to its defaults.
//
// MCP hosts sandbox widget iframes differently and a target="_blank" anchor may be
// inert. The URL therefore also ships in structuredContent, so the model can offer
// it as chat text when the widget link does nothing.

import { USE_CASE_PROFILES, VOLUME_PRESETS, type UseCaseKey, type VolumePreset } from "./llm-business-metrics.js";

export const ROI_CALCULATOR_URL = "https://airoicalculator.optimnow.io/";

/** Same slug rules as the web app's /models/ URLs, which is what the calculator
 *  matches against its catalogue. "+" is meaning, not punctuation. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\+/g, "-plus-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function roiCalculatorUrl(
  options: {
    useCase?: UseCaseKey;
    volume?: VolumePreset;
    model?: { provider: string; model: string };
  } = {},
): string {
  const url = new URL(ROI_CALCULATOR_URL);

  if (options.useCase) {
    url.searchParams.set("useCase", options.useCase);
    // Pass batch eligibility explicitly so both sides price the workload alike.
    if (USE_CASE_PROFILES[options.useCase].batchEligible) url.searchParams.set("batch", "1");
  }

  if (options.volume) {
    const preset = VOLUME_PRESETS.find((p) => p.key === options.volume);
    if (preset) url.searchParams.set("volume", String(preset.value));
  }

  if (options.model) {
    url.searchParams.set("model", `${slugify(options.model.provider)}/${slugify(options.model.model)}`);
  }

  return url.toString();
}
