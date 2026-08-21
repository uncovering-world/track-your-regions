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
import { OBJECT_LOCK } from '../../db/locks.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { claimKeyFor } from '../../services/sync/changeSet.js';
import { columnFor } from './acceptableFields.js';
import type { ContentItemChange } from '../../services/sync/types.js';
import { placeAfterRelease } from './publishContents.js';
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
  const { applied, released, releasedPoints, movedPoints, fromSyncLogId } = outcome;

  // A pin put back on the source's coordinate is a region fact, exactly as a
  // curator moving it is: the point's `auto` rows were computed from where it
  // used to be. After the commit, like every other placement here — a placement
  // inside the transaction would hold the row lock across a world-view sweep.
  const placementFailedWorldViews = movedPoints.length > 0
    ? await placeAfterRelease(experienceId, 'A curator accepted the source coordinate for experience %d')
    : [];

  res.json({
    experienceId,
    applied,
    // Fields this endpoint cannot write: the claim is gone, so the next run
    // applies the source's value through the ordinary upsert.
    released,
    // The points whose own claim on `location` went with the object's, named
    // rather than counted: a curator who corrected a pin is entitled to know
    // which pin they just handed back — and which of them went back onto the
    // source's coordinate on the spot.
    releasedPoints,
    movedPoints,
    ...(placementFailedWorldViews.length > 0 && {
      placementFailed: true,
      placementFailedWorldViews: placementFailedWorldViews.map(
        f => ({ id: f.worldViewId, name: f.worldViewName })),
    }),
    fromSyncLogId,
  });
}

/**
 * Write the accepted values and release the curator's claim on those fields.
 *
 * Releasing the claim is the point, and for most fields it is the whole of the
 * answer: releasing is what lets the *next run* apply the source's value through
 * the ordinary upsert, and it is the only thing that takes such an item off the
 * queue. Three cases, not two:
 *
 * - the five writable fields — released and written on `experiences` now;
 * - `tags`, `metadata` and the country arrays — released, and the next run
 *   applies them, since they need more than an assignment;
 * - `location` — released on the object *and* on the points whose claim went
 *   with it, and written onto those points on the spot, one table down. The
 *   object's own coordinate still waits for the run; the pin does not, because
 *   leaving it would have that run retire the row rather than rewrite it. See
 *   the two blocks below, which is where that argument lives.
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
  releasedPoints: number[];
  movedPoints: number[];
  fromSyncLogId: number;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT curated_fields FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
      [experienceId],
    );
    const claimed: string[] = locked.rows[0]?.curated_fields ?? [];

    // Same predicate as the queue, withdrawal check included: a conflict a
    // later run stopped proposing must not be writable here either, or the
    // guard below would refuse a newer proposal while letting a retracted one
    // through.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, ch.changed_fields, ch.contents
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
      return {
        applied: [], released: [], releasedPoints: [], movedPoints: [],
        fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId },
      };
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
    // **A point's claim on the coordinate goes with the object's.**
    //
    // The object's coordinate and its points' are one fact seen at two levels:
    // ADR-0028 positions a reader at a place they can go to, and the only path
    // that claims `location` on an *experience* is `editLocation`, which claims
    // it on the point in the same transaction and only where that point is the
    // object's one visible place. Releasing the object's half alone would leave
    // the next run writing the source's coordinate to `experiences.location`
    // while the point keeps the curator's — the object positioned by the source
    // and its only pin by the curator, which is #550 exactly, produced by the
    // pair of endpoints written to close it. Nothing would report it either: the
    // card that was answered is about the object and says nothing about a point
    // that will not follow.
    //
    // Releasing both is what the curator asked for, read honestly: the whole
    // content of the claim is "this coordinate is mine, not the source's", and
    // "take the source's" withdraws it. Refusing instead would be worse than
    // wrong — contents claims have no other release path (ADR-0029), so the card
    // would be unanswerable, which is the "button that lies" `acceptableFields`
    // exists to prevent.
    //
    // **The pin the anchor was taken from, and only that one.** `editLocation`
    // claims `location` on every point it moves, and on the *object* only where
    // that point is its one visible place — so the two are the same row when the
    // object's claim is written and need not stay so. An object that gains a
    // second published point and has it corrected carries three claims, and a
    // release written as "every claiming point" would undo that second correction
    // in answer to a card about the object's anchor, which nobody asked and
    // nothing would explain.
    //
    // Identified by the coordinate rather than by re-deriving the guard: the
    // anchor and its point were written from the same input in one transaction,
    // and nothing can move either while both are claimed, so they are still equal
    // — and a point somewhere else is, by that fact, not the one this card is
    // about. Where the object holds one visible point this is that point, which
    // is the case the rule was written for.
    const pointRelease = open.some(p => claimKeyFor(p.field) === 'location')
      ? await client.query(
        `UPDATE experience_locations el
            -- Qualified on the right-hand side: both tables carry the column, and
            -- unqualified it is ambiguous rather than wrong-but-working.
            SET curated_fields = el.curated_fields - 'location'
           FROM experiences e
          WHERE e.id = $1 AND el.experience_id = e.id
            AND el.curated_fields ? 'location'
            AND el.location = e.location
          RETURNING el.id, el.external_ref, el.name`,
        [experienceId],
      )
      : { rows: [] as Array<{ id: number; external_ref: string | null; name: string | null }> };
    const releasedPoints = pointRelease.rows.map(r => r.id);

    // **And the coordinate goes onto the row, here, rather than at the next run.**
    //
    // Releasing alone would hand the pin back by *retiring* it. The pairing that
    // rewrites a point needs the reference **and** ten metres (ADR-0027), and the
    // claim is what let a corrected row pair at any distance at all. Take the
    // claim off a 2 km correction and the row stops being a candidate: the run
    // withdraws it and inserts the source's point beside it, which raises a
    // `withdrawn` card for a component nobody delisted — the question the curator
    // has just answered — and leaves `user_visited_locations` and every manual
    // region row on a pin no reader is shown. That is the cost ADR-0027 accepts
    // for a source that genuinely moved something, and nobody has accepted it for
    // an acceptance.
    //
    // The value is the source's own, not a guess and not the object's: the run
    // being answered kept the stored coordinate *because* of the claim and
    // recorded what it offered instead, per point, in its contents record. So the
    // coordinate written here is the one that run proposed for this row, which is
    // the same guarantee `expectedSyncLogId` gives the object's fields. The
    // object's own coordinate is not written — `location` is not an acceptable
    // field — and follows at the next run through the ordinary upsert, now that
    // nothing claims it.
    //
    // Where the run recorded no offer for a row, nothing is written: there is no
    // source value to write, and a row whose stored coordinate the source already
    // matches within the tolerance pairs anyway.
    const offered = (
      proposal.rows[0].contents as { locations?: { changed?: ContentItemChange[] } } | null
    )?.locations?.changed ?? [];
    const movedPoints: number[] = [];
    for (const row of pointRelease.rows) {
      // Named, never identified by id — that is what the contents record stores
      // (see the column comment), so the row is found by the source's own handle
      // on it, and by name only where there is no handle.
      //
      // Both names, on that fallback. The record names an item by what it was
      // called *before* the run — `keptChanges` stores `old_name`, so the entry
      // stays legible after the row it names is renamed — while `RETURNING` gives
      // back the label as it stands, which the same run's keep arm may already
      // have rewritten. Comparing only one of them misses exactly the row this
      // whole path exists for: the catalogue's one referenceless point, whose
      // `samePointSql` branch is exact coordinate equality, so a released row
      // that got no coordinate here is withdrawn at the next run.
      const entry = offered.find((c) => {
        if (c.item.ref !== null) return c.item.ref === row.external_ref;
        if (row.external_ref !== null) return false;
        const renamedTo = c.fields.find(f => f.field === 'name')?.new;
        return c.item.name === row.name || renamedTo === row.name;
      });
      const point = entry?.fields.find(f => f.field === 'location')?.new as
        { lon: number; lat: number } | undefined;
      if (!point) continue;
      await client.query(
        `UPDATE experience_locations
            SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)
          WHERE id = $1`,
        [row.id, point.lon, point.lat],
      );
      movedPoints.push(row.id);
    }

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
      // Only when there were any, so the trail of every other accepted field
      // reads as it did before this rule existed. Both lists, because they are
      // different facts: a released point kept its coordinate, a moved one was
      // put back on the source's, and only the second is a placement event.
      releasedPoints: releasedPoints.length > 0 ? releasedPoints : undefined,
      movedPoints: movedPoints.length > 0 ? movedPoints : undefined,
    })]);
    await client.query('COMMIT');
    return {
      applied: writable.map(p => p.field),
      released: open.filter(p => columnFor(p.field) === null).map(p => p.field),
      releasedPoints,
      movedPoints,
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
