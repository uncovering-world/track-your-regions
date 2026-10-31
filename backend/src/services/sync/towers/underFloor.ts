/**
 * The towers under the pool's floor the guide door may open for (ADR-0168):
 * Bologna's Asinelli Tower carries 9 Wikipedia editions, the Dom Tower of
 * Utrecht 8, the Torrazzo of Cremona 14 — under the 15 the class questions
 * ask for (`POOL_MIN_SITELINKS`) — and each is used by a Wikivoyage guide and
 * read tens of thousands of times a year. The readership names the items
 * first, at the door's bar; the guide narrows them; Wikidata is asked only
 * which of those carry a tower class with a point, then for their rows and
 * their classes. What comes back joins the share as a class question's row
 * would, and the tower rule reads it unchanged.
 */

import { chunk, type Door } from '../wikidataQueries.js';
import { fetchEntitiesByIds, fetchEntityFacts, POOL_MIN_SITELINKS, type EntityFacts, type PoolEntity } from '../publicArt/queries.js';
import { fetchPlacedAmong } from '../archaeology/queries.js';
import { readAtLeast, readershipYear } from '../../dumps/readership/workReadership.js';
import { usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import type { TowerTrees } from './classes.js';

const ID_BATCH = 50;

/** The rows the door may open for under the floor, with the facts the rule reads of them. */
export interface UnderFloorTowers {
  entities: PoolEntity[];
  facts: Map<string, EntityFacts>;
}

const NONE: UnderFloorTowers = { entities: [], facts: new Map() };

/**
 * The towers under the floor read at `bar` or over in the latest year and
 * used by a guide, never one the pool already holds. Nothing without a year
 * of readership: the door reads readers as the line does, and reads none
 * where none is folded.
 */
export async function collectTowersUnderFloor(
  door: Door,
  pool: ReadonlyMap<string, PoolEntity>,
  trees: TowerTrees,
  bar: number,
  logPrefix: string,
): Promise<UnderFloorTowers> {
  const year = await readershipYear();
  if (!year) return NONE;
  const read = (await readAtLeast(year, bar, POOL_MIN_SITELINKS)).filter((qid) => !pool.has(qid));
  const guided = await usedByAGuide(read);
  const named = read.filter((qid) => guided.has(qid));
  if (!named.length) return NONE;
  const towers = await fetchPlacedAmong(door, named, trees.tower);
  if (!towers.length) return NONE;
  const entities: PoolEntity[] = [];
  for (const batch of chunk(towers, ID_BATCH)) {
    for (const entity of await fetchEntitiesByIds(door, batch, 'towers the world reads under the pool floor')) {
      if (entity.sitelinks < POOL_MIN_SITELINKS) entities.push(entity);
    }
  }
  const sparql = typeof door === 'function' ? door : door.sparql;
  const facts = await fetchEntityFacts(sparql, entities.map((entity) => entity.qid));
  console.log(`${logPrefix} Under the pool floor: ${read.length} items read at ${bar.toLocaleString('en')} or over, `
    + `${named.length} used by a guide, ${entities.length} towers`);
  return { entities, facts };
}
