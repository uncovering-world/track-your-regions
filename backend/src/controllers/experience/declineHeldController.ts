/**
 * Saying no to one thing a gated run proposed, without claiming it.
 *
 * The gate holds a run's change to a row readers can already see, and publishing
 * is the yes (ADR-0025 decision 5, ADR-0037 one level down). Until this endpoint
 * the only no was to *claim* the field — edit it by hand, which puts it in
 * `curated_fields`, and then publish, which skips it and reports it. That says
 * "this value is mine now" where the curator means "I do not want this value",
 * and it outlives the question: a source proposing something else next month
 * meets the claim rather than a person.
 *
 * So this is `declineSourceController.ts`'s shape one gate over, and deliberately
 * its own file for the same reason that one is: the two answers to a held row are
 * opposite acts with nothing in common but the lock. Publishing writes columns,
 * releases contents, re-places the object and stamps a state. Refusing writes
 * nothing at all to the row — the stored value has already won every run since
 * the gate first held this one. What it writes is the *question* being closed.
 *
 * Closed narrowly, and by value: a source that comes back with something
 * different is asking a new question and is heard. That is the whole reason the
 * refusal stores what it refused (`heldDecisions.ts`) rather than the fact that
 * something was refused.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { answeredHeldRows, recordHeldAnswers } from './heldDecisions.js';
import {
  heldObjectRows, heldPartRows, resolveHeldSelection,
  type HeldRow, type SelectedPart,
} from './heldSelection.js';
import type { ContentsByKind } from '../../services/sync/types.js';

/** A part a refusal reached, as the response and the audit row name it. */
interface DeclinedPart {
  kind: string;
  name: string;
  fields: string[];
}

interface DeclineResult {
  experienceId: number;
  /** The object's own fields refused now. */
  declinedFields: string[];
  /** The parts refused now, grouped as the card grouped them. */
  declinedParts: DeclinedPart[];
  fromSyncLogId: number;
  /**
   * Held rows still open after this refusal.
   *
   * Zero means the card is gone and the pointer with it. The page says which,
   * because "refused, and four things are still waiting" and "refused, and that
   * was the last of it" are different states and the refetch shows neither.
   */
  heldLeftOpen: number;
}

interface DeclineRefusal {
  status: number;
  error: string;
  /** The pointer as the server holds it, so a stale card can redraw itself. */
  pendingChangeSyncLogId?: number | null;
}

/**
 * Refuse what a gated run proposed for named rows of a held card.
 * POST /api/experiences/:id/decline-held
 * Body: { fields?: string[], parts?: SelectedPart[], expectedSyncLogId: number }
 *
 * `expectedSyncLogId` is required and compared against
 * `experiences.pending_change_sync_log_id` under the write lock — the same
 * comparison publishing makes, against the same column, because the card names
 * the run the pointer names. Refusing the wrong run silences a proposal nobody
 * read, which is the mirror of publishing one nobody read.
 */
export async function declineHeldValue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { fields, parts, expectedSyncLogId } = req.body as {
    fields?: string[]; parts?: SelectedPart[]; expectedSyncLogId: number;
  };

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, expResult.rows[0].category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await refuseUnderLock(
    experienceId, userId, logRegionId, { fields, parts }, expectedSyncLogId,
  );
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/** The parts of a refusal, grouped by the part the record names, for the report. */
function groupParts(rows: ReadonlyArray<HeldRow>): DeclinedPart[] {
  const byPart = new Map<string, DeclinedPart>();
  for (const { ref: row } of rows) {
    if (row.kind === null) continue;
    // Grouped on the record's own pair, which is what tells two works with one
    // name apart; the label is for a person and is not the key.
    const key = JSON.stringify([row.kind, row.ref, row.name]);
    const part = byPart.get(key)
      ?? { kind: row.kind, name: row.name ?? row.ref ?? 'an unnamed part', fields: [] };
    part.fields.push(row.field);
    byPart.set(key, part);
  }
  return [...byPart.values()];
}

/**
 * The refusal itself, in one transaction under the row lock.
 *
 * Everything the decision rests on is read in here rather than before: the
 * pointer, the proposal it names, and the answers already standing against it.
 * Read earlier, a run landing in between would have its values refused under the
 * run id this caller sent — the substitution `expectedSyncLogId` exists to
 * refuse.
 *
 * The value refused is never taken from the request. The readers compare a
 * stored refusal against what the source is proposing now, by equality, so a
 * refusal of a value nobody proposed would silence nothing while looking like an
 * answer.
 */
async function refuseUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  selection: { fields?: string[]; parts?: SelectedPart[] },
  expectedSyncLogId: number,
): Promise<{ result?: DeclineResult; refusal?: DeclineRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // Awaited at every call site, as on the two neighbouring endpoints: a
    // `return refuse(…)` without it settles the try block while the ROLLBACK is
    // still in flight, and `finally` releases the client under it.
    const refuse = async (
      status: number, error: string, pendingChangeSyncLogId?: number | null,
    ): Promise<{ refusal: DeclineRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error, pendingChangeSyncLogId } };
    };

    const locked = await client.query(
      `SELECT pending_change_sync_log_id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
      [experienceId],
    );
    // The existence check in the handler ran on the pool, on another connection
    // and earlier in time. A row deleted in that window leaves nothing to lock.
    if (locked.rows.length === 0) return await refuse(404, 'Experience not found');
    const pointer = (locked.rows[0].pending_change_sync_log_id as number | null) ?? null;

    if (pointer === null) {
      return await refuse(409,
        'The proposal this row was holding is gone — reload to see where it stands', null);
    }
    if (pointer !== expectedSyncLogId) {
      return await refuse(409,
        'This row is holding a proposal from a different run — reload to see it', pointer);
    }

    const proposal = await client.query(
      `SELECT changed_fields, contents FROM experience_sync_changes
        WHERE experience_id = $1 AND sync_log_id = $2
        ORDER BY id DESC LIMIT 1`,
      [experienceId, pointer],
    );
    if (proposal.rows.length === 0) {
      // The pointer names a run whose changeset row is not there. Publishing
      // refuses the same case with the same words, and two endpoints disagreeing
      // about it is worse than either answer.
      return await refuse(409,
        'The proposal this card names is no longer on record — reload to see where this stands',
        pointer);
    }

    const answered = await answeredHeldRows(client, experienceId, pointer);
    const open = [
      ...heldObjectRows(proposal.rows[0].changed_fields ?? [], answered),
      ...heldPartRows((proposal.rows[0].contents ?? null) as ContentsByKind | null, answered),
    ];
    const { selected, unmatched } = resolveHeldSelection(open, selection);
    if (unmatched.length > 0) {
      return await refuse(409,
        `Nothing is waiting on you for ${unmatched.join(', ')} — reload to see where this stands`,
        pointer);
    }

    await recordHeldAnswers(client, experienceId, userId, 'refused',
      selected.map(row => ({ row: row.ref, value: row.proposed })));

    // The pointer is what the card is keyed on, so it goes only once nothing is
    // left open — the same rule publishing follows, for the same reason: a card
    // cleared with rows still on it would take them off every screen there is,
    // and nothing else names the run they belong to.
    const heldLeftOpen = open.length - selected.length;
    if (heldLeftOpen === 0) {
      await client.query(
        `UPDATE experiences SET pending_change_sync_log_id = NULL, updated_at = NOW()
          WHERE id = $1`,
        [experienceId],
      );
    }

    const declinedFields = selected.filter(row => row.ref.kind === null).map(row => row.ref.field);
    const declinedParts = groupParts(selected);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'declined_held', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      // Named with the values, as `declined_source` records them: the answer is
      // about *those* values, so a curator meeting the field again next month is
      // being told the source changed its mind rather than that the click failed.
      fields: selected
        .filter(row => row.ref.kind === null)
        .map(row => ({ field: row.ref.field, declined: row.proposed })),
      // A part's rows carry their values too, and one entry per field rather
      // than the response's grouping: `experience_held_decisions` holds one
      // *standing* answer per row and the next upsert overwrites it, so the log
      // is the only place the value refused for a work's attribution survives
      // once the source proposes something else. The object's arm above has
      // said so since the endpoint existed; this said only which fields.
      parts: selected
        .filter(row => row.ref.kind !== null)
        .map(row => ({
          kind: row.ref.kind,
          name: row.ref.name ?? row.ref.ref ?? 'an unnamed part',
          field: row.ref.field,
          declined: row.proposed,
        })),
      fromSyncLogId: pointer,
      heldLeftOpen,
    })]);

    await client.query('COMMIT');
    return {
      result: {
        experienceId, declinedFields, declinedParts, fromSyncLogId: pointer, heldLeftOpen,
      },
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
