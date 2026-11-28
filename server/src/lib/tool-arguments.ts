/**
 * A tool call's arguments, read before they are validated.
 *
 * The directory portal counted 7 tool errors in 49 calls on 2026-11-26, and a
 * replay of 131 realistic calls against production on 2026-11-28 showed where
 * such errors come from: 28 of 28 well-formed calls answered, and 74 of the 93
 * a model plausibly sends were refused, 54 of them by the schema before any
 * handler ran. The model had the right argument and the wrong spelling of it:
 * `region: "eu-west-1"` for `europe`, `volumePreset: "1M"` for `1m`, `model`
 * where this tool says `modelName`, `"1000000"` for 1000000, `limit: 100`
 * where 50 is the most.
 *
 * So the arguments are read here first, and only a reading that has one
 * meaning is taken: a key spelled in another case or under the name a sibling
 * tool gives it, an option of a closed list in another case or as its label, a
 * number or a list sent as text. What has no single meaning is left as it came
 * and refused as before: `sortBy: "price"` could be three sort keys.
 *
 * It runs before the SDK validates (lib/http.ts), not in the schemas, because
 * a tool's published definition must not move: a changed input schema makes
 * claude.ai ask every user who chose "Always allow" to approve the tool again,
 * and `z.preprocess` in a shape publishes that argument as accepting anything.
 * The schemas stay what a strict client validates against; this reads what a
 * model sends when it does not.
 *
 * An argument the tool does not declare, and that reads as none of its own, is
 * taken out and listed in `unread`: `tool()` in index.ts refuses the call with
 * a sentence that says what the tool takes. Dropping it without a word is what
 * 0.14.0 ended (a filter that silently did nothing changes what the answer
 * means), and the SDK's own refusal names the key but not what to pass.
 */

import { z } from "zod";
import { USE_CASE_PROFILES, VOLUME_PRESETS } from "./llm-business-metrics.js";

/** Where the names of the arguments that were not read travel from the HTTP
 *  layer to the tool: the call's `_meta`, under a key of this server's own. */
export const UNREAD_ARGUMENTS_META = "optimnow.io/unreadArguments";

type Field = { optional: boolean } & (
  | { kind: "enum"; options: readonly string[] }
  | { kind: "number"; max?: number }
  | { kind: "boolean" }
  | { kind: "strings" }
  | { kind: "other" }
);

export interface ArgumentSpec {
  /** Every argument the tool declares, and what it takes. */
  fields: ReadonlyMap<string, Field>;
  /** An undeclared argument that changes nothing in this tool's answer, and is
   *  dropped rather than refused: `os: "Linux"` on a tool that serves Linux only. */
  ignorable?: (key: string, value: unknown) => boolean;
}

export interface ArgumentReading {
  arguments: unknown;
  /** Arguments the tool does not declare and that read as none it does. */
  unread: string[];
}

/** Letters and digits only, lower case: `use_case_preset`, `useCasePreset` and
 *  "Use case preset" are one spelling. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
}

/** What each declared argument takes, read off the tool's own Zod shape. */
export function argumentSpec(
  shape: Record<string, unknown>,
  options: Pick<ArgumentSpec, "ignorable"> = {},
): ArgumentSpec {
  const fields = new Map<string, Field>();
  for (const [key, schema] of Object.entries(shape)) {
    let inner: unknown = schema;
    let optional = false;
    while (inner instanceof z.ZodOptional) {
      inner = inner.unwrap();
      optional = true;
    }
    if (inner instanceof z.ZodEnum) {
      fields.set(key, { kind: "enum", optional, options: (inner.options as unknown[]).filter((o): o is string => typeof o === "string") });
    } else if (inner instanceof z.ZodNumber) {
      const max = inner.maxValue;
      fields.set(key, { kind: "number", optional, max: typeof max === "number" && Number.isFinite(max) ? max : undefined });
    } else if (inner instanceof z.ZodBoolean) {
      fields.set(key, { kind: "boolean", optional });
    } else if (inner instanceof z.ZodArray && inner.element instanceof z.ZodString) {
      fields.set(key, { kind: "strings", optional });
    } else {
      fields.set(key, { kind: "other", optional });
    }
  }
  return { fields, ...options };
}

// ── Values ──────────────────────────────────────────────────────────

/** A number written as text: "1000000", "2.5", "1,000,000", "$500". Nothing
 *  with a unit or a suffix: "1M" and "0.8M tokens" each have two readings. */
function numberFromText(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/^\$\s*/, "");
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\d{1,3}(,\d{3})+$/.test(text)) return Number(text.replace(/,/g, ""));
  return undefined;
}

/** The one option a string spells, whatever its case, its separators or a
 *  plural: "Europe", "open-weights", "pricePerVcpu", "1M". */
function optionSpelled(options: readonly string[], value: string): string | undefined {
  const wanted = fold(value);
  if (!wanted) return undefined;
  const hits = options.filter(option => {
    const spelled = fold(option);
    return spelled === wanted || `${spelled}s` === wanted || spelled === `${wanted}s`;
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/** A use case by the label the answers print for it: "Support Ticket",
 *  "support tickets", "Coding". The key itself is read by `optionSpelled`. */
function useCaseNamed(value: string): string | undefined {
  const wanted = fold(value);
  const names = (key: string): string[] => {
    const profile = USE_CASE_PROFILES[key as keyof typeof USE_CASE_PROFILES];
    return [profile.label, profile.shortLabel].map(fold);
  };
  const hits = Object.keys(USE_CASE_PROFILES).filter(key =>
    names(key).some(name => name === wanted || `${name}s` === wanted),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The region group a provider's own region code belongs to: `us-east-1` and
 * `eastus2` are us-east, `eu-west-1` and `westeurope` are europe.
 *
 * A group is priced at one place per provider, and it is not always the place
 * asked for (europe is Ireland at AWS, so `eu-central-1` reads Ireland's
 * rates). Every answer names the place it priced, in the text and in
 * `provenance.sourceRegions`, so the reading is stated, not hidden.
 */
function regionGroupOf(value: string): string | undefined {
  const code = fold(value);
  if (/^(useast|eastus)/.test(code)) return "us-east";
  if (/^(uswest|westus)/.test(code)) return "us-west";
  if (code === "eu" || code === "emea" || /^(eu(west|central|north|south)|europe|westeurope|northeurope|uk(south|west))/.test(code)) {
    return "europe";
  }
  if (code === "apac" || /^(ap(southeast|northeast|south|east)|asia|southeastasia|eastasia|japan|australia|korea)/.test(code)) {
    return "asia-pacific";
  }
  return undefined;
}

const DIRECTION_WORDS: Record<string, string> = {
  increase: "up", increases: "up", increased: "up", rise: "up", rises: "up", rising: "up", higher: "up", upward: "up",
  decrease: "down", decreases: "down", decreased: "down", drop: "down", drops: "down", fall: "down", falls: "down",
  falling: "down", lower: "down", cheaper: "down", cut: "down", cuts: "down", downward: "down",
};

/** A volume preset from the number it stands for: 1000000 is "1m". */
function volumePresetOf(value: unknown): string | undefined {
  const amount = typeof value === "number" ? value : numberFromText(value);
  return VOLUME_PRESETS.find(preset => preset.value === amount)?.key;
}

/** The exact volume a preset stands for: "1m" is 1,000,000. */
function volumeOfPreset(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const key = optionSpelled(VOLUME_PRESETS.map(preset => preset.key), value);
  return VOLUME_PRESETS.find(preset => preset.key === key)?.value;
}

/** What an option of a closed list can also be called, by the argument's name. */
const OPTION_NAMES: Record<string, (value: unknown) => string | undefined> = {
  useCasePreset: value => (typeof value === "string" ? useCaseNamed(value) : undefined),
  region: value => (typeof value === "string" ? regionGroupOf(value) : undefined),
  direction: value => (typeof value === "string" ? DIRECTION_WORDS[fold(value)] : undefined),
  volumePreset: volumePresetOf,
};

function readValue(key: string, field: Field, value: unknown): unknown {
  switch (field.kind) {
    case "enum": {
      if (typeof value === "string" && field.options.includes(value)) return value;
      const spelled = typeof value === "string" ? optionSpelled(field.options, value) : undefined;
      const named = spelled ?? OPTION_NAMES[key]?.(value);
      return named !== undefined && field.options.includes(named) ? named : value;
    }
    case "number": {
      let amount = typeof value === "number" ? value : numberFromText(value);
      if (amount === undefined) return value;
      // More rows than the most a tool returns is a request for the most.
      if (key === "limit" && field.max !== undefined && amount > field.max) amount = field.max;
      // A share of 1 cannot exceed 1, so 60 is sixty per cent.
      if (key === "cacheHitRate" && amount > 1 && amount <= 100) amount /= 100;
      return amount;
    }
    case "boolean": {
      if (typeof value !== "string") return value;
      const word = fold(value);
      return word === "true" || word === "yes" ? true : word === "false" || word === "no" ? false : value;
    }
    case "strings":
      // No model name holds a comma, so a list sent as text has one reading.
      return typeof value === "string"
        ? value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean)
        : value;
    case "other":
      return value;
  }
}

// ── Keys ────────────────────────────────────────────────────────────

/** The names the tools give a model's name: one of them is declared per tool. */
const MODEL_KEYS = new Set(["model", "modelname", "models", "modelnames", "modelid", "modelids"]);
const USE_CASE_KEYS = new Set(["usecase", "usecasepreset"]);
const VOLUME_KEYS = new Set(["volume", "monthlyvolume", "volumepreset", "monthlyrequests", "requestspermonth"]);

/** The declared argument an undeclared one means, with its value in the form
 *  that argument takes; undefined when it means none, or more than one thing. */
function aliasOf(spec: ArgumentSpec, key: string, value: unknown): { key: string; value: unknown } | undefined {
  const spelling = fold(key);

  // The same name in another case or with underscores: `use_case_preset`.
  for (const declared of spec.fields.keys()) {
    if (fold(declared) === spelling) return { key: declared, value };
  }

  if (MODEL_KEYS.has(spelling)) {
    if (spec.fields.get("models")?.kind === "strings") return { key: "models", value };
    const single = ["modelName", "model"].find(name => spec.fields.has(name));
    if (single) {
      if (typeof value === "string") return { key: single, value };
      // A list of one name is that name; a list of several is not one model.
      if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return { key: single, value: value[0] };
    }
    return undefined;
  }

  if (USE_CASE_KEYS.has(spelling) && spec.fields.has("useCasePreset")) return { key: "useCasePreset", value };

  if (VOLUME_KEYS.has(spelling)) {
    if (spec.fields.has("monthlyVolume")) {
      const amount = typeof value === "number" ? value : numberFromText(value) ?? volumeOfPreset(value);
      return amount === undefined ? undefined : { key: "monthlyVolume", value: amount };
    }
    if (spec.fields.has("volumePreset")) {
      // Only the three volumes a preset stands for: any other has no preset.
      const preset = volumePresetOf(value) ?? (volumeOfPreset(value) !== undefined ? value : undefined);
      return preset === undefined ? undefined : { key: "volumePreset", value: preset };
    }
  }

  return undefined;
}

/**
 * Read one call's arguments against what its tool declares.
 *
 * Never throws and never invents: a value with no single reading is returned
 * as it came, for the schema to refuse by name.
 */
export function readToolArguments(spec: ArgumentSpec, args: unknown): ArgumentReading {
  if (args === undefined || args === null) return { arguments: args, unread: [] };
  if (typeof args !== "object" || Array.isArray(args)) return { arguments: args, unread: [] };

  // An argument sent as null was not given: a model that fills every optional
  // argument of a schema sends null for the ones it has nothing to put in.
  const given = Object.entries(args as Record<string, unknown>).filter(([, value]) => value !== null);
  // A Map, then Object.fromEntries: a key named "__proto__" stays a key.
  const read = new Map<string, unknown>();
  const unread: string[] = [];

  // Declared keys first, so an alias never replaces the argument itself.
  for (const [key, value] of given) {
    if (spec.fields.has(key)) read.set(key, value);
  }
  for (const [key, value] of given) {
    if (spec.fields.has(key)) continue;
    const alias = aliasOf(spec, key, value);
    if (alias && !read.has(alias.key)) read.set(alias.key, alias.value);
    else if (!spec.ignorable?.(key, value)) unread.push(key);
  }

  for (const [key, value] of read) {
    const field = spec.fields.get(key)!;
    const next = readValue(key, field, value);
    // An optional argument sent empty was left out: no names in a list of
    // names, nothing between the quotes.
    const empty = (Array.isArray(next) && next.length === 0 && field.kind === "strings") || (typeof next === "string" && next.trim() === "");
    if (field.optional && empty) read.delete(key);
    else read.set(key, next);
  }

  return { arguments: Object.fromEntries(read), unread };
}

/** The argument names a refusal or a log line may repeat: a plain identifier,
 *  never free text a client put where a key goes. At most five. */
export function printableArgumentNames(names: readonly unknown[]): string[] {
  return names
    .filter((name): name is string => typeof name === "string")
    .map(name => (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : "(unprintable)"))
    .slice(0, 5);
}

/** The unread argument names a call's `_meta` carries, as `readToolArguments` left them. */
export function unreadArgumentsOf(extra: unknown): string[] {
  const meta = (extra as { _meta?: Record<string, unknown> } | null | undefined)?._meta;
  const names = meta?.[UNREAD_ARGUMENTS_META];
  return Array.isArray(names) ? printableArgumentNames(names) : [];
}
