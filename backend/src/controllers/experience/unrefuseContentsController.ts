/**
 * The way back from a curator's no to an unread point or work (#859).
 *
 * ADR-0053 wrote that no as a mark rather than a state — `refused_at` on
 * `experience_locations` and `experience_treasures` — and said in the same
 * breath what it was leaving behind: *a refused part has no screen yet*, so the
 * take-back is a follow-up, and because the mark is a column it is one UPDATE
 * when that screen exists. This is that UPDATE, and the review page's
 * turned-down list is that screen.
 *
 * It is the third take-back on the page and the smallest, because the refusal
 * it undoes wrote nothing else: a refused part kept `curation_state =
 * 'pending'` and stayed hidden from every reader exactly as it was, so clearing
 * the mark restores the *question* and nothing about what anyone can see. What
 * comes back is composed rather than restored — `unreadPointSql` /
 * `unreadLinkSql` carry `refused_at IS NULL`, so the queue, the contents card,
 * the waiting count and the three publish statements all start asking again off
 * one column, with no reader touched.
 *
 * **Two things the refusal did are deliberately not undone.**
 *
 * A refused *link* was set `curation_state = 'pending'` beside its mark, and
 * stays `pending` here. That word is the one every reader hides by, and a link
 * whose own state the refusal moved from `auto` had never been passed *here*
 * (ADR-0025 decision 2's second axis); putting `auto` back would silently pass
 * a work a curator had turned down, which is the opposite of asking again.
 *
 * A refused *point* released the withdrawal it had been holding — the old pin
 * it replaced was written `missing_since` and the pairing cleared — and that
 * pairing is gone for good. The old point is a withdrawn point asking its own
 * question now (ADR-0026), on its own card, with its own two answers; a
 * take-back that re-acquired it would answer that card on the curator's behalf
 * and put a pin back on the map from a screen that never mentioned it. The
 * take-back restores the question, never the pairing.
 *
 * What it *does* restore beyond the question is region membership: placement's
 * insert carries `refused_at IS NULL` (ADR-0053), so a turned-down point counts
 * toward no region, and a point asked about again has to count again — hence
 * `placeAfterRelease` after the commit, and hence `authenticatedLimiter` on the
 * route, for the same reason the refusal carries it.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { answerThroughScope } from './curatorRefusalController.js';
import { placeAfterRelease } from './publishContents.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { contentsAnswerableSql } from './waitingCounts.js';

export interface UnrefuseContentsResult {
  experienceId: number;
  locationsRestored: number;
  treasureLinksRestored: number;
  /** Exactly which points came back, so the line afterwards can name them as the refusal's log row named what it took. */
  locationIds: number[];
  /** Exactly which works came back, by treasure id — the id the link is named by everywhere a curator sees one. */
  treasureIds: number[];
  /** The re-placement a restored point calls for — it counts toward its regions again — where it failed; the refusal's own shape. */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * Ask again about points and works this object's curator had turned down — the
 * named ones, or all of them.
 * POST /api/experiences/:id/unrefuse-contents
 * Body: { locationIds?: number[], treasureIds?: number[], note?: string }
 */
export async function unrefuseContents(req: AuthenticatedRequest, res: Response): Promise<void> {
  await answerThroughScope(req, res, (experienceId, userId, logRegionId) =>
    unrefuseContentsUnderLock(experienceId, userId, logRegionId,
      req.body as { locationIds?: number[]; treasureIds?: number[]; note?: string }));
}

/**
 * The take-back, in one transaction under the place's lock.
 *
 * The preconditions are the refusal's own, read under the lock and answered with
 * the same words: only an object a rule admitted, that somebody has passed, and
 * that the source still offers can hold unread contents at all — so those are
 * the only objects whose contents can be asked about again. An object that has
 * since been kept out or withdrawn is 409 rather than a silent success, because
 * putting the question back under a card nobody will ever be shown is not the
 * take-back the curator asked for.
 */
export async function unrefuseContentsUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { locationIds, treasureIds, note }: { locationIds?: number[]; treasureIds?: number[]; note?: string },
): Promise<{ result?: UnrefuseContentsResult; refusal?: AnswerRefusal }> {
  const anyNamed = locationIds !== undefined || treasureIds !== undefined;
  const client = await pool.connect();
  let unusable: Error | undefined;
  // Read by the placement and the reply after the transaction settles, so they
  // have to be hoisted out of the `try` block that assigns them.
  let restoredPoints: number[] = [];
  let restoredLinks: number[] = [];
  try {
    await client.query('BEGIN');

    // Awaited at every call site, as on the neighbouring writers: a rollback
    // left running while the reply is built is a client back in the pool with
    // a transaction still open on it.
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    // The lock in a statement of its own and the read in the next: under READ
    // COMMITTED a folded sub-select is evaluated against the snapshot the
    // statement started with, so the row it locks and the row it reads can be
    // two versions (`db/locks.ts`).
    const locked = await client.query(
      `SELECT missing_since FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId],
    );
    if (locked.rows.length === 0) return await refuse({ status: 404, error: 'Experience not found' });
    // The rule itself is evaluated by the database rather than restated in
    // JavaScript, so the list that draws the button and this cannot drift; the
    // columns beside it are for the sentence, not the verdict.
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.curation_state,
              (${contentsAnswerableSql()}) AS answerable
         FROM experiences e
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'waiting')}
        WHERE e.id = $1`,
      [experienceId],
    );
    const before = read.rows[0] ?? {};
    // `e.missing_since` is read by the fragment above from the same row the lock
    // took, so the locked read's own copy is not consulted twice.
    if (before.answerable !== true) {
      return await refuse({
        status: 409,
        error: before.curation_state === 'pending'
          ? 'Nobody has passed this object yet — answer the arrival, which takes its contents with it'
          : 'This object is not one whose contents can be asked about',
        admission: before.admission ?? null,
        curationState: before.curation_state ?? null,
      });
    }

    // Named ids narrow each kind the way the refusal narrows its statements: a
    // caller naming works alone touches no point.
    if (locationIds !== undefined || !anyNamed) {
      restoredPoints = await restorePoints(client, experienceId, locationIds);
    }
    if (treasureIds !== undefined || !anyNamed) {
      restoredLinks = await restoreLinks(client, experienceId, treasureIds);
    }

    if (restoredPoints.length + restoredLinks.length === 0) {
      return await refuse({
        status: 409,
        error: 'Nothing turned down is left under this object — reload to see where it stands',
      });
    }

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'contents_unrefused', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      locations: restoredPoints.length,
      treasureLinks: restoredLinks.length,
      // Always the ids, where the refusal recorded them only when its caller
      // named them. The difference is that a take-back knows: the statement
      // returns exactly the rows it touched, and a trail saying which three
      // paintings came back is worth more than one saying three did — this row
      // is the only place a part that has come and gone can be followed.
      locationIds: restoredPoints,
      treasureIds: restoredLinks,
      note: note ?? null,
    })]);

    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  // A point asked about again counts toward its regions again: placement's
  // insert takes offered points that no curator has turned down, so the rows
  // the refusal's re-place dropped have to come back, and the object's own
  // union with them. After the COMMIT and after this request's client is back
  // in the pool, for the reason the refusal states: placement takes its own
  // connections per world view, and holding this one across the sweep would be
  // the one place a curator's answer could exhaust the pool.
  const placementFailures = restoredPoints.length > 0
    ? await placeAfterRelease(experienceId, 'A curator asked again about a point of experience %d')
    : [];

  return { result: {
    experienceId,
    locationsRestored: restoredPoints.length,
    treasureLinksRestored: restoredLinks.length,
    locationIds: restoredPoints,
    treasureIds: restoredLinks,
    ...(placementFailures.length === 0 ? {} : {
      placementFailed: true as const,
      placementFailedWorldViews: placementFailures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
    }),
  } };
}

/**
 * Clear the mark on the turned-down points, and say which.
 *
 * The mark alone, with no offered term beside it, and that is a decision rather
 * than an omission. A refused point is always `pending` — the refusal only marks
 * rows `unreadPointSql` reaches — and `withdrawnPointOpenSql` asks for
 * `curation_state <> 'pending'`, so a refused point the source then stops
 * offering raises no `withdrawn` card either. Filtering on offered here would
 * leave it on no screen at all, with the answer that put it there permanently
 * unanswerable — which is the whole thing this module exists to prevent.
 * Restoring one changes nothing a reader sees: it is `pending` and withdrawn,
 * exactly the state it would have been in had nobody turned it down.
 */
async function restorePoints(
  client: PoolClient, experienceId: number, locationIds?: number[],
): Promise<number[]> {
  const named = locationIds !== undefined;
  const points = await client.query<{ id: number }>(
    `UPDATE experience_locations SET refused_at = NULL
      WHERE experience_id = $1 AND refused_at IS NOT NULL
      ${named ? 'AND id = ANY($2::int[])' : ''}
      RETURNING id`,
    named ? [experienceId, locationIds] : [experienceId],
  );
  return points.rows.map(row => row.id);
}

/**
 * Clear the mark on the turned-down work links, and say which works.
 *
 * The mark alone, for the reason the points' writer above gives: a withdrawn
 * link has no card of its own either, so an offered term would strand it.
 *
 * `curation_state` is deliberately not written: the refusal set the link
 * `pending` and that is what "nobody passed this work here" means. The work's
 * own axis is not this act's to decide — see the module docblock.
 */
async function restoreLinks(
  client: PoolClient, experienceId: number, treasureIds?: number[],
): Promise<number[]> {
  const named = treasureIds !== undefined;
  const links = await client.query<{ treasure_id: number }>(
    `UPDATE experience_treasures et SET refused_at = NULL
      WHERE et.experience_id = $1 AND et.refused_at IS NOT NULL
      ${named ? 'AND et.treasure_id = ANY($2::int[])' : ''}
      RETURNING et.treasure_id`,
    named ? [experienceId, treasureIds] : [experienceId],
  );
  return links.rows.map(row => row.treasure_id);
}
