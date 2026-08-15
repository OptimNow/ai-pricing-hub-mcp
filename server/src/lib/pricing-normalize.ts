// Pricing normalization helpers, ported from cloud-sparkle-compare
// (src/lib/pricing-normalize.ts). Only the LLM token-pricing guard applies here:
// this app has no live cloud-pricing API, so the Azure reservation and OCI rate
// helpers of the original are intentionally left out.

/**
 * Guard for LLM token pricing coming out of OpenRouter.
 *
 * OpenRouter encodes variable / router-decided pricing as the string "-1",
 * which becomes -$1,000,000 per 1M tokens once multiplied by 1e6 — those models
 * then sort to the top of any ascending price list and show negative budgets.
 * A model is only publishable when both sides are finite and non-negative, and
 * at least one side carries a real price (both-zero means a free/promo endpoint).
 *
 * Takes the raw per-token prices as parsed from the API. Unlike the original,
 * NaN is rejected here rather than left to the caller: the static fallback runs
 * through the same guard and has no other parse-failure net.
 */
export function hasPublishableTokenPricing(
  inputPerToken: number,
  outputPerToken: number,
): boolean {
  if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) return false;
  if (inputPerToken < 0 || outputPerToken < 0) return false;
  if (inputPerToken === 0 && outputPerToken === 0) return false;
  return true;
}
