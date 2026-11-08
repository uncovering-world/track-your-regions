/**
 * Whom or what a place commemorates, as the local Wikidata subset answers it
 * (#2144): the twins of `fetchSubjectClaims` and `fetchSubjectKinds` in
 * `places/commemorates.ts`.
 *
 * `P547`, `P921`, `P138` and `P180` are read off the kept entity's claims,
 * which `wikidata_claims` does not hold (it keeps place properties only). A
 * value's statements are read in the entity's order, where the live answer has
 * none and is sorted by id. A value the subset did not keep is neither a human
 * nor an event here, where the live service could say it is one; its label is
 * still read, from the labels ring.
 */

import { entitiesOf, termsOf } from './entities.js';
import { bestStatements, itemsOf } from './values.js';
import type { SubjectClaims, SubjectKind } from '../places/commemorates.js';

/** Wikidata's "human" (Q5). */
const HUMAN = 'Q5';

/** What makes a value an event: it happened at a time (`P585`), or started (`P580`) or ended (`P582`). */
const EVENT_TIMES = ['P585', 'P580', 'P582'] as const;

/** The best-rank items each place names as whom it commemorates, its main subject, its namesake and what it depicts. */
export async function subsetSubjectClaims(ids: string[]): Promise<Map<string, SubjectClaims>> {
  const out = new Map<string, SubjectClaims>();
  for (const [id, { entity }] of await entitiesOf(ids)) {
    const { claims } = entity;
    out.set(id, {
      commemorates: itemsOf(bestStatements(claims.P547)),
      mainSubjects: itemsOf(bestStatements(claims.P921)),
      namedAfter: itemsOf(bestStatements(claims.P138)),
      depicts: itemsOf(bestStatements(claims.P180)),
    });
  }
  return out;
}

/** Each value's label, and whether it is a human or an event; a value with no label in any language has no entry. */
export async function subsetSubjectKinds(ids: string[]): Promise<Map<string, SubjectKind>> {
  const [kept, terms] = await Promise.all([entitiesOf(ids), termsOf(ids)]);
  const out = new Map<string, SubjectKind>();
  for (const id of ids) {
    const label = terms.get(id)?.label;
    if (!label) continue;
    const claims = kept.get(id)?.entity.claims ?? {};
    out.set(id, {
      label,
      human: itemsOf(bestStatements(claims.P31)).includes(HUMAN),
      event: EVENT_TIMES.some(property => bestStatements(claims[property]).length > 0),
    });
  }
  return out;
}
