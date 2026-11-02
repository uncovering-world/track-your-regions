/**
 * Door one: a place of worship the world already knows by name.
 *
 * A classifier over the kind's share of the place gather (`places/gather.ts`,
 * #1820): the rule over each candidate, and then the world bars of ADR-0175
 * over the kind's own pool (`places/worldBars.ts`) — its Wikipedia editions,
 * its readers a year, and its readers where a guide marks the place. Door two,
 * the works a place holds, keeps the line the source row states
 * (`sourceLine.ts`); this door reads no line of its own.
 *
 * Nothing here decides what a place of worship is: that is `worshipTest.ts`,
 * over the sets `classes.ts` composes. This file is the wiring.
 */

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare, PlaceKind } from '../places/gather.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { worshipVerdict } from './worshipTest.js';
import { fetchWorshipTrees } from './queries.js';
import { BROAD_WORSHIP_ROOTS, type WorshipTrees, type WorshipType } from './classes.js';
import { inPool, namesRefusal, openWorldTier } from '../places/worldTier.js';
import type { WorldBars, WorldCandidate, WorldRead } from '../places/worldBars.js';
import type { FilteredEntity } from '../syncContract.js';

const LOG_PREFIX = '[Worship Sync]';

/** A place the rule admitted and the bars let in, with what the run learned about it. */
export interface PlaceCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  type: WorshipType | null;
  /** The curator's note, where the bars ask one: in by a guide's mark, or kept while a bar could not be read. */
  note?: string;
}

export interface PlacesByFame {
  places: Map<string, PlaceCandidate>;
  /** Refusals, most famous first: what the rule turned away, and by what name. */
  filtered: FilteredEntity[];
  /**
   * Every `P31` of every entity the pool named — the admitted, the refused and
   * the merely unfamous alike, keyed by QID.
   *
   * The pipeline reads it for a question door one does not ask: whether a
   * *work* the other door collected is itself a place of worship. The works
   * pool knows only the one class a work was collected under, and the Cavern of
   * the Patriarchs (`mosque, synagogue, tomb, mausoleum, …`) arrives there as a
   * tomb — this map is where its mosque class is (#753).
   */
  classesOf: Map<string, string[]>;
}

/**
 * Places of worship as the place gather reads them (`places/gather.ts`): the
 * worship tree and its type trees, and the classes whose instances are its
 * candidates — the nine broad roots in fame bands, every other class of the
 * tree whole. **The part classes are asked too**, though the rule refuses
 * every one of them: a bell tower Wikidata types nothing else is a row a
 * person looking at the run should see refused by name — the Leaning Tower,
 * the Giralda, St Mark's Campanile — rather than one that silently never
 * arrived.
 *
 * The rule reads a row's own classes — a tower is a tower whether a cathedral
 * stands beside it or not (`WORSHIP_PART_CLASSES`) — and, for a holy place
 * that is no building, where its location (`P276`) says it is kept, so the
 * containers are asked about.
 */
export const WORSHIP_KIND: PlaceKind<WorshipTrees> = {
  name: 'places of worship',
  trees: fetchWorshipTrees,
  poolClasses: (trees) => ({ broad: BROAD_WORSHIP_ROOTS, narrow: [...trees.worship, ...trees.parts] }),
  // A holy object is the place it is kept in (`worshipVerdict`).
  readsContainers: true,
  admissionPool: true,
};

const candidateOf = (entity: PoolEntity): WorldCandidate => ({ qid: entity.qid, editions: entity.sitelinks });

/**
 * The places this run admits for their own fame, and the candidates the rule
 * refused that are worth naming (`namesRefusal`), with the reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the stay
 * share has something to hold. `world` hands the world's signals in, and the
 * bars where the test is not about the pool, for a test; a run reads them.
 * Candidates are judged most famous first, which is the order the refusals are
 * reported in.
 */
export async function classifyPlacesByFame(
  share: KindShare<WorshipTrees>,
  admitted: ReadonlySet<string>,
  sparql: SparqlFn,
  world?: { read: WorldRead; bars?: WorldBars },
): Promise<PlacesByFame> {
  const { trees, pool, facts, containers } = share;
  const classesOf = new Map([...facts].map(([qid, row]) => [qid, row.classes]));
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  const verdicts = new Map(candidates.map((entity) => {
    const row = facts.get(entity.qid);
    return [entity.qid, worshipVerdict({
      qid: entity.qid,
      classes: classesOf.get(entity.qid) ?? [],
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
      religions: row?.religions,
      locatedIn: (row?.locations ?? []).flatMap((qid) => {
        const place = containers?.nodes.get(qid);
        return place ? [{ label: place.label, classes: place.classes }] : [];
      }),
    }, trees)];
  }));
  const tier = await openWorldTier({
    pool: candidates.filter((entity) => verdicts.get(entity.qid)!.pass && inPool(share, entity.qid, entity)).map(candidateOf),
    qids: candidates.map((entity) => entity.qid),
    poolRead: share.admissionPool !== null,
    sparql,
    logPrefix: LOG_PREFIX,
    read: world?.read,
    bars: world?.bars,
  });

  const places = new Map<string, PlaceCandidate>();
  const filtered: FilteredEntity[] = [];
  for (const entity of candidates) {
    const verdict = verdicts.get(entity.qid)!;
    const c = candidateOf(entity);
    const held = admitted.has(entity.qid);
    if (!verdict.pass) {
      if (namesRefusal(c, held, tier)) filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const stands = tier.standing(c, held);
    if (stands === 'out') continue;
    if ('fell' in stands) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: stands.fell });
      continue;
    }
    const note = tier.noteOf(c, stands);
    places.set(entity.qid, { entity, classes: classesOf.get(entity.qid) ?? [], type: verdict.type, ...(note ? { note } : {}) });
  }
  return { places, filtered, classesOf };
}
