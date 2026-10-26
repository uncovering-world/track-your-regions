import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * A place whose label another place of the catalogue carries is named apart,
 * decided over the catalogue rather than over one run's batch (#1967),
 * executed against PostgreSQL: whether a twin stands is asked in SQL.
 *
 * The fixture is the Soviet War Memorial in Treptower Park (Q48441), which
 * Public art and Monuments & memorials both admit, and its twin in the
 * Tiergarten (Q32660126), which only Monuments & memorials admits. Ids and
 * external ids are the fixture's own, deleted before and after.
 */

const TREPTOWER = 9481;
const TIERGARTEN = 9482;
const TREPTOWER_ID = 'Q48441-twin-fixture';
const TIERGARTEN_ID = 'Q32660126-twin-fixture';
const LABEL = 'Soviet War Memorial';
const NAMED_APART = "Soviet War Memorial (Berlin's Treptower Park)";

let publicArt = 0;
let monuments = 0;
let worship = 0;

const record = (sourceId: number, overrides: Partial<ExperienceUpsertParams> = {}): ExperienceUpsertParams => ({
  sourceId,
  externalId: TREPTOWER_ID,
  name: LABEL,
  nameLocal: { en: LABEL },
  subtitle: "memorial in Berlin's Treptower Park",
  description: null,
  type: null,
  tags: [],
  lon: 13.4697,
  lat: 52.4866,
  countryCodes: [],
  countryNames: [],
  imageUrl: null,
  metadata: {},
  ...overrides,
});

async function name(id: number): Promise<string> {
  return (await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [id])).rows[0].name;
}

async function views(id: number): Promise<{ name: string; label: string }[]> {
  const result = await pool.query<{ name: string; label: string }>(
    `SELECT reported_name AS name, reported_label AS label
       FROM experience_kind_memberships WHERE experience_id = $1 ORDER BY source_id`,
    [id],
  );
  return result.rows;
}

async function clear(): Promise<void> {
  await pool.query(
    'DELETE FROM experiences WHERE id = ANY($1::int[]) OR external_id = ANY($2::text[])',
    [[TREPTOWER, TIERGARTEN], [TREPTOWER_ID, TIERGARTEN_ID]],
  );
}

/**
 * A place named `name` under `sources`, each membership keyed by `externalId`
 * and reporting the bare label, published or waiting as `state` says. Under
 * a gated source a published place's rename is a held proposal, which
 * `renames` reads as a rename all the same (`heldFields`).
 */
async function seed(
  id: number, externalId: string, sources: number[], name: string, state: 'auto' | 'pending' = 'auto',
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(13.37, 52.51), 4326))`,
    [id, sources[0], externalId, name],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, curation_state, published_at, reported_name, reported_label)
     SELECT $1, s.kind_id, s.id, $2, $5::text, CASE WHEN $5::text = 'auto' THEN NOW() END, $4, $6
       FROM experience_sources s WHERE s.id = ANY($3::int[])`,
    [id, externalId, sources, name, state, LABEL],
  );
}

/** Whether the run wrote or proposed a change of the place's name. */
const renames = (outcome: Awaited<ReturnType<typeof upsertExperienceRecord>>): boolean =>
  [...outcome.changeSet.changedFields, ...outcome.changeSet.heldFields].some(field => field.field === 'name');

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM experience_sources WHERE name IN ('Public art', 'Monuments & memorials', 'Places of worship')`,
  );
  publicArt = sources.rows.find(row => row.name === 'Public art')!.id;
  monuments = sources.rows.find(row => row.name === 'Monuments & memorials')!.id;
  worship = sources.rows.find(row => row.name === 'Places of worship')!.id;
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a twin is named apart across the catalogue (#1967)', () => {
  it('names the Treptower Park memorial alike in both kinds, though only one admits its twin', async () => {
    await seed(TREPTOWER, TREPTOWER_ID, [publicArt, monuments], NAMED_APART);
    await seed(TIERGARTEN, TIERGARTEN_ID, [monuments], LABEL);

    const publicArtRun = await upsertExperienceRecord(record(publicArt));
    const monumentsRun = await upsertExperienceRecord(record(monuments));

    expect(await name(TREPTOWER)).toBe(NAMED_APART);
    expect(await views(TREPTOWER)).toEqual([
      { name: NAMED_APART, label: LABEL },
      { name: NAMED_APART, label: LABEL },
    ]);
    expect(renames(monumentsRun)).toBe(false);
    expect(renames(publicArtRun)).toBe(false);
  });

  it('keeps the label bare once its twin leaves the catalogue', async () => {
    await seed(TREPTOWER, TREPTOWER_ID, [publicArt, monuments], NAMED_APART, 'pending');
    await seed(TIERGARTEN, TIERGARTEN_ID, [monuments], LABEL);
    await pool.query(
      "UPDATE experience_kind_memberships SET admission = 'refused' WHERE experience_id = $1", [TIERGARTEN],
    );

    await upsertExperienceRecord(record(publicArt));
    await upsertExperienceRecord(record(monuments));

    expect(await name(TREPTOWER)).toBe(LABEL);
  });

  it('keeps the label bare once the source of its twin says it no longer lists it', async () => {
    await seed(TREPTOWER, TREPTOWER_ID, [publicArt, monuments], NAMED_APART, 'pending');
    await seed(TIERGARTEN, TIERGARTEN_ID, [monuments], LABEL);
    await pool.query(
      "UPDATE experience_kind_memberships SET source_membership = 'former' WHERE experience_id = $1", [TIERGARTEN],
    );

    await upsertExperienceRecord(record(monuments));

    expect(await name(TREPTOWER)).toBe(LABEL);
  });

  it('names a place two groups of sources share alike, however each describes it', async () => {
    // A Monuments & memorials place that Places of worship also admits, and a
    // twin of its label that only Public art holds.
    await seed(TREPTOWER, TREPTOWER_ID, [monuments, worship], NAMED_APART);
    await seed(TIERGARTEN, TIERGARTEN_ID, [publicArt], LABEL);

    // Places of worship describes it with no place to read a hint from: the
    // place's hint is the one Monuments & memorials reported.
    const monumentsRun = await upsertExperienceRecord(record(monuments));
    const worshipRun = await upsertExperienceRecord(record(worship, { subtitle: 'memorial church' }));

    expect(await name(TREPTOWER)).toBe(NAMED_APART);
    expect(await views(TREPTOWER)).toEqual([
      { name: NAMED_APART, label: LABEL },
      { name: NAMED_APART, label: LABEL },
    ]);
    expect(renames(monumentsRun)).toBe(false);
    expect(renames(worshipRun)).toBe(false);
  });

  it('names a new arrival apart from the twin the catalogue already holds', async () => {
    await seed(TIERGARTEN, TIERGARTEN_ID, [monuments], LABEL);

    const outcome = await upsertExperienceRecord(record(monuments));

    expect(await name(outcome.experienceId!)).toBe(NAMED_APART);
  });
});
