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
 *   registry holds the new place claiming it;
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
 * What keeps the two apart is the curator's word in the identifier registry
 * (ADR-0144 decision 4): where the original still claims the identifier the
 * membership carried — a World Heritage site's item, a point's item — the
 * separation writes a `refers` verdict on it, so the value identifies the new
 * place alone and the resolver and the join follow it there.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { insertSeparatedExperience, lockExperience, returnSeparatedUnescoText, type LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { moveChangesOfPlace } from '../../services/sync/changeRecorder.js';
import { copyPointsFor, movePoints } from './experienceLocationWriter.js';
import { moveHeldDecisions } from './heldDecisions.js';
import { moveMemberships } from './membershipWriter.js';
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
  kind_name: string;
  memberships: number;
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
 * Separate the membership `membershipId` of place `placeId` into a place of its
 * own, as the curator `separatedBy`. Refuses what is no separation, saying why,
 * and changes nothing then: the place's only membership (that is the place
 * itself), a place merged into another, and a component part, whose point is
 * its site's.
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
      `SELECT m.experience_id, e.merged_into_id, m.source_id, m.external_id, k.name AS kind_name,
              (SELECT count(*)::int FROM ${MEMBERSHIPS} other WHERE other.experience_id = e.id) AS memberships,
              EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.part_id = e.id AND prt.reason = 'component') AS is_part
         FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id JOIN ${KINDS} k ON k.id = m.kind_id
        WHERE m.id = $1`,
      [membershipId],
    )).rows[0];
    if (!found || found.experience_id !== placeId) return await refuse({ status: 404, error: 'Membership not found on this place' });
    if (found.memberships < 2) {
      return await refuse({ status: 409, error: 'This is the place\'s only kind: there is nothing to separate it from' });
    }
    if (found.is_part) {
      return await refuse({ status: 409, error: 'A component part of a serial site follows its point, and is not separated' });
    }
    const identifier = identifierOf(found);
    // The value's keys, as every writer of an identifier takes them after the
    // place's row (ADR-0143 decision 3): a run about to create a place for it
    // waits, then finds the new place.
    if (identifier) await client.query('SELECT lock_place_identifiers($1, ARRAY[$2::text])', [identifier.scheme, identifier.value]);

    const original = locked.lock;
    // The original keeps the pair it was first brought under, whichever
    // membership leaves (ADR-0143 decision 6: nothing reads it as a key, and
    // the pair's check reads a pair a live membership carries anywhere as in
    // order); the new place takes the membership's, or a name of its own.
    const separated = await insertSeparatedExperience(client, original, membershipId);
    separatedId = separated.id;
    const moved = await moveWhatIsItsOwn(client, original, separated, membershipId, found.source_id);
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
      separatedName: nameOf(separatedId), kind: found.kind_name, membershipId,
      identifier: identifier ? `${identifier.scheme}:${identifier.value}` : null, verdictWritten,
    };
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $3, 'separated', $5, $4), ($2, $3, 'separated', $5, $4)`,
      [original.id, separatedId, separatedBy, JSON.stringify(details), regionId],
    );
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
