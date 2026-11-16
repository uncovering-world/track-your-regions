import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { lockExperience } from '../../db/experienceWriter.js';
import { pool } from '../../db/index.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';
import { heldPartAnsweredSql, moveHeldDecisions, recordHeldAnswers } from './heldDecisions.js';

/**
 * A curator's answer to a held field of a serial site's part is keyed by the
 * part's record in the site (ADR-0213 decision 4, #2123), against PostgreSQL.
 * Ancient Thebes as its run writes it, with the Temple of Karnak and Luxor
 * Temple, and the two halves of a temple listed once per bank under one
 * number, as Maloti-Drakensberg lists Sehlabathebe and uKhahlamba under
 * 985ter-001. Ids are the fixture's own, deleted before and after.
 */

const THEBES = 9980;
/** A second listing of the same temples, folded into Thebes by a merge. */
const KARNAK_SITE = 9981;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const EAST_BANK = { name: 'Temple of the East Bank', externalRef: '87-005', lon: 32.6500, lat: 25.7000 };
const WEST_BANK = { name: 'Temple of the West Bank', externalRef: '87-005', lon: 32.6000, lat: 25.7300 };
const CURATOR = '00000000-0000-4000-8000-000000009980';

let run: LocationWriteRun;
let curator = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_held_decisions WHERE experience_id = ANY($1::int[])', [[THEBES, KARNAK_SITE]]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [KARNAK_SITE]);
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1) OR merged_into_id = $1',
    [THEBES],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [THEBES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: source.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9980', 'Ancient Thebes (held fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
    [THEBES, source.id],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9980', 'auto', NOW())`,
    [THEBES, source.kind_id, source.id],
  );
  curator = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await writeExperienceLocations(THEBES, [KARNAK, LUXOR, EAST_BANK, WEST_BANK], run);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** The part's record in Thebes under `ref`, of the part named `name`. */
async function recordOf(ref: string, name: string): Promise<number> {
  return (await pool.query<{ id: number }>(
    `SELECT rec.id FROM source_records rec JOIN experiences p ON p.id = rec.experience_id
      WHERE rec.whole_id = $1 AND rec.source_id = 10 AND rec.external_id = $2 AND p.name = $3`,
    [THEBES, ref, name],
  )).rows[0].id;
}

/** A curator refuses the held subtitle of the part a changeset names `ref` and `name`. */
async function refuseSubtitle(ref: string, name: string): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await recordHeldAnswers(client, THEBES, curator, 'refused',
      [{ row: { kind: 'locations', ref, name, field: 'subtitle' }, value: 'A temple on the Nile' }], null);
  } finally {
    client.release();
  }
}

/** Move `from`'s answers to `to`, as a merge or its undo does, under both objects' locks. */
async function moveAnswers(from: number, to: number, only?: number[]): Promise<number[]> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const [a, b] = [await lockExperience(client, from), await lockExperience(client, to)];
    const moved = await moveHeldDecisions(client, a!.lock, b!.lock, only);
    await client.query('COMMIT');
    return moved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Whether a changeset entry naming `ref` and `name`, proposing the refused subtitle, is answered. */
async function answered(ref: string, name: string): Promise<boolean> {
  return (await pool.query<{ answered: boolean }>(
    `SELECT ${heldPartAnsweredSql('$1::int', "'locations'", 'c', 'f')} AS answered
       FROM (SELECT $2::jsonb AS c, $3::jsonb AS f) entry`,
    [THEBES, JSON.stringify({ item: { ref, name } }),
      JSON.stringify({ field: 'subtitle', new: 'A temple on the Nile', held: true })],
  )).rows[0].answered;
}

describe("a held field of a serial site's part is answered by its record (ADR-0213 decision 4)", () => {
  it('stores the record the entry names', async () => {
    await refuseSubtitle(LUXOR.externalRef, LUXOR.name);

    const stored = await pool.query<{ record_id: number | null }>(
      'SELECT record_id FROM experience_held_decisions WHERE experience_id = $1', [THEBES],
    );
    expect(stored.rows).toEqual([{ record_id: await recordOf(LUXOR.externalRef, LUXOR.name) }]);
  });

  it('keeps the answer when the list renumbers and renames the line', async () => {
    await refuseSubtitle(LUXOR.externalRef, LUXOR.name);
    // The record follows its line: a later list gives Luxor Temple another number and a fuller name.
    await pool.query(
      `UPDATE source_records SET external_id = '87-012', reported_name = 'Luxor Temple of Amun'
        WHERE id = $1`, [await recordOf(LUXOR.externalRef, LUXOR.name)],
    );

    expect(await answered('87-012', 'Luxor Temple of Amun')).toBe(true);
    expect(await answered(KARNAK.externalRef, KARNAK.name)).toBe(false);
  });

  it('asks about each of two parts listed under one number, answered apart', async () => {
    await refuseSubtitle(EAST_BANK.externalRef, EAST_BANK.name);

    expect(await answered(EAST_BANK.externalRef, EAST_BANK.name)).toBe(true);
    expect(await answered(WEST_BANK.externalRef, WEST_BANK.name)).toBe(false);

    await refuseSubtitle(WEST_BANK.externalRef, WEST_BANK.name);
    const stored = await pool.query<{ record_id: number }>(
      'SELECT record_id FROM experience_held_decisions WHERE experience_id = $1 ORDER BY record_id', [THEBES],
    );
    expect(stored.rows.map(row => row.record_id)).toEqual(
      [await recordOf(EAST_BANK.externalRef, EAST_BANK.name), await recordOf(WEST_BANK.externalRef, WEST_BANK.name)]
        .sort((a, b) => a - b),
    );
  });

  it('replaces the standing answer of a record, whatever the part was called', async () => {
    await refuseSubtitle(LUXOR.externalRef, LUXOR.name);
    await pool.query(
      "UPDATE source_records SET reported_name = 'Luxor Temple of Amun' WHERE id = $1",
      [await recordOf(LUXOR.externalRef, LUXOR.name)],
    );
    await refuseSubtitle(LUXOR.externalRef, 'Luxor Temple of Amun');

    const stored = await pool.query<{ part_name: string }>(
      'SELECT part_name FROM experience_held_decisions WHERE experience_id = $1', [THEBES],
    );
    expect(stored.rows).toEqual([{ part_name: 'Luxor Temple of Amun' }]);
  });

  it('matches an entry no record answers by its name, as before', async () => {
    await refuseSubtitle('87-099', 'A chapel no record names');

    expect(await answered('87-099', 'A chapel no record names')).toBe(true);
    const stored = await pool.query<{ record_id: number | null }>(
      'SELECT record_id FROM experience_held_decisions WHERE experience_id = $1', [THEBES],
    );
    expect(stored.rows).toEqual([{ record_id: null }]);
  });

  it("keys a folded site's answer by the survivor's record of the same part, and back on the undo", async () => {
    const thebesLuxor = await recordOf(LUXOR.externalRef, LUXOR.name);
    const part = (await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM source_records WHERE id = $1', [thebesLuxor],
    )).rows[0].experience_id;
    // A second site records the same Luxor Temple under its own record, and a curator refused its subtitle there.
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, '9981', 'Karnak and Luxor (held fixture)', ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
      [KARNAK_SITE, run.sourceId],
    );
    const folded = (await pool.query<{ id: number }>(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, 10, $3, 'auto', NOW()) RETURNING id`,
      [part, KARNAK_SITE, LUXOR.externalRef],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO experience_held_decisions (experience_id, part_kind, part_ref, part_name, field, answer, value, decided_by, record_id)
       VALUES ($1, 'locations', $2, $3, 'subtitle', 'refused', '"A temple on the Nile"', $4, $5)`,
      [KARNAK_SITE, LUXOR.externalRef, LUXOR.name, curator, folded],
    );

    // The merge leaves the folded site's record where it is; the answer goes to Thebes, keyed by Thebes' record.
    const moved = await moveAnswers(KARNAK_SITE, THEBES);
    const onThebes = await pool.query<{ record_id: number }>(
      'SELECT record_id FROM experience_held_decisions WHERE experience_id = $1', [THEBES],
    );
    expect(onThebes.rows).toEqual([{ record_id: thebesLuxor }]);
    expect(await answered(LUXOR.externalRef, LUXOR.name)).toBe(true);

    // The undo takes it back to the folded site's own record.
    await moveAnswers(THEBES, KARNAK_SITE, moved);
    const back = await pool.query<{ experience_id: number; record_id: number }>(
      'SELECT experience_id, record_id FROM experience_held_decisions WHERE id = ANY($1::int[])', [moved],
    );
    expect(back.rows).toEqual([{ experience_id: KARNAK_SITE, record_id: folded }]);
  });
});
