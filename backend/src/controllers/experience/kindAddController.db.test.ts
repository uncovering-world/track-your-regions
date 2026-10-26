import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { handBackPinUnderLock, listAdmissionPins } from './admissionPinController.js';
import { addPlaceToKind, addUnderLock } from './kindAddController.js';
import { keepOutUnderLock, listPlaceKinds } from './keepOutController.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';

/**
 * A curator putting a place into a kind no run offers it in, from the place's
 * card (#2035), executed against PostgreSQL: the kinds offered, the membership
 * written under the place's lock, what is refused, and the way back.
 *
 * The fixture is the East Side Gallery as it stood on 2026-10-26: brought by
 * Art Museums, whose rule keeps it out (Wikidata types the stretch of the
 * Berlin Wall an art museum), and found by no run of Public art. Ids and the
 * item are the fixture's own, deleted before and after.
 */

const GALLERY = 9781;
const OTHER = 9782;
const QID = 'Q9000009781';
const ADMIN = '00000000-0000-4000-8000-000000009781';
const CURATOR = '00000000-0000-4000-8000-000000009782';

let adminId = 0;
let curatorId = 0;
let publicArt = { id: 0, kind_id: 0 };
let artMuseums = { id: 0, kind_id: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[GALLERY, OTHER]]);
  await pool.query('DELETE FROM curator_assignments WHERE assigned_by IN (SELECT id FROM users WHERE uuid = $1)', [ADMIN]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN, CURATOR]]);
}

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  return (await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  )).rows[0];
}

async function place(id: number, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(13.4397, 52.5050), 4326))`,
    [id, artMuseums.id, `${QID}-${id}`, name],
  );
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  curatorId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR],
  )).rows[0].id;
  publicArt = await sourceNamed('Public art');
  artMuseums = await sourceNamed('Art Museums');
  await place(GALLERY, 'East Side Gallery (add fixture)');
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, admission, admission_reason, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'refused', 'a stretch of the Berlin Wall that Wikidata types art museum', 'auto', NOW())`,
    [GALLERY, artMuseums.kind_id, artMuseums.id, QID],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const admin = () => ({ id: adminId, role: 'admin' } as Express.User);
const standings = (caller = admin()) => listPlaceKinds({ params: { id: GALLERY }, caller });
const add = (body: { kindId: number; type?: string; note?: string }) =>
  addUnderLock(GALLERY, adminId, null, publicArt.id, body);
const streetArt = () => add({ kindId: publicArt.kind_id, type: 'street-art', note: 'A mile of murals on the Berlin Wall' });

describe('the kinds a place may be added to', () => {
  it('are the kinds it is not in, never World Heritage Sites', async () => {
    const { addable } = await standings();
    const ids = addable.map(kind => kind.kindId);
    expect(ids).toContain(publicArt.kind_id);
    expect(ids).not.toContain(artMuseums.kind_id);
    expect(ids).not.toContain(1);
  });

  it("are only those whose source the caller's scope reaches", async () => {
    await pool.query(
      "INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', $2, $3)",
      [curatorId, artMuseums.id, adminId],
    );
    const caller = { id: curatorId, role: 'curator' } as Express.User;
    expect((await standings(caller)).addable).toEqual([]);
    await expect(addPlaceToKind({ params: { id: GALLERY }, body: { kindId: publicArt.kind_id }, caller }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('adding a place to a kind', () => {
  it('writes the membership admitted, published and pinned, under the item it already carries', async () => {
    const { result } = await streetArt();
    expect(result).toMatchObject({ experienceId: GALLERY, kindId: publicArt.kind_id });

    const row = (await pool.query(
      `SELECT external_id, type, admission, curated_fields, curation_state, published_at IS NOT NULL AS published,
              admission_pin_verdict
         FROM experience_kind_memberships WHERE id = $1`,
      [result!.membershipId],
    )).rows[0];
    expect(row).toEqual({
      external_id: QID, type: 'street-art', admission: 'admitted', curated_fields: ['admission', 'type'],
      curation_state: 'verified', published: true, admission_pin_verdict: null,
    });

    const log = await pool.query(
      "SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'kind_added'", [GALLERY],
    );
    expect(log.rows.map(r => r.details)).toEqual([{
      membershipId: result!.membershipId, kindId: publicArt.kind_id, kind: 'Public art', type: 'street-art',
      note: 'A mile of murals on the Berlin Wall',
    }]);

    expect((await standings()).kinds).toEqual(expect.arrayContaining([expect.objectContaining({
      membershipId: result!.membershipId, state: 'offered', added: true, curatorName: 'An admin',
      note: 'A mile of murals on the Berlin Wall', answeredAt: expect.any(String),
    })]));
    expect((await standings()).addable.map(kind => kind.kindId)).not.toContain(publicArt.kind_id);
  });

  it('keeps its own key on a place that carries no Wikidata item', async () => {
    await pool.query('UPDATE experience_kind_memberships SET external_id = $2 WHERE experience_id = $1', [GALLERY, 'curator-1-1']);
    const { result } = await add({ kindId: publicArt.kind_id, type: 'street-art' });
    const row = (await pool.query('SELECT external_id FROM experience_kind_memberships WHERE id = $1', [result!.membershipId])).rows[0];
    expect(row.external_id).toBe(`${QID}-${GALLERY}`);
  });

  it('claims no type when none was given, so a run that lists the place may file one', async () => {
    const { result } = await add({ kindId: publicArt.kind_id });
    const row = (await pool.query('SELECT type, curated_fields FROM experience_kind_memberships WHERE id = $1', [result!.membershipId])).rows[0];
    expect(row).toEqual({ type: null, curated_fields: ['admission'] });
  });

  it('is no pin against a rule: not among the pins, and not handed back to a run', async () => {
    const { result } = await streetArt();
    const pins = await listAdmissionPins({ query: { experienceId: GALLERY }, caller: admin() });
    expect(pins.pins.map(pin => pin.membershipId)).not.toContain(result!.membershipId);
    expect((await handBackPinUnderLock(GALLERY, adminId, null, { membershipId: result!.membershipId })).refusal)
      .toMatchObject({ status: 409 });
    const row = (await pool.query('SELECT curated_fields FROM experience_kind_memberships WHERE id = $1', [result!.membershipId])).rows[0];
    expect(row.curated_fields).toEqual(['admission', 'type']);
  });

  it('stays an add once taken out and put back: still no pin, still said to be added', async () => {
    const { result } = await streetArt();
    const membershipId = result!.membershipId;
    await keepOutUnderLock(GALLERY, adminId, null, { membershipId, note: 'Not street art after all' });
    expect((await answerAdmissionUnderLock(GALLERY, adminId, null, { decision: 'override', membershipId })).result)
      .toMatchObject({ admission: 'admitted' });

    const pins = await listAdmissionPins({ query: { experienceId: GALLERY }, caller: admin() });
    expect(pins.pins.map(pin => pin.membershipId)).not.toContain(membershipId);
    expect((await handBackPinUnderLock(GALLERY, adminId, null, { membershipId })).refusal)
      .toMatchObject({ status: 409 });
    expect((await standings()).kinds.find(kind => kind.membershipId === membershipId)).toMatchObject({
      state: 'offered', added: true, curatorName: 'An admin', note: 'A mile of murals on the Berlin Wall',
    });
  });

  it('is a pin like any other once a run lists the place, and is handed back to it', async () => {
    const { result } = await streetArt();
    const membershipId = result!.membershipId;
    // What the run's upsert stamps on a membership it lists.
    await pool.query('UPDATE experience_kind_memberships SET last_seen_at = NOW() WHERE id = $1', [membershipId]);

    const pins = await listAdmissionPins({ query: { experienceId: GALLERY }, caller: admin() });
    expect(pins.pins.find(pin => pin.membershipId === membershipId)).toMatchObject({ answer: 'admitted', added: true });
    expect((await standings()).kinds.find(kind => kind.membershipId === membershipId)).toMatchObject({ added: false });
    expect((await handBackPinUnderLock(GALLERY, adminId, null, { membershipId })).result)
      .toMatchObject({ admission: 'admitted' });
  });

  it('is taken out again by the card, and then says it was kept out', async () => {
    const { result } = await streetArt();
    expect((await keepOutUnderLock(GALLERY, adminId, null, { membershipId: result!.membershipId })).result)
      .toMatchObject({ admission: 'refused' });
    expect((await standings()).kinds.find(kind => kind.membershipId === result!.membershipId))
      .toMatchObject({ state: 'kept-out', added: false });
  });
});

describe('what an add refuses, with nothing written', () => {
  const logged = async (): Promise<number> => (await pool.query(
    "SELECT count(*)::int AS n FROM experience_curation_log WHERE experience_id = $1 AND action = 'kind_added'", [GALLERY],
  )).rows[0].n;

  it('a kind the place is in already, in any state', async () => {
    expect((await add({ kindId: artMuseums.kind_id })).refusal).toMatchObject({ status: 409 });
    expect(await logged()).toBe(0);
  });

  it('a second add to the same kind', async () => {
    await streetArt();
    expect((await streetArt()).refusal).toMatchObject({ status: 409 });
    expect(await logged()).toBe(1);
  });

  it('an item another place already holds in that kind', async () => {
    await place(OTHER, 'Another wall (add fixture)');
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW())`,
      [OTHER, publicArt.kind_id, publicArt.id, QID],
    );
    expect((await streetArt()).refusal).toMatchObject({ status: 409 });
    expect(await logged()).toBe(0);
  });

  it('World Heritage Sites, which only an inscription makes', async () => {
    await expect(addPlaceToKind({ params: { id: GALLERY }, body: { kindId: 1 }, caller: admin() }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('a place that does not exist', async () => {
    expect((await addUnderLock(GALLERY + 100, adminId, null, publicArt.id, { kindId: publicArt.kind_id })).refusal)
      .toMatchObject({ status: 404 });
  });
});
