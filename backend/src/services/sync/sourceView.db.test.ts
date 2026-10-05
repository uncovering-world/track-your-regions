import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * Each source records its view of a place, and a field another source of the
 * place contradicts is no proposal of the run's (#1246, ADR-0084), executed
 * against PostgreSQL: which views disagree is decided in SQL.
 *
 * The fixture is Cologne Cathedral as the World Heritage merge (#1248) will
 * leave it: one place that Places of worship knows by a Wikidata item (Q4176)
 * and UNESCO World Heritage Sites by its own id (292) — two different data
 * sources, whose views of a field can genuinely differ. Two sources that know a
 * place by one item never contest it, which the last case states. Ids, items
 * and file names are the fixture's own, deleted before and after.
 */

const CATHEDRAL = 9480;
const QID = 'Q9480-cologne-fixture';
const WHC = '9480-whc-fixture';
const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const WORSHIP_PICTURE = `${COMMONS}Cologne-fixture-worship.jpg`;
const UNESCO_PICTURE = `${COMMONS}Cologne-fixture-unesco.jpg`;
const CREDIT = { artist: 'Fixture photographer', license: 'CC BY-SA 4.0' };

let worship = 0;
let unesco = 0;

const params = (sourceId: number, overrides: Partial<ExperienceUpsertParams> = {}): ExperienceUpsertParams => ({
  sourceId,
  externalId: sourceId === unesco ? WHC : QID,
  name: 'Cologne Cathedral',
  nameLocal: { en: 'Cologne Cathedral' },
  description: 'Gothic cathedral in Cologne',
  shortDescription: null,
  type: null,
  tags: [],
  lon: 6.9583,
  lat: 50.9413,
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
    [CATHEDRAL],
  );
  return result.rows[0];
}

async function views(): Promise<Record<number, { name: string; image: string; lon: number }>> {
  const result = await pool.query<{ source_id: number; name: string; image: string; lon: number }>(
    `SELECT source_id, reported_name AS name, reported_image_url AS image, ST_X(reported_location) AS lon
       FROM experience_kind_memberships WHERE experience_id = $1`,
    [CATHEDRAL],
  );
  return Object.fromEntries(result.rows.map(row => [row.source_id, { name: row.name, image: row.image, lon: row.lon }]));
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = ANY($2::text[])', [CATHEDRAL, [QID, WHC]]);
}

/** The place, with both memberships, as `state` says a reader may see it. */
async function seed(state: 'pending' | 'auto'): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Cologne Cathedral', ST_SetSRID(ST_MakePoint(6.9583, 50.9413), 4326))`,
    [CATHEDRAL, worship, QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, CASE WHEN s.id = $5 THEN $6 ELSE $2 END,
            $3::text, CASE WHEN $3::text = 'auto' THEN NOW() END
       FROM experience_sources s WHERE s.id = ANY($4::int[])`,
    [CATHEDRAL, QID, state, [worship, unesco], unesco, WHC],
  );
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM experience_sources WHERE name IN ('Places of worship', 'UNESCO World Heritage Sites')`,
  );
  worship = sources.rows.find(row => row.name === 'Places of worship')!.id;
  unesco = sources.rows.find(row => row.name === 'UNESCO World Heritage Sites')!.id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a source\'s view of a place (ADR-0084)', () => {
  it('records each source\'s view on its own membership, whatever the place keeps', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(unesco, { imageUrl: UNESCO_PICTURE }));

    const recorded = await views();
    expect(recorded[worship].image).toBe(WORSHIP_PICTURE);
    expect(recorded[unesco].image).toBe(UNESCO_PICTURE);
    expect(recorded[unesco].name).toBe('Cologne Cathedral');
  });

  it('keeps the place\'s picture and its credit where another source reports a different one', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));

    const outcome = await upsertExperienceRecord(params(unesco, {
      imageUrl: UNESCO_PICTURE,
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
    // Places of worship reports no description, so nobody contradicts UNESCO's.
    await upsertExperienceRecord(params(worship, { description: null }));

    await upsertExperienceRecord(params(unesco, {
      imageUrl: UNESCO_PICTURE,
      description: 'Cathedral begun in 1248 and finished in 1880',
    }));

    const stored = await place();
    expect(stored.image_url).toBe(WORSHIP_PICTURE);
    expect(stored.description).toBe('Cathedral begun in 1248 and finished in 1880');
  });

  it('reads a changed value the other source has not read yet as a disagreement, until it has', async () => {
    // Two data sources: a new description from one stands contested until the
    // other brings the same value, and then it is written.
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(unesco));

    await upsertExperienceRecord(params(worship, { description: 'Cathedral begun in 1248 and finished in 1880' }));
    expect((await place()).description).toBe('Gothic cathedral in Cologne');

    await upsertExperienceRecord(params(unesco, { description: 'Cathedral begun in 1248 and finished in 1880' }));
    expect((await place()).description).toBe('Cathedral begun in 1248 and finished in 1880');
  });

  it('writes the value once the other source agrees with it', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(unesco, { imageUrl: UNESCO_PICTURE }));

    await upsertExperienceRecord(params(worship, { imageUrl: UNESCO_PICTURE }));

    expect((await place()).image_url).toBe(UNESCO_PICTURE);
  });

  it('reads a source with no picture as no disagreement, and its next run takes nothing away', async () => {
    await seed('pending');
    const noPicture = { imageUrl: null, metadata: { wikidataQid: QID } };
    await upsertExperienceRecord(params(worship, noPicture));

    await upsertExperienceRecord(params(unesco, { imageUrl: UNESCO_PICTURE }));
    expect((await place()).image_url).toBe(UNESCO_PICTURE);

    const outcome = await upsertExperienceRecord(params(worship, noPicture));
    const stored = await place();
    expect(stored.image_url).toBe(UNESCO_PICTURE);
    expect(stored.credit).toEqual(CREDIT);
    expect(outcome.changeSet.changedFields).toEqual([]);
  });

  it('reads two coordinates within ten metres as one, and further apart as a disagreement', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));

    // About 4 m east: the same place, written more precisely.
    await upsertExperienceRecord(params(unesco, { lon: 6.95835 }));
    expect((await place()).lon).toBeCloseTo(6.95835, 6);

    // About 770 m east: a different place.
    await upsertExperienceRecord(params(unesco, { lon: 6.9693 }));
    expect((await place()).lon).toBeCloseTo(6.95835, 6);
  });

  it('ignores the view of a source that stopped listing the place', async () => {
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await pool.query(
      `UPDATE experience_kind_memberships SET missing_since = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [CATHEDRAL, worship],
    );

    await upsertExperienceRecord(params(unesco, { imageUrl: UNESCO_PICTURE }));

    expect((await place()).image_url).toBe(UNESCO_PICTURE);
  });

  it('lets two sources that know the place by one Wikidata item write the newer reading, and asks nothing', async () => {
    // Both memberships under the one item: a second Wikidata source beside Places of worship.
    await seed('pending');
    await pool.query('UPDATE experience_kind_memberships SET external_id = $2 WHERE experience_id = $1', [CATHEDRAL, QID]);
    await upsertExperienceRecord({ ...params(worship), externalId: QID });

    const outcome = await upsertExperienceRecord({ ...params(unesco), externalId: QID, imageUrl: UNESCO_PICTURE });

    expect((await place()).image_url).toBe(UNESCO_PICTURE);
    expect(outcome.changeSet.changedFields.map(field => field.field)).toContain('imageUrl');
  });

  it('holds what nobody contradicts on a place a reader sees, and holds nothing contested', async () => {
    await seed('auto');
    // A trusted write of the starting state, so the gate has something to protect.
    await pool.query(
      `UPDATE experiences SET image_url = $2, description = 'Gothic cathedral in Cologne',
              name_local = '{"en": "Cologne Cathedral"}'::jsonb,
              metadata = jsonb_build_object('wikidataQid', $4::text, 'imageCredit', $3::jsonb)
        WHERE id = $1`,
      [CATHEDRAL, WORSHIP_PICTURE, JSON.stringify(CREDIT), QID],
    );
    // UNESCO's view keeps the picture readers see; Places of worship, a gated
    // source, then proposes another picture and a new description.
    await pool.query(
      `UPDATE experience_kind_memberships SET reported_image_url = $2
        WHERE experience_id = $1 AND source_id = $3`,
      [CATHEDRAL, WORSHIP_PICTURE, unesco],
    );

    const outcome = await upsertExperienceRecord(params(worship, {
      imageUrl: UNESCO_PICTURE,
      description: 'Cathedral begun in 1248 and finished in 1880',
    }));

    expect(outcome.changeSet.heldFields.map(field => field.field)).toEqual(['description']);
    expect((await place()).image_url).toBe(WORSHIP_PICTURE);
  });
});
