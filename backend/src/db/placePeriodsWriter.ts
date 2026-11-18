/**
 * The writes to a place's periods (#2578, ADR-0217): what the place holds in
 * `place_periods`, and each source's view of it on its record in
 * `record_periods` (ADR-0084).
 *
 * The two tables' writers are a closed list the backend lint names
 * (`PLACE_PERIOD_WRITE_RULES`, ADR-0069): this module, and the seed. Every
 * write is made under the place's lock and requires its `LockedExperience`, so
 * a run writing its view and a curator correcting a period never interleave on
 * one place. Whether to write — the gate, a curator's claim — stays with the
 * caller that decided it.
 *
 * A list is written whole per thing it says: the periods in which the place
 * stood are one list, its uses another. The caller gives a list in time order,
 * the writer numbers it, and the rule both sides apply (`periodsFault`,
 * `@tyr/shared/lifetime`) is asked before anything is written: the schema's
 * CHECK holds the shape of one period, and the rule adds what a CHECK cannot
 * say plainly, the days a month has, the order of a list, that standing
 * periods do not overlap and that none ends in the future (one may begin
 * there, open: a place opens on its opening day). The outer days
 * beside each period (`from_first`, `until_last`) are written here from
 * `outerDaysOf`, the one statement of that rule.
 *
 * A list may hold for the place in every kind, or for its membership in one
 * kind only (`kindId`): Frick Madison was an art museum from 2021 until
 * 3 March 2024 while the building stands, so the period that ended is its Art
 * Museums membership's. Only a standing period or a closure names a kind, and
 * the kind must be one the place holds a membership in (the schema's
 * `place_periods_of_membership`).
 *
 * A curator's list is a decided one: it carries `decided_at` beside
 * `decided_by`, as the schema requires of every row of the Curators source.
 * Every write that changes a row stamps `updated_at`, which the schema
 * requires too (`trg_place_periods_stamp`).
 *
 * `experiences.stands_today` and `source_records.stands_today` are not written
 * here or anywhere: triggers derive them from the standing periods this module
 * writes.
 *
 * A curator's *lost* is a write of the place's standing periods too
 * (`setPlaceGone`, ADR-0217 decision 5): it closes the last one, and taking it
 * back opens it again, each as the curator's list.
 */

import type { PoolClient } from 'pg';
import {
  latestDayOnEarth, outerDaysOf, periodsFault, PERIOD_SAYS, PLACE_STOOD, standsBy,
  type CalendarDay, type PeriodSays, type PlaceDate, type PlaceEnding,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from './experienceWriter.js';
import { CURATOR_SOURCE_ID } from './membership.js';
import { placeGoneSql } from './readerPredicates.js';

/** One end of a period as a source states it: the date, and the statement it was read from. */
export interface SourcedDate extends PlaceDate {
  /** The Wikidata property the date was read from (`P571`), or null. */
  property: string | null;
  /** The Wikidata statement it was read from (`Q194474$…`), or null. */
  statement: string | null;
}

/** One period as a source or a curator states it. */
export interface SourcedPeriod {
  /** When it began; null where that is not known. */
  from: SourcedDate | null;
  ended: boolean;
  /** When it ended; null on an open period, and on one that ended at a date not known. */
  until: SourcedDate | null;
  /** How the place stopped standing; only on a standing period that ended. */
  ending: PlaceEnding | null;
  /** A curator's words for a use or a closure; null on a period a run reports. */
  what: string | null;
}

/** Whose view a place's periods were taken from. */
export interface PeriodsBy {
  /** The source whose view they are; `CURATOR_SOURCE_ID` for a curator's. */
  sourceId: number;
  /** The curator who set them, or null for a run's. */
  decidedBy: number | null;
}

/** What may name a kind: a standing period and a closure (the schema's `place_periods_kind_of_standing`). */
const OF_A_KIND: readonly PeriodSays[] = ['stood', 'closed'];

/** The periods a place holds that say one thing, with whose view they were taken from. */
export interface HeldPeriods {
  periods: readonly SourcedPeriod[];
  sourceId: number;
  /** The curator who set them, or null for a run's. */
  decidedBy: number | null;
}

/** A source's whole view of a place's periods: each list it reports, by what it says. */
export type RecordPeriods = Partial<Record<PeriodSays, readonly SourcedPeriod[]>>;

/** The columns of one period, as both tables hold them, after the key. */
const PERIOD_COLUMNS = [
  ['from_year', 'integer'], ['from_month', 'smallint'], ['from_day', 'smallint'], ['from_span', 'text'],
  ['from_circa', 'boolean'], ['from_property', 'text'], ['from_statement', 'text'],
  ['ended', 'boolean'],
  ['until_year', 'integer'], ['until_month', 'smallint'], ['until_day', 'smallint'], ['until_span', 'text'],
  ['until_circa', 'boolean'], ['until_property', 'text'], ['until_statement', 'text'],
  ['ending', 'text'], ['what', 'text'], ['from_first', 'integer'], ['until_last', 'integer'],
] as const;
const COLUMN_NAMES = PERIOD_COLUMNS.map(([name]) => name);
const COLUMN_TYPES = PERIOD_COLUMNS.map(([name, type]) => `${name} ${type}`).join(', ');
/** The columns of a period as `prefix` holds them. */
const columnsOf = (prefix: string): string => COLUMN_NAMES.map((name) => `${prefix}.${name}`).join(', ');
const SET_FROM_EXCLUDED = COLUMN_NAMES.map((name) => `${name} = EXCLUDED.${name}`).join(', ');
/** The rows of a statement's one JSON parameter, as a row set: what each says, its number, and the period. */
const recordset = (parameter: string): string =>
  `jsonb_to_recordset(${parameter}::jsonb) AS p(says text, ordinal smallint, ${COLUMN_TYPES})`;
/** A row the statement would leave as it is, so a run that reports what it reported writes nothing. */
const differs = (table: string): string => `(${columnsOf(table)}) IS DISTINCT FROM (${columnsOf('EXCLUDED')})`;

/** Refuse a list the rule refuses, naming what it says, so a caller's bug never reaches the table as a CHECK error. */
function checked(says: PeriodSays, periods: readonly SourcedPeriod[]): readonly SourcedPeriod[] {
  const fault = periodsFault(says, periods, latestDayOnEarth(new Date()));
  if (fault) throw new RangeError(`placePeriodsWriter: not periods a place ${says}: ${fault}: ${JSON.stringify(periods)}`);
  for (const period of periods) {
    if (period.ending !== null && !(says === PLACE_STOOD && period.ended)) {
      throw new RangeError('placePeriodsWriter: only a standing period that ended says how the place stopped standing');
    }
    if (period.what !== null && (!['used', 'closed'].includes(says) || period.what.trim() === '')) {
      throw new RangeError('placePeriodsWriter: only a use or a closure is named, and not with nothing');
    }
  }
  return periods;
}

/** The periods as the rows the statements read, numbered in the order given. */
function rowsOf(says: PeriodSays, periods: readonly SourcedPeriod[]): Record<string, unknown>[] {
  return periods.map((period, index) => {
    const { from, until } = period;
    const { fromFirst, untilLast } = outerDaysOf(period);
    return {
      says,
      ordinal: index + 1,
      from_year: from?.year ?? null, from_month: from?.month ?? null, from_day: from?.day ?? null,
      from_span: from?.span ?? null, from_circa: from?.circa ?? false,
      from_property: from?.property ?? null, from_statement: from?.statement ?? null,
      ended: period.ended,
      until_year: until?.year ?? null, until_month: until?.month ?? null, until_day: until?.day ?? null,
      until_span: until?.span ?? null, until_circa: until?.circa ?? false,
      until_property: until?.property ?? null, until_statement: until?.statement ?? null,
      ending: period.ending, what: period.what, from_first: fromFirst, until_last: untilLast,
    };
  });
}

/**
 * Write the place's periods that say `says`, for every kind or for its
 * membership in `kindId`, replacing every one it held of them: an empty list
 * takes them off. The periods past the new list's length go first and the rest
 * are written in order, so the one open standing period a place may hold per
 * kind (`idx_place_periods_open_standing`) is never two on the way. A period
 * written as it stands is not rewritten.
 */
export async function writePlacePeriods(
  client: PoolClient,
  lock: LockedExperience,
  says: PeriodSays,
  periods: readonly SourcedPeriod[],
  by: PeriodsBy,
  kindId: number | null = null,
): Promise<void> {
  if (kindId !== null && !OF_A_KIND.includes(says)) {
    throw new RangeError(`placePeriodsWriter: only a standing period or a closure holds for one kind, not one a place ${says}`);
  }
  const rows = rowsOf(says, checked(says, periods));
  await client.query(
    'DELETE FROM place_periods WHERE experience_id = $1 AND kind_id IS NOT DISTINCT FROM $2 AND says = $3 AND ordinal > $4',
    [lock.id, kindId, says, rows.length],
  );
  if (rows.length === 0) return;
  const decided = by.decidedBy !== null || by.sourceId === CURATOR_SOURCE_ID;
  await client.query(
    `INSERT INTO place_periods (experience_id, kind_id, says, ordinal, ${COLUMN_NAMES.join(', ')}, source_id, decided_by, decided_at)
     SELECT $1, $5::int, p.says, p.ordinal, ${columnsOf('p')}, $3, $4, CASE WHEN $6::boolean THEN clock_timestamp() END
       FROM ${recordset('$2')}
      ORDER BY p.ordinal
     ON CONFLICT (experience_id, kind_id, says, ordinal) DO UPDATE
        SET ${SET_FROM_EXCLUDED},
            source_id = EXCLUDED.source_id, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at,
            updated_at = clock_timestamp()
      WHERE ${differs('place_periods')}
         OR (place_periods.source_id, place_periods.decided_by) IS DISTINCT FROM (EXCLUDED.source_id, EXCLUDED.decided_by)`,
    [lock.id, JSON.stringify(rows), by.sourceId, by.decidedBy, kindId, decided],
  );
}

/**
 * Write a record's whole view of the place's periods, as the run writes its
 * `reported_*` columns: every list it reports, and nothing of what it reports
 * none for. `ofMembership` says whose standing the view is: the place's as a
 * thing, or the membership's own in the record's kind (the Art Museums record
 * of Frick Madison reporting the museum closed), each written whole on its
 * own. The record must be one of the locked place's. Every list is checked
 * before anything is written, so a view with one list the rule refuses leaves
 * the record's old view as it stood; a view written as it stands rewrites no
 * row, as on every run that reads what the last one read.
 */
export async function writeRecordPeriods(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  view: RecordPeriods,
  ofMembership = false,
): Promise<void> {
  const owned = await client.query('SELECT 1 FROM source_records WHERE id = $1 AND experience_id = $2', [recordId, lock.id]);
  if (owned.rowCount === 0) throw new RangeError(`placePeriodsWriter: record ${recordId} is not a record of place ${lock.id}`);
  if (ofMembership && PERIOD_SAYS.some((says) => !OF_A_KIND.includes(says) && (view[says]?.length ?? 0) > 0)) {
    throw new RangeError('placePeriodsWriter: a membership\'s own view holds only standing periods and closures');
  }
  const lists = PERIOD_SAYS.map((says) => ({ says, rows: rowsOf(says, checked(says, view[says] ?? [])) }));
  await client.query(
    `DELETE FROM record_periods r
      WHERE r.record_id = $1 AND r.of_membership = $3 AND r.ordinal > COALESCE(($2::jsonb ->> r.says)::int, 0)`,
    [recordId, JSON.stringify(Object.fromEntries(lists.map(({ says, rows }) => [says, rows.length]))), ofMembership],
  );
  const rows = lists.flatMap((list) => list.rows);
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO record_periods (record_id, of_membership, says, ordinal, ${COLUMN_NAMES.join(', ')})
     SELECT $1, $3, p.says, p.ordinal, ${columnsOf('p')}
       FROM ${recordset('$2')}
     ON CONFLICT (record_id, of_membership, says, ordinal) DO UPDATE
        SET ${SET_FROM_EXCLUDED}, read_at = NOW()
      WHERE ${differs('record_periods')}`,
    [recordId, JSON.stringify(rows), ofMembership],
  );
}

interface PeriodRow {
  says: PeriodSays;
  from_year: number | null; from_month: number | null; from_day: number | null; from_span: SourcedDate['span']; from_circa: boolean;
  from_property: string | null; from_statement: string | null;
  ended: boolean;
  until_year: number | null; until_month: number | null; until_day: number | null; until_span: SourcedDate['span']; until_circa: boolean;
  until_property: string | null; until_statement: string | null;
  ending: SourcedPeriod['ending']; what: string | null;
  source_id: number; decided_by: number | null;
}

const endOf = (
  year: number | null, month: number | null, day: number | null, span: SourcedDate['span'], circa: boolean,
  property: string | null, statement: string | null,
): SourcedDate | null => (year === null ? null : { year, month, day, span, circa, property, statement });

/**
 * The periods the place holds for every kind, by what they say: what a run's
 * gate compares its view with (`lifetimeWrites.ts`) and what a curator's
 * *lost* closes. A period of one membership is that membership's, never the
 * place's.
 */
export async function heldPeriodsOf(client: Pick<PoolClient, 'query'>, placeId: number): Promise<Partial<Record<PeriodSays, HeldPeriods>>> {
  const { rows } = await client.query<PeriodRow>(
    `SELECT says, from_year, from_month, from_day, from_span, from_circa, from_property, from_statement, ended,
            until_year, until_month, until_day, until_span, until_circa, until_property, until_statement,
            ending, what, source_id, decided_by
       FROM place_periods WHERE experience_id = $1 AND kind_id IS NULL ORDER BY says, ordinal`,
    [placeId],
  );
  const held: Partial<Record<PeriodSays, HeldPeriods>> = {};
  for (const says of PERIOD_SAYS) {
    const own = rows.filter((row) => row.says === says);
    if (own.length === 0) continue;
    held[says] = {
      sourceId: own[0].source_id,
      decidedBy: own.find((row) => row.decided_by !== null)?.decided_by ?? null,
      periods: own.map((row) => ({
        from: endOf(row.from_year, row.from_month, row.from_day, row.from_span, row.from_circa, row.from_property, row.from_statement),
        ended: row.ended,
        until: endOf(row.until_year, row.until_month, row.until_day, row.until_span, row.until_circa, row.until_property, row.until_statement),
        ending: row.ending,
        what: row.what,
      })),
    };
  }
  return held;
}

/**
 * Whether the locked place is gone (`placeGoneSql`), read in a statement of
 * its own once the lock is granted. The lock statement cannot say it: under
 * READ COMMITTED a statement that waited on the row lock reads the locked row
 * as it was committed, but `place_periods` as of the snapshot it began with,
 * from before the verdict it waited on.
 */
export async function placeGoneUnderLock(client: Pick<PoolClient, 'query'>, lock: LockedExperience): Promise<boolean> {
  const { rows } = await client.query<{ gone: boolean }>(
    `SELECT ${placeGoneSql('e')} AS gone FROM experiences e WHERE e.id = $1`, [lock.id],
  );
  return rows[0]?.gone === true;
}

/** A standing period that ended, its start and its end not known: a curator's *lost* on a place with no period. */
const ENDED_UNDATED: SourcedPeriod = { from: null, ended: true, until: null, ending: null, what: null };

/**
 * The standing periods once a curator says the place is gone: the open one
 * ends, at a date not known, and how is not said. One that begins on a day
 * still ahead is dropped instead, since no period both begins ahead and has
 * ended. A place with none is given one that ended, its start and end not
 * known (ADR-0217 decision 5).
 */
export function closedStanding(stood: readonly SourcedPeriod[], today: CalendarDay): readonly SourcedPeriod[] {
  const begun = stood.filter((period) => period.ended || standsBy([period], today));
  if (begun.length === 0) return [ENDED_UNDATED];
  return begun.map((period) => (period.ended ? period : { ...period, ended: true, until: null, ending: null }));
}

/**
 * The standing periods once a curator, or an admission pin, says the place
 * stands: the last one is open again. A list that only says the place ended,
 * with nothing known of when it stood, says nothing then and is not kept: an
 * admission pin reads it so on every run. A curator's word is written once and
 * kept, so it keeps a period of its own (`standingTakenBack`).
 */
export function reopenedStanding(stood: readonly SourcedPeriod[]): readonly SourcedPeriod[] {
  const last = stood.at(-1);
  if (!last || stood.some((period) => !period.ended)) return stood;
  if (stood.length === 1 && last.from === null) return [];
  return [...stood.slice(0, -1), { ...last, ended: false, until: null, ending: null }];
}

/** A standing period open since a date not known: a curator's word that a place stands, with nothing known of when it began. */
const OPEN_UNDATED: SourcedPeriod = { from: null, ended: false, until: null, ending: null, what: null };

/**
 * The standing periods once a curator takes a *lost* back: the last one open
 * again (`reopenedStanding`), or, where nothing would be left, one open since a
 * date not known. A list of none is no one's, so a run would write its view
 * over it; an open period of the curator's is kept. A Wikidata item that states
 * a demolition and no inception is read as one period that ended, its dates
 * not known, and the curator's *it was never gone* has to outlast the next
 * read of it.
 */
export function standingTakenBack(stood: readonly SourcedPeriod[]): readonly SourcedPeriod[] {
  const reopened = reopenedStanding(stood);
  return reopened.length > 0 ? reopened : [OPEN_UNDATED];
}

/**
 * A curator's word on whether the place still stands (ADR-0217 decision 5,
 * ADR-0225 slice B2): *lost* closes its standing (`closedStanding`), taking it
 * back opens it again (`standingTakenBack`). The list is written whole as the
 * curator's, with who decided and when, so a run that reports another view
 * keeps it (`lifetimeWrites.ts`). Nelson's Pillar, read as gone by its run,
 * stands again only on a curator's word; the Kakhovka Dam ends on one.
 */
export async function setPlaceGone(
  client: PoolClient,
  lock: LockedExperience,
  gone: boolean,
  decidedBy: number,
): Promise<void> {
  const stood = (await heldPeriodsOf(client, lock.id))[PLACE_STOOD]?.periods ?? [];
  const next = gone ? closedStanding(stood, latestDayOnEarth(new Date())) : standingTakenBack(stood);
  await writePlacePeriods(client, lock, PLACE_STOOD, next, { sourceId: CURATOR_SOURCE_ID, decidedBy });
}
