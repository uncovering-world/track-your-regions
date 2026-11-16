import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { lockExperience, lockTwoExperiences } from '../../db/experienceWriter.js';
import { writePartFields } from '../../db/partFieldsWriter.js';
import { pointNameSql } from '../../db/placePoints.js';
import { CURATOR_SOURCE_ID } from '../../db/membership.js';
import { writeExperienceLocations, type LocationWriteRun } from './locationWriter.js';
import { upsertExperienceRecord } from './experienceUpsert.js';
import { partsBehind } from './componentListings.js';

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
/** The Temple of Karnak's two halves, when a curator makes it a whole: parts of a part, which clear() reaches by id. */
const KARNAK_HALVES = [99960, 99961];

let run: LocationWriteRun;

async function parts(site: number) {
  return (await pool.query<{ part_id: number; external_ref: string | null; name: string; location_id: number }>(
    `SELECT p.part_id, pr.external_id AS external_ref, e.name, el.id AS location_id
       FROM experience_parts p
       JOIN source_records pr ON pr.experience_id = p.part_id AND pr.whole_id = p.whole_id AND pr.source_id = 10
       JOIN experiences e ON e.id = p.part_id
       JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND p.reason = 'component'
      ORDER BY pr.external_id`, [site],
  )).rows;
}

async function ownPoints(site: number) {
  return (await pool.query<{ id: number }>(
    'SELECT id FROM experience_locations WHERE experience_id = $1 ORDER BY id', [site],
  )).rows.map(row => row.id);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [KARNAK_HALVES]);
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = ANY($1::int[])) OR merged_into_id = ANY($1::int[])',
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
      [id, source.id, `${id}`, name],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW())`,
      [id, source.kind_id, source.id, `${id}`],
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
    // The point is placed by the site's World Heritage membership, which the part's record answers to.
    const membership = await pool.query<{ placed: boolean }>(
      `SELECT bool_and(EXISTS (SELECT 1 FROM experience_location_placements pl
                                 JOIN source_records site ON site.id = pl.membership_id
                                WHERE pl.location_id = el.id AND site.experience_id = p.whole_id AND site.source_id = 1)) AS placed
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

  it('parts a component that arrives later, and withdraws one the source dropped on its record (ADR-0216)', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const [karnak, luxor] = await parts(THEBES);

    await writeExperienceLocations(THEBES, [KARNAK, NECROPOLIS], run);

    const now = await parts(THEBES);
    expect(now.map(p => p.external_ref)).toEqual(['87-001', '87-002', '87-003']);
    expect(now[0].location_id).toBe(karnak.location_id);
    // The point stands, so the temple stays shown until a curator answers; its record says the list dropped it.
    const withdrawn = await pool.query<{ point_missing: boolean; record_missing: boolean }>(
      `SELECT el.missing_since IS NOT NULL AS point_missing, rec.missing_since IS NOT NULL AS record_missing
         FROM experience_locations el
         JOIN source_records rec ON rec.experience_id = el.experience_id AND rec.whole_id = $2 AND rec.source_id = 10
        WHERE el.id = $1`, [luxor.location_id, THEBES],
    );
    expect(withdrawn.rows[0]).toEqual({ point_missing: false, record_missing: true });
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
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, 'Q9950001', 'auto', NOW()) RETURNING id`,
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

  it("keeps a traveller's visit on the site when the point it stood on becomes a part (#2120)", async () => {
    // While Karnak was the site's one point, a tick on it was the site's
    // visit: a visit is a row on the place the point belongs to. Parting the
    // point writes nothing for the traveller, and the site keeps the visit.
    await writeExperienceLocations(THEBES, [KARNAK], run);
    const userId = (await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user') RETURNING id`, [TRAVELLER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO user_visited_experiences (user_id, experience_id, notes) VALUES ($1, $2, 'the hypostyle hall at dawn')`,
      [userId, THEBES],
    );

    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

    const visits = await pool.query(
      'SELECT experience_id, notes FROM user_visited_experiences WHERE user_id = $1', [userId],
    );
    expect(visits.rows).toEqual([{ experience_id: THEBES, notes: 'the hypostyle hall at dawn' }]);
  });
});

describe('every line of a serial site is a part, the one named like the site too (ADR-0210)', () => {
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

  it("parts a line named like the site, and keeps only a point under the site's own reference", async () => {
    // Prague's 616bis-001 is the part "Historic Centre of Prague" beside Průhonice Park.
    const own = { name: 'Ancient Thebes (parts fixture)', externalRef: '87-000', lon: 32.65, lat: 25.71 };
    const siteRef = { name: null, externalRef: `${THEBES}`, lon: 32.651, lat: 25.711 };
    await writeExperienceLocations(THEBES, [own, siteRef, KARNAK], run);

    const made = await parts(THEBES);
    expect(made.map(p => p.external_ref)).toEqual(['87-000', '87-001']);
    // No division holds the fixture, so nothing tells it apart: it keeps the site's name (#2122).
    expect(made[0].name).toBe('Ancient Thebes (parts fixture)');
    expect(await ownPoints(THEBES)).toHaveLength(1);
  });

  it('parts no arrival the list withdrew before anyone read it', async () => {
    await writeExperienceLocations(THEBES, [KARNAK], run);
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, missing_since)
       VALUES ($1, 'Luxor Temple', '87-002', ST_SetSRID(ST_MakePoint(32.639, 25.6995), 4326), 'pending', NOW())`,
      [THEBES],
    );
    await writeExperienceLocations(THEBES, [KARNAK, NECROPOLIS], run);

    expect((await parts(THEBES)).map(p => p.external_ref)).toEqual(['87-001', '87-003']);
    expect(await ownPoints(THEBES)).toHaveLength(1);
  });

  it('revives a part migration 161 folded once its point stops standing for the site', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const karnak = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    // Folded as migration 161 folds a part: the point home, the part's record and so its relation gone,
    // the place folded into the site.
    await pool.query('UPDATE experience_locations SET experience_id = $1 WHERE id = $2', [THEBES, karnak.location_id]);
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [karnak.part_id, THEBES]);
    await pool.query('UPDATE experiences SET merged_into_id = $1 WHERE id = $2', [THEBES, karnak.part_id]);

    const membership = (await pool.query<{ id: number }>(
      'SELECT id FROM source_records WHERE experience_id = $1', [THEBES],
    )).rows[0].id;
    await pool.query('SELECT part_site_components($1, $2)', [THEBES, membership]);

    const revived = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    expect(revived.part_id).toBe(karnak.part_id);
    expect((await pool.query('SELECT merged_into_id FROM experiences WHERE id = $1', [karnak.part_id])).rows[0].merged_into_id).toBeNull();
  });

  it('revives a folded part under the name a curator gave it', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const karnak = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
    await pool.query(
      `UPDATE experiences SET name = 'Karnak Temple Complex', curated_fields = '["name"]' WHERE id = $1`, [karnak.part_id],
    );
    await pool.query('UPDATE experience_locations SET experience_id = $1 WHERE id = $2', [THEBES, karnak.location_id]);
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [karnak.part_id, THEBES]);
    await pool.query('UPDATE experiences SET merged_into_id = $1 WHERE id = $2', [THEBES, karnak.part_id]);

    const membership = (await pool.query<{ id: number }>(
      'SELECT id FROM source_records WHERE experience_id = $1', [THEBES],
    )).rows[0].id;
    await pool.query('SELECT part_site_components($1, $2)', [THEBES, membership]);

    expect((await parts(THEBES)).find(p => p.external_ref === '87-001')?.name).toBe('Karnak Temple Complex');
  });
});

describe("a whole's shape and point follow its parts (ADR-0210)", () => {
  const shapeOf = async (id: number) => (await pool.query<{ whole_shape: string | null; lon: number | null }>(
    'SELECT whole_shape, ST_X(location) AS lon FROM experiences WHERE id = $1', [id],
  )).rows[0];

  it('makes a new serial site dispersed with no point, in the write that parts it', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    expect(await shapeOf(THEBES)).toEqual({ whole_shape: 'dispersed', lon: null });
    // A site of one component stays a place, at its point.
    await writeExperienceLocations(GIZA, [{ name: 'Great Pyramid', externalRef: '86-001', lon: 31.1342, lat: 29.9792 }], run);
    expect(await shapeOf(GIZA)).toEqual({ whole_shape: null, lon: 32.65 });
  });

  it("writes the run's anchor to its record alone, and no point to the site or move of one", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const sent = {
      sourceId: run.sourceId, externalId: `${THEBES}`, name: 'Ancient Thebes (parts fixture)', nameLocal: {},
      subtitle: null, description: null, type: null, tags: [], lon: 32.6573, lat: 25.7188, locationIsAnchor: true,
      countryCodes: ['EG'], countryNames: ['Egypt'], imageUrl: null, metadata: {},
    };
    const written = await upsertExperienceRecord(sent);

    expect([...written.changeSet.changedFields, ...written.changeSet.heldFields].map(f => f.field)).not.toContain('location');
    expect((await pool.query(
      `SELECT ST_X(e.location) AS lon, ST_X(m.reported_location) AS reported
         FROM experiences e JOIN source_records m ON m.experience_id = e.id AND m.source_id = $2 WHERE e.id = $1`,
      [THEBES, run.sourceId],
    )).rows[0]).toEqual({ lon: null, reported: 32.6573 });
  });

  it('refuses a point on a dispersed whole, and a shape on a place that keeps one', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    await expect(pool.query(
      'UPDATE experiences SET location = ST_SetSRID(ST_MakePoint(32.65, 25.71), 4326) WHERE id = $1', [THEBES],
    )).rejects.toThrow(/experiences_location_iff_not_dispersed/);
    await expect(pool.query("UPDATE experiences SET whole_shape = 'dispersed' WHERE id = $1", [GIZA]))
      .rejects.toThrow(/experiences_location_iff_not_dispersed/);
  });

  it("puts a whole that loses its last part back at its record's point", async () => {
    await pool.query(
      'UPDATE source_records SET reported_location = ST_SetSRID(ST_MakePoint(32.6511, 25.7111), 4326) WHERE experience_id = $1',
      [THEBES],
    );
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const made = (await parts(THEBES)).map(p => p.part_id);
    await pool.query('DELETE FROM source_records WHERE whole_id = $1 AND experience_id <> $1', [THEBES]);

    expect(await shapeOf(THEBES)).toEqual({ whole_shape: null, lon: 32.6511 });
    // No longer parts, so clear() would not find them.
    await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [made]);
  });

  it("leaves the site's run its fast path when a part of it is a dispersed whole, which holds no point", async () => {
    // The Temple of Karnak made, by a curator, a whole of two places 2 km apart.
    const [north, south] = KARNAK_HALVES;
    try {
      await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
      const karnak = (await parts(THEBES)).find(p => p.external_ref === '87-001')!;
      await pool.query(
        `INSERT INTO experiences (id, source_id, external_id, name, location)
         VALUES ($1, 11, 'curator-1-99960', 'Karnak north (parts fixture)', ST_SetSRID(ST_MakePoint(32.6573, 25.7300), 4326)),
                ($2, 11, 'curator-1-99961', 'Karnak south (parts fixture)', ST_SetSRID(ST_MakePoint(32.6573, 25.7120), 4326))`,
        [north, south],
      );
      await pool.query(
        `INSERT INTO experience_locations (experience_id, name, location)
         SELECT id, name, location FROM experiences WHERE id = ANY($1::int[])`, [[north, south]],
      );
      await pool.query(
        `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission)
         VALUES ($1, $3, ${CURATOR_SOURCE_ID}, 'curator-1-99962', 'admitted'),
                ($2, $3, ${CURATOR_SOURCE_ID}, 'curator-1-99963', 'admitted')`,
        [north, south, karnak.part_id],
      );
      // Shaped by its first part, a container; dispersed, as the check whole-shape-drift asks of parts 2 km apart.
      await pool.query(`UPDATE experiences SET whole_shape = 'dispersed', location = NULL WHERE id = $1`, [karnak.part_id]);

      await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);

      expect(await shapeOf(karnak.part_id)).toEqual({ whole_shape: 'dispersed', lon: null });
      expect(await partsBehind(THEBES)).toBe(false);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[north, south]]);
    }
  });

  it('keeps the point of a container, a whole of no World Heritage record whose parts lie within a walk', async () => {
    // A curator makes one place a part of another that holds no World Heritage record.
    await pool.query('DELETE FROM source_records WHERE experience_id = $1', [GIZA]);
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission)
       VALUES ($1, $2, ${CURATOR_SOURCE_ID}, $3, 'admitted')`, [THEBES, GIZA, `curator-1-${THEBES}`],
    );
    expect(await shapeOf(GIZA)).toEqual({ whole_shape: 'container', lon: 32.65 });
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

  it("renames a part named by its site at the run after the site's rename, and leaves a named part alone", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, nameless], run);

    await pool.query(`UPDATE experiences SET name = 'Thebes and its Necropolis (parts fixture)' WHERE id = $1`, [THEBES]);
    // The list is the same, so only the part being behind its site sends the run past its fast path.
    await writeExperienceLocations(THEBES, [KARNAK, nameless], run);

    expect((await parts(THEBES)).map(p => [p.external_ref, p.name])).toEqual([
      ['87-001', 'Temple of Karnak'],
      ['87-005', 'Thebes and its Necropolis (parts fixture) (87-005)'],
    ]);
  });

  it("renames the part by its own article once the run records one, the point keeping the list's name", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, unnamed], run);
    const part = (await parts(THEBES)).find(p => p.external_ref === '87-004')!;

    // The article is the part row's own (ADR-0156), written as the content writer writes it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, THEBES);
      await writePartFields(client, locked!.lock, [{
        pointId: part.location_id,
        fields: { 'metadata.wikipediaUrl': 'https://en.wikipedia.org/wiki/Mortuary_Temple_of_Hatshepsut' },
      }]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

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

describe("a part named like its site never reads with the site's name (#2122)", () => {
  // Białowieża Forest's two lines, which the list spells without the Polish
  // letters, one either side of the border; the divisions are the fixture's own.
  const [EUROPE, POLAND, PODLASKIE, BELARUS, BREST] = [99950, 99951, 99952, 99953, 99954];
  const SITE_NAME = 'Białowieża Forest (parts fixture)';
  const box = (west: number) => `POLYGON((${west} 52.6, ${west + 0.2} 52.6, ${west + 0.2} 52.8, ${west} 52.8, ${west} 52.6))`;
  const polish = { name: 'Bialowieza Forest (parts fixture)', externalRef: '87-010', lon: 23.80, lat: 52.70 };
  const belarusian = { name: 'Bialowieza Forest (parts fixture)', externalRef: '87-011', lon: 24.10, lat: 52.70 };

  const divisions = async () => {
    await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[BREST, BELARUS, PODLASKIE, POLAND, EUROPE]]);
    await pool.query(
      `INSERT INTO administrative_divisions (id, name, parent_id, has_children, geom) VALUES
         ($1, 'Europe', NULL, true, NULL), ($2, 'Poland', $1, true, NULL),
         ($3, 'Podlaskie', $2, false, ST_Multi(ST_GeomFromText($6, 4326))),
         ($4, 'Belarus', $1, true, NULL), ($5, 'Brest', $4, false, ST_Multi(ST_GeomFromText($7, 4326)))`,
      [EUROPE, POLAND, PODLASKIE, BELARUS, BREST, box(23.7), box(24.0)],
    );
  };

  beforeEach(async () => {
    await divisions();
    await pool.query('UPDATE experiences SET name = $2 WHERE id = $1', [THEBES, SITE_NAME]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM administrative_divisions WHERE id = ANY($1::int[])', [[BREST, BELARUS, PODLASKIE, POLAND, EUROPE]]);
  });

  it("names two lines named like their site by their countries, in the site's spelling", async () => {
    await writeExperienceLocations(THEBES, [polish, belarusian], run);

    expect((await parts(THEBES)).map(p => [p.external_ref, p.name])).toEqual([
      ['87-010', `${SITE_NAME} (Poland)`],
      ['87-011', `${SITE_NAME} (Belarus)`],
    ]);
  });

  it("keeps the site's name, in its spelling, where no division tells two lines named like it apart", async () => {
    await writeExperienceLocations(THEBES, [polish, { ...belarusian, lon: 23.85 }], run);

    expect((await parts(THEBES)).map(p => p.name)).toEqual([SITE_NAME, SITE_NAME]);
  });

  it('leaves two siblings of one name, and every part not named like its site, as their points name them', async () => {
    const caravanserai = { name: 'Mansaf Caravanserai', lon: 23.81, lat: 52.71 };
    await writeExperienceLocations(THEBES, [
      { ...caravanserai, externalRef: '87-012' }, { ...caravanserai, externalRef: '87-013', lon: 24.11 }, KARNAK,
    ], run);

    expect((await parts(THEBES)).map(p => [p.external_ref, p.name])).toEqual([
      ['87-001', 'Temple of Karnak'],
      ['87-012', 'Mansaf Caravanserai'],
      ['87-013', 'Mansaf Caravanserai'],
    ]);
  });

  it('names the one line named like its site by the most general division its other parts lie outside', async () => {
    await writeExperienceLocations(THEBES, [polish, { name: 'Kamieniuki', externalRef: '87-015', lon: 24.10, lat: 52.70 }], run);
    expect((await parts(THEBES)).map(p => p.name)).toEqual([`${SITE_NAME} (Poland)`, 'Kamieniuki']);
  });

  it('names the one line named like its site by its most local division where none lies outside its other parts', async () => {
    // Kakadu's line beside its two islands; Karnak stands in no division of the fixture.
    await writeExperienceLocations(THEBES, [polish, KARNAK], run);
    expect((await parts(THEBES)).map(p => p.name)).toEqual(['Temple of Karnak', `${SITE_NAME} (Podlaskie)`]);
  });
});

/** Until `count` transactions wait for one of the backends `pids`. */
async function untilWaiting(pids: number[], count: number): Promise<void> {
  for (let tries = 0; ; tries++) {
    const waiting = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pg_blocking_pids(pid) && $1::int[]', [pids],
    );
    if (waiting.rows[0].n >= count) return;
    expect(tries, `${count} transactions wait`).toBeLessThan(200);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function backendPid(client: PoolClient): Promise<number> {
  return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
}

describe("the site's run locks its parts before its points take the region keys (db/locks.ts)", () => {
  it('writes a new component while a curator refuses a part\'s point, neither aborted', async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const [karnak] = await parts(THEBES);
    // The run names Karnak for its point again once it writes the site: a write of the part's row.
    await pool.query("UPDATE experiences SET name = 'Karnak (renamed since)' WHERE id = $1", [karnak.part_id]);

    // A curator holds Karnak, as every curator write on a place does.
    const curator = await pool.connect();
    try {
      await curator.query('BEGIN');
      expect(await lockExperience(curator, karnak.part_id)).not.toBeNull();
      const curatorPid = await backendPid(curator);

      // The run inserts the Theban Necropolis's point on the site, and so takes
      // the site's region key, then names Karnak: it waits for the curator.
      const written = writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run)
        .then(() => null, (error: unknown) => error);
      await untilWaiting([curatorPid], 1);

      // Refusing Karnak's point asks for Karnak's region keys and the site's.
      await curator.query('UPDATE experience_locations SET refused_at = NOW() WHERE id = $1', [karnak.location_id]);
      await curator.query('COMMIT');
      expect(await written).toBeNull();
    } finally {
      await curator.query('ROLLBACK').catch(() => undefined);
      curator.release();
    }

    const now = await parts(THEBES);
    expect(now.map(p => p.external_ref)).toEqual(['87-001', '87-002', '87-003']);
    expect(now[0].name).toBe('Temple of Karnak');
  });

  it("locks a site before its part of a lower id, as a curator's word on the pair does", async () => {
    await writeExperienceLocations(THEBES, [KARNAK, LUXOR], run);
    const [karnak] = await parts(THEBES);
    // Karnak was made a place after Ancient Thebes and still holds a lower id,
    // as a place adopted as a component or nested by a curator does.
    expect(karnak.part_id).toBeLessThan(THEBES);

    // Someone holds Karnak; a curator's word on the pair queues behind them,
    // and then the site's run that adds the Theban Necropolis.
    const holder = await pool.connect();
    const curator = await pool.connect();
    try {
      // Both pids first: a query on the curator's client queues behind its blocked lock.
      const pids = [await backendPid(holder), await backendPid(curator)];
      await holder.query('BEGIN');
      expect(await lockExperience(holder, karnak.part_id)).not.toBeNull();
      await curator.query('BEGIN');
      const word = lockTwoExperiences(curator, THEBES, karnak.part_id).then(locked => ({ locked }), (error: unknown) => ({ error }));
      await untilWaiting(pids, 1);
      const written = writeExperienceLocations(THEBES, [KARNAK, LUXOR, NECROPOLIS], run)
        .then(() => null, (error: unknown) => error);
      await untilWaiting(pids, 2);
      await holder.query('COMMIT');

      // Both hold the site before the part: the word goes first, then the run.
      const answer = await word;
      expect('error' in answer ? answer.error : null).toBeNull();
      await curator.query('SELECT lock_place_regions(ARRAY[$1::int, $2::int])', [THEBES, karnak.part_id]);
      await curator.query('COMMIT');
      expect(await written).toBeNull();
    } finally {
      for (const client of [holder, curator]) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }
    expect((await parts(THEBES)).map(p => p.external_ref)).toEqual(['87-001', '87-002', '87-003']);
  });
});
