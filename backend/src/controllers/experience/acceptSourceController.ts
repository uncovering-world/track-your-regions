/**
 * Applying a value the *source* proposed against a curator's claim.
 *
 * Split from `lifecycleController.ts` (#526), which keeps the two verdicts a
 * curator gives about a row — did it disappear, does this catalogue accept it.
 * This is a different question with a different answer-holder: `curated_fields`
 * says a person has claimed a field, and this is the one path that hands the
 * field back to the source (ADR-0021). The moved text is unchanged.
 */

import type { z } from 'zod/v4';
import type { AcceptSourceResult } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { acceptSourceBodySchema, idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { claimKeyFor, METADATA_CLAIM_PREFIX } from '../../services/sync/changeSet.js';
import { tidyLabel } from '@tyr/shared/labels';
import { tidyNameValue } from './heldDecisions.js';
import { acceptedWrites, type PictureCredit } from './acceptedWrites.js';
import { creditForOneImage } from '../../services/sync/imageCredit.js';
import { userAgent } from '../../config/userAgent.js';
import type { ContentItemChange } from '../../services/sync/types.js';
import { placeAfterRelease } from './publishContents.js';
import { placementReport } from './placementReport.js';
import { conflictChangeOpenSql } from './reviewQueuePredicates.js';
import { withTypeClaim } from '../../db/membership.js';
import { acceptTypeOnSourceMembership, typeClaimedBy } from './membershipWriter.js';
import { lockExperience, updateExperienceColumns } from '../../db/experienceWriter.js';
import { releaseAnchorPointClaim, movePointTo } from './experienceLocationWriter.js';
import { releaseConflictRefusals } from './conflictDecisions.js';

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
export async function acceptSourceValue(
  { params: { id: experienceId }, body: { fields, expectedSyncLogId }, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof acceptSourceBodySchema>; caller: Express.User;
  },
): Promise<AcceptSourceResult> {
  const userId = caller.id;
  const userRole = caller.role;

  const expResult = await pool.query(
    `SELECT id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // The place's fields, which every kind of it shows: the place as a whole.
  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, 'place',
  );
  if (!permitted) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  const outcome = await acceptSourceUnderLock(experienceId, userId, logRegionId, fields, expectedSyncLogId);
  if (outcome.refusal) throw new Refusal(409, outcome.refusal);
  return outcome.result!;
}

/**
 * The acceptance under the lock and the placement that may follow it — the
 * half of `acceptSourceValue` a batch answer (#852) calls per row. `fields` is
 * the fields the caller names, or `'all'` for every field the proposal still
 * holds open, which is what a whole-card answer means and what a batch sends:
 * resolved under the same lock as the proposal, so nothing is spelled twice.
 */
export async function acceptSourceUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[] | 'all',
  expectedSyncLogId: number,
): Promise<{ result?: AcceptSourceResult; refusal?: { error: string; fromSyncLogId?: number } }> {
  const pictureCredit = await proposedPictureCredit(experienceId, fields);
  const outcome = await applyProposedFields(experienceId, userId, logRegionId, fields, expectedSyncLogId, pictureCredit);
  if (outcome.refusal) return { refusal: outcome.refusal };
  const {
    applied, released, releasedPoints, movedPoints, releasedCredit, fromSyncLogId, movesPlace,
  } = outcome;

  // A place or a pin put back on the source's coordinate is a region fact,
  // exactly as a curator moving it is: the `auto` rows were computed from where
  // it used to be. After the commit, like every other placement here — a placement
  // inside the transaction would hold the row lock across a world-view sweep.
  const placementFailures = movesPlace || movedPoints.length > 0
    ? await placeAfterRelease(experienceId, 'A curator accepted the source coordinate for experience %d')
    : [];

  return { result: {
    experienceId,
    applied,
    // A kind's own fact, released without a write: the kind's next run
    // applies the source's value through the ordinary upsert.
    released,
    // The points whose own claim on `location` went with the object's, named
    // rather than counted: a curator who corrected a pin is entitled to know
    // which pin they just handed back — and which of them went back onto the
    // source's coordinate on the spot.
    releasedPoints,
    movedPoints,
    // The credit that went with the picture. A boolean rather than the value:
    // what a curator needs to know is that the line under their photograph is
    // gone, and the value itself is in the `edited` row that wrote it.
    releasedCredit,
    ...placementReport(placementFailures),
    fromSyncLogId,
  } };
}

/**
 * The credit of the picture the open proposal offers, asked of Commons before
 * the transaction, as a curator's edit asks it (`editExperience`): a request to
 * Commons is not something to hold the object lock across. Read without the
 * lock, so the transaction writes it only beside the same file
 * (`acceptedWrites`). Null where no picture is answered for, or Commons did not
 * answer in time — and a null written is the point: the curator's credit must
 * not stay under a photograph that is not theirs.
 */
async function proposedPictureCredit(experienceId: number, fields: string[] | 'all'): Promise<PictureCredit | null> {
  if (fields !== 'all' && !fields.includes('imageUrl')) return null;
  const proposal = await pool.query<{ url: unknown }>(`
    SELECT f->'new' AS url
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) f
     WHERE ch.experience_id = $1 AND ${conflictChangeOpenSql('e', 'ch', 'l')}
       AND f->>'field' = 'imageUrl' AND (f->>'curatedConflict')::boolean
     ORDER BY ch.id DESC
     LIMIT 1
  `, [experienceId]);
  const url = proposal?.rows[0]?.url;
  if (typeof url !== 'string' || url === '') return null;
  // A curator's answer, not a run: no bot marker on this one (#864).
  return { url, credit: await creditForOneImage(url, userAgent()) };
}

/**
 * Whether the picture is among the accepted fields, and the claims left once
 * its credit's claim goes with it. The deletion is unconditional; the *report*
 * is not. `editExperience` writes `metadata.imageCredit` beside every picture
 * change and writes `null` whenever the credit could not be resolved — a
 * picture that is not on Commons, or a lookup that timed out — so accepting the
 * source there would otherwise tell a curator that something was dropped when
 * nothing they could see ever existed.
 */
function creditWithPicture(
  open: ReadonlyArray<{ field: string }>, hadCredit: boolean, remaining: string[],
): { acceptedImage: boolean; releasedCredit: boolean; remaining: string[] } {
  const acceptedImage = open.some(p => claimKeyFor(p.field) === 'image_url');
  if (!acceptedImage) return { acceptedImage, releasedCredit: false, remaining };
  return {
    acceptedImage,
    releasedCredit: hadCredit,
    remaining: remaining.filter(k => k !== `${METADATA_CLAIM_PREFIX}imageCredit`),
  };
}

/**
 * The trail's entry per field: the value written, or `appliesAtNextSync` on a
 * kind's own fact, the one entry an answer releases without writing
 * (`acceptedWrites`).
 */
function loggedFields(open: ReadonlyArray<{ field: string; new: unknown }>, written: readonly string[]) {
  return open.map(p => (written.includes(p.field)
    ? { field: p.field, applied: p.new }
    : { field: p.field, appliesAtNextSync: true }));
}

/**
 * Write the accepted values and release the curator's claim on those fields.
 *
 * Every accepted field is written now with the value the answered run proposed
 * (#2222, `acceptedWrites`), and its claim released, so later runs write the
 * source's value through the ordinary upsert. The value is on the card already:
 * an answer that only released the claim moved a place 12 km at a run nobody
 * watched. Two fields reach further than the place's row:
 *
 * - the type, written on the proposing source's membership (ADR-0084);
 * - `location`, released on the object *and* on the pin its anchor was taken
 *   from, and that pin written onto the source's coordinate for it, one table
 *   down, so the reader's position and the object's move together (#550). See
 *   the two blocks below, which is where that argument lives.
 *
 * A kind's own fact is the one entry released without a write, to the kind's
 * next run (`acceptedWrites` says why).
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
  fields: string[] | 'all',
  expectedSyncLogId: number,
  pictureCredit: PictureCredit | null,
): Promise<{
  applied: string[];
  released: string[];
  releasedPoints: number[];
  movedPoints: number[];
  /** Whether accepting the picture also dropped the curator's credit for it. */
  releasedCredit: boolean;
  fromSyncLogId: number;
  /** Whether the place's own coordinate was written, which its regions follow. */
  movesPlace: boolean;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    // The stored credit comes back with the claims, and under the same lock:
    // whether one is *there* decides what the curator is told was removed, and
    // reading it separately would be reading it at another moment.
    const locked = await lockExperience<{
      curated_fields: string[] | null; image_credit: unknown; metadata: unknown; name_local: unknown;
    }>(client, experienceId, "curated_fields, metadata, name_local, metadata->'imageCredit' AS image_credit");
    const placeClaims: string[] = locked?.row.curated_fields ?? [];
    const hadCredit = locked?.row.image_credit != null;

    // Same predicate as the queue, withdrawal check included: a conflict a
    // later run stopped proposing must not be writable here either, or the
    // guard below would refuse a newer proposal while letting a retracted one
    // through.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, l.source_id, ch.changed_fields, ch.contents
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      WHERE ch.experience_id = $1
        AND ${conflictChangeOpenSql('e', 'ch', 'l')}
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
        applied: [], released: [], releasedPoints: [], movedPoints: [], releasedCredit: false, movesPlace: false,
        fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId },
      };
    };

    // A row deleted since the handler's existence read has nothing to lock and
    // no proposal on record either, and is answered as the second.
    if (!locked || proposal.rows.length === 0) {
      return await refuse('No source proposal on record for this experience');
    }
    const fromSyncLogId = proposal.rows[0].sync_log_id as number;
    if (fromSyncLogId !== expectedSyncLogId) {
      return await refuse('A newer run has proposed something else — reload to see it', fromSyncLogId);
    }
    // The type within the kind is the proposing source's membership's, and so is
    // a curator's claim on it (ADR-0084): the claims this proposal meets.
    const proposingSource = proposal.rows[0].source_id as number;
    const claimed = withTypeClaim(placeClaims, await typeClaimedBy(client, locked.lock, proposingSource));

    const proposed = (proposal.rows[0].changed_fields as Array<{ field: string; new: unknown; curatedConflict?: boolean }>)
      .filter(f => f.curatedConflict && (fields === 'all' || fields.includes(f.field)));
    if (proposed.length === 0) {
      return await refuse('The requested fields carry no source proposal');
    }

    // Still-claimed fields only: one released while this request was in flight
    // is an answer someone already gave.
    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    // The type is written on the membership, its claim released there.
    const typeAccepted = open.find(p => p.field === 'type');
    let remaining = placeClaims.filter(k => !open.some(p => claimKeyFor(p.field) === k));

    // **A picture's credit goes with the picture.**
    //
    // The two are written in one transaction by `editExperience` and mean one
    // thing — "this photograph is mine, and this is who took it". Releasing only
    // `image_url` leaves `metadata.imageCredit` claimed and still naming the
    // curator's photographer, and the per-key re-apply in `experienceUpsert.ts`
    // then puts that name back over every later run's — so the card ends up
    // showing the source's photograph credited to somebody who did not take it,
    // permanently, which is the one thing this feature promises never to do.
    //
    // The stored credit goes with the claim (`acceptedWrites`) and is replaced:
    // by the run's own credit where it is accepted beside the picture, else by
    // the proposed file's credit, asked of Commons before the transaction
    // (`proposedPictureCredit`). The key is deleted only where Commons gives none.
    const credit = creditWithPicture(open, hadCredit, remaining);
    const { acceptedImage, releasedCredit } = credit;
    remaining = credit.remaining;

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
    // would be unanswerable.
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
      ? await releaseAnchorPointClaim(client, locked.lock)
      : [];
    const releasedPoints = pointRelease.map(r => r.id);

    // **Every accepted value is written now, the coordinate included** (#2222):
    // the run being answered recorded what it offered, and that is what lands,
    // as `expectedSyncLogId` guarantees. After the point release above, which
    // finds the anchor's pin by the coordinate this overwrites.
    const values: unknown[] = [];
    const writes = acceptedWrites(
      // A name-carrying value as the catalogue stores a name (`tidyNameValue`,
      // #835): a proposal recorded before the writers tidied carries the run of
      // spaces the run saw, and accepting it must not put back what migration
      // 047 took out.
      open.map(p => ({ ...p, new: tidyNameValue(p.field, p.new) })),
      { metadata: locked.row.metadata, name_local: locked.row.name_local },
      remaining,
      acceptedImage,
      pictureCredit,
      (value) => `$${values.push(value) + 1}`,
    );
    if (writes.unwritable.length > 0) {
      return await refuse(`The source's ${writes.unwritable.join(', ')} cannot be stored here: keep the current value`);
    }
    await updateExperienceColumns(client, locked.lock, [
      ...writes.assignments,
      `curated_fields = $${values.length + 2}::jsonb`,
    ], [...values, JSON.stringify(remaining)]);
    await acceptTypeOnSourceMembership(client, locked.lock, proposingSource, typeAccepted);
    const written = writes.written;
    const movesPlace = writes.written.includes('location');

    // **And each released pin goes onto the source's coordinate for it, here.**
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
    // the same guarantee `expectedSyncLogId` gives the object's fields, the
    // object's own coordinate among them (written above).
    //
    // Where the run recorded no offer for a row, nothing is written: there is no
    // source value to write, and a row whose stored coordinate the source already
    // matches within the tolerance pairs anyway.
    const offered = (
      proposal.rows[0].contents as { locations?: { changed?: ContentItemChange[] } } | null
    )?.locations?.changed ?? [];
    const movedPoints: number[] = [];
    for (const row of pointRelease) {
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
      //
      // Both by the store rule (#835): the record holds the name as the run
      // saw it, which before the writers tidied could carry a run of spaces
      // migration 047 has since taken out of the row.
      //
      // "No rename recorded" is not "renamed to nothing": a row's name can be
      // NULL, and an entry with no `name` field compared through the same
      // null would match every referenceless entry of the run — the rename
      // leg is asked only where the record carries one.
      const stored = row.name === null ? null : tidyLabel(row.name);
      const recorded = (name: unknown) => (typeof name === 'string' ? tidyLabel(name) : null);
      const entry = offered.find((c) => {
        if (c.item.ref !== null) return c.item.ref === row.external_ref;
        if (row.external_ref !== null) return false;
        const renamed = c.fields.find(f => f.field === 'name');
        return recorded(c.item.name) === stored
          || (renamed !== undefined && recorded(renamed.new) === stored);
      });
      const point = entry?.fields.find(f => f.field === 'location')?.new as
        { lon: number; lat: number } | undefined;
      if (!point) continue;
      await movePointTo(client, locked.lock, row.id, point.lon, point.lat);
      movedPoints.push(row.id);
    }

    // Any standing refusal of these fields goes with the claim it belonged to.
    await releaseConflictRefusals(client, locked.lock, open.map(p => p.field));

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'accepted_source', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      fields: loggedFields(open, written),
      // Only when there were any, so the trail of every other accepted field
      // reads as it did before this rule existed. Both lists, because they are
      // different facts: a released point kept its coordinate, a moved one was
      // put back on the source's, and only the second is a placement event.
      releasedPoints: releasedPoints.length > 0 ? releasedPoints : undefined,
      movedPoints: movedPoints.length > 0 ? movedPoints : undefined,
      // The credit deleted with the picture, on the same footing as the pin and
      // for the same reason: the value dropped is always the curator's own —
      // `editExperience` claims `image_url` only when it wrote the picture, and
      // writes the credit in that same statement — and the card they answered
      // said nothing about a photographer. Without this, the line under the
      // picture disappears with no trace anywhere of what it said.
      releasedCredit: releasedCredit || undefined,
    })]);
    await client.query('COMMIT');
    return {
      applied: written,
      released: writes.released,
      releasedPoints,
      movedPoints,
      releasedCredit,
      fromSyncLogId,
      movesPlace,
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
