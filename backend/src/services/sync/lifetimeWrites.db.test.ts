import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import type { RecordDates, SourcedDate } from '../../db/placeDatesWriter.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './experienceUpsert.js';

/**
 * A run writes a place's dates through the gate (#1719, ADR-0214 decision 4),
 * executed against PostgreSQL: the upsert writes its source's view on its own
 * record and the place's dates the gate lets through, under the place's lock.
 *
 * The fixture is Göbekli Tepe as Archaeology, a gated source, brings it: begun
 * about the 10th millennium BC, in use until about the 7th. Ids are the
 * fixture's own, deleted before and after.
 */

const QID = 'Q9719101';

let archaeology = 0;
let logId = 0;
let wasGated: boolean | null = null;

const date = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, ending: null, property: 'P571', statement: null, ...rest,
});

const GOBEKLI: RecordDates = {
  began: date(-9999, { span: 'millennium', circa: true, statement: 'Q9719101$aa01' }),
  use_ended: date(-7000, { span: 'millennium', property: 'P576' }),
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

const write = (lifetime: RecordDates, dryRun = false) =>
  upsertExperienceRecord(record(), { syncLogId: logId, dryRun, lifetimes: new Map([[QID, lifetime]]) });

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE external_id = $1', [QID]);
  if (logId) {
    await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = $1', [logId]);
    await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [logId]);
  }
}

const placeDates = async () => (await pool.query(
  `SELECT d.slot, d.year, d.span, d.circa, d.property, d.statement, d.source_id = $2 AS own
     FROM place_dates d JOIN experiences e ON e.id = d.experience_id
    WHERE e.external_id = $1 ORDER BY d.slot`,
  [QID, archaeology],
)).rows;
const recordDates = async () => (await pool.query(
  `SELECT rd.slot, rd.year FROM record_dates rd JOIN source_records m ON m.id = rd.record_id
    WHERE m.source_id = $1 AND m.external_id = $2 ORDER BY rd.slot`,
  [archaeology, QID],
)).rows;

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

describe('a run writes a place\'s dates through the gate (#1719)', () => {
  it('fills the dates of a place it creates, and files them as passed', async () => {
    const created = await write(GOBEKLI);
    expect(created.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([
      ['began', 'first-date'], ['use_ended', 'first-date'],
    ]);
    expect(await placeDates()).toEqual([
      { slot: 'began', year: -9999, span: 'millennium', circa: true, property: 'P571', statement: 'Q9719101$aa01', own: true },
      { slot: 'use_ended', year: -7000, span: 'millennium', circa: false, property: 'P576', statement: null, own: true },
    ]);
    expect(await recordDates()).toEqual([{ slot: 'began', year: -9999 }, { slot: 'use_ended', year: -7000 }]);
  });

  it('holds a change to a date a reader sees, and an end, as a question to a curator, while its record reports them', async () => {
    const created = await write(GOBEKLI);
    await pool.query(
      `UPDATE source_records SET curation_state = 'verified', published_at = NOW()
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const changed = await write({
      began: date(-9600, { span: 'century' }),
      use_ended: GOBEKLI.use_ended,
      ended: date(-7000, { property: 'P576', ending: 'destroyed' }),
    });
    expect(changed.changeSet.changedFields.filter((f) => ['began', 'ended'].includes(f.field))).toEqual([]);
    expect(changed.changeSet.heldFields.map((f) => [f.field, f.held, (f.old as SourcedDate | null)?.year ?? null,
      (f.new as SourcedDate | null)?.year])).toEqual([['began', true, -9999, -9600], ['ended', true, null, -7000]]);
    expect((await placeDates()).map((d) => [d.slot, d.year])).toEqual([['began', -9999], ['use_ended', -7000]]);
    expect(await recordDates()).toEqual([{ slot: 'began', year: -9600 }, { slot: 'ended', year: -7000 }, { slot: 'use_ended', year: -7000 }]);
    const membership = (await pool.query<{ state: string; pointer: number | null }>(
      `SELECT curation_state AS state, pending_change_sync_log_id AS pointer FROM source_records
        WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    )).rows[0];
    expect(membership).toEqual({ state: 'verified', pointer: logId });
  });

  it('writes an end under a trusted source, and none where a curator\'s admission pin keeps the place', async () => {
    await pool.query('UPDATE experience_sources SET requires_curation = FALSE WHERE id = $1', [archaeology]);
    const ENDED = date(2024, { month: 1, property: 'P576', ending: 'destroyed' });
    const created = await write({ began: GOBEKLI.began });
    await pool.query(
      `UPDATE source_records SET curated_fields = '["admission"]'::jsonb WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    await write({ began: GOBEKLI.began, ended: ENDED });
    expect((await placeDates()).map((d) => d.slot)).toEqual(['began']);
    await pool.query(
      `UPDATE source_records SET curated_fields = '[]'::jsonb WHERE experience_id = $1 AND source_id = $2`,
      [created.experienceId, archaeology],
    );
    const ended = await write({ began: GOBEKLI.began, ended: ENDED });
    expect(ended.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([['ended', 'first-date']]);
    expect((await placeDates()).map((d) => [d.slot, d.year])).toEqual([['began', -9999], ['ended', 2024]]);
  });

  it('says in a preview what a run would fill, and writes nothing', async () => {
    const created = await write(GOBEKLI, true);
    expect(created.changeSet.changedFields.map((f) => [f.field, f.passedTheGate])).toEqual([
      ['began', 'first-date'], ['use_ended', 'first-date'],
    ]);
    expect(await placeDates()).toEqual([]);
  });
});
