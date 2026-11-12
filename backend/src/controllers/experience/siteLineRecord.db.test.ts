import type { PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { pointItemClaimedSql, pointItemSql } from '../../db/placePoints.js';
import { claimPointItem, releasePointItem } from './experienceLocationWriter.js';
import { recordComponentItems, writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';

/**
 * A World Heritage site's own list line is a record (ADR-0200), against
 * PostgreSQL: World Heritage components' record of the site in itself, under
 * the line's reference, which holds the line's place in the list, its view
 * and its Wikidata item, and makes no part. The fixture is a site of one
 * component shaped as Kakadu National Park is listed (147quater-001), which a
 * later list gives a second component; ids are the fixture's own, deleted
 * before and after.
 */

const SITE = 9864;
const LINE = { name: 'Kakadu National Park (East Alligator)', externalRef: '9864quater-001', lon: 132.80, lat: -12.43 };
const SECOND = { name: 'Kakadu National Park (South Alligator)', externalRef: '9864quater-002', lon: 132.40, lat: -13.30 };
const ITEM = 'Q98641';
const CHOSEN = 'Q98642';
const NOTHING = { imageUrl: null, credit: null, description: null, articleUrl: null };

let run: LocationWriteRun;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [SITE]);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

/** World Heritage components' records in the site: the site's own and its parts'. */
const records = async () => (await pool.query<{
  id: number; experience_id: number; external_id: string; listing_ordinal: number | null; reported_name: string | null;
  items: string[] | null; claims: string[];
}>(
  `SELECT id, experience_id, external_id, listing_ordinal, reported_name, wikidata_items AS items, curated_fields AS claims
     FROM source_records WHERE source_id = 10 AND whole_id = $1 ORDER BY external_id`, [SITE],
)).rows;

/** The line's point, its item and a curator's claim on it, as every reader reads them. */
const line = async (ref = LINE.externalRef) => (await pool.query<{
  id: number; experience_id: number; ordinal: number | null; item: string | null; claimed: boolean;
}>(
  `SELECT el.id, el.experience_id, el.ordinal, ${pointItemSql('el')} AS item, ${pointItemClaimedSql('el')} AS claimed
     FROM experience_locations el
    WHERE el.external_ref = $1 AND el.merged_into_id IS NULL
      AND (el.experience_id = $2 OR el.experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $2))`,
  [ref, SITE],
)).rows[0];

/** `work` under the site's lock, committed, as a curator's answer runs. */
async function underLock<T>(work: (client: PoolClient, lock: LockedExperience) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, SITE);
    const result = await work(client, locked!.lock);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await clear();
  const heritage = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: heritage.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9864', 'Kakadu National Park (site line fixture)', ST_SetSRID(ST_MakePoint(132.80, -12.43), 4326))`,
    [SITE, heritage.id],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9864', 'auto', NOW())`,
    [SITE, heritage.kind_id, heritage.id],
  );
  await writeExperienceLocations(SITE, [LINE], run);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a site's own list line (ADR-0200)", () => {
  it('is the site\'s record of itself under the line\'s reference, with its place in the list and its view, and makes no part', async () => {
    const point = await line();
    expect(point.experience_id).toBe(SITE);
    expect(await records()).toEqual([expect.objectContaining({
      experience_id: SITE, external_id: LINE.externalRef, listing_ordinal: point.ordinal, reported_name: LINE.name,
    })]);
    const parts = await pool.query('SELECT 1 FROM experience_parts WHERE whole_id = $1 OR part_id = $1', [SITE]);
    expect(parts.rowCount).toBe(0);

    // The same list again changes nothing on the record.
    const before = await records();
    await writeExperienceLocations(SITE, [LINE], run);
    expect(await records()).toEqual(before);
  });

  it("holds the line's item, which the registry makes the site's, and a curator's item against the run", async () => {
    expect(await recordComponentItems(SITE, [{ ref: LINE.externalRef, item: ITEM }], run.sourceId)).toBe(1);
    expect(await line()).toMatchObject({ item: ITEM, claimed: false });
    const registry = await pool.query<{ identifies: boolean; basis: string[] }>(
      `SELECT identifies, basis FROM place_identifiers WHERE experience_id = $1 AND scheme = 'wikidata' AND value = $2`,
      [SITE, ITEM],
    );
    expect(registry.rows).toEqual([{ identifies: true, basis: ['component-item'] }]);

    const point = await line();
    expect(await underLock((client, lock) => claimPointItem(client, lock, point.id, CHOSEN, NOTHING))).toEqual({ recorded: true, pictured: false });
    expect(await line()).toMatchObject({ item: CHOSEN, claimed: true });
    expect(await recordComponentItems(SITE, [{ ref: LINE.externalRef, item: ITEM }], run.sourceId)).toBe(0);
    expect(await line()).toMatchObject({ item: CHOSEN, claimed: true });

    expect(await underLock((client, lock) => releasePointItem(client, lock, point.id))).toEqual([]);
    expect(await line()).toMatchObject({ item: null, claimed: false });
  });

  it("goes with its line to the part a second component makes of it, the item and the curator's claim with it", async () => {
    const point = await line();
    await underLock((client, lock) => claimPointItem(client, lock, point.id, CHOSEN, NOTHING));
    const [own] = await records();

    await writeExperienceLocations(SITE, [LINE, SECOND], run);

    const parted = await line();
    expect(parted.experience_id).not.toBe(SITE);
    expect(parted).toMatchObject({ item: CHOSEN, claimed: true });
    const after = await records();
    expect(after.map(rec => [rec.external_id, rec.experience_id === SITE])).toEqual([
      [LINE.externalRef, false], [SECOND.externalRef, false],
    ]);
    // The same record, adopted rather than made again.
    expect(after[0]).toMatchObject({ id: own.id, experience_id: parted.experience_id, items: [CHOSEN] });
  });

  it('gives a point no line\'s record stands for no confirmed item', async () => {
    const bare = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, location)
       VALUES ($1, 'Kakadu National Park', ST_SetSRID(ST_MakePoint(132.5, -12.9), 4326)) RETURNING id`, [SITE],
    )).rows[0].id;
    expect(await underLock((client, lock) => claimPointItem(client, lock, bare, CHOSEN, NOTHING))).toEqual({ recorded: false, pictured: false });
  });
});


describe('a site that shows two lines of its own, as Ohrid does (ADR-0200)', () => {
  // Both points named as the site stand for the whole site and are parted from
  // nothing; the line the site shows is the first the list gives.
  const NORTH = { ...LINE, name: 'Lake Ohrid (site line fixture)' };
  const SOUTH = { ...SECOND, name: 'Lake Ohrid (site line fixture)' };

  beforeEach(async () => {
    await pool.query(`UPDATE experiences SET name = 'Lake Ohrid (site line fixture)' WHERE id = $1`, [SITE]);
    await writeExperienceLocations(SITE, [NORTH, SOUTH], run);
    expect(await records()).toEqual([expect.objectContaining({ experience_id: SITE, external_id: NORTH.externalRef })]);
  });

  it('moves the record to the other line without the first line\'s item when the list gives that line first', async () => {
    expect(await recordComponentItems(SITE, [{ ref: NORTH.externalRef, item: ITEM }], run.sourceId)).toBe(1);

    await writeExperienceLocations(SITE, [SOUTH, NORTH], run);

    expect(await records()).toEqual([expect.objectContaining({ external_id: SOUTH.externalRef, items: null })]);
    expect(await line(NORTH.externalRef)).toMatchObject({ item: null, claimed: false });
    expect(await line(SOUTH.externalRef)).toMatchObject({ item: null, claimed: false });
  });

  it("keeps a curator's item on the line it was chosen for, and moves it to no other", async () => {
    const north = await line(NORTH.externalRef);
    await underLock((client, lock) => claimPointItem(client, lock, north.id, CHOSEN, NOTHING));

    await writeExperienceLocations(SITE, [SOUTH, NORTH], run);

    expect(await records()).toEqual([expect.objectContaining({ external_id: NORTH.externalRef, items: [CHOSEN] })]);
    expect(await line(NORTH.externalRef)).toMatchObject({ item: CHOSEN, claimed: true });
    expect(await line(SOUTH.externalRef)).toMatchObject({ item: null, claimed: false });
  });
});
