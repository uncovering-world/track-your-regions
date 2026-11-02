import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerCrowding } from './crowdingAnswers.js';
import { getCrowdingWindow, listShadowedArrivals } from './crowdingWindow.js';

/**
 * A curator sorting a crowded city into the list and the shadow (ADR-0180,
 * #2282), executed against PostgreSQL: the pins as the recount reads them (a
 * place kept in the list is never crowded out and takes one of the ten above
 * the rest, a place kept in the shadow is always crowded out and counts among
 * none of the ten), the window over Berlin's squares around the Schloßplatz,
 * the arrivals the display shadows, and the answers applied together, each
 * through the writer the arrival's card calls.
 *
 * Berlin's squares are as the development catalogue held them on 2026-11-02:
 * the twenty-two squares of Squares & streets within 10 km of the Schloßplatz,
 * with their coordinates, fame signals and score, and whether a curator had
 * passed each. Ten were shown (Alexanderplatz to Hackescher Markt); Frankfurter
 * Tor, Leipziger Platz and the arrivals below them were shadowed. The scores
 * are written as they stood rather than ranked again, since a refresh ranks
 * among every square the test database holds.
 *
 * Beside the squares, two places that take no pin: San Luigi dei Francesi,
 * a church of Rome that holds Caravaggio's Calling of Saint Matthew (ADR-0173),
 * and the Neues Museum, a museum Archaeology admits for its finds and never
 * crowds (ADR-0179). Ids are the fixture's own, deleted before and after.
 */

const BASE = 9_282_100;
const SAN_LUIGI = BASE + 50;
const NEUES_MUSEUM = BASE + 51;
const ADMIN = '00000000-0000-4000-8000-000000092821';
const CURATOR = '00000000-0000-4000-8000-000000092822';

let adminId = 0;
let curatorId = 0;
let squares = new Map<string, { place: number; membership: number }>();
let sanLuigi = 0;
let neuesMuseum = 0;

/** Name, latitude, longitude, readers a year, Wikipedia editions, Wikivoyage editions, gate state, score. */
type Square = readonly [string, number, number, number, number, number, 'verified' | 'pending', number];

const BERLIN_SQUARES: readonly Square[] = [
  ['Alexanderplatz', 52.52167, 13.41361, 209401, 47, 3, 'verified', 0.6980],
  ['Potsdamer Platz', 52.50894, 13.37633, 174898, 48, 4, 'verified', 0.6948],
  ['Gendarmenmarkt', 52.51361, 13.39278, 87927, 29, 3, 'verified', 0.6488],
  ['Pariser Platz', 52.51639, 13.37889, 42287, 33, 2, 'verified', 0.6213],
  ['Bebelplatz', 52.51640, 13.39390, 45783, 25, 4, 'verified', 0.6047],
  ['Lustgarten', 52.51861, 13.39972, 31244, 25, 1, 'verified', 0.5683],
  ['Breitscheidplatz', 52.50483, 13.33617, 25921, 21, 1, 'verified', 0.5281],
  ['Platz der Republik', 52.51860, 13.37250, 33522, 17, 1, 'verified', 0.5236],
  ['Nollendorfplatz', 52.49920, 13.35390, 24075, 19, 1, 'verified', 0.5064],
  ['Hackescher Markt', 52.52333, 13.40278, 20878, 17, 2, 'verified', 0.4693],
  ['Frankfurter Tor', 52.51581, 13.45403, 27055, 12, 1, 'pending', 0.4330],
  ['Leipziger Platz', 52.50964, 13.37844, 12809, 18, 3, 'verified', 0.4125],
  ['Rosa-Luxemburg-Platz', 52.52690, 13.41110, 18952, 17, 0, 'pending', 0.4049],
  ['Schloßplatz', 52.51694, 13.40139, 17802, 17, 0, 'pending', 0.3972],
  ['Kottbusser Tor', 52.49920, 13.41810, 38363, 7, 1, 'pending', 0.3953],
  ['Hermannplatz', 52.48722, 13.42472, 35916, 5, 1, 'pending', 0.3499],
  ['Wittenbergplatz', 52.50190, 13.34280, 10953, 18, 0, 'pending', 0.3423],
  ['Strausberger Platz', 52.51853, 13.42831, 14451, 10, 1, 'pending', 0.3238],
  ['Großer Stern', 52.51450, 13.35011, 15299, 9, 1, 'pending', 0.3225],
  ['Mehringplatz', 52.49889, 13.39167, 13459, 7, 1, 'pending', 0.2682],
  ['Savignyplatz', 52.50580, 13.32240, 12745, 3, 2, 'pending', 0.1845],
  ['Winterfeldtplatz', 52.49500, 13.35470, 4690, 5, 3, 'pending', 0.1341],
];

/** Squares & streets, under the id of the source that fills it. */
const SQUARES = 9;

/**
 * Write the squares from `base` on, one id each in the list's order, and
 * recount the catalogue. Answers each square's membership by name.
 */
async function plantBerlinSquares(base: number): Promise<Map<string, { place: number; membership: number }>> {
  const planted = new Map<string, { place: number; membership: number }>();
  for (const [index, [name, lat, lon, readers, editions, guides, state, score]] of BERLIN_SQUARES.entries()) {
    const place = base + index;
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
      [place, SQUARES, `Q${place}`, name, lon, lat],
    );
    const membership = await pool.query<{ id: number }>(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
       VALUES ($1, $2, $2, $3, 'square', $4, $5) RETURNING id`,
      [place, SQUARES, `Q${place}`, state, state === 'pending' ? null : new Date()],
    );
    await pool.query(
      `INSERT INTO membership_fame (membership_id, readers, guide_editions, wikipedia_editions, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [membership.rows[0].id, readers, guides, editions, score],
    );
    planted.set(name, { place, membership: membership.rows[0].id });
  }
  await pool.query('SELECT recount_crowding(NULL)');
  return planted;
}

/** The squares the display shadows, by name, from `base` on. */
async function shadowedSquares(base: number): Promise<string[]> {
  return (await pool.query<{ name: string }>(
    `SELECT e.name FROM membership_crowding c
       JOIN experience_kind_memberships m ON m.id = c.membership_id
       JOIN experiences e ON e.id = m.experience_id
      WHERE e.id >= $1 AND e.id < $2 ORDER BY e.id`, [base, base + BERLIN_SQUARES.length])).rows.map(row => row.name);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id >= $1 AND id < $2', [BASE, BASE + 100]);
  await pool.query("DELETE FROM treasures WHERE external_id = 'Q928215-calling'");
  await pool.query('DELETE FROM curator_assignments WHERE assigned_by IN (SELECT id FROM users WHERE uuid = $1)', [ADMIN]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN, CURATOR]]);
}

/** A place of one kind, published, with a score so the rule reads it. */
async function plant(id: number, name: string, kind: number, type: string, lat: number, lon: number): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, kind, `Q${id}`, name, lon, lat]);
  const membership = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
     VALUES ($1, $2, $2, $3, $4, 'verified', NOW()) RETURNING id`, [id, kind, `Q${id}`, type])).rows[0].id;
  await pool.query(
    'INSERT INTO membership_fame (membership_id, readers, guide_editions, wikipedia_editions, score) VALUES ($1, 50000, 2, 30, 0.5)',
    [membership]);
  return membership;
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id", [ADMIN])).rows[0].id;
  curatorId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR])).rows[0].id;
  squares = await plantBerlinSquares(BASE);
  sanLuigi = await plant(SAN_LUIGI, 'San Luigi dei Francesi', 4, 'church', 41.8996, 12.4746);
  const work = await pool.query<{ id: number }>(
    "INSERT INTO treasures (external_id, name, treasure_type) VALUES ('Q928215-calling', 'The Calling of Saint Matthew', 'painting') RETURNING id");
  await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [SAN_LUIGI, work.rows[0].id]);
  neuesMuseum = await plant(NEUES_MUSEUM, 'Neues Museum', 5, 'museum', 52.5200, 13.3978);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const admin = () => ({ id: adminId, role: 'admin' } as Express.User);
const id = (name: string) => squares.get(name)!.membership;
const window = (name: string, caller = admin()) =>
  getCrowdingWindow({ params: { membershipId: id(name) }, query: {}, caller });
const answer = (answers: Array<{ membershipId: number; answer: 'list' | 'shadow' | 'refuse' | 'clear' }>, caller = admin()) =>
  answerCrowding({ body: { answers, note: 'Judged on the window' }, caller });

const pin = async (name: string, value: 'list' | 'shadow' | null): Promise<void> => {
  await pool.query('UPDATE experience_kind_memberships SET crowding_pin = $2 WHERE id = $1',
    [squares.get(name)!.membership, value]);
};

const outrankedBy = async (name: string): Promise<number> => (await pool.query<{ n: number }>(
  'SELECT crowding_outranked_by($1) AS n', [squares.get(name)!.membership])).rows[0].n;

describe("a curator's crowding pins (ADR-0180)", () => {
  it('shadows the squares ten better known outrank, the arrivals among them', async () => {
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).toEqual(expect.arrayContaining(['Frankfurter Tor', 'Leipziger Platz', 'Schloßplatz', 'Kottbusser Tor']));
    expect(shadowed).not.toContain('Hackescher Markt');
    expect(shadowed).not.toContain('Nollendorfplatz');
  });

  it('brings a square kept in the list in, and pushes the tenth out', async () => {
    await pin('Kottbusser Tor', 'list');
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).not.toContain('Kottbusser Tor');
    // Hackescher Markt had nine better known within 10 km; Kottbusser Tor, 3 km off, is the tenth.
    expect(shadowed).toContain('Hackescher Markt');
    expect(await outrankedBy('Hackescher Markt')).toBe(10);
    // The pin is read whatever the square's own count says: still fourteen above it.
    expect(await outrankedBy('Kottbusser Tor')).toBe(14);
  });

  it('lets the next square up when one is kept in the shadow', async () => {
    expect(await outrankedBy('Frankfurter Tor')).toBe(10);
    await pin('Nollendorfplatz', 'shadow');
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).toContain('Nollendorfplatz');
    expect(shadowed).not.toContain('Frankfurter Tor');
    expect(await outrankedBy('Frankfurter Tor')).toBe(9);
    // The shadowed square's own count is the rule's: eight above it, and stored as the reason it is out.
    const stored = await pool.query<{ outranked_by: number }>(
      'SELECT outranked_by FROM membership_crowding WHERE membership_id = $1', [squares.get('Nollendorfplatz')!.membership]);
    expect(stored.rows[0].outranked_by).toBe(await outrankedBy('Nollendorfplatz'));
  });

  it('hands a square back to the rule when its pin is cleared', async () => {
    await pin('Kottbusser Tor', 'list');
    await pin('Kottbusser Tor', null);
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).toContain('Kottbusser Tor');
    expect(shadowed).not.toContain('Hackescher Markt');
  });

  it('keeps every pin through a full refresh, as a run\'s after-step calls it', async () => {
    await pin('Kottbusser Tor', 'list');
    await pin('Nollendorfplatz', 'shadow');
    await pool.query('SELECT recount_crowding(NULL)');
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).not.toContain('Kottbusser Tor');
    expect(shadowed).toContain('Nollendorfplatz');
  });

  it('reads no pin of a refused square', async () => {
    await pin('Kottbusser Tor', 'list');
    await pool.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE id = $1",
      [squares.get('Kottbusser Tor')!.membership]);
    expect(await shadowedSquares(BASE)).not.toContain('Hackescher Markt');
  });

  it('refuses a pin the vocabulary does not hold', async () => {
    await expect(pool.query("UPDATE experience_kind_memberships SET crowding_pin = 'top' WHERE id = $1",
      [squares.get('Schloßplatz')!.membership])).rejects.toThrow(/crowding_pin_check/);
  });
});

describe('the window over a crowded city', () => {
  it("lists every square around the Schloßplatz, best known first, with the rule's count and standing", async () => {
    const read = await window('Schloßplatz');
    expect(read.kind).toMatchObject({ id: 9, limit: 10, radiusKm: 10 });
    expect(read.type).toBe('square');
    expect(read.types).toEqual([{ type: 'square', places: BERLIN_SQUARES.length, exempt: false }]);
    expect(read.rows.map(row => row.name)).toEqual(BERLIN_SQUARES.map(([name]) => name));

    const row = (name: string) => read.rows.find(r => r.name === name)!;
    expect(row('Alexanderplatz')).toMatchObject({ standing: 'listed', crowded: false, outrankedBy: 0, pinnable: true, canAnswer: true });
    expect(row('Leipziger Platz')).toMatchObject({ standing: 'shadowed', crowded: true, ruleCrowded: true });
    expect(row('Schloßplatz')).toMatchObject({
      standing: 'new', crowded: true, ruleCrowded: true, outrankedBy: 13, readers: 17802, guideUsed: false, pin: null,
    });
  });

  it('names the places that shadow the window\'s place (#2228)', async () => {
    const read = await window('Schloßplatz');
    expect(read.rows.filter(row => row.outranksCentre).map(row => row.name))
      .toEqual(BERLIN_SQUARES.slice(0, 13).map(([name]) => name));
  });

  it("refuses a curator whose scope does not reach the window's place", async () => {
    await pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', 2, $2)`,
      [curatorId, adminId]);
    await expect(window('Schloßplatz', { id: curatorId, role: 'curator' } as Express.User))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('answers applied together', () => {
  it('publishes an arrival kept in the list with its pin, pushing the tenth out, and logs both acts', async () => {
    const report = await answer([{ membershipId: id('Kottbusser Tor'), answer: 'list' }]);
    expect(report.answered).toEqual([expect.objectContaining({
      membershipId: id('Kottbusser Tor'), answer: 'list', pin: 'list', published: true, refused: false,
    })]);
    const membership = await pool.query<{ curation_state: string; crowding_pin: string }>(
      'SELECT curation_state, crowding_pin FROM experience_kind_memberships WHERE id = $1', [id('Kottbusser Tor')]);
    expect(membership.rows[0]).toEqual({ curation_state: 'verified', crowding_pin: 'list' });
    const shadowed = await shadowedSquares(BASE);
    expect(shadowed).not.toContain('Kottbusser Tor');
    expect(shadowed).toContain('Hackescher Markt');

    const log = await pool.query<{ action: string; details: Record<string, unknown> }>(
      `SELECT action, details FROM experience_curation_log WHERE experience_id = $1 ORDER BY id`,
      [squares.get('Kottbusser Tor')!.place]);
    expect(log.rows.map(row => row.action)).toEqual(['published', 'crowding_answered']);
    expect(log.rows[1].details).toMatchObject({
      membershipId: id('Kottbusser Tor'), answer: 'list', pin: 'list', before: null,
      outrankedBy: 14, ruleCrowded: true, note: 'Judged on the window',
    });
  });

  it('keeps a published square in the shadow and lets the next one up, and hands it back', async () => {
    await answer([{ membershipId: id('Nollendorfplatz'), answer: 'shadow' }]);
    let shadowed = await shadowedSquares(BASE);
    expect(shadowed).toContain('Nollendorfplatz');
    expect(shadowed).not.toContain('Frankfurter Tor');

    const read = await window('Frankfurter Tor');
    expect(read.rows.find(r => r.name === 'Nollendorfplatz')).toMatchObject({
      standing: 'shadowed', pin: 'shadow', ruleCrowded: false, outranksCentre: false,
    });

    await answer([{ membershipId: id('Nollendorfplatz'), answer: 'clear' }]);
    shadowed = await shadowedSquares(BASE);
    expect(shadowed).not.toContain('Nollendorfplatz');
    expect(shadowed).toContain('Frankfurter Tor');
  });

  it('refuses an arrival "not taken" as a curator refuses one', async () => {
    const report = await answer([{ membershipId: id('Schloßplatz'), answer: 'refuse' }]);
    expect(report.answered).toEqual([expect.objectContaining({ answer: 'refuse', refused: true, published: false })]);
    const membership = await pool.query<{ admission: string; pinned: boolean }>(
      "SELECT admission, curated_fields ? 'admission' AS pinned FROM experience_kind_memberships WHERE id = $1",
      [id('Schloßplatz')]);
    expect(membership.rows[0]).toEqual({ admission: 'refused', pinned: true });
  });

  it('refuses a pin on a place holding works and on a type its kind exempts, and applies the rest', async () => {
    const report = await answer([
      { membershipId: sanLuigi, answer: 'shadow' },
      { membershipId: neuesMuseum, answer: 'list' },
      { membershipId: id('Hermannplatz'), answer: 'shadow' },
    ]);
    expect(report.refused).toEqual([
      expect.objectContaining({ membershipId: sanLuigi, status: 409, error: expect.stringContaining('ADR-0173') }),
      expect.objectContaining({ membershipId: neuesMuseum, status: 409, error: expect.stringContaining('ADR-0179') }),
    ]);
    expect(report.answered.map(row => row.membershipId)).toEqual([id('Hermannplatz')]);
    const pins = await pool.query<{ id: number; crowding_pin: string | null }>(
      'SELECT id, crowding_pin FROM experience_kind_memberships WHERE id = ANY($1) ORDER BY id', [[sanLuigi, neuesMuseum]]);
    expect(pins.rows.map(row => row.crowding_pin)).toEqual([null, null]);
  });

  it('counts an answer outside the caller\'s scope and writes nothing', async () => {
    await pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', 2, $2)`,
      [curatorId, adminId]);
    const report = await answer([{ membershipId: id('Kottbusser Tor'), answer: 'list' }],
      { id: curatorId, role: 'curator' } as Express.User);
    expect(report).toMatchObject({ answered: [], refused: [], outOfScope: 1 });
    const membership = await pool.query<{ crowding_pin: string | null }>(
      'SELECT crowding_pin FROM experience_kind_memberships WHERE id = $1', [id('Kottbusser Tor')]);
    expect(membership.rows[0].crowding_pin).toBeNull();
  });
});

describe('the arrivals a crowded city shadows', () => {
  it("groups Berlin's shadowed square arrivals, best known first", async () => {
    const { groups } = await listShadowedArrivals({ query: {}, caller: admin() });
    const berlin = groups.find(group => group.membershipIds.includes(id('Schloßplatz')))!;
    expect(berlin).toMatchObject({ kindId: 9, type: 'square', arrivals: 11 });
    expect(berlin.membershipIds.slice(0, 3)).toEqual([id('Frankfurter Tor'), id('Rosa-Luxemburg-Platz'), id('Schloßplatz')]);
  });
});
