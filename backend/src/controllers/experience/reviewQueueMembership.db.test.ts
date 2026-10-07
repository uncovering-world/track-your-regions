import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { queryQueueKeys } from './reviewQueueKeys.js';
import { getReviewQueue } from './reviewQueueController.js';
import { publishUnderLock } from './publishController.js';
import { refuseContentsUnderLock } from './curatorRefusalController.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';
import { reviewQueueQuerySchema } from '../../types/index.js';

/**
 * The review queue asks a waiting question of every membership of a place
 * (#1264), executed against PostgreSQL.
 *
 * The fixture is the Capitoline Museums as Epic #755 will leave them: a place
 * readers already see as an art museum, and an Archaeology membership a gated
 * run has just brought and nobody has passed. Before #1264 the queue joined the
 * membership the place's first source brought, so that arrival was asked about
 * nowhere. Ids are the fixture's own, deleted before and after.
 */

const PLACE = 9600;
const NAME = 'Capitoline Museums (queue fixture)';
const QID = 'Q9600-capitoline-queue-fixture';
const ADMIN_UUID = '00000000-0000-4000-8000-000000009600';
const CURATOR_UUID = '00000000-0000-4000-8000-000000009601';

let adminId = 0;
let curatorId = 0;
let archaeologySource = 0;
let artSource = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  await pool.query(
    `DELETE FROM curator_assignments WHERE assigned_by IN (SELECT id FROM users WHERE uuid = ANY($1::text[]))`,
    [[ADMIN_UUID, CURATOR_UUID]],
  );
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN_UUID, CURATOR_UUID]]);
}

async function sourceId(name: string): Promise<number> {
  const result = await pool.query<{ id: number }>('SELECT id FROM experience_sources WHERE name = $1', [name]);
  return result.rows[0].id;
}

beforeEach(async () => {
  await clear();
  archaeologySource = await sourceId('Archaeology');
  artSource = await sourceId('Art Museums');
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin'), ($2, 'A curator', 'curator')
     RETURNING id`,
    [ADMIN_UUID, CURATOR_UUID],
  );
  [adminId, curatorId] = users.rows.map(row => row.id);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(12.48278, 41.89306), 4326))`,
    [PLACE, artSource, QID, NAME],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, v.state, CASE WHEN v.state = 'auto' THEN NOW() END
       FROM (VALUES ('Art Museums', 'auto'), ('Archaeology', 'pending')) AS v(source, state)
       JOIN experience_sources s ON s.name = v.source`,
    [PLACE, QID],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const filters = (over: Record<string, unknown> = {}) => ({ q: NAME, sort: 'date' as const, limit: 25, ...over });

/** Palazzo Nuovo, one of the museums' two palaces, arriving as a point nobody has read. */
async function unreadPoint(): Promise<number> {
  const point = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, location, curation_state)
     VALUES ($1, 'Palazzo Nuovo', ST_SetSRID(ST_MakePoint(12.48258, 41.89338), 4326), 'pending')
     RETURNING id`,
    [PLACE],
  );
  return point.rows[0].id;
}

async function membershipOf(source: number): Promise<number> {
  const result = await pool.query<{ id: number }>(
    'SELECT id FROM experience_kind_memberships WHERE experience_id = $1 AND source_id = $2', [PLACE, source],
  );
  return result.rows[0].id;
}

describe('a waiting question of each membership (#1264)', () => {
  it('asks about the arrival a second kind brought, whichever source brought the place', async () => {
    const { keys, facets } = await queryQueueKeys({ userId: adminId, isAdmin: true, filters: filters() });

    expect(keys).toEqual([expect.objectContaining({ kind: 'waiting', id: PLACE, subs: ['arrival'] })]);
    // Counted under the source that asks, not the one that brought the place.
    const counted = Object.fromEntries(facets.source.map(source => [source.id, source.count]));
    expect(counted[archaeologySource]).toBe(1);
    expect(counted[artSource]).toBe(0);
  });

  it('finds it under the source that asks, and not under the one that does not', async () => {
    const archaeology = await queryQueueKeys({
      userId: adminId, isAdmin: true, filters: filters({ sourceIds: [archaeologySource] }),
    });
    const art = await queryQueueKeys({ userId: adminId, isAdmin: true, filters: filters({ sourceIds: [artSource] }) });

    expect(archaeology.total).toBe(1);
    expect(art.total).toBe(0);
  });

  it('puts it in the scope of a curator who holds the source that asks', async () => {
    const assign = (source: number) => pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', $2, $3)`,
      [curatorId, source, adminId],
    );
    await assign(artSource);
    const artCurator = await queryQueueKeys({ userId: curatorId, isAdmin: false, filters: filters() });
    expect(artCurator.total).toBe(0);

    await assign(archaeologySource);
    const archaeologyCurator = await queryQueueKeys({ userId: curatorId, isAdmin: false, filters: filters() });
    expect(archaeologyCurator.total).toBe(1);
  });

  it("draws the arrival as the Archaeology membership's", async () => {
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    // Readers already see the place as an art museum, which the card says
    // rather than that nobody can see it.
    expect(queue.arrivals).toEqual([
      expect.objectContaining({ id: PLACE, kind_name: 'Archaeology', seen_in: ['Art Museums'] }),
    ]);
    const membership = await membershipOf(archaeologySource);
    expect(queue.arrivals[0].membership_id).toBe(membership);
  });

  it('names the membership readers see the place through on its unread contents', async () => {
    await unreadPoint();
    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    const membership = await membershipOf(artSource);
    expect(queue.contents).toEqual([
      expect.objectContaining({ id: PLACE, kind_name: 'Art Museums', membership_id: membership }),
    ]);
  });

  it('publishes an arrival under a second kind without releasing what the first is still asking about', async () => {
    const point = await unreadPoint();

    const outcome = await publishUnderLock(PLACE, adminId, null, { membershipId: await membershipOf(archaeologySource) });

    expect(outcome.refusal).toBeUndefined();
    expect(outcome.result?.locationsPublished).toBe(0);
    const state = await pool.query('SELECT curation_state FROM experience_locations WHERE id = $1', [point]);
    expect(state.rows[0].curation_state).toBe('pending');
  });

  it('turns unread contents down beside another kind\'s arrival', async () => {
    // The server's own pick for a place-keyed answer prefers a pending
    // membership; the contents are answered through the one they belong to.
    const point = await unreadPoint();

    const outcome = await refuseContentsUnderLock(PLACE, adminId, null, {});

    expect(outcome.refusal).toBeUndefined();
    const state = await pool.query('SELECT refused_at FROM experience_locations WHERE id = $1', [point]);
    expect(state.rows[0].refused_at).not.toBeNull();
  });

  it('asks the contents of the kind that placed them, before the kinds\' order', async () => {
    // Both kinds visible, and the unread point is Archaeology's own: Art
    // Museums comes first in the kinds' order, but the point is not its
    // question.
    const archaeology = await membershipOf(archaeologySource);
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE id = $1`,
      [archaeology],
    );
    const point = await unreadPoint();
    await pool.query(
      'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [point, archaeology],
    );

    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    expect(queue.contents).toEqual([
      expect.objectContaining({ id: PLACE, kind_name: 'Archaeology', membership_id: archaeology }),
    ]);
  });

  it('releases with an arrival the points it brought itself, and only those', async () => {
    // Palazzo Nuovo placed by the Art Museums membership, Palazzo dei
    // Conservatori by the Archaeology arrival: publishing the arrival takes
    // its own point and leaves the other to the Art Museums question.
    const art = await membershipOf(artSource);
    const archaeology = await membershipOf(archaeologySource);
    const artPoint = await unreadPoint();
    const own = await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, location, curation_state)
       VALUES ($1, 'Palazzo dei Conservatori', ST_SetSRID(ST_MakePoint(12.48247, 41.89272), 4326), 'pending')
       RETURNING id`,
      [PLACE],
    );
    await pool.query(
      `INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2), ($3, $4)`,
      [artPoint, art, own.rows[0].id, archaeology],
    );

    const outcome = await publishUnderLock(PLACE, adminId, null, { membershipId: archaeology });

    expect(outcome.refusal).toBeUndefined();
    expect(outcome.result?.locationsPublished).toBe(1);
    const states = await pool.query<{ id: number; curation_state: string }>(
      'SELECT id, curation_state FROM experience_locations WHERE experience_id = $1', [PLACE],
    );
    const stateOf = Object.fromEntries(states.rows.map(row => [row.id, row.curation_state]));
    expect(stateOf[own.rows[0].id]).not.toBe('pending');
    expect(stateOf[artPoint]).toBe('pending');
  });
});

describe('a refusal of each membership (#1264)', () => {
  /** The Archaeology rule refuses the museums, which readers see as an art museum. */
  async function refuseArchaeology(): Promise<number> {
    const archaeology = await membershipOf(archaeologySource);
    await pool.query(
      `UPDATE experience_kind_memberships SET admission = 'refused', admission_reason = 'not an archaeological site'
        WHERE id = $1`,
      [archaeology],
    );
    return archaeology;
  }

  it('asks it under the kind whose rule refused, saying where readers still see the place', async () => {
    const archaeology = await refuseArchaeology();

    const archaeologyKeys = await queryQueueKeys({
      userId: adminId, isAdmin: true, filters: filters({ sourceIds: [archaeologySource] }),
    });
    const artKeys = await queryQueueKeys({ userId: adminId, isAdmin: true, filters: filters({ sourceIds: [artSource] }) });
    expect(archaeologyKeys.keys).toEqual([expect.objectContaining({ kind: 'refused', id: PLACE })]);
    expect(artKeys.total).toBe(0);

    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });
    expect(queue.refused).toEqual([expect.objectContaining({
      id: PLACE, membership_id: archaeology, kind_name: 'Archaeology', seen_in: ['Art Museums'],
    })]);
  });

  it('keeps a confirmed refusal in the kept-out list under its own kind', async () => {
    const archaeology = await refuseArchaeology();
    await pool.query('UPDATE experience_kind_memberships SET admission_answered_at = NOW() WHERE id = $1', [archaeology]);

    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    expect(queue.refused).toEqual([]);
    expect(queue.keptOut).toEqual([expect.objectContaining({
      id: PLACE, membership_id: archaeology, kind_name: 'Archaeology', seen_in: ['Art Museums'],
    })]);
  });

  it('dates and notes each kept-out kind by its own answer', async () => {
    // Both kinds' rules refused the place, and a curator kept it out of each
    // with a different note: neither card may show the other's.
    const archaeology = await refuseArchaeology();
    const art = await membershipOf(artSource);
    await pool.query(
      `UPDATE experience_kind_memberships SET admission = 'refused', admission_reason = 'not an art museum'
        WHERE id = $1`,
      [art],
    );
    for (const [membershipId, note] of [[archaeology, 'no excavated holdings'], [art, 'antiquities only']] as const) {
      const outcome = await answerAdmissionUnderLock(PLACE, adminId, null, { decision: 'confirm', note, membershipId });
      expect(outcome.refusal).toBeUndefined();
    }

    const queue = await getReviewQueue({
      query: reviewQueueQuerySchema.parse({ q: NAME }),
      caller: { id: adminId, role: 'admin' } as Express.User,
    });

    const noteOf = Object.fromEntries(queue.keptOut.map(item => [item.membership_id, item.state_note]));
    expect(noteOf).toEqual({ [archaeology]: 'no excavated holdings', [art]: 'antiquities only' });
  });
});
