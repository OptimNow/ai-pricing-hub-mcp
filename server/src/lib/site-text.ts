/**
 * The check every free-text value from the site passes before this server
 * repeats it to a model.
 *
 * The names in the catalogue are not all written by OptimNow. Model and
 * provider names, host names and replacement names reach the site from
 * OpenRouter, and so from whoever lists a model or a host there. Whatever such
 * a value holds lands in the calling model's context, in the text and in
 * `structuredContent`. A wrong name is a data error; a name that is a sentence
 * addressed to the model, a hidden line, or a link is an instruction this
 * server would be relaying. The Cloud FinOps connector applies the same rule
 * to the figures it fetches from OptimToken (`_check_text` in its
 * `live_figures.py`), and the directory policy bars a connector from pulling
 * behavioural instructions from an external source.
 *
 * So a value is a label or it is refused: short, one printable line, no angle
 * bracket, no link. A row whose name fails is dropped by its parser, and an
 * optional value that fails is left out, which reads as "not known", never as
 * a guess. The rule checks shape, not truth: a tampered catalogue can still
 * publish a wrong name, never a paragraph.
 *
 * Measured on 2026-11-22 against every value it applies to (316 models, 948
 * host offers, 6,782 instances in four regions, 31 price moves): the longest
 * was 48 characters, and none was refused.
 */

/** Ten times today's longest name (48 characters): room to grow, none for a paragraph. */
export const MAX_LABEL_CHARS = 200;

/**
 * Control characters, invisible format characters (zero-width spaces,
 * direction overrides, the tag characters that spell text a reader cannot
 * see) and line or paragraph separators. A label is one visible line.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** A scheme separator or a www. prefix: the start of a link. */
const LINK = /:\/\/|www\./i;

/** Why `value` is not a label, or undefined when it is one. */
export function labelProblem(value: string, max: number = MAX_LABEL_CHARS): string | undefined {
  if (value.length > max) return `longer than ${max} characters`;
  if (INVISIBLE.test(value)) return "holds a line break, a control or an invisible character";
  if (value.includes("<") || value.includes(">")) return "holds an angle bracket";
  if (LINK.test(value)) return "holds a link";
  return undefined;
}

/** True when `value` is a non-blank string and a label. A refusal is logged.
 *  For the parsers that keep a value exactly as sent. */
export function isSiteLabel(value: unknown, max: number = MAX_LABEL_CHARS): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (labelProblem(value, max) !== undefined) {
    reportRefused(value, max);
    return false;
  }
  return true;
}

/** The trimmed value when it is a non-empty label, otherwise undefined. */
export function siteLabel(value: unknown, max: number = MAX_LABEL_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return isSiteLabel(trimmed, max) ? trimmed : undefined;
}

/** Values already reported, so a refused name is logged once per process,
 *  not on every refetch. Bounded: a flood of new values stops at the cap. */
const reported = new Set<string>();
const MAX_REPORTED = 100;

function reportRefused(value: string, max: number): void {
  if (reported.has(value) || reported.size >= MAX_REPORTED) return;
  reported.add(value);
  // JSON.stringify shows the hidden characters as escapes; the value is cut so
  // the log line stays a line.
  console.warn(
    `[site-text] refused a value from the site (${labelProblem(value, max)}): ` +
      `${JSON.stringify(value.slice(0, 120))}${value.length > 120 ? "…" : ""}`,
  );
}

/** Forget what was reported. For tests. */
export function resetRefusedReportsForTest(): void {
  reported.clear();
}
