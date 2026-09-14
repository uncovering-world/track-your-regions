/**
 * The one batched read of OpenStreetMap, whichever door it goes through.
 *
 * A door knows two things: how to phrase the question for a batch of Wikidata
 * items in its endpoint's own language, and how to send it and answer rows in
 * the shape `foldOsmRows` reads. Everything else about the read — the batch
 * size, the phase a run shows, the pause and the cancel check before each
 * question, the cache descriptor, the folding — is the same for the QLever
 * mirror and for Overpass, so it is written once here rather than in each
 * adapter. That is what makes the second reader a fallback rather than a
 * second reading: the site door's floor (`OSM_ANSWER_FLOOR`) and the run's
 * cache kind (`osm`) sit above this function and never learn which door
 * answered.
 *
 * **A lost answer is never read as a fact**, and it takes two guards to mean
 * it. The whole point of asking OSM is to tell a ruin from a living town, so a
 * batch that came back empty because the endpoint moved house would turn every
 * site in it into "no OSM object carries this item" and refuse the ones the
 * rule is there to admit. A batch that cannot be *read* throws in the door —
 * the run fails and nothing is written, the shape the Wikipedia category
 * readers took for the same reason (#887). But an endpoint can also answer
 * HTTP 200 with nothing in it, which no door can tell from a genuine "nothing
 * is mapped there": a renamed `osmkey:` IRI, a rebuilt dataset, the host
 * moving again. Only the caller knows how much silence is too much, so the
 * second guard is the site door's — `collectSitesByFame` counts the share of
 * asked items that came back with an object and fails the run below a floor,
 * before a single verdict is taken.
 */

import { chunk, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { isQid } from '../wikidataUtils.js';
import { foldOsmRows, type KeepWkt, type OsmObject } from './types.js';

/** The readers this catalogue can go through, by the name an operator writes. */
export type OsmReaderName = 'qlever' | 'overpass';

/**
 * One way of asking OpenStreetMap.
 *
 * `send` is the door itself, or the same door with the run's cache composed
 * over it (`withCache`) exactly as the Wikidata collectors do: this module
 * knows how to ask, and the run knows whether it is allowed to remember.
 */
export interface OsmDoor {
  /** What the run log calls it. */
  name: OsmReaderName;
  /** The one question for one batch, in the endpoint's own language. */
  question: (qids: string[], keep: KeepWkt) => string;
  /** Sends a question and answers rows in the shape `foldOsmRows` reads. */
  send: SparqlFn;
}

/** Items per question. A hundred answered in a few seconds through either door. */
export const OSM_BATCH = 100;

/**
 * Every object carrying `wikidata=<item>`, for each of a list of items.
 *
 * Every asked item is in the answer, an empty list meaning "OSM maps nothing
 * carrying this item" and absence meaning "nobody asked" (`foldOsmRows`).
 */
export async function readOsmObjects(
  door: OsmDoor,
  qids: string[],
  keep: KeepWkt,
  run: Pick<QueryRunner, 'phase' | 'step'>,
): Promise<Map<string, OsmObject[]>> {
  const out = new Map<string, OsmObject[]>();
  const asked = [...new Set(qids.filter(isQid))];
  if (!asked.length) return out;
  for (const qid of asked) out.set(qid, []);

  const batches = chunk(asked, OSM_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking OpenStreetMap what it maps at each site (batch ${i + 1}/${batches.length})...`);
    await run.step();
    const rows = await door.send(door.question(batches[i], keep), {
      kind: 'osm',
      label: `OSM objects of ${batches[i].length} item${batches[i].length === 1 ? '' : 's'}`,
    });
    foldOsmRows(rows, out);
  }
  return out;
}
