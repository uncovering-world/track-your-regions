import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { lockExperience } from './experienceWriter.js';
import { dangerStaySql, inscriptionFacts, inscriptionFactsOfRecordSql, inscriptionOf, inscriptionYearSql } from './inscription.js';
import { publishFactsOnMembership } from '../controllers/experience/membershipWriter.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from '../services/sync/experienceUpsert.js';
import { statementsOf, writeHeritageHistory } from '../services/sync/heritageHistory.js';
import { indexWorldHeritageFacts } from '../services/sync/unescoWikidata.js';
import type { SparqlBinding } from '../services/sync/wikidataUtils.js';

/**
 * A World Heritage Site's inscription in its typed tables (#2127), executed
 * against PostgreSQL: what the UNESCO run's upsert writes there, what the end
 * of the run reads in from Wikidata's statements, what publishing a held flag
 * writes, and what a reader is shown, on the sites the model was argued over.
 * The places' ids and list numbers are the fixture's own; the Wikidata items
 * and statements are the real ones, read on 2026-11-18.
 */

const COLOGNE = { id: 9460, whc: '9460', item: 'Q4176', name: 'Cologne Cathedral' };
const LIVERPOOL = { id: 9461, whc: '9461', item: 'Q2021552', name: 'Liverpool – Maritime Mercantile City' };
const BAMIYAN = { id: 9462, whc: '9462', item: 'Q50810144', name: 'Cultural Landscape and Archaeological Remains of the Bamiyan Valley' };
const STRUVE = { id: 9463, whc: '9463', item: 'Q192243', name: 'Struve Geodetic Arc' };
const SITES = [COLOGNE, LIVERPOOL, BAMIYAN, STRUVE];

const ENTITY = 'http://www.wikidata.org/entity/';
const binding = (row: Record<string, string>): SparqlBinding =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { value }]));
const INDEX = indexWorldHeritageFacts(SITES.map(site => binding({ whc: site.whc, item: `${ENTITY}${site.item}`, label: site.name })));
const STATEMENTS = statementsOf([
  binding({
    item: `${ENTITY}Q4176`, statement: `${ENTITY}statement/Q4176-3934dbc6-43b9-3e81-c5c9-1959a7adb963`,
    start: '2004-01-01T00:00:00Z', startPrecision: '9', end: '2006-01-01T00:00:00Z', endPrecision: '9',
  }),
  binding({
    item: `${ENTITY}Q2021552`, statement: `${ENTITY}statement/Q2021552-31f26901-4ca1-3884-619b-1cd88d769ade`,
    start: '2012-01-01T00:00:00Z', startPrecision: '9',
  }),
  binding({ item: `${ENTITY}Q50810144`, statement: `${ENTITY}statement/Q50810144-0c71cf9d-41bc-8004-07e9-8c17057a84e2` }),
], [
  binding({
    item: `${ENTITY}Q2021552`, statement: `${ENTITY}statement/Q2021552-B8A5B5E2-0831-4397-96DD-42CFC88D760F`,
    end: '2021-07-21T00:00:00Z', endPrecision: '11',
  }),
]);

// Cologne Cathedral's stay as a correction would state it: removed from the
// Danger List at the Committee's session of July 2006.
const CORRECTED = statementsOf([
  binding({
    item: `${ENTITY}Q4176`, statement: `${ENTITY}statement/Q4176-3934dbc6-43b9-3e81-c5c9-1959a7adb963`,
    start: '2004-01-01T00:00:00Z', startPrecision: '9', end: '2006-07-01T00:00:00Z', endPrecision: '10',
  }),
], []);

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

describe('the end of the run reads the history from Wikidata\'s statements', () => {
  it('adds the stay Cologne Cathedral ended in 2006, which no reader is shown, and keeps it', async () => {
    await upsertExperienceRecord(record(COLOGNE, COLOGNE_FACTS));
    await writeHeritageHistory(INDEX, STATEMENTS);

    const stay = expect.objectContaining({
      from_year: 2004, from_statement: 'Q4176$3934dbc6-43b9-3e81-c5c9-1959a7adb963', ended: true, until_year: 2006,
    });
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([stay]);
    expect(await shown(COLOGNE)).toEqual({ year: '1996', stay: null });

    // The next pass of the dataset keeps it, as does a run Wikidata did not answer.
    await upsertExperienceRecord(record(COLOGNE, COLOGNE_FACTS));
    await writeHeritageHistory(null, null);
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([stay]);
  });

  it('ends Liverpool\'s listing and its stay on 21 July 2021, once it is former', async () => {
    await upsertExperienceRecord(record(LIVERPOOL, { ...COLOGNE_FACTS, dateInscribed: '2004', inDanger: true, dangerList: 'Y 2012' }));
    await pool.query("UPDATE source_records SET source_membership = 'former' WHERE id = $1", [(await membershipOf(LIVERPOOL)).id]);

    await writeHeritageHistory(INDEX, STATEMENTS);

    const delisted = { until_year: 2021, until_month: 7, until_day: 21, until_statement: 'Q2021552$B8A5B5E2-0831-4397-96DD-42CFC88D760F' };
    expect(await listOf('record_listings', LIVERPOOL)).toEqual([
      expect.objectContaining({ from_year: 2004, ended: true, ending: 'delisted', ...delisted }),
    ]);
    expect(await listOf('record_danger_periods', LIVERPOOL)).toEqual([
      expect.objectContaining({ from_year: 2012, ended: true, ...delisted }),
    ]);
    expect(await shown(LIVERPOOL)).toEqual({ year: null, stay: null });
  });

  it('keeps the dataset\'s open stay on Bamiyan, which Wikidata states with no dates', async () => {
    await upsertExperienceRecord(record(BAMIYAN, BAMIYAN_FACTS));
    await writeHeritageHistory(INDEX, STATEMENTS);
    expect(await listOf('record_danger_periods', BAMIYAN)).toEqual([expect.objectContaining({ from_year: 2003, ended: false })]);
  });
});

/** Publish a held proposal's facts onto the site's membership, as the curator, under the place's lock. */
async function publish(site: typeof COLOGNE, facts: (readBack: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const membership = await membershipOf(site);
  const readBack = (await pool.query(
    `SELECT ${inscriptionFactsOfRecordSql('m')} AS facts FROM source_records m WHERE m.id = $1`, [membership.id],
  )).rows[0].facts as Record<string, unknown>;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, membership.experience_id);
    await publishFactsOnMembership(client, locked!.lock, membership.id, { value: facts(readBack) }, curator);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

const hands = async (site: typeof COLOGNE) => (await pool.query(
  'SELECT from_year, ended, source_id, decided_by FROM record_danger_periods WHERE record_id = $1 ORDER BY ordinal',
  [(await membershipOf(site)).id],
)).rows;

describe('publishing a held danger flag', () => {
  it('opens a stay from the day a curator puts Cologne Cathedral\'s badge on with no year, and keeps its stay of 2004 to 2006', async () => {
    await upsertExperienceRecord(record(COLOGNE, COLOGNE_FACTS));
    await writeHeritageHistory(INDEX, STATEMENTS);
    const ended = expect.objectContaining({ from_year: 2004, ended: true, until_year: 2006 });
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([ended]);

    // The flag alone, merged onto a listing the tables give back as none.
    const days = [new Date()];
    await publish(COLOGNE, (readBack) => {
      expect(readBack).toEqual(expect.objectContaining({ inDanger: false, dangerList: null }));
      return { ...readBack, inDanger: true };
    });
    days.push(new Date());
    const dayOf = (at: Date) => ({ from_year: at.getUTCFullYear(), from_month: at.getUTCMonth() + 1, from_day: at.getUTCDate() });
    const stays = await listOf('record_danger_periods', COLOGNE);
    expect(stays).toEqual([ended, expect.objectContaining({ ended: false, until_year: null })]);
    expect(days.map(dayOf)).toContainEqual(expect.objectContaining({
      from_year: stays[1].from_year, from_month: stays[1].from_month, from_day: stays[1].from_day,
    }));
    expect(await shown(COLOGNE)).toEqual({ year: '1996', stay: { since: stays[1].from_year } });
    // The curator answered only the flag: both stays stay the run's to move.
    expect((await hands(COLOGNE)).map(({ source_id: source }) => source)).toEqual([unesco, unesco]);

    // The year the dataset gives, were it to list the site again from 2025, moves the start.
    await upsertExperienceRecord(record(COLOGNE, { ...COLOGNE_FACTS, inDanger: true, dangerList: 'Y 2025' }));
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([
      ended, expect.objectContaining({ from_year: 2025, from_month: null, from_day: null, ended: false }),
    ]);
  });

  it('stamps only the stay a curator ends, and Wikidata still corrects Cologne Cathedral\'s stay of 2004 to 2006', async () => {
    // A site listed again from 2025 by the dataset, its stay of 2004 to 2006 read from Wikidata.
    await upsertExperienceRecord(record(COLOGNE, { ...COLOGNE_FACTS, inDanger: true, dangerList: 'Y 2025' }));
    await writeHeritageHistory(INDEX, STATEMENTS);

    await publish(COLOGNE, (readBack) => ({ ...readBack, inDanger: false }));
    expect(await hands(COLOGNE)).toEqual([
      { from_year: 2004, ended: true, source_id: unesco, decided_by: null },
      { from_year: 2025, ended: true, source_id: 11, decided_by: curator },
    ]);
    expect(await shown(COLOGNE)).toEqual({ year: '1996', stay: null });

    // Wikidata corrects the run's stay; the curator's stands as it is.
    expect(await writeHeritageHistory(INDEX, CORRECTED)).toBe(1);
    expect(await listOf('record_danger_periods', COLOGNE)).toEqual([
      expect.objectContaining({ from_year: 2004, until_year: 2006, until_month: 7, ended: true }),
      expect.objectContaining({ from_year: 2025, ended: true, until_year: null }),
    ]);
    expect((await hands(COLOGNE)).map(({ source_id: source }) => source)).toEqual([unesco, 11]);
  });

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

  it('takes Bamiyan\'s badge off as the curator\'s, and a run opens only a stay that begins after it', async () => {
    await upsertExperienceRecord(record(BAMIYAN, BAMIYAN_FACTS));
    const membership = await membershipOf(BAMIYAN);
    // What publishing merges the flag alone onto: the facts read back from the
    // tables, which still give the listing as "Y 2003".
    const readBack = (await pool.query(
      `SELECT ${inscriptionFactsOfRecordSql('m')} AS facts FROM source_records m WHERE m.id = $1`, [membership.id],
    )).rows[0].facts as Record<string, unknown>;
    expect(readBack).toEqual(expect.objectContaining({ inDanger: true, dangerList: 'Y 2003' }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await lockExperience(client, membership.experience_id);
      await publishFactsOnMembership(client, locked!.lock, membership.id, { value: { ...readBack, inDanger: false } }, curator);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const stays = async () => (await pool.query(
      `SELECT from_year, ended, until_year, source_id, decided_by, decided_at IS NOT NULL AS decided
         FROM record_danger_periods WHERE record_id = $1 ORDER BY ordinal`, [membership.id],
    )).rows;
    const endedByTheCurator = { from_year: 2003, ended: true, until_year: null, source_id: 11, decided_by: curator, decided: true };
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: null });
    expect(await stays()).toEqual([endedByTheCurator]);
    expect((await pool.query('SELECT curated_fields FROM source_records WHERE id = $1', [membership.id])).rows[0].curated_fields)
      .toContain('danger');

    // The next run, the dataset still reading "Y 2003", leaves it ended, and
    // Wikidata's history leaves the curator's stays alone, writing nothing.
    await upsertExperienceRecord(record(BAMIYAN, BAMIYAN_FACTS));
    expect(await writeHeritageHistory(INDEX, STATEMENTS)).toBe(0);
    expect(await stays()).toEqual([endedByTheCurator]);
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: null });

    // A stay the dataset states from a later year is a new one: the run opens
    // it beside the curator's.
    await upsertExperienceRecord(record(BAMIYAN, { ...BAMIYAN_FACTS, dangerList: 'Y 2025' }));
    expect(await stays()).toEqual([
      endedByTheCurator,
      { from_year: 2025, ended: false, until_year: null, source_id: unesco, decided_by: null, decided: false },
    ]);
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: { since: 2025 } });

    // A curator who puts the badge back on stays a curator decided writes
    // them as the curator's: the run alone would leave them as they stand.
    const again = await pool.connect();
    try {
      await again.query('BEGIN');
      const locked = await lockExperience(again, membership.experience_id);
      await publishFactsOnMembership(again, locked!.lock, membership.id, { value: { ...readBack, inDanger: false } }, curator);
      await publishFactsOnMembership(again, locked!.lock, membership.id, { value: { ...readBack, inDanger: true } }, curator);
      await again.query('COMMIT');
    } finally {
      again.release();
    }
    expect(await shown(BAMIYAN)).toEqual({ year: '2003', stay: { since: 2003 } });
    expect((await stays()).map(({ source_id: source }) => source)).toEqual([11]);
  });
});
