/**
 * Standing by a curator's own value against the source's, on the record.
 *
 * The mirror of `acceptSourceController.ts`, and deliberately its own file: the two
 * answers to a conflict are opposite writes with nothing in common but the lock they
 * take. Accepting writes the source's value and releases the claim; refusing writes
 * nothing at all to the row, because the stored value has already won every run since
 * the disagreement began. What it writes is the *question* being closed.
 *
 * Until this existed, standing by your own edit was the absence of an action, so the
 * card came back after every sync — Aksum's arrived three times in two days with the
 * source proposing the identical text each time.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { claimKeyFor } from '../../services/sync/changeSet.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';

/**
 * Refuse the value a sync proposed for a field the curator had claimed.
 * POST /api/experiences/:id/decline-source
 * Body: { fields: string[], expectedSyncLogId: number }
 *
 * `expectedSyncLogId` is required for the same reason it is on accept-source, and the
 * cost of getting it wrong is the mirror image: accepting the wrong run writes a value
 * nobody read, refusing the wrong run *silences* a proposal nobody read. Both are
 * re-resolved under the write lock and refused rather than substituted.
 *
 * Every field is refusable, including the ones accept-source cannot write (`location`,
 * `metadata.*`). Refusing writes nothing to the row, so there is no such thing here as
 * a field the endpoint cannot answer for.
 */
export async function declineSourceValue(req: AuthenticatedRequest, res: Response): Promise<void> {
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

  const outcome = await recordRefusals(
    experienceId, userId, logRegionId, fields, expectedSyncLogId,
  );
  if (outcome.refusal) {
    res.status(409).json(outcome.refusal);
    return;
  }

  res.json({
    experienceId,
    declined: outcome.declined,
    fromSyncLogId: outcome.fromSyncLogId,
  });
}

/**
 * Record what was refused, taking the value from the locked proposal.
 *
 * The value is never read from the request. A client naming what it refuses could
 * disagree with what the source is actually proposing — through a stale card, or a
 * value the caller composed — and the queue compares the stored refusal against the
 * live proposal by equality, so a refusal of a value nobody proposed would silence
 * nothing while looking like an answer.
 *
 * The claim is re-read under the lock for the reason accept-source re-reads it: a field
 * released while this request was in flight is not a conflict any more, and refusing on
 * behalf of a claim that is gone would suppress a card that should be showing.
 */
async function recordRefusals(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[],
  expectedSyncLogId: number,
): Promise<{
  declined: string[];
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

    // The same proposal the queue would show, withdrawal check included — a conflict a
    // later run stopped proposing is not one a curator can answer here either.
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

    // Awaited at every call site, as on accept-source: an un-awaited refusal settles the
    // try block while the ROLLBACK is still in flight, and `finally` releases the client
    // under it.
    const refuse = async (error: string, fromSyncLogId?: number) => {
      unusable = await rollbackQuietly(client);
      return { declined: [], fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId } };
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

    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    // One row per field, replaced: this is the standing answer, so a curator who refuses
    // twice leaves one record and not a pile. The history of who answered when is the
    // curation log's, written below in the same transaction.
    for (const p of open) {
      await client.query(`
        INSERT INTO experience_conflict_decisions (experience_id, field, declined, decided_by)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (experience_id, field)
        DO UPDATE SET declined = EXCLUDED.declined,
                      decided_by = EXCLUDED.decided_by,
                      decided_at = NOW()
      `, [experienceId, p.field, JSON.stringify(p.new ?? null), userId]);
    }

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'declined_source', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      fields: open.map(p => ({ field: p.field, declined: p.new })),
    })]);
    await client.query('COMMIT');
    return { declined: open.map(p => p.field), fromSyncLogId };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
