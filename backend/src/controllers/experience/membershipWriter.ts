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
import { heldFieldExistsSql, heldPartExistsSql } from './waitingCounts.js';

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

/**
 * The view a pin answered and the question closed, as a `SET` fragment
 * (#1367): when `pinned` holds, the pin answered `verdict` for `reason`;
 * otherwise there is no pin and no view. Every write that pins or unpins
 * `admission` closes an open question with it.
 */
function pinViewSql(pinned: string, verdict: string, reason: string): string {
  return `admission_pin_verdict = CASE WHEN ${pinned} THEN ${verdict} END,
          admission_pin_reason = CASE WHEN ${pinned} THEN ${reason} END,
          ${CLEAR_QUESTION}`;
}

/** No open question about the pin. */
const CLEAR_QUESTION = `admission_question_verdict = NULL,
          admission_question_reason = NULL,
          admission_questioned_at = NULL,
          admission_question_sync_log_id = NULL`;

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
  // A pin remembers the run's view it answered, so a later run is compared with
  // it (#1367): the refusal on the row before this write, or — on a row already
  // pinned, whose admission is a curator's and not the run's — the view the pin
  // already holds, which a curator's second answer does not change. Any answer
  // closes a question a run had asked about the pin.
  await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = $2,
          admission_reason = $3,
          curated_fields = $4,
          admission_answered_at = ${!admitted && !pin ? 'NOW()' : 'NULL'},
          ${pinViewSql(
            `$4::jsonb ? 'admission'`,
            `COALESCE(m.admission_pin_verdict, 'refused')`,
            `CASE WHEN m.admission_pin_verdict IS NULL THEN m.admission_reason ELSE m.admission_pin_reason END`,
          )},
          updated_at = NOW()${publishSet}${iconicAfterVerdictSql(admitted)}
      WHERE m.id = $1 AND m.experience_id = $5
    `, [
    membershipId, admitted ? 'admitted' : 'refused', reason,
    JSON.stringify(curated), lock.id,
  ]);
}

/** The rule's verdict on a membership, written in a released pin's place. */
export interface RuleVerdict {
  admitted: boolean;
  /** The rule's reason for a refusal; null for an admission. */
  reason: string | null;
}

/**
 * Release an admission pin, the rule's verdict written in its place: one an
 * unread batch answer made (#1365, ADR-0096), or one a curator lets the rule
 * decide once a run asked about it (#1367). The claim on `admission` comes off
 * with the view it answered and any question. A refusal is written with the
 * rule's reason and marked answered, so a run that still refuses it does not
 * ask again, while one whose rule now admits it admits it; the badge is
 * cleared the way a rule's refusal clears it. An admission is written as a run
 * writes one.
 */
export async function releaseAdmissionPin(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
  { admitted, reason }: RuleVerdict,
): Promise<void> {
  const result = await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = $2,
          admission_reason = $3,
          curated_fields = m.curated_fields - 'admission',
          admission_answered_at = ${admitted ? 'NULL' : 'NOW()'},
          ${pinViewSql('false', 'NULL', 'NULL')},
          updated_at = NOW()${iconicAfterVerdictSql(admitted)}
      WHERE m.id = $1 AND m.experience_id = $4
    `, [membershipId, admitted ? 'admitted' : 'refused', admitted ? null : reason, lock.id]);
  // A membership that is not this place's any more writes nothing, and the log
  // row beside it must not say it was released.
  if (result.rowCount !== 1) throw new Error(`membership ${membershipId} was not released on place ${lock.id}`);
}

/**
 * Hand an admission pin back with no question asked (#1369): the claim comes
 * off, with the view it answered and any question, and the row stays as it
 * is until the next run of its source decides, as it decides about a row
 * nobody pinned. A put-back stays admitted — a run that refuses it asks
 * afresh, as a refusal of an admitted row always does. A kept-out row stays
 * refused and is marked answered, as a batch's confirmation marks one
 * (ADR-0067), so it is not asked about again until a run admits it, which
 * `restoreAdmission` then does. A row with no pin writes nothing, and the log
 * row beside it must not say it was handed back.
 */
export async function handBackAdmissionPin(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
): Promise<void> {
  const result = await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET curated_fields = m.curated_fields - 'admission',
          admission_answered_at = CASE WHEN m.admission = 'refused' THEN NOW() END,
          ${pinViewSql('false', 'NULL', 'NULL')},
          updated_at = NOW()
      WHERE m.id = $1 AND m.experience_id = $2 AND m.curated_fields ? 'admission'
    `, [membershipId, lock.id]);
  if (result.rowCount !== 1) throw new Error(`membership ${membershipId} holds no admission pin on place ${lock.id}`);
}

/**
 * Keep a curator's admission pin over the question a run asked (#1367): the
 * pin now answers what that run said, so a later run that says the same keeps
 * it silently, and the question is closed. Refused with 409 by the caller when
 * nothing is asked; here a row that is not pinned or not asked writes nothing,
 * and the log row beside it must not say it was kept.
 */
export async function keepAdmissionPin(
  client: PoolClient,
  lock: LockedExperience,
  membershipId: number,
): Promise<void> {
  const result = await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission_pin_verdict = m.admission_question_verdict,
          admission_pin_reason = m.admission_question_reason,
          ${CLEAR_QUESTION},
          updated_at = NOW()
      WHERE m.id = $1 AND m.experience_id = $2
        AND m.curated_fields ? 'admission' AND m.admission_questioned_at IS NOT NULL
    `, [membershipId, lock.id]);
  if (result.rowCount !== 1) throw new Error(`membership ${membershipId} holds no asked pin on place ${lock.id}`);
}

/**
 * A curator's refusal of an arrival on the membership: the verdict, its reason
 * and the pin, the badge cleared the way a rule's refusal clears it (#760).
 * The pin answered an admission (#1367).
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
          ${pinViewSql(`$3::jsonb ? 'admission'`, `'admitted'`, 'NULL')},
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
 * Take away every proposal of the place an answer left with nothing open (#1599).
 *
 * A curator's answer to a held row is recorded on the place, by value
 * (`recordHeldAnswers`), so the same value another kind's run proposed is
 * answered with it, and that membership's card leaves the queue. Its pointer
 * would still name the run. Cleared here, under the lock the answer took, only
 * where the proposal held a row the gate kept out and none of those rows is
 * open: a pointer whose rows a curator claimed instead keeps its own question.
 * Nor where it holds a type: the type within the kind is the membership's
 * (ADR-0084), while the answer that reads it as settled is the place's, so
 * another kind's answer has not written this kind's type.
 */
export async function clearAnsweredHeldPointers(client: PoolClient, lock: LockedExperience): Promise<void> {
  // Asked first and written only where there is one, so the common answer —
  // one kind, its own pointer already cleared or still asking — writes nothing.
  const answered = await client.query<{ id: number }>(
    `SELECT m.id FROM ${MEMBERSHIPS} m
      WHERE m.experience_id = $1
        AND m.pending_change_sync_log_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM experience_sync_changes ch
           WHERE ch.experience_id = m.experience_id
             AND ch.sync_log_id = m.pending_change_sync_log_id
             -- The run's newest record of the place, the one its card and the decline read.
             AND ch.id = (SELECT max(c2.id) FROM experience_sync_changes c2
                           WHERE c2.experience_id = m.experience_id AND c2.sync_log_id = m.pending_change_sync_log_id)
             AND (EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ch.changed_fields, '[]'::jsonb)) AS f
                           WHERE (f->>'held')::boolean)
               OR EXISTS (SELECT 1 FROM (VALUES ('locations'), ('treasures')) AS k(kind)
                           CROSS JOIN LATERAL jsonb_array_elements(
                             COALESCE(ch.contents -> k.kind -> 'changed', '[]'::jsonb)) AS c
                           CROSS JOIN LATERAL jsonb_array_elements(c -> 'fields') AS f
                           WHERE (f->>'held')::boolean))
             AND NOT (${heldFieldExistsSql('ch')} OR ${heldPartExistsSql('ch')})
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ch.changed_fields, '[]'::jsonb)) AS t
                              WHERE (t->>'held')::boolean AND t->>'field' = 'type'))`,
    [lock.id],
  );
  const ids = (answered.rows ?? []).map(row => row.id);
  if (ids.length === 0) return;
  await client.query(
    `UPDATE ${MEMBERSHIPS} SET pending_change_sync_log_id = NULL, updated_at = NOW()
      WHERE id = ANY($1::int[]) AND experience_id = $2`,
    [ids, lock.id],
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
 * Move memberships from one place to another (ADR-0086): every membership of
 * `from` on a merge, or the ones a merge moved, named, on its undo. The place's
 * own listing follows through `derive_place_listing()`, which recomputes both
 * places. The ids moved are the merge's record of them.
 */
export async function moveMemberships(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE ${MEMBERSHIPS} SET experience_id = $2, updated_at = NOW()
      WHERE experience_id = $1 AND ($3::int[] IS NULL OR id = ANY($3::int[]))
      RETURNING id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
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
