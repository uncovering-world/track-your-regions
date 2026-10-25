import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { reviewQueueQuerySchema } from '../../types/index.js';
import { CURATOR_REFUSAL_REASON } from './curatorRefusalController.js';
import { keepOutUnderLock, listPlaceKinds } from './keepOutController.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';
import { getReviewQueue } from './reviewQueueController.js';

/**
 * A curator taking a published place out of one of its kinds from the place's
 * card (#2022), executed against PostgreSQL: where each kind stands, the
 * refusal under the place's lock, the way back, and what is refused.
 *
 * The fixture is the Temple of Concord as it stood on 2026-10-25: offered by
 * Places of worship and by Archaeology, and judged not worth a visit (only the
 * podium is left), with no run's question to answer. Ids are the fixture's
 * own, deleted before and after.
 */

const CONCORD = 9772;
const QID = 'Q9772-concord-fixture';
const NAME = 'Temple of Concord (keep-out fixture)';
const ADMIN = '00000000-0000-4000-8000-000000009772';
const CURATOR = '00000000-0000-4000-8000-000000009773';

let adminId = 0;
let curatorId = 0;
let archaeology = 0;
let worship = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [CONCORD]);
  await pool.query('DELETE FROM curator_assignments WHERE assigned_by IN (SELECT id FROM users WHERE uuid = $1)', [ADMIN]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN, CURATOR]]);
}

const membership = async (source: string, curationState: 'auto' | 'pending'): Promise<number> => (await pool.query<{ id: number }>(
  `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
   SELECT $1, s.kind_id, s.id, $2, $3, $5
     FROM experience_sources s WHERE s.name = $4 RETURNING id`,
  [CONCORD, QID, curationState, source, curationState === 'pending' ? null : new Date()],
)).rows[0].id;

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  curatorId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.4844, 41.8930), 4326)
       FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [CONCORD, QID, NAME],
  );
  archaeology = await membership('Archaeology', 'auto');
  worship = await membership('Places of worship', 'auto');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

/** Places of worship as an arrival nobody has passed: a gate state no run moves a passed row back to. */
const arriving = async (): Promise<void> => {
  await pool.query('DELETE FROM experience_kind_memberships WHERE id = $1', [worship]);
  worship = await membership('Places of worship', 'pending');
};

const caller = () => ({ id: adminId, role: 'admin' } as Express.User);
const kinds = async () => (await listPlaceKinds({ params: { id: CONCORD }, caller: caller() })).kinds;
const keepOut = (membershipId: number) =>
  keepOutUnderLock(CONCORD, adminId, null, { membershipId, note: 'Not a must: only the podium is left' });

describe('where each kind of a place stands', () => {
  it('lists every kind, offered, each one the caller may answer', async () => {
    expect((await kinds()).map(k => [k.membershipId, k.state, k.canAnswer]).sort())
      .toEqual([[archaeology, 'offered', true], [worship, 'offered', true]].sort());
  });

  it("refuses a curator whose scope does not reach the place, and a place that does not exist", async () => {
    await pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by)
       SELECT $1, 'source', s.id, $2 FROM experience_sources s WHERE s.name = 'Art Museums'`,
      [curatorId, adminId],
    );
    await expect(listPlaceKinds({ params: { id: CONCORD }, caller: { id: curatorId, role: 'curator' } as Express.User }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(listPlaceKinds({ params: { id: CONCORD + 1 }, caller: caller() }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('says an arrival is waiting', async () => {
    await arriving();
    expect((await kinds()).find(k => k.membershipId === worship)).toMatchObject({ state: 'waiting', reason: null });
  });
});

describe('taking a published place out of one kind', () => {
  it('refuses that membership as a curator does, pinned, and leaves the other kind offered', async () => {
    expect((await keepOut(archaeology)).result).toEqual({ experienceId: CONCORD, membershipId: archaeology, admission: 'refused' });

    const row = (await pool.query<{ admission: string; pinned: boolean; admission_reason: string }>(
      "SELECT admission, curated_fields ? 'admission' AS pinned, admission_reason FROM experience_kind_memberships WHERE id = $1",
      [archaeology],
    )).rows[0];
    expect(row).toEqual({ admission: 'refused', pinned: true, admission_reason: CURATOR_REFUSAL_REASON });

    const log = await pool.query(
      "SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'kept_out'", [CONCORD],
    );
    expect(log.rows.map(r => r.details)).toEqual([{
      membershipId: archaeology, kind: 'Archaeology', reason: CURATOR_REFUSAL_REASON, note: 'Not a must: only the podium is left',
    }]);

    expect(await kinds()).toEqual(expect.arrayContaining([
      expect.objectContaining({ membershipId: worship, state: 'offered', note: null }),
      expect.objectContaining({
        membershipId: archaeology, state: 'kept-out', reason: CURATOR_REFUSAL_REASON,
        note: 'Not a must: only the podium is left', curatorName: 'An admin', answeredAt: expect.any(String),
      }),
    ]));
  });

  it("is in the review page's kept-out list, with the curator's words", async () => {
    await keepOut(archaeology);
    const read = await getReviewQueue({ query: reviewQueueQuerySchema.parse({ q: NAME }), caller: caller() });
    expect(read.keptOut).toEqual([expect.objectContaining({
      id: CONCORD, membership_id: archaeology, admission_reason: CURATOR_REFUSAL_REASON,
      state_note: 'Not a must: only the podium is left',
    })]);
  });

  it('is put back by the override every pinned refusal has', async () => {
    await keepOut(archaeology);
    expect((await answerAdmissionUnderLock(CONCORD, adminId, null, { decision: 'override', membershipId: archaeology })).result)
      .toMatchObject({ admission: 'admitted' });
    expect((await kinds()).find(k => k.membershipId === archaeology)).toMatchObject({ state: 'offered' });
  });

  it('refuses a membership already taken out, with nothing written', async () => {
    await keepOut(archaeology);
    expect((await keepOut(archaeology)).refusal).toMatchObject({ status: 409 });
    const log = await pool.query(
      "SELECT count(*)::int AS n FROM experience_curation_log WHERE experience_id = $1 AND action = 'kept_out'", [CONCORD],
    );
    expect(log.rows[0].n).toBe(1);
  });

  it('refuses an arrival, which has its own no', async () => {
    await arriving();
    expect((await keepOut(worship)).refusal).toMatchObject({ status: 409 });
  });

  it("refuses another place's membership", async () => {
    expect((await keepOutUnderLock(CONCORD + 1, adminId, null, { membershipId: archaeology })).refusal)
      .toMatchObject({ status: 404 });
  });
});
