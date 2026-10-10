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
 * A refused *point* that was a move keeps the pairing it held (ADR-0083): the
 * stored pin it would replace stayed where readers see it, and taking the no
 * back asks the move again as it was asked, with that pin. Nothing here touches
 * the pairing. A refusal recorded before ADR-0083 released its pairing — the
 * old pin withdrawn and asking its own question (ADR-0026) — and a take-back
 * does not re-acquire it: that would answer the old pin's card on the curator's
 * behalf, from a screen that never mentioned it.
 *
 * What it *does* restore beyond the question is region membership: placement's
 * insert carries `refused_at IS NULL` (ADR-0053), so a turned-down point counts
 * toward no region, and a point asked about again has to count again — hence
 * `placeAfterRelease` after the commit, and hence `authenticatedLimiter` on the
 * route, for the same reason the refusal carries it.
 */

import type { z } from 'zod/v4';
import type { UnrefuseContentsResult } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import type { idParamSchema, refuseContentsBodySchema } from '../../types/index.js';
import { answerThroughScope } from './curatorRefusalController.js';
import { contentsMembershipId } from './experienceScope.js';
import { placeAfterRelease } from './publishContents.js';
import { placementReport } from './placementReport.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { contentsAnswerableSql, contentsMembershipToAnswerSql } from './waitingCounts.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { restoreRefusedPoints } from './experienceLocationWriter.js';
import { restoreRefusedLinks } from './workWriter.js';

/**
 * Ask again about points and works this object's curator had turned down — the
 * named ones, or all of them.
 * POST /api/experiences/:id/unrefuse-contents
 * Body: { locationIds?: number[], treasureIds?: number[], note?: string }
 */
export async function unrefuseContents(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof refuseContentsBodySchema>; caller: Express.User;
  },
): Promise<UnrefuseContentsResult> {
  // In the scope of the source whose membership the rows are asked through
  // (#1264, #1290): the one the body names, else the first holding turned-down rows.
  return answerThroughScope(id, caller, (experienceId, userId, logRegionId) =>
    unrefuseContentsUnderLock(experienceId, userId, logRegionId, body),
  await contentsMembershipId(id, 'refused', body.membershipId));
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
  { locationIds, treasureIds, note, membershipId }: {
    locationIds?: number[]; treasureIds?: number[]; note?: string; membershipId?: number;
  },
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
    const locked = await lockExperience<{ missing_since: Date | null }>(client, experienceId, 'missing_since');
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    // The rule itself is evaluated by the database rather than restated in
    // JavaScript, so the list that draws the button and this cannot drift; the
    // columns beside it are for the sentence, not the verdict.
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.curation_state,
              (${contentsAnswerableSql()}) AS answerable
         FROM experiences e
         -- Through the membership the body names, else the first holding
         -- turned-down rows (#1264, #1290); with none, the waiting one, whose
         -- state says what to answer instead.
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = COALESCE(
           ${contentsMembershipToAnswerSql('e.id', '$2::int', 'refused')}, ${membershipToAnswerSql('e.id', 'waiting')})
        WHERE e.id = $1`,
      [experienceId, membershipId ?? null],
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
    // Through the answering membership alone (#1290): another kind's
    // turned-down rows under the same place stay turned down.
    const answering = before.membership_id as number;
    if (locationIds !== undefined || !anyNamed) {
      restoredPoints = await restoreRefusedPoints(client, locked.lock, locationIds, answering);
    }
    if (treasureIds !== undefined || !anyNamed) {
      restoredLinks = await restoreRefusedLinks(client, locked.lock, treasureIds, answering);
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
    ...placementReport(placementFailures),
  } };
}
