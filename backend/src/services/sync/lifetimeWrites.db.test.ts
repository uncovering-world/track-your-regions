import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { RecordPeriods, SourcedDate, SourcedPeriod } from '../../db/placePeriodsWriter.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * A run writes a place's periods through the gate (#2578, ADR-0217
 * decision 3), executed against PostgreSQL: the upsert writes its source's
 * view on its own record and the place's periods the gate lets through, under
 * the place's lock.
 *
 * The fixture is Göbekli Tepe as Archaeology, a gated source, brings it:
 * standing from about the 10th millennium BC, in use until about the 7th. Ids
 * are the fixture's own, deleted before and after.
 */

const QID = 'Q9719101';

let archaeology = 0;
let logId = 0;
let wasGated: boolean | null = null;

const on = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null, ...rest,
});
const open = (from: SourcedDate | null): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: SourcedDate | null, end: SourcedDate | null, ending: SourcedPeriod['ending'] = null): SourcedPeriod =>
  ({ from, ended: true, until: end, ending, what: null });

const BEGAN = on(-9999, { span: 'millennium', circa: true, statement: 'Q9719101$aa01' });
const GOBEKLI: RecordPeriods = {
  stood: [open(BEGAN)],
  used: [until(null, on(-7000, { span: 'millennium', property: 'P576' }))],
};

const record = (): ExperienceUpsertParams => ({
  sourceId: archaeology,
  externalId: QID,
  name: 'Göbekli Tepe',
  nameLocal: { en: 'Göbekli Tepe' },
  subtitle: null,
  description: null,
  type: null,
  tags: [],
  lon: 38.9224,
  lat: 37.2233,
  countryCodes: ['TR'],
  countryNames: ['Turkey'],
  imageUrl: null,
  metadata: { wikidataQid: QID },
});

const write = (lifetime: RecordPeriods, dryRun = false) =>
  upsertExperienceRecord(record(), { syncLogId: logId, dryRun, lifetimes: new Map([[QID, lifetime]]) });

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE external_id = $1', [QID]);
  if (logId) {
    await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = $1', [logId]);
    await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [logId]);
  }
}

const placePeriods = async () => (await pool.query(
  `SELECT p.says, p.ordinal, p.from_year, p.from_statement, p.ended, p.until_year, p.source_id = $2 AS own
     FROM place_periods p JOIN experiences e ON e.id = p.experience_id
    WHERE e.external_id = $1 ORDER BY p.says, p.ordinal`,
  [QID, archaeology],
)).rows;
const recordPeriods = async () => (await pool.query(
  `SELECT rp.says, rp.from_year, rp.ended, rp.until_year FROM record_periods rp JOIN source_records m ON m.id = rp.record_id
    WHERE m.source_id = $1 AND m.external_id = $2 ORDER BY rp.says, rp.ordinal`,
  [archaeology, QID],
)).rows;
const standsToday = async () => (await pool.query<{ stands_today: boolean }>(
  'SELECT stands_today FROM experiences WHERE external_id = $1', [QID],
)).rows[0].stands_today;

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; requires_curation: boolean }>(
    "SELECT id, requires_curation FROM experience_sources WHERE name = 'Archaeology'",
  )).rows[0];
  archaeology = source.id;
  wasGated ??= source.requires_curation;
  await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [archaeology]);
  logId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
     VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [archaeology],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  if (wasGated !== null) await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [archaeology, wasGated]);
  await pool.end();
});

describe('a run writes a place\'s periods through the gate (#2578)', () => {
  it('fills the periods of a place it creates, and files them as passed', async () => {
    const created = await write(GOBEKLI);
    expect(created.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([
      ['stood', 'first-date'], ['used', 'first-date'],
    ]);
    expect(await placePeriods()).toEqual([
      { says: 'stood', ordinal: 1, from_year: -9999, from_statement: 'Q9719101$aa01', ended: false, until_year: null, own: true },
      { says: 'used', ordinal: 1, from_year: null, from_statement: null, ended: true, until_year: -7000, own: true },
    ]);
    expect(await recordPeriods()).toEqual([
      { says: 'stood', from_year: -9999, ended: false, until_year: null },
      { says: 'used', from_year: null, ended: true, until_year: -7000 },
    ]);
    expect(await standsToday()).toBe(true);
  });

  it('writes the end of a place that arrives already gone, with the arrival', async () => {
    const created = await write({ stood: [until(BEGAN, on(-7000, { span: 'millennium', property: 'P576' }), 'destroyed')] });
    expect(created.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([['stood', undefined]]);
    expect(await placePeriods()).toMatchObject([{ says: 'stood', from_year: -9999, ended: true, until_year: -7000 }]);
    expect(await standsToday()).toBe(false);
  });

  it('holds a moved date and the end of a place a reader sees, for a curator, while its record reports them', async () => {
    const created = await write(GOBEKLI);
    await pool.query(
      `UPDATE source_records SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    // The start moved to the 96th century BC, and the place said to be gone since the 7th millennium.
    const changed = await write({
      stood: [until(on(-9600, { span: 'century' }), on(-7000, { span: 'millennium', property: 'P576' }), 'destroyed')],
      used: GOBEKLI.used,
    });
    expect(changed.changeSet.changedFields.filter((f) => ['stood', 'used'].includes(f.field))).toEqual([]);
    expect(changed.changeSet.heldFields).toEqual([]);
    expect((await placePeriods()).map((p) => [p.says, p.from_year, p.ended])).toEqual([['stood', -9999, false], ['used', null, true]]);
    expect(await standsToday()).toBe(true);
    expect(await recordPeriods()).toEqual([
      { says: 'stood', from_year: -9600, ended: true, until_year: -7000 },
      { says: 'used', from_year: null, ended: true, until_year: -7000 },
    ]);
    const membership = (await pool.query<{ state: string; pointer: number | null }>(
      `SELECT curation_state AS state, pending_change_sync_log_id AS pointer FROM source_records
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    )).rows[0];
    expect(membership).toEqual({ state: 'verified', pointer: null });
  });

  it('fills a gap into the period a seen place holds, which moves no date of it and leaves it standing', async () => {
    const created = await write({ stood: [open(on(1883))] });
    await pool.query(
      `UPDATE source_records SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const filled = await write({ stood: [until(on(1883), on(1931, { month: 12, day: 5, property: 'P576' })), open(on(2000))] });
    expect(filled.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([['stood', 'first-date']]);
    expect((await placePeriods()).map((p) => [p.ordinal, p.from_year, p.until_year])).toEqual([[1, 1883, 1931], [2, 2000, null]]);
    expect(await standsToday()).toBe(true);
  });

  it('writes an end under a trusted source, and none where a curator\'s admission pin keeps the place', async () => {
    await pool.query('UPDATE experience_sources SET requires_curation = FALSE WHERE id = $1', [archaeology]);
    const gone = { stood: [until(BEGAN, on(2024, { month: 1, property: 'P576' }), 'destroyed')] };
    const created = await write({ stood: [open(BEGAN)] });
    await pool.query(
      `UPDATE source_records SET curated_fields = '["admission"]'::jsonb WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    await write(gone);
    expect((await placePeriods()).map((p) => [p.says, p.ended])).toEqual([['stood', false]]);
    expect(await standsToday()).toBe(true);
    await pool.query(
      `UPDATE source_records SET curated_fields = '[]'::jsonb WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const ended = await write(gone);
    expect(ended.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([['stood', undefined]]);
    expect((await placePeriods()).map((p) => [p.says, p.from_year, p.until_year])).toEqual([['stood', -9999, 2024]]);
    expect(await standsToday()).toBe(false);
  });

  it('says in a preview what a run would fill, and writes nothing', async () => {
    const created = await write(GOBEKLI, true);
    expect(created.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([
      ['stood', 'first-date'], ['used', 'first-date'],
    ]);
    expect(await placePeriods()).toEqual([]);
  });
});
