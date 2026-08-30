/**
 * Curator decisions about an experience's lifecycle.
 *
 * A sync run can observe that a source stopped listing an object, or that it
 * wants to change a field a curator has claimed. It cannot decide what either
 * means: a site absent from the list may be delisted or destroyed or simply
 * missed, and only a person can tell which. This is where that judgement is
 * recorded — see ADR-0020 for why the two axes are separate.
 *
 * The two verdicts only. Split at #526, when this file reached 1122 lines against
 * the guide's 800: the queue that *asks* the questions went to
 * `reviewQueueController.ts` (a read, no transaction, and the half that keeps
 * growing), and handing a claimed field back to the source went to
 * `acceptSourceController.ts` (a different question with a different
 * answer-holder — `curated_fields`, ADR-0021). What stayed is what a curator
 * decides about the row itself, under its lock.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishContents, placeAfterRelease } from './publishContents.js';
import type { AppliedPart } from './publishHeldParts.js';

type Membership = 'present' | 'former';
type Existence = 'extant' | 'lost';

/**
 * Record what a curator decided about an object's lifecycle.
 * POST /api/experiences/:id/state
 * Body: { membership?: 'present'|'former', existence?: 'extant'|'lost', note?: string,
 *         expected: { membership, existence, flagged } }
 *
 * `expected` is required — the row as the caller was looking at it. Compared
 * under the write lock; see the comment on that comparison for why nothing
 * else can tell a stale view from a deliberate correction.
 *
 * Clearing `missing_since` is part of every answer: whichever verdict the
 * curator reaches, the machine's observation has been dealt with and should
 * stop appearing in the queue. Sending `membership: 'present'` alone is the
 * "false alarm" case — the source hiccupped and the object never went anywhere.
 */
export async function setExperienceState(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { membership, existence, note, expected } = req.body as {
    membership?: Membership; existence?: Existence; note?: string;
    expected: { membership: Membership; existence: Existence; flagged: boolean };
  };

  if (!membership && !existence) {
    res.status(400).json({ error: 'Nothing to decide: pass membership, existence, or both' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id, source_membership, existence FROM experiences WHERE id = $1`,
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

  // One client, not pool.query('BEGIN') — see the note in curationController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let nextMembership: Membership;
  let nextExistence: Existence;
  let before: { source_membership: string; existence: string; missing_since?: Date | null };
  try {
    await client.query('BEGIN');

    // Both columns are written whatever the curator sent, the unsent axis
    // defaulting to what is already there — so the axis nobody decided has to
    // be read under the lock that writes it. Two curators on one item is the
    // normal case, not a corner: every region-scoped curator covering any of
    // its regions sees it, as do its category curator and every admin. From an
    // unlocked read, a verdict on one axis silently reverts a verdict on the
    // other, and the log would then assert `former` beside a column saying
    // `present`. Reverting `lost` costs more still: it puts the row back inside
    // missing detection's `existence <> 'lost'` predicate, so the next clean
    // run re-flags it and the item returns to the queue for good.
    const locked = await client.query(
      `SELECT source_membership, existence, missing_since FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
      [experienceId],
    );
    before = locked.rows[0] ?? existing;
    nextMembership = membership ?? (before.source_membership as Membership);
    nextExistence = existence ?? (before.existence as Existence);

    // Does the row still look the way the curator saw it? Only the request can
    // say — a card drawn before the question was answered is otherwise
    // indistinguishable from a deliberate correction, and the difference hides
    // where it is least visible: "false alarm" over a recorded `former` is a
    // real transition, so no check on the verdict alone catches it.
    //
    // The flag is part of that picture, not a separate concern. A run that
    // finds the object again clears `missing_since` and touches neither axis
    // (`syncUtils.ts`), so a stale queue card matches on both while the
    // question it asks has been withdrawn — and answering "former" there
    // records as delisted an object the source currently lists, which no
    // detection predicate will ever raise again.
    //
    // Comparing state rather than refusing every decided row is what keeps a
    // verdict correctable. Refusing them wholesale made `former` and `lost`
    // terminal: detection re-flags neither, so one mis-click would remove an
    // object from the product with no remedy short of SQL.
    if (before.source_membership !== expected.membership
      || before.existence !== expected.existence
      || (before.missing_since != null) !== expected.flagged) {
      unusable = await rollbackQuietly(client);
      res.status(409).json({
        error: 'Someone else answered this first — reload to see where it stands',
        sourceMembership: before.source_membership,
        existence: before.existence,
      });
      return;
    }

    const actions = decidedActions(before, nextMembership, nextExistence);
    if (actions.length === 0) {
      // Nothing moved, and the state is the one the curator saw. With a flag
      // standing that is the false alarm — the one verdict with no transition
      // to name. With none, the question was already closed: taking it would
      // write a second `missing_dismissed` and move `state_decided_by` to
      // whoever clicked last.
      if (before.missing_since == null) {
        unusable = await rollbackQuietly(client);
        res.status(409).json({
          error: 'Already answered: this object is not waiting on a decision',
          sourceMembership: before.source_membership,
          existence: before.existence,
        });
        return;
      }
      actions.push('missing_dismissed');
    }

    await client.query(`
      UPDATE experiences
      SET source_membership = $2,
          existence = $3,
          missing_since = NULL,
          state_decided_by = $4,
          state_decided_at = NOW(),
          state_note = $5,
          updated_at = NOW()
      WHERE id = $1
    `, [experienceId, nextMembership, nextExistence, userId, note ?? null]);

    for (const action of actions) {
      await client.query(`
        INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [experienceId, userId, action, logRegionId, JSON.stringify({
        membership: { old: before.source_membership, new: nextMembership },
        existence: { old: before.existence, new: nextExistence },
        note: note ?? null,
      })]);
    }
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  res.json({
    experienceId,
    sourceMembership: nextMembership,
    existence: nextExistence,
  });
}

/**
 * Publish an override's contents, but only when the override published the
 * object too.
 *
 * Split out on its own rather than an `if` inline in `setExperienceAdmission`,
 * which already carries the weight of two verdicts, a pin and a locked
 * re-read: one more branch there is the difference between this function
 * reading as one clause and reading as two. `publishes` decides everything —
 * an `auto` row was already visible, and this verdict says nothing about
 * whether anyone has read what is under it, so it must not publish a single
 * one of its pending rows.
 */
async function publishArrivalContents(
  client: PoolClient, experienceId: number, publishes: boolean,
): Promise<{
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  withdrawalsReleased: number;
}> {
  if (!publishes) {
    return { locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0 };
  }
  // Un-refusing an arrival is a publication (ADR-0025 § 4.5), and a publication
  // takes everything that arrived with the object, not only its own fields —
  // otherwise the button says "Put it back" and the curator watches the museum
  // appear with no pin and no works, because nothing else here ever moves a
  // point or a link off `pending`. `publishContents` is `publishController.ts`'s
  // own answer to "which rows does a publish reach", shared rather than copied
  // so the two can never answer that question differently again: a
  // hand-written twin here would not have gained the `missing_since IS NULL`
  // guard the shared one already carries.
  return publishContents(client, experienceId);
}

/**
 * Answer a refusal.
 * POST /api/experiences/:id/admission
 * Body: { decision: 'confirm' | 'override', note?: string }
 *
 * Two answers, because a refusal has two and neither of them is a verdict about
 * the world (ADR-0024):
 *
 * - **confirm** — the rule was right. The row stays refused and hidden.
 * - **override** — the rule was wrong. The row is admitted again.
 *
 * Both pin `admission` in `curated_fields`, and that pin is what takes the item
 * out of the queue. It is also what makes the answer durable against *runs*, in
 * both directions: a curator who has looked at the thing outranks the rule, so
 * no later run re-refuses an overridden row or re-admits a confirmed one. The
 * sync's three admission writes all skip a pinned row for that reason.
 *
 * Durable against runs is not the same as final. `override` stays available on
 * a confirmed row, because confirming hides an object from everyone and a way
 * back that an earlier click can close is not a way back — the one thing this
 * endpoint must never become is the one-way door `setExperienceState` reasoned
 * itself out of. Confirmed rows are reachable in the queue's own kept-out list,
 * since `hideRefusedSql` leaves them visible nowhere else.
 *
 * No `expected` block here, unlike `setExperienceState`. `confirm` uses the pin
 * as its concurrency check — it hides, so a second curator on a stale card must
 * not silently re-hide a row the first one just put back — while `override`
 * needs none: it reveals, and two curators clicking it reach the same state.
 */
export async function setExperienceAdmission(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { decision, note } = req.body as { decision: 'confirm' | 'override'; note?: string };

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

  const admitted = decision === 'override';
  const client = await pool.connect();
  let unusable: Error | undefined;
  // Read by the response after the transaction settles, so they have to be
  // hoisted out of the `try` block that assigns them.
  let publishes = false;
  let curationState = '';
  let locationsPublished = 0;
  let treasureLinksPublished = 0;
  let treasuresPublished = 0;
  let withdrawalsReleased = 0;
  try {
    await client.query('BEGIN');

    // Locked, for the same reason `setExperienceState` locks: every curator
    // covering any of the row's regions sees this card, and two answers racing
    // would leave the log asserting one verdict beside a column holding the
    // other.
    const locked = await client.query(
      `SELECT admission, admission_reason, curated_fields, curation_state
         FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
      [experienceId],
    );
    const before = locked.rows[0];
    // The existence check above ran on the pool, on another connection and
    // earlier in time. A row deleted in that window leaves nothing to lock, and
    // reading `curated_fields` off it would answer 500 to a question whose true
    // answer is 404. `setExperienceState` guards the same gap.
    if (!before) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Experience not found' });
      return;
    }
    const alreadyAnswered = ((before.curated_fields as string[]) ?? []).includes('admission');

    // Putting a row back is allowed whatever the pin says, and confirming is
    // not. The asymmetry is the point: `override` is the way back, and a way
    // back that a previous answer can close is not one. It is also the safe
    // direction — it reveals rather than hides, and two curators both clicking
    // it reach the same state, so nothing is lost to a race.
    //
    // `confirm` keeps the pin as its concurrency check, because it hides: a
    // second curator arriving at a stale card must not silently re-hide a row
    // the first one just put back. That row is no longer `refused` anyway, so
    // it is caught by the same condition.
    const confirmBlocked = !admitted && alreadyAnswered;
    if (before.admission !== 'refused' || confirmBlocked) {
      unusable = await rollbackQuietly(client);
      res.status(409).json({
        error: alreadyAnswered
          ? 'Someone else answered this first — reload to see where it stands'
          : 'Already answered: this row is not waiting on a refusal decision',
        admission: before.admission,
      });
      return;
    }

    const curated = [...new Set([...((before.curated_fields as string[]) ?? []), 'admission'])];
    // The reason is resolved here rather than in a CASE over $2. Postgres has to
    // deduce one type per placeholder, and a parameter used both as the value of
    // a varchar column and as the left side of a text comparison gives it two —
    // "inconsistent types deduced for parameter $2", which no mocked-pool test
    // can see and the first real click found immediately.
    //
    // Kept on a confirmed row: it is the record of what the rule objected to,
    // and the archaeology category will be built by reading exactly these.
    // Cleared on an override, where it has stopped being true.
    const nextReason = admitted ? null : before.admission_reason;

    // A refusal overridden is a publication (ADR-0025 § 4.5): otherwise the
    // button says "Put it back" and puts nothing anywhere — the curator
    // un-refuses a museum, watches it stay invisible, and has to find it again
    // in another queue to say yes a second time. Only an override, and only
    // from `pending`: an `auto` row was already visible and this verdict says
    // nothing about whether anyone read it; a `confirm` leaves an
    // already-invisible row invisible.
    //
    // `verified` rather than `auto`, because a person did look: they read the
    // card, the reason and the name, and overruled a rule about this specific
    // object. That claim is thinner than a full content pass — nobody checked
    // the description, the image or the treasures underneath — and that is the
    // deliberate cost of not asking the same question twice: the curator has
    // just answered "does this belong here", and asking "has anyone looked at
    // it" a moment later, about the same click, would be asking the same
    // question with different words.
    //
    // Built here rather than as a `CASE` over a parameter, for the reason
    // `nextReason` is: a parameter used both as the value of a varchar column
    // and as the left side of a text comparison gives Postgres two types to
    // deduce for one placeholder, and the error is invisible to every
    // mocked-pool test.
    publishes = admitted && before.curation_state === 'pending';
    curationState = publishes ? 'verified' : (before.curation_state as string);
    const publishSet = publishes
      ? `, curation_state = 'verified', published_at = COALESCE(published_at, NOW())`
      : '';

    await client.query(`
      UPDATE experiences
      SET admission = $2,
          admission_reason = $3,
          curated_fields = $4,
          state_decided_by = $5,
          state_decided_at = NOW(),
          state_note = $6,
          updated_at = NOW()${publishSet}
      WHERE id = $1
    `, [
      experienceId, admitted ? 'admitted' : 'refused', nextReason,
      JSON.stringify(curated), userId, note ?? null,
    ]);

    ({ locationsPublished, treasureLinksPublished, treasuresPublished, withdrawalsReleased } =
      await publishArrivalContents(client, experienceId, publishes));

    // No placement for the admission columns themselves. Placement's insert
    // predicate is the `offeredLocationSql` pair — `el.missing_since IS NULL AND
    // el.existence <> 'lost'` (ADR-0026) — and nothing else: it filters
    // neither `curation_state` nor `admission`, so a refused row was placed
    // exactly like any other one the moment its location landed, and
    // un-refusing it moves no geometry, no point and no membership by itself.
    // Verified on 2026-08-11 against a same-day clone of the live
    // `track_regions`: `SELECT count(*) FROM experience_regions WHERE
    // experience_id = <a refused row>` returned the same non-zero count as an
    // admitted row's, confirming the row was already placed. "Un-refusing
    // should re-place" is the intuitive answer and the wrong one — for the
    // admission columns.
    //
    // `publishArrivalContents` above is a different story: nothing about a row
    // being refused stops a later sync run deferring a withdrawal on one of
    // its locations, so an override that publishes an arrival's contents can
    // release one exactly as `publishController.ts`'s own publish can — same
    // unit, same consequence, so it gets the same follow-up below.

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [experienceId, userId, admitted ? 'admission_overridden' : 'admission_confirmed', logRegionId,
      JSON.stringify({
        reason: before.admission_reason, note: note ?? null, published: publishes,
        locations: locationsPublished, treasureLinks: treasureLinksPublished,
        treasures: treasuresPublished, withdrawalsReleased,
      })]);

    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  const placementFields = await placeAfterAdmissionRelease(experienceId, withdrawalsReleased);

  res.json({
    experienceId,
    admission: admitted ? 'admitted' : 'refused',
    published: publishes,
    // The rest mirrors `publish`'s own response, deliberately: a curator who
    // clicks "Put it back" on an arrival gets both the admission verdict and
    // the publish outcome that came with it, in the shape the review page
    // already knows how to say in one sentence. Never a held field — an
    // override does not apply a proposal; that is `/publish`'s question, not
    // this one's, and a row holding one keeps its pointer and its own card.
    curationState,
    appliedFields: [] as string[],
    claimedFieldsSkipped: [] as string[],
    // Empty for the reason the two above are: a held field of a part is a
    // proposal too (ADR-0037), and an override answers none.
    appliedParts: [] as AppliedPart[],
    fromSyncLogId: null,
    locationsPublished,
    treasureLinksPublished,
    treasuresPublished,
    withdrawalsReleased,
    ...placementFields,
  });
}

/**
 * Place the object again if publishing its contents released a withdrawal,
 * and fold the outcome into the response.
 *
 * Split out on its own for the same reason `publishArrivalContents` is: one
 * more branch inline in `setExperienceAdmission` is the difference between
 * the function reading as a sequence of decisions and reading as a maze of
 * them. Run after `setExperienceAdmission`'s own `try`/`finally` has released
 * the client — after the COMMIT and off it, since `assignRegionsForExperiences`
 * opens a transaction of its own, the same reason `publishController.ts`
 * places after its own COMMIT rather than inside the transaction it just
 * closed.
 */
async function placeAfterAdmissionRelease(
  experienceId: number, withdrawalsReleased: number,
): Promise<{
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  if (withdrawalsReleased === 0) return {};
  const failures = await placeAfterRelease(experienceId);
  if (failures.length === 0) return {};
  // The list, not only the flag. The remedy — a region re-assignment — is
  // admin-only, so a curator's actionable step is to tell an admin *which*
  // object and *which* world views, and a bare boolean reduces them to
  // "something about regions failed on the Prado". `placeAfterRelease` already
  // returns one entry per failed world view with its id and its name, and
  // `/:id/publish` already passes them through; dropping them here would have
  // made three sentences in this branch false about this one endpoint.
  // Reshaped to the same `{ id, name }` the publish endpoint answers with, so
  // the page renders one sentence for both rather than two.
  return {
    placementFailed: true,
    placementFailedWorldViews: failures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
  };
}

/**
 * Name each transition the call actually makes, so the log reads as events
 * rather than as a diff. Empty means nothing moved, which the caller
 * distinguishes: an asserted false alarm is a verdict and gets
 * `missing_dismissed`, while a verdict someone else already recorded is not
 * this curator's to log a second time.
 */
function decidedActions(
  existing: { source_membership: string; existence: string },
  membership: Membership,
  existence: Existence,
): string[] {
  const actions: string[] = [];
  if (membership === 'former' && existing.source_membership !== 'former') actions.push('marked_former');
  if (existence === 'lost' && existing.existence !== 'lost') actions.push('marked_lost');
  // One restoration however many axes it undid — two identical rows would read
  // as two separate decisions.
  const restored = (membership === 'present' && existing.source_membership === 'former')
    || (existence === 'extant' && existing.existence === 'lost');
  if (restored) actions.push('state_restored');
  return actions;
}
