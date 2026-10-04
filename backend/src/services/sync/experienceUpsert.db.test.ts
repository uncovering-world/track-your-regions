import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { markNotAdmitted } from './admission.js';
import { countSeenAmongActive, flagMissingExperiences } from './missingDetection.js';
import { lockSourcedExperience } from '../../db/experienceWriter.js';

/**
 * A run finds its place through its own membership (#1244, ADR-0084), executed
 * against PostgreSQL: the upsert's conflict target, the admission sweep and
 * missing detection all decide which row they touch in SQL, and only the real
 * statements can say which row that was.
 *
 * The fixture is the Louvre as Epic #755 will leave it: one place, written
 * first by Art Museums, carrying a second membership the Archaeology source
 * brought under the same Wikidata item. The place's own `source_id` and
 * `external_id` name Art Museums; the Archaeology run knows the place only by
 * its membership. Ids are the fixture's own, deleted before and after.
 */

const LOUVRE = 9440;
const LOUVRE_QID = 'Q9440-louvre-fixture';
const NEW_SITE_QID = 'Q9441-new-site-fixture';

let artMuseums = 0;
let archaeology = 0;

const params = (sourceId: number, externalId: string, name: string): ExperienceUpsertParams => ({
  sourceId,
  externalId,
  name,
  nameLocal: { en: name },
  description: null,
  shortDescription: null,
  type: null,
  tags: [],
  lon: 2.3376,
  lat: 48.8606,
  countryCodes: ['FR'],
  countryNames: ['France'],
  imageUrl: null,
  metadata: { wikidataQid: externalId },
});

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences WHERE id = $1 OR external_id = ANY($2::text[])`,
    [LOUVRE, [LOUVRE_QID, NEW_SITE_QID]],
  );
}

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  const result = await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0];
}

beforeEach(async () => {
  await clear();
  const art = await sourceNamed('Art Museums');
  const arch = await sourceNamed('Archaeology');
  artMuseums = art.id;
  archaeology = arch.id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Louvre Museum', ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326))`,
    [LOUVRE, artMuseums, LOUVRE_QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW()), ($1, $5, $6, $4, 'auto', NOW())`,
    [LOUVRE, art.kind_id, artMuseums, LOUVRE_QID, arch.kind_id, archaeology],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a run reaches its places through its own membership (ADR-0084)', () => {
  it('creates a place and its membership under the id the source knows it by', async () => {
    const outcome = await upsertExperienceRecord(params(archaeology, NEW_SITE_QID, 'A new site'));

    const membership = await pool.query(
      `SELECT m.experience_id, m.external_id, e.source_id, e.external_id AS place_external_id
         FROM experience_kind_memberships m JOIN experiences e ON e.id = m.experience_id
        WHERE m.source_id = $1 AND m.external_id = $2`,
      [archaeology, NEW_SITE_QID],
    );
    expect(membership.rows).toEqual([{
      experience_id: outcome.experienceId, external_id: NEW_SITE_QID,
      source_id: archaeology, place_external_id: NEW_SITE_QID,
    }]);
  });

  it('makes a second writer of the same new object wait for the first, then find its place', async () => {
    // Two processes the in-memory guard cannot see. The first has looked the
    // object up and found nothing, and has not written it yet; the second
    // must wait on the source's name for the object rather than find nothing
    // too and insert a place of its own.
    const first = await pool.connect();
    try {
      await first.query('BEGIN');
      expect(await lockSourcedExperience(first, archaeology, NEW_SITE_QID)).toBeNull();

      let settled = false;
      const second = upsertExperienceRecord(params(archaeology, NEW_SITE_QID, 'A new site'))
        .finally(() => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      const made = await first.query<{ id: number }>(
        `INSERT INTO experiences (source_id, external_id, name, location)
         VALUES ($1, $2, 'A new site', ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326)) RETURNING id`,
        [archaeology, NEW_SITE_QID],
      );
      await first.query(
        `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
         SELECT $1, kind_id, id, $2 FROM experience_sources WHERE id = $3`,
        [made.rows[0].id, NEW_SITE_QID, archaeology],
      );
      await first.query('COMMIT');

      expect((await second).experienceId).toBe(made.rows[0].id);
    } finally {
      first.release();
    }
    const places = await pool.query('SELECT id FROM experiences WHERE external_id = $1', [NEW_SITE_QID]);
    expect(places.rowCount).toBe(1);
  });

  it('finds a place another source wrote first, and creates no second one', async () => {
    const outcome = await upsertExperienceRecord(params(archaeology, LOUVRE_QID, 'Louvre Museum'));

    expect(outcome.experienceId).toBe(LOUVRE);
    // A run that keyed on the place's own pair would have inserted a row
    // under (Archaeology, the item) beside it.
    const places = await pool.query('SELECT id FROM experiences WHERE external_id = $1', [LOUVRE_QID]);
    expect(places.rows).toEqual([{ id: LOUVRE }]);
    // The place keeps the source that first brought it: provenance, not a key.
    const place = await pool.query('SELECT source_id, external_id FROM experiences WHERE id = $1', [LOUVRE]);
    expect(place.rows[0]).toEqual({ source_id: artMuseums, external_id: LOUVRE_QID });
  });

  it('holds and claims each source\'s type on its own membership', async () => {
    // The Pantheon's shape: a type in one kind is no answer for another
    // (ADR-0084). Archaeology is gated and the place is visible, so its
    // proposal is held on its own membership; Art Museums' is untouched.
    const types = async () => (await pool.query(
      `SELECT source_id, type FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id`,
      [LOUVRE],
    )).rows;
    const held = await upsertExperienceRecord({ ...params(archaeology, LOUVRE_QID, 'Louvre Museum'), type: 'museum' });
    expect(held.changeSet.heldFields.map(field => field.field)).toContain('type');
    expect(await types()).toEqual([
      { source_id: artMuseums, type: null },
      { source_id: archaeology, type: null },
    ]);

    // A curator's claim on that membership's type meets the next proposal as a
    // conflict, and leaves the other membership alone.
    await pool.query(
      `UPDATE experience_kind_memberships SET type = 'site', curated_fields = '["type"]'::jsonb
        WHERE experience_id = $1 AND source_id = $2`,
      [LOUVRE, archaeology],
    );
    const claimed = await upsertExperienceRecord({ ...params(archaeology, LOUVRE_QID, 'Louvre Museum'), type: 'museum' });
    expect(claimed.changeSet.curatedConflicts.map(field => field.field)).toContain('type');
    expect(await types()).toEqual([
      { source_id: artMuseums, type: null },
      { source_id: archaeology, type: 'site' },
    ]);
  });

  it('keeps admitted the membership the sweep\'s run still names, on that place', async () => {
    await markNotAdmitted(archaeology, [LOUVRE_QID], 'not in the admitted set', false);

    const memberships = await pool.query(
      `SELECT source_id, admission FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id`,
      [LOUVRE],
    );
    expect(memberships.rows).toEqual([
      { source_id: artMuseums, admission: 'admitted' },
      { source_id: archaeology, admission: 'admitted' },
    ]);
  });

  it('refuses only its own membership when the run stops admitting the place', async () => {
    await markNotAdmitted(archaeology, ['some-other-site'], 'not in the admitted set', false);

    const memberships = await pool.query(
      `SELECT source_id, admission FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id`,
      [LOUVRE],
    );
    expect(memberships.rows).toEqual([
      { source_id: artMuseums, admission: 'admitted' },
      { source_id: archaeology, admission: 'refused' },
    ]);
  });

  it('counts and names the place by the membership\'s id in missing detection', async () => {
    expect(await countSeenAmongActive(archaeology, [LOUVRE_QID])).toBe(1);

    const named = await flagMissingExperiences(archaeology, 0, true, ['some-other-site']);
    expect(named.filter(change => change.experienceId === LOUVRE)).toEqual([
      expect.objectContaining({ experienceId: LOUVRE, externalId: LOUVRE_QID, changeType: 'missing' }),
    ]);
    const seen = await flagMissingExperiences(archaeology, 0, true, [LOUVRE_QID]);
    expect(seen.some(change => change.experienceId === LOUVRE)).toBe(false);
  });
});
