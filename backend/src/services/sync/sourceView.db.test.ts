import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * Each source records its view of a place, and a field another source of the
 * place contradicts is no proposal of the run's (#1246, ADR-0084), executed
 * against PostgreSQL: which views disagree is decided in SQL.
 *
 * The fixture is the Dome of the Rock as Epic #755 will leave it: one place
 * that Places of worship and Archaeology both fill, under one Wikidata item.
 * The two sources report different photographs of it on the development
 * catalogue today (an Arabic-titled file and a 2016 photograph from the Temple
 * Mount); the file names below are the fixture's own. Ids are the fixture's
 * own, deleted before and after.
 */

const DOME = 9480;
const QID = 'Q9480-dome-fixture';
const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const WORSHIP_PICTURE = `${COMMONS}Dome-fixture-worship.jpg`;
const ARCHAEOLOGY_PICTURE = `${COMMONS}Dome-fixture-archaeology.jpg`;
const CREDIT = { artist: 'Fixture photographer', license: 'CC BY-SA 4.0' };

let worship = 0;
let archaeology = 0;

const params = (sourceId: number, overrides: Partial<ExperienceUpsertParams> = {}): ExperienceUpsertParams => ({
  sourceId,
  externalId: QID,
  name: 'Dome of the Rock',
  nameLocal: { en: 'Dome of the Rock' },
  description: 'Islamic shrine on the Temple Mount',
  shortDescription: null,
  type: null,
  tags: [],
  lon: 35.2353,
  lat: 31.7781,
  countryCodes: [],
  countryNames: [],
  imageUrl: WORSHIP_PICTURE,
  metadata: { wikidataQid: QID, imageCredit: CREDIT },
  ...overrides,
});

async function place(): Promise<{ name: string; description: string; image_url: string; credit: unknown; lon: number }> {
  const result = await pool.query(
    `SELECT name, description, image_url, metadata->'imageCredit' AS credit, ST_X(location) AS lon
       FROM experiences WHERE id = $1`,
    [DOME],
  );
  return result.rows[0];
}

async function views(): Promise<Record<number, { name: string; image: string; lon: number }>> {
  const result = await pool.query<{ source_id: number; name: string; image: string; lon: number }>(
    `SELECT source_id, reported_name AS name, reported_image_url AS image, ST_X(reported_location) AS lon
       FROM experience_kind_memberships WHERE experience_id = $1`,
    [DOME],
  );
  return Object.fromEntries(result.rows.map(row => [row.source_id, { name: row.name, image: row.image, lon: row.lon }]));
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [DOME, QID]);
}

/** The place, with both memberships, as `state` says a reader may see it. */
async function seed(state: 'pending' | 'auto'): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Dome of the Rock', ST_SetSRID(ST_MakePoint(35.2353, 31.7781), 4326))`,
    [DOME, worship, QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, $2, $3::text, CASE WHEN $3::text = 'auto' THEN NOW() END
       FROM experience_sources s WHERE s.id = ANY($4::int[])`,
    [DOME, QID, state, [worship, archaeology]],
  );
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM experience_sources WHERE name IN ('Places of worship', 'Archaeology')`,
  );
  worship = sources.rows.find(row => row.name === 'Places of worship')!.id;
  archaeology = sources.rows.find(row => row.name === 'Archaeology')!.id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a source\'s view of a place (ADR-0084)', () => {
  it('records each source\'s view on its own membership, whatever the place keeps', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(archaeology, { imageUrl: ARCHAEOLOGY_PICTURE }));

    const recorded = await views();
    expect(recorded[worship].image).toBe(WORSHIP_PICTURE);
    expect(recorded[archaeology].image).toBe(ARCHAEOLOGY_PICTURE);
    expect(recorded[archaeology].name).toBe('Dome of the Rock');
  });

  it('keeps the place\'s picture and its credit where another source reports a different one', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));

    const outcome = await upsertExperienceRecord(params(archaeology, {
      imageUrl: ARCHAEOLOGY_PICTURE,
      metadata: { wikidataQid: QID, imageCredit: { artist: 'Someone else', license: 'CC BY 4.0' } },
    }));

    const stored = await place();
    expect(stored.image_url).toBe(WORSHIP_PICTURE);
    expect(stored.credit).toEqual(CREDIT);
    // No proposal: the disagreement is the queue's, not a change this run made or held.
    expect(outcome.changeSet.changedFields).toEqual([]);
    expect(outcome.changeSet.heldFields).toEqual([]);
  });

  it('writes a field no other source contradicts, beside one another source does', async () => {
    await seed('pending');
    // Places of worship reports no description, so nobody contradicts Archaeology's.
    await upsertExperienceRecord(params(worship, { description: null }));

    await upsertExperienceRecord(params(archaeology, {
      imageUrl: ARCHAEOLOGY_PICTURE,
      description: 'Shrine built by the Umayyads in 691-692',
    }));

    const stored = await place();
    expect(stored.image_url).toBe(WORSHIP_PICTURE);
    expect(stored.description).toBe('Shrine built by the Umayyads in 691-692');
  });

  it('reads a changed value the other source has not read yet as a disagreement, until it has', async () => {
    // Both sources read one Wikidata item, so an edit there reaches whichever
    // run comes first: the card stands until the other source's run brings the
    // same value, and then the value is written.
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(archaeology));

    await upsertExperienceRecord(params(worship, { description: 'Shrine built by the Umayyads in 691-692' }));
    expect((await place()).description).toBe('Islamic shrine on the Temple Mount');

    await upsertExperienceRecord(params(archaeology, { description: 'Shrine built by the Umayyads in 691-692' }));
    expect((await place()).description).toBe('Shrine built by the Umayyads in 691-692');
  });

  it('writes the value once the other source agrees with it', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(archaeology, { imageUrl: ARCHAEOLOGY_PICTURE }));

    await upsertExperienceRecord(params(worship, { imageUrl: ARCHAEOLOGY_PICTURE }));

    expect((await place()).image_url).toBe(ARCHAEOLOGY_PICTURE);
  });

  it('reads a source with no picture as no disagreement, and its next run takes nothing away', async () => {
    await seed('pending');
    const noPicture = { imageUrl: null, metadata: { wikidataQid: QID } };
    await upsertExperienceRecord(params(worship, noPicture));

    await upsertExperienceRecord(params(archaeology, { imageUrl: ARCHAEOLOGY_PICTURE }));
    expect((await place()).image_url).toBe(ARCHAEOLOGY_PICTURE);

    const outcome = await upsertExperienceRecord(params(worship, noPicture));
    const stored = await place();
    expect(stored.image_url).toBe(ARCHAEOLOGY_PICTURE);
    expect(stored.credit).toEqual(CREDIT);
    expect(outcome.changeSet.changedFields).toEqual([]);
  });

  it('reads two coordinates within ten metres as one, and further apart as a disagreement', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));

    // About 5 m east: the same place, written more precisely.
    await upsertExperienceRecord(params(archaeology, { lon: 35.23535 }));
    expect((await place()).lon).toBeCloseTo(35.23535, 6);

    // About 750 m east, the distance between Wikidata's two coordinates for the Cave of Altamira.
    await upsertExperienceRecord(params(archaeology, { lon: 35.2433 }));
    expect((await place()).lon).toBeCloseTo(35.23535, 6);
  });

  it('ignores the view of a source that stopped listing the place', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await pool.query(
      `UPDATE experience_kind_memberships SET missing_since = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [DOME, worship],
    );

    await upsertExperienceRecord(params(archaeology, { imageUrl: ARCHAEOLOGY_PICTURE }));

    expect((await place()).image_url).toBe(ARCHAEOLOGY_PICTURE);
  });

  it('holds what nobody contradicts on a place a reader sees, and holds nothing contested', async () => {
    await seed('auto');
    // A trusted write of the starting state, so the gate has something to protect.
    await pool.query(
      `UPDATE experiences SET image_url = $2, description = 'Islamic shrine on the Temple Mount',
              name_local = '{"en": "Dome of the Rock"}'::jsonb,
              metadata = jsonb_build_object('wikidataQid', $4::text, 'imageCredit', $3::jsonb)
        WHERE id = $1`,
      [DOME, WORSHIP_PICTURE, JSON.stringify(CREDIT), QID],
    );
    await pool.query(
      `UPDATE experience_kind_memberships SET reported_image_url = $2
        WHERE experience_id = $1 AND source_id = $3`,
      [DOME, WORSHIP_PICTURE, worship],
    );

    const outcome = await upsertExperienceRecord(params(archaeology, {
      imageUrl: ARCHAEOLOGY_PICTURE,
      description: 'Shrine built by the Umayyads in 691-692',
    }));

    expect(outcome.changeSet.heldFields.map(field => field.field)).toEqual(['description']);
    expect((await place()).image_url).toBe(WORSHIP_PICTURE);
  });
});
