// How an Azure VM size name reads: family, size, feature letters, version.
// A port of `parseAzureSizeName` from the site's src/lib/azure-vm-sizes.ts, taken
// at its commit c4a6916. The rest of that file (the vCPU and memory of each
// size) serves the site's price fetch and is not needed here: the rows arrive
// with their specs. compute-categories.ts reads the processor from the name.
//
// Three name conventions are read:
// - A constrained-core size, `E32-8s_v5` or `M416s-208_8_v3`, has the active
//   count after the dash.
// - `_Promo` is a promotional price on the size it names.
// - The `Standard_` or `Basic_` prefix is removed by the caller.

/** A size's name, read into its parts. */
export interface AzureSizeName {
  /** Upper-case family letters: D, DC, E, FX, NC, M… */
  family: string;
  /** The size number: 32 in `E32-8s_v5`. */
  size: number;
  /** The active vCPUs of a constrained-core size, else null. */
  active: number | null;
  /** The lower-case feature letters: `ads` in `D4ads_v5`. */
  letters: string;
  /** What sits between the letters and the version: `_A10`, `_cc`, `_12`… */
  tags: string;
  /** The version, 1 when the name carries none. */
  version: number;
  /** The full size this one is constrained from or promotes, without prefix. */
  base: string;
}

const NAME =
  /^([A-Z]+)(\d+)(?:-(\d+))?([a-z]*)(?:-(\d+))?((?:_[A-Za-z0-9]+)*?)(?:_v(\d+))?(?:_Promo)?$/;

/** Read a size name (prefix already removed), or null when it is not one. */
export function parseAzureSizeName(shortName: string): AzureSizeName | null {
  const m = NAME.exec(shortName);
  if (!m) return null;
  const [, family, size, activeBefore, letters, activeAfter, tags, version] = m;
  const active = activeBefore ?? activeAfter;
  const base =
    family + size + letters + tags + (version ? `_v${version}` : "");
  return {
    family,
    size: Number(size),
    active: active ? Number(active) : null,
    letters,
    tags,
    version: version ? Number(version) : 1,
    base,
  };
}
