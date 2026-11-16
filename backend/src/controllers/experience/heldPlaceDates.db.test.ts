import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import type { RecordDates, SourcedDate } from '../../db/placeDatesWriter.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from '../../services/sync/experienceUpsert.js';
import { refuseUnderLock } from './declineHeldController.js';
import { publishUnderLock } from './publishController.js';
import { heldWaitingSql } from './waitingCounts.js';

/**
 * A held date of a place raises a card, and is answered through the held
 * card's two answers (#1719, ADR-0214 decision 4), against PostgreSQL: real
 * runs of a gated source through the upsert, then publishing and refusing.
 *
 * The fixture is the Cathedral of Christ the Saviour in Moscow as Places of
 * worship brings it, under a made-up item: built by 1883, and a later run that
 * reads its inception as 2000 and an end of 1931. Deleted before and after.
 */

const QID = 'Q9719201';
const USER_UUID = '00000000-0000-4000-8000-000000971920';

let worship = 0;
let userId = 0;
let wasGated: boolean | null = null;
const logs: number[] = [];

const date = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, ending: null, property: 'P571', statement: null, ...rest,
});
const BUILT = date(1883, { property: 'P1619' });
const REBUILT = date(2000, { month: 8, day: 19 });
const BLOWN_UP = date(1931, { month: 12, day: 5, property: 'P576', ending: 'demolished' });

const record = (): ExperienceUpsertParams => ({
  sourceId: worship,
  externalId: QID,
  name: 'Cathedral of Christ the Saviour',
  nameLocal: { en: 'Cathedral of Christ the Saviour' },
  subtitle: null,
  description: null,
  type: null,
  tags: [],
  lon: 37.6055,
  lat: 55.7446,
  countryCodes: ['RU'],
  countryNames: ['Russia'],
  imageUrl: null,
  metadata: { wikidataQid: QID },
});

/** A run of Places of worship that reads `lifetime`, and its log. */
async function run(lifetime: RecordDates): Promise<{ experienceId: number; logId: number }> {
  const logId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
     VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [worship],
  )).rows[0].id;
  logs.push(logId);
  const outcome = await upsertExperienceRecord(record(), { syncLogId: logId, lifetimes: new Map([[QID, lifetime]]) });
  return { experienceId: outcome.experienceId, logId };
}

async function clear(): Promise<void> {
  await pool.query(
    `DELETE FROM experience_curation_log WHERE experience_id IN (SELECT id FROM experiences WHERE external_id = $1)`, [QID],
  );
  await pool.query('DELETE FROM experiences WHERE external_id = $1', [QID]);
  if (logs.length > 0) {
    await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = ANY($1::int[])', [logs]);
    await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [logs]);
    logs.length = 0;
  }
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

const placeDates = async () => (await pool.query(
  `SELECT d.slot, d.year, d.ending, d.source_id = $2 AS own, d.decided_by
     FROM place_dates d JOIN experiences e ON e.id = d.experience_id
    WHERE e.external_id = $1 ORDER BY d.slot`,
  [QID, worship],
)).rows;

/** The membership's pointer, and whether the queue's held card is open on it. */
const card = async () => (await pool.query<{ pointer: number | null; open: boolean }>(
  `SELECT m.pending_change_sync_log_id AS pointer, (${heldWaitingSql('e', 'm')}) AS open
     FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
    WHERE m.source_id = $1 AND m.external_id = $2`,
  [worship, QID],
)).rows[0];

/** The place as a curator passed it: built by 1883, seen by readers. */
async function published(): Promise<number> {
  const { experienceId } = await run({ began: BUILT });
  await pool.query(
    `UPDATE source_records SET curation_state = 'verified', published_at = NOW()
      WHERE experience_id = $1 AND source_id = $2`,
    [experienceId, worship],
  );
  return experienceId;
}

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; requires_curation: boolean }>(
    "SELECT id, requires_curation FROM experience_sources WHERE name = 'Places of worship'",
  )).rows[0];
  worship = source.id;
  wasGated ??= source.requires_curation;
  await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [worship]);
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  )).rows[0].id;
});

afterAll(async () => {
  await clear();
  if (wasGated !== null) await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [worship, wasGated]);
  await pool.end();
});

describe('a held date of a place raises a card (#1719)', () => {
  it('asks about a changed date and an end, and publishes one as its source\'s date', async () => {
    const id = await published();
    const { logId } = await run({ began: REBUILT, ended: BLOWN_UP });
    expect(await card()).toEqual({ pointer: logId, open: true });

    const { refusal } = await publishUnderLock(id, userId, null, { heldFields: ['began'], expectedSyncLogId: logId });

    expect(refusal).toBeUndefined();
    expect(await placeDates()).toEqual([{ slot: 'began', year: 2000, ending: null, own: true, decided_by: null }]);
    // The end is still asked.
    expect(await card()).toEqual({ pointer: logId, open: true });
  });

  it('writes a published end with how the place ended, and closes the card', async () => {
    const id = await published();
    const { logId } = await run({ began: BUILT, ended: BLOWN_UP });

    const { refusal } = await publishUnderLock(id, userId, null, { heldFields: ['ended'], expectedSyncLogId: logId });

    expect(refusal).toBeUndefined();
    expect((await placeDates()).map((d) => [d.slot, d.year, d.ending])).toEqual([
      ['began', 1883, null], ['ended', 1931, 'demolished'],
    ]);
    expect(await card()).toEqual({ pointer: null, open: false });
  });

  it('remembers a refusal by value, so the same end is not asked again and another one is', async () => {
    const id = await published();
    const first = await run({ began: BUILT, ended: BLOWN_UP });
    const { refusal } = await refuseUnderLock(id, userId, null, { fields: ['ended'] }, first.logId);
    expect(refusal).toBeUndefined();
    expect(await card()).toEqual({ pointer: null, open: false });

    const again = await run({ began: BUILT, ended: BLOWN_UP });
    expect((await card()).open).toBe(false);
    expect(again.logId).toBeGreaterThan(first.logId);
    expect((await placeDates()).map((d) => d.slot)).toEqual(['began']);

    const other = await run({ began: BUILT, ended: date(1931, { property: 'P576', ending: 'destroyed' }) });
    expect(await card()).toEqual({ pointer: other.logId, open: true });
  });

  it('takes a date off the place when a held removal is published', async () => {
    const id = await published();
    const { logId } = await run({});
    expect(await card()).toEqual({ pointer: logId, open: true });

    await publishUnderLock(id, userId, null, { heldFields: ['began'], expectedSyncLogId: logId });

    expect(await placeDates()).toEqual([]);
  });

  it('asks nothing of a place no reader sees, and keeps its end back', async () => {
    await run({ began: BUILT, ended: BLOWN_UP });
    expect((await card()).pointer).toBeNull();
    expect((await placeDates()).map((d) => d.slot)).toEqual(['began']);
  });
});
