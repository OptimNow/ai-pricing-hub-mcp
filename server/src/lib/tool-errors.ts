/**
 * One log line per tool call answered with `isError: true`: which tool, and
 * which kind of error.
 *
 * Until 0.15.0 only an exception wrote a line. A call the schema refused, or
 * one a handler turned down, left nothing, so when the directory portal
 * reported a 14% tool-error rate on 2026-11-26 without saying which tool
 * failed, there was nothing to read: the question took a replay of 131 calls
 * to answer. The portal's rate counts exactly these results, and above 5% the
 * listing shows as degraded.
 *
 * What a line holds: the tool's name, a category from the list below, and for
 * a refused argument its NAME and the kind of refusal. Never a value, never a
 * model or instance name, never a header or an address: the arguments of a
 * call are the user's, and this server keeps none of them. A name is repeated
 * only when it is a plain identifier (`printableArgumentNames`).
 */

export type ToolErrorCategory =
  /** The arguments did not fit the tool's schema, after the tolerant reading. */
  | "input-validation"
  /** An argument the tool does not declare, and that reads as none it does. */
  | "unknown-argument"
  /** Arguments that fit the schema and contradict each other, or a name too long to look up. */
  | "invalid-arguments"
  /** The site could not be read, for data that has no fallback. */
  | "upstream-unavailable"
  /** The handler threw. A defect of this server. */
  | "internal"
  /** The answer did not fit the tool's own output schema. A defect of this server. */
  | "output-validation"
  /** A tool this server does not have. */
  | "unknown-tool"
  /** Refused by the SDK for another reason. */
  | "protocol";

export interface ToolErrorDetails {
  /** Names of the arguments refused. */
  arguments?: string[];
  /** Kinds of refusal, as the schema library names them (`invalid_value`, `too_big`). */
  issues?: string[];
}

/** The line as it is written: one JSON object, so a log search can count by
 *  tool and by category. Exported for the tests. */
export function toolErrorLine(tool: string, category: ToolErrorCategory, details: ToolErrorDetails = {}): string {
  return JSON.stringify({
    event: "tool_error",
    tool,
    category,
    ...(details.arguments?.length ? { arguments: details.arguments } : {}),
    ...(details.issues?.length ? { issues: details.issues } : {}),
  });
}

export function logToolError(tool: string, category: ToolErrorCategory, details?: ToolErrorDetails): void {
  console.warn(toolErrorLine(tool, category, details));
}

/**
 * The category of an error the SDK built itself, read from its text, or null
 * for an error a handler returned (logged where it is built) and for the two
 * the argument reader has already logged with more detail.
 *
 * The SDK answers a refused tool call with a result, not a JSON-RPC error, and
 * writes nothing: an answer its output schema refuses is the one this catches,
 * and it is invisible everywhere else.
 */
export function sdkErrorCategory(text: string): ToolErrorCategory | null {
  if (!text.startsWith("MCP error ")) return null;
  if (text.includes("Output validation error")) return "output-validation";
  if (text.includes("Input validation error") || /Tool .* (not found|disabled)/.test(text)) return null;
  return "protocol";
}
