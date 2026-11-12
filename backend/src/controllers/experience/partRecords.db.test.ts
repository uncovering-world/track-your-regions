import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SOURCE_ID_SCHEMES, SOURCE_ID_SHAPES } from '@tyr/shared/identifiers';
import { pool } from '../../db/index.js';
import {
  placeHoldsKindSql, placeKindsSql, placeOfferedSql, placeSourceIdsSql, placeVisibleSql, shownMembershipSql,
} from '../../db/membership.js';
import { answeringPlaceSql, pointItemSql } from '../../db/placePoints.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { claimPointItem } from './experienceLocationWriter.js';
import { followTheirPoints } from '../../db/partFieldsWriter.js';
import { listKinds } from './experienceQueryController.js';
import { getSources } from '../admin/syncController.js';
import { mergePlaces, undoMerge } from './placeMerge.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';

/**
 * A part of a serial site holds its record of World Heritage components in its
 * whole, and nothing a reader, a curator or an admin reads changes for it
 * (ADR-0198, narrowing ADR-0156), against PostgreSQL. The fixtures are three
 * sites as the World Heritage run parts them: the Belfries of Belgium and
 * France (the belfries of Mons and of Bruges), the Cathedral, Alcázar and
 * Archivo de Indias in Seville (383bis-001 to 003), and Maloti-Drakensberg
 * Park, whose list gives one reference, 985ter-001, to the park on each side
 * of the border. Ids are the fixture's own, deleted before and after.
 */

const BELFRIES = 9560;
const MONS = { name: 'Beffroi de Mons', externalRef: '9560-029', lon: 3.9506, lat: 50.4542 };
const BRUGES = { name: 'Belfry of Bruges', externalRef: '9560-002', lon: 3.2248, lat: 51.2085 };

const SEVILLE = 9640;
const SEVILLE_CATHEDRAL_OF_WORSHIP = 9641;
const CATHEDRAL = { name: 'Catedral de Sevilla', externalRef: '383bis-001', lon: -5.99306, lat: 37.38569 };
const ALCAZAR = { name: 'Reales Alcázares', externalRef: '383bis-002', lon: -5.99156, lat: 37.38383 };
const ARCHIVO = { name: 'Archivo de Indias', externalRef: '383bis-003', lon: -5.99269, lat: 37.38461 };

const MALOTI = 9642;
const SEHLABATHEBE = { name: 'Sehlabathebe National Park', externalRef: '985ter-001', lon: 29.12306, lat: -29.91528 };
const UKHAHLAMBA = { name: 'uKhahlamba Drakensberg Park', externalRef: '985ter-001', lon: 29.54056, lat: -29.38333 };

const SANTIAGO = 9643;
const ARLES = { name: 'Arles, Church of Saint-Trophime', externalRef: '9643-001', lon: 4.6266, lat: 43.6765 };
const CONQUES = { name: 'Conques, Abbey Church of Sainte-Foy', externalRef: '9643-002', lon: 2.3982, lat: 44.5994 };

/** A second site a belfry is also a component of, its id below the Belfries' so the earliest whole is the other one. */
const OTHER_SITE = 9558;
/** A place the Belfries' site is folded into, to see its parts' records follow the whole. */
const BELFRIES_ELSEWHERE = 9557;
/** A site of one component that stands for the whole site, recorded in itself, and the place it is folded into. */
const WHOLE_SITE = 9644;
const WHOLE_SITE_ELSEWHERE = 9645;
const CURATORS = 'Curators (part records fixture)';
const ADMIN = '00000000-0000-4000-8000-000000009557';

const COMPONENTS_SOURCE = 10;
const SITES = [BELFRIES, SEVILLE, MALOTI, SANTIAGO, OTHER_SITE, BELFRIES_ELSEWHERE, WHOLE_SITE, WHOLE_SITE_ELSEWHERE];

let run: LocationWriteRun;
let heritage: { id: number; kind_id: number };

async function partsOf(site: number) {
  return (await pool.query<{ link_id: number; part_id: number; location_id: number }>(
    `SELECT p.id AS link_id, p.part_id, el.id AS location_id
       FROM experience_parts p
       JOIN source_records pr ON pr.experience_id = p.part_id AND pr.whole_id = p.whole_id AND pr.source_id = 10
       JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND p.reason = 'component'
      ORDER BY pr.external_id, p.part_id`, [site],
  )).rows;
}

/** A site's records in its whole: the place each is on, its reference and what the list calls it. */
async function recordsOf(site: number) {
  return (await pool.query<{ experience_id: number; external_id: string; kind_id: number | null; name: string | null }>(
    `SELECT experience_id, external_id, kind_id, reported_name AS name FROM source_records
      WHERE whole_id = $1 AND source_id = $2 ORDER BY external_id, experience_id`, [site, COMPONENTS_SOURCE],
  )).rows;
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_merges WHERE survivor_id = ANY($1::int[]) OR folded_id = ANY($1::int[])',
    [[SEVILLE_CATHEDRAL_OF_WORSHIP, BELFRIES_ELSEWHERE, WHOLE_SITE_ELSEWHERE]]);
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE merged_into_id = ANY($1::int[])',
    [[BELFRIES_ELSEWHERE, WHOLE_SITE_ELSEWHERE]]);
  // Records of the fixture's curator source go with the source.
  await pool.query('DELETE FROM experience_sources WHERE name = $1', [CURATORS]);
  await pool.query(
    `UPDATE experience_locations SET merged_into_id = NULL
      WHERE experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = ANY($1::int[])) OR experience_id = $2`,
    [SITES, SEVILLE_CATHEDRAL_OF_WORSHIP],
  );
  await pool.query('UPDATE experiences SET merged_into_id = NULL WHERE merged_into_id = $1', [SEVILLE_CATHEDRAL_OF_WORSHIP]);
  await pool.query(
    `DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = ANY($1::int[]))
        OR (external_id LIKE 'part:%' AND id IN (SELECT experience_id FROM experience_locations
                                                  WHERE external_ref LIKE '383bis-00%'))`,
    [SITES],
  );
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[...SITES, SEVILLE_CATHEDRAL_OF_WORSHIP]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[...SITES, SEVILLE_CATHEDRAL_OF_WORSHIP]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

async function site(id: number, ref: string, name: string, lon: number, lat: number): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
    [id, heritage.id, `${ref}-fixture`, name, lon, lat],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW())`,
    [id, heritage.kind_id, heritage.id, `${ref}-fixture`],
  );
}

beforeEach(async () => {
  await clear();
  heritage = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: heritage.id, components: true };
  await site(BELFRIES, '9560', 'Belfries of Belgium and France (fixture)', 3.5, 50.8);
  await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a part holds its record in its whole (ADR-0198)', () => {
  it('writes one per relation as the run parts the site, in the whole, under the reference', async () => {
    const parts = await partsOf(BELFRIES);
    expect(parts).toHaveLength(2);
    expect(await recordsOf(BELFRIES)).toEqual([
      { experience_id: parts[0].part_id, external_id: BRUGES.externalRef, kind_id: null, name: BRUGES.name },
      { experience_id: parts[1].part_id, external_id: MONS.externalRef, kind_id: null, name: MONS.name },
    ]);
  });

  it('offers the part no more than before: no kind, no source, still answered through its site', async () => {
    const [part] = await partsOf(BELFRIES);
    const read = await pool.query<{
      offered: boolean; visible: boolean; kinded: boolean; kinds: unknown[]; shown: number | null;
      sources: number[]; answering: number; listing: string; missing: boolean;
    }>(
      `SELECT ${placeOfferedSql('e')} AS offered, ${placeVisibleSql('e')} AS visible,
              ${placeHoldsKindSql('e.id')} AS kinded, ${placeKindsSql('e')} AS kinds,
              ${shownMembershipSql('e.id')} AS shown, ${placeSourceIdsSql('e')} AS sources,
              (SELECT ${answeringPlaceSql('el')} FROM experience_locations el WHERE el.id = $2) AS answering,
              e.source_membership AS listing, e.missing_since IS NOT NULL AS missing
         FROM experiences e WHERE e.id = $1`,
      [part.part_id, part.location_id],
    );
    expect(read.rows[0]).toEqual({
      offered: false, visible: false, kinded: false, kinds: [], shown: null, sources: [],
      answering: BELFRIES, listing: 'present', missing: false,
    });
  });

  it('lists no kind of components a traveller browses and its source among no sources an admin runs', async () => {
    expect((await listKinds()).map(kind => kind.name)).not.toContain('World Heritage components');
    expect((await getSources()).map(source => source.id)).not.toContain(COMPONENTS_SOURCE);
  });

  it('derives the relation from the record: moved with it, as a merge and its undo move it, and gone with it', async () => {
    const [bruges, mons] = await partsOf(BELFRIES);
    // A place another kind brought, which a merge makes the part.
    const merged = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9560-merged', 'Belfry of Mons (another kind)', ST_SetSRID(ST_MakePoint(3.9506, 50.4542), 4326))
       RETURNING id`,
      [run.sourceId],
    )).rows[0].id;
    const relations = async () => (await pool.query<{ part_id: number; reason: string }>(
      'SELECT part_id, reason FROM experience_parts WHERE whole_id = $1 ORDER BY part_id', [BELFRIES],
    )).rows;
    const moveMons = (from: number, to: number) => pool.query(
      'UPDATE source_records SET experience_id = $3 WHERE experience_id = $1 AND whole_id = $2', [from, BELFRIES, to],
    );

    try {
      await moveMons(mons.part_id, merged);
      expect(await relations()).toEqual([bruges.part_id, merged].sort((a, b) => a - b)
        .map(part_id => ({ part_id, reason: 'component' })));
      await moveMons(merged, mons.part_id);
      expect((await relations()).map(relation => relation.part_id)).toEqual([bruges.part_id, mons.part_id].sort((a, b) => a - b));
      // The relation keeps its id while its record stands.
      expect((await partsOf(BELFRIES)).find(part => part.part_id === bruges.part_id)!.link_id).toBe(bruges.link_id);

      await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [bruges.part_id, BELFRIES]);
      expect((await relations()).map(relation => relation.part_id)).toEqual([mons.part_id]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [merged]);
    }
  });

  it('keeps a record in each whole for a part of two sites, each making its own relation', async () => {
    const [, mons] = await partsOf(BELFRIES);
    const other = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9561-fixture', 'Another serial site (fixture)', ST_SetSRID(ST_MakePoint(3.9, 50.4), 4326))
       RETURNING id`,
      [run.sourceId],
    )).rows[0].id;
    const wholesOf = async () => (await pool.query<{ whole_id: number; external_id: string; name: string | null }>(
      `SELECT whole_id, external_id, reported_name AS name FROM source_records
        WHERE experience_id = $1 AND source_id = $2 ORDER BY external_id`, [mons.part_id, COMPONENTS_SOURCE],
    )).rows;

    try {
      await pool.query(
        `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, 10, '9561-001')`,
        [mons.part_id, other],
      );
      const wholes = async () => (await pool.query<{ whole_id: number }>(
        'SELECT whole_id FROM experience_parts WHERE part_id = $1 ORDER BY whole_id', [mons.part_id],
      )).rows.map(row => row.whole_id);
      expect(await wholes()).toEqual([BELFRIES, other].sort((a, b) => a - b));
      // The Belfries' list still speaks for its own record; the second site's is the second site's to write.
      expect(await wholesOf()).toEqual([
        { whole_id: BELFRIES, external_id: MONS.externalRef, name: MONS.name },
        { whole_id: other, external_id: '9561-001', name: null },
      ]);

      await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [mons.part_id, BELFRIES]);
      expect(await wholesOf()).toEqual([{ whole_id: other, external_id: '9561-001', name: null }]);
      expect(await wholes()).toEqual([other]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [other]);
    }
  });

  it('marks no place for pairing when what the record says changes, and marks both when the part it makes goes', async () => {
    const [part] = await partsOf(BELFRIES);
    const due = async () => (await pool.query(
      'SELECT 1 FROM experience_pairing_due WHERE experience_id = ANY($1::int[])', [[part.part_id, BELFRIES]],
    )).rowCount;
    await pool.query('DELETE FROM experience_pairing_due WHERE experience_id = ANY($1::int[])', [[part.part_id, BELFRIES]]);
    await pool.query(
      'UPDATE source_records SET reported_name = $3 WHERE experience_id = $1 AND whole_id = $2',
      [part.part_id, BELFRIES, 'Belfry of Bruges (as the list names it)'],
    );
    expect(await due()).toBe(0);
    // The relation the record made goes with it, which the pairing reads, as it did when a relation was written.
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2', [part.part_id, BELFRIES]);
    expect(await due()).toBe(2);
  });
});

describe("what the site's list says of a component, on the part's record (ADR-0156 decision 2)", () => {
  const views = async () => (await recordsOf(BELFRIES)).map(record => ({ ref: record.external_id, name: record.name }));
  const lons = async () => (await pool.query<{ lon: number | null }>(
    `SELECT ST_X(reported_location) AS lon FROM source_records
      WHERE whole_id = $1 AND source_id = $2 ORDER BY external_id`, [BELFRIES, COMPONENTS_SOURCE],
  )).rows.map(row => row.lon);

  it('is written by the run as the list gives it, whatever a curator made of the point', async () => {
    expect(await views()).toEqual([{ ref: BRUGES.externalRef, name: BRUGES.name }, { ref: MONS.externalRef, name: MONS.name }]);
    expect(await lons()).toEqual([BRUGES.lon, MONS.lon]);
    const [, mons] = await partsOf(BELFRIES);
    await pool.query(
      `UPDATE experience_locations SET name = 'Belfry of Mons', curated_fields = '["name"]' WHERE id = $1`, [mons.location_id],
    );
    // The list renames Mons's belfry: the point keeps the curator's name, the record what the list says.
    await writeExperienceLocations(BELFRIES, [{ ...MONS, name: 'Beffroi de Mons (Hainaut)' }, BRUGES], run);
    expect((await views())[1]).toEqual({ ref: MONS.externalRef, name: 'Beffroi de Mons (Hainaut)' });
    const point = await pool.query<{ name: string }>('SELECT name FROM experience_locations WHERE id = $1', [mons.location_id]);
    expect(point.rows[0].name).toBe('Belfry of Mons');
  });

  it('is written by a run that changes no point, where the record holds another', async () => {
    await pool.query(
      'UPDATE source_records SET reported_name = NULL, reported_location = NULL WHERE whole_id = $1 AND source_id = $2',
      [BELFRIES, COMPONENTS_SOURCE],
    );
    await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
    expect((await views()).map(view => view.name)).toEqual([BRUGES.name, MONS.name]);
  });

  it('is gone once the list drops the component, and back once it lists it again', async () => {
    await writeExperienceLocations(BELFRIES, [MONS], run);
    expect(await views()).toEqual([{ ref: BRUGES.externalRef, name: null }, { ref: MONS.externalRef, name: MONS.name }]);
    expect(await lons()).toEqual([null, MONS.lon]);
    await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
    expect((await views())[0]).toEqual({ ref: BRUGES.externalRef, name: BRUGES.name });
  });
});

describe('the real shapes of a list (ADR-0198)', () => {
  it("keeps Seville Cathedral's record, 383bis-001, on the place of worship it was merged with, and writes the list's view there", async () => {
    await site(SEVILLE, '383', 'Cathedral, Alcázar and Archivo de Indias in Seville (fixture)', -5.9925, 37.3845);
    await writeExperienceLocations(SEVILLE, [CATHEDRAL, ALCAZAR, ARCHIVO], run);
    const parted = await recordsOf(SEVILLE);
    expect(parted.map(record => [record.external_id, record.name])).toEqual([
      [CATHEDRAL.externalRef, CATHEDRAL.name], [ALCAZAR.externalRef, ALCAZAR.name], [ARCHIVO.externalRef, ARCHIVO.name],
    ]);

    // The cathedral as Places of worship brings it, with its own point, which a merge makes the part.
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9641', 'Seville Cathedral', ST_SetSRID(ST_MakePoint(-5.99312, 37.38572), 4326)
         FROM experience_sources s WHERE s.name = 'Places of worship'`,
      [SEVILLE_CATHEDRAL_OF_WORSHIP],
    );
    const membership = await pool.query<{ id: number }>(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9641', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'
       RETURNING id`,
      [SEVILLE_CATHEDRAL_OF_WORSHIP],
    );
    const point = await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location)
       VALUES ($1, 'Seville Cathedral', 'Q9641', ST_SetSRID(ST_MakePoint(-5.99312, 37.38572), 4326)) RETURNING id`,
      [SEVILLE_CATHEDRAL_OF_WORSHIP],
    );
    await pool.query('INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)',
      [point.rows[0].id, membership.rows[0].id]);
    const outcome = await mergePlaces({
      survivorId: SEVILLE_CATHEDRAL_OF_WORSHIP, foldedId: parted[0].experience_id, mergedBy: null, reason: 'equal_wikidata_item',
    });
    expect(outcome.refusal).toBeUndefined();
    expect((await recordsOf(SEVILLE))[0]).toEqual({
      experience_id: SEVILLE_CATHEDRAL_OF_WORSHIP, external_id: CATHEDRAL.externalRef, kind_id: null, name: CATHEDRAL.name,
    });

    // The site's next run finds the cathedral's component on that record and parts nothing anew.
    await writeExperienceLocations(SEVILLE, [{ ...CATHEDRAL, name: 'Santa Iglesia Catedral de Sevilla' }, ALCAZAR, ARCHIVO], run);
    const after = await recordsOf(SEVILLE);
    expect(after.map(record => [record.experience_id === SEVILLE_CATHEDRAL_OF_WORSHIP, record.external_id, record.name])).toEqual([
      [true, CATHEDRAL.externalRef, 'Santa Iglesia Catedral de Sevilla'],
      [false, ALCAZAR.externalRef, ALCAZAR.name],
      [false, ARCHIVO.externalRef, ARCHIVO.name],
    ]);
    // Still a place of worship of its own, as before the record left the virtual kind.
    const kinded = await pool.query<{ kinded: boolean }>(`SELECT ${placeHoldsKindSql('$1::int')} AS kinded`, [SEVILLE_CATHEDRAL_OF_WORSHIP]);
    expect(kinded.rows[0].kinded).toBe(true);
  });

  it("keeps Maloti-Drakensberg's two parks two parts, each with its record under the one reference 985ter-001", async () => {
    await site(MALOTI, '985', 'Maloti-Drakensberg Park (fixture)', 29.3, -29.6);
    await writeExperienceLocations(MALOTI, [SEHLABATHEBE, UKHAHLAMBA], run);
    const records = await recordsOf(MALOTI);
    expect(records.map(record => record.external_id)).toEqual(['985ter-001', '985ter-001']);
    expect(records.map(record => record.name).sort()).toEqual([SEHLABATHEBE.name, UKHAHLAMBA.name]);
    expect(new Set(records.map(record => record.experience_id)).size).toBe(2);
    expect(await partsOf(MALOTI)).toHaveLength(2);
  });
});

/** Mons's record in the Belfries: its reference, item and a curator's claims. */
async function monsRecord(partId: number) {
  return (await pool.query<{ external_id: string; items: string[] | null; claims: string[] }>(
    `SELECT external_id, wikidata_items AS items, curated_fields AS claims FROM source_records
      WHERE experience_id = $1 AND whole_id = $2 AND source_id = $3`, [partId, BELFRIES, COMPONENTS_SOURCE],
  )).rows;
}

/** A second serial site a belfry is a component of too, by that site's record of it under its own reference. */
async function partOfOtherSite(partId: number, ref: string): Promise<void> {
  await site(OTHER_SITE, '9558', 'Another serial site (fixture)', 3.9, 50.4);
  await pool.query(
    'INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, 10, $3)',
    [partId, OTHER_SITE, ref],
  );
}

describe("a component's reference and its record (ADR-0198)", () => {
  it("keeps the record, its item and a curator's claim while its point names no reference, and takes the next reference", async () => {
    const [, mons] = await partsOf(BELFRIES);
    await pool.query(
      `UPDATE source_records SET wikidata_items = ARRAY['Q9560029'], curated_fields = '["wikidata_items"]'
        WHERE experience_id = $1 AND whole_id = $2`, [mons.part_id, BELFRIES],
    );
    const follow = async (ref: string | null) => {
      await pool.query('UPDATE experience_locations SET external_ref = $2 WHERE id = $1', [mons.location_id, ref]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await lockExperience(client, BELFRIES);
        await followTheirPoints(client, locked!.lock, null);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    };
    await follow(null);
    // No run may take a curator's claim away: the record stands under the reference it was last listed under.
    expect(await monsRecord(mons.part_id)).toEqual([{ external_id: MONS.externalRef, items: ['Q9560029'], claims: ['wikidata_items'] }]);
    await follow('9560-030');
    expect(await monsRecord(mons.part_id)).toEqual([{ external_id: '9560-030', items: ['Q9560029'], claims: ['wikidata_items'] }]);
    // And a part's relation stands throughout: it is the record's.
    expect((await partsOf(BELFRIES)).map(part => part.part_id)).toContain(mons.part_id);
  });

  it("writes a site's reference on its own record only, for a part of two sites", async () => {
    const [, mons] = await partsOf(BELFRIES);
    await partOfOtherSite(mons.part_id, '9558-001');
    // The Belfries' run names Mons anew, and writes what its point says on the records it follows.
    await writeExperienceLocations(BELFRIES, [{ ...MONS, name: 'Beffroi de Mons (Hainaut)' }, BRUGES], run);
    const records = await pool.query<{ whole_id: number; external_id: string }>(
      `SELECT whole_id, external_id FROM source_records WHERE experience_id = $1 AND source_id = $2 ORDER BY whole_id`,
      [mons.part_id, COMPONENTS_SOURCE],
    );
    expect(records.rows).toEqual([
      { whole_id: OTHER_SITE, external_id: '9558-001' },
      { whole_id: BELFRIES, external_id: MONS.externalRef },
    ]);
  });

  it('reads the record under the point\'s reference whatever its case, before an earlier whole\'s', async () => {
    const [, mons] = await partsOf(BELFRIES);
    await partOfOtherSite(mons.part_id, '9558-001');
    await pool.query(`UPDATE source_records SET external_id = '9560-029B' WHERE experience_id = $1 AND whole_id = $2`, [mons.part_id, BELFRIES]);
    await pool.query(`UPDATE experience_locations SET external_ref = '9560-029b' WHERE id = $1`, [mons.location_id]);
    await pool.query(
      `UPDATE source_records SET wikidata_items = CASE whole_id WHEN $2 THEN ARRAY['Q9560029'] ELSE ARRAY['Q9558001'] END
        WHERE experience_id = $1 AND source_id = $3`, [mons.part_id, BELFRIES, COMPONENTS_SOURCE],
    );
    const item = await pool.query<{ item: string }>(
      `SELECT ${pointItemSql('el')} AS item FROM experience_locations el WHERE el.id = $1`, [mons.location_id],
    );
    expect(item.rows[0].item).toBe('Q9560029');
  });

  it('refuses to keep an item where nothing the answering place shows would keep it, and writes nothing', async () => {
    const [, mons] = await partsOf(BELFRIES);
    // A part is a part by its record, so every part's point has one; what is left
    // to refuse is a point the locked place does not show: Mons under another site.
    await site(OTHER_SITE, '9558', 'Another serial site (fixture)', 3.9, 50.4);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, OTHER_SITE);
      const outcome = await claimPointItem(client, locked!.lock, mons.location_id, 'Q9560029', {
        imageUrl: null, credit: null, description: 'belfry in Mons', articleUrl: null,
      });
      expect(outcome).toEqual({ recorded: false, pictured: false });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await monsRecord(mons.part_id)).toEqual([{ external_id: MONS.externalRef, items: null, claims: [] }]);
  });

  it('parts only the components a later list names, when the site\'s one main point had no reference', async () => {
    // The Routes of Santiago de Compostela in France on the development
    // catalogue: a site with no components list holds one main point with no
    // reference (unescoSyncService); a list of components later parts its
    // components, and the main point, which the list does not name, stays the
    // site's own.
    await site(SANTIAGO, '9643', 'Routes of Santiago de Compostela in France (fixture)', 2.5, 44.0);
    await writeExperienceLocations(SANTIAGO, [{ name: null, externalRef: null, lon: 2.5, lat: 44.0 }], run);
    await writeExperienceLocations(SANTIAGO, [ARLES, CONQUES], run);

    const records = await recordsOf(SANTIAGO);
    expect(records.map(record => record.external_id)).toEqual([ARLES.externalRef, CONQUES.externalRef]);
    const relations = await pool.query<{ part_id: number }>(
      'SELECT part_id FROM experience_parts WHERE whole_id = $1 ORDER BY part_id', [SANTIAGO],
    );
    expect(relations.rows.map(relation => relation.part_id))
      .toEqual(records.map(record => record.experience_id).sort((a, b) => a - b));
    const own = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM experience_locations WHERE experience_id = $1 AND external_ref IS NULL', [SANTIAGO],
    );
    expect(own.rows[0].count).toBe(1);
  });
});

describe('"part of" follows the records that claim it (ADR-0198 decision 5)', () => {
  const relationOf = async (whole: number, part: number) => (await pool.query<{ reason: string }>(
    'SELECT reason FROM experience_parts WHERE whole_id = $1 AND part_id = $2', [whole, part],
  )).rows.map(row => row.reason);

  it("lets a curator's record decide alone: refused takes the part out though the list claims it, admitted puts one in", async () => {
    const [, mons] = await partsOf(BELFRIES);
    const curators = (await pool.query<{ id: number }>(
      `INSERT INTO experience_sources (name, display_priority, requires_curation, kind_id, id_scheme)
       VALUES ($1, 99, false, NULL, 'curator') RETURNING id`, [CURATORS],
    )).rows[0].id;
    const curatorRecord = (await pool.query<{ id: number }>(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id, admission)
       VALUES ($1, $2, $3, 'curator-1-9557', 'refused') RETURNING id`, [mons.part_id, BELFRIES, curators],
    )).rows[0].id;
    expect(await relationOf(BELFRIES, mons.part_id)).toEqual([]);
    await pool.query(`UPDATE source_records SET admission = 'admitted' WHERE id = $1`, [curatorRecord]);
    expect(await relationOf(BELFRIES, mons.part_id)).toEqual(['component']);
    // The list's record gone, the curator's word alone keeps the part, as the curator's.
    await pool.query('DELETE FROM source_records WHERE experience_id = $1 AND whole_id = $2 AND source_id = $3',
      [mons.part_id, BELFRIES, COMPONENTS_SOURCE]);
    expect(await relationOf(BELFRIES, mons.part_id)).toEqual(['curator']);
  });

  it('makes no part of a place recorded in itself', async () => {
    const [, mons] = await partsOf(BELFRIES);
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $1, 10, '9560-040')`,
      [mons.part_id],
    );
    expect(await relationOf(mons.part_id, mons.part_id)).toEqual([]);
  });

  it('folds a site recorded in itself without making the survivor its part, and records it in itself again on the undo', async () => {
    const adminId = (await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
    )).rows[0].id;
    // A site of one component that stands for the whole site: the list's line recorded in the site itself.
    await site(WHOLE_SITE, '9644', 'A site of one component (fixture)', 10.0, 45.0);
    await pool.query(
      `INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $1, 10, '9644-001')`,
      [WHOLE_SITE],
    );
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9645', 'The same site as a place of worship', ST_SetSRID(ST_MakePoint(10.0, 45.0), 4326)
         FROM experience_sources s WHERE s.name = 'Places of worship'`, [WHOLE_SITE_ELSEWHERE],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9645', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'`,
      [WHOLE_SITE_ELSEWHERE],
    );
    const relations = async () => (await pool.query(
      'SELECT 1 FROM experience_parts WHERE whole_id = ANY($1::int[]) OR part_id = ANY($1::int[])',
      [[WHOLE_SITE, WHOLE_SITE_ELSEWHERE]],
    )).rowCount;
    const selfRecord = async () => (await pool.query<{ experience_id: number; whole_id: number }>(
      `SELECT experience_id, whole_id FROM source_records WHERE source_id = $1 AND external_id = '9644-001'`,
      [COMPONENTS_SOURCE],
    )).rows;

    const outcome = await mergePlaces({ survivorId: WHOLE_SITE_ELSEWHERE, foldedId: WHOLE_SITE, mergedBy: adminId, reason: 'curator' });
    expect(outcome.refusal).toBeUndefined();
    expect(await relations()).toBe(0);
    expect(await selfRecord()).toEqual([{ experience_id: WHOLE_SITE_ELSEWHERE, whole_id: WHOLE_SITE_ELSEWHERE }]);

    expect((await undoMerge(outcome.result!.mergeId, adminId)).refusal).toBeUndefined();
    expect(await relations()).toBe(0);
    expect(await selfRecord()).toEqual([{ experience_id: WHOLE_SITE, whole_id: WHOLE_SITE }]);
  });

  it("moves the parts' records with a whole a merge folds, and back on its undo", async () => {
    const parts = (await partsOf(BELFRIES)).map(part => part.part_id);
    const adminId = (await pool.query<{ id: number }>(
      `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, 'Q9557', 'Belfries (another kind)', ST_SetSRID(ST_MakePoint(3.5, 50.8), 4326)
         FROM experience_sources s WHERE s.name = 'Places of worship'`, [BELFRIES_ELSEWHERE],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q9557', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Places of worship'`,
      [BELFRIES_ELSEWHERE],
    );
    const wholesOf = async () => (await pool.query<{ whole_id: number }>(
      'SELECT DISTINCT whole_id FROM experience_parts WHERE part_id = ANY($1::int[])', [parts],
    )).rows.map(row => row.whole_id);

    const outcome = await mergePlaces({ survivorId: BELFRIES_ELSEWHERE, foldedId: BELFRIES, mergedBy: adminId, reason: 'curator' });
    expect(outcome.refusal).toBeUndefined();
    expect(await wholesOf()).toEqual([BELFRIES_ELSEWHERE]);
    expect((await recordsOf(BELFRIES_ELSEWHERE)).map(record => record.external_id)).toEqual([BRUGES.externalRef, MONS.externalRef]);

    expect((await undoMerge(outcome.result!.mergeId, adminId)).refusal).toBeUndefined();
    expect(await wholesOf()).toEqual([BELFRIES]);
    expect((await recordsOf(BELFRIES)).map(record => record.external_id)).toEqual([BRUGES.externalRef, MONS.externalRef]);
  });
});

describe('a record is in a kind or in a whole, under an id of its source (ADR-0198)', () => {
  const insert = (fields: { kind: number | null; whole: number | null; id: string; place: number }) =>
    pool.query(
      `INSERT INTO source_records (experience_id, kind_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, $4, $5)`,
      [fields.place, fields.kind, fields.whole, COMPONENTS_SOURCE, fields.id],
    );

  it('refuses a record in both a kind and a whole, and one in neither', async () => {
    const [part] = await partsOf(BELFRIES);
    await expect(insert({ kind: heritage.kind_id, whole: BELFRIES, id: '9560-050', place: part.part_id }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insert({ kind: null, whole: null, id: '9560-050', place: part.part_id }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it("refuses a record in a whole whose id is not of its source's scheme, and takes a curator's key", async () => {
    const [part] = await partsOf(BELFRIES);
    const other = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9562-fixture', 'A third serial site (fixture)', ST_SetSRID(ST_MakePoint(3.9, 50.4), 4326)) RETURNING id`,
      [run.sourceId],
    )).rows[0].id;
    try {
      await expect(insert({ kind: null, whole: other, id: 'component:12', place: part.part_id }))
        .rejects.toMatchObject({ code: '23514' });
      await insert({ kind: null, whole: other, id: 'curator-1-2', place: part.part_id });
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [other]);
    }
  });

  it('refuses a second record of one source for one place in one whole', async () => {
    const [part] = await partsOf(BELFRIES);
    await expect(insert({ kind: null, whole: BELFRIES, id: '9560-051', place: part.part_id }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('states the shapes of the schemes as the shared package does', async () => {
    const samples = [
      '383', '383bis', '383bis-001', '985ter-001', '1102rev-001a', '823-001B', '1142-01bis', '540-003a 1', '9560-other-1',
      'Q42', 'Q0', 'Q42$F078E5B3-F9A8-480E-B7AC-D97778CBBEF9', 'curator-7-1731283200000', 'component:12', 'e2e-9001',
    ];
    const schemes = await pool.query<{ id_scheme: string }>('SELECT DISTINCT id_scheme FROM experience_sources');
    for (const { id_scheme: scheme } of schemes.rows) expect(SOURCE_ID_SCHEMES).toContain(scheme);
    for (const scheme of SOURCE_ID_SCHEMES) {
      const fits = await pool.query<{ id: string; fits: boolean }>(
        'SELECT id, source_id_fits_scheme($1, id) AS fits FROM unnest($2::text[]) AS id', [scheme, samples],
      );
      expect(fits.rows.map(row => [row.id, row.fits])).toEqual(samples.map(id => [id, SOURCE_ID_SHAPES[scheme].test(id)]));
    }
  });
});
