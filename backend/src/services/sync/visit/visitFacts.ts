/**
 * What Wikidata says of a place that bears on whether visitors go there
 * (#1768): the formal witness, and the Commons category the photographs
 * witness is read from. Asked of the live service or of the local subset,
 * whichever the run reads (`readsSubset`), with the same answer either way.
 */

import { readsSubset } from '../subset/reader.js';
import { subsetVisitFacts } from '../subset/visit.js';
import { values, type SparqlFn } from '../wikidataQueries.js';
import { FORMAL_PROPERTIES, type VisitFacts } from './witnesses.js';
import { extractQid, isQid } from '../wikidataUtils.js';

/** What Wikidata says of each of `qids`; an item it says nothing of answers no formal witness and no category. */
export async function fetchVisitFacts(sparql: SparqlFn, qids: readonly string[]): Promise<Map<string, VisitFacts>> {
  const asked = qids.filter(isQid);
  if (readsSubset(sparql)) return subsetVisitFacts(asked);
  const out = new Map<string, VisitFacts>(asked.map((qid) => [qid, { formal: false, commonsCategory: null }]));
  if (asked.length === 0) return out;
  const formal = FORMAL_PROPERTIES.map((property) => `wdt:${property}`).join('|');
  const rows = await sparql(`
    SELECT ?e ?formal ?category WHERE {
      VALUES ?e { ${values(asked)} }
      { ?e ${formal} ?formal } UNION { ?e wdt:P373 ?category }
    }`, { kind: 'statements', label: `visit witnesses of ${asked.length} places` });
  for (const row of rows) {
    const facts = out.get(extractQid(row.e?.value ?? ''));
    if (!facts) continue;
    if (row.formal?.value) facts.formal = true;
    if (row.category?.value && !facts.commonsCategory) facts.commonsCategory = row.category.value;
  }
  return out;
}
