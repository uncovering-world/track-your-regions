/**
 * What a run writes of a place's periods (#2578, ADR-0217 decision 3): its
 * source's view on its record, always, and the place's own periods through
 * the gate. The gate decides a list whole per thing it says, the periods in
 * which the place stood as one field and the end of a use as another.
 *
 * - **A fill passes the gate** (the maintainer, 2026-11-15), as an item, a
 *   subtitle and a credit do (ADR-0129, ADR-0133, ADR-0151): a view that
 *   leaves every date the place holds as it is, and the place standing or
 *   not as it was, is written and filed as passed (`first-date`). The
 *   Cathedral of Christ the Saviour held as "1883 → open" and reported as
 *   "1883 → 1931, 2000 → open" is one.
 * - **Any other difference is asked** under a gated source where a reader
 *   sees the place: the run does not write it, and its record keeps the view
 *   it reports for the curator's answer. Under a trusted source, or on a
 *   place no reader sees yet, it is written as any other field is.
 * - **The end of the place's last standing period is never a fill**, since it
 *   takes the place off today's lists: under a gated source it is asked on a
 *   place readers see, and written with the arrival on a new one (Nelson's
 *   Pillar in Dublin, blown up in 1966, arrives with its end). A trusted
 *   source writes it on either.
 * - **A gap longer than a century is never a fill either** (`opensLongGap`).
 *   An item that states a destruction and a rebuilding more than a hundred
 *   years apart cannot say what stood in between: the Odeon of Herodes
 *   Atticus in Athens, destroyed in 267 and rebuilt by 1953, was a ruin
 *   travellers visited for all of that time, where Bethlehem Chapel in
 *   Prague, pulled down in 1786 and rebuilt by 1952, was not there. So the
 *   list is asked on a place readers see under a gated source, and written
 *   with the arrival on a new one.
 * - **A curator's admission pin wins over a derived end**: the curator kept
 *   the place where its item says it is gone (the Barmaley Fountain, whose
 *   replica stands since 2013), so the run reads its last standing period as
 *   open.
 * - **Periods another source set, or a curator set or claimed, are the
 *   place's to keep**: the run records its own view and leaves them.
 * - Periods the source no longer reports are taken off the place only where
 *   the source wrote them, by the same gate as any other difference.
 */

import type { PoolClient } from 'pg';
import {
  PERIOD_SAYS, periodOf, PLACE_STOOD, REPORTED_SAYS, samePlaceDate, standsBy, type PeriodSays,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from '../../db/experienceWriter.js';
import {
  writePlacePeriods, writeRecordPeriods, type RecordPeriods, type SourcedDate, type SourcedPeriod,
} from '../../db/placePeriodsWriter.js';
import type { ChangeSetResult, FieldChange } from './changeSet.js';

/** The periods a place holds that say one thing, with whose view they were taken from. */
export interface HeldPeriods {
  periods: readonly SourcedPeriod[];
  sourceId: number;
  /** The curator who set them, or null for a run's. */
  decidedBy: number | null;
}

/** What the gate needs to know of the run and the place. */
export interface LifetimeGate {
  sourceId: number;
  /** The source holds what it finds for a curator (`requires_curation`). */
  gated: boolean;
  /** A reader sees the place, so a gated source's change to it is held (`PLACE_HELD`). */
  held: boolean;
  /** A curator's claims on the place (`curated_fields`), what a list says among them. */
  claimed: readonly string[];
  /** A curator's admission pin keeps the run's own membership admitted (`admissionPinnedSql`). */
  pinned: boolean;
}

export interface LifetimeDecision {
  /** The lists the run writes onto the place, each whole; an empty one takes the place's off. */
  write: Partial<Record<PeriodSays, readonly SourcedPeriod[]>>;
  /** What it filed: every list it writes, a fill marked as passed. */
  changes: FieldChange[];
  /** What it holds back for a curator. */
  heldBack: PeriodSays[];
}

/** The same period: its dates, whether it ended, how, and what it is called. Where it was read from is not compared. */
const samePeriod = (a: SourcedPeriod, b: SourcedPeriod): boolean =>
  a.ended === b.ended && samePlaceDate(a.from, b.from) && samePlaceDate(a.until, b.until) && a.ending === b.ending && a.what === b.what;

const sameList = (a: readonly SourcedPeriod[], b: readonly SourcedPeriod[]): boolean =>
  a.length === b.length && a.every((period, index) => samePeriod(period, b[index]));

/**
 * Whether `next` only fills `held` in (ADR-0217 decision 3): no period fewer,
 * every start the place holds still a start, every end still an end and told
 * the same way where the place says how, an end with no date among them, and
 * the place standing or not as it was. A view that drops a held date, moves 1883 to 1881 or closes the last
 * standing period is not one.
 */
function fills(says: PeriodSays, held: readonly SourcedPeriod[], next: readonly SourcedPeriod[]): boolean {
  if (next.length < held.length) return false;
  if (says === PLACE_STOOD && standsBy(held) !== standsBy(next)) return false;
  const toldTheSame = (period: SourcedPeriod, other: SourcedPeriod): boolean =>
    other.ended && (period.ending === null || period.ending === other.ending);
  return held.every((period) =>
    (period.from === null || next.some((other) => samePlaceDate(period.from, other.from)))
    && (!period.ended || next.some((other) =>
      toldTheSame(period, other) && (period.until === null || samePlaceDate(period.until, other.until)))));
}

/** How long a gap in a place's standing a run may fill in unasked, in years. */
export const LONGEST_GAP_FILLED = 100;

/** The days of `LONGEST_GAP_FILLED` years, in the count `periodOf` orders days by: every month has 31. */
const LONGEST_GAP_DAYS = LONGEST_GAP_FILLED * 12 * 31;

/**
 * Whether `next` opens a gap in the place's standing that is certainly longer
 * than `LONGEST_GAP_FILLED` years and that the place does not hold: from the
 * last day one period may have ended to the first day the next may have
 * begun. A gap with an end not known has no length.
 */
function opensLongGap(held: readonly SourcedPeriod[], next: readonly SourcedPeriod[]): boolean {
  const holds = (until: SourcedDate, from: SourcedDate) => held.some((period, index) =>
    samePlaceDate(period.until, until) && samePlaceDate(held[index + 1]?.from ?? null, from));
  return next.some((period, index) => {
    const until = period.until;
    const from = next[index + 1]?.from;
    if (!until || !from || holds(until, from)) return false;
    return periodOf(from).first - periodOf(until).last > LONGEST_GAP_DAYS;
  });
}

/**
 * The standing periods a pinned place is read by: the curator's pin says the
 * place stands, so its last period is open whatever end the source reports.
 * A period left with nothing known of it says nothing and is not kept.
 */
function keptStanding(stood: readonly SourcedPeriod[]): readonly SourcedPeriod[] {
  const last = stood.at(-1);
  if (!last || standsBy(stood)) return stood;
  if (stood.length === 1 && last.from === null) return [];
  return [...stood.slice(0, -1), { ...last, ended: false, until: null, ending: null }];
}

/** A list as the change set files it: the periods, or null for none. */
const filed = (periods: readonly SourcedPeriod[]): readonly SourcedPeriod[] | null => (periods.length > 0 ? periods : null);

/** What the gate does with one list: nothing, hold it back, or write the run's, as a fill or as a change. */
function listAction(says: PeriodSays, next: readonly SourcedPeriod[], held: HeldPeriods | undefined, gate: LifetimeGate) {
  if (gate.claimed.includes(says)) return 'keep';
  if (held && (held.sourceId !== gate.sourceId || held.decidedBy !== null)) return 'keep';
  const stored = held?.periods ?? [];
  if (sameList(stored, next)) return 'keep';
  if (fills(says, stored, next) && !(says === PLACE_STOOD && opensLongGap(stored, next))) return 'fill';
  return gate.gated && gate.held ? 'hold' : 'write';
}

/** The gate over one place: what of the run's view it writes and holds back. Pure. */
export function decideLifetime(
  stored: Partial<Record<PeriodSays, HeldPeriods>>,
  view: RecordPeriods,
  gate: LifetimeGate,
): LifetimeDecision {
  const decision: LifetimeDecision = { write: {}, changes: [], heldBack: [] };
  for (const says of REPORTED_SAYS) {
    const reported = view[says] ?? [];
    const next = says === PLACE_STOOD && gate.pinned ? keptStanding(reported) : reported;
    const held = stored[says];
    const action = listAction(says, next, held, gate);
    if (action === 'hold') decision.heldBack.push(says);
    if (action !== 'fill' && action !== 'write') continue;
    decision.write[says] = next;
    decision.changes.push({
      field: says, old: filed(held?.periods ?? []), new: filed(next), significance: 'minor', curatedConflict: false, held: false,
      ...(action === 'fill' ? { passedTheGate: 'first-date' as const } : {}),
    });
  }
  return decision;
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

/** The periods the place holds, by what they say, as the gate compares them. */
export async function heldPeriodsOf(client: Pick<PoolClient, 'query'>, placeId: number): Promise<Partial<Record<PeriodSays, HeldPeriods>>> {
  const { rows } = await client.query<PeriodRow>(
    `SELECT says, from_year, from_month, from_day, from_span, from_circa, from_property, from_statement, ended,
            until_year, until_month, until_day, until_span, until_circa, until_property, until_statement,
            ending, what, source_id, decided_by
       FROM place_periods WHERE experience_id = $1 ORDER BY says, ordinal`,
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
 * Write the run's view of the place's periods on its record, and the place's
 * periods the gate lets through, under the place's lock. Returns the
 * decision, whose changes the caller files on the run's change set.
 */
export async function writeLifetime(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  view: RecordPeriods,
  gate: LifetimeGate,
): Promise<LifetimeDecision> {
  await writeRecordPeriods(client, lock, recordId, view);
  const decision = decideLifetime(await heldPeriodsOf(client, lock.id), view, gate);
  for (const says of REPORTED_SAYS) {
    const periods = decision.write[says];
    if (periods) await writePlacePeriods(client, lock, says, periods, { sourceId: gate.sourceId, decidedBy: null });
  }
  return decision;
}

/**
 * The run's change set with what it wrote of the place's periods: an object
 * whose only write is a period is updated, as for any other field.
 */
export function withLifetimeChanges(changeSet: ChangeSetResult, decision: LifetimeDecision): ChangeSetResult {
  if (decision.changes.length === 0) return changeSet;
  return {
    ...changeSet,
    changedFields: [...changeSet.changedFields, ...decision.changes],
    changeType: changeSet.changeType === 'created' ? 'created' : 'updated',
    significance: changeSet.significance ?? 'minor',
  };
}
