/**
 * What a run writes of a place's lifetime (#1719, ADR-0214 decision 4): its
 * source's view on its record, always, and the place's own dates through the
 * gate.
 *
 * - **A date filled where the place held none passes the gate** (the
 *   maintainer, 2026-11-15), as an item, a subtitle and a credit do (ADR-0129,
 *   ADR-0133, ADR-0151): written, and filed as passed (`first-date`).
 * - **A change to a date the place holds is asked** under a gated source where
 *   a reader sees the place: the run does not write it, its record keeps the
 *   date it reports, and the run files it as a held field, which raises the
 *   review queue's held card as a held name does. Under a trusted source, or on
 *   a place no reader sees yet, it is written as any other field is.
 * - **An end is always asked under a gated source**, since it takes the place
 *   off today's lists: never written by such a run, filled or changed. On a
 *   place a reader sees it is filed as held, and so asked; on one no reader
 *   sees yet it is only kept back.
 * - **A curator's admission pin wins over a derived end**: the curator kept the
 *   place where its item says it is gone (the Barmaley Fountain, whose replica
 *   stands since 2013), so the run writes no end of it.
 * - **A date another source set, or a curator claimed, is the place's to
 *   keep**: the run records its own view and leaves it.
 * - A date the source no longer reports is taken off the place only where the
 *   source wrote it, by the same gate as a change.
 */

import type { PoolClient } from 'pg';
import { LIFETIME_SLOTS, PLACE_END, samePlaceDate, type LifetimeSlot } from '@tyr/shared/lifetime';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { clearPlaceDate, writePlaceDate, writeRecordDates, type RecordDates, type SourcedDate } from '../../db/placeDatesWriter.js';
import type { ChangeSetResult, FieldChange } from './changeSet.js';

/** A date the place holds, with whose view it was taken from and whether a curator set it. */
export interface HeldDate extends SourcedDate {
  sourceId: number;
  decidedBy: number | null;
}

/** What the gate needs to know of the run and the place. */
export interface LifetimeGate {
  sourceId: number;
  /** The source holds what it finds for a curator (`requires_curation`). */
  gated: boolean;
  /** A reader sees the place, so a gated source's change to it is held (`PLACE_HELD`). */
  held: boolean;
  /** A curator's claims on the place (`curated_fields`), a slot's name among them. */
  claimed: readonly string[];
  /** A curator's admission pin keeps the run's own membership admitted (`admissionPinnedSql`). */
  pinned: boolean;
}

export interface LifetimeDecision {
  /** The dates the run writes onto the place. */
  write: Partial<Record<LifetimeSlot, SourcedDate>>;
  /** The slots it takes off the place. */
  clear: LifetimeSlot[];
  /** What it filed: every write and clear, a fill marked as passed. */
  changes: FieldChange[];
  /**
   * What it holds back where a reader sees the place, filed as held: the date
   * the place holds and the one the source reports, which the held card shows
   * and publishing writes (`heldPlaceDates.ts`).
   */
  held: FieldChange[];
}

/** A date as the change set files it: the date and where it was read, not whose view the place took it from. */
const filedDate = (date: SourcedDate | undefined): SourcedDate | null => (date ? {
  year: date.year, month: date.month, day: date.day, span: date.span, circa: date.circa,
  ending: date.ending, property: date.property, statement: date.statement,
} : null);

const change = (slot: LifetimeSlot, old: SourcedDate | undefined, next: SourcedDate | undefined): FieldChange => ({
  field: slot, old: filedDate(old), new: filedDate(next), significance: 'minor', curatedConflict: false, held: false,
  ...(old === undefined ? { passedTheGate: 'first-date' as const } : {}),
});

/** A date held back for a curator; an end weighs as major, since publishing it takes the place off today's lists. */
const heldChange = (slot: LifetimeSlot, old: SourcedDate | undefined, next: SourcedDate | undefined): FieldChange => ({
  field: slot, old: filedDate(old), new: filedDate(next),
  significance: slot === PLACE_END ? 'major' : 'minor', curatedConflict: false, held: true,
});

/** The same date and, on an end, the same telling of how the place ended. */
const sameSourcedDate = (a: SourcedDate, b: SourcedDate): boolean => samePlaceDate(a, b) && a.ending === b.ending;

/** What the gate does with one slot: nothing, hold it back, write the run's date, or take the place's off. */
function slotAction(slot: LifetimeSlot, next: SourcedDate | undefined, held: HeldDate | undefined, gate: LifetimeGate) {
  if (gate.claimed.includes(slot)) return 'keep';
  if (held && (held.sourceId !== gate.sourceId || held.decidedBy !== null)) return 'keep';
  if (next === undefined ? held === undefined : held !== undefined && sameSourcedDate(next, held)) return 'keep';
  if (gate.gated && (slot === PLACE_END || (held !== undefined && gate.held))) return 'hold';
  return next === undefined ? 'clear' : 'write';
}

/** The gate over one place: what of the run's view it writes, clears and holds back. Pure. */
export function decideLifetime(
  stored: Partial<Record<LifetimeSlot, HeldDate>>,
  view: RecordDates,
  gate: LifetimeGate,
): LifetimeDecision {
  const decision: LifetimeDecision = { write: {}, clear: [], changes: [], held: [] };
  for (const slot of LIFETIME_SLOTS) {
    const next = slot === PLACE_END && gate.pinned ? undefined : view[slot];
    const held = stored[slot];
    const action = slotAction(slot, next, held, gate);
    if (action === 'hold' && gate.held) decision.held.push(heldChange(slot, held, next));
    if (action === 'write' && next !== undefined) decision.write[slot] = next;
    if (action === 'clear') decision.clear.push(slot);
    if (action === 'write' || action === 'clear') decision.changes.push(change(slot, held, next));
  }
  return decision;
}

/** The dates the place holds, as the gate compares them. */
export async function heldDatesOf(client: Pick<PoolClient, 'query'>, placeId: number): Promise<Partial<Record<LifetimeSlot, HeldDate>>> {
  const rows = await client.query<HeldDate & { slot: LifetimeSlot }>(
    `SELECT slot, year, month, day, span, circa, ending, property, statement,
            source_id AS "sourceId", decided_by AS "decidedBy"
       FROM place_dates WHERE experience_id = $1`,
    [placeId],
  );
  return Object.fromEntries(rows.rows.map(({ slot, ...date }) => [slot, date]));
}

/**
 * Write the run's view of the place's lifetime on its record, and the place's
 * dates the gate lets through, under the place's lock. Returns the decision,
 * whose changes the caller files on the run's change set.
 */
export async function writeLifetime(
  client: PoolClient,
  lock: LockedExperience,
  recordId: number,
  view: RecordDates,
  gate: LifetimeGate,
): Promise<LifetimeDecision> {
  await writeRecordDates(client, lock, recordId, view);
  const decision = decideLifetime(await heldDatesOf(client, lock.id), view, gate);
  for (const [slot, date] of Object.entries(decision.write) as [LifetimeSlot, SourcedDate][]) {
    await writePlaceDate(client, lock, slot, { ...date, sourceId: gate.sourceId, decidedBy: null });
  }
  for (const slot of decision.clear) await clearPlaceDate(client, lock, slot);
  return decision;
}

/**
 * The run's change set with what it wrote of the place's dates and what it
 * held back: an object whose only write is a date is updated, as for any other
 * field, and one whose only proposal is a held date is unchanged and holds it.
 */
export function withLifetimeChanges(changeSet: ChangeSetResult, decision: LifetimeDecision): ChangeSetResult {
  const filed = [...decision.changes, ...decision.held];
  if (filed.length === 0) return changeSet;
  const wrote = decision.changes.length > 0 && changeSet.changeType !== 'created';
  return {
    ...changeSet,
    changedFields: [...changeSet.changedFields, ...decision.changes],
    heldFields: [...changeSet.heldFields, ...decision.held],
    changeType: wrote ? 'updated' : changeSet.changeType,
    significance: changeSet.significance === 'major' || filed.some((f) => f.significance === 'major') ? 'major' : 'minor',
  };
}
