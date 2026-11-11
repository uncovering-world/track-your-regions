/**
 * Whom or what a place commemorates, as the local Wikidata subset answers it
 * (#2144): the twins of `fetchSubjectClaims` and `fetchSubjectKinds` in
 * `places/commemorates.ts`.
 *
 * `P547`, `P921`, `P138`, `P180` and `P793` are read off the kept entity's claims,
 * which `wikidata_claims` does not hold (it keeps place properties only). A
 * value's statements are read in the entity's order, where the live answer has
 * none and is sorted by id. A value the subset did not keep is neither a human
 * nor an event here, where the live service could say it is one; its label is
 * still read, from the labels ring.
 */

import { entitiesOf, termsOf } from './entities.js';
import { bestStatements, itemsOf } from './values.js';
import { subsetClassTree } from './kit.js';
import { CLASSICAL_MYTHOLOGY_CLASSES } from '../publicArt/classes.js';
import { pool } from '../../../db/index.js';
import type { SubjectClaims, SubjectKind } from '../places/commemorates.js';
import type { Span } from '../places/warNarrowing.js';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';

/** Wikidata's "deity" (Q178885), the root of the classes a holy figure is an instance of (#2404). */
export const DEITY = 'Q178885';

/** Wikidata's "war" (Q198): a reading naming one is narrowed by the place's lead (#2404). */
export const WAR = 'Q198';

/** Wikidata's "occurrence" (Q1190554), the root of the classes of what a war is narrowed to: Westerplatte, a peninsula with dates, is none (#2412). */
export const OCCURRENCE = 'Q1190554';

/**
 * The roots of the classes a named figure of fiction, myth or legend is an
 * instance of, or a personification: what a work shows that is no person and
 * no holy figure, and still someone a card names (#2436). Don Quixote and
 * Sancho Panza are characters (Q95074), Medusa a mythical character
 * (Q4271324), Silvius Brabo a legendary figure (Q13002315), Germania and The
 * Motherland personifications (Q207174). A horse, a lion or a sword is none.
 */
export const FIGURE_CLASSES = ['Q95074', 'Q4271324', 'Q13002315', 'Q207174'] as const;

/** Wikidata's "human" (Q5). */
const HUMAN = 'Q5';

/** What makes a value an event: it happened at a time (`P585`), or started (`P580`) or ended (`P582`). */
const EVENT_TIMES = ['P585', 'P580', 'P582'] as const;

/** The best-rank items each place names as whom it commemorates, its main subject, its namesake, what it depicts and its significant events. */
export async function subsetSubjectClaims(ids: string[]): Promise<Map<string, SubjectClaims>> {
  const out = new Map<string, SubjectClaims>();
  for (const [id, { entity }] of await entitiesOf(ids)) {
    const { claims } = entity;
    out.set(id, {
      commemorates: itemsOf(bestStatements(claims.P547)),
      mainSubjects: itemsOf(bestStatements(claims.P921)),
      namedAfter: itemsOf(bestStatements(claims.P138)),
      depicts: itemsOf(bestStatements(claims.P180)),
      significantEvents: itemsOf(bestStatements(claims.P793)),
    });
  }
  return out;
}

/**
 * Each value's label, whether it is a human or an event, and whether it is a
 * holy figure (an instance of a class under deity, or canonised, `P411`); a
 * value with no label in any language has no entry.
 */
export async function subsetSubjectKinds(ids: string[]): Promise<Map<string, SubjectKind>> {
  const [kept, terms, deities, wars] = await Promise.all([entitiesOf(ids), termsOf(ids), subsetClassTree(DEITY), subsetClassTree(WAR)]);
  const valueClasses = [...kept.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P31)));
  const [occurrences, figures] = await Promise.all([classesUnder(valueClasses, [OCCURRENCE]), classesUnder(valueClasses, FIGURE_CLASSES)]);
  const out = new Map<string, SubjectKind>();
  for (const id of ids) {
    const label = terms.get(id)?.label;
    if (!label) continue;
    const claims = kept.get(id)?.entity.claims ?? {};
    const classes = itemsOf(bestStatements(claims.P31));
    // A deity at any rank but deprecated: Jesus Christ's deity class is
    // outranked by his preferred human one, and he is both.
    const everyClass = itemsOf((claims.P31 ?? []).filter(statement => statement.rank !== 'deprecated'));
    out.set(id, {
      label,
      human: classes.includes(HUMAN),
      event: EVENT_TIMES.some(property => bestStatements(claims[property]).length > 0),
      holy: everyClass.some(cls => deities.has(cls)) || bestStatements(claims.P411).length > 0,
      classical: classes.some(cls => Object.hasOwn(CLASSICAL_MYTHOLOGY_CLASSES, cls)),
      war: classes.some(cls => wars.has(cls)),
      occurrence: classes.some(cls => occurrences.has(cls)),
      figure: classes.some(cls => figures.has(cls)),
      span: spanOf(timeOf(claims.P580) ?? timeOf(claims.P585), timeOf(claims.P582) ?? timeOf(claims.P585)),
    });
  }
  return out;
}

/**
 * Which of the classes are one of the roots or under one, through the
 * subset's class closure: asked of the few classes the subjects carry, where
 * the whole tree under occurrence holds hundreds of thousands of classes.
 */
async function classesUnder(classes: string[], roots: readonly string[]): Promise<Set<string>> {
  if (!classes.length) return new Set();
  const result = await pool.query<{ class: string }>(
    'SELECT DISTINCT class FROM wikidata_class_closure WHERE class = ANY($1::text[]) AND ancestor = ANY($2::text[])',
    [[...new Set(classes)], [...roots]],
  );
  return new Set([...classes.filter(cls => roots.includes(cls)), ...result.rows.map(row => row.class)]);
}

/** A Wikidata time (`+1945-04-16T00:00:00Z`) as a sortable `±YYYYMMDD`, or null for none. */
function dayOf(time: string | undefined): number | null {
  const match = time ? /^([+-]?)(\d+)-(\d\d)-(\d\d)/.exec(time) : null;
  if (!match) return null;
  const value = Number(match[2]) * 10000 + Number(match[3]) * 100 + Number(match[4]);
  return match[1] === '-' ? -value : value;
}

/** A span from two Wikidata times, or null where either end is unknown. */
export function spanOf(from: string | undefined, to: string | undefined): Span | null {
  const [start, end] = [dayOf(from), dayOf(to)];
  return start === null || end === null ? null : { from: start, to: end };
}

/** The time of a statement's best value, as Wikidata writes it. */
function timeOf(statements: CompactStatement[] | undefined): string | undefined {
  const value = bestStatements(statements)[0]?.value as { time?: unknown } | undefined;
  return typeof value?.time === 'string' ? value.time : undefined;
}
