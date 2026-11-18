import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';
import { markNotAdmitted, markRefused } from './admission.js';

/**
 * Why a run admitted a place, on its membership (#2184, ADR-0225), executed
 * against PostgreSQL: the run's upsert writes the record into
 * `source_records.admission_evidence` every run, never among the kind's facts,
 * and the admission step clears it where the run refuses the place.
 *
 * The fixture is the Louvre in two kinds, Art Museums and Archaeology, each
 * membership the run's own. Ids are the fixture's own, deleted before and after.
 */

const LOUVRE = 9620;
const LOUVRE_QID = 'Q9620001';

const BY_EDITIONS = { tier: 'world', decided: 'editions', place: { editions: 180 }, reference: { kind: 'needed', editions: 22 } } as const;

let artMuseums = 0;
let archaeology = 0;

const params = (sourceId: number): ExperienceUpsertParams => ({
  sourceId,
  externalId: LOUVRE_QID,
  name: 'Louvre Museum',
  nameLocal: { en: 'Louvre Museum' },
  subtitle: null,
  description: null,
  type: null,
  tags: [],
  lon: 2.3376,
  lat: 48.8606,
  countryCodes: ['FR'],
  countryNames: ['France'],
  imageUrl: null,
  metadata: { wikidataQid: LOUVRE_QID },
});

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [LOUVRE, LOUVRE_QID]);
}

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  const result = await pool.query<{ id: number; kind_id: number }>('SELECT id, kind_id FROM experience_sources WHERE name = $1', [name]);
  return result.rows[0];
}

async function evidenceOf(sourceId: number): Promise<{ admission_evidence: unknown; facts: Record<string, unknown> }> {
  const result = await pool.query<{ admission_evidence: unknown; facts: Record<string, unknown> }>(
    'SELECT admission_evidence, facts FROM source_records WHERE experience_id = $1 AND source_id = $2', [LOUVRE, sourceId],
  );
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
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW()), ($1, $5, $6, $4, 'auto', NOW())`,
    [LOUVRE, art.kind_id, artMuseums, LOUVRE_QID, arch.kind_id, archaeology],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('why a run admitted the place, on its membership (#2184, ADR-0225)', () => {
  it('is written on the run\'s own membership, never among its facts, and every run writes it again', async () => {
    await upsertExperienceRecord({ ...params(artMuseums), admissionEvidence: BY_EDITIONS });
    const written = await evidenceOf(artMuseums);
    expect(written.admission_evidence).toEqual(BY_EDITIONS);
    expect(written.facts).not.toHaveProperty('admission');
    // The other kind's membership of the place holds none.
    expect((await evidenceOf(archaeology)).admission_evidence).toBeNull();

    // A run whose path keeps no record clears the last one's.
    await upsertExperienceRecord(params(artMuseums));
    expect((await evidenceOf(artMuseums)).admission_evidence).toBeNull();
  });

  it('is cleared where the run refuses the place, by name or by not naming it', async () => {
    await pool.query('UPDATE source_records SET admission_evidence = $2::jsonb WHERE experience_id = $1', [LOUVRE, JSON.stringify(BY_EDITIONS)]);
    await markRefused(artMuseums, [{ externalId: LOUVRE_QID, reason: 'not an art museum' }], false);
    expect((await evidenceOf(artMuseums)).admission_evidence).toBeNull();
    await markNotAdmitted(archaeology, ['some-other-site'], 'not in the admitted set', false);
    expect((await evidenceOf(archaeology)).admission_evidence).toBeNull();
  });

  it('stays where a dry run only reads what it would refuse', async () => {
    await pool.query('UPDATE source_records SET admission_evidence = $2::jsonb WHERE experience_id = $1', [LOUVRE, JSON.stringify(BY_EDITIONS)]);
    await markRefused(artMuseums, [{ externalId: LOUVRE_QID, reason: 'not an art museum' }], true);
    expect((await evidenceOf(artMuseums)).admission_evidence).toEqual(BY_EDITIONS);
  });
});
