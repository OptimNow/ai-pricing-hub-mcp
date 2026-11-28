/**
 * What each tool does with an argument it does not declare, once
 * `readToolArguments` has found it reads as none of the tool's own.
 *
 * Two outcomes, and no third. It is dropped when it cannot change the answer:
 * `useCasePreset` on a tool that costs every use case, `os: "Linux"` on a tool
 * that serves Linux only. Otherwise the call is refused, because an argument
 * left unread narrows nothing and the answer would cover more than was asked
 * (the reason 0.14.0 made the schemas strict): `os: "Windows"` answered with
 * Linux rates is a wrong answer, not a tolerant one. The refusal says what the
 * tool takes, and the sentence below when the argument is one a model is
 * known to send (the replay of 2026-11-28): a statement of what the tool does,
 * so the retry goes to the right argument or the right tool.
 *
 * Keys are the argument names as `fold` spells them: lower-case letters and
 * digits. A tool absent from the table refuses every undeclared argument with
 * the list of its own.
 */

import type { ArgumentSpec } from "./tool-arguments.js";

interface ArgumentRules {
  ignorable?: ArgumentSpec["ignorable"];
  /** Undeclared argument names, and the sentence a refusal adds for them. */
  notes?: [names: string[], note: string][];
}

const fold = (text: string): string => text.toLowerCase().replace(/[^\p{L}\d]+/gu, "");

const VOLUME = ["volume", "monthlyvolume", "monthlyrequests", "requestspermonth"];
const PRESET_VOLUMES_NOTE =
  "This tool costs a workload at 10,000, 100,000 or 1,000,000 requests a month (volumePreset 10k, 100k or 1m). " +
  "estimate-llm-cost takes any monthlyVolume.";
const WINDOW = ["days", "since", "period", "window", "startdate", "enddate", "from", "to", "daterange", "timeframe"];

export const TOOL_ARGUMENT_RULES: Record<string, ArgumentRules> = {
  "compare-llm-models": {
    notes: [
      [
        ["model", "modelname", "models", "modelnames", "name", "query", "search"],
        "compare-llm-models filters the whole catalogue and takes no model name. estimate-llm-cost costs one named " +
          "model, and compare-models-side-by-side takes 2 to 4 names.",
      ],
      [VOLUME, PRESET_VOLUMES_NOTE],
    ],
  },
  "estimate-llm-cost": {
    notes: [
      [
        ["model", "models", "modelnames"],
        "estimate-llm-cost takes one name, in modelName. compare-models-side-by-side takes 2 to 4 names.",
      ],
      [
        ["volumepreset", "volume"],
        "estimate-llm-cost takes monthlyVolume, a number of requests a month.",
      ],
    ],
  },
  "compare-models-side-by-side": {
    // The answer costs each model for all eight use cases: the one asked for is among them.
    ignorable: key => ["usecase", "usecasepreset"].includes(fold(key)),
    notes: [[VOLUME, PRESET_VOLUMES_NOTE]],
  },
  "recommend-llm-model": {
    notes: [
      [VOLUME, PRESET_VOLUMES_NOTE],
      [
        ["provider", "providers", "vendor"],
        "recommend-llm-model ranks the whole catalogue and has no provider filter. compare-llm-models filters by provider.",
      ],
    ],
  },
  "compare-compute-pricing": {
    // Linux is the only operating system served, so asking for it changes nothing.
    ignorable: (key, value) =>
      ["os", "operatingsystem", "platform"].includes(fold(key)) && typeof value === "string" && fold(value) === "linux",
    notes: [
      [["os", "operatingsystem", "platform"], "compare-compute-pricing serves Linux list prices only."],
      [
        ["instancetype", "instance", "instancename", "name", "sku"],
        "compare-compute-pricing has no filter by instance name. Its filters are region, provider, category, vCPUs, " +
          "memory, processor and use case.",
      ],
      [
        ["gpu", "gpus", "gpucount", "gputype", "gpumodel", "accelerator"],
        "GPU instances are the category \"GPU / Accelerated\", and a GPU model is the processor filter.",
      ],
    ],
  },
  "compare-model-hosts": {
    notes: [[VOLUME, PRESET_VOLUMES_NOTE]],
  },
  "estimate-self-hosting-breakeven": {
    notes: [
      [
        ["gpucount", "gpus", "gpu", "gputype", "gpumodel"],
        "The fleet is counted in instances (instanceCount), each billed at the hourly rate of instanceType or at hourlyRate. " +
          "GPUs are not counted apart.",
      ],
    ],
  },
  "track-llm-price-changes": {
    notes: [
      [
        WINDOW,
        "The week's moves cover the last 7 days and the window is fixed. With `models`, the answer is each model's " +
          "quoted price since tracking began, change by change.",
      ],
      [VOLUME, PRESET_VOLUMES_NOTE],
    ],
  },
};

/**
 * The refusal for arguments a tool does not declare: what was not read, what
 * the tool takes, and what is known about the arguments named.
 */
export function describeUnreadArguments(tool: string, unread: readonly string[], declared: readonly string[]): string {
  const several = unread.length > 1;
  const named = unread.map(name => `\`${name}\``).join(", ");
  const notes = new Set<string>();
  for (const name of unread) {
    const note = TOOL_ARGUMENT_RULES[tool]?.notes?.find(([names]) => names.includes(fold(name)))?.[1];
    if (note) notes.add(note);
  }
  return (
    `${named} ${several ? "are not arguments" : "is not an argument"} of ${tool}, so the call was not run: an ` +
    `argument left unread would change what the answer covers. ` +
    `${tool} takes: ${declared.join(", ")}.` +
    ([...notes].length > 0 ? ` ${[...notes].join(" ")}` : "")
  );
}
