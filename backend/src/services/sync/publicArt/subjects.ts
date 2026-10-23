/**
 * What a candidate depicts, as Monuments & memorials asks it (#1832): a
 * statue raised to a person or a nation is a monument to them. The Statue of
 * Unity depicts Sardar Vallabhbhai Patel and the Mother Ukraine Monument
 * depicts Ukraine; neither carries a class or a statement the kind reads
 * otherwise.
 *
 * Read through the run's door. A subset built before its scope kept a seed's
 * depicted items (`SUBJECT_PROPERTIES`, ADR-0105) lacks most people — Patel
 * has no coordinate — so on such a copy the subjects it lacks are asked of
 * the live service, a bounded question about the few hundred subjects of one
 * gather, until a subset built under the new scope is in place (ADR-0101: a
 * bulk read comes from the dump, and this is not one).
 */

import { delay, extractQid, isQid, SPARQL_DELAY_MS } from '../wikidataUtils.js';
import { chunk, unique, values, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import { subsetSubjectFacts } from '../subset/publicArt.js';
import { latestSubsetCounts } from '../../dumps/wikidata/subsetTables.js';
import { keepsSubjects } from '../../dumps/wikidata/buildRules.js';

const SUBJECT_BATCH = 50;

/** What a depicted item is: its classes, and whether Wikidata says anyone worships it (`P1049`). */
export interface SubjectFacts {
  classes: string[];
  worshipped: boolean;
}

/**
 * A gather's runner, with the live service a subset run's bridge asks, when
 * it has one, and whether the run was cancelled, which no bridge swallows.
 */
export type SubjectRunner = QueryRunner & { live?: () => SparqlFn; cancelled?: () => boolean };

export async function fetchSubjectFacts(sparql: SparqlFn, qids: string[]): Promise<Map<string, SubjectFacts>> {
  if (readsSubset(sparql)) return subsetSubjectFacts(qids);
  const out = new Map<string, SubjectFacts>();
  if (!qids.length) return out;
  const rows = await sparql(`
    SELECT ?s ?cls ?worship WHERE {
      VALUES ?s { ${values(qids)} }
      { ?s wdt:P31 ?cls } UNION { ?s wdt:P1049 ?worship }
    }`, { kind: 'entities', label: `what ${qids.length} depicted subjects are` });
  for (const row of rows) {
    const qid = extractQid(row.s?.value ?? '');
    if (!isQid(qid)) continue;
    const subject = out.get(qid) ?? { classes: [], worshipped: false };
    const cls = extractQid(row.cls?.value ?? '');
    if (isQid(cls)) subject.classes.push(cls);
    if (row.worship) subject.worshipped = true;
    out.set(qid, subject);
  }
  return out;
}

async function ask(run: QueryRunner, sparql: SparqlFn, qids: string[], into: Map<string, SubjectFacts>, what: string) {
  const batches = chunk(qids, SUBJECT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what the candidates depict${what} (batch ${i + 1}/${batches.length})...`);
    await run.step();
    // A subset run's step spares nothing, and the bridge asks the query service.
    if (sparql !== run.sparql) await delay(SPARQL_DELAY_MS);
    for (const [qid, subject] of await fetchSubjectFacts(sparql, batches[i])) into.set(qid, subject);
  }
}

/** What each depicted item is, read through the run's door, and on an older subset its gaps from the live service. */
export async function loadSubjects(run: SubjectRunner, depicted: string[]): Promise<Map<string, SubjectFacts>> {
  const subjects = new Map<string, SubjectFacts>();
  const asked = unique(depicted);
  await ask(run, run.sparql, asked, subjects, '');
  if (!readsSubset(run.sparql) || !run.live) return subjects;
  if (keepsSubjects((await latestSubsetCounts())?.rules ?? null)) return subjects;
  const missing = asked.filter((qid) => !subjects.has(qid));
  if (!missing.length) return subjects;
  console.log(`[Landmark Sync] The subset in place keeps no depicted subjects: asking the live service about ${missing.length}`);
  try {
    await ask(run, run.live(), missing, subjects, ', of the live service');
  } catch (error) {
    // The bridge is best-effort: a run on the subset never needed the live
    // service before it, and a subject left unread leaves its statue where it
    // was, in Public art alone. A cancel is the run's, and goes on up.
    if (run.cancelled?.()) throw error;
    const unread = missing.filter((qid) => !subjects.has(qid)).length;
    console.warn(`[Landmark Sync] The live service did not answer (${(error as Error).message}): ${unread} depicted subjects left unread`);
  }
  return subjects;
}
