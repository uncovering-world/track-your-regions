import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { settleIdentifierUnderLock } from './placeIdentifierController.js';
import { mergeEqualItems } from './equalItemMerges.js';

/**
 * A curator's word on a place's identifier (ADR-0143 decision 5, #1896),
 * against PostgreSQL: the word is a row the registry's deriving functions read,
 * so what the registry then holds is decided in SQL.
 *
 * The fixture is a serial site of two parts that both carry the ensemble's
 * item on their points (the chapels of Saint Thaddeus carrying the monastery's
 * item), and a place of worship that carries that item on its membership.
 */

const SITE = 9990;
const PART_A = 9991;
const PART_B = 9992;
const CHURCH = 9993;
const PLACES = [SITE, PART_A, PART_B, CHURCH];
const ENSEMBLE = 'Q9990001';
const OWN = 'Q9990002';
const STRAY = 'Q9990003';
const CURATOR = '00000000-0000-4000-8000-000000009990';

let heritage: { id: number; kind_id: number };
let worship: { id: number; kind_id: number };
let curatorId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR]);
}

async function place(id: number, source: { id: number }, externalId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(44.55, 39.09), 4326))`,
    [id, source.id, externalId, name],
  );
}

async function membership(placeId: number, source: { id: number; kind_id: number }, externalId: string): Promise<number> {
  return (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, $4, 'auto', NOW()) RETURNING id`,
    [placeId, source.kind_id, source.id, externalId],
  )).rows[0].id;
}

/** The registry's rows for a value, as `place:identifies|refers`, or `place:verdict` for the word. */
async function held(value: string): Promise<string[]> {
  return (await pool.query<{ row: string }>(
    `SELECT experience_id || ':' || CASE WHEN identifies THEN 'identifies' ELSE 'refers' END AS row
       FROM place_identifiers WHERE value = $1 ORDER BY experience_id`, [value],
  )).rows.map(r => r.row);
}

async function outOfStep(): Promise<number> {
  return Number((await pool.query<{ n: string }>(
    `WITH vals AS (SELECT scheme, array_agg(DISTINCT value) AS values
                     FROM (SELECT scheme, value FROM place_identifier_values()
                           UNION SELECT scheme, value FROM place_identifiers) v GROUP BY scheme),
          expected AS (SELECT vals.scheme, x.* FROM vals CROSS JOIN LATERAL place_identifiers_expected(vals.scheme, vals.values) x)
     SELECT count(*) AS n FROM expected x
       FULL JOIN place_identifiers pi ON pi.scheme = x.scheme AND pi.value = x.value AND pi.experience_id = x.experience_id
      WHERE x.experience_id IS NULL OR pi.experience_id IS NULL
         OR (x.identifies, x.claims_identity, x.basis) IS DISTINCT FROM (pi.identifies, pi.claims_identity, pi.basis)`,
  )).rows[0].n);
}

const settle = (placeId: number, value: string, verdict: 'identifies' | 'refers' | 'removed' | 'derived', note?: string) =>
  settleIdentifierUnderLock(placeId, curatorId, null, { scheme: 'wikidata', value, verdict, note });

beforeEach(async () => {
  await clear();
  const source = async (name: string) => (await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  )).rows[0];
  heritage = await source('UNESCO World Heritage Sites');
  worship = await source('Places of worship');
  curatorId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR],
  )).rows[0].id;
  await place(SITE, heritage, '9990-fixture', 'Monastery of Saint Thaddeus');
  const site = await membership(SITE, heritage, '9990-fixture');
  for (const [part, ref, name] of [[PART_A, '9990-001', 'The chapel'], [PART_B, '9990-002', 'The village']] as const) {
    await place(part, heritage, ref, name);
    await pool.query(
      `INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref) VALUES ($1, $2, 'component', $3, $4)`,
      [SITE, part, site, ref],
    );
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, wikidata_item, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(44.55, 39.09), 4326))`,
      [part, name, ref, ENSEMBLE],
    );
  }
  await place(CHURCH, worship, OWN, 'A church');
  await membership(CHURCH, worship, OWN);
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a curator's word on an identifier (ADR-0143 decision 5)", () => {
  it('makes a value the place does not carry identifying, and no run takes it back', async () => {
    // The ensemble's item refers to both parts; the curator says it is the chapel's.
    expect(await held(ENSEMBLE)).toEqual([`${PART_A}:refers`, `${PART_B}:refers`]);
    const outcome = await settle(PART_A, ENSEMBLE, 'identifies', 'The chapel is what the item describes');
    expect(outcome.refusal).toBeUndefined();
    expect(outcome.result).toMatchObject({ verdict: 'identifies', identifies: true });
    expect(await held(ENSEMBLE)).toEqual([`${PART_A}:identifies`, `${PART_B}:refers`]);

    // A run rewriting the point's item changes nothing: the word stands.
    await pool.query('UPDATE experience_locations SET wikidata_item = $1 WHERE experience_id = $2', [ENSEMBLE, PART_B]);
    expect(await held(ENSEMBLE)).toEqual([`${PART_A}:identifies`, `${PART_B}:refers`]);
    expect(await outOfStep()).toBe(0);

    const log = await pool.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'identifier_settled'`, [PART_A],
    );
    expect(log.rows[0].details).toMatchObject({
      scheme: 'wikidata', value: ENSEMBLE, verdict: 'identifies',
      before: { identifies: false, claimsIdentity: false, verdict: null }, after: { identifies: true },
      note: 'The chapel is what the item describes',
    });
  });

  it('refuses to make a value identifying while another live place identifies it, naming that place', async () => {
    const outcome = await settle(PART_A, OWN, 'identifies');
    expect(outcome.refusal).toMatchObject({ status: 409, error: expect.stringContaining(`A church (#${CHURCH})`) });
    expect(await held(OWN)).toEqual([`${CHURCH}:identifies`]);
  });

  it('takes a value off a place, and a run writing the column again does not bring it back', async () => {
    const outcome = await settle(CHURCH, OWN, 'removed');
    expect(outcome.refusal).toBeUndefined();
    expect(await held(OWN)).toEqual([]);
    await pool.query('UPDATE experience_kind_memberships SET external_id = $1 WHERE experience_id = $2', [OWN, CHURCH]);
    expect(await held(OWN)).toEqual([]);
    expect(await outOfStep()).toBe(0);

    // The word taken back: the membership's column decides again.
    const back = await settle(CHURCH, OWN, 'derived');
    expect(back.refusal).toBeUndefined();
    expect(await held(OWN)).toEqual([`${CHURCH}:identifies`]);
  });

  it('makes a value only refer to a place its column claims', async () => {
    const outcome = await settle(CHURCH, OWN, 'refers');
    expect(outcome.refusal).toBeUndefined();
    expect(await held(OWN)).toEqual([`${CHURCH}:refers`]);
    expect(await outOfStep()).toBe(0);
  });

  it('keeps the equal-item pass off a place whose curator took the item off it', async () => {
    // The chapel's point carries the church's item: the pass would fold the
    // part into the church, the place a reader is shown. The word stands.
    await pool.query('UPDATE experience_locations SET wikidata_item = $1 WHERE experience_id = $2', [OWN, PART_A]);
    expect(await held(OWN)).toEqual([`${PART_A}:refers`, `${CHURCH}:refers`]);
    expect((await settle(PART_A, OWN, 'removed', 'The item is the church, not the chapel')).refusal).toBeUndefined();
    expect(await held(OWN)).toEqual([`${CHURCH}:identifies`]);

    const report = await mergeEqualItems([OWN]);
    expect(report.merged).toEqual([]);
    const part = await pool.query<{ merged_into_id: number | null }>('SELECT merged_into_id FROM experiences WHERE id = $1', [PART_A]);
    expect(part.rows[0].merged_into_id).toBeNull();
  });

  it('refuses a word on a value the place does not carry, and a take-back where none stands', async () => {
    expect((await settle(CHURCH, STRAY, 'refers')).refusal).toMatchObject({ status: 409 });
    expect((await settle(CHURCH, OWN, 'derived')).refusal).toMatchObject({ status: 409 });
    expect((await settle(9999, OWN, 'refers')).refusal).toMatchObject({ status: 404 });
  });
});
