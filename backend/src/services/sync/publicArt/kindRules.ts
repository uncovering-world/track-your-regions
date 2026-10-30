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
  BIBLICAL_FIGURE_CLASS,
  HERITAGE_MONUMENT_CLASSES,
  NATION_CLASSES,
  OBELISK_CLASSES,
  PERSON_CLASS,
  PUBLIC_ART_GENRE,
  PUBLIC_CLOCK_CLASSES,
  STREET_ART_CLASSES,
  type PublicArtTrees,
} from './classes.js';
import type { SubjectFacts } from './subjects.js';

/** The types the two kinds file a row under, disjoint so a value names its kind (`experienceTypes.ts`). */
const PUBLIC_ART_TYPES = ['sculpture', 'fountain', 'street-art', 'clock'] as const;
const MONUMENT_TYPES = ['memorial', 'monument', 'arch', 'column', 'obelisk'] as const;
export type PublicArtType = (typeof PUBLIC_ART_TYPES)[number];
export type MonumentType = (typeof MONUMENT_TYPES)[number];

/** What the rule reads of a candidate to decide its kind. */
export interface KindFacts {
  classes: string[];
  /** `P547`, whom or what the candidate commemorates. */
  commemorates: string[];
  /** `P136`, the genre the candidate is filed under. */
  genres: string[];
  /** What each item it depicts (`P180`) is, for the ones that were read. */
  subjects: SubjectFacts[];
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
   * Whether a memorial — a memorial class, or a `P547` statement — lifts the
   * museum's veto, the cemetery's and a bare building's (`MEMORIAL_LIFTS`),
   * and a commemorative form the burial kill (`BURIAL_CLASSES`): the Neue
   * Wache is a guardhouse raised to remember, Montjuïc Castle a castle with a
   * memorial in it, and the Monumento a la Revolución a triumphal arch with a
   * mausoleum in it.
   */
  memorialLifts: boolean;
  /** The type an admitted row is filed under. */
  type(e: KindFacts, trees: PublicArtTrees): PublicArtType | MonumentType;
  /** Every type `type` may answer: a stored type outside it is no reader's fact to keep (#1807). */
  types: readonly string[];
}

const has = (classes: string[], of: ReadonlySet<string> | Record<string, string>): boolean =>
  classes.some((c) => (of instanceof Set ? of.has(c) : Object.hasOwn(of, c)));

/** Whether a depicted item is someone a statue is raised to: a person no one worships, or a nation (`NATION_CLASSES`). */
const raisedTo = (subject: SubjectFacts): boolean =>
  (subject.classes.includes(PERSON_CLASS) && !subject.worshipped && !subject.classes.includes(BIBLICAL_FIGURE_CLASS))
  || has(subject.classes, NATION_CLASSES);

/** What a candidate's form is said to be: its classes, and the genre it is filed under. */
export const formsOf = (e: KindFacts): string[] => [...e.classes, ...e.genres];

/**
 * Public art: a sculpture, a statue, a fountain, a mural, a public clock with
 * a show (`PUBLIC_CLOCK_CLASSES`). A fountain before a sculpture, since the
 * Trevi Fountain is typed both and is visited as the fountain; street art
 * before either. A public clock is filed as a clock, before anything else it
 * is: the Zytglogge is a gate tower too (#2140).
 */
export const PUBLIC_ART_RULE: KindRule = {
  noun: 'public art',
  noClass: 'no public-art class',
  unanswered: 'not an artwork',
  admits: (e, trees) => has(e.classes, trees.sculptural) || has(e.classes, trees.fountain)
    || has(e.classes, PUBLIC_CLOCK_CLASSES),
  answersVeto: (e, trees) => has(e.classes, trees.artwork),
  memorialLifts: false,
  types: PUBLIC_ART_TYPES,
  type: (e, trees) => {
    if (has(e.classes, PUBLIC_CLOCK_CLASSES)) return 'clock';
    if (has(e.classes, STREET_ART_CLASSES)) return 'street-art';
    if (has(e.classes, trees.fountain)) return 'fountain';
    return 'sculpture';
  },
};

/**
 * Monuments & memorials: a memorial, a commemorative form — an arch, a
 * column, an obelisk, a stele — a monument in the heritage sense, or whatever
 * Wikidata says commemorates someone (`P547`): the Jefferson Memorial is
 * typed nothing but a National Memorial. A form is read from the genre
 * (`P136`) as well as the class: the Bronze Horseman is filed as an
 * equestrian statue. A memorial lifts the cemetery veto and a bare
 * building's, since the Neue Wache is a guardhouse raised to remember and
 * Arlington a cemetery a traveller visits as a memorial; a work filed under
 * public art (`PUBLIC_ART_GENRE`) answers them as an artwork class does. A
 * statue raised to someone is a monument to them: the Statue of Unity depicts
 * Sardar Vallabhbhai Patel, Mother Ukraine depicts Ukraine (`raisedTo`) — a
 * statue, not a painting: the Fraternal Kiss depicts Brezhnev and Honecker.
 * The form names the type before the purpose: the Arc de Triomphe is an arch
 * and the Washington Monument an obelisk, whatever else they are.
 */
export const MONUMENTS_RULE: KindRule = {
  noun: 'a monument or memorial',
  noClass: 'no monument or memorial class',
  unanswered: 'not a memorial',
  admits: (e, trees) => has(e.classes, trees.commemorative)
    || has(formsOf(e), COMMEMORATIVE_FORMS)
    || has(e.classes, HERITAGE_MONUMENT_CLASSES)
    || e.commemorates.length > 0
    || (has(e.classes, trees.sculptural) && !has(e.classes, STREET_ART_CLASSES) && e.subjects.some(raisedTo)),
  answersVeto: (e, trees) => has(formsOf(e), trees.artwork) || e.genres.includes(PUBLIC_ART_GENRE),
  memorialLifts: true,
  types: MONUMENT_TYPES,
  type: (e, trees) => {
    const forms = formsOf(e);
    if (has(forms, ARCH_CLASSES)) return 'arch';
    if (has(forms, COLUMN_CLASSES)) return 'column';
    if (has(forms, OBELISK_CLASSES)) return 'obelisk';
    if (has(e.classes, trees.commemorative)) return 'memorial';
    return 'monument';
  },
};
