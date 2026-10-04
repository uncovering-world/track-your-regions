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

import type { z } from 'zod/v4';
import type { DeclineSourceResult } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { declineSourceBodySchema, idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { claimKeyFor } from '../../services/sync/changeSet.js';
import { conflictChangeOpenSql } from './reviewQueuePredicates.js';
import { withTypeClaim } from '../../db/membership.js';
import { typeClaimedBy } from './membershipWriter.js';
import { recordConflictRefusals } from './conflictDecisions.js';
import { lockExperience } from '../../db/experienceWriter.js';

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
export async function declineSourceValue(
  { params: { id: experienceId }, body: { fields, expectedSyncLogId }, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof declineSourceBodySchema>; caller: Express.User;
  },
): Promise<DeclineSourceResult> {
  const userId = caller.id;
  const userRole = caller.role;

  const expResult = await pool.query(
    `SELECT id, source_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.source_id as number,
  );
  if (!permitted) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  const outcome = await declineSourceUnderLock(
    experienceId, userId, logRegionId, fields, expectedSyncLogId,
  );
  if (outcome.refusal) throw new Refusal(409, outcome.refusal);
  return outcome.result!;
}

/**
 * The refusal under the lock — the half of `declineSourceValue` a batch
 * answer (#852) calls per row. `fields` is the fields the caller names, or
 * `'all'` for every field the proposal still holds open against a claim,
 * resolved under the same lock as the proposal.
 */
export async function declineSourceUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[] | 'all',
  expectedSyncLogId: number,
): Promise<{
  result?: DeclineSourceResult;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const outcome = await recordRefusals(experienceId, userId, logRegionId, fields, expectedSyncLogId);
  if (outcome.refusal) return { refusal: outcome.refusal };
  return { result: { experienceId, declined: outcome.declined, fromSyncLogId: outcome.fromSyncLogId } };
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
  fields: string[] | 'all',
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
    const locked = await lockExperience<{ curated_fields: string[] | null }>(
      client, experienceId, 'curated_fields',
    );
    const placeClaims: string[] = locked?.row.curated_fields ?? [];

    // The same proposal the queue would show, withdrawal check included — a conflict a
    // later run stopped proposing is not one a curator can answer here either.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, l.source_id, ch.changed_fields
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      WHERE ch.experience_id = $1
        AND ${conflictChangeOpenSql('e', 'ch', 'l')}
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

    // A place gone before the lock has no proposal either: the proposal joins it.
    if (!locked || proposal.rows.length === 0) {
      return await refuse('No source proposal on record for this experience');
    }
    const fromSyncLogId = proposal.rows[0].sync_log_id as number;
    if (fromSyncLogId !== expectedSyncLogId) {
      return await refuse('A newer run has proposed something else — reload to see it', fromSyncLogId);
    }
    // A claim on the type is the proposing source's membership's (ADR-0084).
    const claimed = withTypeClaim(
      placeClaims, await typeClaimedBy(client, locked.lock, proposal.rows[0].source_id as number),
    );

    const proposed = (proposal.rows[0].changed_fields as Array<{ field: string; new: unknown; curatedConflict?: boolean }>)
      .filter(f => f.curatedConflict && (fields === 'all' || fields.includes(f.field)));
    if (proposed.length === 0) {
      return await refuse('The requested fields carry no source proposal');
    }

    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    // The standing answer, one row per field; the curation log below holds who
    // answered when, in the same transaction.
    await recordConflictRefusals(client, locked.lock, userId,
      open.map(p => ({ field: p.field, proposed: p.new })));

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
