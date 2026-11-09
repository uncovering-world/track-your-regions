import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerCrowding } from './crowdingAnswers.js';
import { getCrowdingGroup, getCrowdingPlace, listShadowedArrivals } from './crowdingWindow.js';
import { attachCrowding } from './reviewQueueCrowding.js';
import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';

/**
 * A curator sorting a crowded city into the list and the shadow (ADR-0180,
 * #2282), executed against PostgreSQL: the pins as the recount reads them (a
 * place kept in the list is never crowded out and takes one of the ten above
 * the rest, a place kept in the shadow is always crowded out and counts among
 * none of the ten), the window over Berlin's squares as Berlin's page shows
 * them and over one square in its own circle (#2358), the arrivals the display
 * shadows, and the answers applied together, each through the writer the
 * arrival's card calls.
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
/** A public world view that splits Berlin into its districts, as Wikivoyage does (#2349). */
const DISTRICTS_VIEW = 92_821;
const GERMANY = BASE + 60;
const BERLIN = BASE + 61;
const BRANDENBURG = BASE + 62;
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
  await pool.query('DELETE FROM world_views WHERE id = $1', [DISTRICTS_VIEW]);
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
/** Berlin's squares as Berlin's region page holds them (`placeInBerlin`). */
const group = (caller = admin()) => getCrowdingGroup({ query: { region: BERLIN, kind: SQUARES, type: 'square' }, caller });
const circle = (name: string, caller = admin(), worldViewId?: number) =>
  getCrowdingPlace({ params: { membershipId: id(name) }, query: { worldViewId }, caller });
type Answer = 'list' | 'shadow' | 'publish' | 'refuse' | 'clear';
const answer = (answers: Array<{ membershipId: number; answer: Answer }>, caller = admin()) =>
  answerCrowding({ body: { answers, note: 'Judged on the window' }, caller });

/** A public world view with Berlin as a leaf, every square placed in it. */
async function placeInBerlin(): Promise<void> {
  await pool.query(
    "INSERT INTO world_views (id, name, is_default, is_public) VALUES ($1, 'Berlin as a whole', false, true)", [DISTRICTS_VIEW]);
  await pool.query(
    "INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES ($1, $2, 'Berlin', NULL, true)",
    [BERLIN, DISTRICTS_VIEW]);
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type)
     SELECT unnest($1::int[]), $2, 'auto'`, [[...squares.values()].map(square => square.place), BERLIN]);
}

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

describe("a crowded city as its region's page shows it (#2358)", () => {
  beforeEach(placeInBerlin);

  it("lists every square of Berlin, best known first, with its standing and the rule's count of the tail", async () => {
    const read = await group();
    expect(read.group).toEqual({ regionId: BERLIN, regionName: 'Berlin', kindId: SQUARES, type: 'square' });
    expect(read.kind).toMatchObject({ id: SQUARES, limit: 10, radiusKm: 10 });
    expect(read.truncated).toBe(false);
    expect(read.places.map(row => row.name)).toEqual(BERLIN_SQUARES.map(([name]) => name));

    const row = (name: string) => read.places.find(r => r.name === name)!;
    // Shown and unpinned: fewer than ten above it, which its own circle counts.
    expect(row('Alexanderplatz')).toMatchObject({
      standing: 'shown', crowded: false, outrankedBy: null, betterKnown: [], pinnable: true, canAnswer: true,
    });
    expect(row('Leipziger Platz')).toMatchObject({
      standing: 'shadowed', crowded: true, ruleCrowded: true, outrankedBy: await outrankedBy('Leipziger Platz'),
      betterKnown: ['Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt'],
    });
    expect(row('Schloßplatz')).toMatchObject({ standing: 'new', crowded: true, ruleCrowded: true, outrankedBy: 13, pin: null });
  });

  it("reads the rule's count beside a pin, and the square the pin pushed out", async () => {
    await answer([{ membershipId: id('Kottbusser Tor'), answer: 'list' }]);
    const read = await group();
    const row = (name: string) => read.places.find(r => r.name === name)!;
    expect(row('Kottbusser Tor')).toMatchObject({ standing: 'shown', pin: 'list', outrankedBy: 14, ruleCrowded: true });
    expect(row('Hackescher Markt')).toMatchObject({ standing: 'shadowed', outrankedBy: 10, ruleCrowded: true });
  });

  it('leaves out a square a curator rejected from the region, as its page does', async () => {
    await pool.query('INSERT INTO experience_rejections (experience_id, region_id, rejected_by) VALUES ($1, $2, $3)',
      [squares.get('Bebelplatz')!.place, BERLIN, adminId]);
    expect((await group()).places.map(row => row.name)).not.toContain('Bebelplatz');
  });

  it('refuses a kind that shows every place it admits', async () => {
    await expect(getCrowdingGroup({ query: { region: BERLIN, kind: 2 }, caller: admin() }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('opens a square in its own circle, compared with the squares its count counts (#2228)', async () => {
    const read = await circle('Schloßplatz');
    expect(read.place).toMatchObject({ name: 'Schloßplatz', standing: 'new', outrankedBy: 13 });
    expect(read.group).toEqual({ regionId: BERLIN, regionName: 'Berlin', kindId: SQUARES, type: 'square' });
    expect(read.around.map(row => row.name)).toEqual(BERLIN_SQUARES.map(([name]) => name).filter(name => name !== 'Schloßplatz'));
    expect(read.around.filter(row => row.compared).map(row => row.name))
      .toEqual(BERLIN_SQUARES.slice(0, 13).map(([name]) => name));
    expect(read.around.find(row => row.name === 'Alexanderplatz')!.distanceM).toBeGreaterThan(0);
  });

  it('compares a square with what the rule counts, a square kept in the shadow left out', async () => {
    await answer([{ membershipId: id('Nollendorfplatz'), answer: 'shadow' }]);
    const read = await circle('Frankfurter Tor');
    expect(read.place).toMatchObject({ standing: 'new', crowded: false, outrankedBy: 9, ruleCrowded: false });
    expect(read.around.find(row => row.name === 'Nollendorfplatz')).toMatchObject({ standing: 'shadowed', compared: false });
    expect(read.around.filter(row => row.compared)).toHaveLength(9);
  });

  it("carries each place's article and its picture with the picture's credit, and nothing for a place without (#2345)", async () => {
    // Alexanderplatz as the development catalogue holds it.
    const credit = {
      author: 'Wladyslaw Sojka', license: 'FAL',
      licenseUrl: 'http://artlibre.org/licence/lal/en',
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Berlin_-_Alexanderplatz1.jpg',
    };
    await pool.query(
      `UPDATE experiences SET image_url = $2,
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('wikipediaUrl', $3::text, 'imageCredit', $4::jsonb)
        WHERE id = $1`,
      [squares.get('Alexanderplatz')!.place,
        'http://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg',
        'https://en.wikipedia.org/wiki/Alexanderplatz', JSON.stringify(credit)]);

    const read = await group();
    expect(read.places.find(row => row.name === 'Alexanderplatz')).toMatchObject({
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Alexanderplatz',
      imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg',
      imageCredit: credit,
    });
    expect(read.places.find(row => row.name === 'Leipziger Platz')).toMatchObject({
      wikipediaUrl: null, imageUrl: null, imageCredit: null,
    });
  });

  it('carries what each place\'s score is made of, a signal no reading dates read as none (#2400)', async () => {
    // Alexanderplatz with its readers and its guides read; Leipziger Platz as a
    // place is before its first reading, ranked at the planted values.
    await pool.query(
      `UPDATE membership_fame SET readers_read_at = NOW(), guides_read_at = NOW() WHERE membership_id = $1`,
      [id('Alexanderplatz')]);
    await pool.query('UPDATE membership_fame SET guide_editions = 0, guides_read_at = NOW() WHERE membership_id = $1',
      [id('Savignyplatz')]);

    const listed = await group();
    const alex = listed.places.find(row => row.name === 'Alexanderplatz')!;
    expect(alex).toMatchObject({ readers: 209401, wikipediaEditions: 47, guideUsed: true });
    expect(alex.score).toBeCloseTo(0.698, 3);
    expect(listed.places.find(row => row.name === 'Leipziger Platz')).toMatchObject({
      readers: null, guideUsed: null, wikipediaEditions: 18, score: expect.any(Number),
    });
    expect(listed.places.find(row => row.name === 'Savignyplatz')).toMatchObject({ guideUsed: false });

    // The circle names the same numbers for every place it compares the place with.
    const read = await circle('Schloßplatz');
    expect(read.around.find(row => row.name === 'Alexanderplatz')).toMatchObject({
      readers: alex.readers, wikipediaEditions: alex.wikipediaEditions, guideUsed: true, score: alex.score,
    });
    expect(read.around.find(row => row.name === 'Leipziger Platz')).toMatchObject({ readers: null, guideUsed: null });
  });

  it("lists another scope's published squares unanswerable, and none of its new ones", async () => {
    await pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', 2, $2)`,
      [curatorId, adminId]);
    const curator = { id: curatorId, role: 'curator' } as Express.User;
    const read = await group(curator);
    expect(read.places.map(row => row.name)).not.toContain('Schloßplatz');
    expect(read.places.find(row => row.name === 'Alexanderplatz')).toMatchObject({ canAnswer: false });
    await expect(circle('Schloßplatz', curator)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('counts a new arrival above a place that the curator\'s scope leaves out, without naming it', async () => {
    await pool.query(
      `INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by) VALUES ($1, 'source', 2, $2)`,
      [curatorId, adminId]);
    // Leipziger Platz is published; of the eleven above it, Frankfurter Tor is a new arrival of another scope.
    const curator = await circle('Leipziger Platz', { id: curatorId, role: 'curator' } as Express.User);
    expect(curator.place.outrankedBy).toBe(11);
    expect(curator.around.filter(row => row.compared).map(row => row.name)).toEqual(BERLIN_SQUARES.slice(0, 10).map(([name]) => name));
    expect(curator.comparedUnlisted).toBe(1);
    // An admin is shown every one of them.
    const seen = await circle('Leipziger Platz');
    expect(seen.around.filter(row => row.compared)).toHaveLength(11);
    expect(seen.comparedUnlisted).toBe(0);
  });
});

describe("a review card's crowding (#2282)", () => {
  it("says how crowded each card's city is, as its circle counts it, and nothing where the rule does not reach", async () => {
    const card = (membershipId: number | null) => ({ id: 1, membership_id: membershipId }) as unknown as ReviewQueueItem;
    const cards = [card(id('Schloßplatz')), card(id('Nollendorfplatz')), card(sanLuigi), card(neuesMuseum), card(null)];

    await attachCrowding(cards, { userId: adminId, isAdmin: true });

    // The circle lists the others around the place; the card counts the place among them.
    const read = await circle('Schloßplatz');
    expect(cards[0].crowding).toEqual({
      limit: 10, radiusKm: 10, around: read.around.length + 1, shadowed: true, outrankedBy: 13,
    });
    // Shown, so nothing is counted above it for the card.
    expect(cards[1].crowding).toEqual({
      limit: 10, radiusKm: 10, around: BERLIN_SQUARES.length, shadowed: false, outrankedBy: null,
    });
    // A place holding a work a reader is shown is always shown (ADR-0173); a type
    // its kind exempts is never counted (ADR-0179); a card about no membership has nothing.
    expect(cards[2].crowding).toBeNull();
    expect(cards[3].crowding).toBeNull();
    expect(cards[4].crowding).toBeNull();
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

    const read = await circle('Nollendorfplatz');
    expect(read.place).toMatchObject({ standing: 'shadowed', pin: 'shadow', ruleCrowded: false });

    await answer([{ membershipId: id('Nollendorfplatz'), answer: 'clear' }]);
    shadowed = await shadowedSquares(BASE);
    expect(shadowed).not.toContain('Nollendorfplatz');
    expect(shadowed).toContain('Frankfurter Tor');
  });

  it('publishes an arrival left to the rule with no pin, and refuses to publish a published square (#2358)', async () => {
    const report = await answer([
      { membershipId: id('Frankfurter Tor'), answer: 'publish' },
      { membershipId: id('Alexanderplatz'), answer: 'publish' },
    ]);
    expect(report.answered).toEqual([expect.objectContaining({
      membershipId: id('Frankfurter Tor'), answer: 'publish', pin: null, published: true,
    })]);
    expect(report.refused).toEqual([expect.objectContaining({ membershipId: id('Alexanderplatz'), status: 409 })]);
    const membership = await pool.query<{ curation_state: string; crowding_pin: string | null }>(
      'SELECT curation_state, crowding_pin FROM experience_kind_memberships WHERE id = $1', [id('Frankfurter Tor')]);
    expect(membership.rows[0]).toEqual({ curation_state: 'verified', crowding_pin: null });
    // Left to the rule, it stands where the rule put it: in the tail.
    expect(await shadowedSquares(BASE)).toContain('Frankfurter Tor');
  });

  it('refuses to publish an arrival another curator published and pinned while the answer waited on its lock', async () => {
    const other = await pool.connect();
    try {
      // Another curator's answer holds the place's lock, as every writer of it takes it.
      await other.query('BEGIN');
      await other.query('SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE', [squares.get('Frankfurter Tor')!.place]);
      const answering = answer([{ membershipId: id('Frankfurter Tor'), answer: 'publish' }]);
      // The answer read the square as an arrival and now waits on the lock.
      for (let tries = 0; tries < 100; tries += 1) {
        const waiting = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()");
        if (waiting.rows[0].n > 0) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await other.query(
        "UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW(), crowding_pin = 'shadow' WHERE id = $1",
        [id('Frankfurter Tor')]);
      await other.query('COMMIT');

      const report = await answering;
      expect(report.answered).toEqual([]);
      expect(report.refused).toEqual([expect.objectContaining({
        membershipId: id('Frankfurter Tor'), status: 409, error: expect.stringContaining('published meanwhile'),
      })]);
      const membership = await pool.query<{ crowding_pin: string | null }>(
        'SELECT crowding_pin FROM experience_kind_memberships WHERE id = $1', [id('Frankfurter Tor')]);
      expect(membership.rows[0].crowding_pin).toBe('shadow');
    } finally {
      other.release();
    }
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
  it("groups Berlin's shadowed square arrivals", async () => {
    const { groups } = await listShadowedArrivals({ query: {}, caller: admin() });
    const squaresGroup = groups.find(entry => entry.kindId === SQUARES && entry.type === 'square' && entry.regionId === null);
    expect(squaresGroup).toMatchObject({ arrivals: 11 });
  });

  it('reads one `none` group across the reads: a square placed only in a region that is no leaf', async () => {
    // Berlin as a region with districts under it, Schloßplatz placed in Berlin alone.
    await pool.query(
      "INSERT INTO world_views (id, name, is_default, is_public) VALUES ($1, 'Berlin by district', false, true)", [DISTRICTS_VIEW]);
    await pool.query(
      `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
         ($1, $3, 'Berlin', NULL, false), ($2, $3, 'Mitte', $1, true)`, [BERLIN, BASE + 70, DISTRICTS_VIEW]);
    await pool.query("INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')",
      [squares.get('Schloßplatz')!.place, BERLIN]);

    // No leaf places it, so the arrivals read counts it under `none`, the group read lists it
    // there, and its circle names no group region.
    const { groups } = await listShadowedArrivals({ query: { region: 'none' }, caller: admin() });
    expect(groups.find(entry => entry.kindId === SQUARES && entry.type === 'square')).toMatchObject({ arrivals: 11 });
    const none = await getCrowdingGroup({ query: { region: 'none', kind: SQUARES, type: 'square' }, caller: admin() });
    expect(none.places.map(row => row.name)).toContain('Schloßplatz');
    expect((await circle('Schloßplatz')).group.regionId).toBeNull();
  });

  it('groups a place by the world view asked for: under `none` where that view has no leaf for it', async () => {
    // Schloßplatz in a leaf of one public world view; a second public view places it nowhere.
    const otherView = DISTRICTS_VIEW + 1;
    await pool.query(
      `INSERT INTO world_views (id, name, is_default, is_public)
       VALUES ($1, 'Berlin by district', false, true), ($2, 'Germany by state', false, true)`, [DISTRICTS_VIEW, otherView]);
    try {
      await pool.query("INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES ($1, $2, 'Mitte', NULL, true)",
        [BASE + 70, DISTRICTS_VIEW]);
      await pool.query("INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')",
        [squares.get('Schloßplatz')!.place, BASE + 70]);

      // Asked of the second view, every read puts it under `none`.
      const none = await getCrowdingGroup({
        query: { region: 'none', kind: SQUARES, type: 'square', worldViewId: otherView }, caller: admin(),
      });
      expect(none.places.map(row => row.name)).toContain('Schloßplatz');
      const { groups } = await listShadowedArrivals({ query: { region: 'none', worldViewId: otherView }, caller: admin() });
      expect(groups.find(entry => entry.kindId === SQUARES && entry.type === 'square')).toMatchObject({ arrivals: 11 });
      expect((await circle('Schloßplatz', admin(), otherView)).group.regionId).toBeNull();
      // Asked of no view, it is grouped under the first public view's leaf that places it.
      expect((await circle('Schloßplatz')).group).toMatchObject({ regionId: BASE + 70, regionName: 'Mitte' });
    } finally {
      await pool.query('DELETE FROM world_views WHERE id = $1', [otherView]);
    }
  });

  describe('within a region (#2349)', () => {
    /** The district each new square lies in. */
    const DISTRICT_OF: Record<string, string> = {
      'Frankfurter Tor': 'Friedrichshain-Kreuzberg',
      'Rosa-Luxemburg-Platz': 'Mitte',
      Schloßplatz: 'Mitte',
      'Kottbusser Tor': 'Friedrichshain-Kreuzberg',
      Hermannplatz: 'Neukölln',
      Wittenbergplatz: 'Tempelhof-Schöneberg',
      'Strausberger Platz': 'Friedrichshain-Kreuzberg',
      'Großer Stern': 'Mitte',
      Mehringplatz: 'Friedrichshain-Kreuzberg',
      Savignyplatz: 'Charlottenburg-Wilmersdorf',
      Winterfeldtplatz: 'Tempelhof-Schöneberg',
    };
    const districts = [...new Set(Object.values(DISTRICT_OF))];
    const district = new Map(districts.map((name, index) => [name, BASE + 70 + index]));
    const read = (region?: number | 'none') => listShadowedArrivals({ query: { region }, caller: admin() });
    const named = async (region?: number | 'none') => (await read(region)).groups.map(group => [group.regionName, group.arrivals]);

    // Germany over Berlin and Brandenburg, Berlin over its districts. Each
    // square is placed in its district and every region above it, as the
    // catalogue's assignment holds a place's ancestors beside its leaf.
    beforeEach(async () => {
      await pool.query(
        "INSERT INTO world_views (id, name, is_default, is_public) VALUES ($1, 'Berlin by district', false, true)",
        [DISTRICTS_VIEW]);
      await pool.query(
        `INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES
           ($1, $4, 'Germany', NULL, false), ($2, $4, 'Berlin', $1, false), ($3, $4, 'Brandenburg', $1, true)`,
        [GERMANY, BERLIN, BRANDENBURG, DISTRICTS_VIEW]);
      for (const [name, regionId] of district) {
        await pool.query(
          'INSERT INTO regions (id, world_view_id, name, parent_region_id, is_leaf) VALUES ($1, $2, $3, $4, true)',
          [regionId, DISTRICTS_VIEW, name, BERLIN]);
      }
      for (const [square, name] of Object.entries(DISTRICT_OF)) {
        await pool.query(
          `INSERT INTO experience_regions (experience_id, region_id, assignment_type)
           SELECT $1, unnest($2::int[]), 'auto'`,
          [squares.get(square)!.place, [district.get(name)!, BERLIN, GERMANY]]);
      }
    });

    it("reads a city's groups by the districts within it, each square under its own", async () => {
      expect(await named(BERLIN)).toEqual([
        ['Friedrichshain-Kreuzberg', 4], ['Mitte', 3], ['Tempelhof-Schöneberg', 2],
        ['Charlottenburg-Wilmersdorf', 1], ['Neukölln', 1],
      ]);
      expect(await named(GERMANY)).toEqual(await named(BERLIN));
    });

    it('reads a leaf as its own group alone', async () => {
      expect(await named(district.get('Mitte'))).toEqual([['Mitte', 3]]);
    });

    it('groups an arrival under a district it was not rejected from, and counts none it was rejected from everywhere', async () => {
      const schlossplatz = squares.get('Schloßplatz')!.place;
      const reject = (name: string) => pool.query(
        'INSERT INTO experience_rejections (experience_id, region_id, rejected_by) VALUES ($1, $2, $3)',
        [schlossplatz, district.get(name), adminId]);
      await pool.query("INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto')",
        [schlossplatz, district.get('Neukölln')]);
      await reject('Mitte');
      expect(await named(BERLIN)).toEqual([
        ['Friedrichshain-Kreuzberg', 4], ['Mitte', 2], ['Neukölln', 2], ['Tempelhof-Schöneberg', 2],
        ['Charlottenburg-Wilmersdorf', 1],
      ]);
      await reject('Neukölln');
      expect(await named(district.get('Mitte'))).toEqual([['Mitte', 2]]);
      expect(await named(district.get('Neukölln'))).toEqual([['Neukölln', 1]]);
    });

    it('reads nothing of a region no new square lies in, nor of the unplaced while every square is placed', async () => {
      expect(await read(BRANDENBURG)).toEqual({ groups: [] });
      expect(await read('none')).toEqual({ groups: [] });
      expect(await named()).toEqual(await named(BERLIN));
    });
  });
});
