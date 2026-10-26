import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { pointNameSql } from '../../db/placePoints.js';
import { writeExperienceLocations, type LocationWriteRun } from './locationWriter.js';

/**
 * A serial site's components become places, part of the site, as the World
 * Heritage run writes them (ADR-0100, #1424), against PostgreSQL: Ancient
 * Thebes listing the Temple of Karnak and the Luxor Temple, and the Pyramids of
 * Giza, a site of one point. `part_site_components` is called by the writer at
 * the end of the write, under the site's lock, and by migration 094.
 */

const THEBES = 9950;
const GIZA = 9951;
const KARNAK = { name: 'Temple of Karnak', externalRef: '87-001', lon: 32.6573, lat: 25.7188 };
const LUXOR = { name: 'Luxor Temple', externalRef: '87-002', lon: 32.6390, lat: 25.6995 };
const NECROPOLIS = { name: 'Theban Necropolis', externalRef: '87-003', lon: 32.6060, lat: 25.7330 };

const TRAVELLER = '00000000-0000-4000-8000-000000009950';

let run: LocationWriteRun;

async function parts(site: number) {
  return (await pool.query<{ part_id: number; external_ref: string | null; name: string; location_id: number }>(
    `SELECT p.part_id, p.external_ref, e.name, el.id AS location_id
       FROM experience_parts p
       JOIN experiences e ON e.id = p.part_id
       JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND p.reason = 'component'
      ORDER BY p.external_ref`, [site],
  )).rows;
}

async function ownPoints(site: number) {
  return (await pool.query<{ id: number }>(
    'SELECT id FROM experience_locations WHERE experience_id = $1 ORDER BY id', [site],
  )).rows.map(row => row.id);
}

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = ANY($1::int[]))',
    [[THEBES, GIZA]],
  );
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[THEBES, GIZA]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [TRAVELLER]);
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: source.id, components: true };
  for (const [id, name] of [[THEBES, 'Ancient Thebes (parts fixture)'], [GIZA, 'Pyramids of Giza (parts fixture)']] as const) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326))`,
      [id, source.id, `${id}-fixture`, name],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW())`,
      [id, source.kind_id, source.id, `${id}-fixture`],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a serial site's components become its parts (ADR-0100)", () => {
  it('parts every component of a site of several, each a place of its own point, the point keeping its id', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

    const parted = await parts(THEBES);
    expect(parted.map(p => [p.external_ref, p.name])).toEqual([['87-001', 'Temple of Karnak'], ['87-002', 'Luxor Temple']]);
    expect(await ownPoints(THEBES)).toEqual([]);
    // The relation carries the site's membership, the one that placed the point.
    const membership = await pool.query<{ placed: boolean }>(
      `SELECT bool_and(EXISTS (SELECT 1 FROM experience_location_placements pl
                                WHERE pl.location_id = el.id AND pl.membership_id = p.membership_id)) AS placed
         FROM experience_parts p JOIN experience_locations el ON el.experience_id = p.part_id
        WHERE p.whole_id = $1`, [THEBES],
    );
    expect(membership.rows[0].placed).toBe(true);
  });

  it('leaves a site of one component one place (ADR-0088)', async () => {
    await writeExperienceLocations(GIZA, [{ ...KARNAK, name: 'Pyramids of Giza', externalRef: '86-001' }], run);
    expect(await parts(GIZA)).toEqual([]);
    expect(await ownPoints(GIZA)).toHaveLength(1);
  });

  it('writes the same list again without a new part or a new point', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const first = await parts(THEBES);
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    expect(await parts(THEBES)).toEqual(first);
  });

  it('parts a component that arrives later, and withdraws one the source dropped, through its part', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const [karnak, luxor] = await parts(THEBES);

    await writeExperienceLocations(THEBES, [KARNAK, NECROPOLIS], run);

    const now = await parts(THEBES);
    expect(now.map(p => p.external_ref)).toEqual(['87-001', '87-002', '87-003']);
    expect(now[0].location_id).toBe(karnak.location_id);
    const withdrawn = await pool.query<{ missing: boolean }>(
      'SELECT missing_since IS NOT NULL AS missing FROM experience_locations WHERE id = $1', [luxor.location_id],
    );
    expect(withdrawn.rows[0].missing).toBe(true);
  });

  it('leaves alone a point another source placed on the site', async () => {
    const archaeology = (await pool.query<{ id: number; kind_id: number }>(
      `SELECT id, kind_id FROM experience_sources WHERE name = 'Archaeology'`,
    )).rows[0];
    const dig = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, location, curation_state)
       VALUES ($1, 'Deir el-Medina', ST_SetSRID(ST_MakePoint(32.6014, 25.7286), 4326), 'auto') RETURNING id`,
      [THEBES],
    )).rows[0].id;
    const membership = (await pool.query<{ id: number }>(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, 'Q1189146-fixture', 'auto', NOW()) RETURNING id`,
      [THEBES, archaeology.kind_id, archaeology.id],
    )).rows[0].id;
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [dig, membership]);

    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

    expect(await ownPoints(THEBES)).toEqual([dig]);
    expect((await parts(THEBES)).map(p => p.external_ref)).toEqual(['87-001', '87-002']);
  });

  it('keeps a site of one component one place when its point moves (#1431)', async () => {
    const wies = { name: 'Pilgrimage Church of Wies', externalRef: '271-001', lon: 10.9006, lat: 47.6811 };
    await writeExperienceLocations(GIZA, [wies], run);
    // Moved 2 km: an arrival that waits on the old point's withdrawal.
    await writeExperienceLocations(GIZA, [{ ...wies, lon: 10.93 }], run);
    expect(await parts(GIZA)).toEqual([]);
    expect(await ownPoints(GIZA)).toHaveLength(2);
  });

  it("has a part follow its point when the run renames or renumbers it (#1431)", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const before = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    await writeExperienceLocations(THEBES, [{ ...KARNAK, name: 'Karnak Temple Complex', externalRef: '87bis-001' }, LUXOR], run);
    const karnak = (await parts(THEBES)).find(p => p.location_id === before.location_id);
    expect(karnak).toMatchObject({ part_id: before.part_id, external_ref: '87bis-001', name: 'Karnak Temple Complex' });
  });

  it("moves a traveller's visit to a component onto the part it becomes (ADR-0100 decision 5)", async () => {
    await writeExperienceLocations(THEBES, [KARNAK], run);
    const [karnakPoint] = await ownPoints(THEBES);
    const userId = (await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user') RETURNING id`, [TRAVELLER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO user_visited_locations (user_id, location_id, notes) VALUES ($1, $2, 'the hypostyle hall at dawn')`,
      [userId, karnakPoint],
    );

    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

    const karnak = (await parts(THEBES)).find(p => p.location_id === karnakPoint);
    const visits = await pool.query(
      'SELECT experience_id, notes FROM user_visited_experiences WHERE user_id = $1', [userId],
    );
    expect(visits.rows).toEqual([{ experience_id: karnak?.part_id, notes: 'the hypostyle hall at dawn' }]);
    const left = await pool.query('SELECT 1 FROM user_visited_locations WHERE user_id = $1', [userId]);
    expect(left.rowCount).toBe(0);
  });
});

describe('a component that stands for its whole site is not parted (#1899)', () => {
  const readsAsWholeSite = async (point: string | null, ref: string | null, site: string, siteRef: string, standing: number) =>
    (await pool.query<{ whole: boolean }>(
      'SELECT stands_for_whole_site($1, $2, $3, $4, $5) AS whole', [point, ref, site, siteRef, standing],
    )).rows[0].whole;

  it('reads a point named like its site, carrying its reference, or alone, as the site', async () => {
    expect(await readsAsWholeSite('Historic Centre of Siena', '717-001', 'Historic Centre of Siena', '717', 3)).toBe(true);
    expect(await readsAsWholeSite('Pilgrimage Church of Wies', '271', 'Pilgrimage Church of Wies', '271', 1)).toBe(true);
    expect(await readsAsWholeSite('Via Appia. Regina Viarum', '1708-001', 'Via Appia. <em>Regina Viarum</em>', '1708', 22)).toBe(true);
    expect(await readsAsWholeSite('Château de Chambord', '933-001', 'chateau de chambord', '933', 2)).toBe(true);
    // Baalbek's own point, which the list gives the site's reference.
    expect(await readsAsWholeSite(null, '294', 'Baalbek', '294', 2)).toBe(true);
    expect(await readsAsWholeSite('Bologa - Grădiște', '1718-027', 'Frontiers of the Roman Empire – Dacia', '1718', 277)).toBe(false);
    // Named after its site and similar to it, and still a part of it.
    expect(await readsAsWholeSite('Historic Centre of Siena (Cathedral)', '717-002', 'Historic Centre of Siena', '717', 3)).toBe(false);
  });

  it('keeps a point named like the site, or carrying its reference, as the site\'s own, and parts the rest', async () => {
    const own = { name: 'Ancient Thebes (parts fixture)', externalRef: '87-000', lon: 32.65, lat: 25.71 };
    const siteRef = { name: null, externalRef: `${THEBES}-fixture`, lon: 32.651, lat: 25.711 };
    await writeExperienceLocations(THEBES, [own, siteRef, KARNAK], run);

    expect((await parts(THEBES)).map(p => p.external_ref)).toEqual(['87-001']);
    expect(await ownPoints(THEBES)).toHaveLength(2);
  });

  it('revives a part migration 161 folded once its point stops standing for the site', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const karnak = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    // Folded as migration 161 folds a part: the point home, the relation gone, the place folded into the site.
    await pool.query('UPDATE experience_locations SET experience_id = $1 WHERE id = $2', [THEBES, karnak.location_id]);
    await pool.query('DELETE FROM experience_parts WHERE part_id = $1', [karnak.part_id]);
    await pool.query('UPDATE experiences SET merged_into_id = $1 WHERE id = $2', [THEBES, karnak.part_id]);

    const membership = (await pool.query<{ id: number }>(
      'SELECT id FROM experience_kind_memberships WHERE experience_id = $1', [THEBES],
    )).rows[0].id;
    await pool.query('SELECT part_site_components($1, $2)', [THEBES, membership]);

    const revived = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    expect(revived.part_id).toBe(karnak.part_id);
    expect((await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [karnak.part_id])).rows[0].merged_into_id).toBeNull();
  });
});

describe('a component the list names nothing is named for what it is (#2065)', () => {
  // The World Heritage list calls two components of Tarraco "The " and gives two
  // sections of Via Appia no name at all.
  const unnamed = { name: 'The ', externalRef: '87-004', lon: 32.6061, lat: 25.7275 };
  const nameless = { name: '', externalRef: '87-005', lon: 32.6125, lat: 25.7208 };

  const readerName = async (location: number) =>
    (await pool.query<{ name: string | null }>(
      `SELECT ${pointNameSql('el')} AS name FROM experience_locations el WHERE el.id = $1`, [location],
    )).rows[0].name;

  it("names the part by its site and reference, and leaves the reader's point to its reference", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, unnamed, nameless], run);

    const parted = await parts(THEBES);
    expect(parted.map(p => [p.external_ref, p.name])).toEqual([
      ['87-001', 'Temple of Karnak'],
      ['87-004', 'Ancient Thebes (parts fixture) (87-004)'],
      ['87-005', 'Ancient Thebes (parts fixture) (87-005)'],
    ]);
    // Beside the site's other points the web calls it "87-004"; the site's name would repeat the card's.
    expect(await readerName(parted[1].location_id)).toBeNull();
  });

  it("renames a part named by its site when the site's name changes, and leaves a named part alone", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, nameless], run);

    await pool.query(`UPDATE experiences SET name = 'Thebes and its Necropolis (parts fixture)' WHERE id = $1`, [THEBES]);

    expect((await parts(THEBES)).map(p => [p.external_ref, p.name])).toEqual([
      ['87-001', 'Temple of Karnak'],
      ['87-005', 'Thebes and its Necropolis (parts fixture) (87-005)'],
    ]);
  });

  it("renames the part by its point's article once the run records one, the point keeping the list's name", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, unnamed], run);
    const part = (await parts(THEBES)).find(p => p.external_ref === '87-004')!;

    await pool.query(
      `UPDATE experience_locations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [part.location_id, JSON.stringify({ wikipediaUrl: 'https://en.wikipedia.org/wiki/Mortuary_Temple_of_Hatshepsut' })],
    );

    expect((await parts(THEBES)).find(p => p.external_ref === '87-004')?.name).toBe('Mortuary Temple of Hatshepsut');
    expect(await readerName(part.location_id)).toBe('Mortuary Temple of Hatshepsut');
    const point = await pool.query<{ name: string }>('SELECT name FROM experience_locations WHERE id = $1', [part.location_id]);
    expect(point.rows[0].name).toBe('The');
  });

  it('reads an article title as a reader does, and refuses an address that is not one', async () => {
    const title = async (url: string) =>
      (await pool.query<{ title: string | null }>('SELECT wikipedia_article_title($1) AS title', [url])).rows[0].title;
    expect(await title('https://en.wikipedia.org/wiki/Roman_quarry_of_El_M%C3%A8dol')).toBe('Roman quarry of El Mèdol');
    expect(await title('https://en.wikipedia.org/wiki/Ta%27_%C4%A6a%C4%A1rat')).toBe("Ta' Ħaġrat");
    expect(await title('https://en.wikipedia.org/wiki/Broken_%FF')).toBeNull();
    expect(await title('https://example.org/wiki/Karnak')).toBeNull();
  });

  it('counts nothing or a lone "The" as no name, and any real name as a name', async () => {
    const namesNothing = async (name: string | null) =>
      (await pool.query<{ nothing: boolean }>('SELECT names_nothing($1) AS nothing', [name])).rows[0].nothing;
    for (const name of [null, '', '  ', 'The ', 'THE']) expect(await namesNothing(name)).toBe(true);
    // Die in the Drôme and Å in Lofoten are places.
    for (const name of ['The Hague', 'Port', 'Ular', 'Die', 'Å']) expect(await namesNothing(name)).toBe(false);
  });
});
