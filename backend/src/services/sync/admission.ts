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
 * Five operations, and the order they run in matters:
 *
 *   1. `markRefused` — the run named it and a rule said no. Unconditional: no
 *      coverage floor or error count makes a named refusal less true.
 *   2. `restoreAdmission` — this run admits it after all, so the refusal is lifted.
 *   3. `markNotAdmitted` — the sweep, for a source that recomputes its whole
 *      membership each run. Guarded, because "not in the admitted set" is the
 *      ambiguous kind of statement again: a broken SPARQL day must not blank a
 *      catalogue.
 *   4. `markIconic` — the must-see badge on the memberships the run admits, for
 *      a source whose admission rule is the badge — or, where only one of its
 *      doors is, on the rows the orchestrator picked out of them
 *      (`badgesAdmitted`). The one write here that is
 *      about the flag rather than about admission, and so honours the flag's
 *      own pin rather than admission's: a membership a curator overrode is
 *      badged, since the curator admitted it and the rule would badge it.
 *   5. `unmarkIconic` — the same badge taken back, where the kind's badge is a
 *      predicate and an admitted row has stopped passing it. Only then: where
 *      the badge is the admission rule there is nothing to take back, and a
 *      row that leaves the kind altogether is cleared by the writer that puts
 *      it out (`CLEAR_ICONIC`). Runs straight after step 4, off the same list —
 *      and only on a run whose step 3 actually ran, since it speaks about the
 *      rows the run did not name and those are the sweep's to decide.
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
export async function admittedExternalIds(sourceId: number, type?: string): Promise<Set<string>> {
  // `type` narrows the set to one type within the kind, for a source whose
  // doors each hold their own rows — the Archaeology kind's museums and its
  // sites. Each door asks after the rows it admitted and no others: a door
  // asked after the other door's rows would judge them by a rule they never
  // entered through, and the museum the museum door stopped admitting would
  // be written as a site on its fame alone.
  const result = await pool.query(
    `SELECT e.external_id
     FROM ${SOURCE_MEMBERSHIPS}
     WHERE m.source_id = $1
       AND m.admission = 'admitted'
       AND e.is_manual = FALSE
       AND ($2::text IS NULL OR e.type = $2)`,
    [sourceId, type ?? null]
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
 * beside the three that take it away with a row's membership and the one
 * (`unmarkIconic`) that takes it back from a row that stays, and run after
 * `restoreAdmission` on purpose.
 *
 * Every museum works-first admits holds a work above the fame line, so the flag
 * is a property of belonging to the kind rather than a field the source
 * proposes. Where a kind's world tier has a second door that is not a
 * masterpiece — an archaeology museum enters for what it is as well as for the
 * find it holds — only the rows holding one are handed over, and the flag is a
 * property of that half of the rule (`badgeAdmitted`, ADR-0045 decision 5).
 * Either way it is the rule and not a proposal — which is why it is written
 * here and not through the
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
 * Take the badge back off the memberships this run admits and no longer calls
 * must-see — the fifth writer of the flag, and the other half of `markIconic`.
 *
 * Only a kind whose badge is a predicate needs it (`badgesAdmitted` a function,
 * `badgeAdmitted`): where the badge *is* the admission rule, every admitted row
 * is handed to `markIconic` and there is nothing left over to clear. Where the
 * kind has a second door — an archaeology museum enters for what it is, and
 * wears the badge only while it holds a famous find — the two sets come apart,
 * and a museum whose last famous find fell below the finds' line would otherwise
 * wear a must-see badge no rule of this run would give it. The three writers
 * that clear the flag (`CLEAR_ICONIC`) all fire when a row *leaves* the kind, so
 * none of them ever reaches it.
 *
 * `keepExternalIds` is what `markIconic` was handed, so the two statements
 * cannot disagree about who is badged: everything this source admits and this
 * run did not name is cleared.
 *
 * That set includes rows the run never selected at all, which is why the caller
 * sends this **only on a run whose admission sweep ran** (`badgeAdmitted`): the
 * sweep is what decides those rows, clearing the flag with the admission
 * (`CLEAR_ICONIC`), and on a run where its guard refused — an empty answer, a
 * collapse to under half the previous membership — it deliberately leaves them
 * standing. Sent anyway, this statement would take the badge off every one of
 * them while their admission was being protected, which is the sweep's guard
 * honoured in one column and broken in the other.
 *
 * The curator's pin is honoured, exactly as `CLEAR_ICONIC` honours it: a person
 * who marked this must-see goes on saying so. Admission's own pin does not
 * protect the badge — they are two answers and two pins (`iconicPinnedSql`).
 *
 * A preview writes no row and reports none, as `markIconic` does not.
 */
export async function unmarkIconic(
  sourceId: number,
  keepExternalIds: string[],
  dryRun: boolean,
): Promise<AdmissionRow[]> {
  if (dryRun) return [];

  const result = await pool.query(
    `UPDATE ${MEMBERSHIPS} m SET is_iconic = false, updated_at = NOW()
       FROM experiences e
      WHERE e.id = m.experience_id
        AND m.source_id = $1
        AND NOT (e.external_id = ANY($2::text[]))
        AND m.admission = 'admitted'
        AND m.is_iconic
        AND NOT ${iconicPinnedSql('m')}
  RETURNING ${RETURNING}`,
    [sourceId, keepExternalIds],
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
                -- A refusal that comes back after the row was admitted is a
                -- new question (ADR-0067); one that stands is still answered.
                admission_answered_at = CASE WHEN m.admission = 'admitted'
                  THEN NULL ELSE m.admission_answered_at END,
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
            SET admission = 'admitted', admission_reason = NULL,
                admission_answered_at = NULL, updated_at = NOW()
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
                -- Every row here was admitted: its refusal is a new question
                -- (ADR-0067).
                admission_answered_at = NULL,
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
