/**
 * The place pass's one gather of works (#1821): what Art Museums, Places of
 * worship and Archaeology each ask for, read once through the pass's door,
 * each kind taking its own share in its own run (`worksOf`).
 */

import { gatherWorks, WORK_NOUN, type GatheredWorks } from '../museum/worksGather.js';
import { MUSEUM_WORKS } from '../museum/worksCollector.js';
import { fetchMuseumClasses } from '../museum/queries.js';
import { worshipWorks } from '../worship/pipeline.js';
import { findsWorks } from '../archaeology/finds.js';
import { ARCHAEOLOGY_SITE_KIND } from '../archaeology/sites.js';
import type { QueryRunner } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces } from './gather.js';

/**
 * The works every works kind of the pass asks for. Places of worship's treasure
 * classes are the ones its run then reads from the pass (`SharedWorks`), and
 * Archaeology's classes are its share's trees, which the place gather read, so
 * every kind's request is the one asked.
 */
export async function gatherPassWorks(
  gathered: GatheredPlaces, run: QueryRunner, treasureClasses: Record<string, string>,
): Promise<GatheredWorks> {
  const requests = [
    MUSEUM_WORKS,
    worshipWorks(treasureClasses),
    findsWorks(shareOf(gathered, ARCHAEOLOGY_SITE_KIND).trees),
  ];
  return gatherWorks(run, requests, { logPrefix: '[Place pass]', noun: WORK_NOUN });
}

/** The museum tree every works kind's rule reads, once for the pass. */
export async function readMuseumClasses(run: QueryRunner): Promise<ReadonlySet<string>> {
  run.phase('Fetching the classes a museum can be...');
  await run.step();
  return fetchMuseumClasses(run.sparql);
}
