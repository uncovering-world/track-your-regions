/**
 * The curator's writes to `experience_kind_memberships` — a place's verdict,
 * its reason, the curator's pin on it, its gate state and the held proposal's
 * pointer — under the place's lock (ADR-0077 decision 4, #1148).
 *
 * The table's writers are a closed list the backend lint names
 * (`MEMBERSHIP_WRITE_RULES`), spelled or through `${MEMBERSHIPS}`: this module
 * for the curator; for the run, the upsert's own statement
 * (`services/sync/experienceUpsert.ts`, which writes the place and its
 * membership together), the admission sweep (`services/sync/admission.ts`),
 * the verified pass a new content retires (`services/sync/curationDecay.ts`)
 * and the held proposal's pointer (`services/sync/heldProposalPointer.ts`);
 * and the seed.
 *
 * Every write here takes the `LockedExperience` the answering handler holds,
 * so a membership is written only after its place's lock — the one every
 * writer of the membership takes (`db/locks.ts`) — and names the place beside
 * the membership (`experience_id = lock.id`), so one place's token cannot be
 * spent on another place's membership. The membership a write names is the
 * one the handler read in the statement after that lock
 * (`membershipToAnswerSql`), since a statement's snapshot is taken before it
 * waits and only the locked row is re-read. Whether to write, and what the
 * verdict is, stays with the handler that decided it.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { CLEAR_ICONIC } from '../../services/sync/admission.js';

/**
 * What a verdict on a refusal does to the must-see flag, appended to the
 * verdict's own `UPDATE`.
 *
 * A confirmed refusal drops the flag the way the run's own refusal writes do,
 * and a pinned one has to: the pin that statement writes is what keeps every
 * later run off the row, so whatever the flag holds after it is what it holds
 * for good (#760). A batch confirm pins nothing (ADR-0067) and leaves the row
 * to the next run's sweep. `override` leaves the flag where the refusal put
 * it — an admitted museum without the badge is a legitimate state (ADR-0045
 * decision 5), and what the badge should mean beyond works-first admission is
 * #603's question, not this write's.
 */
function iconicAfterVerdictSql(admitted: boolean): string {
  return admitted ? '' : `, ${CLEAR_ICONIC}`;
}

/** A curator's answer to a refusal, as the membership records it. */
export interface AdmissionAnswer {
  /** `override` admits the place again; `confirm` keeps it refused. */
  admitted: boolean;
  /** Whether the answer is pinned against later runs; unpinned, a confirm is marked answered instead. */
  pin: boolean;
  /** An override of a `pending` row publishes it (ADR-0025 § 4.5). */
  publishes: boolean;
  /** The reason kept on a confirmed row, null on an override. */
  reason: unknown;
  /** The membership's claimed fields after the answer. */
  curated: string[];
}

/**
 * Write the answer to a refusal on the membership: the verdict, its reason,
 * the pin, the badge and, for an override of an arrival, the publication.
 *
 * The publication is built as a clause rather than as a `CASE` over a
 * parameter: a parameter used both as the value of a varchar column and as the
 * left side of a text comparison gives Postgres two types to deduce for one
 * placeholder, and the error is invisible to every mocked-pool test.
 */
export async function answerAdmissionOnMembership(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  { admitted, pin, publishes, reason, curated }: AdmissionAnswer,
): Promise<void> {
  const publishSet = publishes
    ? `, curation_state = 'verified', published_at = COALESCE(published_at, NOW())`
    : '';
  await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = $2,
          admission_reason = $3,
          curated_fields = $4,
          admission_answered_at = ${!admitted && !pin ? 'NOW()' : 'NULL'},
          updated_at = NOW()${publishSet}${iconicAfterVerdictSql(admitted)}
      WHERE m.id = $1 AND m.experience_id = $5
    `, [
    membershipId, admitted ? 'admitted' : 'refused', reason,
    JSON.stringify(curated), lock.id,
  ]);
}

/**
 * A curator's refusal of an arrival on the membership: the verdict, its reason
 * and the pin, the badge cleared the way a rule's refusal clears it (#760).
 */
export async function refuseOnMembership(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  reason: string,
  curated: string[],
): Promise<void> {
  await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = 'refused',
          admission_reason = $2,
          curated_fields = $3,
          updated_at = NOW(),
          ${CLEAR_ICONIC}
      WHERE m.id = $1 AND m.experience_id = $4
    `, [membershipId, reason, JSON.stringify(curated), lock.id]);
}

/**
 * The publication on the membership, from the assignments the publish built
 * (`publicationAssignments` in `publishHeldFields.ts`): `verified`, the first
 * publication's date, and the held pointer cleared once nothing is left open.
 */
export async function publishMembership(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  assignments: readonly string[],
): Promise<void> {
  await client.query(
    `UPDATE ${MEMBERSHIPS}
         SET ${[...assignments, 'updated_at = NOW()'].join(',\n             ')}
         WHERE id = $1 AND experience_id = $2`,
    [membershipId, lock.id],
  );
}

/**
 * Take the held proposal's card away: the pointer is what the card is keyed
 * on, so the caller clears it only once no row of the proposal is left open.
 */
export async function clearHeldPointer(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
): Promise<void> {
  await client.query(
    `UPDATE ${MEMBERSHIPS} SET pending_change_sync_log_id = NULL, updated_at = NOW()
          WHERE id = $1 AND experience_id = $2`,
    [membershipId, lock.id],
  );
}

/**
 * The membership of a place a curator created by hand, in the kind of the
 * source the curator chose (ADR-0045 decision 4, #822): `verified` and
 * published from the moment it exists, since a person's judgement does not
 * depend on the source's gate. Under the token the manual create's own insert
 * hands back (`insertCuratedExperience`). Its id within the source is the
 * place's own `curator-<id>-<ts>` key, which no source listing can ever name.
 */
export async function insertManualMembership(
  client: PoolClient,
  lock: LockedExperience,
  sourceId: number,
): Promise<void> {
  await client.query(`
    INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, curation_state, published_at)
    VALUES (
      $1, (SELECT kind_id FROM experience_sources WHERE id = $2), $2,
      (SELECT external_id FROM experiences WHERE id = $1),
      'verified', NOW()
    )
  `, [lock.id, sourceId]);
}
