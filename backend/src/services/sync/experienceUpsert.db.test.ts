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

const ACROPOLIS = 9442;
const ACROPOLIS_QID = 'Q9442-acropolis-fixture';
const ACROPOLIS_WHC = '9442-whc-fixture';

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences WHERE id = ANY($1::int[]) OR external_id = ANY($2::text[])`,
    [[LOUVRE, ACROPOLIS], [LOUVRE_QID, NEW_SITE_QID, ACROPOLIS_WHC]],
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

describe('the anchor of a place of several points (ADR-0095)', () => {
  it('is written past the gate on a place readers see and raises no question, where a coordinate of its own is held', async () => {
    const gated = await pool.query<{ requires_curation: boolean }>(
      'SELECT requires_curation FROM experience_sources WHERE id = $1', [archaeology],
    );
    expect(gated.rows[0].requires_curation).toBe(true);
    const created = await upsertExperienceRecord(params(archaeology, NEW_SITE_QID, 'A new site'));
    // Passed by a curator, so a reader sees it and the gate holds what the source changes.
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const log = (await pool.query<{ id: number }>(
      `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
       VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [archaeology],
    )).rows[0].id;
    const state = async () => (await pool.query<{ lon: number; pointer: number | null }>(
      `SELECT ST_X(e.location) AS lon, m.pending_change_sync_log_id AS pointer
         FROM experiences e JOIN experience_kind_memberships m ON m.experience_id = e.id AND m.source_id = $2
        WHERE e.id = $1`,
      [created.experienceId, archaeology],
    )).rows[0];
    try {
      // 180 km east: the Danube Limes' anchor moving from Linz to Carnuntum.
      await upsertExperienceRecord(
        { ...params(archaeology, NEW_SITE_QID, 'A new site'), lon: 4.78, locationIsAnchor: true }, { syncLogId: log },
      );
      expect(await state()).toEqual({ lon: 4.78, pointer: null });

      await upsertExperienceRecord(
        { ...params(archaeology, NEW_SITE_QID, 'A new site'), lon: 5.5 }, { syncLogId: log },
      );
      expect(await state()).toEqual({ lon: 4.78, pointer: log });
    } finally {
      await pool.query('UPDATE experience_kind_memberships SET pending_change_sync_log_id = NULL WHERE experience_id = $1', [created.experienceId]);
      await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = $1', [log]);
      await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [log]);
    }
  });
});

describe('a rewrite a visitor would not notice passes the gate (#1353)', () => {
  // Wood Buffalo National Park's picture credit as Commons now reads it, and the
  // Danube Limes' area re-measured: on a place readers see, under a gated source.
  const PICTURE = 'https://commons.wikimedia.org/wiki/Special:FilePath/Wood_Buffalo_fixture.jpg';
  const OLD_CREDIT = { author: 'No machine-readable author provided. Ansgar Walk', license: 'CC BY-SA 2.5' };
  const NEW_CREDIT = { author: 'Ansgar Walk', license: 'CC BY-SA 2.5' };
  const site = (metadata: Record<string, unknown>, imageUrl = PICTURE) => ({
    ...params(archaeology, NEW_SITE_QID, 'A new site'), imageUrl, metadata: { wikidataQid: NEW_SITE_QID, ...metadata },
  });

  it('writes a credit re-read for the same file and an area moved under a tenth, and asks about the rest', async () => {
    const created = await upsertExperienceRecord(site({ imageCredit: OLD_CREDIT, areaHectares: 821.7474 }));
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const log = (await pool.query<{ id: number }>(
      `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
       VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [archaeology],
    )).rows[0].id;
    const state = async () => (await pool.query<{ metadata: Record<string, unknown>; pointer: number | null; state: string }>(
      `SELECT e.metadata, m.pending_change_sync_log_id AS pointer, m.curation_state AS state
         FROM experiences e JOIN experience_kind_memberships m ON m.experience_id = e.id AND m.source_id = $2
        WHERE e.id = $1`,
      [created.experienceId, archaeology],
    )).rows[0];
    try {
      const passed = await upsertExperienceRecord(site({ imageCredit: NEW_CREDIT, areaHectares: 821.748 }), { syncLogId: log });

      expect(passed.changeSet.heldFields).toEqual([]);
      expect(passed.changeSet.changedFields.map(f => [f.field, f.passedTheGate])).toEqual([
        ['metadata.areaHectares', 'remeasured'], ['metadata.imageCredit', 'same-file-credit'],
      ]);
      // Written, no question raised, and the curator's pass still stands.
      expect(await state()).toMatchObject({
        metadata: expect.objectContaining({ imageCredit: NEW_CREDIT, areaHectares: 821.748 }), pointer: null, state: 'verified',
      });

      // Moved by more than a tenth — the Brú na Bóinne's 770 → 796 is not, this is: asked.
      const held = await upsertExperienceRecord(site({ imageCredit: NEW_CREDIT, areaHectares: 1000 }), { syncLogId: log });
      expect(held.changeSet.heldFields.map(f => f.field)).toEqual(['metadata.areaHectares']);
      expect(await state()).toMatchObject({ metadata: expect.objectContaining({ areaHectares: 821.748 }), pointer: log });
    } finally {
      await pool.query('UPDATE experience_kind_memberships SET pending_change_sync_log_id = NULL WHERE experience_id = $1', [created.experienceId]);
      await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = $1', [log]);
      await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [log]);
    }
  });

  it('asks about a credit that changed its licence, and one beside another picture', async () => {
    const created = await upsertExperienceRecord(site({ imageCredit: OLD_CREDIT }));
    await pool.query(
      `UPDATE experience_kind_memberships SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const relicensed = await upsertExperienceRecord(site({ imageCredit: { ...NEW_CREDIT, license: 'CC BY-SA 4.0' } }));
    expect(relicensed.changeSet.heldFields.map(f => f.field)).toEqual(['metadata.imageCredit']);
    const another = await upsertExperienceRecord(site({ imageCredit: NEW_CREDIT }, `${PICTURE.replace('fixture', 'other')}`));
    expect(another.changeSet.heldFields.map(f => f.field)).toEqual(['imageUrl', 'metadata.imageCredit']);
  });
});

describe('a claim on a major metadata key (#727, ADR-0077 decision 2)', () => {
  it('keeps the curator\'s flag and records it as theirs, while an unclaimed key follows the source', async () => {
    const site = (metadata: Record<string, unknown>) => ({
      ...params(archaeology, NEW_SITE_QID, 'A new site'), metadata: { wikidataQid: NEW_SITE_QID, ...metadata },
    });
    // Created by the run, so its membership is still unread and the gate holds
    // nothing: the write takes the arm that re-applies claimed keys.
    const created = await upsertExperienceRecord(site({ inDanger: false, website: 'https://old.example' }));
    await pool.query(
      `UPDATE experiences
          SET metadata = metadata || '{"inDanger": true}'::jsonb,
              curated_fields = '["metadata.inDanger"]'::jsonb
        WHERE id = $1`,
      [created.experienceId],
    );

    const outcome = await upsertExperienceRecord(site({ inDanger: false, website: 'https://new.example' }));

    const stored = await pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM experiences WHERE id = $1', [created.experienceId],
    );
    expect(stored.rows[0].metadata).toMatchObject({ inDanger: true, website: 'https://new.example' });
    // The record says what the write did: the flag is the curator's, the link applied.
    expect(outcome.changeSet.heldFields).toEqual([]);
    expect(outcome.changeSet.curatedConflicts.map(f => f.field)).toEqual(['metadata.inDanger']);
    expect(outcome.changeSet.changedFields.map(f => f.field)).toEqual(['metadata.website']);
  });
});

describe('a field another family of sources brings (ADR-0109, #1534)', () => {
  const UNESCO_FACTS = { dateInscribed: '1987', inDanger: false, criteria: '(i)(ii)(iii)(iv)(vi)', region: 'Europe and North America' };
  const UNESCO_NAMES = { en: 'Acropolis, Athens', fr: "Acropole d'Athènes", ru: 'Афинский Акрополь' };
  const UNESCO_TEXT = 'The Acropolis of Athens and its monuments are universal symbols of the classical spirit.';

  beforeEach(async () => {
    const unesco = await sourceNamed('UNESCO World Heritage Sites');
    const arch = await sourceNamed('Archaeology');
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, name_local, short_description, country_codes, country_names, metadata, location)
       VALUES ($1, $2, $3, 'Acropolis, Athens', $4, $5, '{GR}', '{Greece}', $6, ST_SetSRID(ST_MakePoint(23.7262, 37.9715), 4326))`,
      [ACROPOLIS, unesco.id, ACROPOLIS_WHC, JSON.stringify(UNESCO_NAMES), UNESCO_TEXT,
        JSON.stringify({ ...UNESCO_FACTS, wikidataQid: ACROPOLIS_QID, wikidataClasses: ['Q570116'] })],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships
         (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW()), ($1, $5, $6, $7, 'auto', NOW())`,
      [ACROPOLIS, unesco.kind_id, unesco.id, ACROPOLIS_WHC, arch.kind_id, arch.id, ACROPOLIS_QID],
    );
  });

  const stored = async () => (await pool.query<{
    name_local: Record<string, string>; short_description: string | null; country_codes: string[];
    country_names: string[]; metadata: Record<string, unknown>;
  }>('SELECT name_local, short_description, country_codes, country_names, metadata FROM experiences WHERE id = $1', [ACROPOLIS])).rows[0];
  const proposed = (outcome: Awaited<ReturnType<typeof upsertExperienceRecord>>) =>
    [...outcome.changeSet.changedFields, ...outcome.changeSet.heldFields].map(f => f.field);

  it('is neither written nor proposed by an Archaeology run on a World Heritage site', async () => {
    const outcome = await upsertExperienceRecord({
      ...params(archaeology, ACROPOLIS_QID, 'Acropolis, Athens'),
      nameLocal: { en: 'Acropolis of Athens' },
      countryCodes: [],
      lon: 23.7262,
      lat: 37.9715,
      metadata: { wikidataQid: ACROPOLIS_QID, wikidataClasses: ['Q570116', 'Q839954'] },
    });

    expect(await stored()).toMatchObject({
      name_local: UNESCO_NAMES, short_description: UNESCO_TEXT, country_codes: ['GR'], country_names: ['Greece'],
      metadata: { ...UNESCO_FACTS, wikidataClasses: ['Q570116', 'Q839954'] },
    });
    expect(proposed(outcome)).not.toEqual(expect.arrayContaining(['nameLocal.fr']));
    // The Archaeology record names the country 'France' (the fixture's default): UNESCO's 'Greece' stands (#1553).
    for (const field of ['shortDescription', 'countryCodes', 'countryNames', 'metadata.dateInscribed', 'metadata.inDanger', 'metadata.criteria', 'metadata.region']) {
      expect(proposed(outcome)).not.toContain(field);
    }
  });

  it('is neither written nor proposed by a UNESCO run, the other way round', async () => {
    const unesco = await sourceNamed('UNESCO World Heritage Sites');
    await upsertExperienceRecord({
      ...params(unesco.id, ACROPOLIS_WHC, 'Acropolis, Athens'),
      nameLocal: UNESCO_NAMES,
      shortDescription: UNESCO_TEXT,
      countryCodes: ['GR'],
      lon: 23.7262,
      lat: 37.9715,
      metadata: { ...UNESCO_FACTS, dateInscribed: '1987' },
    });

    expect((await stored()).metadata).toMatchObject({ wikidataQid: ACROPOLIS_QID, wikidataClasses: ['Q570116'] });
  });

  it('follows the run again, through the gate, once the other family no longer lists the place', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET missing_since = NOW() WHERE experience_id = $1 AND external_id = $2`,
      [ACROPOLIS, ACROPOLIS_WHC],
    );
    const outcome = await upsertExperienceRecord({
      ...params(archaeology, ACROPOLIS_QID, 'Acropolis, Athens'),
      countryCodes: [],
      lon: 23.7262,
      lat: 37.9715,
      metadata: { wikidataQid: ACROPOLIS_QID },
    });

    // The place readers see is behind Archaeology's gate: the run's view is a proposal again.
    expect(proposed(outcome)).toEqual(expect.arrayContaining(['metadata.dateInscribed', 'countryCodes']));
  });
});
