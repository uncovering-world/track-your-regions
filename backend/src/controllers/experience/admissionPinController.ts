/**
 * A curator's admission pins, read and handed back (#1369).
 *
 * A pin is a curator's answer to a kind's rule — a place put back over a
 * refusal, or kept out — that every run leaves as it is. The list is every pin
 * in the caller's scope, or one place's, with who answered, when, the reason
 * the answer stood against and the note; the place's curation dialog and the
 * review page read it. Handing one back takes the claim off and leaves the row
 * to the next run of its source (`handBackAdmissionPin`). A curator's own
 * refusal of an arrival is not handed back: it answered no rule, and its way
 * back is the put-back. Nor is a curator's add to a kind no run offers the
 * place in (`ADDED_BY_CURATOR`), which is not listed either while it stands,
 * however often it was taken out and put back: no rule turned the place down,
 * a run that never lists it would refuse it once the pin was gone, and its
 * way back is the Kinds row's *Take out…*.
 *
 * GET  /api/experiences/review/pins?experienceId=
 * POST /api/experiences/:id/admission-pin/hand-back   { membershipId, note? }
 */

import type { z } from 'zod/v4';
import type { AdmissionPinHandedBack, AdmissionPins } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS, admissionPinnedSql } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type {
  admissionPinsQuerySchema, handBackPinBodySchema, idParamSchema,
} from '../../types/index.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { handBackAdmissionPin } from './membershipWriter.js';
import { queueScopeSql } from './reviewQueueKeys.js';
import { ADDED_BY, ADDED_BY_CURATOR, PINNED_BY } from './reviewQueuePinQuestions.js';

/** More pins than a curator reads in one list; the answer says when it was cut. */
const PINS_SHOWN = 500;

export async function listAdmissionPins(
  { query: { experienceId }, caller }: { query: z.output<typeof admissionPinsQuerySchema>; caller: Express.User },
): Promise<AdmissionPins> {
  const isAdmin = caller.role === 'admin';
  // The name of who answered follows the curation log's own rule: read where the
  // caller sees the whole source, or the act names no region or one they cover.
  const nameVisible = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('m.source_id')} OR pinned_by.region_id IS NULL
        OR pinned_by.region_id IN (SELECT id FROM curator_scoped_regions))`;
  const result = await pool.query<{
    experience_id: number; name: string; membership_id: number; kind_name: string;
    answer: 'admitted' | 'refused'; answered_reason: string | null; answered_at: Date | null;
    note: string | null; curator_name: string | null; added: boolean; questioned: boolean; can_hand_back: boolean;
  }>(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id AS experience_id, e.name, m.id AS membership_id, kd.name AS kind_name,
           m.admission AS answer, m.admission_pin_reason AS answered_reason,
           COALESCE(pinned_by.at, e.state_decided_at) AS answered_at,
           CASE WHEN pinned_by.at IS NOT NULL THEN pinned_by.note ELSE e.state_note END AS note,
           CASE WHEN ${nameVisible} THEN u.display_name END AS curator_name,
           pinned_by.action IS NOT DISTINCT FROM 'kind_added' AS added,
           m.admission_questioned_at IS NOT NULL AS questioned,
           NOT (m.admission = 'refused' AND m.admission_pin_verdict IS NOT DISTINCT FROM 'admitted') AS can_hand_back
      FROM experiences e
      JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
      JOIN ${KINDS} kd ON kd.id = m.kind_id
      ${PINNED_BY}
      ${ADDED_BY}
      LEFT JOIN users u ON u.id = pinned_by.curator_id
     WHERE ${admissionPinnedSql('m')}
       AND NOT (m.admission = 'admitted' AND ${ADDED_BY_CURATOR})
       AND ${queueScopeSql(isAdmin, 'm.source_id')}
       AND ($2::int IS NULL OR e.id = $2)
     ORDER BY kd.display_priority, kd.name, e.name, m.id
     LIMIT ${PINS_SHOWN + 1}
  `, [caller.id, experienceId ?? null]);

  const rows = result.rows.slice(0, PINS_SHOWN);
  return {
    pins: rows.map(row => ({
      experienceId: row.experience_id,
      name: row.name,
      membershipId: row.membership_id,
      kindName: row.kind_name,
      answer: row.answer,
      answeredReason: row.answered_reason,
      answeredAt: row.answered_at?.toISOString() ?? null,
      note: row.note,
      curatorName: row.curator_name,
      added: row.added,
      questioned: row.questioned,
      canHandBack: row.can_hand_back,
    })),
    more: result.rows.length > PINS_SHOWN,
  };
}

export async function handBackPin(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof handBackPinBodySchema>; caller: Express.User;
  },
): Promise<AdmissionPinHandedBack> {
  // The pinned membership's source decides the scope, as every answer about one kind does (#1264).
  const sourceId = await answeredSourceId(experienceId, body.membershipId, 'named');
  if (sourceId === null) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, experienceId, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const outcome = await handBackPinUnderLock(experienceId, caller.id, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/** The hand-back under the place's lock: the pin re-read, the writer, and one row of the curation log. */
export async function handBackPinUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { membershipId, note }: z.output<typeof handBackPinBodySchema>,
): Promise<{ result?: AdmissionPinHandedBack; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    // In a statement after the lock's, so the row read is the one the lock holds (`db/locks.ts`).
    const read = await client.query<{
      admission: 'admitted' | 'refused'; verdict: 'admitted' | 'refused' | null; reason: string | null; kind: string;
      added: boolean;
    }>(
      `SELECT m.admission, m.admission_pin_verdict AS verdict, m.admission_pin_reason AS reason, kd.name AS kind,
              ${ADDED_BY_CURATOR} AS added
         FROM experiences e
         JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
         JOIN ${KINDS} kd ON kd.id = m.kind_id
         ${ADDED_BY}
        WHERE m.id = $1 AND e.id = $2 AND ${admissionPinnedSql('m')}`,
      [membershipId, experienceId],
    );
    const pin = read.rows[0];
    if (!pin) return await refuse({ status: 409, error: 'This answer is not pinned any more — reload to see where it stands' });
    // A curator's own refusal stands against no rule: the run admitted the place,
    // and a source that publishes a list never takes a refused row back by itself.
    // Its way back is the kept-out list's put-back, which also publishes it.
    if (pin.admission === 'refused' && pin.verdict === 'admitted') {
      return await refuse({
        status: 409,
        error: 'This is a curator’s own refusal, not an answer to a rule — put it back from the kept-out list instead',
      });
    }
    if (pin.added) {
      return await refuse({
        status: 409,
        error: `A curator added this place to ${pin.kind}, and no run lists it there — take it out from its Kinds row instead`,
      });
    }

    await handBackAdmissionPin(client, locked.lock, membershipId);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'admission_pin_handed_back', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      membershipId, kind: pin.kind, answer: pin.admission, reason: pin.reason, note: note ?? null,
    })]);
    await client.query('COMMIT');
    return { result: { experienceId, membershipId, admission: pin.admission } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
