/**
 * Admission — whether a kind accepts a place, independent of whether the
 * source still lists it (ADR-0024). Written on the place's membership in the
 * kind since #822 (ADR-0045 decision 4), and on the membership the run's own
 * source brought: a run refuses, restores and badges what it brought, and
 * nothing another source did.
 *
 * The two axes ADR-0020 defined are statements about the world: `former` says
 * the source stopped listing the object, `lost` says it no longer exists.
 * Neither is true of the British Museum, which stands open and which Wikidata
 * goes on listing — what changed is that *Art Museums* holds art museums
 * and that one is an archaeological collection. One column cannot say both, so
 * this is a third axis rather than a third value.
 *
 * Unlike the other two, the machine writes this one. ADR-0020 reserved them for
 * curators because a machine observation is ambiguous — absence may mean the
 * run did not look everywhere. A refusal is not an observation: it is our own
 * rule, applied to data we hold, naming the object before it says no, and
 * re-running it gives the same answer. A curator who disagrees pins
 * `admission` in the membership's `curated_fields`, and every write to
 * `admission` here skips the row.
 *
 * Four operations, and the order they run in matters:
 *
 *   1. `markRefused` — the run named it and a rule said no. Unconditional: no
 *      coverage floor or error count makes a named refusal less true.
 *   2. `restoreAdmission` — this run admits it after all, so the refusal is lifted.
 *   3. `markNotAdmitted` — the sweep, for a source that recomputes its whole
 *      membership each run. Guarded, because "not in the admitted set" is the
 *      ambiguous kind of statement again: a broken SPARQL day must not blank a
 *      catalogue.
 *   4. `markIconic` — the must-see badge on the memberships the run admits, for
 *      a source whose admission rule is the badge. The one write here that is
 *      about the flag rather than about admission, and so honours the flag's
 *      own pin rather than admission's: a membership a curator overrode is
 *      badged, since the curator admitted it and the rule would badge it.
 *
 * Steps 2 and 3 are order-independent: restore matches `admission = 'refused'
 * AND external_id = ANY(seen)` and the sweep matches `admission = 'admitted' AND
 * external_id <> ALL(seen)`, so the two can never see the same row whichever
 * runs first.
 *
 * Two orders *are* load-bearing. `markRefused` before `restoreAdmission`: those
 * two can collide — a venue can be named in a run's filtered list and also be
 * one the run admits, which is what an unbroken fold cycle produces — and when
 * they do, the run's own admission has to be the answer that stands. Reversed,
 * the row would end the run refused and hidden until the next one. And
 * `restoreAdmission` before `markIconic`: the badge reads `admission`, and
 * reads it as a settled answer only once the refusals this run lifts are
 * lifted (#760).
 *
 * The sweep is what reaches a row whose *identity* moved. `Roman Forum and the
 * Palatine` (Q55685908) was placed by one run and refused by the next under a
 * different Wikidata item for the same ground; the refusal names the new id,
 * and matching by external id can never reach the stale row.
 *
 * Every statement joins the membership to its place: the run names rows by
 * the source's own id, which is the place's `external_id` until #755 moves it
 * onto the membership, and what it returns is the place — the id the
 * changeset keys on and the name a curator reads.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, admissionPinnedSql, iconicPinnedSql } from '../../db/membership.js';

// The pins are the membership's since #822 and are spelled in db/membership.ts,
// where every reader of them can reach them; re-exported here so the writers
// and their guards keep one import.
export { admissionPinnedSql, iconicPinnedSql };

/** An object the run named and a rule turned down. */
export interface Refusal {
  externalId: string;
  reason: string;
}

/** A row one of these operations moved, enough to key a changeset entry to it. */
export interface AdmissionRow {
  id: number;
  externalId: string;
  name: string;
}

export interface AdmissionSweepInput {
  errors: number;
  cancelled: boolean;
  /** External ids this run admitted. */
  admittedCount: number;
  /** How many the source held as admitted before the run touched it. */
  previousAdmittedCount: number;
}

/**
 * How far the admitted set may shrink in one run before the sweep refuses to
 * act. ADR-0022's "no run may empty a source", applied to this axis.
 *
 * Looser than missing detection's 90 %, deliberately. That floor guards a
 * *listing*, where a 10 % drop means the source misbehaved. This one guards a
 * *rule*, and a rule is supposed to change the set — the art test alone moved
 * 110 rows to 82 in a single run, which is 75 % and entirely correct.
 */
export const ADMISSION_SWEEP_MIN_SHARE = 0.5;

/**
 * Why the sweep must not run, or null when it may.
 */
export function admissionSweepSkipReason(input: AdmissionSweepInput): string | null {
  if (input.cancelled) {
    return 'run was cancelled before it could compute the whole membership';
  }
  if (input.errors > 0) {
    return `run finished with ${input.errors} error(s), so an absent row may be a fetch failure`;
  }
  if (input.admittedCount === 0) {
    return 'run admitted nothing, which is a broken run rather than an empty source';
  }
  if (input.previousAdmittedCount === 0) {
    return null;
  }
  const share = input.admittedCount / input.previousAdmittedCount;
  if (share < ADMISSION_SWEEP_MIN_SHARE) {
    return `admitted ${(share * 100).toFixed(1)}% of the previous set, below the `
      + `${ADMISSION_SWEEP_MIN_SHARE * 100}% floor`;
  }
  return null;
}

/** The membership the run's source brought, joined to its place. */
const SOURCE_MEMBERSHIPS = `${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id`;

/**
 * How many rows the source currently admits. Read before the run writes, so
 * it is the denominator the sweep guard compares against.
 */
export async function countAdmitted(sourceId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ${SOURCE_MEMBERSHIPS}
     WHERE m.source_id = $1
       AND m.admission = 'admitted'
       AND e.is_manual = FALSE`,
    [sourceId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Which rows the source currently admits, by the id the source knows them
 * by. What a rule with hysteresis reads its stay line against: a row already
 * in is kept above a lower line than one entering, and only the table knows
 * who is in. A curator's own row is excluded for the reason `UNPROTECTED`
 * spells out — its key can never appear in a source's answer.
 */
export async function admittedExternalIds(sourceId: number): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT e.external_id
     FROM ${SOURCE_MEMBERSHIPS}
     WHERE m.source_id = $1
       AND m.admission = 'admitted'
       AND e.is_manual = FALSE`,
    [sourceId]
  );
  return new Set(result.rows.map((row: { external_id: string }) => row.external_id));
}

/**
 * Rows this mechanism may not touch, over the membership `m` and its place
 * `e` — the aliases every statement here joins under.
 *
 * Two exclusions, for unrelated reasons:
 *
 * - **A curator's pin.** The answer a confirmation or an override leaves on
 *   the membership, which every write here honours (`admissionPinnedSql`).
 * - **A curator-created row.** Its `curator-<id>-<ts>` key can never appear in
 *   a source's answer, so measuring it against one would refuse the curator's
 *   own work on every clean run.
 */
const UNPROTECTED = `e.is_manual = FALSE
      AND NOT ${admissionPinnedSql('m')}`;

const RETURNING = 'e.id, e.external_id, e.name';

function rowsFrom(result: { rows: { id: number; external_id: string; name: string }[] }): AdmissionRow[] {
  return result.rows.map((row) => ({ id: row.id, externalId: row.external_id, name: row.name }));
}

/**
 * Clearing the must-see flag alongside a refusal, on the membership `m`.
 *
 * A museum carries `is_iconic` because it holds a work above the threshold, and
 * a kind that has turned the membership down is no longer making that claim.
 * It is invisible while the membership stays hidden — and wrong the moment a
 * curator puts it back, which would restore a highlight for a work the row no
 * longer holds.
 *
 * The flag has its own curator pin, honoured separately from admission's: a
 * person who marked this must-see goes on saying so, whatever the rule decided.
 *
 * Shared with the curator's confirmation of a refusal (`setExperienceAdmission`),
 * which is the one refusal write after which no run reaches the row: the pin it
 * sets is what `UNPROTECTED` honours, so whatever the flag holds at that moment
 * is what it holds for good. Eight museums refused on the day these writes
 * landed kept the flag exactly that way until migration 042 cleared them
 * (#760); `refused-row-wearing-iconic` in Catalogue Checks is what would name
 * the next one.
 */
export const CLEAR_ICONIC = `is_iconic = CASE
        WHEN ${iconicPinnedSql('m')} THEN m.is_iconic
        ELSE false END`;

/**
 * Badge the memberships this run admits — the fourth writer of the flag, kept
 * beside the three that take it away, and run after `restoreAdmission` on
 * purpose.
 *
 * Every museum works-first admits holds a work above the fame line, so the flag
 * is a property of belonging to the kind rather than a field the source
 * proposes — which is why it is written here and not through the
 * curated_fields-aware upsert, and outside the changeset: nothing sets it by
 * hand yet, but the moment a curation surface does, a run writing `true` over
 * a curator's `false` would show up in no record of its own, so the pin is
 * honoured now (`iconicPinnedSql`).
 *
 * After the restore step rather than per item, because that is when
 * `admission` is a settled answer. Mid-run it is stale two ways: a refusal
 * nobody confirmed that this run selects again is still `refused` until
 * `restoreAdmission` lifts it, and a refusal a curator confirmed stays
 * `refused` for good — the collector reads live Wikidata and consults
 * `admission` nowhere, so a later run can select such a museum, and the
 * per-item write this replaces badged it. Asked here, `admission = 'admitted'`
 * covers both: the lifted refusal is admitted by now, the confirmed one is
 * not. And a run that stops before this step — a cancel exits ahead of the
 * sweep step, as does any throw — writes no badge at all, rather than one on
 * a row whose admission it never settled; the next complete run writes it,
 * which is the one-run delay ADR-0045 decision 5 already calls a legitimate
 * state (#760).
 *
 * A preview writes no row and reports none, as the per-item write did not.
 */
export async function markIconic(
  sourceId: number,
  admittedExternalIds: string[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (admittedExternalIds.length === 0 || dryRun) return [];

  const result = await pool.query(
    `UPDATE ${MEMBERSHIPS} m SET is_iconic = true, updated_at = NOW()
       FROM experiences e
      WHERE e.id = m.experience_id
        AND m.source_id = $1
        AND e.external_id = ANY($2::text[])
        AND m.admission = 'admitted'
        AND NOT m.is_iconic
        AND NOT ${iconicPinnedSql('m')}
  RETURNING ${RETURNING}`,
    [sourceId, admittedExternalIds],
  );
  return rowsFrom(result);
}

/**
 * Refuse the rows this run named and turned down, each with the rule's own
 * reason.
 *
 * The reason lands on the membership rather than only in
 * `experience_sync_changes`, because a changeset entry is keyed by the external
 * id the run named and the curator reads it from the row.
 */
export async function markRefused(
  sourceId: number,
  refusals: Refusal[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (refusals.length === 0) return [];

  const externalIds = refusals.map((r) => r.externalId);
  const reasons = refusals.map((r) => r.reason);
  const named = `(SELECT UNNEST($2::text[]) AS external_id, UNNEST($3::text[]) AS reason) v`;
  const predicate = `m.source_id = $1
      AND e.external_id = v.external_id
      AND ${UNPROTECTED}`;

  const result = dryRun
    ? await pool.query(
        `SELECT ${RETURNING} FROM ${SOURCE_MEMBERSHIPS}, ${named} WHERE ${predicate}`,
        [sourceId, externalIds, reasons]
      )
    : await pool.query(
        `UPDATE ${MEMBERSHIPS} m
            SET admission = 'refused', admission_reason = v.reason,
                ${CLEAR_ICONIC},
                updated_at = NOW()
           FROM experiences e, ${named}
          WHERE e.id = m.experience_id
            AND ${predicate}
      RETURNING ${RETURNING}`,
        [sourceId, externalIds, reasons]
      );

  return rowsFrom(result);
}

/**
 * Give back admission to a row this run admits.
 *
 * Without this the axis is a one-way door: a rule that widens, or a source that
 * corrects itself, would leave the row refused for ever. ADR-0021 made the same
 * point for `source_membership`.
 *
 * Runs after `markRefused` so that a row this run both named as filtered and
 * admitted ends the run admitted. It does not need to run before the sweep —
 * their predicates are disjoint — though it still does.
 */
export async function restoreAdmission(
  sourceId: number,
  admittedExternalIds: string[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (admittedExternalIds.length === 0) return [];

  const predicate = `m.source_id = $1
      AND m.admission = 'refused'
      AND ${UNPROTECTED}
      AND e.external_id = ANY($2::text[])`;

  const result = dryRun
    ? await pool.query(
        `SELECT ${RETURNING} FROM ${SOURCE_MEMBERSHIPS} WHERE ${predicate}`,
        [sourceId, admittedExternalIds]
      )
    : await pool.query(
        `UPDATE ${MEMBERSHIPS} m
            SET admission = 'admitted', admission_reason = NULL, updated_at = NOW()
           FROM experiences e
          WHERE e.id = m.experience_id
            AND ${predicate}
      RETURNING ${RETURNING}`,
        [sourceId, admittedExternalIds]
      );

  return rowsFrom(result);
}

/**
 * The sweep: refuse every row the source still admits that this run did not.
 *
 * Scoped to memberships currently `admitted`, so a row refused by name earlier
 * in the same run keeps the specific reason its rule gave rather than having
 * it overwritten by this generic one.
 *
 * Call only when `admissionSweepSkipReason` returns null, and only for a source
 * that recomputes its whole membership. An empty admitted set is refused here
 * as well as by the guard, because `external_id <> ALL('{}')` is true of every
 * row and would refuse the source wholesale.
 */
export async function markNotAdmitted(
  sourceId: number,
  admittedExternalIds: string[],
  reason: string,
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (admittedExternalIds.length === 0) return [];

  const predicate = `m.source_id = $1
      AND m.admission = 'admitted'
      AND ${UNPROTECTED}
      AND e.external_id <> ALL($2::text[])`;

  const result = dryRun
    ? await pool.query(
        `SELECT ${RETURNING} FROM ${SOURCE_MEMBERSHIPS} WHERE ${predicate}`,
        [sourceId, admittedExternalIds]
      )
    : await pool.query(
        `UPDATE ${MEMBERSHIPS} m
            SET admission = 'refused', admission_reason = $3,
                ${CLEAR_ICONIC},
                updated_at = NOW()
           FROM experiences e
          WHERE e.id = m.experience_id
            AND ${predicate}
      RETURNING ${RETURNING}`,
        [sourceId, admittedExternalIds, reason]
      );

  return rowsFrom(result);
}
