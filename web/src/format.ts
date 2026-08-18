/** Cost formatters shared by all widgets.
 *
 *  These mirror `formatMicroCost` / `formatMonthlyBudget` in
 *  server/src/lib/llm-business-metrics.ts step for step: the text summary the
 *  model reads and the widget the user sees must never round the same number
 *  two different ways. Change one side, change the other.
 */

/** Sub-cent unit cost: $0.000123, $0.0042, $0.031 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Monthly budget: $1.2M, $1.2K, $450, $0.14, $0.0042 */
export function formatBudget(cost: number): string {
  if (cost >= 1_000_000) return `$${(cost / 1_000_000).toFixed(1)}M`;
  if (cost >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`;
  if (cost >= 1) return `$${cost.toFixed(0)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

/** Percentage saved going from `list` to `optimized`, or 0 when there is no gain. */
export function savingsPct(list: number, optimized: number): number {
  if (!(list > 0) || optimized >= list) return 0;
  return Math.round((1 - optimized / list) * 100);
}
