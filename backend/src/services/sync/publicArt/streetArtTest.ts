/**
 * Whether a candidate the street-art entrance named is a street-art place
 * (#2035): a wall, a lane, a tunnel or a district a traveller goes to for the
 * art painted on it — the Lennon Wall in Prague, Hosier Lane in Melbourne,
 * Beco do Batman in São Paulo. Public art holds it as it holds a sculpture.
 *
 * Almost no class names such a place: the Lennon Wall is typed a wall, Hosier
 * Lane a road, the Freedom Tunnel a railway tunnel. So the entrance is what the
 * place is filed under — an English Wikipedia category of street art or
 * graffiti, or the genre street art or graffiti (`P136`) — and the one class
 * that does name one, a wall of graffiti paintings (#2055), which is all that
 * says the East Side Gallery is street art: Wikidata types it an art museum,
 * and no category or genre files it. The line is fame read three
 * ways at once, since a lane is read in few languages: an Atlas Obscura entry
 * (`P7772`), a Wikivoyage guide naming it, and a year's readers. A newcomer
 * needs two of the three, a place the source holds keeps its place on one.
 *
 * What it is comes after the line, so a category's long tail of artists'
 * subjects and festivals is never refused one by one onto the run's changeset:
 * a church, a palace, a settlement or a single painting filed under a graffiti
 * category is a place or a work of another kind, and the refusal names it.
 *
 * Pure: every fact is handed in.
 */

import { BURIAL_CLASSES, KILL_CLASSES, type PublicArtTrees } from './classes.js';
import type { PublicArtType } from './kindRules.js';

/** The genres a street-art place is filed under (`P136`): street art and graffiti. */
export const STREET_ART_GENRES = ['Q17516', 'Q17514'] as const;

/**
 * The classes a street-art place is typed by (`P31`, through the class tree):
 * a wall of graffiti paintings, `Hall of Fame` in Wikidata's English label.
 * Of the items typed so, the East Side Gallery is the one the line passed,
 * measured on the subset on 2026-10-26: the others are halls of fame few read
 * about.
 */
export const GRAFFITI_WALL_CLASSES = ['Q1541532'] as const;

/**
 * The English Wikipedia categories the entrance reads: a title naming street
 * art, graffiti or urban art as a word of its own, read over the title as the
 * dump writes it (underscores for spaces), case aside.
 */
export const STREET_ART_CATEGORY = '(^|_)(street_art|streetart|graffiti|urban_art)(_|$)';

/**
 * The categories of those that file people, works and media rather than
 * places: `Street artists from Brazil`, `Graffiti and unauthorised signage`
 * stays — the Lennon Wall and Beco do Batman are filed there.
 */
export const NOT_A_PLACE_CATEGORY = '(artists|crews|stubs|articles|games|media|video|images?$|people|archaeology|organizations'
  + '|festivals|works_by|books|films|albums|songs|writers|painters|muralists|fresco|wikipedia|wikiproject|templates|^images)';

/**
 * The classes a candidate the entrance named is refused by, with what it is:
 * a place of another kind, or a work rather than a place. Read through the
 * class tree, so a commune is a human settlement and a cathedral a structure
 * of worship. A museum and a castle are not here: the East Side Gallery is
 * typed an art museum, and a castle wall painted over is still a wall.
 */
export const NOT_A_STREET_ART_PLACE: Readonly<Record<string, string>> = {
  Q1370598: 'a structure of worship',
  Q16560: 'a palace',
  Q35509: 'a cave',
  Q486972: 'a human settlement',
  Q381885: 'a tomb',
  Q839954: 'an archaeological site',
  Q5: 'a person',
  Q3305213: 'a painting',
  Q219423: 'a mural',
  Q860861: 'a sculpture',
  Q4989906: 'a monument',
  Q1248784: 'an airport',
  Q3918: 'a university',
  Q3914: 'a school',
  Q16917: 'a hospital',
  Q27686: 'a hotel',
  Q2385804: 'an educational institution',
};

/** A year's readers that count as a mark of fame. */
export const READERS_MARK = 10_000;
/** The marks a newcomer enters with. */
export const ENTER_MARKS = 2;
/** The marks a place the source holds keeps its place on. */
export const STAY_MARKS = 1;

/** What the rule reads of one candidate. */
export interface StreetArtFacts {
  qid: string;
  /** Every `P31` the entity carries. */
  classes: string[];
  /** Which of `NOT_A_STREET_ART_PLACE` each of its classes is a kind of. */
  excludedRoots: string[];
  /** Whether Atlas Obscura has an entry for it (`P7772`). */
  atlasObscura: boolean;
  /** Whether a Wikivoyage guide names it. */
  guided: boolean;
  /** A year's readers; null when no year can be read. */
  readers: number | null;
  /** Whether Wikidata says it was demolished or dissolved (`P576`). */
  ended: boolean;
  /** Whether the source holds it as admitted before the run. */
  admitted: boolean;
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type StreetArtResult =
  | { pass: true; type: Extract<PublicArtType, 'street-art'> }
  /** Not refused, and not admitted either: a newcomer below the line, which the run never names. */
  | { pass: false; quiet: true }
  | { pass: false; quiet?: false; reason: string };

/** The marks a candidate carries, in words, for a refusal to name. */
function marksOf(e: StreetArtFacts): string[] {
  return [
    ...(e.atlasObscura ? ['an Atlas Obscura entry'] : []),
    ...(e.guided ? ['a Wikivoyage guide'] : []),
    ...(e.readers !== null && e.readers >= READERS_MARK ? [`${e.readers.toLocaleString('en')} readers a year`] : []),
  ];
}

/** What a candidate is, when that is a place or a work of another kind; null when it is not. */
function otherKind(e: StreetArtFacts, trees: PublicArtTrees): string | null {
  if (e.classes.some((c) => trees.worship.has(c))) return 'a place of worship';
  if (e.classes.some((c) => trees.lost.has(c))) return 'a lost or destroyed work';
  const killed = e.classes.map((c) => KILL_CLASSES[c] ?? BURIAL_CLASSES[c]).find(Boolean);
  if (killed) return `a ${killed}`;
  const root = e.excludedRoots.find((qid) => NOT_A_STREET_ART_PLACE[qid]);
  return root ? NOT_A_STREET_ART_PLACE[root] : null;
}

/**
 * Whether a candidate the entrance named is a street-art place, and why not.
 *
 * Fame first: a newcomer below the line is quietly out, so a category's tail
 * reaches no changeset. Then what it is, whether it still stands, and whether
 * there is anywhere to stand. Readers that cannot be read admit nothing new,
 * and keep a held place on its other marks, as the guided line does.
 */
export function streetArtVerdict(e: StreetArtFacts, trees: PublicArtTrees): StreetArtResult {
  const marks = marksOf(e);
  if (!e.admitted && (e.readers === null || marks.length < ENTER_MARKS)) return { pass: false, quiet: true };

  const kind = otherKind(e, trees);
  if (kind) return { pass: false, reason: `${kind}: not a street-art place` };
  if (e.ended) return { pass: false, reason: 'demolished or dissolved (P576): nothing to stand in front of' };
  if (e.lat === null || e.lon === null) return { pass: false, reason: 'no coordinate (P625): nowhere to stand' };
  if (!e.onEarth) return { pass: false, reason: 'not on Earth: its coordinate (P625) is on another globe' };

  if (e.admitted && marks.length < STAY_MARKS && e.readers !== null) {
    return {
      pass: false,
      reason: `no Atlas Obscura entry, no Wikivoyage guide and ${e.readers.toLocaleString('en')} readers a year: `
        + `below the street-art line (${ENTER_MARKS} of those to enter, with ${READERS_MARK.toLocaleString('en')} `
        + `readers a year; ${STAY_MARKS} to stay)`,
    };
  }
  return { pass: true, type: 'street-art' };
}
