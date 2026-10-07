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
 * A curator's verdict on whether the place's sources still list it (ADR-0020),
 * on the memberships of the place: the verdict is asked of the place, whose
 * own flag reads missing only once every source has stopped listing it
 * (`derive_place_listing()`), so it answers each of them. Clears
 * `missing_since`, because a verdict answers the flag: the flag is a question,
 * and a curator has now said what it meant. A false alarm leaves alone a kind
 * a curator already answered former (`setMembershipListingVerdict`, #1264):
 * the place's sources hiccupped, but that kind's source had dropped it before,
 * and the answer given then stands.
 */
export async function setListingVerdict(
  client: PoolClient,
  lock: LockedExperience,
  sourceMembership: string,
): Promise<void> {
  await client.query(`
    UPDATE ${MEMBERSHIPS}
    SET source_membership = $2, missing_since = NULL, updated_at = NOW()
    WHERE experience_id = $1 AND (NOT $3 OR source_membership = 'present')
  `, [lock.id, sourceMembership, sourceMembership === 'present']);
}

/**
 * A curator's verdict on whether one kind's source still lists the place
 * (#1264), on that membership alone: the place's other sources still list it,
 * so the place's own flag never read missing. A false alarm clears the
 * membership's `missing_since`; `former` keeps it, because the source still
 * does not list the place: the place reads missing once every membership's
 * flag is set (`derive_place_listing()`), so when the last source drops it too
 * the place's own card — whether it still stands — is asked.
 */
export async function setMembershipListingVerdict(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  sourceMembership: string,
): Promise<void> {
  await client.query(`
    UPDATE ${MEMBERSHIPS}
    SET source_membership = $2,
        missing_since = CASE WHEN $4 THEN NULL ELSE missing_since END,
        updated_at = NOW()
    WHERE id = $1 AND experience_id = $3
  `, [membershipId, sourceMembership, lock.id, sourceMembership === 'present']);
}

/**
 * Whether the membership `sourceId` brought to the place claims its type — the
 * claim a proposal of that source's run meets (ADR-0084: the type within a
 * kind is the membership's, and so is a curator's pin on it).
 */
export async function typeClaimedBy(
  client: PoolClient,
  lock: LockedExperience,
  sourceId: number,
): Promise<boolean> {
  const result = await client.query(
    `SELECT curated_fields ? 'type' AS claimed FROM ${MEMBERSHIPS} WHERE experience_id = $1 AND source_id = $2`,
    [lock.id, sourceId],
  );
  return Boolean(result.rows[0]?.claimed);
}

/**
 * The type within the kind, written on the membership `sourceId` brought, with
 * what becomes of a curator's claim on it: `add` for a curator's own edit,
 * `release` for taking the source's value, `keep` otherwise. Answers the type it
 * replaced, for the audit row, and `undefined` where the place has no such
 * membership.
 */
export async function setTypeOnSourceMembership(
  client: PoolClient,
  lock: LockedExperience,
  sourceId: number,
  type: unknown,
  claim: 'add' | 'release' | 'keep',
): Promise<{ old: unknown } | undefined> {
  const claims = {
    add: `CASE WHEN m.curated_fields ? 'type' THEN m.curated_fields ELSE m.curated_fields || '["type"]'::jsonb END`,
    release: `m.curated_fields - 'type'`,
    keep: 'm.curated_fields',
  }[claim];
  const result = await client.query(
    `WITH old AS (
       SELECT id, type FROM ${MEMBERSHIPS} WHERE experience_id = $1 AND source_id = $2
     )
     UPDATE ${MEMBERSHIPS} m
        SET type = $3, curated_fields = ${claims}, updated_at = NOW()
       FROM old
      WHERE m.id = old.id
     RETURNING old.type AS old_type`,
    [lock.id, sourceId, type],
  );
  return result.rows.length === 0 ? undefined : { old: result.rows[0].old_type };
}

/**
 * A source's conflicting type a curator took (`accept-source`), written on the
 * proposing source's membership with the curator's claim on it released;
 * nothing where the accepted fields hold no type.
 */
export async function acceptTypeOnSourceMembership(
  client: PoolClient,
  lock: LockedExperience,
  sourceId: number,
  accepted: { new: unknown } | undefined,
): Promise<void> {
  if (accepted) await setTypeOnSourceMembership(client, lock, sourceId, accepted.new, 'release');
}

/**
 * A held proposal's type, published onto the membership being published
 * (`publishController.ts`): the run whose proposal it was is that membership's
 * source, since the pointer the card answers is the membership's.
 */
export async function publishTypeOnMembership(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  held: { value: unknown } | undefined,
): Promise<void> {
  if (!held) return;
  const type = held.value;
  await client.query(
    `UPDATE ${MEMBERSHIPS} SET type = $3, updated_at = NOW() WHERE id = $2 AND experience_id = $1`,
    [lock.id, membershipId, type],
  );
}

/**
 * The membership of a place a curator created by hand, in the kind of the
 * source the curator chose (ADR-0045 decision 4, #822): `verified` and
 * published from the moment it exists, since a person's judgement does not
 * depend on the source's gate. Under the token the manual create's own insert
 * hands back (`insertCuratedExperience`). Its id within the source is the
 * place's own `curator-<id>-<ts>` key, which no source listing can ever name,
 * and it carries the type within the kind the curator gave (ADR-0084).
 */
export async function insertManualMembership(
  client: PoolClient,
  lock: LockedExperience,
  sourceId: number,
  type: string | null,
): Promise<void> {
  await client.query(`
    INSERT INTO ${MEMBERSHIPS} (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
    VALUES (
      $1, (SELECT kind_id FROM experience_sources WHERE id = $2), $2,
      (SELECT external_id FROM experiences WHERE id = $1),
      $3, 'verified', NOW()
    )
  `, [lock.id, sourceId, type]);
}
