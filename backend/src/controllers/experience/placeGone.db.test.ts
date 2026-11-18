import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inTransaction, pool } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { writePlacePeriods, type SourcedDate, type SourcedPeriod } from '../../db/placePeriodsWriter.js';
import { CURATOR_SOURCE_ID } from '../../db/membership.js';
import { experienceShownToReaderSql, experienceShownWithGoneSql, placeGoneSql } from '../../db/readerPredicates.js';
import { writeLifetime, type LifetimeGate } from '../../services/sync/lifetimeWrites.js';
import { flagMissingExperiences } from '../../services/sync/missingDetection.js';
import { answerStateUnderLock } from './lifecycleController.js';

/**
 * A place's state is its standing periods (ADR-0217 decision 5, ADR-0225
 * slice B2), executed against PostgreSQL, since what stands today is derived
 * by triggers only the database runs.
 *
 * The Kakhovka Dam, which its run says stood from 1956, is judged lost by a
 * curator after it was breached in June 2023, and the verdict taken back;
 * Nelson's Pillar in Dublin, which stood from 1809 until 1966, is read as gone
 * by its run alone; the Jeddah Tower, whose opening is still ahead, stands
 * nowhere today and is not gone. Ids and items are the fixture's own.
 */

const KAKHOVKA = 9461;
const NELSON = 9462;
const JEDDAH = 9463;
const PLACES = [KAKHOVKA, NELSON, JEDDAH];
const USER_UUID = '00000000-0000-4000-8000-000000009461';

let userId = 0;
let kindId = 0;
/** The run's source, Bridges & engineering marvels, looked up by name. */
let runSource = 0;

const year = (y: number): SourcedDate => ({ year: y, month: null, day: null, span: null, circa: false, property: 'P571', statement: null });
const open = (from: SourcedDate): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });

interface Standing {
  gone: boolean;
  stands: boolean;
  recordStands: boolean;
}

async function standing(id: number): Promise<Standing> {
  const { rows } = await pool.query<Standing>(
    `SELECT ${placeGoneSql('e')} AS gone, e.stands_today AS stands, m.stands_today AS "recordStands"
       FROM experiences e JOIN source_records m ON m.experience_id = e.id AND m.kind_id IS NOT NULL
      WHERE e.id = $1`, [id]);
  return rows[0];
}

async function periods(id: number) {
  const { rows } = await pool.query<{
    from_year: number | null; ended: boolean; until_year: number | null; source_id: number; decided_by: number | null; decided: boolean;
  }>(
    `SELECT from_year, ended, until_year, source_id, decided_by, decided_at IS NOT NULL AS decided
       FROM place_periods WHERE experience_id = $1 AND kind_id IS NULL ORDER BY ordinal`, [id]);
  return rows;
}

/** A read of the place by its run, through the gate the run writes its periods by. */
async function runReads(id: number, stood: SourcedPeriod[], gate: Partial<LifetimeGate> = {}): Promise<void> {
  await inTransaction(async (client) => {
    const locked = await lockExperience(client, id);
    const record = await client.query<{ id: number }>('SELECT id FROM source_records WHERE experience_id = $1 AND source_id = $2', [id, runSource]);
    await writeLifetime(client, locked!.lock, record.rows[0].id, { stood }, {
      sourceId: runSource, gated: true, held: true, claimed: [], pinned: false, ...gate,
    });
  });
}

/** The run's view of a place's standing, written as the run writes it. */
async function runSays(id: number, stood: SourcedPeriod[]): Promise<void> {
  await inTransaction(async (client) => {
    const locked = await lockExperience(client, id);
    await writePlacePeriods(client, locked!.lock, 'stood', stood, { sourceId: runSource, decidedBy: null });
  });
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [PLACES]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

beforeEach(async () => {
  await clear();
  ({ id: runSource, kind_id: kindId } = (await pool.query<{ id: number; kind_id: number }>(
    "SELECT id, kind_id FROM experience_sources WHERE name = 'Bridges & engineering marvels'",
  )).rows[0]);
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'admin') RETURNING id`, [USER_UUID],
  )).rows[0].id;
  for (const [id, name, lon, lat] of [
    [KAKHOVKA, 'Kakhovka Dam', 33.3700, 46.7781],
    [NELSON, "Nelson's Pillar", -6.2603, 53.3498],
    [JEDDAH, 'Jeddah Tower', 39.1047, 21.7339],
  ] as const) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
      [id, runSource, `Q${id}0001`, name, lon, lat],
    );
    await pool.query(
      `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
       VALUES ($1, $2, $3, $4, 'auto', NOW())`,
      [id, kindId, runSource, `Q${id}0001`],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a curator's lost is the end of the place's standing (#2584)", () => {
  const unflagged = { membership: 'present' as const, gone: false, flagged: false };

  it('closes the run\'s open period as the curator\'s, and the place stands nowhere', async () => {
    await runSays(KAKHOVKA, [open(year(1956))]);
    expect(await standing(KAKHOVKA)).toEqual({ gone: false, stands: true, recordStands: true });

    const outcome = await answerStateUnderLock(KAKHOVKA, userId, null, {
      gone: true, reasonCode: 'missing-from-rule', note: 'Breached on 6 June 2023', expected: unflagged,
    });

    expect(outcome.refusal).toBeUndefined();
    expect(outcome.result).toMatchObject({ gone: true, sourceMembership: 'present' });
    expect(await standing(KAKHOVKA)).toEqual({ gone: true, stands: false, recordStands: false });
    // The start the run read is kept; the end's date is not known, so none is written.
    expect(await periods(KAKHOVKA)).toEqual([
      { from_year: 1956, ended: true, until_year: null, source_id: CURATOR_SOURCE_ID, decided_by: userId, decided: true },
    ]);
    // The note and the reason live in the curation log, the place keeps neither.
    const log = await pool.query<{ action: string; note: string; reason: string }>(
      `SELECT action, details->>'note' AS note, details->>'reasonCode' AS reason
         FROM experience_curation_log WHERE experience_id = $1`, [KAKHOVKA]);
    expect(log.rows).toEqual([{ action: 'marked_lost', note: 'Breached on 6 June 2023', reason: 'missing-from-rule' }]);
  });

  it('opens it again when the verdict is taken back, still the curator\'s', async () => {
    await runSays(KAKHOVKA, [open(year(1956))]);
    await answerStateUnderLock(KAKHOVKA, userId, null, { gone: true, reasonCode: 'missing-from-rule', expected: unflagged });

    const taken = await answerStateUnderLock(KAKHOVKA, userId, null, {
      gone: false, reasonCode: 'never-gone', expected: { membership: 'present', gone: true, flagged: false },
    });

    expect(taken.refusal).toBeUndefined();
    expect(await standing(KAKHOVKA)).toEqual({ gone: false, stands: true, recordStands: true });
    expect(await periods(KAKHOVKA)).toEqual([
      { from_year: 1956, ended: false, until_year: null, source_id: CURATOR_SOURCE_ID, decided_by: userId, decided: true },
    ]);
    const log = await pool.query<{ action: string }>(
      'SELECT action FROM experience_curation_log WHERE experience_id = $1 ORDER BY id', [KAKHOVKA]);
    expect(log.rows.map(row => row.action)).toEqual(['marked_lost', 'state_restored']);
  });

  it('gives a place with no periods one that ended, and taking it back leaves one open, the curator\'s', async () => {
    await answerStateUnderLock(KAKHOVKA, userId, null, { gone: true, reasonCode: 'missing-from-rule', expected: unflagged });
    expect(await periods(KAKHOVKA)).toEqual([
      { from_year: null, ended: true, until_year: null, source_id: CURATOR_SOURCE_ID, decided_by: userId, decided: true },
    ]);
    expect(await standing(KAKHOVKA)).toMatchObject({ gone: true, stands: false });

    await answerStateUnderLock(KAKHOVKA, userId, null, {
      gone: false, reasonCode: 'never-gone', expected: { membership: 'present', gone: true, flagged: false },
    });
    expect(await periods(KAKHOVKA)).toEqual([
      { from_year: null, ended: false, until_year: null, source_id: CURATOR_SOURCE_ID, decided_by: userId, decided: true },
    ]);
    expect(await standing(KAKHOVKA)).toMatchObject({ gone: false, stands: true });
  });

  it('keeps a take-back over the next run where the run read the place gone with no start', async () => {
    // An item that states a demolition and no inception: one period that ended, its dates not known,
    // written with the arrival on a place no reader sees yet.
    const goneUndated: SourcedPeriod = { from: null, ended: true, until: null, ending: null, what: null };
    await runReads(KAKHOVKA, [goneUndated], { held: false });
    expect(await standing(KAKHOVKA)).toMatchObject({ gone: true, stands: false });

    await answerStateUnderLock(KAKHOVKA, userId, null, {
      gone: false, reasonCode: 'never-gone', expected: { membership: 'present', gone: true, flagged: false },
    });
    // A trusted source would write its view over a list of none: the curator's open period is what it keeps.
    await runReads(KAKHOVKA, [goneUndated], { gated: false });

    expect(await standing(KAKHOVKA)).toEqual({ gone: false, stands: true, recordStands: true });
    expect(await periods(KAKHOVKA)).toEqual([
      { from_year: null, ended: false, until_year: null, source_id: CURATOR_SOURCE_ID, decided_by: userId, decided: true },
    ]);
  });

  it('refuses an answer drawn before someone else judged it', async () => {
    await answerStateUnderLock(KAKHOVKA, userId, null, { gone: true, reasonCode: 'missing-from-rule', expected: unflagged });

    const late = await answerStateUnderLock(KAKHOVKA, userId, null, { gone: true, reasonCode: 'missing-from-rule', expected: unflagged });

    expect(late.refusal).toMatchObject({ status: 409, gone: true });
  });
});

describe('a place its run reads as gone (#2584)', () => {
  it("is gone without a verdict: Nelson's Pillar, 1809 to 1966", async () => {
    await runSays(NELSON, [{ from: year(1809), ended: true, until: { ...year(1966), property: 'P576' }, ending: 'destroyed', what: null }]);

    expect(await standing(NELSON)).toEqual({ gone: true, stands: false, recordStands: false });
  });

  it('is revealed when a reader asks for what is gone, and never otherwise', async () => {
    await runSays(NELSON, [{ from: year(1809), ended: true, until: { ...year(1966), property: 'P576' }, ending: 'destroyed', what: null }]);
    await runSays(JEDDAH, [open(year(2028))]);

    const { rows } = await pool.query<{ id: number; shown: boolean; with_gone: boolean }>(
      `SELECT e.id, ${experienceShownToReaderSql('e')} AS shown, ${experienceShownWithGoneSql('e')} AS with_gone
         FROM experiences e WHERE e.id = ANY($1::int[]) ORDER BY e.id`, [[NELSON, JEDDAH]]);
    // The Jeddah Tower stands nowhere yet and is not gone: it is in neither list.
    expect(rows).toEqual([
      { id: NELSON, shown: false, with_gone: true },
      { id: JEDDAH, shown: false, with_gone: false },
    ]);
  });

  it('is never asked about when its source stops listing it, while a place yet to open is', async () => {
    await runSays(NELSON, [{ from: year(1809), ended: true, until: { ...year(1966), property: 'P576' }, ending: 'destroyed', what: null }]);
    await runSays(JEDDAH, [open(year(2028))]);
    const seen = await pool.query<{ ids: string[] | null }>(
      'SELECT array_agg(external_id) AS ids FROM source_records WHERE source_id = $1 AND NOT (experience_id = ANY($2::int[]))',
      [runSource, [NELSON, JEDDAH]],
    );

    const marked = await flagMissingExperiences(runSource, 0, false, seen.rows[0].ids ?? []);

    expect(marked.map(record => record.experienceId)).toEqual([JEDDAH]);
  });
});
