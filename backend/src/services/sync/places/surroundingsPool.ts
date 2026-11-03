/**
 * The surroundings pool and every candidate's surroundings, read once per pass
 * from the local Wikidata subset (ADR-0171, #2178): every item of the pass
 * kinds' classes with a point — the group a place is measured among, whatever
 * its editions, as ADR-0171's measurement counted it — with its Wikipedia
 * editions, the Wikivoyage editions that use it and a year of its readers (the
 * counter the world bars read with, ADR-0175 decision 3), built in one
 * temporary table for the session and read into the run's memory; then each
 * place's density over the whole pool, and, for every item with the cut's
 * languages and the readers a held place stays at, its neighbours of its own
 * density within the radius and the best places' signals (ADR-0181,
 * `surroundingsNeighbourhood.ts`).
 *
 * Whose places set a candidate's references is the cut's `neighbours`
 * (`surroundingsCut.ts`): every kind's together — a church in Cairo measured
 * against Giza and Saqqara, as the measurement measured it — or one group per
 * kind or per type, each read over the pool's rows of that group's classes.
 * A place's density is read over the whole pool whatever the group, since it
 * says how crowded the ground around it is. The groups are read side by side
 * in the review (#2177); a run reads one.
 *
 * Subset only: the live Wikidata door cannot answer a radius over the pool,
 * and ADR-0171 reads the cut from the local copy. With no year of readers in
 * place the pool is not read at all (`unread`): the readers' floor and the
 * readers test cannot be read, and a missing year is never read as no
 * readers (ADR-0175 decision 6). With no Wikivoyage usage build in place the
 * pool is read and says its guides are not (`unreadGuides`), so a missing
 * build is never read as no guide.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { NOT_WIKIPEDIA } from '../subset/kit.js';
import type { SurroundingsCut, Surroundings } from './surroundingsCut.js';
import { yearlyReadersOfMany } from './candidates.js';
import { latestUsage } from '../../dumps/wikivoyage/usageTables.js';
import { densityOf, SphereIndex, surroundingsOf } from './surroundingsNeighbourhood.js';

/** An item as the pool holds it. */
export interface SurroundingsPoolRow {
  qid: string;
  editions: number;
  guideEditions: number;
  /** A year's readers; 0 for an item read in no counted edition. */
  readers: number;
  classes: string[];
  lat: number;
  lon: number;
}

/** One neighbourhood to read: whose places set the references, by the classes that name them. */
export interface SurroundingsGroup {
  /** `all`, the kind's group (`SurroundingsKind.group`, else its name), or `<group>:<type>` (`surroundingsGroupKey`). */
  key: string;
  /** The classes of the group's places; the whole pool for `all`. */
  classes: ReadonlySet<string> | null;
}

/** The pass's surroundings pool, read once: the rows, and each group's surroundings of every row with the cut's languages. */
export interface SurroundingsPool {
  rows: ReadonlyMap<string, SurroundingsPoolRow>;
  /** By group key, the surroundings of each candidate of that group. */
  around: ReadonlyMap<string, ReadonlyMap<string, Surroundings>>;
  /** How long the read took, for the run's log. */
  seconds: number;
  /** Why the pool was not read, when it was not: the rows and the surroundings are then empty. */
  unread?: string;
  /**
   * Why no guide's use is read, when no Wikivoyage usage build is in place:
   * the rows' and the surroundings' guide editions are then no reading, and
   * the tier reads its held places' guides as last read (ADR-0175 decision 6).
   */
  unreadGuides?: string;
}

const TABLE = 'surroundings_pool';
/** How many places' densities, and how many candidates' surroundings, are read between two of the run's stop points and status lines. */
const DENSITY_BATCH = 20_000;
const BATCH = 500;
/**
 * The longest the arithmetic holds the event loop before it lets the
 * backend's other work through. Measured by time, not by count: a dense
 * European candidate's 150 km reads many more neighbours than a remote one.
 */
const SLICE_MS = 50;

/** What the pool read reports to its run, and where it lets the run stop it (the pass's runner). */
export interface SurroundingsPoolRun {
  phase: (message: string) => void;
  /** Throws to abandon the run; called before every batch. */
  step: () => Promise<void>;
}

/** A year's readers of the pool's items, or null when no year is read. */
export type PoolReaders = (qids: readonly string[], run?: SurroundingsPoolRun) => Promise<ReadonlyMap<string, number> | null>;

const yearOfReaders: PoolReaders = (qids, run) => yearlyReadersOfMany(qids, '[Surroundings pool]', run?.step);

/** Whether a Wikivoyage usage build is in place, so the guide editions the pool counts are a reading. */
type UsageBuilt = () => Promise<boolean>;

const usageInPlace: UsageBuilt = async () => (await latestUsage()) !== null;

/** Why the pool reads no guide's use, where no usage build is in place. */
const UNREAD_GUIDES = 'No Wikivoyage usage is built, so no guide\'s use is read: the surroundings tier reads the guides of the places it holds '
  + 'as last read, and admits no new place by a guide (ADR-0175 decision 6)';

/**
 * Build the pool for `classes` and read every group's candidates' surroundings,
 * in one session that leaves nothing behind.
 */
export async function readSurroundingsPool(
  classes: ReadonlySet<string>, cut: SurroundingsCut, groups: readonly SurroundingsGroup[], run?: SurroundingsPoolRun,
  readers: PoolReaders = yearOfReaders, usageBuilt: UsageBuilt = usageInPlace,
): Promise<SurroundingsPool> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    run?.phase('Building the surroundings tier\'s pool from the subset...');
    await run?.step();
    // Asked before the pool counts the guides, so the answer is of the usage it counted.
    const guides = await usageBuilt() ? {} : { unreadGuides: UNREAD_GUIDES };
    await createPool(client, classes);
    if (!(await readPoolReaders(client, readers, run))) {
      return { rows: new Map(), around: new Map(), seconds: Math.round((Date.now() - started) / 1000),
        unread: 'No year of readers is read, so the surroundings tier\'s readers\' floor and readers test cannot be read: '
          + 'the tier is not read this run, and its places keep their standing (ADR-0175 decision 6)' };
    }
    const result = await client.query<{ qid: string; editions: number; guide_editions: number; readers: string; classes: string[]; lat: number; lon: number }>(
      `SELECT qid, editions, guide_editions, readers, classes, lat, lon FROM ${TABLE}`,
    );
    const list: SurroundingsPoolRow[] = result.rows.map((r) => ({
      qid: r.qid, editions: r.editions, guideEditions: r.guide_editions, readers: Number(r.readers), classes: r.classes, lat: r.lat, lon: r.lon,
    }));
    const rows = new Map(list.map((row) => [row.qid, row]));
    const index = new SphereIndex(list);
    const density = await densitiesOf(index, cut, run);
    // The verdict refuses a place under the languages, or under the readers a
    // held place stays at, before it reads the surroundings: none are read for it.
    const floor = cut.stayReadersShare * cut.minReaders;
    const around = new Map<string, ReadonlyMap<string, Surroundings>>();
    for (const group of groups) {
      const inGroup = (row: SurroundingsPoolRow) => group.classes === null || row.classes.some((c) => group.classes!.has(c));
      const candidates = list.flatMap((row, i) => (row.editions >= cut.minLanguages && row.readers >= floor && inGroup(row) ? [i] : []));
      around.set(group.key, await readSurroundings({ index, list, density }, candidates, cut,
        group.classes === null ? undefined : (j) => inGroup(list[j]), run));
    }
    return { rows, around, seconds: Math.round((Date.now() - started) / 1000), ...guides };
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => undefined);
    client.release();
  }
}

async function createPool(client: PoolClient, classes: ReadonlySet<string>): Promise<void> {
  await client.query(
    `CREATE TEMP TABLE ${TABLE} AS
     WITH points AS (
       SELECT DISTINCT ON (p.subject) p.subject AS qid,
              (p.value->>'latitude')::float8 AS lat, (p.value->>'longitude')::float8 AS lon
         FROM wikidata_claims p
        WHERE p.property = 'P625' AND p.rank >= 0 AND p.value ? 'latitude'
          AND ((p.value->>'globe') IS NULL OR (p.value->>'globe') LIKE '%/Q2')
        -- an item with two coordinates of one rank takes the same one every run:
        -- a neighbour that moved between reads would move every density around it
        ORDER BY p.subject, p.rank DESC, p.statement_id
     ),
     members AS (
       SELECT c.subject AS qid, array_agg(DISTINCT c.value_item) AS classes
         FROM wikidata_claims c
        WHERE c.property = 'P31' AND c.rank >= 0 AND c.value_item = ANY($1::text[])
        GROUP BY c.subject
     )
     SELECT e.id AS qid, ed.n AS editions, m.classes, pt.lat, pt.lon,
            coalesce(g.n, 0) AS guide_editions, 0::bigint AS readers
       FROM wikidata_entities e
       JOIN members m ON m.qid = e.id
       JOIN points pt ON pt.qid = e.id
       -- the editions the runs count (subsetWikipediaEditions): Wikipedia sites alone
       JOIN LATERAL (SELECT count(*)::int AS n FROM wikidata_sitelinks l
                      WHERE l.id = e.id AND l.site LIKE '%wiki' AND l.site <> ALL($2::text[])) ed ON true
       LEFT JOIN (SELECT item, count(DISTINCT site)::int AS n FROM wikivoyage_usage GROUP BY item) g ON g.item = e.id`,
    [[...classes], NOT_WIKIPEDIA],
  );
}

/**
 * A year of readers of every pool item with a Wikipedia article, written into
 * the session's pool; false, with nothing written, when no year is read.
 */
async function readPoolReaders(client: PoolClient, readers: PoolReaders, run?: SurroundingsPoolRun): Promise<boolean> {
  const read = (await client.query<{ qid: string }>(`SELECT qid FROM ${TABLE} WHERE editions > 0`)).rows.map((r) => r.qid);
  run?.phase(`Reading a year of readers of the surroundings pool's ${read.length.toLocaleString('en')} items with an article...`);
  const year = await readers(read, run);
  if (!year) return false;
  const qids = [...year.keys()];
  await client.query(
    `UPDATE ${TABLE} p SET readers = r.n FROM unnest($1::text[], $2::bigint[]) AS r(qid, n) WHERE p.qid = r.qid`,
    [qids, qids.map((qid) => year.get(qid))],
  );
  return true;
}

/** Lets the run's other work through between two batches of the pool's arithmetic, which holds the event loop while it runs. */
const yieldToRun = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** A clock that says when a slice of arithmetic has held the event loop for `SLICE_MS`, restarted at each yield. */
function slicer(): { due: () => boolean; yield: () => Promise<void> } {
  let since = Date.now();
  return {
    due: () => Date.now() - since >= SLICE_MS,
    yield: async () => { await yieldToRun(); since = Date.now(); },
  };
}

/** Every pool place's density (`densityOf`), by its position in the pool, read in batches the run can stop between. */
async function densitiesOf(index: SphereIndex, cut: SurroundingsCut, run?: SurroundingsPoolRun): Promise<Float64Array> {
  const density = new Float64Array(index.size);
  const slice = slicer();
  for (let i = 0; i < index.size; i += DENSITY_BATCH) {
    await run?.step();
    run?.phase(`Reading how crowded the ground is around the surroundings pool's places: ${i.toLocaleString('en')} of ${index.size.toLocaleString('en')}...`);
    for (let j = i; j < Math.min(index.size, i + DENSITY_BATCH); j++) {
      density[j] = densityOf(index, j, cut.densityNeighbours);
      if (slice.due()) await slice.yield();
    }
  }
  return density;
}

/** The pool as the neighbourhood reads it: its places in order, their tree and their densities. */
interface PoolGeometry {
  index: SphereIndex;
  list: readonly SurroundingsPoolRow[];
  density: Float64Array;
}

/**
 * The surroundings of each of the pool's places at `candidates` (positions in
 * `list`), among the places `inGroup` names (every place when absent): the
 * group of its own density within the radius, and the `best` highest
 * editions, guide editions and readers among the places that carry one,
 * highest first. Read in batches the run can stop between.
 */
async function readSurroundings(
  geometry: PoolGeometry, candidates: readonly number[], cut: SurroundingsCut, inGroup?: (j: number) => boolean,
  run?: SurroundingsPoolRun,
): Promise<Map<string, Surroundings>> {
  const out = new Map<string, Surroundings>();
  const slice = slicer();
  for (let i = 0; i < candidates.length; i += BATCH) {
    // The read takes a while over the world's pool: the run can be stopped
    // between batches, and its status says how far it has come.
    await run?.step();
    run?.phase(`Measuring places against their surroundings: ${i.toLocaleString('en')} of ${candidates.length.toLocaleString('en')}...`);
    for (const at of candidates.slice(i, i + BATCH)) {
      out.set(geometry.list[at].qid, surroundingsOf(geometry.index, geometry.list, geometry.density, at, cut, inGroup));
      if (slice.due()) await slice.yield();
    }
  }
  return out;
}
