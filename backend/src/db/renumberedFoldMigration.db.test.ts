/**
 * Migration 087's fold, executed against PostgreSQL on a shape the development
 * catalogue did not hold on the day it was written (ADR-0090 decision 4): a
 * property whose extension renumbered one component at its point and moved
 * another, the arrivals' deferral pointers crossed by position — the renumbered
 * component's arrival holding the moved one's old row, and the moved one's
 * arrival holding the renumbered one's. The fold must keep the renumbered row
 * and re-point the moved one's arrival to the row it really replaces, so that
 * publishing it withdraws the moved point and never the kept one.
 *
 * The migration is read from the repository (`db/` is mounted read-only beside
 * /app in the test stack) and run as `db:migrate` runs it, whole; its own
 * BEGIN/COMMIT make it one transaction. The fixture is one experience of its
 * own, deleted before and after.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { repoFile } from '../testSupport/repoFile.js';

const EXPERIENCE_ID = 9346;
const MIGRATION = readFileSync(repoFile('db', 'migrations', '087-a-renumbered-component-is-the-same-point.sql'), 'utf8');

interface Row { id: number; external_ref: string; curation_state: string; missing_since: Date | null; withdrawal_deferred_for_location_id: number | null; ordinal: number | null }
const rows = async () => (await pool.query<Row>(
  `SELECT id, external_ref, curation_state, missing_since, withdrawal_deferred_for_location_id, ordinal
     FROM experience_locations WHERE experience_id = $1 ORDER BY id`, [EXPERIENCE_ID])).rows;

async function point(ref: string, lon: number, state: string, ordinal: number | null, holds: number | null = null): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state, withdrawal_deferred_for_location_id)
     VALUES ($1, $2, $2, $3, ST_SetSRID(ST_MakePoint($4, 40.75), 4326), $5, $6) RETURNING id`,
    [EXPERIENCE_ID, ref, ordinal, lon, state, holds],
  );
  return result.rows[0].id;
}

async function reset(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [EXPERIENCE_ID]);
}

let ids: Record<string, number> = {};

beforeAll(async () => {
  await reset();
  const source = await pool.query<{ id: number }>(
    `SELECT id FROM experience_sources WHERE name = 'Places of worship' AND requires_curation`,
  );
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, 'fold-9346', 'Fold fixture', ST_SetSRID(ST_MakePoint(14.48, 40.75), 4326))`,
    [EXPERIENCE_ID, source.rows[0].id],
  );
  // Before the extension: two components, both visible, held by nothing yet.
  const pompeii = await point('9346bis-001', 14.48, 'auto', null);
  const villa = await point('9346bis-002', 14.50, 'auto', null);
  // After it: Pompeii renumbered at its point, the villa renumbered and moved
  // about 2.5 km — and the pointers crossed, as the position pairing crosses them.
  const pompeiiArrival = await point('9346ter-001', 14.48, 'pending', 1, villa);
  const villaArrival = await point('9346ter-002', 14.53, 'pending', 2, pompeii);
  ids = { pompeii, villa, pompeiiArrival, villaArrival };

  await pool.query(MIGRATION);
});

afterAll(async () => {
  await reset();
  await pool.end();
});

describe('migration 087 on crossed pointers', () => {
  it('keeps the renumbered row under its new reference and withdraws its arrival', async () => {
    const all = await rows();
    expect(all.find(r => r.id === ids.pompeii)).toMatchObject({ external_ref: '9346ter-001', ordinal: 1, missing_since: null, curation_state: 'auto' });
    const arrival = all.find(r => r.id === ids.pompeiiArrival)!;
    expect(arrival.missing_since).not.toBeNull();
    expect(arrival.withdrawal_deferred_for_location_id).toBeNull();
  });

  it('re-points the moved component’s arrival to the row it replaces, never the kept one', async () => {
    const all = await rows();
    expect(all.find(r => r.id === ids.villaArrival)).toMatchObject({ curation_state: 'pending', missing_since: null, withdrawal_deferred_for_location_id: ids.villa });
    expect(all.find(r => r.id === ids.villa)).toMatchObject({ external_ref: '9346bis-002', missing_since: null });
  });

  it('folds nothing a second time', async () => {
    const before = await rows();
    await pool.query(MIGRATION);
    expect(await rows()).toEqual(before);
  });
});
