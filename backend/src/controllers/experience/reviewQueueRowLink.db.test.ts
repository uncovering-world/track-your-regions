import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { queryQueueKeys } from './reviewQueueKeys.js';

/**
 * A link into the review queue lands on its row past the first page (#843),
 * executed against PostgreSQL.
 *
 * Five places a gated Archaeology run brought and nobody has passed, each one
 * waiting question with no run to date it, so the order is the id within one
 * rank. A page holds two. Ids are the fixture's own, deleted before and after.
 */

const NAMES = ['Ostia Antica', 'Herculaneum', 'Paestum', 'Segesta', 'Selinunte'];
const IDS = NAMES.map((_, i) => 9610 + i);
const TAG = '(row-link fixture)';
const ADMIN_UUID = '00000000-0000-4000-8000-000000009610';

let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [IDS]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN_UUID]);
}

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN_UUID],
  );
  adminId = user.rows[0].id;
  for (const [i, id] of IDS.entries()) {
    const qid = `Q${id}-row-link-fixture`;
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.3 + $4::int * 0.5, 41.7), 4326)
         FROM experience_sources s WHERE s.name = 'Archaeology'`,
      [id, qid, `${NAMES[i]} ${TAG}`, i],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state)
       SELECT $1, s.kind_id, s.id, $2, 'pending' FROM experience_sources s WHERE s.name = 'Archaeology'`,
      [id, qid],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const page = (over: Record<string, unknown>) => queryQueueKeys({
  userId: adminId, isAdmin: true, filters: { q: TAG, sort: 'date' as const, limit: 2, ...over },
});

describe("a link to a row past the queue's first page (#843)", () => {
  it('opens the page one key before the row, and pages on from there', async () => {
    const linked = await page({ row: { kind: 'waiting', id: IDS[3] } });

    expect(linked.keys.map(k => k.id)).toEqual([IDS[2], IDS[3]]);
    expect(linked.total).toBe(5);
    const next = await page({ cursor: linked.nextCursor! });
    expect(next.keys.map(k => k.id)).toEqual([IDS[4]]);
    expect(next.nextCursor).toBeNull();
  });

  it('opens a page of one at the row itself, with no room for the one before it', async () => {
    const linked = await page({ limit: 1, row: { kind: 'waiting', id: IDS[3] } });
    expect(linked.keys.map(k => k.id)).toEqual([IDS[3]]);
    expect(linked.from).not.toBeNull();
  });

  it('opens at the row itself when it is the first, and says the page is the top', async () => {
    const linked = await page({ row: { kind: 'waiting', id: IDS[0] } });
    expect(linked.keys.map(k => k.id)).toEqual([IDS[0], IDS[1]]);
    expect(linked.from).toBeNull();
  });

  it('stays where it opened once the linked row is answered (#843)', async () => {
    const linked = await page({ row: { kind: 'waiting', id: IDS[3] } });
    expect(linked.from).not.toBeNull();

    // A curator answers the row the link named: published, it asks nothing.
    await pool.query("UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1", [IDS[3]]);
    const again = await page({ from: linked.from!, row: { kind: 'waiting', id: IDS[3] } });

    expect(again.keys.map(k => k.id)).toEqual([IDS[2], IDS[4]]);
    expect(again.from).toBe(linked.from);
  });

  it("opens at the list's top when the filters leave the row out", async () => {
    const outside = await page({ row: { kind: 'waiting', id: 1 } });
    expect(outside.keys.map(k => k.id)).toEqual([IDS[0], IDS[1]]);

    const answered = await page({ row: { kind: 'missing', id: IDS[3] } });
    expect(answered.keys.map(k => k.id)).toEqual([IDS[0], IDS[1]]);
  });

  it('follows the cursor and not the row once there is one', async () => {
    const first = await page({});
    const second = await page({ cursor: first.nextCursor!, row: { kind: 'waiting', id: IDS[0] } });
    expect(second.keys.map(k => k.id)).toEqual([IDS[2], IDS[3]]);
  });
});
