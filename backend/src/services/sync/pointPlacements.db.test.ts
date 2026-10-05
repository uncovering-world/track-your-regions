import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * A point records the memberships that place it, and a run withdraws only its
 * own (#1256, ADR-0084), executed against PostgreSQL: which rows the pairing,
 * the placement and the withdrawal reach is decided in SQL.
 *
 * The fixture is the Cave of Altamira as Epic #755 will leave it: one place
 * that Public Art & Monuments and Archaeology both fill, each with a point of
 * its own 752 m apart, as the two rows stand on the development catalogue
 * today. Wikidata holds two coordinates for the cave, one of them rounded to
 * the arc-minute, and each source reads a different one. Ids and references
 * are the fixture's own, deleted before and after.
 */

const ALTAMIRA = 9470;
const QID = 'Q9470-altamira-fixture';
const PRECISE = { name: null, externalRef: 'Q9470-precise', lon: -4.11975, lat: 43.376944 };
const ROUNDED = { name: null, externalRef: 'Q9470-rounded', lon: -4.11667, lat: 43.38333 };

let publicArt = 0;
let archaeology = 0;

const run = (sourceId: number) => ({ syncLogId: null, sourceId });

async function offered(): Promise<Record<string, boolean>> {
  const result = await pool.query<{ external_ref: string; offered: boolean }>(
    `SELECT external_ref, missing_since IS NULL AS offered FROM experience_locations WHERE experience_id = $1`,
    [ALTAMIRA],
  );
  return Object.fromEntries(result.rows.map(row => [row.external_ref, row.offered]));
}

async function placers(ref: string): Promise<number[]> {
  const result = await pool.query<{ source_id: number }>(
    `SELECT m.source_id
       FROM experience_location_placements p
       JOIN experience_kind_memberships m ON m.id = p.membership_id
       JOIN experience_locations el ON el.id = p.location_id
      WHERE el.experience_id = $1 AND el.external_ref = $2
      ORDER BY m.source_id`,
    [ALTAMIRA, ref],
  );
  return result.rows.map(row => row.source_id);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [ALTAMIRA, QID]);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; kind_id: number; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name IN ('Public Art & Monuments', 'Archaeology')`,
  );
  const art = sources.rows.find(row => row.name === 'Public Art & Monuments')!;
  const arch = sources.rows.find(row => row.name === 'Archaeology')!;
  publicArt = art.id;
  archaeology = arch.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Cave of Altamira', ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [ALTAMIRA, publicArt, QID, ROUNDED.lon, ROUNDED.lat],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
     VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)`,
    [ALTAMIRA, art.kind_id, publicArt, QID, arch.kind_id, archaeology],
  );
  // Each source has written its own point once.
  await writeExperienceLocations(ALTAMIRA, [ROUNDED], run(publicArt));
  await writeExperienceLocations(ALTAMIRA, [PRECISE], run(archaeology));
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a point and the memberships that place it (ADR-0084)', () => {
  it('records each source on its own point, and neither run withdraws the other\'s', async () => {
    expect(await placers(ROUNDED.externalRef)).toEqual([publicArt]);
    expect(await placers(PRECISE.externalRef)).toEqual([archaeology]);

    await writeExperienceLocations(ALTAMIRA, [ROUNDED], run(publicArt));
    await writeExperienceLocations(ALTAMIRA, [PRECISE], run(archaeology));

    expect(await offered()).toEqual({ [ROUNDED.externalRef]: true, [PRECISE.externalRef]: true });
  });

  it('withdraws a source\'s own point when it stops offering it, and only that one', async () => {
    const result = await writeExperienceLocations(ALTAMIRA, [], run(archaeology));

    expect(result.delta.withdrawn.map(point => point.ref)).toEqual([PRECISE.externalRef]);
    expect(await offered()).toEqual({ [ROUNDED.externalRef]: true, [PRECISE.externalRef]: false });
  });

  it('keeps a point both sources place while one of them still does', async () => {
    await writeExperienceLocations(ALTAMIRA, [PRECISE, ROUNDED], run(archaeology));
    expect(await placers(ROUNDED.externalRef)).toEqual([publicArt, archaeology].sort((a, b) => a - b));

    await writeExperienceLocations(ALTAMIRA, [], run(publicArt));

    expect(await placers(ROUNDED.externalRef)).toEqual([archaeology]);
    expect(await offered()).toEqual({ [ROUNDED.externalRef]: true, [PRECISE.externalRef]: true });
  });

  it('lets two sources number their lists from 1 on one place', async () => {
    const ordinals = await pool.query<{ external_ref: string; ordinal: number }>(
      'SELECT external_ref, ordinal FROM experience_locations WHERE experience_id = $1 ORDER BY external_ref',
      [ALTAMIRA],
    );
    expect(ordinals.rows).toEqual([
      { external_ref: PRECISE.externalRef, ordinal: 1 },
      { external_ref: ROUNDED.externalRef, ordinal: 1 },
    ]);
  });
});
