/**
 * What an external identifier of a place looks like, and what a curator may
 * say of one — the rule the storing side and the curation dialog apply alike
 * (ADR-0143 decision 5, #1896).
 *
 * Declared once (ADR-0065): a shape the backend refuses and the dialog links
 * is one rule, and a word the dialog offers that the backend does not take is
 * a button that always fails.
 */

/** The schemes a place's identifier may be of: `place_identifiers.scheme`. */
export const IDENTIFIER_SCHEMES = ['wikidata', 'whc', 'osm'] as const;
export type IdentifierScheme = (typeof IDENTIFIER_SCHEMES)[number];

/**
 * The shape an identifier of each scheme has: a Wikidata item, a World Heritage
 * reference (a site's number with its suffix, or a component's with its
 * ordinal) or an OpenStreetMap object. A value of another shape is no
 * identifier: refused before anything is looked up, and linked to no page.
 */
export const IDENTIFIER_SHAPES: Record<IdentifierScheme, RegExp> = {
  wikidata: /^Q\d+$/,
  whc: /^\d+[a-z]*(-\d+)?$/,
  osm: /^(node|way|relation)\/\d+$/,
};

/** Whether `value` has the shape of an identifier of `scheme`. */
export function isIdentifier(scheme: IdentifierScheme, value: string): boolean {
  return IDENTIFIER_SHAPES[scheme].test(value);
}

/** A curator's word standing on an identifier: `place_identifier_verdicts.verdict`. */
export const IDENTIFIER_VERDICTS = ['identifies', 'refers', 'removed'] as const;
export type IdentifierVerdict = (typeof IDENTIFIER_VERDICTS)[number];

/** What a curator may say of an identifier: a verdict, or `derived`, which takes the word back. */
export const IDENTIFIER_WORDS = [...IDENTIFIER_VERDICTS, 'derived'] as const;
export type IdentifierWord = (typeof IDENTIFIER_WORDS)[number];

/**
 * The shapes of the ids a source knows a place by: `experience_sources.id_scheme`
 * (ADR-0198). A World Heritage property's number (`383`), a component's
 * reference (`383bis-001`), a Wikidata item, a Wikidata statement's id, and a
 * curator's own key (`curator-<user>-<n>`), which a record a curator made
 * carries under any source.
 */
export const SOURCE_ID_SCHEMES = ['whc-site', 'whc-component', 'wikidata', 'wikidata-statement', 'curator'] as const;
export type SourceIdScheme = (typeof SOURCE_ID_SCHEMES)[number];

/**
 * The shape an id of each scheme has. A component's reference carries its
 * inscription's suffix on the number (`985ter-001`), sometimes a letter on the
 * component (`1102rev-001a`, `823-001B`, `1142-01bis`) and once a sub-number
 * (`540-003a 1`); the one point of a site that gains a second component and is
 * parted carries the site's number alone (`775`). The schema's `source_id_fits_scheme()` states the same
 * shapes for the trigger that holds a record in a whole to them.
 */
export const SOURCE_ID_SHAPES: Record<SourceIdScheme, RegExp> = {
  'whc-site': /^\d+$/,
  'whc-component': /^\d+[a-z]*(-\d+[A-Za-z]*( \d+)?)?$/,
  wikidata: /^Q[1-9]\d*$/,
  'wikidata-statement': /^Q[1-9]\d*\$[0-9A-Fa-f-]+$/,
  curator: /^curator-\d+-\d+$/,
};
