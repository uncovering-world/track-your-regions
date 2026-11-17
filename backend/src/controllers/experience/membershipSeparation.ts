/**
 * A curator separates one kind's membership of a place into a place of its own
 * (ADR-0144, #1885): the way back from a merge, and from a run finding the
 * place by an identifier it carries (ADR-0143), when the identifier turns out
 * to name another thing — the Archaeology membership of the Pantheon, say, if
 * its item named another temple.
 *
 * Keyed on the membership, since a run's join leaves no merge record to read:
 * what the membership alone places goes with it, and what other memberships of
 * the place place too is copied, each place keeping what its own memberships
 * place.
 *
 * - the membership itself, with its identifier (`external_id`), so the
 *   registry holds the new place claiming it, and, for a World Heritage
 *   membership, the site's record of its own list line with the line's item
 *   (ADR-0200);
 * - the points and work links it places: those it alone places move, and
 *   those another membership places too are copied to the new place, the
 *   separated membership placing the copy;
 * - the changeset rows of its source's runs, and the answers to held fields
 *   of its kind (`source_id`), which go with the proposals they answer.
 *
 * The place's own records stay: a curator's choices between views and
 * refusals of a value are about the original, its region assignments and
 * rejections, its parts, and its visits, since the catalogue cannot know which
 * place a traveller stood at. Each visit of the original raises a question to
 * its traveller instead (#1887).
 *
 * A component part of a serial site that holds a kind of its own is separated
 * the same way (ADR-0213 decision 6): its record in its whole is no kind and
 * stays, with the relation and the point of its list line. Its only kind may
 * leave, since the part is a place by its site's list: it is then a part like
 * any other, shown through its whole, named and placed for its line again
 * (`followTheirPoints`). The Archaeology side of a component of Ephesus, say,
 * if its item named another ruin: the site keeps its component. Refused where
 * the kind and the line stand at one point, which a merge folded them into: a
 * copy of it would put the new place where the list places the part, and the
 * undo of that merge gives each its own point back.
 *
 * What keeps the two apart is the curator's word in the identifier registry
 * (ADR-0144 decision 4): where the original still claims the identifier the
 * membership carried — a World Heritage site's item, a point's item — the
 * separation writes a `refers` verdict on it, so the value identifies the new
 * place alone and the resolver and the join follow it there.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { logCurationActs } from '../../db/curationLogWriter.js';
import {
  insertSeparatedExperience, lockExperience, lockPartsAndRegionKeys, returnSeparatedUnescoText, type LockedExperience,
} from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS, kindRecordSql, partRecordSql } from '../../db/membership.js';
import { shownPointSql } from '../../db/readerPredicates.js';
import { followTheirPoints } from '../../db/partFieldsWriter.js';
import { moveChangesOfPlace } from '../../services/sync/changeRecorder.js';
import { copyPointsFor, movePoints } from './experienceLocationWriter.js';
import { moveHeldDecisions } from './heldDecisions.js';
import { moveMemberships, moveSiteLineRecord } from './membershipWriter.js';
import { takeBackIdentifierVerdict, writeIdentifierVerdict } from './placeIdentifierVerdictWriter.js';
import { mergePlaces } from './placeMerge.js';
import { placeAfterRelease } from './publishContents.js';
import { copyLinksFor, moveLinks } from './workWriter.js';

interface Refusal {
  status: number;
  error: string;
}

/** What a separation moved and copied, its record (`experience_separations.moved`). */
export interface SeparationRecord {
  membership: number;
  points: number[];
  copiedPoints: Array<{ from: number; to: number }>;
  links: number[];
  copiedLinks: Array<{ from: number; to: number }>;
  changes: number[];
  heldDecisions: number[];
  visitQuestions: number;
}

/** The identifier a membership carries, in the registry's terms: a Wikidata source's item, or the World Heritage source's reference. */
interface Identifier {
  scheme: 'wikidata' | 'whc';
  value: string;
}

interface Separable {
  experience_id: number;
  merged_into_id: number | null;
  source_id: number;
  external_id: string;
  kind_id: number;
  kind_name: string;
  memberships: number;
  /** A component of a serial site: a place by its site's list, whatever kinds it holds. */
  is_part: boolean;
}

/** The points or links of a place that the membership places, split by whether another membership places them too. */
async function placedBy(
  client: PoolClient, sql: string, placeId: number, membershipId: number,
): Promise<{ alone: number[]; shared: number[] }> {
  const rows = (await client.query<{ id: number; alone: boolean }>(sql, [placeId, membershipId])).rows;
  return { alone: rows.filter(row => row.alone).map(row => row.id), shared: rows.filter(row => !row.alone).map(row => row.id) };
}

const POINTS_PLACED = `
  SELECT p.location_id AS id, bool_and(p.membership_id = $2) AS alone
    FROM experience_location_placements p
    JOIN experience_locations l ON l.id = p.location_id
   WHERE l.experience_id = $1 AND l.merged_into_id IS NULL
   GROUP BY p.location_id
  HAVING bool_or(p.membership_id = $2)`;

const LINKS_PLACED = `
  SELECT p.link_id AS id, bool_and(p.membership_id = $2) AS alone
    FROM experience_treasure_placements p
    JOIN experience_treasures t ON t.id = p.link_id
   WHERE t.experience_id = $1
   GROUP BY p.link_id
  HAVING bool_or(p.membership_id = $2)`;

/** The World Heritage source, whose membership ids are the sites' references (the registry's `whc` scheme). */
const WORLD_HERITAGE_SOURCE_ID = 1;

/** The identifier the membership carries, or null where its id is one the registry does not hold (a curator's own place, a museum's catalogue id). */
function identifierOf(found: Separable): Identifier | null {
  if (/^Q\d+$/.test(found.external_id)) return { scheme: 'wikidata', value: found.external_id };
  if (found.source_id === WORLD_HERITAGE_SOURCE_ID) return { scheme: 'whc', value: found.external_id };
  return null;
}

/** Everything the membership takes along, in the order `db/locks.ts` asks: the objects are locked; their contents follow. */
async function moveWhatIsItsOwn(
  client: PoolClient, from: LockedExperience, to: LockedExperience, membershipId: number, sourceId: number,
): Promise<Omit<SeparationRecord, 'membership' | 'visitQuestions'>> {
  const points = await placedBy(client, POINTS_PLACED, from.id, membershipId);
  const copiedPoints = await copyPointsFor(client, from, to, membershipId, points.shared);
  const moved = await movePoints(client, from, to, points.alone);
  const links = await placedBy(client, LINKS_PLACED, from.id, membershipId);
  const copiedLinks = await copyLinksFor(client, from, to, membershipId, links.shared);
  const movedLinks = await moveLinks(client, from, to, links.alone);
  await moveMemberships(client, from, to, [membershipId]);
  if (sourceId === WORLD_HERITAGE_SOURCE_ID) await moveSiteLineRecord(client, from, to);
  const changeIds = (await client.query<{ id: string }>(
    `SELECT c.id FROM experience_sync_changes c JOIN experience_sync_logs run ON run.id = c.sync_log_id
      WHERE c.experience_id = $1 AND run.source_id = $2`,
    [from.id, sourceId],
  )).rows.map(row => Number(row.id));
  const changes = await moveChangesOfPlace(client, from, to, changeIds);
  const heldIds = (await client.query<{ id: string }>(
    'SELECT id FROM experience_held_decisions WHERE experience_id = $1 AND source_id = $2',
    [from.id, sourceId],
  )).rows.map(row => Number(row.id));
  const heldDecisions = await moveHeldDecisions(client, from, to, heldIds);
  return { points: moved, copiedPoints, links: movedLinks, copiedLinks, changes, heldDecisions };
}

/**
 * Whether the original still claims the identifier once the membership has
 * left it: a World Heritage site's item, or a standing point's item, say. Read
 * from the registry, which the move refreshed by trigger.
 */
async function stillClaimedBy(client: PoolClient, placeId: number, identifier: Identifier): Promise<boolean> {
  const row = (await client.query<{ claims_identity: boolean }>(
    'SELECT claims_identity FROM place_identifiers WHERE experience_id = $1 AND scheme = $2 AND value = $3',
    [placeId, identifier.scheme, identifier.value],
  )).rows[0];
  return row?.claims_identity === true;
}

/**
 * Whether the membership places a point that is the part's list line too
 * (`is_part_line_point`): the one point a merge folded the kind's and the
 * line's into, which the line's own point stays folded under.
 */
async function standsAtItsLine(client: PoolClient, partId: number, membershipId: number): Promise<boolean> {
  const shared = await client.query(
    `SELECT 1 FROM experience_location_placements p
       JOIN experience_locations l ON l.id = p.location_id
       JOIN ${MEMBERSHIPS} rec ON rec.experience_id = l.experience_id AND ${partRecordSql('rec')}
      WHERE l.experience_id = $1 AND l.merged_into_id IS NULL AND p.membership_id = $2
        AND is_part_line_point(l.id, rec.whole_id)
      LIMIT 1`,
    [partId, membershipId],
  );
  return shared.rows.length > 0;
}

/**
 * Why the membership cannot leave its place, or null where it can: a place's
 * only kind, unless its site's list makes it a place; on a part, a kind at
 * the point of the part's line. For a part it also takes the keys its row is
 * written under once the points have moved (`leaveThePartStanding`): before
 * the first point write, as a merge takes them (`db/locks.ts`).
 */
async function claimOriginal(
  client: PoolClient, original: LockedExperience, found: Separable, membershipId: number,
): Promise<Refusal | null> {
  if (!found.is_part) {
    return found.memberships < 2
      ? { status: 409, error: 'This is the place\'s only kind: there is nothing to separate it from' }
      : null;
  }
  if (await standsAtItsLine(client, original.id, membershipId)) {
    return {
      status: 409,
      error: 'This kind and the part\'s line on its site\'s list share one point here. '
        + 'If a merge joined them, undo that merge in the history below.',
    };
  }
  await lockPartsAndRegionKeys(client, [original]);
  return null;
}

/**
 * The part once a kind has left it: refused where it holds no point any more,
 * since it stood at the kind's point alone and a reader would lose it from
 * its site. With no kind of its own left it is named and placed for its line
 * again (`followTheirPoints`, which leaves a part that still holds one alone).
 */
async function leaveThePartStanding(client: PoolClient, part: LockedExperience): Promise<Refusal | null> {
  const point = await client.query(
    // A point a reader is shown, as `partOfferedSql` asks it: a lost, missing or unread point keeps no part on the map.
    `SELECT 1 FROM experience_locations el
      WHERE el.experience_id = $1 AND ${shownPointSql('el')} LIMIT 1`, [part.id],
  );
  if (point.rows.length === 0) {
    return {
      status: 409,
      error: 'This kind places the only point of this part, so separating it would take the part off its site\'s map',
    };
  }
  await followTheirPoints(client, part, null);
  return null;
}

/**
 * Separate the membership `membershipId` of place `placeId` into a place of its
 * own, as the curator `separatedBy`. Refuses what is no separation, saying why,
 * and changes nothing then: the place's only membership (that is the place
 * itself), unless the place is a component part, which its site's list makes
 * a place; a place merged into another; and, on a part, a kind that stands at
 * the point of the part's list line or that places the only point the part
 * stands at.
 */
export async function separateMembership(
  { placeId, membershipId, separatedBy, regionId = null }: {
    placeId: number; membershipId: number; separatedBy: number; regionId?: number | null;
  },
): Promise<{ result?: { separationId: number; originalId: number; separatedId: number }; refusal?: Refusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  let separationId: number;
  let separatedId: number;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: Refusal): Promise<{ refusal: Refusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };
    const locked = await lockExperience<{ id: number; merged_into_id: number | null }>(client, placeId, 'id, merged_into_id');
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    if (locked.row.merged_into_id !== null) {
      return await refuse({ status: 409, error: 'This place has been merged into another; separate it there' });
    }
    const found = (await client.query<Separable>(
      `SELECT m.experience_id, e.merged_into_id, m.source_id, m.external_id, m.kind_id, k.name AS kind_name,
              -- Its kinds: a record in a whole, the site's record of its own
              -- list line among them (ADR-0200), is no kind to separate from.
              (SELECT count(*)::int FROM ${MEMBERSHIPS} other
                WHERE other.experience_id = e.id AND ${kindRecordSql('other')}) AS memberships,
              EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.part_id = e.id AND prt.reason = 'component') AS is_part
         FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id JOIN ${KINDS} k ON k.id = m.kind_id
        WHERE m.id = $1`,
      [membershipId],
    )).rows[0];
    if (!found || found.experience_id !== placeId) return await refuse({ status: 404, error: 'Membership not found on this place' });
    const original = locked.lock;
    const unfit = await claimOriginal(client, original, found, membershipId);
    if (unfit) return await refuse(unfit);
    const identifier = identifierOf(found);
    // The value's keys, as every writer of an identifier takes them after the
    // place's row (ADR-0143 decision 3): a run about to create a place for it
    // waits, then finds the new place.
    if (identifier) await client.query('SELECT lock_place_identifiers($1, ARRAY[$2::text])', [identifier.scheme, identifier.value]);

    // The original keeps the pair it was first brought under, whichever
    // membership leaves (ADR-0143 decision 6: nothing reads it as a key, and
    // the pair's check reads a pair a live membership carries anywhere as in
    // order); the new place takes the membership's, or a name of its own.
    const separated = await insertSeparatedExperience(client, original, membershipId);
    // A place stands at a point. Where neither the kind's source nor the
    // original gives one (a dispersed whole that shows no place yet), the new
    // place would have none.
    if (!separated) {
      return await refuse({
        status: 409,
        error: 'Neither this kind\'s source nor the place gives a point to stand at, so it cannot be a place of its own',
      });
    }
    separatedId = separated.id;
    const moved = await moveWhatIsItsOwn(client, original, separated, membershipId, found.source_id);
    const lost = found.is_part ? await leaveThePartStanding(client, original) : null;
    if (lost) return await refuse(lost);
    // The curator's word that keeps the two apart (ADR-0144 decision 4): the
    // identifier is the new place's, and only refers to the original.
    const verdictWritten = identifier !== null && await stillClaimedBy(client, original.id, identifier);
    if (identifier && verdictWritten) {
      await writeIdentifierVerdict(client, {
        experienceId: original.id, scheme: identifier.scheme, value: identifier.value, verdict: 'refers', userId: separatedBy,
        note: `Separated into a place of its own (#${separatedId})`,
      });
    }
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO experience_separations (original_id, separated_id, membership_id, scheme, value, verdict_written, separated_by, moved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb) RETURNING id`,
      [original.id, separated.id, membershipId, identifier?.scheme ?? null, identifier?.value ?? null, verdictWritten, separatedBy],
    );
    separationId = inserted.rows[0].id;
    const asked = await client.query(
      `INSERT INTO separated_visit_questions (separation_id, visit_id, user_id)
       SELECT $1, v.id, v.user_id FROM user_visited_experiences v WHERE v.experience_id = $2`,
      [separationId, original.id],
    );
    const record: SeparationRecord = { membership: membershipId, ...moved, visitQuestions: asked.rowCount ?? 0 };
    await client.query('UPDATE experience_separations SET moved = $2 WHERE id = $1', [separationId, JSON.stringify(record)]);
    const names = (await client.query<{ id: number; name: string }>(
      'SELECT id, name FROM experiences WHERE id = ANY($1::int[])', [[original.id, separatedId]],
    )).rows;
    const nameOf = (id: number) => names.find(row => row.id === id)?.name ?? null;
    const details = {
      separationId, originalId: original.id, originalName: nameOf(original.id), separatedId,
      separatedName: nameOf(separatedId), kind: found.kind_name,
      identifier: identifier ? `${identifier.scheme}:${identifier.value}` : null, verdictWritten,
    };
    const membership = { id: membershipId, kindId: found.kind_id };
    await logCurationActs(client, [original.id, separatedId].map(place => ({
      experienceId: place, curatorId: separatedBy, action: 'separated' as const, regionId, membership, details,
    })));
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  // Both places' points may have changed: each is placed in the regions they lie in.
  await placeAfterRelease(placeId, 'Separating a membership moved points off experience %d');
  await placeAfterRelease(separatedId, 'Separating a membership placed points on experience %d');
  return { result: { separationId, originalId: placeId, separatedId } };
}

/**
 * Undo a separation (ADR-0144 decision 5): the place it made is merged back
 * into the original, by the merge every other pair of places goes through
 * (ADR-0086), so the undo of that merge separates them again. The word the
 * separation wrote on the original is taken back, and the travellers'
 * questions it raised and nobody answered are withdrawn.
 */
export async function undoSeparation(
  separationId: number,
  userId: number,
  regionId: number | null = null,
): Promise<{ result?: { separationId: number; mergeId: number; originalId: number; separatedId: number }; refusal?: Refusal }> {
  const found = (await pool.query<{
    original_id: number; separated_id: number; undone_at: Date | null; scheme: string | null; value: string | null; verdict_written: boolean;
  }>(
    'SELECT original_id, separated_id, undone_at, scheme, value, verdict_written FROM experience_separations WHERE id = $1', [separationId],
  )).rows[0];
  if (!found) return { refusal: { status: 404, error: 'Separation not found' } };
  if (found.undone_at !== null) return { refusal: { status: 409, error: 'Already answered: this separation was undone' } };
  // The bookkeeping rides in the merge's own transaction, under both places'
  // locks: a merge committed without it would leave a separation nobody can
  // finish undoing, since a second attempt finds the new place folded.
  const merged = await mergePlaces({
    survivorId: found.original_id, foldedId: found.separated_id, mergedBy: userId, reason: 'curator', regionId,
    detail: { separationId },
    within: async (client, mergeId, locks) => {
      await returnSeparatedUnescoText(client, locks.survivor, locks.folded, separationId);
      if (found.verdict_written && found.scheme && found.value) {
        await client.query('SELECT lock_place_identifiers($1, ARRAY[$2::text])', [found.scheme, found.value]);
        await takeBackIdentifierVerdict(client, { experienceId: found.original_id, scheme: found.scheme, value: found.value });
      }
      await client.query(
        'UPDATE experience_separations SET undone_at = NOW(), undone_by = $2, merge_id = $3 WHERE id = $1 AND undone_at IS NULL',
        [separationId, userId, mergeId],
      );
      await client.query('DELETE FROM separated_visit_questions WHERE separation_id = $1 AND answer IS NULL', [separationId]);
    },
  });
  if (merged.refusal) return { refusal: merged.refusal };
  return { result: { separationId, mergeId: merged.result!.mergeId, originalId: found.original_id, separatedId: found.separated_id } };
}
