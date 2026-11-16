import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { followTheirPoints } from '../../db/partFieldsWriter.js';
import { partAssertions } from '../admin/dataAssertions/partAssertions.js';
import { replacePartPlace } from './partLineController.js';
import { addPart } from './partRecordController.js';
import { findPartCandidates, listPlaceParts } from './partRecordRead.js';

/**
 * A curator moves a World Heritage list line from the place that holds it to
 * the place it names, in one act (#2527), executed against PostgreSQL: the
 * line's record and its point move together, the place the line left leaves
 * the whole, one history row on each of the three places, and moving it back
 * restores both halves.
 *
 * Modelled on Thessaloniki's site as the development catalogue holds it on
 * 2026-11-16: the list's line 456-002 "Rotunda" is held by the place "Arch of
 * Galerius and Rotunda" (Archaeology), whose picture is the arch; the Rotunda
 * stands 151 m away as a place of its own (Places of worship); and the line
 * 456-006 "Church of St. Sophia" is held by Hagia Sophia, which keeps the site
 * serial. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9881;
const ARCH = 9882;
const ROTUNDA = 9883;
const SOPHIA = 9884;
const ALL = [SITE, ARCH, ROTUNDA, SOPHIA];
const ADMIN = '00000000-0000-4000-8000-000000009881';
const LINE = { ref: '456-002', name: 'Rotunda', lon: 22.96967, lat: 40.64133 };

let adminId = 0;
let siteMembership = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [ALL]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

/** A seeded source, looked up by name. */
interface Source { id: number; kind_id: number | null }
const SOURCE_NAMES = {
  site: 'UNESCO World Heritage Sites',
  archaeology: 'Archaeology',
  worship: 'Places of worship',
  components: 'World Heritage components',
  curators: 'Curators',
} as const;
let src: Record<keyof typeof SOURCE_NAMES, Source>;

async function lookUpSources(): Promise<void> {
  const rows = (await pool.query<Source & { name: string }>(
    'SELECT id, kind_id, name FROM experience_sources WHERE name = ANY($1::text[])', [Object.values(SOURCE_NAMES)],
  )).rows;
  const named = (key: keyof typeof SOURCE_NAMES): Source => {
    const row = rows.find(seeded => seeded.name === SOURCE_NAMES[key])!;
    return { id: row.id, kind_id: row.kind_id };
  };
  src = {
    site: named('site'), archaeology: named('archaeology'), worship: named('worship'),
    components: named('components'), curators: named('curators'),
  };
}

/** A place in a kind, under its source's scheme: a site's number, or an item `Q<id>001`. */
async function place(id: number, name: string, source: Source, lon: number, lat: number): Promise<number> {
  const external = source === src.site ? String(id) : `Q${id}001`;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, source.id, external, name, lon, lat],
  );
  return (await pool.query<{ id: number }>(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW()) RETURNING id`,
    [id, source.kind_id, source.id, external],
  )).rows[0].id;
}

/** A line of the list held by `holder`: its record in the site, and its point, placed by the site's membership. */
async function listLine(holder: number, line: typeof LINE): Promise<void> {
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, reported_name, curation_state, published_at)
     VALUES ($1, $2, $5, $3, $4, 'auto', NOW())`,
    [holder, SITE, line.ref, line.name, src.components.id],
  );
  await linePoint(holder, line, 'auto');
}

/** The line's point on `holder`, placed by the site's membership, in the state given (a point moves only pending to verified). */
async function linePoint(holder: number, line: typeof LINE, state: 'auto' | 'verified'): Promise<void> {
  await pool.query(
    `WITH pt AS (
       INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $7) RETURNING id)
     INSERT INTO experience_location_placements (location_id, membership_id) SELECT id, $6 FROM pt`,
    [holder, line.name, line.ref, line.lon, line.lat, siteMembership, state],
  );
}

beforeEach(async () => {
  await lookUpSources();
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  siteMembership = await place(SITE, 'Paleochristian and Byzantine Monuments of Thessalonika (fixture)', src.site, 22.9444, 40.6403);
  await place(ARCH, 'Arch of Galerius and Rotunda (fixture)', src.archaeology, 22.95174, 40.63224);
  await place(ROTUNDA, 'Rotunda (fixture)', src.worship, 22.95285, 40.63330);
  await place(SOPHIA, 'Hagia Sophia (fixture)', src.worship, 22.94664, 40.63283);
  await listLine(ARCH, LINE);
  await listLine(SOPHIA, { ref: '456-006', name: 'Church of St. Sophia', lon: 22.94664, lat: 40.63283 });
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const admin = () => ({ id: adminId, role: 'admin' } as Express.User);
const replace = (partId: number, withId: number, note?: string, reference = '456-002') =>
  replacePartPlace({ params: { id: SITE }, body: { partId, withId, reference, note }, caller: admin() });
/** The snackbar's Undo of a move: the line back, naming the move it reverses. */
const undo = (moved: { fromId: number; toId: number; reference: string; logId: number }) =>
  replacePartPlace({
    params: { id: SITE },
    body: { partId: moved.toId, withId: moved.fromId, reference: moved.reference, undoes: moved.logId },
    caller: admin(),
  });

/** A curator's word on the pair of the site and `place`. */
async function curatorWord(place: number, admission: 'admitted' | 'refused'): Promise<void> {
  await pool.query(
    `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission, curation_state, published_at)
     VALUES ($1, $2, $5, $3, $4, 'verified', NOW())`,
    [place, SITE, `curator-1-${place}`, admission, src.curators.id],
  );
}

async function wordOn(place: number): Promise<string | null> {
  return (await pool.query<{ admission: string }>(
    'SELECT admission FROM source_records WHERE source_id = $3 AND whole_id = $1 AND experience_id = $2',
    [SITE, place, src.curators.id],
  )).rows[0]?.admission ?? null;
}

async function holderOf(ref: string): Promise<number | null> {
  return (await pool.query<{ experience_id: number }>(
    'SELECT experience_id FROM source_records WHERE source_id = $3 AND whole_id = $1 AND external_id = $2',
    [SITE, ref, src.components.id],
  )).rows[0]?.experience_id ?? null;
}

async function pointHolderOf(ref: string): Promise<number[]> {
  return (await pool.query<{ experience_id: number }>(
    'SELECT experience_id FROM experience_locations WHERE external_ref = $1 AND experience_id = ANY($2::int[])', [ref, ALL],
  )).rows.map(row => row.experience_id);
}

async function isPart(id: number): Promise<boolean> {
  return (await pool.query('SELECT 1 FROM experience_parts WHERE whole_id = $1 AND part_id = $2', [SITE, id])).rowCount === 1;
}

async function history(id: number): Promise<{ action: string; details: Record<string, unknown> }[]> {
  return (await pool.query<{ action: string; details: Record<string, unknown> }>(
    "SELECT action, details FROM experience_curation_log WHERE experience_id = $1 AND action = 'part_replaced' ORDER BY id",
    [id],
  )).rows;
}

async function outOfStep(): Promise<Array<Record<string, unknown>>> {
  const rule = partAssertions.find(assertion => assertion.id === 'part-gate-out-of-step')!;
  return (await pool.query<Record<string, unknown>>(rule.sql)).rows.filter(row => Number(row.whole_id) === SITE);
}

describe('moving a list line to the place it names', () => {
  it('moves the line\'s record and its point to the Rotunda in one act, and the arch leaves the site', async () => {
    expect(await isPart(ARCH)).toBe(true);

    const answer = await replace(ARCH, ROTUNDA, 'The line names the Rotunda, not the arch');

    expect(answer).toEqual({
      wholeId: SITE, fromId: ARCH, toId: ROTUNDA, reference: '456-002', keptOut: false, points: 1, logId: expect.any(Number),
    });
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect(await pointHolderOf('456-002')).toEqual([ROTUNDA]);
    expect(await isPart(ROTUNDA)).toBe(true);
    expect(await isPart(ARCH)).toBe(false);
    // The arch keeps its own place in Archaeology, and the other line is untouched.
    expect((await pool.query('SELECT 1 FROM source_records WHERE experience_id = $1 AND kind_id = 5', [ARCH])).rowCount).toBe(1);
    expect(await holderOf('456-006')).toBe(SOPHIA);
    // No list names the arch now, so no curator's record is needed to keep it out.
    expect((await pool.query('SELECT 1 FROM source_records WHERE source_id = $2 AND whole_id = $1', [SITE, src.curators.id]))
      .rowCount).toBe(0);
  });

  it('writes one history row on each of the three places, with the line and the note', async () => {
    await replace(ARCH, ROTUNDA, 'The line names the Rotunda, not the arch');
    for (const id of [SITE, ARCH, ROTUNDA]) {
      const rows = await history(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({
        wholeId: SITE, fromId: ARCH, toId: ROTUNDA, reference: '456-002', lineName: 'Rotunda',
        note: 'The line names the Rotunda, not the arch', keptOut: false, points: 1,
      });
    }
  });

  it('keeps the line\'s record and point on one place, so the gate follows the point and stays in step', async () => {
    await pool.query("DELETE FROM experience_locations WHERE experience_id = $1 AND external_ref = '456-002'", [ARCH]);
    await linePoint(ARCH, LINE, 'verified');
    await replace(ARCH, ROTUNDA);
    const record = (await pool.query<{ curation_state: string }>(
      "SELECT curation_state FROM source_records WHERE source_id = $2 AND whole_id = $1 AND external_id = '456-002'",
      [SITE, src.components.id],
    )).rows[0];
    expect(record.curation_state).toBe('verified');
    expect(await outOfStep()).toEqual([]);
  });

  it('moves back the same way, restoring the record, the point and the arch\'s place in the site', async () => {
    await replace(ARCH, ROTUNDA);
    const back = await replace(ROTUNDA, ARCH);

    expect(back).toMatchObject({ fromId: ROTUNDA, toId: ARCH, reference: '456-002', points: 1 });
    expect(await holderOf('456-002')).toBe(ARCH);
    expect(await pointHolderOf('456-002')).toEqual([ARCH]);
    expect(await isPart(ARCH)).toBe(true);
    expect(await isPart(ROTUNDA)).toBe(false);
    expect(await outOfStep()).toEqual([]);
  });

  it('lets the list decide a place a curator had kept out, once the line moves to it', async () => {
    await curatorWord(ROTUNDA, 'refused');
    await replace(ARCH, ROTUNDA);
    expect(await wordOn(ROTUNDA)).toBeNull();
    expect(await isPart(ROTUNDA)).toBe(true);
  });
});

describe("the search for the line's new place", () => {
  const search = async (q?: string) => (await findPartCandidates({
    params: { id: SITE }, query: { role: 'line', q }, caller: admin(),
  })).candidates.map(candidate => ({ id: candidate.place.id, taken: candidate.taken }));

  /** The Rotunda a part already, by a curator's word rather than by a line of the list. */
  async function wordMakesRotundaAPart(): Promise<void> {
    await curatorWord(ROTUNDA, 'admitted');
  }

  it('offers a part that holds no line of the list, where an add would not', async () => {
    await wordMakesRotundaAPart();
    expect(await isPart(ROTUNDA)).toBe(true);
    expect(await search()).toContainEqual({ id: ROTUNDA, taken: null });
    const asAdd = (await findPartCandidates({ params: { id: SITE }, query: { role: 'part' }, caller: admin() })).candidates;
    expect(asAdd.map(candidate => candidate.place.id)).not.toContain(ROTUNDA);
    expect(await replace(ARCH, ROTUNDA)).toMatchObject({ toId: ROTUNDA, reference: '456-002' });
  });

  it('names a place that holds a line already as taken, and leaves it out of the places near', async () => {
    expect((await search()).map(candidate => candidate.id)).not.toContain(SOPHIA);
    expect(await search('Hagia Sophia (fixture)')).toEqual([{ id: SOPHIA, taken: 'already' }]);
  });
});

/** What the site's run does to its parts after a list read: names and places them for their points, and parts new lines. */
async function runOfTheSite(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const site = (await lockExperience(client, SITE))!;
    await followTheirPoints(client, site.lock, null);
    await client.query('SELECT part_site_components($1, $2)', [SITE, siteMembership]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe("the site's next run after a move", () => {
  it('leaves the line on the Rotunda, and the Rotunda its own name and coordinate', async () => {
    await replace(ARCH, ROTUNDA);
    await runOfTheSite();
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect(await pointHolderOf('456-002')).toEqual([ROTUNDA]);
    expect(await isPart(ARCH)).toBe(false);
    const rotunda = (await pool.query<{ name: string; lon: number }>(
      'SELECT name, ST_X(location) AS lon FROM experiences WHERE id = $1', [ROTUNDA],
    )).rows[0];
    // A place in a kind of its own names and places itself: not "Rotunda" at the list's coordinate 1.6 km off.
    expect(rotunda).toEqual({ name: 'Rotunda (fixture)', lon: 22.95285 });
  });
});

describe("a line whose point is the old place's own", () => {
  /**
   * As on the development catalogue on 2026-11-16: the site paired its line
   * 456-002 with the arch's own point (Archaeology's, under the arch's item),
   * so one point is placed by both records. It stays the arch's, at the arch.
   */
  async function shareTheArchsPoint(): Promise<number> {
    await pool.query("DELETE FROM experience_locations WHERE experience_id = $1 AND external_ref = '456-002'", [ARCH]);
    return (await pool.query<{ id: number }>(
      `WITH pt AS (
         INSERT INTO experience_locations (experience_id, external_ref, location, curation_state)
         VALUES ($1, 'Q${ARCH}001', ST_SetSRID(ST_MakePoint(22.95174, 40.63224), 4326), 'verified') RETURNING id)
       INSERT INTO experience_location_placements (location_id, membership_id)
       SELECT pt.id, m.id FROM pt, source_records m
        WHERE m.id = $2 OR (m.experience_id = $1 AND m.kind_id IS NOT NULL)
       RETURNING location_id AS id`,
      [ARCH, siteMembership],
    )).rows[0].id;
  }

  it('moves the record alone, leaves the arch its point, and says no point moved', async () => {
    const archPoint = await shareTheArchsPoint();
    const answer = await replace(ARCH, ROTUNDA);
    expect(answer).toMatchObject({ reference: '456-002', points: 0 });
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect(await isPart(ROTUNDA)).toBe(true);
    expect(await isPart(ARCH)).toBe(false);
    expect((await pool.query('SELECT experience_id FROM experience_locations WHERE id = $1', [archPoint])).rows)
      .toEqual([{ experience_id: ARCH }]);
    expect((await history(ROTUNDA))[0].details).toMatchObject({ points: 0 });
    // The Rotunda holds no line point, so its record is not read by points (part-gate-out-of-step).
    expect(await outOfStep()).toEqual([]);
  });

  it('keeps a point under the line\'s own reference on the arch when the arch\'s kind places it too', async () => {
    const point = (await pool.query<{ id: number }>(
      "SELECT id FROM experience_locations WHERE experience_id = $1 AND external_ref = '456-002'", [ARCH],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO experience_location_placements (location_id, membership_id)
       SELECT $1, id FROM source_records WHERE experience_id = $2 AND kind_id IS NOT NULL`,
      [point, ARCH],
    );
    expect(await replace(ARCH, ROTUNDA)).toMatchObject({ points: 0 });
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect((await pool.query('SELECT experience_id FROM experience_locations WHERE id = $1', [point])).rows)
      .toEqual([{ experience_id: ARCH }]);
  });

  it("stays on the Rotunda through the site's next run, the arch keeping its point", async () => {
    const archPoint = await shareTheArchsPoint();
    await replace(ARCH, ROTUNDA);
    await runOfTheSite();
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect(await isPart(ROTUNDA)).toBe(true);
    expect(await isPart(ARCH)).toBe(false);
    expect((await pool.query('SELECT experience_id FROM experience_locations WHERE id = $1', [archPoint])).rows)
      .toEqual([{ experience_id: ARCH }]);
    expect(await outOfStep()).toEqual([]);
  });

  it('moves back the same way, and the arch is the line\'s place again', async () => {
    await shareTheArchsPoint();
    await replace(ARCH, ROTUNDA);
    await replace(ROTUNDA, ARCH);
    expect(await holderOf('456-002')).toBe(ARCH);
    expect(await isPart(ARCH)).toBe(true);
    expect(await isPart(ROTUNDA)).toBe(false);
    expect(await outOfStep()).toEqual([]);
  });
});

describe("the snackbar's Undo", () => {
  it('keeps a curator\'s word that already made the place the line reached a part', async () => {
    await curatorWord(ROTUNDA, 'admitted');
    await undo(await replace(ARCH, ROTUNDA));
    expect(await holderOf('456-002')).toBe(ARCH);
    expect(await wordOn(ROTUNDA)).toBe('admitted');
    expect(await isPart(ROTUNDA)).toBe(true);
    expect(await isPart(ARCH)).toBe(true);
  });

  it('shows the Undo as the last word on the place it set back, not the move\'s note', async () => {
    await curatorWord(ARCH, 'admitted');
    await undo(await replace(ARCH, ROTUNDA, 'The line names the Rotunda, not the arch'));
    const arch = (await listPlaceParts({ params: { id: SITE }, caller: admin() })).parts
      .find(part => part.place.id === ARCH);
    expect(arch?.curator).toMatchObject({ admission: 'admitted', note: null });
  });

  it('gives back a refusal of the place the line reached, which the move withdrew', async () => {
    await curatorWord(ROTUNDA, 'refused');
    const moved = await replace(ARCH, ROTUNDA);
    expect(await wordOn(ROTUNDA)).toBeNull();
    await undo(moved);
    expect(await wordOn(ROTUNDA)).toBe('refused');
    expect(await isPart(ROTUNDA)).toBe(false);
  });

  it('moves back the points its move moved, and none the place held before', async () => {
    const own = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, external_ref, location, curation_state)
       VALUES ($1, '456-002', ST_SetSRID(ST_MakePoint(22.95285, 40.63330), 4326), 'auto') RETURNING id`, [ROTUNDA],
    )).rows[0].id;
    const moved = await replace(ARCH, ROTUNDA);
    expect(moved.points).toBe(1);
    await undo(moved);
    expect(await pointHolderOf('456-002')).toEqual(expect.arrayContaining([ARCH, ROTUNDA]));
    expect((await pool.query('SELECT experience_id FROM experience_locations WHERE id = $1', [own])).rows)
      .toEqual([{ experience_id: ROTUNDA }]);
  });

  it('refuses to undo a move after a curator said a word on one of its places, which it would erase', async () => {
    const moved = await replace(ARCH, ROTUNDA);
    await addPart({ params: { id: SITE }, body: { partId: ARCH }, caller: admin() });
    expect(await wordOn(ARCH)).toBe('admitted');
    await expect(undo(moved)).rejects.toMatchObject({ statusCode: 409 });
    expect(await holderOf('456-002')).toBe(ROTUNDA);
    expect(await wordOn(ARCH)).toBe('admitted');
  });

  it('leaves a moved point the place\'s own kind has placed since where it is, and moves the record back', async () => {
    const moved = await replace(ARCH, ROTUNDA);
    const point = (await pool.query<{ id: number }>(
      "SELECT id FROM experience_locations WHERE experience_id = $1 AND external_ref = '456-002'", [ROTUNDA],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO experience_location_placements (location_id, membership_id)
       SELECT $1, id FROM source_records WHERE experience_id = $2 AND kind_id IS NOT NULL`,
      [point, ROTUNDA],
    );
    const back = await undo(moved);
    expect(back.points).toBe(0);
    expect(await holderOf('456-002')).toBe(ARCH);
    expect((await pool.query('SELECT experience_id FROM experience_locations WHERE id = $1', [point])).rows)
      .toEqual([{ experience_id: ROTUNDA }]);
  });

  it('refuses to undo a move that is no longer the line\'s latest, writing nothing', async () => {
    const first = await replace(ARCH, ROTUNDA);
    await replace(ROTUNDA, ARCH);
    await replace(ARCH, ROTUNDA);
    await expect(undo(first)).rejects.toMatchObject({ statusCode: 409 });
    expect(await holderOf('456-002')).toBe(ROTUNDA);
  });
});

describe('what a move refuses, writing nothing', () => {
  it('refuses a place that holds no line of the list', async () => {
    await expect(replace(ROTUNDA, ARCH)).rejects.toMatchObject({ statusCode: 409 });
    expect(await holderOf('456-002')).toBe(ARCH);
  });

  it('refuses a line other than the one named, which the place no longer holds', async () => {
    await expect(replace(ARCH, ROTUNDA, undefined, '456-006')).rejects.toMatchObject({ statusCode: 409 });
    expect(await holderOf('456-002')).toBe(ARCH);
    expect(await history(ARCH)).toEqual([]);
  });

  it('refuses a place that holds a line of the list already', async () => {
    await expect(replace(ARCH, SOPHIA)).rejects.toMatchObject({ statusCode: 409 });
    expect(await holderOf('456-002')).toBe(ARCH);
    expect(await pointHolderOf('456-002')).toEqual([ARCH]);
  });

  it('refuses the whole itself, or a place named twice', async () => {
    await expect(replace(ARCH, ARCH)).rejects.toMatchObject({ statusCode: 400 });
    await expect(replace(ARCH, SITE)).rejects.toMatchObject({ statusCode: 400 });
    expect(await history(SITE)).toEqual([]);
  });
});
