/**
 * A curator's answer to one kind whose source stopped listing a place another
 * source still lists (#1264).
 *
 * The Capitoline Museums after a merge: an art museum and an archaeological
 * collection, and a Wikidata reclassification makes the Archaeology run stop
 * finding them while the art-museum source goes on listing them. The place is
 * not missing — its own flag reads missing only once every source stopped
 * listing it, and that is the place's card (`answerStateUnderLock`) — so this
 * asks one thing: is the place still of this kind?
 *
 * Two answers. A false alarm keeps it there. "No longer this kind" takes it out
 * of that kind's list — a curator's refusal of the membership, which the
 * kept-out list can take back — except for a kind that keeps a delisted place
 * as former (`KINDS_KEPT_AS_FORMER`): a site UNESCO delisted stays a former
 * World Heritage Site. Whether the place still stands is not asked here: other
 * sources still list it.
 */

import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { logCurationAct } from '../../db/curationLogWriter.js';
import { MEMBERSHIPS, keptAsFormerSql } from '../../db/membership.js';
import type { SourceMembership } from '@tyr/shared/lifecycle';
import { placeGoneUnderLock } from '../../db/placePeriodsWriter.js';
import { refuseOnMembership, setMembershipListingVerdict } from './membershipWriter.js';

/** The reason a kind's membership is kept out once its source stopped listing the place. */
export const NO_LONGER_LISTED_REASON = 'no longer listed by its source';

export interface KindListingAnswer {
  membershipId: number;
  membership?: SourceMembership;
  gone?: boolean;
  note?: string;
  /** The membership as the curator was looking at it; `gone` is the place's. */
  expected: { membership: SourceMembership; gone: boolean; flagged: boolean };
}

interface Refusal {
  status: number;
  error: string;
  [detail: string]: unknown;
}

interface Answered {
  experienceId: number;
  sourceMembership: SourceMembership;
  gone: boolean;
}

/** The verdict on one kind, in one transaction under the place's lock. */
export async function answerKindListingUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { membershipId, membership, gone, note, expected }: KindListingAnswer,
): Promise<{ result?: Answered; refusal?: Refusal }> {
  if (membership === undefined || (gone !== undefined && gone !== expected.gone)) {
    return {
      refusal: {
        status: 409,
        error: 'Other sources still list this place, so whether it still stands is not asked here — '
          + 'answer whether it is still of this kind',
      },
    };
  }
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: Refusal): Promise<{ refusal: Refusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockExperience<{ missing_since: Date | null }>(client, experienceId, 'missing_since');
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    // Every source dropped the place since the card was drawn: whether it still
    // stands is the place's own question now, and its card asks it.
    if (locked.row.missing_since != null) {
      return await refuse({
        status: 409, error: 'Every source has stopped listing this place — reload and answer the place itself',
      });
    }
    const read = await client.query(
      `SELECT m.kind_id, m.source_membership, m.missing_since, m.curated_fields, ${keptAsFormerSql('m')} AS kept
         FROM ${MEMBERSHIPS} m WHERE m.id = $1 AND m.experience_id = $2`,
      [membershipId, experienceId],
    );
    const before = read.rows[0];
    if (!before) {
      return await refuse({
        status: 409, error: 'Already answered: this place no longer holds the membership the card named — reload',
      });
    }
    // The card as the curator saw it, compared under the lock, for the reason
    // the place's verdict compares it: a run that found the place again clears
    // the flag, and "no longer this kind" then would take out a place its
    // source lists again.
    if (before.source_membership !== expected.membership || (before.missing_since != null) !== expected.flagged) {
      return await refuse({
        status: 409,
        error: 'Someone else answered this first — reload to see where it stands',
        sourceMembership: before.source_membership,
      });
    }
    if (before.missing_since == null || before.source_membership !== 'present') {
      return await refuse({ status: 409, error: 'Already answered: this kind is not waiting on a decision' });
    }

    await setMembershipListingVerdict(client, locked.lock, membershipId, membership);
    const takesOut = membership === 'former' && before.kept !== true;
    if (takesOut) {
      // Out of the kind the way a curator's refusal of an arrival is: pinned,
      // so no run puts it back, and in the kept-out list where one click does.
      const curated = [...new Set([...((before.curated_fields as string[]) ?? []), 'admission'])];
      await refuseOnMembership(client, locked.lock, membershipId, NO_LONGER_LISTED_REASON, curated);
    }
    await logCurationAct(client, {
      experienceId, curatorId: userId, action: membership === 'former' ? 'marked_former' : 'missing_dismissed',
      regionId: logRegionId, membership: { id: membershipId, kindId: before.kind_id as number },
      details: { takenOutOfKind: takesOut, note: note ?? null },
    });

    const gone = await placeGoneUnderLock(client, locked.lock);
    await client.query('COMMIT');
    return { result: { experienceId, sourceMembership: membership, gone } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
