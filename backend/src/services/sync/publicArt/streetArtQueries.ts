/**
 * What the street-art places' entrance and line ask Wikidata (#2035): the
 * items filed under a genre or typed by a class (#2055), whether a candidate has an Atlas Obscura entry
 * (`P7772`) and an end (`P576`), which of the excluded roots each of its
 * classes is a kind of, and what an admitted place holds. Each question has a twin in the subset
 * (`subset/streetArt.ts`), asked instead when the run reads it.
 */

import { extractQid, isQid } from '../wikidataUtils.js';
import { chunk, qidsOf, values, type SparqlFn } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import {
  subsetItemsOfClasses, subsetItemsOfGenres, subsetRootsOfClasses, subsetStreetArtHoldings, subsetStreetArtMarks,
} from '../subset/streetArt.js';

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

/** Every item typed by one of `classes` or a subclass of one (`P31/P279*`). */
export async function fetchItemsOfClasses(sparql: SparqlFn, classes: readonly string[]): Promise<string[]> {
  if (!classes.length) return [];
  if (readsSubset(sparql)) return subsetItemsOfClasses(classes);
  const rows = await sparql(
    `SELECT DISTINCT ?e WHERE { VALUES ?c { ${values([...classes])} } ?e wdt:P31/wdt:P279* ?c }`,
    { kind: 'pool', label: `items of ${classes.length} class(es)` },
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

/** One work a street-art place holds. */
export interface StreetArtHolding {
  place: string;
  work: string;
}

/**
 * What each of `places` holds by a standing statement (#2055): a part the
 * place names (`P527`), or a work that says it stands in the place (`P276`)
 * or is part of it (`P361`). Of the East Side Gallery's seven murals, the wall
 * names three as parts, five say they stand there and five that they are part
 * of it: no one statement names them all. Asked at no floor, since a mural is
 * written up in one or two languages and is still what the wall is visited for.
 */
export async function fetchStreetArtHoldings(sparql: SparqlFn, places: string[]): Promise<StreetArtHolding[]> {
  const out: StreetArtHolding[] = [];
  for (const batch of chunk(places.filter(isQid), BATCH)) {
    out.push(...(readsSubset(sparql) ? await subsetStreetArtHoldings(batch) : await liveStreetArtHoldings(sparql, batch)));
  }
  return out;
}

/** A statement of `property` from `?from` to `?to` that still stands: not deprecated, and with no end time. */
const standing = (from: string, property: string, to: string) => `${from} p:${property} ?st . ?st ps:${property} ${to} .
      ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?st pq:P582 ?ended }`;

async function liveStreetArtHoldings(sparql: SparqlFn, places: string[]): Promise<StreetArtHolding[]> {
  const rows = await sparql(`
    SELECT DISTINCT ?place ?work WHERE {
      VALUES ?place { ${values(places)} }
      { ${standing('?place', 'P527', '?work')} }
      UNION { ${standing('?work', 'P276', '?place')} }
      UNION { ${standing('?work', 'P361', '?place')} }
    }`, { kind: 'statements', label: `what ${places.length} street-art places hold` });
  const out: StreetArtHolding[] = [];
  for (const row of rows) {
    const place = extractQid(row.place?.value ?? '');
    const work = extractQid(row.work?.value ?? '');
    if (isQid(place) && isQid(work)) out.push({ place, work });
  }
  return out;
}
