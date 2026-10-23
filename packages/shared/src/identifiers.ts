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
