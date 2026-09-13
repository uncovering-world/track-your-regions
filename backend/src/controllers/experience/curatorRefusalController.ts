/**
 * A curator's *no* to what a gated source proposed (#852, ADR-0053).
 *
 * The gate (ADR-0025) holds two things until a person looks: an object nobody
 * has passed — an arrival — and the unread points and works under an object
 * readers already see. Publishing is the yes to both. Until this module there
 * was no no: an arrival nobody wanted stayed `pending` for ever, on every
 * curator's list, and unread contents could only be released or left waiting.
 * A review row is a proposal with two answers, and these are the second
 * answer for the two kinds that lacked one.
 *
 * **Refusing an arrival is written the way a rule's refusal is.** The
 * membership takes `admission = 'refused'`, a reason that says a person did
 * it, and the admission pin — so the row leaves the queue for the kept-out
 * list at once, every later run honours the answer, and *Put it back*
 * (`POST /:id/admission { override }`) is the way back, publishing the
 * arrival as it always has (ADR-0025 § 4.5). `curation_state` stays
 * `pending`: nobody passed it, and ADR-0025 decision 4 asks that both facts
 * be said rather than one folded into the other.
 *
 * **Refusing unread contents is a mark, never a fourth state.** A refused
 * part keeps `curation_state = 'pending'`, so every reader hides it by the
 * one word it already reads; what the mark changes is the question — the
 * queue and the publish compose `unreadPointSql` / `unreadLinkSql`, which
 * carry `refused_at IS NULL`, and stop offering it. The way back is the one
 * UPDATE the mark being a column always promised, and it lives next door in
 * `unrefuseContentsController.ts` (#859), read from the review page's
 * turned-down list.
 *
 * Both writers are `*UnderLock` functions in the shape of their neighbours,
 * called by their single-row route here and per row by the batch answer.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CLEAR_ICONIC } from '../../services/sync/admission.js';
import { offeredLinkSql, offeredLocationSql } from './experienceLifecycle.js';
import { resolveExperienceScope } from './experienceScope.js';
import { placeAfterRelease } from './publishContents.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { contentsAnswerableSql, unreadLinkSql, unreadPointSql } from './waitingCounts.js';

/** The reason a curator's refusal carries, in the words the kept-out list shows. */
export const CURATOR_REFUSAL_REASON = 'kept out by a curator';

export interface RefuseArrivalResult {
  experienceId: number;
  admission: 'refused';
  reason: string;
}

export interface RefuseContentsResult {
  experienceId: number;
  locationsRefused: number;
  treasureLinksRefused: number;
  /** Old pins a refused arrival had been holding on the map, now withdrawn and asking their own question. */
  withdrawalsReleased: number;
  /** The re-placement any refused point calls for — it counts toward no region now, and any pin it released is gone — where it failed; the publish's own shape. */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * Keep out an object nobody has passed.
 * POST /api/experiences/:id/refuse-arrival
 * Body: { note?: string }
 */
export async function refuseArrival(req: AuthenticatedRequest, res: Response): Promise<void> {
  await answerThroughScope(req, res, (experienceId, userId, logRegionId) =>
    refuseArrivalUnderLock(experienceId, userId, logRegionId, req.body as { note?: string }));
}

/**
 * Turn down the unread points and works under a visible object — the named
 * ones, or all of them.
 * POST /api/experiences/:id/refuse-contents
 * Body: { locationIds?: number[], treasureIds?: number[], note?: string }
 */
export async function refuseContents(req: AuthenticatedRequest, res: Response): Promise<void> {
  await answerThroughScope(req, res, (experienceId, userId, logRegionId) =>
    refuseContentsUnderLock(experienceId, userId, logRegionId,
      req.body as { locationIds?: number[]; treasureIds?: number[]; note?: string }));
}

/**
 * The request half every single-row curator route shares: 404, scope, status code.
 *
 * Exported for the take-back beside it (`unrefuseContentsController.ts`), which is
 * the same request from the same person about the same object and would otherwise
 * spell the 404 and the 403 a second time — two spellings of "may this curator
 * answer for this object" is exactly the drift `resolveExperienceScope` exists to
 * prevent.
 */
export async function answerThroughScope<T>(
  req: AuthenticatedRequest,
  res: Response,
  write: (experienceId: number, userId: number, logRegionId: number | null)
    => Promise<{ result?: T; refusal?: AnswerRefusal }>,
): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;

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

  const outcome = await write(experienceId, userId, logRegionId);
  if (outcome.refusal) {
    const { status, ...payload } = outcome.refusal;
    res.status(status).json(payload);
    return;
  }
  res.json(outcome.result);
}

/**
 * The refusal of an arrival, in one transaction under the place's lock.
 *
 * Open arrivals only — `arrivalOpenSql`'s terms, read under the lock: a
 * membership nobody has passed, one the rule admitted, on a row the source
 * still offers. Anything else is 409 with the reason, because each of the
 * others has its own answer elsewhere: a rule-refused row is the refusal
 * card's, a passed row is not an arrival, and a withdrawn row is `missing`'s.
 */
export async function refuseArrivalUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { note }: { note?: string },
): Promise<{ result?: RefuseArrivalResult; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // Awaited at every call site, as on the neighbouring writers: a
    // `return refuse(…)` without it settles the try block while the ROLLBACK
    // is still in flight, and `finally` releases the client under it.
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    // The lock first, in a statement of its own (`db/locks.ts`); the
    // membership in the next, so a run that moved it during the wait is seen.
    const locked = await client.query(
      `SELECT missing_since FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId],
    );
    if (locked.rows.length === 0) return await refuse({ status: 404, error: 'Experience not found' });
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.curation_state, m.curated_fields
         FROM experiences e
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'waiting')}
        WHERE e.id = $1`,
      [experienceId],
    );
    const before = read.rows[0] ?? {};
    const membershipId = (before.membership_id as number | null) ?? null;
    if (membershipId === null || before.admission !== 'admitted'
      || before.curation_state !== 'pending' || locked.rows[0].missing_since != null) {
      return await refuse({
        status: 409,
        error: 'Already answered: this object is not an arrival waiting on a decision',
        admission: before.admission ?? null,
        curationState: before.curation_state ?? null,
      });
    }

    // The verdict, its reason and the pin on the membership, the badge cleared
    // the way a rule's refusal clears it (#760): the pin keeps every later run
    // off the row, so what the badge holds after this is what it holds for
    // good. Who decided, when and the note on the place, beside the other
    // verdicts that share those columns.
    const curated = [...new Set([...((before.curated_fields as string[]) ?? []), 'admission'])];
    await client.query(`
      UPDATE ${MEMBERSHIPS} m
      SET admission = 'refused',
          admission_reason = $2,
          curated_fields = $3,
          updated_at = NOW(),
          ${CLEAR_ICONIC}
      WHERE m.id = $1
    `, [membershipId, CURATOR_REFUSAL_REASON, JSON.stringify(curated)]);
    await client.query(`
      UPDATE experiences
      SET state_decided_by = $2,
          state_decided_at = NOW(),
          state_note = $3,
          updated_at = NOW()
      WHERE id = $1
    `, [experienceId, userId, note ?? null]);

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'arrival_refused', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      reason: CURATOR_REFUSAL_REASON, note: note ?? null,
    })]);

    await client.query('COMMIT');
    return { result: { experienceId, admission: 'refused', reason: CURATOR_REFUSAL_REASON } };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * The refusal of unread contents, in one transaction under the place's lock.
 *
 * Reaches exactly the rows the `contents` card shows and the publish would
 * release — the same two fragments, so a part the card never showed cannot be
 * refused here and one it shows always can. Only under a visible, admitted
 * object the source still offers: an arrival's contents are answered with
 * the arrival (publishing takes them, refusing keeps them out), and a refused
 * or withdrawn object raises no contents card at all.
 *
 * Nothing reached is 409 rather than an empty 200: the card asked about
 * something, and a click that turned down nothing is a stale card.
 */
export async function refuseContentsUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { locationIds, treasureIds, note }: { locationIds?: number[]; treasureIds?: number[]; note?: string },
): Promise<{ result?: RefuseContentsResult; refusal?: AnswerRefusal }> {
  const anyNamed = locationIds !== undefined || treasureIds !== undefined;
  const client = await pool.connect();
  let unusable: Error | undefined;
  // Read by the placement and the reply after the transaction settles, so
  // they have to be hoisted out of the `try` block that assigns them.
  let points = { refused: 0, withdrawalsReleased: 0 };
  let treasureLinksRefused = 0;
  try {
    await client.query('BEGIN');

    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await client.query(
      `SELECT missing_since FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId],
    );
    if (locked.rows.length === 0) return await refuse({ status: 404, error: 'Experience not found' });
    // The rule itself is the database's, through the fragment every act on an
    // object's unread contents composes: this refusal, the take-back that undoes
    // it, the waiting count and the list that draws the take-back's button. Two
    // spellings is how a refusal and its own undoing come to disagree about which
    // objects they apply to. The columns beside it are what the message branches
    // on, not the verdict.
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.curation_state,
              (${contentsAnswerableSql()}) AS answerable
         FROM experiences e
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'waiting')}
        WHERE e.id = $1`,
      [experienceId],
    );
    const before = read.rows[0] ?? {};
    if (before.answerable !== true) {
      return await refuse({
        status: 409,
        error: before.curation_state === 'pending'
          ? 'Nobody has passed this object yet — answer the arrival, which takes its contents with it'
          : 'Already answered: this object is not holding unread contents',
        admission: before.admission ?? null,
        curationState: before.curation_state ?? null,
      });
    }

    // Named ids narrow each kind the way `publishContents` narrows its
    // statements: a caller naming works alone touches no point.
    if (locationIds !== undefined || !anyNamed) {
      points = await markPointsRefused(client, experienceId, locationIds);
    }
    const locationsRefused = points.refused;
    if (treasureIds !== undefined || !anyNamed) {
      treasureLinksRefused = await markLinksRefused(client, experienceId, treasureIds);
    }

    if (locationsRefused + treasureLinksRefused === 0) {
      return await refuse({
        status: 409,
        error: 'Nothing unread is left under this object — reload to see where it stands',
      });
    }

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'contents_refused', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      locations: locationsRefused,
      treasureLinks: treasureLinksRefused,
      // The old pins a refused arrival had been holding on the map, now
      // withdrawn and asking their own question — nowhere else records when.
      withdrawalsReleased: points.withdrawalsReleased,
      // The ids where the caller named them, so the trail says which twelve
      // paintings rather than "twelve": a refused part is invisible everywhere
      // else, and this row is where a person finds it again.
      ...(locationIds === undefined ? {} : { locationIds }),
      ...(treasureIds === undefined ? {} : { treasureIds }),
      note: note ?? null,
    })]);

    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  // A refused point is a placement event, twice over. Placement's insert
  // takes offered points and, since ADR-0053, none a curator turned down — a
  // pending point is placed on purpose because it is about to be published,
  // and a refused one never will be, so its region rows have to go or the
  // object keeps counting toward a region it will never show a pin in. And
  // where the point was holding a withdrawal, the old point's rows have to go
  // for the reason the publish re-places (`publishContents.ts`). The clear is
  // unfiltered and the insert is not, so one re-place does both. After the
  // COMMIT and after this request's client is back in the pool — placement
  // takes its own connections per world view, and holding this one across
  // the sweep would be the one place a curator's answer could exhaust the
  // pool — which is the reason the route carries `authenticatedLimiter`.
  const placementFailures = points.refused > 0
    ? await placeAfterRelease(experienceId, 'A curator turned down a point of experience %d')
    : [];

  return { result: {
    experienceId,
    locationsRefused: points.refused,
    treasureLinksRefused,
    withdrawalsReleased: points.withdrawalsReleased,
    ...(placementFailures.length === 0 ? {} : {
      placementFailed: true as const,
      placementFailedWorldViews: placementFailures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
    }),
  } };
}

/**
 * The mark on the unread offered points — the named ones, or all of them —
 * and the withdrawal a refused point may have been holding back.
 *
 * A gated source that *moves* a point writes the new one `pending` and defers
 * the old one's withdrawal onto it (`locationWriter`), so readers keep the old
 * pin until the arrival is published — and only the publish released that
 * pairing. Refusing the arrival must release it too, or the old pin stays on
 * the map for ever with no question anywhere: the refused point is out of the
 * contents card, and the old one carries no `missing_since` for the withdrawn
 * card to see. The source dropped that place, and a curator turned down its
 * replacement, so the old point becomes what it is — a withdrawn point,
 * asking its own question (ADR-0026) — through the same two statements the
 * publish uses, in this transaction.
 */
async function markPointsRefused(
  client: PoolClient, experienceId: number, locationIds?: number[],
): Promise<{ refused: number; withdrawalsReleased: number }> {
  const named = locationIds !== undefined;
  const points = await client.query(
    `UPDATE experience_locations SET refused_at = NOW()
      WHERE experience_id = $1 AND ${unreadPointSql('experience_locations')}
        AND ${offeredLocationSql('experience_locations')}
      ${named ? 'AND id = ANY($2::int[])' : ''}`,
    named ? [experienceId, locationIds] : [experienceId],
  );
  const refused = points.rowCount ?? 0;
  if (refused === 0) return { refused, withdrawalsReleased: 0 };

  // Every pairing a refused point of this object holds, not only this call's:
  // a pairing left standing by an earlier refusal is the same stranded pin.
  const released = await client.query(
    `UPDATE experience_locations old
        SET missing_since = NOW(), ordinal = NULL,
            withdrawal_deferred_for_location_id = NULL
       FROM experience_locations refused
      WHERE refused.experience_id = $1
        AND old.experience_id = $1
        AND refused.withdrawal_deferred_for_location_id = old.id
        AND refused.refused_at IS NOT NULL
        AND old.missing_since IS NULL`,
    [experienceId],
  );
  await client.query(
    `UPDATE experience_locations
        SET withdrawal_deferred_for_location_id = NULL
      WHERE experience_id = $1
        AND withdrawal_deferred_for_location_id IS NOT NULL
        AND refused_at IS NOT NULL`,
    [experienceId],
  );
  return { refused, withdrawalsReleased: released.rowCount ?? 0 };
}

/**
 * The mark on the unread offered links — on the link, not the work: "not
 * this work here" is the link's axis, and the work stays askable at every
 * other venue that holds it. The join is one row per link, so the UPDATE
 * writes each link once.
 *
 * The link's own state goes to `pending` with the mark. A link is unread on
 * either axis (ADR-0025 decision 2), so one whose own state is `auto` can be
 * refused here because its *work* is pending — and the work is one row for
 * every venue, published from whichever venue passes it first. Readers hide
 * a link by `<> 'pending'` on both axes and never read the mark, so a
 * refused link left `auto` would surface the day the work is published
 * elsewhere. Pending says what is true — nobody passed this work *here* —
 * and keeps the one reader word the mark relies on.
 */
async function markLinksRefused(
  client: PoolClient, experienceId: number, treasureIds?: number[],
): Promise<number> {
  const named = treasureIds !== undefined;
  const links = await client.query(
    `UPDATE experience_treasures et SET refused_at = NOW(), curation_state = 'pending'
       FROM treasures t
      WHERE t.id = et.treasure_id AND et.experience_id = $1
        AND ${unreadLinkSql('et', 't')} AND ${offeredLinkSql('et')}
      ${named ? 'AND et.treasure_id = ANY($2::int[])' : ''}`,
    named ? [experienceId, treasureIds] : [experienceId],
  );
  return links.rowCount ?? 0;
}
