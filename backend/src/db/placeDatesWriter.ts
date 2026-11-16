/**
 * The writes to a place's lifetime (#1719, ADR-0214): its dates in
 * `place_dates`, and each source's view of them on its record in
 * `record_dates` (ADR-0084).
 *
 * The two tables' writers are a closed list the backend lint names
 * (`PLACE_DATE_WRITE_RULES`, ADR-0069): this module, and the seed. Every write
 * is made under the place's lock and requires its `LockedExperience`, so a run
 * writing its view and a curator correcting a date never interleave on one
 * place. Whether to write — the gate, a curator's claim — stays with the
 * caller that decided it.
 *
 * A date is checked by the rule both sides apply (`isValidPlaceDate`,
 * `@tyr/shared/lifetime`) before it is written: the schema's CHECKs hold the
 * shape (a month only within a year, a span only on a year), and the rule adds
 * what a CHECK cannot say plainly, the days a month has and the latest year.
 */

import type { PoolClient } from 'pg';
import {
  isValidPlaceDate, LIFETIME_SLOTS, PLACE_END, type LifetimeSlot, type PlaceDate, type PlaceEnding,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from './experienceWriter.js';
import type { Existence } from '@tyr/shared/lifecycle';
import { CURATOR_SOURCE_ID } from './membership.js';
import { placeExistenceSql } from './readerPredicates.js';

/** What a source says of one date: the date, how a place ended where it did, and the statement it was read from. */
export interface SourcedDate extends PlaceDate {
  /** Only on `ended`. */
  ending: PlaceEnding | null;
  /** The Wikidata property the date was read from (`P571`), or null. */
  property: string | null;
  /** The Wikidata statement it was read from (`Q194474$…`), or null. */
  statement: string | null;
}

/** One date of the place, with whose view it was taken from. */
export interface PlaceDateWrite extends SourcedDate {
  /** The source whose view it is; `CURATOR_SOURCE_ID` for a curator's date. */
  sourceId: number;
  /** The curator who set it, or null for a run's date. */
  decidedBy: number | null;
}

/** A source's whole view of a place's lifetime: each date it reports, by slot. */
export type RecordDates = Partial<Record<LifetimeSlot, SourcedDate>>;

/** Refuse a date the rule refuses, naming the slot, so a caller's bug never reaches the table as a CHECK error. */
function checked(slot: LifetimeSlot, date: SourcedDate): SourcedDate {
  if (!isValidPlaceDate(date, slot, new Date().getUTCFullYear())) {
    throw new RangeError(`placeDatesWriter: not a date the ${slot} slot can hold: ${JSON.stringify(date)}`);
  }
  if (date.ending !== null && slot !== 'ended') {
    throw new RangeError(`placeDatesWriter: only the place's end says how it ended, not ${slot}`);
  }
  return date;
}

/** Write one date of the place, replacing what the place held in that slot. */
export async function writePlaceDate(
  client: PoolClient,
  lock: LockedExperience,
  slot: LifetimeSlot,
  value: PlaceDateWrite,
): Promise<void> {
  const date = checked(slot, value);
  await client.query(
    `INSERT INTO place_dates (experience_id, slot, year, month, day, span, circa, ending,
                              source_id, property, statement, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (experience_id, slot) DO UPDATE
        SET year = EXCLUDED.year, month = EXCLUDED.month, day = EXCLUDED.day, span = EXCLUDED.span,
            circa = EXCLUDED.circa, ending = EXCLUDED.ending, source_id = EXCLUDED.source_id,
            property = EXCLUDED.property, statement = EXCLUDED.statement,
            decided_by = EXCLUDED.decided_by, updated_at = NOW()`,
    [lock.id, slot, date.year, date.month, date.day, date.span, date.circa, date.ending,
      value.sourceId, date.property, date.statement, value.decidedBy],
  );
}

/** Take one date off the place. Returns whether it held one. */
export async function clearPlaceDate(client: PoolClient, lock: LockedExperience, slot: LifetimeSlot): Promise<boolean> {
  const result = await client.query('DELETE FROM place_dates WHERE experience_id = $1 AND slot = $2', [lock.id, slot]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Whether the locked place still stands, in a verdict's words
 * (`placeExistenceSql`): read in its own statement after the lock, since a
 * statement's snapshot is taken before it waits for the lock and every writer
 * of the end holds it (`db/locks.ts`).
 */
export async function placeExistenceOf(client: Pick<PoolClient, 'query'>, lock: LockedExperience): Promise<Existence> {
  const result = await client.query<{ existence: Existence }>(
    `SELECT ${placeExistenceSql('e')} AS existence FROM experiences e WHERE e.id = $1`, [lock.id],
  );
  return result.rows[0]?.existence ?? 'extant';
}

/**
 * A curator's answer on whether the place still stands (ADR-0214 decision 3):
 * gone writes its end, from Curators, with the year where the curator knows it
 * and none where they do not; still standing takes the end off. Claiming the
 * slot, so no run writes it back, is the caller's (`setLifecycleVerdict`).
 */
export async function answerPlaceEnd(
  client: PoolClient,
  lock: LockedExperience,
  answer: { gone: boolean; year: number | null; decidedBy: number },
): Promise<void> {
  if (!answer.gone) {
    await clearPlaceDate(client, lock, PLACE_END);
    return;
  }
  await writePlaceDate(client, lock, PLACE_END, {
    year: answer.year, month: null, day: null, span: null, circa: false, ending: null,
    property: null, statement: null, sourceId: CURATOR_SOURCE_ID, decidedBy: answer.decidedBy,
  });
}

/**
 * Write a record's whole view of the place's lifetime, as the run writes its
 * `reported_*` columns: every date it reports, and nothing in the slots it
 * reports none for. The record must be one of the locked place's. Every date
 * is checked before anything is written, so a view with one date the rule
 * refuses leaves the record's old view as it stood.
 */
export async function writeRecordDates(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  dates: RecordDates,
): Promise<void> {
  const owned = await client.query('SELECT 1 FROM source_records WHERE id = $1 AND experience_id = $2', [recordId, lock.id]);
  if (owned.rowCount === 0) throw new RangeError(`placeDatesWriter: record ${recordId} is not a record of place ${lock.id}`);
  const reported = LIFETIME_SLOTS.flatMap((slot) => {
    const date = dates[slot];
    return date === undefined ? [] : [{ slot, date: checked(slot, date) }];
  });
  await client.query('DELETE FROM record_dates WHERE record_id = $1 AND NOT (slot = ANY($2::text[]))',
    [recordId, reported.map(({ slot }) => slot)]);
  for (const { slot, date } of reported) {
    await client.query(
      `INSERT INTO record_dates (record_id, slot, year, month, day, span, circa, ending, property, statement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (record_id, slot) DO UPDATE
          SET year = EXCLUDED.year, month = EXCLUDED.month, day = EXCLUDED.day, span = EXCLUDED.span,
              circa = EXCLUDED.circa, ending = EXCLUDED.ending, property = EXCLUDED.property,
              statement = EXCLUDED.statement`,
      [recordId, slot, date.year, date.month, date.day, date.span, date.circa, date.ending, date.property, date.statement],
    );
  }
}
