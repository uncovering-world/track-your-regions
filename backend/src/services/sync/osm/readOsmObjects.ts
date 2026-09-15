/**
 * Both reads of OpenStreetMap, whichever door they go through: the map's own
 * list of digs that feeds the site pool (`readOsmDigs`, #895) and the batched
 * read of what it maps at each candidate (`readOsmObjects`).
 *
 * A door knows three things: how to phrase the per-item question for a batch
 * of Wikidata items in its endpoint's own language, how to phrase the
 * enumeration in it — one question where the endpoint can answer the planet
 * whole, several where it cannot (#895) — and how to send either and answer
 * rows in the shape this file's folds read: `foldOsmRows` for the per-item
 * answer, keyed on the `wikidata` tag, and `foldOsmDigRows` for the
 * enumeration, which also files a row carrying only a `wikipedia` tag under
 * that article. Everything else about the read — the batch
 * size, the phase a run shows, the pause and the cancel check before each
 * question, the cache descriptor, the folding — is the same for the QLever
 * mirror and for Overpass, so it is written once here rather than in each
 * adapter. That is what makes the second reader a fallback rather than a
 * second reading: the site door's floor (`OSM_ANSWER_FLOOR`) and the run's
 * cache kind (`osm`) sit above this function and never learn which door
 * answered.
 *
 * **A lost answer is never read as a fact**, and it takes three guards to
 * mean it. The whole point of asking OSM is to tell a ruin from a living town, so a
 * batch that came back empty because the endpoint moved house would turn every
 * site in it into "no OSM object carries this item" and refuse the ones the
 * rule is there to admit. A batch that cannot be *read* throws in the door —
 * the run fails and nothing is written, the shape the Wikipedia category
 * readers took for the same reason (#887). But an endpoint can also answer
 * HTTP 200 with nothing in it, which no door can tell from a genuine "nothing
 * is mapped there": a renamed `osmkey:` IRI, a rebuilt dataset, the host
 * moving again. The enumeration answers that for itself — a planet that maps
 * no dig at all is no fact about the world, so `readOsmDigs` ends the run on
 * an empty answer and the boundary forgets what it cached. The per-item read
 * cannot: only the caller knows how much silence is too much, so the third
 * guard is the site door's — `collectSitesByFame` counts the share that came
 * back with an object and fails the run below a floor, before a single verdict
 * is taken, over the candidates the read can answer about (the rows the
 * enumeration reached through an article alone carry no `wikidata` tag on any
 * dig, so they are counted on neither side: `byArticleOnly`).
 */

import { chunk, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { isQid, type SparqlBinding } from '../wikidataUtils.js';
import {
  foldOsmDigRows, foldOsmRows, type DigTags, type KeepWkt, type OsmDigs, type OsmObject,
} from './types.js';

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
  /**
   * The enumeration (#895): every object tagged as a dig or as ruins that
   * carries an item or an article, tags only, in the endpoint's own language
   * — as one question where the endpoint can answer it whole (the mirror),
   * or as several where it cannot (Overpass, one selector at a time).
   */
  digsQuestions: (tags: DigTags) => string[];
  /**
   * Sends either question and answers rows in the shape this file's folds
   * read: keyed on the `wikidata` tag for a batch (`foldOsmRows`), and for the
   * enumeration carrying the `wikipedia` tag too, since 2,027 of its objects
   * name an article and no item (`foldOsmDigRows`, which files those under the
   * article).
   */
  send: SparqlFn;
}

/**
 * An answer from OpenStreetMap too empty to judge anything by.
 *
 * Its own class so the run can tell it from a transport failure and do the one
 * thing a transport failure does not need: forget what it just cached. The
 * empty answer is in the cache by the time this is thrown — `withCache` files
 * a zero-row answer like any other, for a day — and a run that kept it would
 * re-read the silence and fail the same way until the row expired, long after
 * the map had recovered. `archaeologySyncService.ts` drops the `osm` kind on
 * it; the per-item read's floor (`OsmAnswerFloorError`) and the enumeration's
 * emptiness (`OsmEmptyEnumerationError`) are its two shapes.
 */
export class OsmEmptyAnswerError extends Error {}

/** The enumeration of digs with nothing in it (`readOsmDigs`). */
export class OsmEmptyEnumerationError extends OsmEmptyAnswerError {
  constructor() {
    super(
      'OpenStreetMap answered with no dig at all, and an empty enumeration is not '
      + 'a fact about the world: the map holds tens of thousands',
    );
    this.name = 'OsmEmptyEnumerationError';
  }
}

/**
 * Every object OpenStreetMap tags as a dig or as ruins that names a Wikidata
 * item or a Wikipedia article — the site pool's second entrance (#895), asked
 * once a run and kept a day like every other answer.
 *
 * **An answer with nothing in it is not an empty map.** The measured planet
 * holds some 43,000 such objects (2026-09-15, either door); a renamed key, a rebuilt dataset or
 * a host that moved answers 200 with none, and read as a fact that would make
 * every row this entrance admitted a withdrawal on the next sweep. So it fails
 * the run by name, as a lost batch does — and by a class the run's boundary
 * forgets the cached answers on, since the emptiness is already filed.
 */
export async function readOsmDigs(
  door: OsmDoor,
  tags: DigTags,
  run: Pick<QueryRunner, 'phase' | 'step'>,
): Promise<OsmDigs> {
  const questions = door.digsQuestions(tags);
  const rows: SparqlBinding[] = [];
  for (let i = 0; i < questions.length; i++) {
    run.phase(`Asking OpenStreetMap for every dig and ruin it maps (question ${i + 1}/${questions.length})...`);
    await run.step();
    const answer = await door.send(questions[i], {
      kind: 'osm',
      label: `every OSM object tagged as a dig or as ruins (${i + 1}/${questions.length})`,
    });
    // Appended, never spread: a spread is one argument per row, and the
    // mirror answers the whole planet in one question — 66,417 rows on
    // 2026-09-15 against a ceiling of about 124,000 arguments (Node 22, the
    // image this runs on). The map only grows, and the wall is a `RangeError`
    // naming nothing about OpenStreetMap.
    for (const row of answer) rows.push(row);
  }
  const digs = foldOsmDigRows(rows);
  if (digs.byItem.size === 0 && digs.byArticle.size === 0) throw new OsmEmptyEnumerationError();
  return digs;
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
