/**
 * The sites under the pool's floor the world reads (#1757, ADR-0152): the
 * Temple of Poseidon at Sounion and the Inca Trail to Machu Picchu carry 14
 * Wikipedia editions, one under the 15 the class questions ask for
 * (`POOL_MIN_SITELINKS`), and are read more than most sites the kind holds at
 * its line. The readership names them first, at the readership door's bar over
 * the sites the source holds at the line; Wikidata is asked only which of those
 * are sites with a point. What comes back joins the pool as a class question's
 * row would, and the site rule reads it unchanged.
 */

import { chunk, type QueryRunner } from '../wikidataQueries.js';
import { fetchEntitiesByIds, POOL_MIN_SITELINKS, type PoolEntity } from '../publicArt/queries.js';
import type { UnderFloorReader } from '../readershipDoor.js';
import type { SourceLine } from '../sourceLine.js';
import type { ArchaeologyTrees } from './classes.js';
import { fetchSitesAmong } from './queries.js';

const ID_BATCH = 50;

/**
 * The pool rows under the floor the readership door may open for, never one
 * the pool already holds. The bar is read over the sites the source holds at
 * the line, the tier the door itself reads (ADR-0127 decision 2). None
 * without a reader: the source's curator gate is off, or a test asks no
 * readership.
 */
export async function collectUnderFloor(
  run: QueryRunner,
  read: UnderFloorReader | undefined,
  pool: ReadonlyMap<string, PoolEntity>,
  trees: ArchaeologyTrees,
  admitted: ReadonlySet<string>,
  line: SourceLine,
): Promise<PoolEntity[]> {
  if (!read) return [];
  run.phase('Reading the sites the world reads under the pool floor...');
  await run.step();
  const held = [...pool.values()]
    .filter((entity) => admitted.has(entity.qid) && entity.sitelinks >= line.enterSitelinks)
    .map((entity) => ({ qid: entity.qid, sitelinks: entity.sitelinks }));
  const named = (await read(held)).filter((qid) => !pool.has(qid));
  if (!named.length) return [];
  run.phase(`Asking which of ${named.length} items the world reads are sites...`);
  const sites = await fetchSitesAmong(run, named, trees.site);
  const found: PoolEntity[] = [];
  for (const batch of chunk(sites, ID_BATCH)) {
    await run.step();
    const entities = await fetchEntitiesByIds(run, batch, 'sites the world reads under the pool floor');
    found.push(...entities.filter((entity) => entity.sitelinks < POOL_MIN_SITELINKS));
  }
  return found;
}
