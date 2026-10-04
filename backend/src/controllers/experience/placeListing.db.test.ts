import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { flagMissingExperiences } from '../../services/sync/missingDetection.js';
import { upsertExperienceRecord } from '../../services/sync/experienceUpsert.js';
import { answerStateUnderLock } from './lifecycleController.js';

/**
 * Whether a source still lists a place is its membership's, and the place's
 * own flags are derived from its memberships (#1251, ADR-0084), executed
 * against PostgreSQL: the derivation is a trigger, which only the database can
 * run.
 *
 * The fixture is the Louvre as Epic #755 will leave it: one place carrying an
 * Art Museums membership and an Archaeology membership under one Wikidata
 * item, and a curator. Ids are the fixture's own, deleted before and after.
 */

const LOUVRE = 9450;
const LOUVRE_QID = 'Q9450-louvre-fixture';
const USER_UUID = '00000000-0000-4000-8000-000000009450';

let artMuseums = 0;
let archaeology = 0;
let userId = 0;

interface Listing { missing: boolean; listing: string }

async function place(): Promise<Listing> {
  const result = await pool.query<Listing>(
    `SELECT missing_since IS NOT NULL AS missing, source_membership AS listing FROM experiences WHERE id = $1`,
    [LOUVRE],
  );
  return result.rows[0];
}

async function membership(sourceId: number): Promise<Listing> {
  const result = await pool.query<Listing>(
    `SELECT missing_since IS NOT NULL AS missing, source_membership AS listing
       FROM experience_kind_memberships WHERE experience_id = $1 AND source_id = $2`,
    [LOUVRE, sourceId],
  );
  return result.rows[0];
}

/**
 * A run of `sourceId` that listed everything it holds but the Louvre: what it
 * saw, so detection marks the fixture alone and no other place in the database.
 */
async function stopListing(sourceId: number) {
  const seen = await pool.query<{ ids: string[] | null }>(
    `SELECT array_agg(external_id) AS ids FROM experience_kind_memberships WHERE source_id = $1 AND external_id <> $2`,
    [sourceId, LOUVRE_QID],
  );
  return flagMissingExperiences(sourceId, 0, false, seen.rows[0].ids ?? []);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [LOUVRE]);
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [LOUVRE, LOUVRE_QID]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

beforeEach(async () => {
  await clear();
  const sources = await pool.query<{ id: number; kind_id: number; name: string }>(
    `SELECT id, kind_id, name FROM experience_sources WHERE name IN ('Art Museums', 'Archaeology')`,
  );
  const art = sources.rows.find(row => row.name === 'Art Museums')!;
  const arch = sources.rows.find(row => row.name === 'Archaeology')!;
  artMuseums = art.id;
  archaeology = arch.id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  );
  userId = user.rows[0].id;
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

describe('whether a source still lists a place (ADR-0084)', () => {
  it('marks only the membership of the source that stopped listing it, and the place stays listed', async () => {
    const flagged = await stopListing(archaeology);

    expect(flagged.filter(change => change.experienceId === LOUVRE)).toHaveLength(1);
    expect(await membership(archaeology)).toEqual({ missing: true, listing: 'present' });
    expect(await membership(artMuseums)).toEqual({ missing: false, listing: 'present' });
    expect(await place()).toEqual({ missing: false, listing: 'present' });
  });

  it('reads the place as missing once every source has stopped listing it', async () => {
    await stopListing(archaeology);
    await stopListing(artMuseums);

    expect(await place()).toEqual({ missing: true, listing: 'present' });
  });

  it('clears only its own mark when a source lists the place again', async () => {
    await stopListing(archaeology);
    await stopListing(artMuseums);

    const outcome = await upsertExperienceRecord({
      sourceId: archaeology, externalId: LOUVRE_QID, name: 'Louvre Museum', nameLocal: { en: 'Louvre Museum' },
      description: null, shortDescription: null, type: null, tags: [], lon: 2.3376, lat: 48.8606,
      countryCodes: ['FR'], countryNames: ['France'], imageUrl: null, metadata: {},
    });

    expect(outcome.returnedFromMissing).toBe(true);
    expect(await membership(archaeology)).toEqual({ missing: false, listing: 'present' });
    expect(await membership(artMuseums)).toEqual({ missing: true, listing: 'present' });
    expect(await place()).toEqual({ missing: false, listing: 'present' });
  });

  it('answers every membership with a curator\'s verdict on the place', async () => {
    await stopListing(archaeology);
    await stopListing(artMuseums);

    const outcome = await answerStateUnderLock(LOUVRE, userId, null, {
      membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true },
    });

    expect(outcome.refusal).toBeUndefined();
    expect(await membership(archaeology)).toEqual({ missing: false, listing: 'former' });
    expect(await membership(artMuseums)).toEqual({ missing: false, listing: 'former' });
    expect(await place()).toEqual({ missing: false, listing: 'former' });
  });
});
