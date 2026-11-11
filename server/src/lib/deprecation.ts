/**
 * Retirement notices: reading the one the site sends, and saying it.
 *
 * The site keeps a table of the notices each model maker has published for
 * its own API (`src/lib/model-lifecycle.ts` there), re-read by hand against
 * the makers' deprecation pages. Since schemaVersion 2.8 it publishes that
 * table on the rows of `/api/llm-models` (`deprecation`) and dates it with
 * `meta.deprecationsVerifiedAt`. This server reads the field and never keeps a
 * copy of the table: a list kept by hand in two places drifts in silence.
 *
 * What a notice means, and what it does not:
 * - It is the MAKER's notice for its OWN API. A cloud platform or another host
 *   can set a later date, which is why a retired model still carries a price.
 * - It is a reason not to start on the model, and to plan a migration off it.
 * - No notice is "none on record", not "safe": nobody may have checked.
 */
import type { DeprecationInfo } from "../data/pricing-data.js";

export type { DeprecationInfo };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a row's `deprecation` as it arrives over HTTP.
 *
 * An object is a notice, even an empty one: the site sends `shutdown` and
 * `replacement` only when the maker publishes them. Anything that is not an
 * object is no notice. A date in another form is dropped rather than printed:
 * the notice stands, without a date this server could not compare.
 */
export function coerceDeprecation(value: unknown): DeprecationInfo | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const notice: DeprecationInfo = {};
  if (typeof raw.shutdown === "string" && ISO_DATE.test(raw.shutdown)) notice.shutdown = raw.shutdown;
  if (typeof raw.replacement === "string" && raw.replacement.trim()) notice.replacement = raw.replacement.trim();
  return notice;
}

/** Today as YYYY-MM-DD in UTC, the form the notices use. */
export function isoDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when the maker's shutdown date has passed. False without a date. */
export function isPastShutdown(notice: DeprecationInfo, today: string = isoDay()): boolean {
  return notice.shutdown !== undefined && notice.shutdown <= today;
}

/**
 * The notice in a few words, for a tag or a sentence:
 * "retired by its maker on 2026-08-10, replacement: GPT-5.6 Sol",
 * "to be retired by its maker on 2026-11-30, replacement: Claude Sonnet 5.5",
 * "retirement announced by its maker".
 */
export function describeDeprecation(notice: DeprecationInfo, today: string = isoDay()): string {
  const when =
    notice.shutdown === undefined
      ? "retirement announced by its maker"
      : isPastShutdown(notice, today)
        ? `retired by its maker on ${notice.shutdown}`
        : `to be retired by its maker on ${notice.shutdown}`;
  return notice.replacement ? `${when}, replacement: ${notice.replacement}` : when;
}

/** Inline marker for a row, e.g. ` [retired by its maker on 2026-08-10, replacement: GPT-5.6 Sol]`.
 *  Empty without a notice. */
export function deprecationTag(model: { deprecation?: DeprecationInfo }, today: string = isoDay()): string {
  return model.deprecation ? ` [${describeDeprecation(model.deprecation, today)}]` : "";
}

/**
 * The lines printed once under an answer in which a retired model appears.
 * Empty when none does, so an ordinary answer carries no boilerplate.
 */
export function deprecationLegend(
  models: { deprecation?: DeprecationInfo }[],
  verifiedAt: string | undefined,
): string[] {
  if (!models.some((m) => m.deprecation)) return [];
  return [
    "[retired / to be retired by its maker]: the model maker has announced the retirement of this model's API. " +
      "The date is the maker's shutdown date for its own API; a cloud platform or another host can set its own " +
      "and may still serve the model, which is why it still carries a price. Not a model to start on: plan the " +
      "migration to the replacement named. Not eligible for the FinOps Friendly badge.",
    `Retirement notices are read by hand from each maker's deprecation page${verifiedAt ? `, last on ${verifiedAt}` : ""}. ` +
      "A model with no such tag has no notice on record, which is not a guarantee that none exists.",
  ];
}

/** Said once on a tier that cannot know: the notices are the site's. */
export const NO_DEPRECATION_DATA =
  "Retirement notices are served by optimtoken.optimnow.io only: on this source no model carries one, " +
  "which says nothing about whether its maker has announced its retirement.";
