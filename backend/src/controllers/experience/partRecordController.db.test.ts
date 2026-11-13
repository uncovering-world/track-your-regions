import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockTwoExperiences } from '../../db/experienceWriter.js';
import { setCuratorPartRecord } from './membershipWriter.js';
import { addPart, holdPartWords, takeOutPart } from './partRecordController.js';

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
const ALL = [SITE, CATHEDRAL, GIRALDA, ENSEMBLE, TABLE, FOLDED, ...CHAIN];
const ADMIN = '00000000-0000-4000-8000-000000009861';
const CURATOR = '00000000-0000-4000-8000-000000009862';

let adminId = 0;
let curatorId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[])', [ALL]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE id = ANY($1::int[])', [ALL]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [ALL]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN, CURATOR]]);
}

async function place(id: number, name: string, sourceId: number, kindId: number | null, lon = -5.9927): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, 37.3846), 4326))`,
    [id, sourceId, `Q98610${id}`, name, lon],
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

