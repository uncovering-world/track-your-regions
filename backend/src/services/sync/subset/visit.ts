/**
 * The visit witnesses' Wikidata question read from the local subset (#1768):
 * the twin of `fetchVisitFacts` (`visit/visitFacts.ts`), with `wdt:`'s
 * reading of each statement (`bestStatements`).
 */

import { FORMAL_PROPERTIES, type VisitFacts } from '../visit/witnesses.js';
import { entitiesOf } from './entities.js';
import { bestStatements, isNoValue } from './values.js';

export async function subsetVisitFacts(qids: string[]): Promise<Map<string, VisitFacts>> {
  const out = new Map<string, VisitFacts>(qids.map((qid) => [qid, { formal: false, commonsCategory: null }]));
  for (const [id, { entity }] of await entitiesOf(qids)) {
    const { claims } = entity;
    const formal = FORMAL_PROPERTIES.some((property) => bestStatements(claims[property]).some((statement) => !isNoValue(statement.value)));
    const category = bestStatements(claims.P373).map((statement) => statement.value).find((value) => typeof value === 'string');
    out.set(id, { formal, commonsCategory: typeof category === 'string' ? category : null });
  }
  return out;
}
