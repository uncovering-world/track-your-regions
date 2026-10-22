/**
 * Door one: a place of worship the world already knows by name.
 *
 * A classifier over the kind's share of the place gather (`places/gather.ts`,
 * #1820): the rule over each candidate, and then the fame line — with one
 * difference from public art's: the line is not a constant here but a number
 * the source row states (`sourceLine.ts`), so a kind can be widened from the
 * admin panel rather than by a deploy.
 *
 * Nothing here decides what a place of worship is: that is `worshipTest.ts`,
 * over the sets `classes.ts` composes. This file is the wiring.
 */

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare, PlaceKind } from '../places/gather.js';
import { worshipVerdict } from './worshipTest.js';
import { fetchWorshipTrees } from './queries.js';
import { BROAD_WORSHIP_ROOTS, type WorshipTrees, type WorshipType } from './classes.js';
import { belowLineReason, lineStanding, type SourceLine } from '../sourceLine.js';
import type { FilteredEntity } from '../syncContract.js';

/** A place the rule admitted and the line let in, with what the run learned about it. */
export interface PlaceCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  type: WorshipType | null;
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
 * arrived. It is 22 rows at the pool's floor, measured on 2026-09-04.
 *
 * The rule reads a row's own classes and nothing else — a tower is a tower
 * whether a cathedral stands beside it or not (`WORSHIP_PART_CLASSES`) — so no
 * container is asked about.
 */
export const WORSHIP_KIND: PlaceKind<WorshipTrees> = {
  name: 'places of worship',
  trees: fetchWorshipTrees,
  poolClasses: (trees) => ({ broad: BROAD_WORSHIP_ROOTS, narrow: [...trees.worship, ...trees.parts] }),
  readsContainers: false,
};

/**
 * The places this run would admit for their own fame, and every candidate the
 * rule refused with the reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the stay
 * line has something to hold. Candidates are judged most famous first, which is
 * the order the refusals are reported in.
 */
export function classifyPlacesByFame(
  { trees, pool, facts }: KindShare<WorshipTrees>,
  admitted: ReadonlySet<string>,
  line: SourceLine,
): PlacesByFame {
  const classesOf = new Map([...facts].map(([qid, row]) => [qid, row.classes]));

  const places = new Map<string, PlaceCandidate>();
  const filtered: FilteredEntity[] = [];
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const classes = classesOf.get(entity.qid) ?? [];
    const verdict = worshipVerdict({
      qid: entity.qid,
      classes,
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
    }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    // Where a candidate that passed the rule stands against the fame line: in,
    // out, or — for a row the source admits that has fallen below the stay line
    // — refused by name, with its number. A candidate that was never in and is
    // below the line is simply out: a refusal names a rule, and none ran on it.
    // The rule and the sentence are `sourceLine.ts`'s, so every kind gives a
    // curator the same answer.
    const stands = lineStanding(entity.sitelinks, admitted.has(entity.qid), line);
    if (stands === 'out') continue;
    if (stands === 'fell') {
      filtered.push({
        externalId: entity.qid,
        name: entity.label,
        reason: belowLineReason(entity.sitelinks, line),
      });
      continue;
    }
    places.set(entity.qid, { entity, classes, type: verdict.type });
  }
  return { places, filtered, classesOf };
}
