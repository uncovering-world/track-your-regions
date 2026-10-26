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
  subtitle: 'Gothic cathedral in Cologne',
  description: null,
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

async function place(): Promise<{ name: string; subtitle: string; image_url: string; credit: unknown; lon: number }> {
  const result = await pool.query(
    `SELECT name, subtitle, image_url, metadata->'imageCredit' AS credit, ST_X(location) AS lon
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

/** The place holding the worship picture and its credit, as an earlier run left it. */
async function holdPicture(): Promise<void> {
  await pool.query(
    `UPDATE experiences SET image_url = $2,
            metadata = jsonb_build_object('wikidataQid', $3::text, 'imageCredit', $4::jsonb)
      WHERE id = $1`,
    [CATHEDRAL, WORSHIP_PICTURE, QID, JSON.stringify(CREDIT)],
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
    // No proposal about the picture: the disagreement is the queue's, not a
    // change this run made or held. The official names are UNESCO's own
    // (ADR-0109): the worship run left them, so they arrive with this run.
    expect(outcome.changeSet.changedFields.map(f => f.field)).toEqual(['nameLocal.en']);
    expect(outcome.changeSet.heldFields).toEqual([]);
  });

  it('keeps the place\'s article where another source links a different one, and proposes nothing (#1975)', async () => {
    const cathedral = 'https://en.wikipedia.org/wiki/Cologne_Cathedral';
    const site = 'https://en.wikipedia.org/wiki/Cologne_Cathedral_fixture_site';
    // Unpublished, so the worship run writes its article rather than holding it.
    await seed('pending');
    await upsertExperienceRecord(params(worship, { metadata: { wikidataQid: QID, imageCredit: CREDIT, wikipediaUrl: cathedral } }));

    const outcome = await upsertExperienceRecord(params(unesco, {
      metadata: { wikidataQid: QID, imageCredit: CREDIT, wikipediaUrl: site },
    }));

    const stored = await pool.query<{ article: string; reported: Record<number, string> }>(
      `SELECT e.metadata->>'wikipediaUrl' AS article,
              (SELECT jsonb_object_agg(m.source_id, m.reported_wikipedia_url) FROM experience_kind_memberships m
                WHERE m.experience_id = e.id) AS reported
         FROM experiences e WHERE e.id = $1`,
      [CATHEDRAL],
    );
    expect(stored.rows[0].article).toBe(cathedral);
    expect(stored.rows[0].reported).toEqual({ [worship]: cathedral, [unesco]: site });
    const fields = [...outcome.changeSet.changedFields, ...outcome.changeSet.heldFields].map(f => f.field);
    expect(fields).not.toContain('metadata.wikipediaUrl');
  });

  it('keeps a picture the item still carries, with its credit, and proposes nothing (#1778)', async () => {
    // The place holds one of its item's two pictures and the run chose the other, as
    // every reader keeps the first by URL: the place keeps its picture and the gated
    // run holds nothing about it (ADR-0130).
    await seed('auto');
    await holdPicture();

    const outcome = await upsertExperienceRecord(params(worship, {
      imageUrl: UNESCO_PICTURE,
      itemPictures: [UNESCO_PICTURE, WORSHIP_PICTURE],
      metadata: { wikidataQid: QID, imageCredit: { artist: 'Someone else', license: 'CC BY 4.0' } },
    }));

    const stored = await place();
    expect(stored.image_url).toBe(WORSHIP_PICTURE);
    expect(stored.credit).toEqual(CREDIT);
    expect(outcome.changeSet.changedFields.map(f => f.field)).not.toContain('imageUrl');
    expect(outcome.changeSet.heldFields.map(f => f.field)).not.toContain('imageUrl');
    // The run's own view is still what it chose.
    expect((await views())[worship].image).toBe(UNESCO_PICTURE);
  });

  it('previews the kept picture as the run keeps it (#1778)', async () => {
    await seed('auto');
    await holdPicture();

    const preview = await upsertExperienceRecord(params(worship, {
      imageUrl: UNESCO_PICTURE,
      itemPictures: [UNESCO_PICTURE, WORSHIP_PICTURE],
    }), { dryRun: true });

    const proposed = [...preview.changeSet.changedFields, ...preview.changeSet.heldFields].map(f => f.field);
    expect(proposed).not.toContain('imageUrl');
  });

  it('still takes a picture once the held one left the item (#1778)', async () => {
    await seed('auto');
    await holdPicture();

    const outcome = await upsertExperienceRecord(params(worship, { imageUrl: UNESCO_PICTURE, itemPictures: [UNESCO_PICTURE] }));

    // Proposed as the gate decides, held for a curator or written: a change either way.
    const proposed = [...outcome.changeSet.changedFields, ...outcome.changeSet.heldFields].map(f => f.field);
    expect(proposed).toContain('imageUrl');
  });

  it('writes a field no other source contradicts, beside one another source does', async () => {
    await seed('pending');
    // Places of worship reports no subtitle, so nobody contradicts UNESCO's.
    await upsertExperienceRecord(params(worship, { subtitle: null }));

    await upsertExperienceRecord(params(unesco, {
      imageUrl: UNESCO_PICTURE,
      subtitle: 'Cathedral begun in 1248 and finished in 1880',
    }));

    const stored = await place();
    expect(stored.image_url).toBe(WORSHIP_PICTURE);
    expect(stored.subtitle).toBe('Cathedral begun in 1248 and finished in 1880');
  });

  it('reads a changed value the other source has not read yet as a disagreement, until it has', async () => {
    // Two data sources: a new subtitle from one stands contested until the
    // other brings the same value, and then it is written.
    await seed('pending');
    await upsertExperienceRecord(params(worship));
    await upsertExperienceRecord(params(unesco));

    await upsertExperienceRecord(params(worship, { subtitle: 'Cathedral begun in 1248 and finished in 1880' }));
    expect((await place()).subtitle).toBe('Gothic cathedral in Cologne');

    await upsertExperienceRecord(params(unesco, { subtitle: 'Cathedral begun in 1248 and finished in 1880' }));
    expect((await place()).subtitle).toBe('Cathedral begun in 1248 and finished in 1880');
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
      `UPDATE experiences SET image_url = $2, subtitle = 'Gothic cathedral in Cologne',
              name_local = '{"en": "Cologne Cathedral"}'::jsonb,
              metadata = jsonb_build_object('wikidataQid', $4::text, 'imageCredit', $3::jsonb)
        WHERE id = $1`,
      [CATHEDRAL, WORSHIP_PICTURE, JSON.stringify(CREDIT), QID],
    );
    // UNESCO's view keeps the picture readers see; Places of worship, a gated
    // source, then proposes another picture and a new subtitle.
    await pool.query(
      `UPDATE experience_kind_memberships SET reported_image_url = $2
        WHERE experience_id = $1 AND source_id = $3`,
      [CATHEDRAL, WORSHIP_PICTURE, unesco],
    );

    const outcome = await upsertExperienceRecord(params(worship, {
      imageUrl: UNESCO_PICTURE,
      subtitle: 'Cathedral begun in 1248 and finished in 1880',
    }));

    expect(outcome.changeSet.heldFields.map(field => field.field)).toEqual(['subtitle']);
    expect((await place()).image_url).toBe(WORSHIP_PICTURE);
  });
});
