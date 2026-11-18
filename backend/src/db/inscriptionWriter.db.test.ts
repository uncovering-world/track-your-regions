import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { lockExperience } from './experienceWriter.js';
import { dangerStaySql, inscriptionFacts, inscriptionOf, inscriptionYearSql } from './inscription.js';
import { publishFactsOnMembership } from '../controllers/experience/membershipWriter.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from '../services/sync/experienceUpsert.js';

/**
 * A World Heritage Site's inscription in its typed tables (#2127), executed
 * against PostgreSQL: what the UNESCO run's upsert writes there, what
 * publishing a held flag writes, and what a reader is shown, on the sites the
 * model was argued over. The places' ids and list numbers are the fixture's own.
 */

const COLOGNE = { id: 9460, whc: '9460', item: 'Q4176', name: 'Cologne Cathedral' };
const LIVERPOOL = { id: 9461, whc: '9461', item: 'Q2021552', name: 'Liverpool – Maritime Mercantile City' };
const BAMIYAN = { id: 9462, whc: '9462', item: 'Q50810144', name: 'Cultural Landscape and Archaeological Remains of the Bamiyan Valley' };
const STRUVE = { id: 9463, whc: '9463', item: 'Q192243', name: 'Struve Geodetic Arc' };
const SITES = [COLOGNE, LIVERPOOL, BAMIYAN, STRUVE];

let unesco = 0;
let gated = false;
let curator = 0;
const CURATOR_UUID = '2127b0de-0000-4000-8000-000000002644';

const record = (site: typeof COLOGNE, facts: Record<string, unknown>): ExperienceUpsertParams => ({
  sourceId: unesco,
  externalId: site.whc,
  name: site.name,
  nameLocal: { en: site.name },
  subtitle: null,
  description: null,
  type: 'cultural',
  tags: [],
  lon: 6.958,
  lat: 50.941,
  countryCodes: [],
  countryNames: [],
  imageUrl: null,
  // As the run's transform sends them: in the one form the tables give back.
  metadata: inscriptionFacts(inscriptionOf(facts)),
});

const membershipOf = async (site: typeof COLOGNE) => (await pool.query<{ id: number; experience_id: number }>(
  'SELECT id, experience_id FROM source_records WHERE source_id = $1 AND external_id = $2', [unesco, site.whc],
)).rows[0];

const listOf = async (table: 'record_danger_periods' | 'record_listings', site: typeof COLOGNE) => (await pool.query(
  `SELECT t.from_year, t.from_month, t.from_day, t.from_statement, t.ended, t.until_year, t.until_month, t.until_day,
          t.until_statement${table === 'record_listings' ? ', t.ending' : ''}
     FROM ${table} t JOIN source_records m ON m.id = t.record_id
    WHERE m.source_id = $1 AND m.external_id = $2 ORDER BY t.ordinal`,
  [unesco, site.whc],
)).rows;

const shown = async (site: typeof COLOGNE) => (await pool.query<{ year: string | null; stay: { since: number | null } | null }>(
  `SELECT ${inscriptionYearSql('e')} AS year, ${dangerStaySql('e')} AS stay
     FROM experiences e JOIN source_records m ON m.experience_id = e.id
    WHERE m.source_id = $1 AND m.external_id = $2`,
  [unesco, site.whc],
)).rows[0];

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experiences WHERE id = ANY($1::int[]) OR id IN (
       SELECT experience_id FROM source_records WHERE source_id = $3 AND external_id = ANY($2::text[]))`,
    [SITES.map(site => site.id), SITES.map(site => site.whc), unesco],
  );
}

beforeAll(async () => {
  const source = (await pool.query<{ id: number; requires_curation: boolean }>(
    "SELECT id, requires_curation FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'",
  )).rows[0];
  unesco = source.id;
  gated = source.requires_curation;
  // The run's writes land rather than waiting for a curator; the gate's hold
  // of the shown facts is publishing's case below.
  await pool.query('UPDATE experience_sources SET requires_curation = FALSE WHERE id = $1', [unesco]);
  curator = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id", [CURATOR_UUID],
  )).rows[0].id;
});

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [unesco, gated]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [CURATOR_UUID]);
  await pool.end();
});

const COLOGNE_FACTS = {
  dateInscribed: '1996', inDanger: false, dangerList: null, criteria: '(i)(ii)(iv)',
  region: 'Europe and North America', transboundary: false,
};

/** Bamiyan as the run sends it: the flag `isInDanger` read beside the listing. */
const BAMIYAN_FACTS = {
  ...COLOGNE_FACTS, dateInscribed: '2003', inDanger: true, dangerList: 'Y 2003', region: 'Asia and the Pacific',
};

describe('the run\'s upsert writes the inscription to its tables', () => {
  it('holds Cologne Cathedral\'s criteria and listing, and none of it in the facts', async () => {
    await upsertExperienceRecord(record(COLOGNE, COLOGNE_FACTS));

    const membership = await membershipOf(COLOGNE);
    const row = (await pool.query(
      `SELECT i.criteria, i.area_ha, i.transboundary, i.unesco_region, m.facts
         FROM record_heritage_inscriptions i JOIN source_records m ON m.id = i.record_id WHERE i.record_id = $1`,
      [membership.id],
    )).rows[0];
    expect(row).toEqual({
      criteria: ['(i)', '(ii)', '(iv)'], area_ha: null, transboundary: false, unesco_region: 'Europe and North America', facts: {},
    });
    expect(await listOf('record_listings', COLOGNE)).toEqual([expect.objectContaining({ from_year: 1996, ended: false, ending: null })]);
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([]);
    expect(await shown(COLOGNE)).toEqual({ year: '1996', stay: null });
  });

  it('opens Bamiyan\'s stay from 2003, ends it at a date not known, and opens it again', async () => {
    await upsertExperienceRecord(record(BAMIYAN, BAMIYAN_FACTS));
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: { since: 2003 } });

    await upsertExperienceRecord(record(BAMIYAN, { ...BAMIYAN_FACTS, inDanger: false, dangerList: null }));
    expect(await listOf('record_danger_periods', BAMIYAN)).toEqual([
      expect.objectContaining({ from_year: 2003, ended: true, until_year: null }),
    ]);
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: null });

    // The open stay the dataset gives wins over the ended one it overlaps.
    await upsertExperienceRecord(record(BAMIYAN, BAMIYAN_FACTS));
    expect(await listOf('record_danger_periods', BAMIYAN)).toEqual([expect.objectContaining({ from_year: 2003, ended: false })]);

    // A listing that gives no year keeps the year the open stay holds.
    await upsertExperienceRecord(record(BAMIYAN, { ...BAMIYAN_FACTS, dangerList: 'Y' }));
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: { since: 2003 } });
  });

  it('marks the Struve Geodetic Arc due for pairing when its inscribed area changes', async () => {
    const struve = {
      ...COLOGNE_FACTS, dateInscribed: '2005', criteria: '(ii)(iii)(vi)', transboundary: true, areaHectares: 100,
    };
    await upsertExperienceRecord(record(STRUVE, struve));
    const { experience_id: place } = await membershipOf(STRUVE);
    await pool.query('DELETE FROM experience_pairing_due WHERE experience_id = $1', [place]);

    await upsertExperienceRecord(record(STRUVE, struve));
    expect((await pool.query('SELECT 1 FROM experience_pairing_due WHERE experience_id = $1', [place])).rowCount).toBe(0);

    await upsertExperienceRecord(record(STRUVE, { ...struve, areaHectares: 200 }));
    expect((await pool.query('SELECT 1 FROM experience_pairing_due WHERE experience_id = $1', [place])).rowCount).toBe(1);
    expect((await pool.query('SELECT transboundary, area_ha FROM record_heritage_inscriptions WHERE record_id = $1',
      [(await membershipOf(STRUVE)).id])).rows[0]).toEqual({ transboundary: true, area_ha: '200.00' });
  });

  it('writes an area re-measured under a tenth past the gate as remeasured, and a larger move as unseen (#1353)', async () => {
    const area = (areaHectares: number) => record(STRUVE, { ...COLOGNE_FACTS, areaHectares });
    await upsertExperienceRecord(area(821.74));
    const membership = await membershipOf(STRUVE);
    await pool.query("UPDATE source_records SET curation_state = 'verified', published_at = NOW() WHERE id = $1", [membership.id]);
    await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [unesco]);
    const log = (await pool.query<{ id: number }>(
      "INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run) VALUES ($1, 'running', NOW(), FALSE) RETURNING id",
      [unesco],
    )).rows[0].id;
    const passed = (outcome: Awaited<ReturnType<typeof upsertExperienceRecord>>) =>
      [outcome.changeSet.heldFields.length, outcome.changeSet.changedFields.map(f => [f.field, f.passedTheGate])];
    try {
      expect(passed(await upsertExperienceRecord(area(821.75), { syncLogId: log }))).toEqual([0, [['metadata.areaHectares', 'remeasured']]]);
      expect(passed(await upsertExperienceRecord(area(1000), { syncLogId: log }))).toEqual([0, [['metadata.areaHectares', 'unseen']]]);
      expect((await pool.query('SELECT area_ha FROM record_heritage_inscriptions WHERE record_id = $1', [membership.id])).rows)
        .toEqual([{ area_ha: '1000.00' }]);
    } finally {
      await pool.query('UPDATE experience_sources SET requires_curation = FALSE WHERE id = $1', [unesco]);
      await pool.query('UPDATE source_records SET pending_change_sync_log_id = NULL WHERE id = $1', [membership.id]);
      await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = $1', [log]);
      await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [log]);
    }
  });

  it('refuses an inscription\'s key in any membership\'s facts', async () => {
    await upsertExperienceRecord(record(COLOGNE, COLOGNE_FACTS));
    await expect(pool.query(
      `UPDATE source_records SET facts = facts || '{"inDanger": true}' WHERE id = $1`, [(await membershipOf(COLOGNE)).id],
    )).rejects.toMatchObject({ code: '23514' });
  });
});

describe('publishing a held danger flag', () => {
  it('opens the stay on the membership, under the place\'s lock', async () => {
    await upsertExperienceRecord(record(BAMIYAN, { ...COLOGNE_FACTS, dateInscribed: '2003' }));
    const membership = await membershipOf(BAMIYAN);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, membership.experience_id);
      await publishFactsOnMembership(client, locked!.lock, membership.id, {
        value: { ...COLOGNE_FACTS, dateInscribed: '2003', inDanger: true, dangerList: 'Y 2003', tier: 'world' },
      }, curator);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: { since: 2003 } });
    expect((await pool.query('SELECT facts FROM source_records WHERE id = $1', [membership.id])).rows[0].facts).toEqual({ tier: 'world' });
    // The dataset's stay a curator accepted stays the run's to move.
    expect((await pool.query('SELECT source_id, decided_at FROM record_danger_periods WHERE record_id = $1', [membership.id])).rows)
      .toEqual([{ source_id: unesco, decided_at: null }]);
  });
});
