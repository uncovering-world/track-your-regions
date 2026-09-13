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
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishContents, placeAfterRelease } from './publishContents.js';
import type { AppliedPart } from './publishHeldParts.js';
import { CLEAR_ICONIC } from '../../services/sync/admission.js';

type Membership = 'present' | 'former';
type Existence = 'extant' | 'lost';

/** What a curator sends about an object's lifecycle, and the row they were looking at. */
export interface StateAnswer {
  membership?: Membership;
  existence?: Existence;
  note?: string;
  expected: { membership: Membership; existence: Existence; flagged: boolean };
}

/**
 * Why a writer under the lock could not answer, with the HTTP status the
 * single-row route sends and the payload it sends with it. A batch (#852)
 * reads the same shape and reports it per object instead.
 */
export interface AnswerRefusal {
  status: number;
  error: string;
  [detail: string]: unknown;
}

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
  const body = req.body as StateAnswer;

  if (!body.membership && !body.existence) {
    res.status(400).json({ error: 'Nothing to decide: pass membership, existence, or both' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, source_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.source_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await answerStateUnderLock(experienceId, userId, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/**
 * The verdict itself, in one transaction under the row lock — the half of
 * `setExperienceState` that a batch answer (#852) calls for each of its rows,
 * so one row and a hundred are decided by the same statements. The handler
 * keeps what is about the request: the 404, the scope, the status code.
 */
export async function answerStateUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { membership, existence, note, expected }: StateAnswer,
): Promise<{
  result?: { experienceId: number; sourceMembership: Membership; existence: Existence };
  refusal?: AnswerRefusal;
}> {
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

    // Awaited at every call site, as on the neighbouring writers: a
    // `return refuse(…)` without it settles the try block while the ROLLBACK
    // is still in flight, and `finally` releases the client under it.
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    // Both columns are written whatever the curator sent, the unsent axis
    // defaulting to what is already there — so the axis nobody decided has to
    // be read under the lock that writes it. Two curators on one item is the
    // normal case, not a corner: every region-scoped curator covering any of
    // its regions sees it, as do its source's curator and every admin. From an
    // unlocked read, a verdict on one axis silently reverts a verdict on the
    // other, and the log would then assert `former` beside a column saying
    // `present`. Reverting `lost` costs more still: it puts the row back inside
    // missing detection's `existence <> 'lost'` predicate, so the next clean
    // run re-flags it and the item returns to the queue for good.
    const locked = await client.query(
      `SELECT source_membership, existence, missing_since FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
      [experienceId],
    );
    // The existence check ran on the pool, on another connection and earlier
    // in time. A row deleted in that window leaves nothing to lock, and the
    // true answer is 404 — `setExperienceAdmission` guards the same gap.
    if (locked.rows.length === 0) return await refuse({ status: 404, error: 'Experience not found' });
    before = locked.rows[0];
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
    // (`experienceUpsert.ts`), so a stale queue card matches on both while the
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
      return await refuse({
        status: 409,
        error: 'Someone else answered this first — reload to see where it stands',
        sourceMembership: before.source_membership,
        existence: before.existence,
      });
    }

    const actions = decidedActions(before, nextMembership, nextExistence);
    if (actions.length === 0) {
      // Nothing moved, and the state is the one the curator saw. With a flag
      // standing that is the false alarm — the one verdict with no transition
      // to name. With none, the question was already closed: taking it would
      // write a second `missing_dismissed` and move `state_decided_by` to
      // whoever clicked last.
      if (before.missing_since == null) {
        return await refuse({
          status: 409,
          error: 'Already answered: this object is not waiting on a decision',
          sourceMembership: before.source_membership,
          existence: before.existence,
        });
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

  return {
    result: {
      experienceId,
      sourceMembership: nextMembership,
      existence: nextExistence,
    },
  };
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
 * What a verdict on a refusal does to the must-see flag, appended to the
 * verdict's own `UPDATE`.
 *
 * A confirmed refusal drops the flag the way the run's own refusal writes do,
 * and it has to: the pin that statement writes is what keeps every later run
 * off the row, so whatever the flag holds after it is what it holds for good.
 * Eight museums refused on the day those writes landed wore the badge that way
 * until migration 042 (#760). `override` leaves the flag where the refusal put
 * it — an admitted museum without the badge is a legitimate state (ADR-0045
 * decision 5), and what the badge should mean beyond works-first admission is
 * #603's question, not this endpoint's.
 */
function iconicAfterVerdictSql(admitted: boolean): string {
  return admitted ? '' : `, ${CLEAR_ICONIC}`;
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
  const body = req.body as AdmissionAnswer;

  const expResult = await pool.query(
    `SELECT id, source_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, expResult.rows[0].source_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await answerAdmissionUnderLock(experienceId, userId, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/** The two answers to a refusal, and the curator's note. */
export interface AdmissionAnswer {
  decision: 'confirm' | 'override';
  note?: string;
}

/** What answering a refusal reports — `publish`'s own shape, with the verdict in front. */
export interface AdmissionResult {
  experienceId: number;
  admission: 'admitted' | 'refused';
  published: boolean;
  curationState: string;
  appliedFields: string[];
  claimedFieldsSkipped: string[];
  appliedParts: AppliedPart[];
  fromSyncLogId: null;
  heldLeftOpen: number;
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  withdrawalsReleased: number;
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * The verdict itself, under the row lock, and the placement that may follow
 * it — the half of `setExperienceAdmission` a batch answer (#852) calls per
 * row. The handler keeps the 404, the scope and the status code.
 */
export async function answerAdmissionUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { decision, note }: AdmissionAnswer,
): Promise<{ result?: AdmissionResult; refusal?: AnswerRefusal }> {
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

    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    // Locked, for the same reason `setExperienceState` locks: every curator
    // covering any of the row's regions sees this card, and two answers racing
    // would leave the log asserting one verdict beside a column holding the
    // other.
    // The lock first, in a statement of its own. The existence check above ran
    // on the pool, on another connection and earlier in time. A row deleted in
    // that window leaves nothing to lock, and reading the membership off it
    // would answer 500 to a question whose true answer is 404.
    // `setExperienceState` guards the same gap.
    const locked = await client.query(
      `SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId],
    );
    if (locked.rows.length === 0) return await refuse({ status: 404, error: 'Experience not found' });
    // The verdict, its reason, the pin and the gate state are the membership's
    // (#822), read in the statement after the place's lock — the one every
    // writer of the membership takes. Its own statement because a statement's
    // snapshot is taken before it waits for the lock, and only the locked row
    // is re-read once it is granted (`db/locks.ts`). Which membership: the
    // refused one, the place's only one until #755.
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.admission_reason, m.curated_fields,
              m.curation_state
         FROM experiences e
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'refused')}
        WHERE e.id = $1`,
      [experienceId],
    );
    // Present: a DELETE of the row waits on the lock this transaction holds.
    const before = read.rows[0];
    const membershipId = (before.membership_id as number | null) ?? null;
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
    if (membershipId === null || before.admission !== 'refused' || confirmBlocked) {
      return await refuse({
        status: 409,
        error: alreadyAnswered
          ? 'Someone else answered this first — reload to see where it stands'
          : 'Already answered: this row is not waiting on a refusal decision',
        admission: before.admission,
      });
    }

    const curated = [...new Set([...((before.curated_fields as string[]) ?? []), 'admission'])];
    // The reason is resolved here rather than in a CASE over $2. Postgres has to
    // deduce one type per placeholder, and a parameter used both as the value of
    // a varchar column and as the left side of a text comparison gives it two —
    // "inconsistent types deduced for parameter $2", which no mocked-pool test
    // can see and the first real click found immediately.
    //
    // Kept on a confirmed row: it is the record of what the rule objected to,
    // and the archaeology kind will be built by reading exactly these.
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

    // The verdict, the pin, the badge and the publication on the membership;
    // who decided, when and the note on the place, beside the lifecycle
    // verdicts that share those columns. Two statements, one transaction, one
    // lock (#822).
    await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = $2,
          admission_reason = $3,
          curated_fields = $4,
          updated_at = NOW()${publishSet}${iconicAfterVerdictSql(admitted)}
      WHERE m.id = $1
    `, [
      membershipId, admitted ? 'admitted' : 'refused', nextReason,
      JSON.stringify(curated),
    ]);
    await client.query(`
      UPDATE experiences
      SET state_decided_by = $2,
          state_decided_at = NOW(),
          state_note = $3,
          updated_at = NOW()
      WHERE id = $1
    `, [experienceId, userId, note ?? null]);

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

  return { result: {
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
    // Zero because this call answered no held row, not because none was open
    // (#722): a row holding a proposal keeps its pointer and its own card
    // through an override, exactly as the paragraph above says. The field is
    // present rather than absent so the one sentence the review page builds
    // from this shape needs no branch for which endpoint produced it.
    heldLeftOpen: 0,
    locationsPublished,
    treasureLinksPublished,
    treasuresPublished,
    withdrawalsReleased,
    ...placementFields,
  } };
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
