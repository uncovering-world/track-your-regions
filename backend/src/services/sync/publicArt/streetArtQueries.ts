/**
 * What the street-art places' entrance and line ask Wikidata (#2035): the
 * items filed under a genre, whether a candidate has an Atlas Obscura entry
 * (`P7772`) and an end (`P576`), and which of the excluded roots each of its
 * classes is a kind of. Each question has a twin in the subset
 * (`subset/streetArt.ts`), asked instead when the run reads it.
 */

import { extractQid, isQid } from '../wikidataUtils.js';
import { chunk, qidsOf, values, type SparqlFn } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import { subsetItemsOfGenres, subsetRootsOfClasses, subsetStreetArtMarks } from '../subset/streetArt.js';

const BATCH = 200;

/** What a candidate's fame and standing are read from beside its readers and its guides. */
export interface StreetArtMarks {
  /** Whether Atlas Obscura has an entry for it (`P7772`). */
  atlasObscura: boolean;
  /** Whether Wikidata says it was demolished or dissolved (`P576`). */
  ended: boolean;
}

/** Every item filed under one of `genres` (`P136`). */
export async function fetchItemsOfGenres(sparql: SparqlFn, genres: readonly string[]): Promise<string[]> {
  if (!genres.length) return [];
  if (readsSubset(sparql)) return subsetItemsOfGenres(genres);
  const rows = await sparql(
    `SELECT DISTINCT ?e WHERE { VALUES ?g { ${values([...genres])} } ?e wdt:P136 ?g }`,
    { kind: 'pool', label: `items filed under ${genres.length} genre(s)` },
  );
  return qidsOf(rows, 'e');
}

/** Whether each item has an Atlas Obscura entry and an end; an item the answer does not name has neither. */
export async function fetchStreetArtMarks(sparql: SparqlFn, qids: string[]): Promise<Map<string, StreetArtMarks>> {
  const out = new Map<string, StreetArtMarks>();
  for (const batch of chunk(qids.filter(isQid), BATCH)) {
    const answer = readsSubset(sparql) ? await subsetStreetArtMarks(batch) : await liveStreetArtMarks(sparql, batch);
    for (const [qid, marks] of answer) out.set(qid, marks);
  }
  return out;
}

async function liveStreetArtMarks(sparql: SparqlFn, qids: string[]): Promise<Map<string, StreetArtMarks>> {
  const out = new Map<string, StreetArtMarks>();
  const rows = await sparql(`
    SELECT ?e ?ao ?end WHERE {
      VALUES ?e { ${values(qids)} }
      { ?e wdt:P7772 ?ao } UNION { ?e wdt:P576 ?end }
    }`, { kind: 'entities', label: `Atlas Obscura entries and ends of ${qids.length} items` });
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    if (!isQid(qid)) continue;
    const marks = out.get(qid) ?? { atlasObscura: false, ended: false };
    if (row.ao) marks.atlasObscura = true;
    if (row.end) marks.ended = true;
    out.set(qid, marks);
  }
  return out;
}

/** Which of `roots` each class is a kind of (`P279*`), a root counting as a kind of itself; a class of none has no entry. */
export async function fetchRootsOfClasses(
  sparql: SparqlFn, classes: string[], roots: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const batch of chunk([...new Set(classes.filter(isQid))], BATCH)) {
    const answer = readsSubset(sparql)
      ? await subsetRootsOfClasses(batch, roots)
      : await liveRootsOfClasses(sparql, batch, roots);
    for (const [cls, found] of answer) out.set(cls, found);
  }
  return out;
}

async function liveRootsOfClasses(sparql: SparqlFn, classes: string[], roots: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!classes.length || !roots.length) return out;
  const rows = await sparql(`
    SELECT DISTINCT ?c ?root WHERE {
      VALUES ?c { ${values(classes)} }
      VALUES ?root { ${values([...roots])} }
      ?c wdt:P279* ?root
    }`, { kind: 'classes', label: `which of ${roots.length} roots ${classes.length} classes are kinds of` });
  for (const row of rows) {
    const cls = extractQid(row.c?.value ?? '');
    const root = extractQid(row.root?.value ?? '');
    if (isQid(cls) && isQid(root)) out.set(cls, [...(out.get(cls) ?? []), root]);
  }
  return out;
}
