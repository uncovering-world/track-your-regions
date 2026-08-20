/**
 * A curator's verdict on one point of an object.
 *
 * ADR-0022 stopped deleting a point the source withdrew and left the question
 * open: is it delisted, is it gone, or was the source simply wrong? The row has
 * carried the machine's observation since — `missing_since` — and nothing could
 * answer it. This is the answer, and ADR-0026 is where the shape of it is argued.
 *
 * Its own file rather than another verdict inside `lifecycleController.ts`, on the
 * precedent of `declineSourceController.ts`: the subject is a different row, the
 * lock is on a different table, and one rule here is the *opposite* of the one
 * there — see `missing_since` below.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { placeAfterRelease } from './publishContents.js';

type Membership = 'present' | 'former';
type Existence = 'extant' | 'lost';

/**
 * Name each transition this call makes, so the log reads as events rather than as
 * a diff. Empty means nothing moved, which the caller distinguishes: an asserted
 * false alarm is a verdict and gets `location_missing_dismissed`, while a verdict
 * someone else already recorded is not this curator's to log again.
 *
 * The mirror of `decidedActions` in `lifecycleController.ts`, prefixed: a trail
 * about an object must not read a component's departure as the whole site's.
 */
function decidedActions(
  before: { source_membership: string; existence: string },
  membership: Membership,
  existence: Existence,
): string[] {
  const actions: string[] = [];
  if (membership === 'former' && before.source_membership !== 'former') {
    actions.push('location_marked_former');
  }
  if (existence === 'lost' && before.existence !== 'lost') {
    actions.push('location_marked_lost');
  }
  // One restoration however many axes it undid — two identical rows would read as
  // two separate decisions.
  const restored = (membership === 'present' && before.source_membership === 'former')
    || (existence === 'extant' && before.existence === 'lost');
  if (restored) actions.push('location_state_restored');
  return actions;
}

/**
 * Whether a reader may be shown a point, in TypeScript rather than in SQL.
 *
 * The mirror of `offeredLocationSql` — flag clear *and* not declared gone from the
 * world — and it exists because this endpoint has to ask the question twice, of the
 * row as it stood and of the row it is about to write. Two hand-rolled copies of a
 * two-term condition is how the two sides came to disagree once already: `clearFlag`
 * means "both axes came out clean", which is stricter than "visible", and a row whose
 * flag was already NULL is visible whatever the membership axis says.
 */
function offeredToReaders(flagClear: boolean, existence: Existence): boolean {
  return flagClear && existence !== 'lost';
}

/**
 * Record what a curator decided about a point the source stopped offering.
 * POST /api/experiences/locations/:locationId/state
 * Body: { membership?: 'present'|'former', existence?: 'extant'|'lost', note?: string,
 *         expected: { membership, existence, flagged } }
 *
 * `expected` is required and compared under the write lock, exactly as it is for an
 * experience: it is the only thing that tells a card drawn before the question was
 * answered from a deliberate correction made with the current state in view, and the
 * second has to stay possible or a mis-click would remove a point from the product
 * for good.
 *
 * **`missing_since` is where this differs from the experience-level verdict, and it
 * differs deliberately.** There, every answer clears the flag, because no
 * reader-facing read is keyed on it. Here it is *one of the two terms* a reader-facing
 * read carries — `offeredLocationSql` is `missing_since IS NULL AND existence <>
 * 'lost'` (ADR-0026 decision 7) — and each verdict is held by a different one of them:
 *
 * - `former` is held by the flag. Clearing it would put the pin back on the map for a
 *   place the source no longer lists, so this verdict leaves it standing.
 * - `lost` is held by its own axis, whatever the flag says. That is what makes the
 *   verdict outlive a run: the writer's `returned` arm clears the flag when the source
 *   offers the point again, so a `lost` point held by the flag alone would come back.
 *   It also means `lost` is the one answer here that can *hide* a point readers could
 *   see, which is the verdict's purpose rather than a side effect.
 * - the false alarm is the only answer that clears the flag — but not the only one that
 *   can reveal a point. Taking a `lost` verdict back on a row whose flag is already
 *   clear reveals it too, with `clearFlag` false throughout, which is exactly the
 *   combination the note above `isVisible` names. Revealing is a fact about both axes
 *   together; clearing the flag is a fact about one.
 *
 * Leaving the flag standing is also what removes an answered row from the queue, which
 * asks about flagged, undecided points — so no read had to learn a predicate for the
 * queue's sake, and the one read predicate that did change is in the shared fragment
 * rather than in eight call sites.
 *
 * A cleared flag leaves `ordinal` NULL, which is a shape every client already
 * handles — a held withdrawal produces exactly it (ADR-0025 decision 5), the API
 * types it `number | null`, and the point sorts last until a run gives it a place
 * in the source's list again.
 *
 * **A verdict that changes what a reader sees has to place the point, and that is
 * the one expensive branch here.** A withdrawn point has no `auto` region rows: the
 * run that marked it re-placed the experience, and placement takes offered points
 * only (ADR-0022) — measured on the live row, 0 region rows against the offered
 * point's 3. So revealing a point without placing it puts a pin on the map that
 * counts in no region, and hiding one without placing leaves a region counting a
 * place nobody is shown. Both directions call the same `placeAfterRelease` that
 * publishing uses for the same event, after the client is released, and report what
 * failed rather than swallowing it. It is also why this route carries
 * `authenticatedLimiter` where its object-level twin does not.
 */
export async function setLocationState(req: AuthenticatedRequest, res: Response): Promise<void> {
  const locationId = parseInt(String(req.params.locationId));
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

  // The point carries no scope of its own: it is judged through the object holding
  // it, which is where the regions and the category live.
  const found = await pool.query(
    `SELECT el.id, el.experience_id, e.category_id
       FROM experience_locations el
       JOIN experiences e ON e.id = el.experience_id
      WHERE el.id = $1`,
    [locationId],
  );
  if (found.rows.length === 0) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }
  const { experience_id: experienceId, category_id: categoryId } = found.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId as number, categoryId as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const client = await pool.connect();
  let unusable: Error | undefined;
  let nextMembership: Membership;
  let nextExistence: Existence;
  let clearFlag: boolean;
  let isVisible = false;
  let visibilityChanged = false;
  try {
    await client.query('BEGIN');

    // **The object first, then the point**, the order `editLocation` and
    // `accept-source` take them in. This handler took the point alone and reached
    // the object anyway, invisibly: its audit row is `experience_curation_log`,
    // whose `experience_id` references `experiences`, so the INSERT takes
    // `FOR KEY SHARE` on the parent — which conflicts with the `FOR UPDATE` the
    // other two hold while they wait for this point. Two curators answering one
    // point closed that cycle and Postgres broke it with a deadlock, failing one
    // of them with a 500. Taken explicitly here so the order is a rule of the four
    // writers rather than of the two that state it.
    await client.query(`SELECT id FROM experiences WHERE id = $1 FOR UPDATE`, [experienceId]);

    // Both axes are written whatever the curator sent, the unsent one defaulting to
    // what is stored — so the axis nobody decided has to be read under the lock that
    // writes it, or a verdict on one silently reverts a verdict on the other.
    const locked = await client.query(
      `SELECT source_membership, existence, missing_since
         FROM experience_locations WHERE id = $1 FOR UPDATE`,
      [locationId],
    );
    // Guarded rather than cast: the row was found on the pool, and this reads it on
    // another connection a moment later. A row gone in that window leaves no rows
    // here, and the cast would hide it until the first property access threw — a 500
    // for a question whose true answer is 404. `setExperienceState` guards the same
    // gap with `?? existing`; there is no earlier snapshot to fall back on here,
    // because the first read deliberately selects only what scope needs.
    const before = locked.rows[0] as
      { source_membership: string; existence: string; missing_since: Date | null } | undefined;
    if (!before) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    nextMembership = membership ?? (before.source_membership as Membership);
    nextExistence = existence ?? (before.existence as Existence);

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

    // The point becomes visible again only where both axes say it should be: the
    // false alarm, and taking back a verdict that had hidden it. Computed before the
    // actions are named, because whether this call *is* the false alarm is what tells
    // the one no-transition verdict from a verdict merely re-sent.
    clearFlag = nextMembership === 'present' && nextExistence === 'extant';

    const actions = decidedActions(before, nextMembership, nextExistence);
    if (actions.length === 0) {
      // Nothing moved, and the row is the one the curator saw. Two states reach here
      // and only one is a verdict. A flag standing *and* an answer that clears it is
      // the false alarm — the one verdict with no transition to name. A flag standing
      // beside an answer that keeps the point hidden is the same verdict sent twice,
      // and calling that `location_missing_dismissed` would write a dismissal into
      // the trail beside a `missing_since` nothing dismissed, plus a fresh
      // `state_decided_by` for a decision nobody changed. Unreachable from the
      // withdrawal card, which sends the waiting state and so collides above —
      // reachable for every other client of a documented endpoint, which is the
      // audience the correction path exists for.
      if (before.missing_since == null || !clearFlag) {
        unusable = await rollbackQuietly(client);
        res.status(409).json({
          error: 'Already answered: this point is not waiting on a decision',
          sourceMembership: before.source_membership,
          existence: before.existence,
        });
        return;
      }
      actions.push('location_missing_dismissed');
    }

    // Placement follows visibility **in either direction**, which is why this asks
    // whether it changed rather than whether the point was revealed. Both columns,
    // because `offeredLocationSql` hides a point on either the flag or a `lost`
    // verdict — and placement carries the same pair, so a point that stops being
    // visible must stop counting toward a region just as surely as one that starts
    // being visible must start.
    //
    // Each direction has its own missed path, and both are reachable through this
    // endpoint. Revealing: a point is withdrawn, a curator answers `lost`, the source
    // offers it again and the run clears the flag (#543's flapping point), and then
    // the curator takes the `lost` back — the flag is already NULL by then, so a
    // flag-only gate places nothing, and the next run's fast path finds stored ==
    // matched and never reaches the slow path. Hiding: an offered point is answered
    // `lost`, so every read stops showing it while its `auto` region rows stay behind
    // — a region counting a place nobody is shown, which is exactly what the
    // predicate in `regionAssignmentService.ts` was widened to prevent.
    //
    // `placeAfterRelease` recomputes the experience from scratch either way — it
    // deletes the `auto` rows and reinserts for the points that qualify now — so one
    // call serves both directions and repeating it is harmless.
    const wasVisible = offeredToReaders(
      before.missing_since == null, before.existence as Existence);
    // Visible *after* is not `clearFlag`. That means "both axes came out clean",
    // which is stricter: the UPDATE clears the flag only when it holds, so a row
    // whose flag was already NULL keeps it either way. So the after side is the flag
    // as it will stand — cleared now, or already clear — beside the existence axis
    // the answer wrote. Membership is in neither expression, because it is in no
    // reader-facing read.
    //
    // The combination that separates them: `{former, lost, flag NULL}` — a delisted,
    // demolished point the source has since offered again — and a curator taking the
    // `lost` back. `nextMembership` inherits `former`, so `clearFlag` is false while
    // the row does become visible, and a gate keyed on `clearFlag` places nothing.
    isVisible = offeredToReaders(clearFlag || before.missing_since == null, nextExistence);
    visibilityChanged = isVisible !== wasVisible;

    await client.query(`
      UPDATE experience_locations
      SET source_membership = $2,
          existence = $3,
          missing_since = CASE WHEN $4 THEN NULL ELSE missing_since END,
          state_decided_by = $5,
          state_decided_at = NOW(),
          state_note = $6
      WHERE id = $1
    `, [locationId, nextMembership, nextExistence, clearFlag, userId, note ?? null]);

    for (const action of actions) {
      // Against the experience, because the trail a curator reads is the object's —
      // and then naming the point, or a serial site with seven components records
      // seven indistinguishable verdicts.
      await client.query(`
        INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [experienceId, userId, action, logRegionId, JSON.stringify({
        locationId,
        membership: { old: before.source_membership, new: nextMembership },
        existence: { old: before.existence, new: nextExistence },
        note: note ?? null,
      })]);
    }
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  // After the client is released and the transaction has committed, like every other
  // caller of this: placement takes its own connections per world view, and holding
  // this request's while it runs would be the one place a curator's answer could
  // exhaust the pool.
  const placementFailures = visibilityChanged
    ? await placeAfterRelease(
        experienceId,
        // Its own words: reached from here nothing was published and no deferred
        // withdrawal was released, and the default would send whoever reads the log to
        // `publishController` for a failure that happened answering a card.
        'A verdict on a point of experience %d changed what a reader sees')
    : [];

  res.json({
    locationId,
    experienceId,
    sourceMembership: nextMembership,
    existence: nextExistence,
    // What the answer did to what a reader sees, said plainly rather than left for
    // the client to infer from a pair of axes — and the *same* expression the
    // placement gate uses, or the reply would promise one thing while the region rows
    // were computed for another.
    offeredToReaders: isVisible,
    // Named rather than counted, and only when there is something to say: a point
    // back on the map but missing from a region's list is a state a curator can
    // report, and one nobody can guess from a successful answer.
    ...(placementFailures.length > 0 && {
      placementFailed: true,
      placementFailedWorldViews: placementFailures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
    }),
  });
}
