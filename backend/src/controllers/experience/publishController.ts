/**
 * A curator saying that a reader may see this.
 *
 * Under a gated source (ADR-0025) a run writes what it finds and marks it
 * unread: an arrival lands `curation_state = 'pending'`, invisible to everyone
 * but a curator following it out of the queue, and a proposal against a row
 * that is already visible is kept out of the columns entirely, with
 * `pending_change_sync_log_id` naming the run that made it. Three of the review
 * queue's cards are exactly those situations, and until this endpoint existed
 * none of them could be answered — no other path moves a row off `pending`, and
 * no other path clears that pointer in response to a person.
 *
 * This is the answer, and it is one transaction because the halves are one act:
 * the held values, the unread contents, the row's own state, and the audit line
 * saying who decided. A publication that wrote three of those four would leave
 * the catalogue asserting something nobody said.
 *
 * Shaped after `applyProposedFields` in `acceptSourceController.ts`, deliberately
 * and down to the details: everything the decision rests on is re-read under
 * the row lock, every `refuse()` is awaited so `finally` cannot release the
 * client mid-ROLLBACK, and a client whose ROLLBACK also failed is destroyed
 * rather than pooled.
 *
 * `publishContents.ts` holds the question "which rows does a publish reach"
 * and, since it can release a withdrawal, "where does the object need to be
 * re-placed afterwards" — its own module because both stand on their own,
 * with no dependency on the transaction shell here (no lock, no refusal, no
 * audit row, no scope check). What a run *proposed* — which columns
 * publishing assigns from `changed_fields`, and the per-column shapes that
 * makes awkward — lives in `publishHeldFields.ts`. Neither half depends on
 * this one; this file is the lock, the staleness check, the audit row, and
 * the two halves' call sites.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishContents, placeAfterRelease } from './publishContents.js';
import { heldFieldWrites, publicationAssignments } from './publishHeldFields.js';

/**
 * What the curator asked to be published.
 *
 * Four shapes, and each names its own intent rather than leaving one
 * inferred from what is missing — see `publishExperienceBodySchema` for why:
 * absent everything is an object publish, `contentsOnly` is every pending
 * content row with the object untouched, `locationIds`/`treasureIds` name
 * exactly which rows with the object untouched the same way, and `fieldsOnly`
 * is the mirror — the object's held fields with its contents untouched.
 */
interface PublishRequest {
  locationIds?: number[];
  treasureIds?: number[];
  contentsOnly?: true;
  /** The object's held fields, and none of its unread contents (#524). */
  fieldsOnly?: true;
  expectedSyncLogId?: number;
}

/**
 * Why this row cannot be published at all, before a single value is read off it.
 *
 * Both answers are about the row rather than the request, and both are 409 —
 * "the state of the world says no", not "your body was wrong".
 */
function refusedBeforeWriting(
  row: { admission: string; curationState: string },
  { fieldsOnly }: { fieldsOnly?: true },
): string | null {
  // ADR-0025 decision 4, "Admission is asked before publication": whether an
  // object belongs in this catalogue at all is a question a category's own rule
  // answers (ADR-0024), and whether anyone has looked at it yet is a different
  // question, "asked only once the first has been answered yes". Publishing a
  // refused row asks the second first — which is what the review queue refuses
  // to do from the other side, where each of the gate's three kinds carries
  // `hideRefusedSql()`.
  //
  // Left unrefused this is not a tidiness problem: the row would leave
  // `arrivals` for ever — nothing returns a `verified` row to `pending` — so a
  // later `override` on the refusal would put it in front of readers with nobody
  // having reviewed its contents, and the New-chip window would start ticking
  // while nothing could see it. The way through is the other order: answer the
  // refusal at `POST /:id/admission`, where an `override` publishes in the same
  // transaction. Refused for a contents publish too, and for the same reason: a
  // refused museum's unread paintings raise no `contents` card either.
  if (row.admission === 'refused') {
    return 'This row was turned down by its category — answer the refusal first, and putting it back publishes it';
  }

  // A `fieldsOnly` publish over an arrival would put an object in front of
  // readers with every one of its points and works still `pending` — "an object
  // still in every list with nothing on the map", the failure `locationWriter`'s
  // deferral machinery exists to prevent, arriving by the one door that skips
  // `publishContents`. `publicationAssignments` stamps `verified` and
  // `published_at` regardless, so nothing downstream would catch it. An arrival
  // holds no proposal either — its fields were never refused, they simply have
  // not been seen — so there is nothing this shape could usefully apply here.
  //
  // Unreachable from the card, whose button needs a held pointer; refused
  // because the endpoint is open to any curator and the API table promises the
  // opposite of what this would do.
  if (fieldsOnly && row.curationState === 'pending') {
    return 'Nobody has passed this object yet, so there are no held fields to publish on their own — publish it and what arrived with it';
  }

  return null;
}

/**
 * Which of the three publishes this was, for the trail.
 *
 * Said rather than inferred from which counts came out zero: publishing an object
 * that happened to hold no unread contents, publishing named contents that were
 * all published already, and publishing only the fields of an object that is
 * still holding twelve works look identical from the numbers.
 */
function scopeOf({ contentsOnly, fieldsOnly }: { contentsOnly: boolean; fieldsOnly?: true }): string {
  if (fieldsOnly) return 'fields';
  return contentsOnly ? 'contents' : 'object';
}

interface PublishResult {
  experienceId: number;
  /** The experience's own state after the call — unchanged by a contents publish. */
  curationState: string;
  /** Held fields written now. */
  appliedFields: string[];
  /** Held fields left alone because the curator claims them (see below). */
  claimedFieldsSkipped: string[];
  /** The run whose held proposal was applied, or null when none was held. */
  fromSyncLogId: number | null;
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  /** Points the source had replaced, withdrawn now that their replacement shows. */
  withdrawalsReleased: number;
  /** Set when the publication landed but re-placing the object afterwards did not. */
  placementFailed?: true;
  /**
   * Where the regions are now stale, named rather than only counted. Present
   * exactly when `placementFailed` is, and never empty.
   *
   * The caller cannot fix any of this: a re-assignment is admin-only, and this
   * page's ordinary user is a region- or category-scoped curator. What they can
   * do is tell an admin which object and which world views — so the answer has
   * to contain that, and a boolean plus a line in the server's log leaves them
   * saying "something about regions failed". `id: null` is the one case with no
   * world view to name: listing them is what failed, so none was attempted.
   *
   * The reason each one gave stays in the log and out of this: it is a database
   * error string, the curator can do nothing with it, and an admin reading the
   * log has it in full.
   */
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

interface PublishRefusal {
  status: number;
  error: string;
  /** The pointer as the server holds it, so a stale card can redraw itself. */
  pendingChangeSyncLogId?: number | null;
}

/**
 * Publish an experience, every one of its unread contents, or a named subset.
 * POST /api/experiences/:id/publish
 * Body: { contentsOnly?: true, fieldsOnly?: true, locationIds?: number[], treasureIds?: number[], expectedSyncLogId?: number }
 *
 * An empty body publishes the object: its held fields, its own state, and
 * every unread point and work it holds — the arrival case. `contentsOnly` or
 * naming either id array makes this a contents publish instead — those rows
 * (all of them, or the named ones) and nothing else, because a visible museum
 * that gained three checked paintings has not thereby been read (ADR-0025
 * § 4.4). `fieldsOnly` is the mirror: the held fields alone, so one doubtful
 * sentence stops holding back twelve checked works (#524) — and on a `pending`
 * row it answers 409, because a row nobody has read has no fields to publish
 * on their own. See `publishExperienceBodySchema` for why the four shapes are
 * asked for explicitly rather than one of them inferred from the others being
 * absent — that inference is what let a contents-only card publish the object
 * by accident.
 */
export async function publishExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const body = req.body as PublishRequest;

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

  const outcome = await publishUnderLock(experienceId, userId, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/**
 * Whether the staleness check refuses this call, and the message if so.
 *
 * Split out of `publishUnderLock` on its own — the question "does this call
 * need to match the pointer" is one coherent decision.
 *
 * Will this call actually write a held field? `applied` and `unwritable`
 * between them are exactly the held fields a claim did not already remove —
 * see `heldFieldWrites`, which computes and discards that "writable" set
 * internally — so their combined length is the one question worth asking
 * without a second, driftable copy of that filter: is there anything left of
 * the proposal for this call to be stale *about*.
 *
 * A pointer whose every held field a curator had already claimed leaves that
 * empty. Before this check existed, such a row still ran the staleness
 * comparison unconditionally — and the `contents` card that raised it has no
 * held half to show (it filters on the same flag `heldFieldWrites` does), so
 * its frontend sends no `expectedSyncLogId` and the row 409ed for ever, with
 * no way for a curator to ever discover the run id nothing ever showed them.
 * Per ADR-0025 § 4.4 a publish that writes no held field is not answering the
 * proposal, so there is nothing here for it to be stale about — and it is
 * safe to skip the check rather than merely convenient: the ids
 * `publishContents` uses are re-scoped inside their own statements and only
 * `pending` rows ever flip, so nothing this call still does depends on which
 * run the pointer named.
 *
 * The check also stays live whenever the caller named a run, even one that
 * will write nothing: a caller who names nothing is one who was shown
 * nothing to answer, and skipping the check for them is the fix above. A
 * caller who *did* name a run believed something specific was held, and if
 * the row disagrees — pointer now null, or naming a different run — that
 * belief was wrong and staleness is exactly the word for why, even when
 * nothing was ever going to be written from it. Without this half, "the
 * proposal it was holding has gone" could never fire again: "will write a
 * held field" is always false once the pointer is null, so the branch it
 * guards would be unreachable dead code rather than a real answer to a
 * caller who sent a stale run id.
 */
function staleProposalRefusal(
  write: { applied: string[]; unwritable: string[] },
  pointer: number | null,
  expectedSyncLogId: number | undefined,
): { error: string; pendingChangeSyncLogId: number | null } | null {
  const willWriteHeldFields = write.applied.length > 0 || write.unwritable.length > 0;
  const staleCheckApplies = willWriteHeldFields || expectedSyncLogId !== undefined;
  if (!staleCheckApplies || pointer === (expectedSyncLogId ?? null)) return null;

  return {
    error: pointer === null
      ? 'The proposal this row was holding is gone — reload to see where it stands'
      : 'This row is holding a proposal from a different run — reload to see it',
    pendingChangeSyncLogId: pointer,
  };
}

/**
 * The publication itself, in one transaction under the row lock.
 *
 * Everything the decision rests on is read in here rather than before: the
 * pointer that says which run's proposal is being held, the proposal itself,
 * the claims that decide which of its fields this call may write, and the state
 * that decides whether `published_at` is this row's first. Read earlier, a run
 * or another curator landing in between would have its values written under the
 * run id this caller sent — the substitution `expectedSyncLogId` exists to
 * refuse — and a claim made in that window would be silently overwritten.
 *
 * Exported for `publishWaitingController.ts`, which releases what a whole source is
 * holding: that is the same act per object, so it must be the same transaction
 * rather than a second implementation that drifts from this one. Written inside this
 * block rather than as a second one above the signature: two doc blocks in a row
 * attach only the nearest, so a note about the export would hide the paragraph a
 * caller actually needs. (Spelling the closing delimiter here would end this
 * comment mid-sentence, which is how the first attempt at this line broke the file.)
 */
export async function publishUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  body: PublishRequest,
): Promise<{ result?: PublishResult; refusal?: PublishRefusal }> {
  const { locationIds, treasureIds, contentsOnly: bareContentsOnly, fieldsOnly, expectedSyncLogId } = body;
  // Three ways a body can ask for contents only, all mutually exclusive by the
  // schema's `.refine` — the bare flag for "every pending row, object
  // untouched", or naming either array. Object and contents publish are one
  // endpoint because they are one transaction shape and one audit action; they
  // differ only in whether the experience's own row — its held fields, its
  // state, its pointer — is part of what is answered.
  const contentsOnly = bareContentsOnly === true || locationIds !== undefined || treasureIds !== undefined;

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // Awaited at every call site. `return refuse(…)` without it settles the try
    // block immediately, so `finally` releases the client while the ROLLBACK is
    // still in flight on it — and reads `unusable` before it has been assigned.
    const refuse = async (
      status: number, error: string, pendingChangeSyncLogId?: number | null,
    ): Promise<{ refusal: PublishRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error, pendingChangeSyncLogId } };
    };

    const locked = await client.query(
      `SELECT curation_state, curated_fields, metadata, admission, pending_change_sync_log_id
         FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const before = locked.rows[0];
    // The existence check in the handler ran on the pool, on another connection
    // and earlier in time. A row deleted in that window leaves nothing to lock,
    // and reading `curated_fields` off it would answer 500 to a question whose
    // true answer is 404.
    if (!before) return await refuse(404, 'Experience not found');

    // The two refusals this row earns before anything is written, in one place
    // rather than as two branches of a function the linter already reads as
    // dense — and both are about the row, not about the request.
    const refusal = refusedBeforeWriting(
      { admission: before.admission as string, curationState: before.curation_state as string },
      { fieldsOnly },
    );
    if (refusal) return await refuse(409, refusal);

    const claimed: string[] = before.curated_fields ?? [];
    let applied: string[] = [];
    let claimedFieldsSkipped: string[] = [];
    let heldFrom: number | null = null;

    if (!contentsOnly) {
      const pointer = (before.pending_change_sync_log_id as number | null) ?? null;
      // The staleness question in one comparison, with "named nothing" reading
      // as "this row was holding nothing" — which is what an arrival looks like
      // and what a row whose proposal a later run withdrew no longer does. A
      // newer run overwrites the pointer, so equality with it is the whole test;
      // there is nothing to compare against the newest changeset, as
      // `accept-source` does, because the card names the run the pointer names.
      //
      // Refusing when the caller named nothing and a proposal has since arrived
      // matters as much as the other direction: publishing then would either
      // apply values the curator never saw or clear the pointer without applying
      // them, and the second loses the proposal for good.
      //
      // What this cannot cover, so that nobody assumes it does: **an arrival has
      // no staleness check available at all.** A `pending` row never holds a
      // pointer — `syncUtils.ts` sets one only `WHERE curation_state <>
      // 'pending'` — because a row nobody can see is refreshed in place instead
      // of held (sub-branch 1's decision, and the right one: the curator should
      // review the newest state, not whatever landed first). So a run that
      // rewrites an arrival between the card being drawn and this click is
      // invisible to the curator and to this comparison alike, and what gets
      // published is the newest state rather than the state on the card. Nothing
      // in the schema records what the card showed, so there is nothing here to
      // compare; changing that is a decision about arrivals, not about this
      // endpoint.
      //
      // Read before the question is even asked, because the answer now depends
      // on it: `heldFieldWrites` needs only the stored pointer, never
      // `expectedSyncLogId`, so computing it first leaks nothing to a caller the
      // check might still refuse. See `staleProposalRefusal` for what decides
      // whether the check applies at all — a pointer whose one held field a
      // curator already claimed writes nothing, and per ADR-0025 § 4.4 there is
      // nothing for such a call to be stale about.
      const write = await heldFieldWrites(client, experienceId, pointer, before, claimed);
      const staleness = staleProposalRefusal(write, pointer, expectedSyncLogId);
      if (staleness) {
        return await refuse(409, staleness.error, staleness.pendingChangeSyncLogId);
      }
      heldFrom = pointer;

      if (write.proposalMissing) {
        // The pointer names a run whose changeset row is not there, so there is
        // nothing to apply and nothing to show a curator either. Reading that as
        // an empty proposal would clear the pointer and answer 200: the card
        // disappears, the values are never written, and the only record that
        // anything was held goes with it. `accept-source` refuses the same case,
        // and two endpoints disagreeing about it is worse than either answer.
        // Leaving the pointer standing costs a card that returns; the next run
        // re-proposes and records it properly.
        return await refuse(409,
          'The proposal this card names is no longer on record — reload to see where this stands',
          pointer);
      }

      if (write.unwritable.length > 0) {
        // Nothing held may be dropped in silence. Clearing the pointer over a
        // value this code could not write would leave that value proposed by
        // every run from here on and applied by none — the escape the gate
        // closes for `accept-source`'s six unwritable fields, reopened. Reached
        // today only by a coordinate the changeset did not record as a pair of
        // numbers; a field name outside `CURATED_KEY_BY_FIELD` would land here
        // too, which is why a test feeds this endpoint every field
        // `computeChangeSet` can actually emit and requires all of them to be
        // applied. Iterating the map instead would prove nothing: the map is the
        // side that could be missing an entry.
        //
        // A field in that position is unanswerable, not merely unapplied — the
        // refusal leaves the pointer standing, so the card cannot be cleared by
        // any route. That is the deliberate trade (no value is ever dropped in
        // silence) and the reason the test guards the differ rather than the map.
        return await refuse(409,
          `Publishing cannot write what this run proposed for ${write.unwritable.join(', ')} — nothing was published`,
          pointer);
      }
      applied = write.applied;
      claimedFieldsSkipped = write.claimedFieldsSkipped;

      await client.query(
        `UPDATE experiences
         SET ${[...write.assignments, ...publicationAssignments(before)].join(',\n             ')},
             updated_at = NOW()
         WHERE id = $1`,
        write.params,
      );
    }

    // A fields-only publish leaves every unread point and work exactly where it
    // is: the whole point of #524 is that answering a held sentence must stop
    // being the same act as releasing twelve checked paintings. Nothing else in
    // the transaction changes — the object's state, its pointer and its trail are
    // written the same way, because what was answered *was* the object.
    const { locationsPublished, treasureLinksPublished, treasuresPublished, withdrawalsReleased } =
      fieldsOnly
        ? { locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0 }
        : await publishContents(client, experienceId, locationIds, treasureIds);

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'published', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      scope: scopeOf({ contentsOnly, fieldsOnly }),
      fields: applied,
      claimedFieldsSkipped,
      fromSyncLogId: heldFrom,
      locations: locationsPublished,
      treasureLinks: treasureLinksPublished,
      treasures: treasuresPublished,
      // A reader asking why a pin moved has this row and nothing else: the run
      // that proposed the move is a different row in a different table, and says
      // nothing about when it took effect.
      withdrawalsReleased,
    })]);

    await client.query('COMMIT');

    // Placement runs here and nowhere else in this endpoint, and only for a
    // publish that released a withdrawal. Every other one changes nothing about
    // where the object is, and not by oversight: placement's insert predicate is the
    // `offeredLocationSql` pair — `el.missing_since IS NULL AND el.existence <>
    // 'lost'` — and nothing else, so it filters neither `curation_state` nor
    // `admission`, and a `pending` location was already placed by the run that wrote
    // it. Flipping it to `verified` moves no geometry, no point and no membership. The
    // `existence` term joined the predicate with the location verdicts (ADR-0026) and
    // changes nothing here, because publishing touches `curation_state` alone; what it
    // does change is that a curator's verdict on a point is itself a placement event,
    // which is why `POST /locations/:locationId/state` places and this does not. Publishing a held content
    // field cannot move it either: placement reads
    // `experience_locations.location`, never `experiences.location`, and no
    // trigger connects the two.
    //
    // A released withdrawal is the exception because the old point stops being
    // offered, and the clear is unfiltered while the insert is not — so its
    // `experience_location_regions` rows have to go, and the experience-level
    // union they fed has to be recomputed.
    //
    // Conditional rather than unconditional because "publish places" reads as the
    // obvious symmetry and is wrong: run 53 created 18 museums, and placing them
    // all on publish would delete and reinsert region rows across every world view
    // with geometry for no change at all.
    //
    // After the COMMIT and off this client, since `assignRegionsForExperiences`
    // opens a transaction of its own.
    const placementFailures = withdrawalsReleased > 0
      ? await placeAfterRelease(experienceId)
      : [];

    return {
      result: {
        experienceId,
        curationState: contentsOnly ? (before.curation_state as string) : 'verified',
        appliedFields: applied,
        claimedFieldsSkipped,
        fromSyncLogId: heldFrom,
        locationsPublished,
        treasureLinksPublished,
        treasuresPublished,
        withdrawalsReleased,
        // The flag and the list travel together or not at all: a flag without the
        // list is the dead end this endpoint just stopped handing to a curator,
        // and a list without the flag would need every reader to re-derive
        // "did it fail" from an array's length.
        ...(placementFailures.length === 0 ? {} : {
          placementFailed: true as const,
          placementFailedWorldViews: placementFailures.map(f => ({
            id: f.worldViewId, name: f.worldViewName,
          })),
        }),
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
