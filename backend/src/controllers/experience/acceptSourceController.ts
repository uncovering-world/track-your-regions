/**
 * Applying a value the *source* proposed against a curator's claim.
 *
 * Split from `lifecycleController.ts` (#526), which keeps the two verdicts a
 * curator gives about a row — did it disappear, does this catalogue accept it.
 * This is a different question with a different answer-holder: `curated_fields`
 * says a person has claimed a field, and this is the one path that hands the
 * field back to the source (ADR-0021). The moved text is unchanged.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { claimKeyFor } from '../../services/sync/changeSet.js';
import { columnFor } from './acceptableFields.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';

/**
 * Apply the value a sync proposed for a field the curator had claimed.
 * POST /api/experiences/:id/accept-source
 * Body: { fields: string[], expectedSyncLogId: number }
 *
 * The upsert refused these values at the time, so they exist only in the
 * changeset. `expectedSyncLogId` names the run the caller was looking at and is
 * required: the proposal is re-resolved under the write lock, and one belonging
 * to a different run is refused rather than substituted. The response names it
 * back, along with which fields were applied now and which were only released.
 */
export async function acceptSourceValue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { fields, expectedSyncLogId } = req.body as {
    fields: string[]; expectedSyncLogId: number;
  };

  if (!Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ error: 'fields is required' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await applyProposedFields(experienceId, userId, logRegionId, fields, expectedSyncLogId);
  if (outcome.refusal) {
    res.status(409).json(outcome.refusal);
    return;
  }
  const { applied, released, fromSyncLogId } = outcome;

  res.json({
    experienceId,
    applied,
    // Fields this endpoint cannot write: the claim is gone, so the next run
    // applies the source's value through the ordinary upsert.
    released,
    fromSyncLogId,
  });
}

/**
 * Write the accepted values and release the curator's claim on those fields.
 *
 * Releasing the claim is the point, and it is the whole of the answer for
 * fields this endpoint cannot write. A curator who lets the source have the
 * coordinates cannot type them in — `editExperience` does not offer location at
 * all, and every path that writes `curated_fields` other than this one only
 * ever adds to it. So releasing is what lets the *next run* apply the source's
 * value through the ordinary upsert, and it is the only thing that takes such
 * an item off the queue. For the five writable fields the value is additionally
 * applied now, which is the only difference between the two cases.
 *
 * Everything the decision rests on is read inside the transaction that writes,
 * under the row lock: `curated_fields`, and the proposal itself. Resolving the
 * proposal earlier would leave the endpoint's own guarantee open — a run
 * landing between that read and this lock would have its values written under
 * the run id the curator sent, which is exactly the substitution
 * `expectedSyncLogId` exists to refuse. The claim has the same problem in
 * reverse: the whole column is rewritten, not one element of it, so a value
 * read before the lock discards whatever was claimed in between, and "is this
 * field still claimed?" stops being a guess only once it is asked here.
 */
async function applyProposedFields(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[],
  expectedSyncLogId: number,
): Promise<{
  applied: string[];
  released: string[];
  fromSyncLogId: number;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT curated_fields FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const claimed: string[] = locked.rows[0]?.curated_fields ?? [];

    // Same predicate as the queue, withdrawal check included: a conflict a
    // later run stopped proposing must not be writable here either, or the
    // guard below would refuse a newer proposal while letting a retracted one
    // through.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, ch.changed_fields
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      WHERE ch.experience_id = $1
        AND l.is_dry_run = FALSE
        AND ch.changed_fields @> '[{"curatedConflict": true}]'
        AND (e.last_seen_sync_log_id IS NULL
             OR ch.sync_log_id >= e.last_seen_sync_log_id
             OR NOT EXISTS (
               SELECT 1 FROM experience_sync_logs prev
               WHERE prev.id = e.last_seen_sync_log_id AND ${CHANGESET_LANDED_SQL}))
      ORDER BY ch.id DESC
      LIMIT 1
    `, [experienceId]);

    // Awaited at every call site. `return refuse(…)` without it settles the
    // try block immediately, so `finally` releases the client while the
    // ROLLBACK is still in flight on it — and reads `unusable` before this
    // line has run.
    const refuse = async (error: string, fromSyncLogId?: number) => {
      unusable = await rollbackQuietly(client);
      return { applied: [], released: [], fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId } };
    };

    if (proposal.rows.length === 0) {
      return await refuse('No source proposal on record for this experience');
    }
    const fromSyncLogId = proposal.rows[0].sync_log_id as number;
    if (fromSyncLogId !== expectedSyncLogId) {
      return await refuse('A newer run has proposed something else — reload to see it', fromSyncLogId);
    }

    const proposed = (proposal.rows[0].changed_fields as Array<{ field: string; new: unknown; curatedConflict?: boolean }>)
      .filter(f => f.curatedConflict && fields.includes(f.field));
    if (proposed.length === 0) {
      return await refuse('The requested fields carry no source proposal');
    }

    // Still-claimed fields only: one released while this request was in flight
    // is an answer someone already gave.
    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    const writable = open.filter(p => columnFor(p.field) !== null);
    const assignments = writable.map((p, i) => `${columnFor(p.field)} = $${i + 2}`);
    const values = writable.map(p => p.new);
    const remaining = claimed.filter(k => !open.some(p => claimKeyFor(p.field) === k));

    await client.query(
      `UPDATE experiences
       SET ${assignments.map(a => `${a},`).join('\n           ')}
           curated_fields = $${writable.length + 2}::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [experienceId, ...values, JSON.stringify(remaining)],
    );
    // Any standing refusal of these fields goes with the claim it belonged to. A
    // refusal answers "the source may not have this field *while I hold it*", and
    // accepting hands the field back — so leaving the row behind would silence the
    // field the day someone claims it again, with an answer given about a claim that
    // no longer exists.
    await client.query(
      `DELETE FROM experience_conflict_decisions
        WHERE experience_id = $1 AND field = ANY($2::text[])`,
      [experienceId, open.map(p => p.field)],
    );

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'accepted_source', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      fields: open.map(p => ({
        field: p.field,
        applied: columnFor(p.field) !== null ? p.new : undefined,
        appliesAtNextSync: columnFor(p.field) === null || undefined,
      })),
    })]);
    await client.query('COMMIT');
    return {
      applied: writable.map(p => p.field),
      released: open.filter(p => columnFor(p.field) === null).map(p => p.field),
      fromSyncLogId,
    };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
