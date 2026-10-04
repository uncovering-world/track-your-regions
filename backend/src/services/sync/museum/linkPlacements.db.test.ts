import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { reconcileLinks } from './linkWithdrawal.js';

/**
 * A work link records the memberships that place it, and a run takes away only
 * its own placement (#1252, ADR-0084), executed against PostgreSQL: which rows
 * the placement, the restore and the mark reach is decided in SQL.
 *
 * The fixture is the Louvre as Epic #755 will leave it: one place carrying an
 * Art Museums membership and an Archaeology membership, a painting Art Museums
 * places there, a find Archaeology places there, and a work both place. Ids
 * and references are the fixture's own, deleted before and after.
 */

const LOUVRE = 9460;
const LOUVRE_QID = 'Q9460-louvre-fixture';
const WORKS = { painting: 'Q9461-painting-fixture', find: 'Q9462-find-fixture', shared: 'Q9463-shared-fixture' };

let artMuseums = 0;
let archaeology = 0;
const work: Record<keyof typeof WORKS, number> = { painting: 0, find: 0, shared: 0 };

async function missing(): Promise<Record<string, boolean>> {
  const result = await pool.query<{ external_id: string; missing: boolean }>(
    `SELECT t.external_id, et.missing_since IS NOT NULL AS missing
       FROM experience_treasures et JOIN treasures t ON t.id = et.treasure_id
      WHERE et.experience_id = $1`,
    [LOUVRE],
  );
  return Object.fromEntries(result.rows.map(row => [row.external_id, row.missing]));
}

async function placers(ref: string): Promise<number[]> {
  const result = await pool.query<{ source_id: number }>(
    `SELECT m.source_id
       FROM experience_treasure_placements p
       JOIN experience_kind_memberships m ON m.id = p.membership_id
       JOIN experience_treasures et ON et.id = p.link_id
       JOIN treasures t ON t.id = et.treasure_id
      WHERE et.experience_id = $1 AND t.external_id = $2
      ORDER BY m.source_id`,
    [LOUVRE, ref],
  );
  return result.rows.map(row => row.source_id);
}

const run = (sourceId: number, offered: (keyof typeof WORKS)[]) => reconcileLinks(LOUVRE, {
  sourceId, offered: offered.map(name => work[name]), placedElsewhere: [], withdraw: true,
});

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [LOUVRE, LOUVRE_QID]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [Object.values(WORKS)]);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; kind_id: number; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name IN ('Art Museums', 'Archaeology')`,
  );
  const art = sources.rows.find(row => row.name === 'Art Museums')!;
  const arch = sources.rows.find(row => row.name === 'Archaeology')!;
  artMuseums = art.id;
  archaeology = arch.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Louvre Museum', ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326))`,
    [LOUVRE, artMuseums, LOUVRE_QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
     VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)`,
    [LOUVRE, art.kind_id, artMuseums, LOUVRE_QID, arch.kind_id, archaeology],
  );
  for (const [name, ref] of Object.entries(WORKS) as [keyof typeof WORKS, string][]) {
    const made = await pool.query<{ id: number }>(
      `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, $1, 'painting') RETURNING id`, [ref],
    );
    work[name] = made.rows[0].id;
    await pool.query(
      'INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [LOUVRE, work[name]],
    );
  }
  // Each source places its own work there, and both place the shared one.
  await run(artMuseums, ['painting', 'shared']);
  await run(archaeology, ['find', 'shared']);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a work link and the memberships that place it (ADR-0084)', () => {
  it('records every membership that places a work there, the shared work under both', async () => {
    expect(await placers(WORKS.painting)).toEqual([artMuseums]);
    expect(await placers(WORKS.find)).toEqual([archaeology]);
    expect(await placers(WORKS.shared)).toEqual([artMuseums, archaeology].sort((a, b) => a - b));
    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: false, [WORKS.shared]: false });
  });

  it('never marks the other source\'s works when a run reconciles its own', async () => {
    await run(artMuseums, ['painting', 'shared']);
    await run(archaeology, ['find', 'shared']);

    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: false, [WORKS.shared]: false });
  });

  it('keeps a shared work on show while the other source still places it', async () => {
    const delta = await run(archaeology, []);

    expect(delta.withdrawn.map(item => item.ref)).toEqual([WORKS.find]);
    expect(await placers(WORKS.shared)).toEqual([artMuseums]);
    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: true, [WORKS.shared]: false });
  });

  it('withdraws a link no membership places, as any run did before the placements', async () => {
    await pool.query(
      `DELETE FROM experience_treasure_placements
        WHERE link_id = (SELECT id FROM experience_treasures WHERE experience_id = $1 AND treasure_id = $2)`,
      [LOUVRE, work.find],
    );

    await run(artMuseums, ['painting', 'shared']);

    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: true, [WORKS.shared]: false });
  });

  it('marks a link once no membership places it, and gives it back when one does again', async () => {
    await run(archaeology, []);
    await run(artMuseums, ['painting']);
    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: true, [WORKS.shared]: true });

    const delta = await run(archaeology, ['shared']);
    expect(delta.returned.map(item => item.ref)).toEqual([WORKS.shared]);
    expect(await placers(WORKS.shared)).toEqual([archaeology]);
    expect(await missing()).toEqual({ [WORKS.painting]: false, [WORKS.find]: true, [WORKS.shared]: false });
  });
});
