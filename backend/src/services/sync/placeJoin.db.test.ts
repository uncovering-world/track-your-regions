import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { upsertSingleLocation } from './syncUtils.js';

/**
 * A run finds the place its Wikidata item identifies before it creates one
 * (ADR-0143 decision 3, #1894), against PostgreSQL: the lookup reads the
 * identifier registry and the place's lock, which only the database answers.
 *
 * The fixture is the Ajanta Caves as the World Heritage run leaves them: a
 * published site of one point whose one item the registry holds as
 * identifying. A Places of worship run then reads that item, as it did before
 * a copy was folded into the site after every run. Ids and items are the
 * fixture's own, deleted before and after.
 */

const AJANTA = 9980;
const SERIAL = 9981;
const ITEM = 'Q9980001';
const SERIAL_ITEM = 'Q9980002';
const NEW_ITEM = 'Q9980003';
const OLD_ITEM = 'Q9980004';
const MOVED_ITEM = 'Q9980005';
const ITEMS = [ITEM, SERIAL_ITEM, NEW_ITEM, OLD_ITEM, MOVED_ITEM];
const AJANTA_POINT = { lon: 75.7033, lat: 20.5519 };

let heritage = 0;
let worship = 0;
let archaeology = 0;

const params = (sourceId: number, externalId: string, overrides: Partial<ExperienceUpsertParams> = {}): ExperienceUpsertParams => ({
  sourceId,
  externalId,
  name: 'Ajanta Caves',
  nameLocal: { en: 'Ajanta Caves' },
  subtitle: 'Buddhist cave monuments in Maharashtra',
  description: null,
  type: null,
  tags: [],
  // The worship item's coordinate stands 750 m from UNESCO's, as the Cave of
  // Altamira's two sources' points do.
  lon: AJANTA_POINT.lon + 0.0072,
  lat: AJANTA_POINT.lat,
  countryCodes: [],
  countryNames: [],
  imageUrl: null,
  metadata: {},
  ...overrides,
});

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences WHERE id = ANY($1::int[])
        OR id IN (SELECT experience_id FROM experience_kind_memberships WHERE external_id = ANY($2::text[]))`,
    [[AJANTA, SERIAL], ITEMS],
  );
  await pool.query('DELETE FROM workbench.wikidata_redirects WHERE source = ANY($1::text[]) OR target = ANY($1::text[])', [ITEMS]);
}

/** A published World Heritage site with these points, its items on its membership. */
async function site(id: number, ref: string, items: string[], points: { lon: number; lat: number }[]): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Ajanta Caves', ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [id, heritage, ref, points[0].lon, points[0].lat],
  );
  const membership = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, wikidata_items, curation_state, published_at,
        reported_name, reported_location)
     SELECT $1, kind_id, id, $3, $4, 'auto', NOW(), 'Ajanta Caves', ST_SetSRID(ST_MakePoint($5, $6), 4326)
       FROM experience_sources WHERE id = $2
     RETURNING id`,
    [id, heritage, ref, items, points[0].lon, points[0].lat],
  )).rows[0].id;
  for (const [n, point] of points.entries()) {
    const location = (await pool.query<{ id: number }>(
      `INSERT INTO experience_locations (experience_id, external_ref, ordinal, location)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)) RETURNING id`,
      [id, `${ref}-${n + 1}`, n + 1, point.lon, point.lat],
    )).rows[0].id;
    await pool.query(
      'INSERT INTO experience_location_placements (location_id, membership_id) VALUES ($1, $2)', [location, membership],
    );
  }
}

/** The places that hold a membership keyed by this item, in id order. */
async function placesOf(item: string): Promise<number[]> {
  return (await pool.query<{ experience_id: number }>(
    'SELECT experience_id FROM experience_kind_memberships WHERE external_id = $1 ORDER BY experience_id', [item],
  )).rows.map(r => r.experience_id);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM experience_sources
      WHERE name IN ('UNESCO World Heritage Sites', 'Places of worship', 'Archaeology')`,
  );
  const id = (name: string) => sources.rows.find(row => row.name === name)!.id;
  heritage = id('UNESCO World Heritage Sites');
  worship = id('Places of worship');
  archaeology = id('Archaeology');
  await site(AJANTA, '9980-fixture', [ITEM], [AJANTA_POINT]);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a run finds the place its item identifies (ADR-0143 decision 3)', () => {
  it('joins the place an item identifies, as a membership waiting for a curator, with no second place', async () => {
    const outcome = await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });

    expect(outcome.experienceId).toBe(AJANTA);
    expect(outcome.changeSet.changeType).not.toBe('created');
    expect(await placesOf(ITEM)).toEqual([AJANTA]);
    const joined = await pool.query(
      `SELECT m.curation_state, ST_X(m.reported_location) AS lon, e.name, ST_X(e.location) AS place_lon
         FROM experience_kind_memberships m JOIN experiences e ON e.id = m.experience_id
        WHERE m.source_id = $1 AND m.external_id = $2`,
      [worship, ITEM],
    );
    // The gate holds the published place: its content stays as World Heritage
    // left it, and the worship run's own view is its membership's.
    expect(joined.rows[0]).toMatchObject({ curation_state: 'pending', name: 'Ajanta Caves' });
    expect(joined.rows[0].place_lon).toBeCloseTo(AJANTA_POINT.lon, 6);
    expect(joined.rows[0].lon).toBeCloseTo(AJANTA_POINT.lon + 0.0072, 6);
    const merges = await pool.query('SELECT 1 FROM experience_merges WHERE survivor_id = $1 OR folded_id = $1', [AJANTA]);
    expect(merges.rowCount).toBe(0);
  });

  it('keeps a place of one point one point when its run of one point stands 750 m off', async () => {
    const { experienceId } = await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });
    await upsertSingleLocation(experienceId, ITEM, AJANTA_POINT.lon + 0.0072, AJANTA_POINT.lat, { syncLogId: null, sourceId: worship });

    const points = await pool.query<{ id: number; lon: number; placed_by: number }>(
      `SELECT el.id, ST_X(el.location) AS lon, count(p.membership_id)::int AS placed_by
         FROM experience_locations el
         LEFT JOIN experience_location_placements p ON p.location_id = el.id
        WHERE el.experience_id = $1 AND el.merged_into_id IS NULL AND el.missing_since IS NULL
        GROUP BY el.id`,
      [AJANTA],
    );
    expect(points.rows).toHaveLength(1);
    expect(points.rows[0].lon).toBeCloseTo(AJANTA_POINT.lon, 6);
    expect(points.rows[0].placed_by).toBe(2);
  });

  it('finds its own membership on its next run', async () => {
    await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });
    const again = await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });
    expect(again.experienceId).toBe(AJANTA);
    expect(await placesOf(ITEM)).toEqual([AJANTA]);
  });

  it('says on a dry run that it would join the place, writing nothing', async () => {
    const preview = await upsertExperienceRecord(params(worship, ITEM), { dryRun: true });
    expect(preview.experienceId).toBe(AJANTA);
    expect(preview.changeSet.changeType).not.toBe('created');
    expect(await placesOf(ITEM)).toEqual([]);
  });

  it('creates a place where the item only refers to one: a serial site\'s items name its parts', async () => {
    await site(SERIAL, '9981-fixture', [SERIAL_ITEM], [AJANTA_POINT, { lon: 75.71, lat: 20.56 }]);
    const outcome = await upsertExperienceRecord(params(worship, SERIAL_ITEM), { syncLogId: null });
    expect(outcome.experienceId).not.toBe(SERIAL);
    expect(outcome.changeSet.changeType).toBe('created');
  });

  it('creates a place where the identified place already holds a membership in the run\'s kind', async () => {
    await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });
    // A second worship item read as the same place would need a second
    // membership in one kind, which a place cannot hold; its run makes its own.
    await pool.query(
      `UPDATE experience_kind_memberships SET external_id = 'Q9980004' WHERE source_id = $1 AND external_id = $2`,
      [worship, ITEM],
    );
    const outcome = await upsertExperienceRecord(params(worship, ITEM), { syncLogId: null });
    expect(outcome.experienceId).not.toBe(AJANTA);
  });

  it('makes one place of a new item two sources read at once', async () => {
    // Both runs find nothing and wait on the item's keys, held here; once let
    // go, the first creates the place and the second, reading again with the
    // keys, joins it rather than creating a second.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT lock_place_identifiers('wikidata', ARRAY[$1::text])`, [NEW_ITEM]);
      const first = upsertExperienceRecord(params(worship, NEW_ITEM, { name: 'A new temple' }), { syncLogId: null });
      const second = upsertExperienceRecord(params(archaeology, NEW_ITEM, { name: 'A new temple' }), { syncLogId: null });
      await new Promise(resolve => setTimeout(resolve, 300));
      await holder.query('COMMIT');
      const [a, b] = await Promise.all([first, second]);
      expect(a.experienceId).toBe(b.experienceId);
    } finally {
      holder.release();
    }
    const places = await placesOf(NEW_ITEM);
    expect(places).toHaveLength(2);
    expect(new Set(places).size).toBe(1);
  });

  describe('an item Wikidata redirected to another (#1895)', () => {
    // The kept redirects say the old item now points to the one the runs read,
    // and a run of the source has a log of its own, so a held pointer could be set.
    let runId = 0;
    beforeEach(async () => {
      await pool.query('INSERT INTO workbench.wikidata_redirects (source, target) VALUES ($1, $2)', [OLD_ITEM, MOVED_ITEM]);
      runId = (await pool.query<{ id: number }>(
        `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`, [worship],
      )).rows[0].id;
    });
    afterEach(async () => {
      await clear();
      await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [runId]);
      await pool.query('UPDATE experience_sources SET requires_curation = true WHERE id = $1', [worship]);
    });

    /** The membership after the run read the new item: still passed, nothing held. */
    async function membershipOf(experienceId: number) {
      return (await pool.query<{ curation_state: string; pending_change_sync_log_id: number | null }>(
        'SELECT curation_state, pending_change_sync_log_id FROM experience_kind_memberships WHERE experience_id = $1', [experienceId],
      )).rows;
    }

    it('finds a place registered under the old item by the new one, and joins it', async () => {
      // A place of worship registered under the old item, which Wikidata has since merged into MOVED_ITEM.
      const { experienceId } = await upsertExperienceRecord(params(worship, OLD_ITEM, { name: 'A moved temple' }), { syncLogId: null });
      const outcome = await upsertExperienceRecord(params(archaeology, MOVED_ITEM, { name: 'A moved temple' }), { syncLogId: null });
      expect(outcome.experienceId).toBe(experienceId);
      expect(outcome.changeSet.changeType).not.toBe('created');
    });

    it('finds its own membership by the old item, moves its key to the new one, and files the move past the gate', async () => {
      const { experienceId } = await upsertExperienceRecord(params(worship, OLD_ITEM, { name: 'A moved temple' }), { syncLogId: null });
      // A curator passed the arrival: the move must neither retire that pass nor raise a card.
      await pool.query(
        `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW() WHERE experience_id = $1`, [experienceId],
      );
      // Under the run's own log, so a proposal would set the held pointer (Places of worship is gated).
      const outcome = await upsertExperienceRecord(params(worship, MOVED_ITEM, { name: 'A moved temple' }), { syncLogId: runId });

      expect(outcome.experienceId).toBe(experienceId);
      expect(await placesOf(OLD_ITEM)).toEqual([]);
      expect(await placesOf(MOVED_ITEM)).toEqual([experienceId]);
      expect(outcome.changeSet.changedFields).toContainEqual(expect.objectContaining({
        field: 'external_id', old: OLD_ITEM, new: MOVED_ITEM, passedTheGate: 'unseen',
      }));
      expect(await membershipOf(experienceId)).toEqual([{ curation_state: 'verified', pending_change_sync_log_id: null }]);
      // The registry followed the key: the place is found by the new item alone.
      const registered = await pool.query<{ value: string; identifies: boolean }>(
        'SELECT value, identifies FROM place_identifiers WHERE experience_id = $1 AND scheme = $2 ORDER BY value', [experienceId, 'wikidata'],
      );
      expect(registered.rows).toEqual([{ value: MOVED_ITEM, identifies: true }]);
    });

    it("keeps a trusted source's pass over the key's move", async () => {
      // A trusted source writes content at once, and a written field retires a
      // curator's pass (`verified` → `auto`); the key's move is no such field.
      await pool.query('UPDATE experience_sources SET requires_curation = false WHERE id = $1', [worship]);
      const { experienceId } = await upsertExperienceRecord(params(worship, OLD_ITEM, { name: 'A moved temple' }), { syncLogId: null });
      await pool.query(`UPDATE experience_kind_memberships SET curation_state = 'verified' WHERE experience_id = $1`, [experienceId]);

      await upsertExperienceRecord(params(worship, MOVED_ITEM, { name: 'A moved temple' }), { syncLogId: runId });

      expect(await membershipOf(experienceId)).toEqual([{ curation_state: 'verified', pending_change_sync_log_id: null }]);
    });
  });
});
