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
  latestDayOnEarth, periodOf, PLACE_STOOD, REPORTED_SAYS, samePlaceDate, standsBy,
  type CalendarDay, type PeriodSays,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from '../../db/experienceWriter.js';
import {
  heldPeriodsOf, reopenedStanding, writePlacePeriods, writeRecordPeriods,
  type HeldPeriods, type RecordPeriods, type SourcedDate, type SourcedPeriod,
} from '../../db/placePeriodsWriter.js';
import type { ChangeSetResult, FieldChange } from './changeSet.js';

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
 * the place standing or not today as it was. A view that drops a held date, moves 1883 to 1881, closes the last
 * standing period or opens the place's only one on a day still ahead (a museum
 * with no period, reported as opening on 1 May 2027) is not one.
 */
function fills(says: PeriodSays, held: readonly SourcedPeriod[], next: readonly SourcedPeriod[], today: CalendarDay): boolean {
  if (next.length < held.length) return false;
  if (says === PLACE_STOOD && standsBy(held, today) !== standsBy(next, today)) return false;
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

/** A list as the change set files it: the periods, or null for none. */
const filed = (periods: readonly SourcedPeriod[]): readonly SourcedPeriod[] | null => (periods.length > 0 ? periods : null);

/** What the gate does with one list: nothing, hold it back, or write the run's, as a fill or as a change. */
function listAction(
  says: PeriodSays, next: readonly SourcedPeriod[], held: HeldPeriods | undefined, gate: LifetimeGate, today: CalendarDay,
) {
  if (gate.claimed.includes(says)) return 'keep';
  if (held && (held.sourceId !== gate.sourceId || held.decidedBy !== null)) return 'keep';
  const stored = held?.periods ?? [];
  if (sameList(stored, next)) return 'keep';
  if (fills(says, stored, next, today) && !(says === PLACE_STOOD && opensLongGap(stored, next))) return 'fill';
  return gate.gated && gate.held ? 'hold' : 'write';
}

/**
 * The gate over one place: what of the run's view it writes and holds back,
 * with the place's standing read on `today`, the day the schema derives it on.
 * Pure but for that default.
 */
export function decideLifetime(
  stored: Partial<Record<PeriodSays, HeldPeriods>>,
  view: RecordPeriods,
  gate: LifetimeGate,
  today: CalendarDay = latestDayOnEarth(new Date()),
): LifetimeDecision {
  const decision: LifetimeDecision = { write: {}, changes: [], heldBack: [] };
  for (const says of REPORTED_SAYS) {
    const reported = view[says] ?? [];
    const next = says === PLACE_STOOD && gate.pinned ? reopenedStanding(reported) : reported;
    const held = stored[says];
    const action = listAction(says, next, held, gate, today);
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
