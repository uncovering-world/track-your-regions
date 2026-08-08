/**
 * Whether a venue that already passed the museum test is an *art* museum.
 *
 * The category holds art museums by product decision (2026-08-05): archaeology, egyptology,
 * natural-history and military museums are a separate import with their own category, not this
 * one. The dry run measured the boundary and it never made it into the plan that shipped —
 * the first real run admitted 110 museums, of which an audit found 15 typed archaeology,
 * egyptology, natural history or military, 5 that are not institutions at all, and one
 * (East Side Gallery) that no class rule can reach. This module is what the dry run had.
 */

export interface WorkFact {
  sculptural: boolean;
}

export type ArtResult = { art: true; why: string } | { art: false; why: string };

/**
 * Thirteen classes broad enough to name an institution's purpose rather than its contents, each
 * verified present in the `P279*` closure under museum (Q33506) and carrying the label named.
 * Q207694 and Q3196771 are two distinct Wikidata entities that both happen to be labelled
 * "art museum" — read off real entities, not a label search, or the second one is invisible.
 */
export const ART_CLASSES: Record<string, string> = {
  Q207694: 'art museum',
  Q3196771: 'art museum (a second Wikidata entity with the same label)',
  Q3844310: 'national gallery',
  Q1475403: 'kunsthalle',
  Q97662266: 'museum of modern art',
  Q108860927: 'contemporary art museum',
  Q107537774: 'private art museum',
  Q111889841: 'university art museum',
  Q107524840: 'single-artist museum',
  Q126195053: 'sculpture museum',
  Q61891263: 'museum of Asian art',
  Q740437: 'pinacotheca',
  Q957433: 'glyptotheque',
};

/**
 * Four entities no class rule reaches: each carries an `ART_CLASSES` member of its own — so rule
 * 1 below would otherwise admit every one of them outright — and is kept out by name instead,
 * for the reason given.
 */
export const EDITORIAL_OUT: Record<string, string> = {
  Q6373: 'British Museum — typed art museum on Wikidata; out by the strict-art boundary of 2026-08-05, returns with the archaeology import',
  Q313746: 'East Side Gallery — a stretch of the Berlin Wall that Wikidata types art museum; no structural signal separates it (OSM calls it tourism=gallery, it has no director and no museum-registry entry)',
  Q699943: 'MuseumsQuartier — a Vienna cultural quarter typed art museum; it swallowed the Leopold Museum under the fold rule',
  Q623578: 'National Library of Australia — a library typed art museum and history museum',
};

/**
 * A work counts as sculptural by the shape of its class label, not by equality: the pool carries
 * fresco, wall painting, drawing, painting series and more on one side, and statue, bust, relief,
 * cast, figurine, torso, stele and monument on the other.
 */
const SCULPTURAL = /sculpt|statue|bust|relief|cast|figurine|torso|stele|monument/i;
export const isSculptural = (type: string): boolean => SCULPTURAL.test(type);

/**
 * Rule 1: an art class admits outright, whatever else the venue is typed or holds — a palace
 * that is also an art museum (the Uffizi) or an archaeological museum that is also an art museum
 * (the Louvre) survives on the strength of the art class alone.
 *
 * Rule 2: without an art class, the painting share of what the venue actually holds decides.
 * This is what keeps the Hermitage — typed bare `museum`, holding 34 works of which 32 are
 * paintings — while dropping the Naturhistorisches Museum, whose only holdings are two Venus
 * figurines. A museum with no famous holding at all has nothing to say for itself on this axis.
 */
export function artVerdict(classes: string[], works: WorkFact[]): ArtResult {
  const artClass = classes.find((c) => ART_CLASSES[c]);
  if (artClass) {
    return { art: true, why: `art class: ${ART_CLASSES[artClass]}` };
  }

  if (!works.length) {
    return { art: false, why: 'no famous holding to judge by' };
  }
  const sculptures = works.filter((w) => w.sculptural).length;
  const paintings = works.length - sculptures;
  const why = `painting-share: ${paintings} painting(s) vs ${sculptures} sculptural work(s)`;
  return paintings >= sculptures ? { art: true, why } : { art: false, why };
}
