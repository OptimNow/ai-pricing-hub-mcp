/**
 * The version of each of the site's endpoints this server was last read
 * against, and a line in the log on the day the site answers under another.
 *
 * The site states a schema version on every answer (`meta.schemaVersion`) and
 * bumps it with each field it adds or whose meaning it changes: 2.4 changed
 * what the `Reasoning` capability means, 2.5 removed `Code`, 2.6 to 2.8 added
 * the listing flags and the retirement notices. Every one of those was
 * followed here by hand, on the day someone noticed. This server recorded the
 * version it was served (`provenance.upstreamSchemaVersion`) and compared it
 * with nothing, so a bump on the site changed nothing here: no log, no failed
 * check, and a new field dropped by the coercion without a trace.
 *
 * Two things read the table below:
 *
 *  - `noteSiteSchema()`, called where each answer is read, logs once per
 *    process when the versions differ. The answer is still served: the
 *    coercions already refuse what they cannot read, and a version this server
 *    has not seen is not evidence that its prices are wrong.
 *  - `npm run check-parity` fails when an entry differs from the site's own
 *    constants (src/lib/api-schema-versions.ts in its checkout) or from what
 *    the live endpoints answer. The site runs that script on a schedule, so a
 *    bump there opens an issue instead of waiting for a review.
 *
 * Move an entry when, and only when, the change behind the new version has
 * been read and either carried here or decided against.
 */
export const SYNCED_SITE_SCHEMAS = {
  "/api/llm-models": "2.8",
  "/api/pricing": "1.3",
  "/api/model-hosts": "1.0",
  "/api/price-changes": "1.0",
} as const;

export type SiteEndpoint = keyof typeof SYNCED_SITE_SCHEMAS;

const noted = new Set<string>();

/** Exported for tests. */
export function resetSiteSchemaNotes(): void {
  noted.clear();
}

/**
 * Say so in the log, once per endpoint and version, when the site answers
 * under a version other than the one this server was read against. An answer
 * that states no version is not reported: an older deployment states none on
 * its error answers, and there is nothing to compare.
 */
export function noteSiteSchema(endpoint: SiteEndpoint, seen: unknown): void {
  if (typeof seen !== "string" || !seen) return;
  const synced = SYNCED_SITE_SCHEMAS[endpoint];
  if (seen === synced) return;
  const key = `${endpoint} ${seen}`;
  if (noted.has(key)) return;
  noted.add(key);
  console.warn(
    `[site-schema] ${endpoint} answers under schema ${seen}; this server was last read against ${synced}. ` +
      `A field may have been added or have changed meaning. Read the site's note beside its schemaVersion, ` +
      `run \`npm run check-parity\`, then move SYNCED_SITE_SCHEMAS in lib/site-schema.ts.`,
  );
}
