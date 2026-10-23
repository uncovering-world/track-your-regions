import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { refusedOpenSql } from './reviewQueuePredicates.js';

/**
 * A kind's refusal of a place another kind offers asks nothing (#1838),
 * against PostgreSQL. The fixture is Reims Cathedral as the development
 * catalogue held it on 2026-10-22: refused by Archaeology ("in use today"),
 * offered under Places of worship. The place is found by its source and the
 * fixture's own item, deleted before and after, so its id is whatever the
 * insert gives and no other fixture's.
 */

const QID = 'Q-reims-refusal-fixture';
let reims = 0;

let archaeologyMembership = 0;
let worshipMembership = 0;

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences WHERE external_id = $1
        AND source_id = (SELECT id FROM experience_sources WHERE name = 'Archaeology')`,
    [QID],
  );
}

async function member(source: string, admission: string, read = true): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, admission)
     SELECT $1, s.kind_id, s.id, $2, CASE WHEN $5::boolean THEN 'verified' ELSE 'pending' END, CASE WHEN $5::boolean THEN NOW() END, $3
       FROM experience_sources s WHERE s.name = $4 RETURNING id`,
    [reims, QID, admission, source, read],
  )).rows[0].id;
}

/** Whether Archaeology's refusal asks a curator anything. */
const asked = async () => (await pool.query<{ open: boolean }>(
  `SELECT (${refusedOpenSql('m')}) AS open FROM experience_kind_memberships m WHERE m.id = $1`, [archaeologyMembership],
)).rows[0].open;

beforeEach(async () => {
  await clear();
  reims = (await pool.query<{ id: number }>(
    `INSERT INTO experiences (source_id, external_id, name, location)
     SELECT s.id, $1, 'Reims Cathedral', ST_SetSRID(ST_MakePoint(4.0341, 49.2536), 4326)
       FROM experience_sources s WHERE s.name = 'Archaeology' RETURNING id`,
    [QID],
  )).rows[0].id;
  archaeologyMembership = await member('Archaeology', 'refused');
  worshipMembership = await member('Places of worship', 'admitted');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a kind's refusal of a place another kind offers (#1838)", () => {
  it('asks nothing while the other kind offers the place, and writes nothing to say so', async () => {
    expect(await asked()).toBe(false);
    const row = await pool.query<{ admission: string; pinned: boolean; answered_at: Date | null }>(
      `SELECT admission, curated_fields ? 'admission' AS pinned, admission_answered_at AS answered_at
         FROM experience_kind_memberships WHERE id = $1`, [archaeologyMembership],
    );
    expect(row.rows[0]).toEqual({ admission: 'refused', pinned: false, answered_at: null });
  });

  it('asks nothing while the other kind\'s source has stopped listing the place and nobody has judged it', async () => {
    // Readers still find the place under Places of worship until a curator
    // answers the missing card (placeKindsSql).
    await pool.query('UPDATE experience_kind_memberships SET missing_since = NOW() WHERE id = $1', [worshipMembership]);
    expect(await asked()).toBe(false);
  });

  it('asks again once the other kind refuses the place too', async () => {
    await pool.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE id = $1", [worshipMembership]);
    expect(await asked()).toBe(true);
  });

  it('asks while the other kind holds the place unread', async () => {
    await pool.query('DELETE FROM experience_kind_memberships WHERE id = $1', [worshipMembership]);
    worshipMembership = await member('Places of worship', 'admitted', false);
    expect(await asked()).toBe(true);
  });
});
