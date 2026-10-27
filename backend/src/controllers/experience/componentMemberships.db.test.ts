import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import {
  placeHoldsRealKindSql, placeKindsSql, placeOfferedSql, placeSourceIdsSql, placeVisibleSql, shownMembershipSql,
} from '../../db/membership.js';
import { answeringPlaceSql } from '../../db/placePoints.js';
import { listKinds } from './experienceQueryController.js';
import { getSources } from '../admin/syncController.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';

/**
 * A part of a serial site holds a membership of the virtual kind World
 * Heritage components, and nothing a reader, a curator or an admin reads
 * changes for it (ADR-0156 decision 1, #1426), against PostgreSQL. The fixture
 * is the Belfries of Belgium and France as the World Heritage run parts them:
 * the belfries of Mons and of Bruges. Ids are the fixture's own, deleted
 * before and after.
 */

const BELFRIES = 9560;
const MONS = { name: 'Beffroi de Mons', externalRef: '9560-029', lon: 3.9506, lat: 50.4542 };
const BRUGES = { name: 'Belfry of Bruges', externalRef: '9560-002', lon: 3.2248, lat: 51.2085 };
const COMPONENTS_KIND = 10;
const COMPONENTS_SOURCE = 10;

let run: LocationWriteRun;

async function partsOf(site: number) {
  return (await pool.query<{ link_id: number; part_id: number; location_id: number }>(
    `SELECT p.id AS link_id, p.part_id, el.id AS location_id
       FROM experience_parts p JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND p.reason = 'component'
      ORDER BY p.external_ref`, [site],
  )).rows;
}

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [BELFRIES],
  );
  await pool.query('DELETE FROM experiences WHERE id = $1', [BELFRIES]);
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number }>(
    `SELECT id, kind_id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  run = { syncLogId: null, sourceId: source.id, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9560-fixture', 'Belfries of Belgium and France (fixture)', ST_SetSRID(ST_MakePoint(3.5, 50.8), 4326))`,
    [BELFRIES, source.id],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '9560-fixture', 'auto', NOW())`,
    [BELFRIES, source.kind_id, source.id],
  );
  await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a part holds a membership of the virtual kind World Heritage components (ADR-0156)', () => {
  it('writes one per part as the run parts the site, keyed by its relation', async () => {
    const parts = await partsOf(BELFRIES);
    expect(parts).toHaveLength(2);
    const held = await pool.query<{ experience_id: number; source_id: number; external_id: string; curation_state: string }>(
      `SELECT experience_id, source_id, external_id, curation_state FROM experience_kind_memberships
        WHERE kind_id = $1 AND experience_id = ANY($2::int[]) ORDER BY experience_id`,
      [COMPONENTS_KIND, parts.map(part => part.part_id)],
    );
    expect(held.rows).toEqual(
      [...parts].sort((a, b) => a.part_id - b.part_id).map(part => ({
        experience_id: part.part_id, source_id: COMPONENTS_SOURCE, external_id: `component:${part.link_id}`, curation_state: 'auto',
      })),
    );
  });

  it('offers the part no more than before: no kind, no source, still answered through its site', async () => {
    const [part] = await partsOf(BELFRIES);
    const read = await pool.query<{
      offered: boolean; visible: boolean; kinded: boolean; kinds: unknown[]; shown: number | null;
      sources: number[]; answering: number; listing: string; missing: boolean;
    }>(
      `SELECT ${placeOfferedSql('e')} AS offered, ${placeVisibleSql('e')} AS visible,
              ${placeHoldsRealKindSql('e.id')} AS kinded, ${placeKindsSql('e')} AS kinds,
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

  it('lists the virtual kind among no kinds a traveller browses and its source among no sources an admin runs', async () => {
    expect((await listKinds()).map(kind => kind.id)).not.toContain(COMPONENTS_KIND);
    expect((await getSources()).map(source => source.id)).not.toContain(COMPONENTS_SOURCE);
  });

  it('moves the record with its relation, as a merge and its undo move it, and drops it with the relation', async () => {
    const [mons, bruges] = await partsOf(BELFRIES);
    const recordOf = async (link: number) => (await pool.query<{ experience_id: number }>(
      'SELECT experience_id FROM experience_kind_memberships WHERE kind_id = $1 AND external_id = $2',
      [COMPONENTS_KIND, `component:${link}`],
    )).rows.map(row => row.experience_id);
    // A place another kind brought, which a merge makes the part.
    const merged = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9560-merged', 'Belfry of Mons (another kind)', ST_SetSRID(ST_MakePoint(3.9506, 50.4542), 4326))
       RETURNING id`,
      [run.sourceId],
    )).rows[0].id;

    try {
      await pool.query('UPDATE experience_parts SET part_id = $2 WHERE id = $1', [mons.link_id, merged]);
      expect(await recordOf(mons.link_id)).toEqual([merged]);
      await pool.query('UPDATE experience_parts SET part_id = $2 WHERE id = $1', [mons.link_id, mons.part_id]);
      expect(await recordOf(mons.link_id)).toEqual([mons.part_id]);

      await pool.query('DELETE FROM experience_parts WHERE id = $1', [bruges.link_id]);
      expect(await recordOf(bruges.link_id)).toEqual([]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [merged]);
    }
  });

  it('keeps one record for a part of two sites, keyed by the relation that remains', async () => {
    const [mons] = await partsOf(BELFRIES);
    const keysOf = async () => (await pool.query<{ external_id: string }>(
      'SELECT external_id FROM experience_kind_memberships WHERE kind_id = $1 AND experience_id = $2',
      [COMPONENTS_KIND, mons.part_id],
    )).rows.map(row => row.external_id);
    const other = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9560-other', 'Another serial site (fixture)', ST_SetSRID(ST_MakePoint(3.9, 50.4), 4326))
       RETURNING id`,
      [run.sourceId],
    )).rows[0].id;

    try {
      const second = (await pool.query<{ id: number }>(
        `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
         SELECT $1, part_id, 'component', membership_id, '9560-other-1' FROM experience_parts WHERE id = $2
         RETURNING id`,
        [other, mons.link_id],
      )).rows[0].id;
      expect(await keysOf()).toEqual([`component:${mons.link_id}`]);

      await pool.query('DELETE FROM experience_parts WHERE id = $1', [mons.link_id]);
      expect(await keysOf()).toEqual([`component:${second}`]);
      await pool.query('DELETE FROM experience_parts WHERE id = $1', [second]);
      expect(await keysOf()).toEqual([]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [other]);
    }
  });

  it('marks no place for pairing when the membership is written', async () => {
    const [part] = await partsOf(BELFRIES);
    await pool.query('DELETE FROM experience_pairing_due WHERE experience_id = $1', [part.part_id]);
    await pool.query(
      'UPDATE experience_kind_memberships SET reported_name = $3 WHERE experience_id = $1 AND kind_id = $2',
      [part.part_id, COMPONENTS_KIND, 'Beffroi de Mons (as the list names it)'],
    );
    await pool.query('DELETE FROM experience_kind_memberships WHERE experience_id = $1 AND kind_id = $2', [part.part_id, COMPONENTS_KIND]);
    const due = await pool.query('SELECT 1 FROM experience_pairing_due WHERE experience_id = $1', [part.part_id]);
    expect(due.rowCount).toBe(0);
  });
});

describe("what the site's list says of a component, on the part's record (ADR-0156 decision 2)", () => {
  const views = async () => (await pool.query<{ ref: string; name: string | null; lon: number | null }>(
    `SELECT p.external_ref AS ref, rec.reported_name AS name, ST_X(rec.reported_location) AS lon
       FROM experience_parts p
       JOIN experience_kind_memberships rec ON rec.experience_id = p.part_id AND rec.kind_id = $2
      WHERE p.whole_id = $1 ORDER BY p.external_ref`, [BELFRIES, COMPONENTS_KIND],
  )).rows;

  it('is written by the run as the list gives it, whatever a curator made of the point', async () => {
    expect(await views()).toEqual([
      { ref: BRUGES.externalRef, name: BRUGES.name, lon: BRUGES.lon },
      { ref: MONS.externalRef, name: MONS.name, lon: MONS.lon },
    ]);
    const [, mons] = await partsOf(BELFRIES);
    await pool.query(
      `UPDATE experience_locations SET name = 'Belfry of Mons', curated_fields = '["name"]' WHERE id = $1`, [mons.location_id],
    );
    // The list renames Mons's belfry: the point keeps the curator's name, the record what the list says.
    await writeExperienceLocations(BELFRIES, [{ ...MONS, name: 'Beffroi de Mons (Hainaut)' }, BRUGES], run);
    expect((await views())[1]).toEqual({ ref: MONS.externalRef, name: 'Beffroi de Mons (Hainaut)', lon: MONS.lon });
    const point = await pool.query<{ name: string }>('SELECT name FROM experience_locations WHERE id = $1', [mons.location_id]);
    expect(point.rows[0].name).toBe('Belfry of Mons');
  });

  it('is written by a run that changes no point, where the record holds another', async () => {
    await pool.query(
      'UPDATE experience_kind_memberships SET reported_name = NULL, reported_location = NULL WHERE kind_id = $1 AND experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $2)',
      [COMPONENTS_KIND, BELFRIES],
    );
    await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
    expect((await views()).map(view => view.name)).toEqual([BRUGES.name, MONS.name]);
  });

  it('is gone once the list drops the component, and back once it lists it again', async () => {
    await writeExperienceLocations(BELFRIES, [MONS], run);
    expect(await views()).toEqual([
      { ref: BRUGES.externalRef, name: null, lon: null },
      { ref: MONS.externalRef, name: MONS.name, lon: MONS.lon },
    ]);
    await writeExperienceLocations(BELFRIES, [MONS, BRUGES], run);
    expect((await views())[0]).toEqual({ ref: BRUGES.externalRef, name: BRUGES.name, lon: BRUGES.lon });
  });

  it("is dropped when the record changes owner, since it is the next site's to write", async () => {
    const [, mons] = await partsOf(BELFRIES);
    const record = async () => (await pool.query<{ external_id: string; name: string | null; lon: number | null }>(
      `SELECT external_id, reported_name AS name, ST_X(reported_location) AS lon
         FROM experience_kind_memberships WHERE kind_id = $1 AND experience_id = $2`,
      [COMPONENTS_KIND, mons.part_id],
    )).rows;
    const other = (await pool.query<{ id: number }>(
      `INSERT INTO experiences (source_id, external_id, name, location)
       VALUES ($1, '9560-other', 'Another serial site (fixture)', ST_SetSRID(ST_MakePoint(3.9, 50.4), 4326))
       RETURNING id`,
      [run.sourceId],
    )).rows[0].id;

    try {
      const second = (await pool.query<{ id: number }>(
        `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
         SELECT $1, part_id, 'component', membership_id, '9560-other-1' FROM experience_parts WHERE id = $2
         RETURNING id`,
        [other, mons.link_id],
      )).rows[0].id;
      // A second site's relation keys nothing anew: the Belfries' list still speaks for the record.
      expect(await record()).toEqual([{ external_id: `component:${mons.link_id}`, name: MONS.name, lon: MONS.lon }]);

      await pool.query('DELETE FROM experience_parts WHERE id = $1', [mons.link_id]);
      expect(await record()).toEqual([{ external_id: `component:${second}`, name: null, lon: null }]);
    } finally {
      await pool.query('DELETE FROM experiences WHERE id = $1', [other]);
    }
  });
});
