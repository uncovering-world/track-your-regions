/**
 * What the monuments-category entrance asks Wikidata of its candidates
 * (#2171): whether a candidate is itself a class — a type other items are
 * instances of, or a subclass of something — rather than one place. The
 * subset twin is `subset/classObjects.ts`, asked instead when the run reads it.
 */

import { extractQid, isQid } from '../wikidataUtils.js';
import { chunk, values, type SparqlFn } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import { subsetClassObjects } from '../subset/classObjects.js';

const BATCH = 100;

/** An item that is a class: how many items are its instances (`P31`), and whether it has a superclass (`P279`). */
export interface ClassObject {
  instances: number;
  subclass: boolean;
}

/** Each of `qids` that is a class; an item the answer does not name is not one. */
export async function fetchClassObjects(sparql: SparqlFn, qids: string[]): Promise<Map<string, ClassObject>> {
  const out = new Map<string, ClassObject>();
  for (const batch of chunk([...new Set(qids.filter(isQid))], BATCH)) {
    const answer = readsSubset(sparql) ? await subsetClassObjects(batch) : await liveClassObjects(sparql, batch);
    for (const [qid, found] of answer) out.set(qid, found);
  }
  return out;
}

async function liveClassObjects(sparql: SparqlFn, qids: string[]): Promise<Map<string, ClassObject>> {
  const rows = await sparql(`
    SELECT ?e (COUNT(DISTINCT ?x) AS ?instances) (COUNT(DISTINCT ?super) AS ?supers) WHERE {
      VALUES ?e { ${values(qids)} }
      { ?x wdt:P31 ?e } UNION { ?e wdt:P279 ?super }
    } GROUP BY ?e`, { kind: 'entities', label: `whether ${qids.length} items are classes` });
  const out = new Map<string, ClassObject>();
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    const instances = Number(row.instances?.value ?? 0);
    const subclass = Number(row.supers?.value ?? 0) > 0;
    if (isQid(qid) && (instances > 0 || subclass)) out.set(qid, { instances, subclass });
  }
  return out;
}
