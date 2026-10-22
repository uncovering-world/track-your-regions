/**
 * The two kinds one Public Art gather fills (#1807, ADR-0132): Public art —
 * what was made to be looked at — and Monuments & memorials — what was raised
 * to remember. One candidate may be both: the Bronze Horseman is a sculpture
 * and a monument to Peter the Great, and each kind's run offers it from the
 * same reading.
 *
 * Only what differs between the kinds is here: which classes admit, which
 * lift the building and cemetery vetoes, and the type a row is filed under.
 * What refuses outright — a church, a camp, a work inside a museum, a lake —
 * is the shared rule's (`publicArtTest.ts`).
 */

import {
  ARCH_CLASSES,
  COLUMN_CLASSES,
  COMMEMORATIVE_FORMS,
  HERITAGE_MONUMENT_CLASSES,
  OBELISK_CLASSES,
  STREET_ART_CLASSES,
  type PublicArtTrees,
} from './classes.js';

/** The types the two kinds file a row under, disjoint so a value names its kind (`experienceTypes.ts`). */
export type PublicArtType = 'sculpture' | 'fountain' | 'street-art';
export type MonumentType = 'memorial' | 'monument' | 'arch' | 'column' | 'obelisk';

/** What the rule reads of a candidate to decide its kind. */
export interface KindFacts {
  classes: string[];
  /** `P547`, whom or what the candidate commemorates. */
  commemorates: string[];
}

export interface KindRule {
  /** What a refusal says the candidate is not: "inside the Louvre: a work of a museum, not public art". */
  noun: string;
  /** The refusal of a candidate no class of the kind names. */
  noClass: string;
  /** What a candidate is when nothing of the kind answers a building's veto: "not an artwork, and typed: tower". */
  unanswered: string;
  /** Whether a class of the kind, or a fact, names the candidate. */
  admits(e: KindFacts, trees: PublicArtTrees): boolean;
  /** Whether the candidate's classes answer a building's or a cemetery's veto. */
  answersVeto(e: KindFacts, trees: PublicArtTrees): boolean;
  /**
   * Whether a memorial class lifts the cemetery's veto and a bare building's
   * (`MEMORIAL_LIFTS`): the Neue Wache is a guardhouse raised to remember,
   * and Montjuïc Castle a castle with a memorial in it.
   */
  memorialLifts: boolean;
  /** The type an admitted row is filed under. */
  type(e: KindFacts, trees: PublicArtTrees): PublicArtType | MonumentType;
}

const has = (classes: string[], of: ReadonlySet<string> | Record<string, string>): boolean =>
  classes.some((c) => (of instanceof Set ? of.has(c) : Object.hasOwn(of, c)));

/**
 * Public art: a sculpture, a statue, a fountain, a mural. A fountain before a
 * sculpture, since the Trevi Fountain is typed both and is visited as the
 * fountain; street art before either.
 */
export const PUBLIC_ART_RULE: KindRule = {
  noun: 'public art',
  noClass: 'no public-art class',
  unanswered: 'not an artwork',
  admits: (e, trees) => has(e.classes, trees.sculptural) || has(e.classes, trees.fountain),
  answersVeto: (e, trees) => has(e.classes, trees.artwork),
  memorialLifts: false,
  type: (e, trees) => {
    if (has(e.classes, STREET_ART_CLASSES)) return 'street-art';
    if (has(e.classes, trees.fountain)) return 'fountain';
    return 'sculpture';
  },
};

/**
 * Monuments & memorials: a memorial, a commemorative form — an arch, a
 * column, an obelisk, a stele — a monument in the heritage sense, or whatever
 * Wikidata says commemorates someone (`P547`): the Jefferson Memorial is
 * typed nothing but a National Memorial. A memorial lifts the cemetery veto
 * and a bare building's, since the Neue Wache is a guardhouse raised to
 * remember and Arlington a cemetery a traveller visits as a memorial.
 * The form names the type before the purpose: the Arc de Triomphe is an arch
 * and the Washington Monument an obelisk, whatever else they are.
 */
export const MONUMENTS_RULE: KindRule = {
  noun: 'a monument or memorial',
  noClass: 'no monument or memorial class',
  unanswered: 'not a memorial',
  admits: (e, trees) => has(e.classes, trees.commemorative)
    || has(e.classes, COMMEMORATIVE_FORMS)
    || has(e.classes, HERITAGE_MONUMENT_CLASSES)
    || e.commemorates.length > 0,
  answersVeto: (e, trees) => has(e.classes, trees.artwork),
  memorialLifts: true,
  type: (e, trees) => {
    if (has(e.classes, ARCH_CLASSES)) return 'arch';
    if (has(e.classes, COLUMN_CLASSES)) return 'column';
    if (has(e.classes, OBELISK_CLASSES)) return 'obelisk';
    if (has(e.classes, trees.commemorative)) return 'memorial';
    return 'monument';
  },
};
