import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import type { RecordPeriods, SourcedDate, SourcedPeriod } from '../../db/placePeriodsWriter.js';
import { recordSyncChanges } from '../../services/sync/changeRecorder.js';
import { upsertExperienceRecord } from '../../services/sync/experienceUpsert.js';
import { refuseUnderLock } from './declineHeldController.js';
import { publishUnderLock } from './publishController.js';
import { heldWaitingSql } from './waitingCounts.js';

/**
 * A held list of a place's periods raises the held card, and is answered
 * through the card's two answers (#2578, ADR-0217 decision 3), against
 * PostgreSQL: real runs of a gated source through the upsert, filed as the
 * orchestrator files them, then publishing and refusing.
 *
 * Three places a reader sees, under made-up items: Bethlehem Chapel in Prague
 * (stood 1391 → 1786, again from 1952), the Odeon of Herodes Atticus in Athens
 * (destroyed in 267 and rebuilt by 1953 as its item has it, a ruin in between)
 * and Nelson's Pillar in Dublin, blown up on 8 March 1966. Their ids are
 * pinned, so no case takes a value of the places' sequence, and deleted before
 * and after.
 */

const CHAPEL = { id: 9721, qid: 'Q9719721', name: 'Bethlehem Chapel' };
const ODEON = { id: 9722, qid: 'Q9719722', name: 'Odeon of Herodes Atticus' };
const PILLAR = { id: 9723, qid: 'Q9719723', name: 'Nelson\'s Pillar' };
const PLACES = [CHAPEL, ODEON, PILLAR];
const USER_UUID = '00000000-0000-4000-8000-000000972100';

let worship = 0;
let userId = 0;
let wasGated: boolean | null = null;
const logs: number[] = [];

const on = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null, ...rest,
});
const open = (from: SourcedDate | null): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: SourcedDate | null, end: SourcedDate | null, ending: SourcedPeriod['ending'] = null): SourcedPeriod =>
  ({ from, ended: true, until: end, ending, what: null });

const CHAPEL_STOOD = [until(on(1391), on(1786, { property: 'P576' })), open(on(1952, { property: 'P793' }))];
const ODEON_STOOD = [until(on(161), on(267, { property: 'P793' }), 'destroyed'), open(on(1953, { property: 'P793' }))];
const PILLAR_STOOD = [until(on(1809), on(1966, { month: 3, day: 8, property: 'P576' }), 'destroyed')];

type Place = typeof CHAPEL;

/** A run of Places of worship that reads `lifetime` for `place`, filed as the orchestrator files it. */
async function run(place: Place, lifetime: RecordPeriods): Promise<number> {
  const logId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
     VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [worship],
  )).rows[0].id;
  logs.push(logId);
  const { changeSet } = await upsertExperienceRecord({
    sourceId: worship, externalId: place.qid, name: place.name, nameLocal: { en: place.name }, subtitle: null, description: null,
    type: null, tags: [], lon: 14.4, lat: 50.08, countryCodes: [], countryNames: [], imageUrl: null,
    metadata: { wikidataQid: place.qid },
  }, { syncLogId: logId, lifetimes: new Map([[place.qid, lifetime]]) });
  const filed = [...changeSet.changedFields, ...changeSet.heldFields];
  if (filed.length > 0) {
    await recordSyncChanges([{
      syncLogId: logId, experienceId: place.id, externalId: place.qid, nameSnapshot: place.name,
      changeType: changeSet.heldFields.length > 0 ? 'held' : 'updated', changedFields: filed, contents: null,
      significance: changeSet.significance, error: null,
    }]);
  }
  return logId;
}

async function clear(): Promise<void> {
  const ids = PLACES.map((place) => place.id);
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM experience_sync_changes WHERE sync_log_id = ANY($1::int[])', [logs]);
  await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [logs]);
  logs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

const periods = async (place: Place) => (await pool.query(
  `SELECT from_year, ended, until_year, ending, source_id = $2 AS own, decided_by
     FROM place_periods WHERE experience_id = $1 AND says = 'stood' ORDER BY ordinal`,
  [place.id, worship],
)).rows.map((row) => [row.from_year, row.ended ? row.until_year : 'open', row.ending, row.own, row.decided_by]);

/** The membership's pointer, and whether the queue's held card is open on it. */
const card = async (place: Place) => (await pool.query<{ pointer: number | null; open: boolean }>(
  `SELECT m.pending_change_sync_log_id AS pointer, (${heldWaitingSql('e', 'm')}) AS open
     FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
    WHERE m.experience_id = $1 AND m.source_id = $2`,
  [place.id, worship],
)).rows[0];

const standsToday = async (place: Place) => (await pool.query<{ stands_today: boolean }>(
  'SELECT stands_today FROM experiences WHERE id = $1', [place.id],
)).rows[0].stands_today;

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; requires_curation: boolean }>(
    "SELECT id, requires_curation FROM experience_sources WHERE name = 'Places of worship'",
  )).rows[0];
  worship = source.id;
  wasGated ??= source.requires_curation;
  await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [worship]);
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [USER_UUID],
  )).rows[0].id;
  // Each place as a curator passed it: a reader sees it.
  for (const place of PLACES) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location, metadata)
       VALUES ($1, $2, $3::text, $4, ST_SetSRID(ST_MakePoint(14.4, 50.08), 4326), jsonb_build_object('wikidataQid', $3::text))`,
      [place.id, worship, place.qid, place.name],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, $2, 'verified', NOW() FROM experience_sources s WHERE s.id = $3`,
      [place.id, place.qid, worship],
    );
  }
});

afterAll(async () => {
  await clear();
  if (wasGated !== null) await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [worship, wasGated]);
  await pool.end();
});

describe('a held list of a place\'s periods raises a card (#2578)', () => {
  it('asks about Bethlehem Chapel\'s gap beside what the place holds, and publishes it as its source\'s list', async () => {
    // The first run fills in what the list says beside the gap, and asks about the gap.
    const logId = await run(CHAPEL, { stood: CHAPEL_STOOD });
    expect(await periods(CHAPEL)).toEqual([[1391, 'open', null, true, null]]);
    expect(await card(CHAPEL)).toEqual({ pointer: logId, open: true });

    const { refusal } = await publishUnderLock(CHAPEL.id, userId, null, { heldFields: ['stood'], expectedSyncLogId: logId });

    expect(refusal).toBeUndefined();
    expect(await periods(CHAPEL)).toEqual([[1391, 1786, null, true, null], [1952, 'open', null, true, null]]);
    expect(await card(CHAPEL)).toEqual({ pointer: null, open: false });
    // The next run finds the place holding what it reports, and asks nothing.
    await run(CHAPEL, { stood: CHAPEL_STOOD });
    expect(await card(CHAPEL)).toEqual({ pointer: null, open: false });
  });

  it('remembers a refusal of the Odeon\'s gap by value: the same list is not asked again, another one is', async () => {
    const first = await run(ODEON, { stood: ODEON_STOOD });
    const { refusal } = await refuseUnderLock(ODEON.id, userId, null, { fields: ['stood'] }, first);
    expect(refusal).toBeUndefined();
    // The ruin stood in between: the place keeps "161 → open".
    expect(await periods(ODEON)).toEqual([[161, 'open', null, true, null]]);
    expect((await card(ODEON)).open).toBe(false);

    await run(ODEON, { stood: ODEON_STOOD });
    expect((await card(ODEON)).open).toBe(false);
    expect(await periods(ODEON)).toEqual([[161, 'open', null, true, null]]);

    const other = await run(ODEON, { stood: [ODEON_STOOD[0], open(on(1955, { property: 'P793' }))] });
    expect(await card(ODEON)).toEqual({ pointer: other, open: true });
  });

  it('writes a published end of Nelson\'s Pillar with how it ended, and the place no longer stands', async () => {
    await run(PILLAR, { stood: [open(on(1809))] });
    const logId = await run(PILLAR, { stood: PILLAR_STOOD });
    expect(await periods(PILLAR)).toEqual([[1809, 'open', null, true, null]]);
    expect(await card(PILLAR)).toEqual({ pointer: logId, open: true });
    expect(await standsToday(PILLAR)).toBe(true);

    const { refusal } = await publishUnderLock(PILLAR.id, userId, null, { heldFields: ['stood'], expectedSyncLogId: logId });

    expect(refusal).toBeUndefined();
    expect(await periods(PILLAR)).toEqual([[1809, 1966, 'destroyed', true, null]]);
    expect(await standsToday(PILLAR)).toBe(false);
  });

  it('asks nothing through a membership that refuses the place: the list is kept back and no card is raised', async () => {
    await pool.query(`UPDATE source_records SET admission = 'refused' WHERE experience_id = $1 AND source_id = $2`, [PILLAR.id, worship]);
    const logId = await run(PILLAR, { stood: PILLAR_STOOD });
    expect(await periods(PILLAR)).toEqual([]);
    expect((await card(PILLAR)).pointer).toBeNull();
    // Whatever else the run files of the place, it files no list.
    const filed = await pool.query(
      `SELECT f->>'field' AS field FROM experience_sync_changes ch, jsonb_array_elements(ch.changed_fields) f
        WHERE ch.sync_log_id = $1 AND f->>'field' IN ('stood', 'used')`, [logId],
    );
    expect(filed.rows).toEqual([]);
  });

  it('refuses to publish a held list that is not one a place can hold, and writes nothing', async () => {
    const logId = await run(PILLAR, { stood: PILLAR_STOOD });
    await pool.query(
      `UPDATE experience_sync_changes
          SET changed_fields = (SELECT jsonb_agg(CASE WHEN f->>'field' = 'stood' THEN jsonb_set(f, '{new,0,until,month}', '13') ELSE f END)
                                  FROM jsonb_array_elements(changed_fields) f)
        WHERE sync_log_id = $1`, [logId],
    );
    const { refusal } = await publishUnderLock(PILLAR.id, userId, null, { heldFields: ['stood'], expectedSyncLogId: logId });
    expect(refusal?.error).toContain('stood');
    expect(await periods(PILLAR)).toEqual([]);
  });
});
