/**
 * Publishing the unread points and works under an object — the named ones, or
 * all of them — and, since that publish can release a withdrawal, placing the
 * object again afterward.
 *
 * Its own module rather than functions inside `publishController.ts`, because
 * both questions stand on their own and have no dependency on the transaction
 * shell that calls them: no lock, no refusal, no audit row, no scope check.
 * `publishContents` takes only the client already inside somebody else's
 * transaction and the id; `placeAfterRelease` takes only the id, since it runs
 * after that transaction has committed and opens transactions of its own.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import {
  assignRegionsForExperiences, worldViewsWithGeometry,
} from '../../services/sync/regionAssignmentService.js';
import { offeredLocationSql } from './experienceLifecycle.js';

/**
 * Publish the unread points and works — the named ones, or all of them.
 *
 * Which kinds run is decided from the ids alone, not from whether this is an
 * object or a contents publish — that decision (whether the experience's own
 * row is also touched) is the caller's to make, and is orthogonal to this
 * one. `anyNamed` false means neither array was sent, which covers an object
 * publish and a bare `{ contentsOnly: true }` publish identically: both mean
 * "every pending row of both kinds", differing only in whether the
 * experience's own state comes with it. `anyNamed` true means the caller
 * named at least one kind, and named exactly what was named: `{ treasureIds }`
 * alone must not touch a single location, or a curator answering the
 * `contents` card's treasure count would silently also publish points nobody
 * asked about.
 *
 * `curation_state = 'pending'` on every statement keeps the counts honest:
 * `rowCount` then reports what this call changed rather than how many ids the
 * caller happened to send. The named predicate is appended rather than written
 * as `($2::int[] IS NULL OR …)`, so each statement asks one question and each
 * parameter has one job.
 */
export async function publishContents(
  client: PoolClient,
  experienceId: number,
  locationIds?: number[],
  treasureIds?: number[],
): Promise<{
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  withdrawalsReleased: number;
}> {
  const anyNamed = locationIds !== undefined || treasureIds !== undefined;

  let locationsPublished = 0;
  if (locationIds !== undefined || !anyNamed) {
    const named = locationIds !== undefined;
    // The predicate matches the `contents` card exactly — that query takes it from
    // `offeredLocationSql` on the same table — and the two have to move together:
    // the card is what asks the question this statement answers, so a row the card
    // never showed must not be something this can publish, and a row it shows must
    // be something this reaches. Both terms, therefore: since ADR-0026 the fragment
    // also hides a point a curator declared gone from the world, and publishing one
    // would record a curator as having passed a component another curator called
    // demolished.
    //
    // Not merely cosmetic, and not "publishing it changes nothing on screen"
    // either — that is true only for as long as the point stays withdrawn.
    // `locationWriter`'s "offering it again" arm clears `missing_since` and
    // deliberately leaves `curation_state` alone, so a point published while
    // withdrawn reappears on the map already marked `verified`: a coordinate no
    // card ever put in front of a curator, recorded as one a curator passed.
    const result = await client.query(
      `UPDATE experience_locations SET curation_state = 'verified'
        WHERE experience_id = $1 AND curation_state = 'pending'
          AND ${offeredLocationSql('experience_locations')}
        ${named ? 'AND id = ANY($2::int[])' : ''}`,
      named ? [experienceId, locationIds] : [experienceId],
    );
    locationsPublished = result.rowCount ?? 0;
  }

  // A point that moved is a withdrawal plus an insert, and `locationWriter` held
  // the withdrawal back so a reader would not watch the old pin vanish while its
  // replacement was invisible. This is the moment the two swap, and it is in this
  // transaction because on either side of a COMMIT the place exists twice or not
  // at all.
  //
  // Driven off the arrival's own column rather than off the ids just published:
  // the pairing is on the new row and names the old one, so this reads it from the
  // row it is publishing instead of searching for a partner. `<> 'pending'` is
  // what makes it "now that a reader can see it" — the statement above is the only
  // thing that can have made that true, since `locationWriter` writes a pairing
  // only onto a `pending` row.
  //
  // `old.missing_since IS NULL` so nothing is withdrawn twice: a second publish
  // of the same point must not restamp the date on which its predecessor stopped
  // being offered.
  //
  // Both sides are scoped to this experience, not only the arrival. The writer
  // never pairs across objects, and the foreign key does not say so — this is the
  // one statement in the endpoint that could reach a row whose scope the caller
  // was not checked against, so it says so itself.
  //
  // **The released point's own pairing goes with it**, mirroring the writer's
  // withdraw statement, which clears the pairing of every row it marks and for the
  // same reason: a withdrawn row can never be published, so a pairing left on it
  // would hold the point *it* named visible with nothing able to release it. This
  // is the floor rather than the fix — `locationWriter`'s `withdrawn` CTE takes
  // visible rows only, so a chain of pairings cannot form in the first place — and
  // both are here on purpose. Prevention costs a reader nothing; without the floor,
  // a chain arriving by some route the writer does not cover leaves a duplicate pin
  // for up to one source interval, and the failure it guards is permanent and
  // needs hand-written SQL to undo.
  let withdrawalsReleased = 0;
  if (locationsPublished > 0) {
    const released = await client.query(
      `UPDATE experience_locations old
        SET missing_since = NOW(), ordinal = NULL,
            withdrawal_deferred_for_location_id = NULL
        FROM experience_locations arrived
       WHERE arrived.experience_id = $1
         AND old.experience_id = $1
         AND arrived.withdrawal_deferred_for_location_id = old.id
         AND arrived.curation_state <> 'pending'
         AND old.missing_since IS NULL`,
      [experienceId],
    );
    withdrawalsReleased = released.rowCount ?? 0;

    // The pairing has done its work and must not outlive it. Left standing, a run
    // that offers the old point again clears its `missing_since`, and the next run
    // to withdraw it finds the stale pointer and holds it for ever — there is no
    // second arrival left for anyone to publish.
    //
    // Unconditional on which rows the release above matched: a pairing whose point
    // some other path had already withdrawn matched nothing there, and is just as
    // finished.
    await client.query(
      `UPDATE experience_locations
        SET withdrawal_deferred_for_location_id = NULL
       WHERE experience_id = $1
         AND withdrawal_deferred_for_location_id IS NOT NULL
         AND curation_state <> 'pending'`,
      [experienceId],
    );
  }

  let treasureLinksPublished = 0;
  let treasuresPublished = 0;
  if (treasureIds !== undefined || !anyNamed) {
    const named = treasureIds !== undefined;
    const args = named ? [experienceId, treasureIds] : [experienceId];
    // Two states from one id, because they are two facts: the link says this
    // work has been passed as being *here*, the work says it has been passed at
    // all — "checked once, globally" (ADR-0025 decision 2). A reader's treasure
    // list gates both, so publishing one and not the other would leave the
    // card's count unanswered.
    const links = await client.query(
      `UPDATE experience_treasures SET curation_state = 'verified'
        WHERE experience_id = $1 AND curation_state = 'pending'
        ${named ? 'AND treasure_id = ANY($2::int[])' : ''}`,
      args,
    );
    treasureLinksPublished = links.rowCount ?? 0;

    // Scoped through this experience's own links, so a request cannot publish a
    // work by naming an id that has nothing to do with the object the caller's
    // scope was checked against.
    const works = await client.query(
      `UPDATE treasures SET curation_state = 'verified', updated_at = NOW()
        WHERE curation_state = 'pending'
          AND EXISTS (
            SELECT 1 FROM experience_treasures et
             WHERE et.treasure_id = treasures.id AND et.experience_id = $1
               ${named ? 'AND et.treasure_id = ANY($2::int[])' : ''}
          )`,
      args,
    );
    treasuresPublished = works.rowCount ?? 0;
  }

  return { locationsPublished, treasureLinksPublished, treasuresPublished, withdrawalsReleased };
}

/**
 * Place the object again, because one of its points stopped being offered.
 *
 * The one publish that genuinely moves geometry — see the note after the COMMIT
 * for why every other one does not. Placement's insert carries the
 * `offeredLocationSql` pair — `el.missing_since IS NULL AND el.existence <> 'lost'`
 * — while its clear is unfiltered, so the released point's
 * `experience_location_regions` rows have to go, and only a re-place can recompute
 * the experience-level union they fed.
 *
 * Reports failure rather than throwing, the way `recordPlacementFailure`
 * downgrades a run to `partial`: by the time this runs the publication is
 * committed, so an exception here would answer 500 to a curator whose click did
 * land — and the caller's `catch` would run ROLLBACK on a transaction that no
 * longer exists. What is stale on a failure is `experience_regions` for one
 * object, and the remedy is a re-assignment, so the honest answer is to say the
 * publication happened and that this did not.
 *
 * Every world view is attempted and every failure named, rather than stopping at
 * the first: each one is its own transaction over its own regions, so one failing
 * says nothing about the next, and abandoning the rest would leave them stale
 * with nothing saying which. `placeMovedExperiences` collects them the same way
 * for the same reason. Returns one entry per world view that failed, empty when
 * they all placed — the caller turns "any" into `placementFailed` and hands the
 * entries themselves to the curator, who cannot re-assign anything and needs to
 * be able to say which object and which world views to an admin who can.
 *
 * Each failure is named twice over: `worldViewName` for the person reading the
 * notice and `worldViewId` for the admin they take it to. The name is looked up
 * once, for the failures only, and a lookup that fails itself costs nothing —
 * the id still identifies the world view, and this whole path is already the
 * error path.
 */
export async function placeAfterRelease(
  experienceId: number,
  // What sent it here, in the log's own words. Two callers now: a publication that
  // released a deferred withdrawal, and a curator's verdict on a point, which places
  // whenever it changes what a reader sees. Hardcoding the first made every line this
  // function logs false for the second — nothing was published and no withdrawal was
  // released — and a log line that names the wrong cause is worse than a vague one,
  // because it sends whoever reads it to the wrong code.
  trigger = 'Publishing experience %d released a withdrawal',
): Promise<Array<{ worldViewId: number | null; worldViewName: string | null }>> {
  const failed: number[] = [];
  let worldViews: number[];
  try {
    worldViews = await worldViewsWithGeometry();
  } catch (error) {
    // Its own catch, outside the loop: a transient failure listing world views
    // means nothing was placed at all, which is a different sentence from a named
    // world view refusing — and the one case with no world view to name.
    const message = error instanceof Error ? error.message : String(error);
    console.error('%s but the world views to place it in could not be listed: %s',
      trigger.replace('%d', String(experienceId)), message);
    return [{ worldViewId: null, worldViewName: null }];
  }

  for (const worldViewId of worldViews) {
    try {
      await assignRegionsForExperiences([experienceId], worldViewId);
    } catch (error) {
      // Constant format string, as everywhere this codebase logs a value: a
      // template literal lets that value forge the shape of a log line.
      const message = error instanceof Error ? error.message : String(error);
      console.error('%s but re-placing it in world view %d failed: %s',
        trigger.replace('%d', String(experienceId)), worldViewId, message);
      failed.push(worldViewId);
    }
  }
  if (failed.length === 0) return [];

  const names = new Map<number, string>();
  try {
    const named = await pool.query(
      `SELECT id, name FROM world_views WHERE id = ANY($1::int[])`, [failed]);
    for (const row of named.rows) names.set(row.id as number, row.name as string);
  } catch (error) {
    // Deliberately swallowed: the ids are already the answer, and failing the
    // whole call over a cosmetic lookup would report a publication that landed
    // as an error.
    console.error('%s but the world views that failed to place could not be named: %s',
      trigger.replace('%d', String(experienceId)), error instanceof Error ? error.message : String(error));
  }
  return failed.map(id => ({ worldViewId: id, worldViewName: names.get(id) ?? null }));
}
