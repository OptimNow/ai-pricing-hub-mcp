/**
 * The line every successful answer's text closes with: the source to name with
 * its figures, and the date of what was served.
 *
 * Every text already opens with "Data source: …". On claude.ai, which hands the
 * model the text block, that line did not survive into the answer: on
 * 2026-11-21 the French break-even question named no source in 2 of 2 runs, and
 * through the probe harness with the JSON half and the server instructions
 * taken away, the break-even named none in 6 of 6 (English and French). The
 * server instructions say to name the source, and Claude Code, which passes
 * them, did so 12 of 12; claude.ai gives no sign of passing them. So the text
 * says it itself, last, where an answer's own closing line is written from.
 *
 * Text only, on purpose: `structuredContent` already carries `provenance`, and
 * a new field there would change all eight output schemas, which makes
 * claude.ai ask every user who chose "Always allow" to approve each tool again
 * (seen on 2026-11-21 after 0.12.0 changed three).
 */

const SITE = "OptimToken (optimtoken.optimnow.io)";

/** The provenance fields this reads, across the three provenance shapes: the
 *  LLM catalogue, the compute catalogue (`region`), and the price archive
 *  (`asOf`, no tier). */
interface ProvenanceLike {
  tier?: number;
  region?: string;
  upstreamTimestamp?: string;
  dataAsOf?: string;
  asOf?: string;
}

function day(timestamp: string | undefined): string | undefined {
  return timestamp ? timestamp.slice(0, 10) : undefined;
}

function asProvenance(value: unknown): ProvenanceLike | undefined {
  return value && typeof value === "object" ? (value as ProvenanceLike) : undefined;
}

/** "prices as of 2026-11-21", or what a fallback tier served instead. */
function describe(p: ProvenanceLike, what: string): string {
  if (p.tier === 2) return `${what} from its snapshot of ${p.dataAsOf ?? "an earlier day"}, not live`;
  const date = day(p.upstreamTimestamp) ?? day(p.asOf);
  return date ? `${what} as of ${date}` : what;
}

/** The closing line for an answer's `structuredContent`, or null when it
 *  carries no provenance (an answer that never reached the site). */
export function sourceToCite(structured: Record<string, unknown> | undefined): string | null {
  const provenance = asProvenance(structured?.provenance);
  if (!provenance) return null;
  const compute = asProvenance(structured?.computeProvenance);
  let parts: string[];
  if (compute) parts = [describe(provenance, "API prices"), describe(compute, "instance rates")];
  else if (provenance.asOf !== undefined && provenance.tier === undefined) parts = [describe(provenance, "price archive")];
  else if (provenance.region !== undefined) parts = [describe(provenance, "instance rates")];
  else parts = [describe(provenance, "prices")];
  return `Source to name with any figure quoted from this answer: ${SITE}, ${parts.join(" and ")}.`;
}

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}

/** Append the closing line to a successful result's first text block. An
 *  error is left as it is: it quotes no figure. */
export function closeWithSource<T>(result: T): T {
  const r = result as ToolResultLike;
  if (r.isError) return result;
  const line = sourceToCite(r.structuredContent);
  const first = r.content?.find(block => block.type === "text" && typeof block.text === "string");
  if (!line || !first) return result;
  first.text = `${first.text}\n\n${line}`;
  return result;
}
