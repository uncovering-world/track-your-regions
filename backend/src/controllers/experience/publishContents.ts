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
import { publishUnreadPoints, releaseDeferredWithdrawals } from './experienceLocationWriter.js';
import { lockWorksToPublish, publishUnreadLinks, publishUnreadWorks } from './workWriter.js';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { pointMovedToSql } from './movedPoint.js';
import { offeredLinkSql, offeredLocationSql } from '../../db/readerPredicates.js';
import { linkAnsweredBySql, pointAnsweredBySql, unreadLinkSql, unreadPointSql } from './waitingCounts.js';

/**
 * The unread points and works one membership's answer reaches, by id (#1290):
 * exactly the rows its section drew — the rows asked through it; for an
 * arrival, the rows its run placed that no offered membership is asked
 * through; and, for an arrival that is the place's only membership, the rows
 * nothing placed and no kind yet answers for (`pointAnsweredBySql`,
 * `linkAnsweredBySql`) — the named ones among them. Read under the lock
 * **before** the caller makes an arriving membership offered: read after, a
 * row another kind's section drew would be asked through the arrival's kind
 * where that kind sorts first, and go out with an arrival no section of that
 * kind showed it under. A kind named alone leaves the other kind's rows
 * untouched, as `publishContents`' own naming rule has it. Read by the publish
 * (`publishController.ts`) and by the admission's override
 * (`lifecycleController.ts`), which both reach `publishContents`.
 */
export async function contentsReached(
  client: PoolClient,
  experienceId: number,
  { locationIds, treasureIds, membershipId }: { locationIds?: number[]; treasureIds?: number[]; membershipId: number },
): Promise<{ locationIds?: number[]; treasureIds?: number[] }> {
  const reached = await client.query<{ points: number[]; works: number[] }>(
    `SELECT COALESCE((SELECT array_agg(el.id) FROM experience_locations el
                       WHERE el.experience_id = $1 AND ${offeredLocationSql('el')} AND ${unreadPointSql('el')}
                         AND ${pointAnsweredBySql('el', '$2::int')}
                         AND ($3::int[] IS NULL OR el.id = ANY($3::int[]))), '{}') AS points,
            COALESCE((SELECT array_agg(DISTINCT et.treasure_id) FROM experience_treasures et
                       JOIN treasures t ON t.id = et.treasure_id
                       WHERE et.experience_id = $1 AND ${offeredLinkSql('et')} AND ${unreadLinkSql('et', 't')}
                         AND ${linkAnsweredBySql('et', '$2::int')}
                         AND ($4::int[] IS NULL OR et.treasure_id = ANY($4::int[]))), '{}') AS works`,
    [experienceId, membershipId, locationIds ?? null, treasureIds ?? null],
  );
  const { points, works } = reached.rows[0];
  const namesPoints = locationIds !== undefined || treasureIds === undefined;
  const namesWorks = treasureIds !== undefined || locationIds === undefined;
  return { locationIds: namesPoints ? points : undefined, treasureIds: namesWorks ? works : undefined };
}

/**
 * Whether a publish naming these ids publishes the venue's pending works: when
 * it names works, or names nothing at all. Naming only points leaves every
 * work where it is. `publishContents` decides by it, and a caller that locks
 * the works ahead of it (`publishUnderLock`) asks the same question here
 * rather than restating it.
 */
export function worksPublished(locationIds?: number[], treasureIds?: number[]): boolean {
  return treasureIds !== undefined || locationIds === undefined;
}

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
  lock: LockedExperience,
  locationIds?: number[],
  treasureIds?: number[],
  membershipId?: number,
): Promise<{
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  withdrawalsReleased: number;
}> {
  const anyNamed = locationIds !== undefined || treasureIds !== undefined;

  let locationsPublished = 0;
  if (locationIds !== undefined || !anyNamed) {
    // Exactly the points the `contents` card shows (`publishUnreadPoints` says why).
    locationsPublished = await publishUnreadPoints(client, lock, locationIds, membershipId);
  }

  // A point that moved is a withdrawal plus an insert, and the location writer
  // held the withdrawal back until the arrival is answered: this is the moment the
  // two swap, in this transaction (`releaseDeferredWithdrawals` says why).
  let withdrawalsReleased = 0;
  if (locationsPublished > 0) {
    withdrawalsReleased = await releaseDeferredWithdrawals(client, lock);
  }

  let treasureLinksPublished = 0;
  let treasuresPublished = 0;
  if (worksPublished(locationIds, treasureIds)) {
    // The works this writes, locked ascending in one statement before the
    // UPDATE takes them in scan order (#1095); where the caller already took
    // them, with the held works, the rows are this transaction's already.
    await lockWorksToPublish(client, lock, { heldRefs: [], pending: { treasureIds, membershipId } });
    // Two states from one id, because they are two facts: the link says this
    // work has been passed as being *here*, the work says it has been passed at
    // all — "checked once, globally" (ADR-0025 decision 2). A reader's treasure
    // list gates both, so publishing one and not the other would leave the
    // card's count unanswered.
    treasureLinksPublished = await publishUnreadLinks(client, lock, treasureIds, membershipId);
    treasuresPublished = await publishUnreadWorks(client, lock, treasureIds, membershipId);
  }

  return { locationsPublished, treasureLinksPublished, treasuresPublished, withdrawalsReleased };
}

/**
 * The unread point that is the object's own coordinate moving, or null: the
 * rule `pointMovedToSql` states, asked of the coordinate this transaction has
 * just written. A publish that writes the held `location` publishes this point
 * with it, so the object's coordinate and its pin move together (#1233) —
 * Ephesus after run 146, whose one point moved 158 m.
 */
export async function pointMovedWithObject(client: PoolClient, lock: LockedExperience): Promise<number | null> {
  const found = await client.query<{ id: number | null }>(
    `SELECT ${pointMovedToSql('e.id', 'e.location')} AS id FROM experiences e WHERE e.id = $1`,
    [lock.id],
  );
  return found.rows[0]?.id ?? null;
}

/**
 * Place the object again, because one of its points stopped counting.
 *
 * The one publish that genuinely moves geometry — see the note after the COMMIT
 * for why every other one does not. Placement's insert carries the
 * `offeredLocationSql` pair — the point is still offered and not gone from the
 * world — and, since ADR-0053, a third term, `el.refused_at IS NULL`, while its clear
 * is unfiltered: so a point that stopped being offered, and a point a curator
 * turned down, each leave `experience_location_regions` rows behind that only a
 * re-place can drop, and only a re-place can recompute the experience-level
 * union they fed. A writer that sets any of the three has to call this.
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
  // What sent it here, in the log's own words. The default line is true of a
  // publication that released a deferred withdrawal, and of an admission that
  // published an arrival's contents and released one — which is why
  // `placeAfterAdmissionRelease` deliberately passes no trigger, having done both.
  // Every other caller sends its own: a curator's verdict on a point, a curator's
  // correction to one, accepting the source's coordinate, which puts a corrected
  // pin back where the source has it, turning down any point, which stops it
  // counting toward a region and withdraws any pin it was holding (ADR-0053),
  // asking again about a point that was turned down, which is that one read
  // backwards (#859), and a merge of two places or its undo, which moves points
  // between them (ADR-0086). Nothing is published on any of those, so the
  // hardcoded line would be false in every clause — and a log line naming the
  // wrong cause is worse than a vague one, because it sends whoever reads it to
  // the wrong code.
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
