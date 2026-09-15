/**
 * The two questions the venue-side read sends (#890, `venueSide.ts`): what a
 * batch of admitted venues holds, and what a batch of objects is — asked by id,
 * because no class question named them.
 *
 * Kept apart from `queries.ts` for the reason the development guide gives: that
 * file is every question the works pool sends and is already at the length
 * anybody reads at once, and these two are a different road into the same
 * pool. What they answer is parsed by the pool's own rule (`parsePool`), so an
 * object that arrives from the venue's side says the same things about itself
 * as one a class pool answered with.
 *
 * Both shapes were run against the live endpoint on 2026-09-15 over the
 * development catalogue's admitted venues, and the holdings question is the
 * one that had to be measured into shape. It is light on purpose — five
 * columns and no OPTIONAL — because the first shape tried, one question
 * carrying the object's classes, discovery place and inception beside the
 * label service, answered 502 and 504 for a batch of twenty venues holding the
 * Louvre. And it is written **venue-first under Blazegraph's `optimizer
 * "None"`**, the way the banded pool is (ADR-0030 decision 8): left to the
 * planner, or written work-first, the same question timed out for *one* venue
 * (65 s, 504), because the join started at `?w p:P195 ?st` — every collection
 * statement on Wikidata — instead of at the ten venues. Fixed to start at
 * `?st ps:P195 ?venue`, ten venues answer in 4 s and fifty of the archaeology
 * kind's museums — the Louvre and the Hermitage among them — in 12 s with 683
 * rows.
 */

import { extractQid, isQid } from '../wikidataUtils.js';
import { failIfTruncated, HINT_PREFIX, values, type SparqlFn } from '../wikidataQueries.js';
import { parsePool, POOL_DETAILS, type PoolWork } from './queries.js';

/** One current statement of a venue's: this object is in its collection (`P195`), or stands in it (`P276`). */
export interface VenueHolding {
  work: string;
  venue: string;
  property: 'P195' | 'P276';
  sitelinks: number;
}

/**
 * No batch of venues has ever held this many objects at the floor; one that
 * does stops the run, for the reason a truncated pool does (`failIfTruncated`):
 * a short answer read as whole would leave objects unread this run and, once
 * they are placed, withdraw them on the next short one.
 */
export const HOLDINGS_LIMIT = 10000;

/**
 * The statements of one property naming a venue of the batch that still hold:
 * carrying no end time. The rank is read out rather than filtered here, and a
 * deprecated statement is dropped by the parser, exactly as `statementBranch`
 * in `queries.ts` reads a work's own statements — one rule for one fact.
 *
 * The venue comes first and the order is what the planner is told to keep
 * (the file header says what happens otherwise): the statement is found from
 * the venue it names, then the work it belongs to.
 */
function holdingBranch(property: 'P195' | 'P276'): string {
  return `{
      ?st ps:${property} ?venue .
      ?w p:${property} ?st .
      ?st wikibase:rank ?rank .
      FILTER NOT EXISTS { ?st pq:P582 ?ended }
      BIND("${property}" AS ?rel)
    }`;
}

/**
 * What each venue of a batch holds, by a current `P195` or `P276` statement,
 * at or above `floor` sitelinks. The venue is a fact of the answer, not
 * something to resolve: it is the admitted venue the caller asked about.
 */
export async function fetchVenueHoldings(
  sparql: SparqlFn,
  venueQids: string[],
  floor: number,
): Promise<VenueHolding[]> {
  const asked = venueQids.filter(isQid);
  if (!asked.length) return [];
  const rows = await sparql(`${HINT_PREFIX}
    SELECT ?w ?sl ?venue ?rel ?rank WHERE {
      hint:Query hint:optimizer "None" .
      VALUES ?venue { ${values(asked)} }
      ${holdingBranch('P195')} UNION ${holdingBranch('P276')}
      ?w wikibase:sitelinks ?sl .
      FILTER(?sl >= ${floor})
    }
    LIMIT ${HOLDINGS_LIMIT}`, {
    kind: 'statements',
    label: `holdings of ${asked.length} venues at ${floor}+ sitelinks`,
  });
  failIfTruncated(rows, HOLDINGS_LIMIT, `holdings of ${asked.length} venues`);

  const out: VenueHolding[] = [];
  for (const row of rows) {
    const work = extractQid(row.w?.value ?? '');
    const venue = extractQid(row.venue?.value ?? '');
    const property = row.rel?.value;
    if (!isQid(work) || !isQid(venue)) continue;
    if (property !== 'P195' && property !== 'P276') continue;
    if ((row.rank?.value ?? '').endsWith('#DeprecatedRank')) continue;
    out.push({ work, venue, property, sitelinks: parseInt(row.sl?.value || '0', 10) });
  }
  return out;
}

/** An object asked for by id: the pool's row for it, and every class it carries with its label. */
export interface WorkDetails {
  work: PoolWork;
  /** Every `P31`, by QID, with the label the service gave it — the QID itself where it gave none. */
  classes: Map<string, string>;
}

/**
 * The class an object is typed by when no class of the kind's own is among
 * them: the lowest-numbered one, which is deterministic where the answer's row
 * order is not. A treasure type that changed with the planner's mood would
 * report an update on every run to a word nobody chose.
 */
export function lowestClass(classes: ReadonlyMap<string, string>): string | null {
  let chosen: string | null = null;
  for (const qid of classes.keys()) {
    if (chosen === null || Number(qid.slice(1)) < Number(chosen.slice(1))) chosen = qid;
  }
  return chosen;
}

/**
 * What a batch of objects is, asked by id: the pool's columns, plus every
 * class each carries. The pool's parse fixes the single-valued columns off the
 * first row and collects a maker from every row (#720); the classes are read
 * here off every row the same way, since `?cls` cross-multiplies with the
 * makers exactly as an image does.
 *
 * The type is the lowest-numbered class rather than the first row's, for the
 * reason `lowestClass` gives; a caller that knows the kind's own classes
 * re-types the object where it carries one (`venueSide.ts`).
 */
export async function fetchWorksByIds(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, WorkDetails>> {
  const out = new Map<string, WorkDetails>();
  const asked = qids.filter(isQid);
  if (!asked.length) return out;
  const rows = await sparql(`
    SELECT ?w ?wLabel ?sl ?img ?creator ?creatorLabel (YEAR(?inception) AS ?year) ?cls ?clsLabel WHERE {
      VALUES ?w { ${values(asked)} }
      ?w wikibase:sitelinks ?sl .
      OPTIONAL { ?w wdt:P31 ?cls }${POOL_DETAILS}
    }`, { kind: 'pool', label: `objects by id: ${asked.length}` });

  const classesOf = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const work = extractQid(row.w?.value ?? '');
    const cls = extractQid(row.cls?.value ?? '');
    if (!isQid(work) || !isQid(cls)) continue;
    const classes = classesOf.get(work) ?? new Map<string, string>();
    const label = row.clsLabel?.value;
    classes.set(cls, label && !isQid(label) ? label : cls);
    classesOf.set(work, classes);
  }
  for (const work of parsePool(rows, 'object', null)) {
    const classes = classesOf.get(work.qid) ?? new Map<string, string>();
    const typeQid = lowestClass(classes);
    const label = typeQid === null ? null : classes.get(typeQid) ?? null;
    out.set(work.qid, {
      work: {
        ...work,
        typeQid,
        type: label !== null && !isQid(label) ? label : 'object',
      },
      classes,
    });
  }
  return out;
}
