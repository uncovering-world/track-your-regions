import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from './index.js';
import { logCurationActs } from './curationLogWriter.js';
import { answer, routeAt, type SpecRequest } from '../api/routeTesting.js';
import { experienceCurationRoutes } from '../routes/experienceRoutes.js';
import { addPlaceToKind } from '../controllers/experience/kindAddController.js';
import { keepOutOfKind, keepOutUnderLock } from '../controllers/experience/keepOutController.js';
import { publishUnderLock } from '../controllers/experience/publishController.js';
import { answerAdmissionUnderLock, setExperienceAdmission } from '../controllers/experience/lifecycleController.js';
import { answerRow } from '../controllers/experience/reviewAnswerDispatch.js';
import {
  assignExperienceToRegion, rejectExperience, removeExperienceFromRegion, unassignExperienceFromRegion, unrejectExperience,
} from '../controllers/experience/curationRegionController.js';

/**
 * What the curation log records about an act (#863), against PostgreSQL: the
 * membership and its kind on an act about one, the bulk mark on a publish one
 * click made over many places and on no other, the reason an act that must
 * give one gives and the refusal of one sent without, where a place stood in
 * a region before a curator moved it, and the region the curator had open.
 *
 * The fixture is the Capitoline Museums, shown as an art museum, and an
 * Archaeology arrival at Ostia Antica that a run brought, with a fixture world
 * view's Lazio for the region acts. Ids are the fixture's own, deleted before
 * and after; the run is numbered by the lane's sequence and deleted by its id.
 */

const CAPITOLINE = 86310;
const OSTIA = 86311;
const WORLD_VIEW = 86310;
const LAZIO = 863100;
const ADMIN_UUID = '00000000-0000-4000-8000-000000008630';
const CURATOR_UUID = '00000000-0000-4000-8000-000000008631';

let admin = 0;
let artMembership = 0;
let artKind = 0;
let arrival = 0;
let archaeologyKind = 0;
let runId = 0;

const caller = () => ({ id: admin, role: 'admin' }) as Express.User;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[CAPITOLINE, OSTIA]]);
  if (runId !== 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [runId]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN_UUID, CURATOR_UUID]]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

/** The details of the one entry of `action` on the place. */
async function entry(placeId: number, action: string): Promise<{ region_id: number | null; details: Record<string, unknown> }> {
  const rows = await pool.query<{ region_id: number | null; details: Record<string, unknown> }>(
    'SELECT region_id, details FROM experience_curation_log WHERE experience_id = $1 AND action = $2',
    [placeId, action],
  );
  expect(rows.rows, `one ${action} entry on ${placeId}`).toHaveLength(1);
  return rows.rows[0];
}

beforeEach(async () => {
  await clear();
  runId = 0;
  admin = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN_UUID],
  )).rows[0].id;
  await pool.query("INSERT INTO world_views (id, name, is_default, tile_version) VALUES ($1, 'Log fixture', false, 0)", [WORLD_VIEW]);
  await pool.query("INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, 'Lazio (log fixture)')", [LAZIO, WORLD_VIEW]);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT v.id, s.id, v.qid, v.name, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)
       FROM (VALUES ($1::int, 'Q86310001', 'Capitoline Museums (log fixture)', 12.48278, 41.89306),
                    ($2::int, 'Q86311001', 'Ostia Antica (log fixture)', 12.29222, 41.75583)) AS v(id, qid, name, lon, lat)
       CROSS JOIN experience_sources s WHERE s.name = 'Art Museums'`,
    [CAPITOLINE, OSTIA],
  );
  ({ id: artMembership, kind_id: artKind } = (await pool.query<{ id: number; kind_id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, 'Q86310001', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Art Museums'
     RETURNING id, kind_id`,
    [CAPITOLINE],
  )).rows[0]);
  runId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run)
     SELECT s.id, 'success', NOW(), false FROM experience_sources s WHERE s.name = 'Archaeology' RETURNING id`,
  )).rows[0].id;
  ({ id: arrival, kind_id: archaeologyKind } = (await pool.query<{ id: number; kind_id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, first_seen_sync_log_id)
     SELECT $1, s.kind_id, s.id, 'Q86311001', 'pending', $2 FROM experience_sources s WHERE s.name = 'Archaeology'
     RETURNING id, kind_id`,
    [OSTIA, runId],
  )).rows[0]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('an act about a membership', () => {
  it('names the membership, its kind and the reason the curator picked', async () => {
    const { refusal } = await keepOutUnderLock(CAPITOLINE, admin, LAZIO, {
      membershipId: artMembership, note: 'a museum of antiquities', reasonCode: 'not-this-kind',
    });

    expect(refusal).toBeUndefined();
    const kept = await entry(CAPITOLINE, 'kept_out');
    expect(kept.region_id).toBe(LAZIO);
    expect(kept.details).toMatchObject({
      membershipId: artMembership, kindId: artKind, reasonCode: 'not-this-kind',
      reason: 'kept out by a curator', note: 'a museum of antiquities',
    });
    // The membership's own reason stays the constant (ADR-0053 decision 1).
    const membership = await pool.query('SELECT admission_reason FROM source_records WHERE id = $1', [artMembership]);
    expect(membership.rows[0].admission_reason).toBe('kept out by a curator');
  });
});

describe('a publish', () => {
  it('one click made over many places is marked bulk, with the run that brought the arrival', async () => {
    const { refusal } = await publishUnderLock(OSTIA, admin, null, { membershipId: arrival }, undefined, { bulk: true });

    expect(refusal).toBeUndefined();
    expect((await entry(OSTIA, 'published')).details).toMatchObject({
      membershipId: arrival, kindId: archaeologyKind, bulk: true, syncLogId: runId,
    });
  });

  it('a curator considered on its card carries neither mark', async () => {
    const { refusal } = await publishUnderLock(OSTIA, admin, null, { membershipId: arrival });

    expect(refusal).toBeUndefined();
    const { details } = await entry(OSTIA, 'published');
    expect(details).toMatchObject({ membershipId: arrival, kindId: archaeologyKind });
    expect(details).not.toHaveProperty('bulk');
    expect(details).not.toHaveProperty('syncLogId');
  });

  it('is told from a bulk one in one query', async () => {
    const capitolineArrival = (await pool.query<{ id: number }>(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
       SELECT $1, s.kind_id, s.id, 'Q86310001', 'pending' FROM experience_sources s WHERE s.name = 'Archaeology'
       RETURNING id`,
      [CAPITOLINE],
    )).rows[0].id;
    await publishUnderLock(OSTIA, admin, null, { membershipId: arrival }, undefined, { bulk: true });
    await publishUnderLock(CAPITOLINE, admin, null, { membershipId: capitolineArrival });

    const considered = await pool.query<{ experience_id: number }>(
      `SELECT experience_id FROM experience_curation_log
        WHERE action = 'published' AND experience_id = ANY($1::int[]) AND (details ? 'bulk') IS NOT TRUE`,
      [[CAPITOLINE, OSTIA]],
    );
    expect(considered.rows.map(row => row.experience_id)).toEqual([CAPITOLINE]);
  });
});

describe('a batch answer in the review feed', () => {
  it('turning away a selection of many marks each refusal bulk, with the run that brought it', async () => {
    const outcome = await answerRow({
      experienceId: OSTIA, userId: admin, logRegionId: null, runId, membershipId: arrival, bulk: true,
      reasonCode: 'not-worth-a-visit',
    }, 'waiting', 'reject');

    expect(outcome).not.toHaveProperty('refusal');
    expect((await entry(OSTIA, 'arrival_refused')).details).toMatchObject({
      membershipId: arrival, kindId: archaeologyKind, bulk: true, syncLogId: runId,
    });
  });

  it("a selection of one is the card's own answer and carries no mark", async () => {
    await answerRow({
      experienceId: OSTIA, userId: admin, logRegionId: null, runId, membershipId: arrival, bulk: false,
      reasonCode: 'not-worth-a-visit',
    }, 'waiting', 'reject');

    expect((await entry(OSTIA, 'arrival_refused')).details).not.toHaveProperty('bulk');
  });
});

describe('the reason an act that must give one gives (#863)', () => {
  it('a batch that turns arrivals away keeps its one reason and the words in each entry', async () => {
    const outcome = await answerRow({
      experienceId: OSTIA, userId: admin, logRegionId: null, runId, membershipId: arrival, bulk: true,
      reasonCode: 'not-one-place', note: 'a trail network, not one site',
    }, 'waiting', 'reject');

    expect(outcome).not.toHaveProperty('refusal');
    expect((await entry(OSTIA, 'arrival_refused')).details).toMatchObject({
      membershipId: arrival, kindId: archaeologyKind, reasonCode: 'not-one-place', note: 'a trail network, not one site',
    });
  });

  it('a batch refuses an arrival rejected without a reason, and writes nothing', async () => {
    const outcome = await answerRow({
      experienceId: OSTIA, userId: admin, logRegionId: null, runId, membershipId: arrival, bulk: true,
    }, 'waiting', 'reject');

    expect(outcome).toMatchObject({ refusal: { status: 400 } });
    const log = await pool.query('SELECT 1 FROM experience_curation_log WHERE experience_id = $1', [OSTIA]);
    expect(log.rows).toHaveLength(0);
    const membership = await pool.query('SELECT admission FROM source_records WHERE id = $1', [arrival]);
    expect(membership.rows[0].admission).not.toBe('refused');
  });

  it('a put-back keeps the reason the curator picked', async () => {
    await pool.query(
      "UPDATE source_records SET admission = 'refused', admission_reason = 'not a museum class' WHERE id = $1", [artMembership],
    );

    const { refusal } = await answerAdmissionUnderLock(CAPITOLINE, admin, LAZIO, {
      decision: 'override', membershipId: artMembership, reasonCode: 'missing-from-rule',
    });

    expect(refusal).toBeUndefined();
    expect((await entry(CAPITOLINE, 'admission_overridden')).details).toMatchObject({
      membershipId: artMembership, kindId: artKind, reasonCode: 'missing-from-rule', reason: 'not a museum class',
    });
  });
});

describe("a curator's hand on a place in a region", () => {
  const params = { id: CAPITOLINE, regionId: LAZIO };

  it('records where the place stood before it was placed there, and before it was taken out', async () => {
    await assignExperienceToRegion({
      params: { id: CAPITOLINE }, body: { regionId: LAZIO, reasonCode: 'other', note: 'its Lazio branch' }, caller: caller(),
    });
    await unassignExperienceFromRegion({ params, query: {}, caller: caller() });

    expect(await entry(CAPITOLINE, 'added_to_region')).toEqual({
      region_id: LAZIO,
      details: { before: { assignment: null, rejected: false }, note: 'its Lazio branch', reasonCode: 'other' },
    });
    expect((await entry(CAPITOLINE, 'removed_from_region')).details).toEqual({
      before: { assignment: 'manual', rejected: false },
      after: { assignment: null, rejected: false },
    });
  });

  it('records an automatic placement taken out, and the rejection that keeps it out', async () => {
    await pool.query(
      "INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')", [CAPITOLINE, LAZIO],
    );
    await rejectExperience({
      params: { id: CAPITOLINE }, body: { regionId: LAZIO, reason: 'it stands in Rome', reasonCode: 'wrong-place' }, caller: caller(),
    });
    await removeExperienceFromRegion({ params, query: { reasonCode: 'wrong-place' }, caller: caller() });

    expect((await entry(CAPITOLINE, 'rejected')).details).toEqual({
      reason: 'it stands in Rome', reasonCode: 'wrong-place', before: { assignment: 'auto', rejected: false },
    });
    expect((await entry(CAPITOLINE, 'removed_from_region')).details).toEqual({
      reasonCode: 'wrong-place', before: { assignment: 'auto', rejected: true },
    });
  });

  it('keeps the picked reason, in its words, as the reason of a rejection given no words', async () => {
    await rejectExperience({ params: { id: CAPITOLINE }, body: { regionId: LAZIO, reasonCode: 'duplicate' }, caller: caller() });

    const rejection = await pool.query<{ reason: string | null }>(
      'SELECT reason FROM experience_rejections WHERE experience_id = $1 AND region_id = $2', [CAPITOLINE, LAZIO],
    );
    expect(rejection.rows[0].reason).toBe('Same as another');
    expect(await entry(CAPITOLINE, 'rejected')).toEqual({
      region_id: LAZIO, details: { reasonCode: 'duplicate', before: { assignment: null, rejected: false } },
    });
  });

  it('records the rejection a curator takes back: who made it and why', async () => {
    await rejectExperience({
      params: { id: CAPITOLINE }, body: { regionId: LAZIO, reason: 'not here', reasonCode: 'wrong-place' }, caller: caller(),
    });
    await unrejectExperience({ params: { id: CAPITOLINE }, body: { regionId: LAZIO }, caller: caller() });

    const { details } = await entry(CAPITOLINE, 'unrejected');
    expect(details).toMatchObject({
      before: { assignment: null, rejected: true },
      rejection: { reason: 'not here', rejectedBy: admin },
    });
    expect(details.rejection).toHaveProperty('rejectedAt');
  });
});

describe('the region the curator had open (#863)', () => {
  const GONE_REGION = 863199;

  it('is where a keep-out, a put-back and an add to a kind record the curator working', async () => {
    await pool.query(
      "INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')", [CAPITOLINE, LAZIO],
    );
    await keepOutOfKind({
      params: { id: CAPITOLINE }, caller: caller(),
      body: { membershipId: artMembership, reasonCode: 'not-worth-a-visit', regionId: LAZIO },
    });
    await setExperienceAdmission({
      params: { id: CAPITOLINE }, caller: caller(),
      body: { decision: 'override', membershipId: artMembership, reasonCode: 'missing-from-rule', regionId: LAZIO },
    });
    await addPlaceToKind({
      params: { id: CAPITOLINE }, caller: caller(),
      body: { kindId: archaeologyKind, reasonCode: 'missing-from-rule', regionId: LAZIO },
    });

    expect((await entry(CAPITOLINE, 'kept_out')).region_id).toBe(LAZIO);
    expect((await entry(CAPITOLINE, 'admission_overridden')).region_id).toBe(LAZIO);
    expect(await entry(CAPITOLINE, 'kind_added')).toMatchObject({
      region_id: LAZIO, details: { kindId: archaeologyKind, reasonCode: 'missing-from-rule' },
    });
  });

  it('sent none, leaves the region the scope check found: none, for an admin', async () => {
    await keepOutOfKind({
      params: { id: CAPITOLINE }, caller: caller(), body: { membershipId: artMembership, reasonCode: 'gone' },
    });

    expect((await entry(CAPITOLINE, 'kept_out')).region_id).toBeNull();
  });

  it('is recorded as none where the region no longer exists, and the act stands', async () => {
    await keepOutOfKind({
      params: { id: CAPITOLINE }, caller: caller(),
      body: { membershipId: artMembership, reasonCode: 'gone', regionId: GONE_REGION },
    });

    expect((await entry(CAPITOLINE, 'kept_out')).region_id).toBeNull();
    const membership = await pool.query('SELECT admission FROM source_records WHERE id = $1', [artMembership]);
    expect(membership.rows[0].admission).toBe('refused');
  });

  it('grants nothing: a curator whose scope does not reach the place is refused with it', async () => {
    const curator = (await pool.query<{ id: number }>(
      "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR_UUID],
    )).rows[0].id;

    await expect(keepOutOfKind({
      params: { id: CAPITOLINE }, caller: { id: curator, role: 'curator' } as Express.User,
      body: { membershipId: artMembership, reasonCode: 'gone', regionId: LAZIO },
    })).rejects.toMatchObject({ statusCode: 403 });
    const log = await pool.query('SELECT 1 FROM experience_curation_log WHERE experience_id = $1', [CAPITOLINE]);
    expect(log.rows).toHaveLength(0);
  });

  it("gives way to the scope check's region where the place is not in it", async () => {
    // Lazio exists, but the Capitoline is placed in no region of this world view.
    await keepOutOfKind({
      params: { id: CAPITOLINE }, caller: caller(),
      body: { membershipId: artMembership, reasonCode: 'gone', regionId: LAZIO },
    });

    expect((await entry(CAPITOLINE, 'kept_out')).region_id).toBeNull();
  });

  it("gives way to the scope check's region where it lies outside the curator's own scope", async () => {
    const ITALIA = 863101;
    await pool.query("INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, 'Italia (log fixture)')", [ITALIA, WORLD_VIEW]);
    await pool.query('UPDATE regions SET parent_region_id = $1 WHERE id = $2', [ITALIA, LAZIO]);
    await pool.query(
      "INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')", [CAPITOLINE, LAZIO],
    );
    const curator = (await pool.query<{ id: number }>(
      "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR_UUID],
    )).rows[0].id;
    await pool.query(
      "INSERT INTO curator_assignments (user_id, scope_type, region_id, assigned_by) VALUES ($1, 'region', $2, $3)",
      // Assigned by the curator themself, so the fixture's users delete in any order.
      [curator, LAZIO, curator],
    );

    // Scoped to Lazio, acting with Italia open: logged under Lazio, where Lazio's curators read it.
    await keepOutOfKind({
      params: { id: CAPITOLINE }, caller: { id: curator, role: 'curator' } as Express.User,
      body: { membershipId: artMembership, reasonCode: 'gone', regionId: ITALIA },
    });

    expect((await entry(CAPITOLINE, 'kept_out')).region_id).toBe(LAZIO);
  });
});

describe('an act every screen asks why, sent without a reason (#863)', () => {
  const res = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn(), end: vi.fn() });
  const send = (method: 'post' | 'delete', path: string, request: SpecRequest) =>
    answer(routeAt(experienceCurationRoutes, path, method), { user: caller(), ...request }, res());

  it('is refused before anything is written', async () => {
    await pool.query(
      "INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')", [CAPITOLINE, LAZIO],
    );
    const id = String(CAPITOLINE);

    await expect(send('post', '/:id/reject', { params: { id }, body: { regionId: LAZIO } })).rejects.toThrow();
    await expect(send('post', '/:id/assign', { params: { id }, body: { regionId: LAZIO } })).rejects.toThrow();
    await expect(send('delete', '/:id/remove-from-region/:regionId', { params: { id, regionId: String(LAZIO) } }))
      .rejects.toThrow();
    await expect(send('post', '/:id/keep-out', { params: { id }, body: { membershipId: artMembership } })).rejects.toThrow();
    await expect(send('post', '/:id/kinds', { params: { id }, body: { kindId: archaeologyKind } })).rejects.toThrow();

    const log = await pool.query('SELECT 1 FROM experience_curation_log WHERE experience_id = $1', [CAPITOLINE]);
    expect(log.rows).toHaveLength(0);
    const placed = await pool.query(
      'SELECT 1 FROM experience_regions WHERE experience_id = $1 AND region_id = $2', [CAPITOLINE, LAZIO],
    );
    expect(placed.rows).toHaveLength(1);
    const rejected = await pool.query('SELECT 1 FROM experience_rejections WHERE experience_id = $1', [CAPITOLINE]);
    expect(rejected.rows).toHaveLength(0);
  });

  it('is taken with one', async () => {
    await send('post', '/:id/reject', {
      params: { id: String(CAPITOLINE) }, body: { regionId: LAZIO, reasonCode: 'wrong-place' },
    });

    expect((await entry(CAPITOLINE, 'rejected')).details).toMatchObject({ reasonCode: 'wrong-place' });
  });
});

describe('several acts in one statement', () => {
  it('writes each with its own place and region, and the details composed for each', async () => {
    const client = await pool.connect();
    try {
      const written = await logCurationActs(client, [
        { experienceId: CAPITOLINE, curatorId: admin, action: 'separated', regionId: LAZIO,
          membership: { id: artMembership, kindId: artKind }, details: { note: 'one' } },
        { experienceId: OSTIA, curatorId: null, action: 'merged', details: { note: 'two' } },
      ]);
      expect(written.map(row => row.experience_id).sort()).toEqual([CAPITOLINE, OSTIA]);
    } finally {
      client.release();
    }

    expect(await entry(CAPITOLINE, 'separated')).toEqual({
      region_id: LAZIO, details: { note: 'one', membershipId: artMembership, kindId: artKind },
    });
    expect(await entry(OSTIA, 'merged')).toEqual({ region_id: null, details: { note: 'two' } });
  });
});
