/**
 * The regional pool and every candidate's surroundings, read once per pass
 * from the local Wikidata subset (ADR-0171, #2178): every item of the pass
 * kinds' classes with a point — the group a place is measured among, whatever
 * its editions, as ADR-0171's measurement counted it — with its Wikipedia
 * editions, the Wikivoyage editions that use it and a year of its readers (the
 * counter the world bars read with, ADR-0175 decision 3), in one temporary
 * table with a spatial index for the session; then, for every item with the
 * cut's languages, the group within the radius and the best places' signals,
 * one indexed query per item (`ST_DWithin` over the GiST index).
 *
 * Whose places set a candidate's references is the cut's `neighbours`
 * (`regionalCut.ts`): every kind's together — a church in Cairo measured
 * against Giza and Saqqara, as the measurement measured it — or one group per
 * kind or per type, each read over the pool's rows of that group's classes.
 * The groups are read side by side in the review (#2177); a run reads one.
 *
 * Subset only: the live Wikidata door cannot answer a radius over the pool,
 * and ADR-0171 reads the cut from the local copy. With no year of readers in
 * place the pool is not read at all (`unread`): the readers' floor and the
 * readers test cannot be read, and a missing year is never read as no
 * readers (ADR-0175 decision 6).
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { NOT_WIKIPEDIA } from '../subset/kit.js';
import type { RegionalCut, Surroundings } from './regionalCut.js';
import { yearlyReadersOfMany } from './candidates.js';

/** An item as the pool holds it. */
export interface RegionalPoolRow {
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
export interface RegionalGroup {
  /** `all`, the kind's group (`RegionalKind.group`, else its name), or `<group>:<type>` (`regionalGroupKey`). */
  key: string;
  /** The classes of the group's places; the whole pool for `all`. */
  classes: ReadonlySet<string> | null;
}

/** The pass's regional pool, read once: the rows, and each group's surroundings of every row with the cut's languages. */
export interface RegionalPool {
  rows: ReadonlyMap<string, RegionalPoolRow>;
  /** By group key, the surroundings of each candidate of that group. */
  around: ReadonlyMap<string, ReadonlyMap<string, Surroundings>>;
  /** How long the read took, for the run's log. */
  seconds: number;
  /** Why the pool was not read, when it was not: the rows and the surroundings are then empty. */
  unread?: string;
}

const TABLE = 'regional_pool';
const BATCH = 500;

/** What the pool read reports to its run, and where it lets the run stop it (the pass's runner). */
export interface RegionalPoolRun {
  phase: (message: string) => void;
  /** Throws to abandon the run; called before every batch. */
  step: () => Promise<void>;
}

/** A year's readers of the pool's items, or null when no year is read. */
export type PoolReaders = (qids: readonly string[], run?: RegionalPoolRun) => Promise<ReadonlyMap<string, number> | null>;

const yearOfReaders: PoolReaders = (qids, run) => yearlyReadersOfMany(qids, '[Regional pool]', run?.step);

/**
 * Build the pool for `classes` and read every group's candidates' surroundings,
 * in one session that leaves nothing behind.
 */
export async function readRegionalPool(
  classes: ReadonlySet<string>, cut: RegionalCut, groups: readonly RegionalGroup[], run?: RegionalPoolRun,
  readers: PoolReaders = yearOfReaders,
): Promise<RegionalPool> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    run?.phase('Building the regional tier\'s pool from the subset...');
    await run?.step();
    await createPool(client, classes);
    if (!(await readPoolReaders(client, readers, run))) {
      return { rows: new Map(), around: new Map(), seconds: Math.round((Date.now() - started) / 1000),
        unread: 'No year of readers is read, so the regional tier\'s readers\' floor and readers test cannot be read: '
          + 'the tier is not read this run, and its places keep their standing (ADR-0175 decision 6)' };
    }
    await client.query(`CREATE INDEX ON ${TABLE} USING GIST (point)`);
    await client.query(`ANALYZE ${TABLE}`);
    const result = await client.query<{ qid: string; editions: number; guide_editions: number; readers: string; classes: string[]; lat: number; lon: number }>(
      `SELECT qid, editions, guide_editions, readers, classes, lat, lon FROM ${TABLE}`,
    );
    const rows = new Map(result.rows.map((r) => [r.qid, {
      qid: r.qid, editions: r.editions, guideEditions: r.guide_editions, readers: Number(r.readers), classes: r.classes, lat: r.lat, lon: r.lon,
    }]));
    const around = new Map<string, ReadonlyMap<string, Surroundings>>();
    for (const group of groups) {
      const candidates = [...rows.values()]
        .filter((row) => row.editions >= cut.minLanguages && (group.classes === null || row.classes.some((c) => group.classes!.has(c))))
        .map((row) => row.qid);
      around.set(group.key, await readSurroundings(client, candidates, cut, group.classes, run));
    }
    return { rows, around, seconds: Math.round((Date.now() - started) / 1000) };
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
        ORDER BY p.subject, p.rank DESC
     ),
     members AS (
       SELECT c.subject AS qid, array_agg(DISTINCT c.value_item) AS classes
         FROM wikidata_claims c
        WHERE c.property = 'P31' AND c.rank >= 0 AND c.value_item = ANY($1::text[])
        GROUP BY c.subject
     )
     SELECT e.id AS qid, ed.n AS editions, m.classes, pt.lat, pt.lon,
            coalesce(g.n, 0) AS guide_editions, 0::bigint AS readers,
            ST_SetSRID(ST_MakePoint(pt.lon, pt.lat), 4326)::geography AS point
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
async function readPoolReaders(client: PoolClient, readers: PoolReaders, run?: RegionalPoolRun): Promise<boolean> {
  const read = (await client.query<{ qid: string }>(`SELECT qid FROM ${TABLE} WHERE editions > 0`)).rows.map((r) => r.qid);
  run?.phase(`Reading a year of readers of the regional pool's ${read.length.toLocaleString('en')} items with an article...`);
  const year = await readers(read, run);
  if (!year) return false;
  const qids = [...year.keys()];
  await client.query(
    `UPDATE ${TABLE} p SET readers = r.n FROM unnest($1::text[], $2::bigint[]) AS r(qid, n) WHERE p.qid = r.qid`,
    [qids, qids.map((qid) => year.get(qid))],
  );
  return true;
}

/**
 * The surroundings of each of `qids` over the session's pool, among the places
 * of `neighbours` (every place when null): the group within the radius, and
 * the `best` highest editions, guide editions and readers among the places
 * that carry one, highest first. Read in batches, one indexed query per item through a
 * lateral join.
 */
export async function readSurroundings(
  client: PoolClient, qids: readonly string[], cut: RegionalCut, neighbours: ReadonlySet<string> | null = null,
  run?: RegionalPoolRun,
): Promise<Map<string, Surroundings>> {
  const out = new Map<string, Surroundings>();
  const metres = cut.radiusKm * 1000;
  const among = neighbours === null ? '' : 'AND b.classes && $4::text[]';
  const extra = neighbours === null ? [] : [[...neighbours]];
  for (let i = 0; i < qids.length; i += BATCH) {
    // The read takes minutes over the world's pool: the run can be stopped
    // between batches, and its status says how far it has come.
    await run?.step();
    run?.phase(`Measuring places against their surroundings: ${i.toLocaleString('en')} of ${qids.length.toLocaleString('en')}...`);
    const result = await client.query<{ qid: string; group_size: string; top_editions: number[] | null; top_guide: number[] | null; top_readers: string[] | null }>(
      `SELECT a.qid,
              (SELECT count(*) FROM ${TABLE} b WHERE ST_DWithin(a.point, b.point, $2) ${among}) AS group_size,
              (SELECT array_agg(t.editions ORDER BY t.editions DESC)
                 FROM (SELECT b.editions FROM ${TABLE} b WHERE ST_DWithin(a.point, b.point, $2) AND b.editions > 0 ${among}
                       ORDER BY b.editions DESC LIMIT $3) t) AS top_editions,
              (SELECT array_agg(t.n ORDER BY t.n DESC)
                 FROM (SELECT b.guide_editions AS n FROM ${TABLE} b WHERE ST_DWithin(a.point, b.point, $2) AND b.guide_editions > 0 ${among}
                       ORDER BY b.guide_editions DESC LIMIT $3) t) AS top_guide,
              (SELECT array_agg(t.n ORDER BY t.n DESC)
                 FROM (SELECT b.readers AS n FROM ${TABLE} b WHERE ST_DWithin(a.point, b.point, $2) AND b.readers > 0 ${among}
                       ORDER BY b.readers DESC LIMIT $3) t) AS top_readers
         FROM ${TABLE} a WHERE a.qid = ANY($1::text[])`,
      [qids.slice(i, i + BATCH), metres, cut.best, ...extra],
    );
    for (const row of result.rows) {
      out.set(row.qid, {
        groupSize: Number(row.group_size), topEditions: row.top_editions ?? [], topGuideEditions: row.top_guide ?? [],
        topReaders: (row.top_readers ?? []).map(Number),
      });
    }
  }
  return out;
}
