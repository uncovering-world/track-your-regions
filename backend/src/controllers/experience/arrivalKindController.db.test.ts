import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerArrivalWithKind, moveArrivalUnderLock } from './arrivalKindController.js';

/**
 * An arrival answered with the kind it belongs in instead (#2213), executed
 * against PostgreSQL: the add and the arrival's answer in one act, what is
 * refused, and the two log rows that name the pair of kinds.
 *
 * The fixture is the Monument to Peter I before St Michael's Castle in Saint
 * Petersburg as it arrived on 2026-10-31: a Public art arrival filed as a
 * `sculpture`, which a traveller looks for under Monuments & memorials. Ids
 * and the item are the fixture's own, deleted before and after.
 */

const MONUMENT = 9791;
const QID = 'Q9000009791';
const ADMIN = '00000000-0000-4000-8000-000000009791';

let adminId = 0;
let publicArt = { id: 0, kind_id: 0 };
let monuments = { id: 0, kind_id: 0 };
let arrival = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [MONUMENT]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  return (await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  )).rows[0];
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  publicArt = await sourceNamed('Public art');
  monuments = await sourceNamed('Monuments & memorials');
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Monument to Peter I (arrival fixture)', ST_SetSRID(ST_MakePoint(30.3375, 59.9403), 4326))`,
    [MONUMENT, publicArt.id, QID],
  );
  arrival = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, admission, curation_state)
     VALUES ($1, $2, $3, $4, 'sculpture', 'admitted', 'pending') RETURNING id`,
    [MONUMENT, publicArt.kind_id, publicArt.id, QID],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const move = (body: { kindId: number; type?: string; stays: boolean; note?: string }) =>
  moveArrivalUnderLock(MONUMENT, adminId, null, monuments.id, body);
const membership = async (id: number) => (await pool.query(
  `SELECT kind_id, type, admission, admission_reason, curated_fields, curation_state, published_at IS NOT NULL AS published
     FROM experience_kind_memberships WHERE id = $1`, [id],
)).rows[0];
const logged = async () => (await pool.query(
  'SELECT action, details FROM experience_curation_log WHERE experience_id = $1 ORDER BY id', [MONUMENT],
)).rows;

describe('an arrival answered with the kind it belongs in', () => {
  it('adds the place to that kind and keeps it out of the one that brought it, in one act', async () => {
    const { result, refusal } = await move({ kindId: monuments.kind_id, type: 'monument', stays: false, note: 'a monument to a person' });
    expect(refusal).toBeUndefined();
    expect(result).toMatchObject({
      experienceId: MONUMENT, kindId: monuments.kind_id, kind: 'Monuments & memorials',
      arrivalMembershipId: arrival, fromKind: 'Public art',
    });

    // The chosen kind's membership: admitted, published and pinned with its type, as a curator's add is.
    expect(await membership(result!.membershipId)).toEqual({
      kind_id: monuments.kind_id, type: 'monument', admission: 'admitted', admission_reason: null,
      curated_fields: ['admission', 'type'], curation_state: 'verified', published: true,
    });
    // The arrival: refused and pinned, as a curator's no to an arrival is, so later runs leave it out.
    expect(await membership(arrival)).toMatchObject({
      admission: 'refused', admission_reason: 'kept out by a curator', curated_fields: ['admission'],
    });

    // Each half recorded the way it always is, each naming the other kind: the pair the rule review reads.
    expect(await logged()).toEqual([
      {
        action: 'arrival_refused',
        details: {
          membershipId: arrival, reason: 'kept out by a curator', note: 'a monument to a person',
          movedTo: { membershipId: result!.membershipId, kindId: monuments.kind_id, kind: 'Monuments & memorials', type: 'monument' },
        },
      },
      {
        action: 'kind_added',
        details: {
          membershipId: result!.membershipId, kindId: monuments.kind_id, kind: 'Monuments & memorials', type: 'monument',
          note: 'a monument to a person',
          fromArrival: { membershipId: arrival, kindId: publicArt.kind_id, kind: 'Public art', stays: false },
        },
      },
    ]);
  });

  it('leaves the arrival waiting for its own publish where the place stays in both kinds', async () => {
    const { result } = await move({ kindId: monuments.kind_id, type: 'monument', stays: true });

    expect(await membership(arrival)).toMatchObject({ admission: 'admitted', curation_state: 'pending' });
    const rows = await logged();
    expect(rows.map(row => row.action)).toEqual(['kind_added']);
    expect(rows[0].details.fromArrival).toEqual({ membershipId: arrival, kindId: publicArt.kind_id, kind: 'Public art', stays: true });
    expect(result!.membershipId).toBeGreaterThan(0);
  });

  it('refuses the kind that brought it, a kind it is in already, and a row that is no arrival', async () => {
    expect((await moveArrivalUnderLock(MONUMENT, adminId, null, publicArt.id,
      { kindId: publicArt.kind_id, stays: false })).refusal).toMatchObject({ status: 400 });

    await move({ kindId: monuments.kind_id, type: 'monument', stays: true });
    expect((await move({ kindId: monuments.kind_id, type: 'monument', stays: false })).refusal)
      .toMatchObject({ status: 409 });

    await pool.query("UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE id = $1", [arrival]);
    const towers = await sourceNamed('Towers');
    expect((await moveArrivalUnderLock(MONUMENT, adminId, null, towers.id,
      { kindId: towers.kind_id, type: 'tower', stays: false })).refusal).toMatchObject({ status: 409 });
  });

  it('never adds the place to World Heritage Sites', async () => {
    await expect(answerArrivalWithKind({
      params: { id: MONUMENT }, body: { kindId: 1, stays: false }, caller: { id: adminId, role: 'admin' } as Express.User,
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
