import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockTwoExperiences } from '../../db/experienceWriter.js';
import { setCuratorPartRecord } from './membershipWriter.js';
import { addPart, holdPartWords, takeOutPart } from './partRecordController.js';
import { findPartCandidates, listPlaceParts } from './partRecordRead.js';

/**
 * A curator makes a place a part of a whole, or takes it out, from either
 * place's card (#2118), executed against PostgreSQL: the curator's record in
 * the whole, the relation that follows it, the histories, the refusals, and
 * that no run's write of a source's record undoes the curator's word.
 *
 * Modelled on the development catalogue of 2026-11-13: the Cathedral, Alcázar
 * and Archivo de Indias in Seville, whose list names Seville Cathedral as
 * 383bis-001, and the Giralda beside it in Towers; the Brâncuși Monumental
 * Ensemble of Târgu Jiu, in World Heritage Sites and Public art with no part,
 * and the Table of Silence in Public art. Ids and items are the fixture's own,
 * deleted before and after.
 */

const SITE = 9861;
const CATHEDRAL = 9862;
const GIRALDA = 9863;
const ENSEMBLE = 9864;
const TABLE = 9865;
const FOLDED = 9866;
const CHAIN = [9871, 9872, 9873, 9874, 9875];
/** Places of another region than Seville's: one waiting for a curator, one offered; and one waiting in Seville's. */
const ELSEWHERE_UNREAD = 9876;
const ELSEWHERE_OFFERED = 9877;
const HERE_UNREAD = 9878;
const ALL = [SITE, CATHEDRAL, GIRALDA, ENSEMBLE, TABLE, FOLDED, ...CHAIN, ELSEWHERE_UNREAD, ELSEWHERE_OFFERED, HERE_UNREAD];
const WORLD_VIEW = 98610;
const ANDALUSIA = 98611;
const HUBEI = 98612;
const ADMIN = '00000000-0000-4000-8000-000000009861';
const CURATOR = '00000000-0000-4000-8000-000000009862';

let adminId = 0;
let curatorId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[])', [ALL]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1::int[])', [ALL]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [ALL]);
  await pool.query(
    'DELETE FROM curator_assignments WHERE user_id IN (SELECT id FROM users WHERE uuid = ANY($1::text[]))', [[ADMIN, CURATOR]],
  );
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN, CURATOR]]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

async function place(
  id: number, name: string, sourceId: number, kindId: number | null, lon = -5.9927, lat = 37.3846,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, sourceId, `Q98610${id}`, name, lon, lat],
  );
  if (kindId !== null) {
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW())`,
      [id, kindId, sourceId, sourceId === 1 ? String(id) : `Q98610${id}`],
    );
  }
}

/** The World Heritage list's record of Seville Cathedral as 383bis-001, as the run writes it. */
async function listLine(): Promise<void> {
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, 10, '383bis-001', 'auto', NOW())`,
    [CATHEDRAL, SITE],
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
  await place(SITE, 'Cathedral, Alcázar and Archivo de Indias in Seville (fixture)', 1, 1);
  await place(CATHEDRAL, 'Seville Cathedral (fixture)', 4, 4, -5.9931);
  await place(GIRALDA, 'Giralda (fixture)', 7, 7, -5.99238);
  await place(ENSEMBLE, 'Brâncuși Monumental Ensemble of Târgu Jiu (fixture)', 1, 1, 23.2788);
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, 3, 3, 'Q9861099', 'auto', NOW())`,
    [ENSEMBLE],
  );
  await place(TABLE, 'Table of Silence (fixture)', 3, 3, 23.2690);
  await listLine();
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const admin = () => ({ id: adminId, role: 'admin' } as Express.User);
const add = (whole: number, partId: number, extra: { note?: string; makesWhole?: boolean } = {}, caller = admin()) =>
  addPart({ params: { id: whole }, body: { partId, ...extra }, caller });
const takeOut = (whole: number, partId: number, note?: string) =>
  takeOutPart({ params: { id: whole }, body: { partId, note }, caller: admin() });

async function relation(whole: number, part: number): Promise<string | null> {
  return (await pool.query<{ reason: string }>(
    'SELECT reason FROM experience_parts WHERE whole_id = $1 AND part_id = $2', [whole, part],
  )).rows[0]?.reason ?? null;
}

async function curatorRecord(whole: number, part: number): Promise<{ id: number; external_id: string; admission: string } | null> {
  return (await pool.query<{ id: number; external_id: string; admission: string }>(
    'SELECT id, external_id, admission FROM source_records WHERE source_id = 11 AND whole_id = $1 AND experience_id = $2',
    [whole, part],
  )).rows[0] ?? null;
}

async function history(id: number): Promise<{ action: string; details: Record<string, unknown> }[]> {
  return (await pool.query<{ action: string; details: Record<string, unknown> }>(
    "SELECT action, details FROM experience_curation_log WHERE experience_id = $1 AND action LIKE 'part_%' ORDER BY id",
    [id],
  )).rows;
}

describe('adding a part', () => {
  it("writes the curator's record in the whole under a curator's key, and the relation follows it", async () => {
    const answer = await add(SITE, GIRALDA, { note: 'The cathedral\'s bell tower' });
    expect(answer).toMatchObject({ act: 'added', standing: true, keptOut: false, becameWhole: false });

    const record = await curatorRecord(SITE, GIRALDA);
    expect(record).toMatchObject({ admission: 'admitted', external_id: `curator-${adminId}-${answer.recordId}` });
    expect(record!.id).toBe(answer.recordId);
    expect(await relation(SITE, GIRALDA)).toBe('curator');
    // The Giralda keeps its own kind.
    expect((await pool.query('SELECT 1 FROM source_records WHERE experience_id = $1 AND kind_id = 7', [GIRALDA])).rowCount).toBe(1);

    const details = { wholeId: SITE, partId: GIRALDA, recordId: answer.recordId, note: 'The cathedral\'s bell tower' };
    expect(await history(SITE)).toEqual([{ action: 'part_added', details: expect.objectContaining(details) }]);
    expect(await history(GIRALDA)).toEqual([{ action: 'part_added', details: expect.objectContaining(details) }]);
  });

  it('refuses a place that is a part already, writing nothing', async () => {
    await expect(add(SITE, CATHEDRAL)).rejects.toMatchObject({ statusCode: 409 });
    expect(await curatorRecord(SITE, CATHEDRAL)).toBeNull();
    expect(await history(SITE)).toEqual([]);
  });

  it('refuses a place in itself, a loop and a chain over four places', async () => {
    await expect(add(SITE, SITE)).rejects.toMatchObject({ statusCode: 400 });
    // The site is already made of Seville Cathedral.
    await expect(add(CATHEDRAL, SITE, { makesWhole: true }))
      .rejects.toMatchObject({ statusCode: 409, body: expect.objectContaining({ code: 'loop' }) });

    for (const [i, id] of CHAIN.entries()) await place(id, `Level ${i + 1} (fixture)`, 5, 5, 12 + i);
    for (let i = 0; i < 3; i++) await add(CHAIN[i], CHAIN[i + 1], { makesWhole: true });
    await expect(add(CHAIN[3], CHAIN[4], { makesWhole: true })).rejects.toMatchObject({
      statusCode: 409,
      body: expect.objectContaining({ code: 'too-deep', chain: CHAIN.map((_, i) => `Level ${i + 1} (fixture)`) }),
    });
    expect(await relation(CHAIN[3], CHAIN[4])).toBeNull();
  });

  it('asks before the first part makes a place in a kind of its own a place made of parts', async () => {
    await expect(add(ENSEMBLE, TABLE))
      .rejects.toMatchObject({ statusCode: 409, body: expect.objectContaining({ code: 'makes-whole' }) });
    expect(await relation(ENSEMBLE, TABLE)).toBeNull();

    const answer = await add(ENSEMBLE, TABLE, { makesWhole: true });
    expect(answer).toMatchObject({ act: 'added', becameWhole: true });
    expect((await pool.query<{ whole: boolean }>('SELECT place_is_whole($1) AS whole', [ENSEMBLE])).rows[0].whole).toBe(true);
  });

  it('refuses to make a place a whole while another place stands merged into it', async () => {
    await place(FOLDED, 'Table of Silence, a second row (fixture)', 3, null, 23.2666);
    await pool.query('UPDATE experiences SET merged_into_id = $1 WHERE id = $2', [TABLE, FOLDED]);
    await pool.query(
      `INSERT INTO experience_merges (survivor_id, folded_id, merged_by, reason, moved)
       VALUES ($1, $2, $3, 'curator', '{}'::jsonb)`,
      [TABLE, FOLDED, adminId],
    );
    await expect(add(TABLE, GIRALDA, { makesWhole: true }))
      .rejects.toMatchObject({ statusCode: 409, body: expect.objectContaining({ code: 'merged-onto' }) });
  });

  it("refuses a curator whose scope reaches neither place", async () => {
    const caller = { id: curatorId, role: 'curator' } as Express.User;
    await expect(add(SITE, GIRALDA, {}, caller)).rejects.toMatchObject({ statusCode: 403 });
    expect(await curatorRecord(SITE, GIRALDA)).toBeNull();
  });
});

describe('two curators at once', () => {
  it('judges a second word on the first, so two words on disjoint pairs cannot make a chain too deep', async () => {
    // B over Z over C stand; one curator puts B under A, another puts D under
    // C. Each alone is four places deep; both together, A › B › Z › C › D, five.
    const [a, b, z, c, d] = CHAIN;
    for (const [i, id] of CHAIN.entries()) await place(id, `Level ${'ABZCD'[i]} (fixture)`, 5, 5, 12 + i);
    await add(b, z, { makesWhole: true });
    await add(z, c, { makesWhole: true });

    // The first word, held open as the writer holds it. Whatever fails, the
    // first is rolled back and released and the second awaited, so no lock
    // or connection outlives the test.
    const first = await pool.connect();
    let second: Promise<unknown> | undefined;
    try {
      await first.query('BEGIN');
      const locked = (await lockTwoExperiences(first, a, b))!;
      await holdPartWords(first);
      await setCuratorPartRecord(first, locked.get(a)!.lock, locked.get(b)!.lock, 'admitted', adminId);

      // The second meanwhile: it waits for the first word, then is judged on it.
      let settled = false;
      second = add(c, d, { makesWhole: true }).then(
        answer => { settled = true; return { answer }; },
        (error: unknown) => { settled = true; return { error }; },
      );
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(settled).toBe(false);
      await first.query('COMMIT');

      const outcome = await second;
      expect(outcome).toMatchObject({ error: { statusCode: 409, body: expect.objectContaining({ code: 'too-deep' }) } });
      expect(await relation(c, d)).toBeNull();
    } finally {
      // After a COMMIT this only warns that no transaction is open.
      await first.query('ROLLBACK').catch(() => undefined);
      first.release();
      await second;
    }
  });
});

describe('taking a part out', () => {
  it('withdraws the word of a part only the curator named, and the place leaves the whole', async () => {
    await add(SITE, GIRALDA);
    const answer = await takeOut(SITE, GIRALDA, 'Inside the cathedral, not a place of the site');
    expect(answer).toMatchObject({ act: 'taken_out', standing: false, keptOut: false, recordId: null });
    expect(await curatorRecord(SITE, GIRALDA)).toBeNull();
    expect(await relation(SITE, GIRALDA)).toBeNull();
    expect((await history(GIRALDA)).map(row => row.action)).toEqual(['part_added', 'part_taken_out']);
  });

  it('keeps out a part the list still names, and no run of the list puts it back', async () => {
    const answer = await takeOut(SITE, CATHEDRAL);
    expect(answer).toMatchObject({ act: 'taken_out', standing: false, keptOut: true });
    expect(await curatorRecord(SITE, CATHEDRAL)).toMatchObject({ admission: 'refused' });
    expect(await relation(SITE, CATHEDRAL)).toBeNull();

    // A run writes the list's record again: the line read anew, the relation asked again.
    await pool.query('DELETE FROM source_records WHERE source_id = 10 AND whole_id = $1', [SITE]);
    await listLine();
    await pool.query('SELECT refresh_part_relation($1, $2)', [SITE, CATHEDRAL]);
    expect(await relation(SITE, CATHEDRAL)).toBeNull();
  });

  it('puts a kept-out part back by withdrawing the refusal, so the list decides again', async () => {
    await takeOut(SITE, CATHEDRAL);
    const answer = await add(SITE, CATHEDRAL);
    expect(answer).toMatchObject({ act: 'put_back', standing: true, recordId: null });
    expect(await curatorRecord(SITE, CATHEDRAL)).toBeNull();
    expect(await relation(SITE, CATHEDRAL)).toBe('component');
    expect((await history(SITE)).map(row => row.action)).toEqual(['part_taken_out', 'part_put_back']);
  });

  it('refuses a place that is no part of the whole', async () => {
    await expect(takeOut(SITE, GIRALDA)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("the sections' reads in a curator's scope", () => {
  const curator = () => ({ id: curatorId, role: 'curator' } as Express.User);

  /** Seville's places in Andalusia, a curator scoped to it, and three Zixiao places 60–80 m from the cathedral. */
  async function regions(): Promise<void> {
    await pool.query("INSERT INTO world_views (id, name, is_default) VALUES ($1, 'Parts scope fixture', false)", [WORLD_VIEW]);
    await pool.query(
      `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf)
       VALUES ($1, $3, 'Andalusia (fixture)', NULL, true), ($2, $3, 'Hubei (fixture)', NULL, true)`,
      [ANDALUSIA, HUBEI, WORLD_VIEW],
    );
    await place(ELSEWHERE_UNREAD, 'Zixiao Palace (fixture)', 4, null, -5.9925);
    await place(ELSEWHERE_OFFERED, 'Zixiao Palace hall (fixture)', 4, 4, -5.9924);
    await place(HERE_UNREAD, 'Zixiao annex (fixture)', 4, null, -5.9923);
    // An arrival no curator has passed: in its kind, waiting, never published.
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
       SELECT id, 4, 4, 'Q98610' || id, 'pending' FROM unnest($1::int[]) AS id`,
      [[ELSEWHERE_UNREAD, HERE_UNREAD]],
    );
    await pool.query(
      `INSERT INTO experience_regions (experience_id, region_id, assignment_type)
       SELECT id, $2::int, 'manual' FROM unnest($1::int[]) AS id
       UNION ALL SELECT id, $3::int, 'manual' FROM unnest($4::int[]) AS id`,
      [[SITE, CATHEDRAL, GIRALDA, HERE_UNREAD], ANDALUSIA, HUBEI, [ELSEWHERE_UNREAD, ELSEWHERE_OFFERED]],
    );
    await pool.query(
      "INSERT INTO curator_assignments (user_id, scope_type, region_id, assigned_by) VALUES ($1, 'region', $2, $3)",
      [curatorId, ANDALUSIA, adminId],
    );
  }

  const takenOf = (rows: { place: { id: number }; taken: string | null }[]) =>
    Object.fromEntries(rows.map(row => [row.place.id, row.taken]));

  it("never offers an unread place outside the caller's scope, and says why an offered one cannot be chosen", async () => {
    await regions();
    for (const query of [{ role: 'part' as const, q: 'Zixiao' }, { role: 'part' as const }]) {
      const mine = takenOf((await findPartCandidates({ params: { id: SITE }, query, caller: curator() })).candidates);
      expect(mine).not.toHaveProperty(String(ELSEWHERE_UNREAD));
      expect(mine[ELSEWHERE_OFFERED]).toBe('scope');
      expect(mine[HERE_UNREAD]).toBeNull();

      const everyone = takenOf((await findPartCandidates({ params: { id: SITE }, query, caller: admin() })).candidates);
      expect(everyone[ELSEWHERE_UNREAD]).toBeNull();
      expect(everyone[ELSEWHERE_OFFERED]).toBeNull();
    }
  });

  it('measures a candidate only from parts the caller may see, and never names a hidden one', async () => {
    await regions();
    // The unread part in another region stands 18 m from the annex; Seville
    // Cathedral, a part the curator may see, 71 m.
    await add(SITE, ELSEWHERE_UNREAD);
    const query = { role: 'part' as const, q: 'Zixiao annex' };
    const mine = (await findPartCandidates({ params: { id: SITE }, query, caller: curator() })).candidates;
    expect(mine.find(row => row.place.id === HERE_UNREAD)).toMatchObject({ near_name: 'Seville Cathedral (fixture)' });
    expect(mine.find(row => row.place.id === HERE_UNREAD)!.distance_m).toBeGreaterThan(60);
    expect(JSON.stringify(mine)).not.toContain('Zixiao Palace (fixture)');

    const everyone = (await findPartCandidates({ params: { id: SITE }, query, caller: admin() })).candidates;
    expect(everyone.find(row => row.place.id === HERE_UNREAD)).toMatchObject({ near_name: 'Zixiao Palace (fixture)' });
  });

  it("lists a whole's parts the caller may see, and says which are outside the caller's scope", async () => {
    await regions();
    await add(SITE, ELSEWHERE_UNREAD);
    await add(SITE, ELSEWHERE_OFFERED, { note: 'A hall of the palace' });
    const mine = (await listPlaceParts({ params: { id: SITE }, caller: curator() })).parts;
    expect(mine.map(row => [row.place.id, row.in_scope])).toEqual([[CATHEDRAL, true], [ELSEWHERE_OFFERED, false]]);
    const everyone = (await listPlaceParts({ params: { id: SITE }, caller: admin() })).parts;
    expect(everyone.map(row => row.place.id)).toContain(ELSEWHERE_UNREAD);

    // The note is read as the place's own history shows it: a row naming a
    // region outside the caller's scope reads as none.
    expect(mine.find(row => row.place.id === ELSEWHERE_OFFERED)?.curator?.note).toBe('A hall of the palace');
    await pool.query(
      "UPDATE experience_curation_log SET region_id = $2 WHERE experience_id = $1 AND action = 'part_added'", [SITE, HUBEI],
    );
    const hidden = (await listPlaceParts({ params: { id: SITE }, caller: curator() })).parts;
    expect(hidden.find(row => row.place.id === ELSEWHERE_OFFERED)?.curator).toMatchObject({ note: null, by_you: false });
    const shown = (await listPlaceParts({ params: { id: SITE }, caller: admin() })).parts;
    expect(shown.find(row => row.place.id === ELSEWHERE_OFFERED)?.curator?.note).toBe('A hall of the palace');
  });
});

describe('what the sections read', () => {
  it("lists a whole's parts with whose word makes each, and a kept-out one after them", async () => {
    await add(SITE, GIRALDA, { note: 'The bell tower' });
    await takeOut(SITE, CATHEDRAL, 'Not the cathedral');
    const read = await listPlaceParts({ params: { id: SITE }, caller: admin() });
    expect(read).toMatchObject({ experienceId: SITE, in_kind: true, merged_onto: false, wholes: [] });
    expect(read.parts.map(row => [row.place.id, row.standing])).toEqual([[GIRALDA, true], [CATHEDRAL, false]]);
    expect(read.parts[0]).toMatchObject({
      list: null, statement: false, place: { kind_name: 'Towers' },
      curator: { admission: 'admitted', by_you: true, note: 'The bell tower' },
    });
    expect(read.parts[1]).toMatchObject({
      list: { reference: '383bis-001', name: null },
      curator: { admission: 'refused', by_you: true, note: 'Not the cathedral' },
    });

    const fromThePart = await listPlaceParts({ params: { id: CATHEDRAL }, caller: admin() });
    expect(fromThePart.wholes.map(row => [row.place.id, row.standing])).toEqual([[SITE, false]]);
  });

  it("offers the places near a whole's parts, nearest first, and says which cannot be chosen", async () => {
    const near = await findPartCandidates({ params: { id: SITE }, query: { role: 'part' }, caller: admin() });
    expect(near.near).toBe(true);
    const ids = near.candidates.map(row => row.place.id);
    expect(ids).toContain(GIRALDA);
    expect(ids).not.toContain(ENSEMBLE);
    const giralda = near.candidates.find(row => row.place.id === GIRALDA)!;
    expect(giralda).toMatchObject({ near_name: 'Seville Cathedral (fixture)', taken: null, kept_out: false });
    expect(giralda.distance_m).toBeGreaterThan(50);
    expect(giralda.distance_m).toBeLessThan(80);
    // A standing part is no suggestion; asked by name, it says why it cannot be chosen.
    expect(ids).not.toContain(CATHEDRAL);
    const byName = await findPartCandidates({ params: { id: SITE }, query: { role: 'part', q: 'Cathedral' }, caller: admin() });
    expect(byName.candidates.find(row => row.place.id === CATHEDRAL)).toMatchObject({ taken: 'already', distance_m: 0 });
    expect(byName.candidates.find(row => row.place.id === SITE)).toMatchObject({ taken: 'self' });

    const named = await findPartCandidates({ params: { id: CATHEDRAL }, query: { role: 'part', q: 'Seville' }, caller: admin() });
    expect(named.candidates.find(row => row.place.id === SITE)).toMatchObject({ taken: 'loop' });
    expect(named.candidates.find(row => row.place.id === CATHEDRAL)).toMatchObject({ taken: 'self' });
  });

  it('offers a whole 4.85 km east of a place at 65°N, inside the 5 km a whole is offered from', async () => {
    // At the Solovetsky Islands' latitude a degree of longitude is 47 km, so
    // 4.85 km east is 0.103°: outside a fixed box of 0.1°.
    const [here, whole, itsPart] = CHAIN;
    await place(here, 'Solovetsky Monastery (fixture)', 4, 4, 35.70, 65.02);
    await place(whole, 'A whole east of it (fixture)', 5, 5, 35.70 + 0.1031, 65.02);
    await place(itsPart, 'Its part (fixture)', 5, 5, 35.70 + 0.1031, 65.03);
    await add(whole, itsPart, { makesWhole: true });

    const wholes = await findPartCandidates({ params: { id: here }, query: { role: 'whole' }, caller: admin() });
    const found = wholes.candidates.find(row => row.place.id === whole);
    expect(found).toBeDefined();
    expect(found!.distance_m).toBeGreaterThan(4800);
    expect(found!.distance_m).toBeLessThan(5000);
  });

  it('finds a place across the antimeridian from an empty whole', async () => {
    // Taveuni in Fiji: 179.997°E and 179.997°W at 16.8°S stand 640 m apart.
    const [whole, across] = CHAIN;
    await place(whole, 'A whole east of the line (fixture)', 5, 5, 179.997, -16.8);
    await place(across, 'A place west of the line (fixture)', 4, 4, -179.997, -16.8);
    const near = await findPartCandidates({ params: { id: whole }, query: { role: 'part' }, caller: admin() });
    const found = near.candidates.find(row => row.place.id === across);
    expect(found).toBeDefined();
    expect(found!.distance_m).toBeGreaterThan(600);
    expect(found!.distance_m).toBeLessThan(680);
  });

  it('finds a place near a pole whatever its longitude', async () => {
    // Two places 556 m from the South Pole and 120° apart stand 963 m from each
    // other: inside the kilometre a part is offered from, outside any box a
    // cosine clamp would allow.
    const [whole, across] = CHAIN;
    await place(whole, 'A whole by the pole (fixture)', 5, 5, 0, -89.995);
    await place(across, 'A place across the pole (fixture)', 4, 4, 120, -89.995);
    const near = await findPartCandidates({ params: { id: whole }, query: { role: 'part' }, caller: admin() });
    const found = near.candidates.find(row => row.place.id === across);
    expect(found).toBeDefined();
    expect(found!.distance_m).toBeGreaterThan(900);
    expect(found!.distance_m).toBeLessThan(1000);
  });

  it('names the part nearest in metres, not in degrees', async () => {
    // A place at (0°, 60°N); one part 0.015° east (837 m), another 0.012° north
    // (1,334 m). In degrees the northern one is nearer.
    const [whole, east, north, candidate] = CHAIN;
    await place(whole, 'A whole (fixture)', 5, 5, 0.005, 60.005);
    await place(east, 'The part to the east (fixture)', 5, 5, 0.015, 60);
    await place(north, 'The part to the north (fixture)', 5, 5, 0, 60.012);
    await place(candidate, 'A place between them (fixture)', 4, 4, 0, 60);
    await add(whole, east, { makesWhole: true });
    await add(whole, north);

    const near = await findPartCandidates({ params: { id: whole }, query: { role: 'part' }, caller: admin() });
    const found = near.candidates.find(row => row.place.id === candidate);
    expect(found).toMatchObject({ near_name: 'The part to the east (fixture)' });
    expect(found!.distance_m).toBeGreaterThan(830);
    expect(found!.distance_m).toBeLessThan(845);
  });

  it('offers an empty whole the places near it, and a part the wholes near it', async () => {
    const ensemble = await findPartCandidates({ params: { id: ENSEMBLE }, query: { role: 'part' }, caller: admin() });
    expect(ensemble.candidates.map(row => [row.place.id, row.near_name])).toEqual([[TABLE, null]]);

    const wholes = await findPartCandidates({ params: { id: GIRALDA }, query: { role: 'whole' }, caller: admin() });
    expect(wholes.candidates.map(row => row.place.id)).toEqual([SITE]);
  });
});
