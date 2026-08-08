/**
 * Admission — whether a category accepts a row, independent of whether the
 * source still lists it (ADR-0024).
 *
 * The two axes ADR-0020 defined are statements about the world: `former` says
 * the source stopped listing the object, `lost` says it no longer exists.
 * Neither is true of the British Museum, which stands open and which Wikidata
 * goes on listing — what changed is that *Top Art Museums* holds art museums
 * and that one is an archaeological collection. One column cannot say both, so
 * this is a third axis rather than a third value.
 *
 * Unlike the other two, the machine writes this one. ADR-0020 reserved them for
 * curators because a machine observation is ambiguous — absence may mean the
 * run did not look everywhere. A refusal is not an observation: it is our own
 * rule, applied to data we hold, naming the object before it says no, and
 * re-running it gives the same answer. A curator who disagrees pins
 * `admission` in `curated_fields`, and every write here skips the row.
 *
 * Three operations, and the order they run in matters:
 *
 *   1. `markRefused` — the run named it and a rule said no. Unconditional: no
 *      coverage floor or error count makes a named refusal less true.
 *   2. `restoreAdmission` — this run admits it after all, so the refusal is lifted.
 *   3. `markNotAdmitted` — the sweep, for a source that recomputes its whole
 *      membership each run. Guarded, because "not in the admitted set" is the
 *      ambiguous kind of statement again: a broken SPARQL day must not blank a
 *      catalogue.
 *
 * Steps 2 and 3 are order-independent: restore matches `admission = 'refused'
 * AND external_id = ANY(seen)` and the sweep matches `admission = 'admitted' AND
 * external_id <> ALL(seen)`, so the two can never see the same row whichever
 * runs first.
 *
 * The order that *is* load-bearing is `markRefused` before `restoreAdmission`.
 * Those two can collide — a venue can be named in a run's filtered list and also
 * be one the run admits, which is what an unbroken fold cycle produces — and
 * when they do, the run's own admission has to be the answer that stands.
 * Reversed, the row would end the run refused and hidden until the next one.
 *
 * The sweep is what reaches a row whose *identity* moved. `Roman Forum and the
 * Palatine` (Q55685908) was placed by one run and refused by the next under a
 * different Wikidata item for the same ground; the refusal names the new id,
 * and matching by external id can never reach the stale row.
 */

import { pool } from '../../db/index.js';

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
  /** How many the category held as admitted before the run touched it. */
  previousAdmittedCount: number;
}

/**
 * How far the admitted set may shrink in one run before the sweep refuses to
 * act. ADR-0022's "no run may empty a category", applied to this axis.
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
    return 'run admitted nothing, which is a broken run rather than an empty category';
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

/**
 * How many rows the category currently admits. Read before the run writes, so
 * it is the denominator the sweep guard compares against.
 */
export async function countAdmitted(categoryId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM experiences
     WHERE category_id = $1
       AND admission = 'admitted'
       AND is_manual = FALSE`,
    [categoryId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Rows this mechanism may not touch, qualified by table name so the fragment
 * reads the same inside an `UPDATE … FROM`, where a bare column would be
 * ambiguous.
 *
 * Two exclusions, for unrelated reasons:
 *
 * - **A curator's pin.** Written out rather than inlined because the naive form
 *   is wrong in a way that reads as correct: `curated_fields` is nullable, and
 *   `NULL ? 'admission'` is `NULL`, so `NOT (curated_fields ? 'admission')`
 *   silently skips every row nobody has ever curated — which is all of them.
 * - **A curator-created row.** Its `curator-<id>-<ts>` key can never appear in
 *   a source's answer, so measuring it against one would refuse the curator's
 *   own work on every clean run.
 */
const UNPROTECTED = `experiences.is_manual = FALSE
      AND NOT COALESCE(experiences.curated_fields ? 'admission', false)`;

function rowsFrom(result: { rows: { id: number; external_id: string; name: string }[] }): AdmissionRow[] {
  return result.rows.map((row) => ({ id: row.id, externalId: row.external_id, name: row.name }));
}

/**
 * Clearing the must-see flag alongside a refusal.
 *
 * A museum carries `is_iconic` because it holds a work above the threshold, and
 * a category that has turned the row down is no longer making that claim. It is
 * invisible while the row stays hidden — and wrong the moment a curator puts it
 * back, which would restore a highlight for a work the row no longer holds.
 *
 * The flag has its own curator pin, honoured separately from admission's: a
 * person who marked this must-see goes on saying so, whatever the rule decided.
 */
const CLEAR_ICONIC = `is_iconic = CASE
        WHEN COALESCE(experiences.curated_fields ? 'is_iconic', false) THEN experiences.is_iconic
        ELSE false END`;

/**
 * Refuse the rows this run named and turned down, each with the rule's own
 * reason.
 *
 * The reason lands on the row rather than only in `experience_sync_changes`,
 * because a changeset entry is keyed by the external id the run named and the
 * curator reads it from the row.
 */
export async function markRefused(
  categoryId: number,
  refusals: Refusal[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (refusals.length === 0) return [];

  const externalIds = refusals.map((r) => r.externalId);
  const reasons = refusals.map((r) => r.reason);
  const named = `(SELECT UNNEST($2::text[]) AS external_id, UNNEST($3::text[]) AS reason) v`;
  const predicate = `experiences.category_id = $1
      AND experiences.external_id = v.external_id
      AND ${UNPROTECTED}`;
  const returning = 'experiences.id, experiences.external_id, experiences.name';

  const result = dryRun
    ? await pool.query(
        `SELECT ${returning} FROM experiences, ${named} WHERE ${predicate}`,
        [categoryId, externalIds, reasons]
      )
    : await pool.query(
        `UPDATE experiences
            SET admission = 'refused', admission_reason = v.reason,
                ${CLEAR_ICONIC}
           FROM ${named}
          WHERE ${predicate}
      RETURNING ${returning}`,
        [categoryId, externalIds, reasons]
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
  categoryId: number,
  admittedExternalIds: string[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (admittedExternalIds.length === 0) return [];

  const predicate = `experiences.category_id = $1
      AND experiences.admission = 'refused'
      AND ${UNPROTECTED}
      AND experiences.external_id = ANY($2::text[])`;

  const result = dryRun
    ? await pool.query(
        `SELECT id, external_id, name FROM experiences WHERE ${predicate}`,
        [categoryId, admittedExternalIds]
      )
    : await pool.query(
        `UPDATE experiences SET admission = 'admitted', admission_reason = NULL
          WHERE ${predicate}
      RETURNING id, external_id, name`,
        [categoryId, admittedExternalIds]
      );

  return rowsFrom(result);
}

/**
 * The sweep: refuse every row the category still admits that this run did not.
 *
 * Scoped to rows currently `admitted`, so a row refused by name earlier in the
 * same run keeps the specific reason its rule gave rather than having it
 * overwritten by this generic one.
 *
 * Call only when `admissionSweepSkipReason` returns null, and only for a source
 * that recomputes its whole membership. An empty admitted set is refused here
 * as well as by the guard, because `external_id <> ALL('{}')` is true of every
 * row and would refuse the category wholesale.
 */
export async function markNotAdmitted(
  categoryId: number,
  admittedExternalIds: string[],
  reason: string,
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (admittedExternalIds.length === 0) return [];

  const predicate = `experiences.category_id = $1
      AND experiences.admission = 'admitted'
      AND ${UNPROTECTED}
      AND experiences.external_id <> ALL($2::text[])`;

  const result = dryRun
    ? await pool.query(
        `SELECT id, external_id, name FROM experiences WHERE ${predicate}`,
        [categoryId, admittedExternalIds]
      )
    : await pool.query(
        `UPDATE experiences
            SET admission = 'refused', admission_reason = $3,
                ${CLEAR_ICONIC}
          WHERE ${predicate}
      RETURNING id, external_id, name`,
        [categoryId, admittedExternalIds, reason]
      );

  return rowsFrom(result);
}
