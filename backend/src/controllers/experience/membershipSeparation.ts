/**
 * A curator separates one kind's membership of a place into a place of its own
 * (ADR-0142, #1885): the way back from an equal-item merge, and from a run
 * joining a place on arrival (#1801), when the item turns out to name another
 * thing — the Places of worship membership of the Ajanta Caves, say, if its
 * item named another cave temple.
 *
 * Keyed on the membership, since a join leaves no merge record to read: what
 * the membership alone places goes with it, and what other memberships of the
 * place place too is copied, each place keeping what its own memberships place.
 *
 * - the membership itself;
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
 * The separation is recorded with the item the two places were set apart on,
 * and the equal-item pass leaves them apart (`equalItemMerges.ts`).
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { insertSeparatedExperience, lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { moveChangesOfPlace } from '../../services/sync/changeRecorder.js';
import { membershipItemSql } from './equalItemMerges.js';
import { copyPointsFor, movePoints } from './experienceLocationWriter.js';
import { moveHeldDecisions } from './heldDecisions.js';
import { moveMemberships } from './membershipWriter.js';
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

interface Separable {
  experience_id: number;
  own_kind: boolean;
  merged_into_id: number | null;
  source_id: number;
  kind_name: string;
  memberships: number;
  is_part: boolean;
  item: string | null;
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
 * Separate the membership `membershipId` of place `placeId` into a place of its
 * own, as the curator `separatedBy`. Refuses what is no separation, saying why,
 * and changes nothing then: the place's only membership (that is the place
 * itself), the kind that brought the place, which every reader names it by, a
 * place merged into another, and a component part, whose point is its site's.
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
      `SELECT m.experience_id, e.merged_into_id, m.source_id, k.name AS kind_name,
              (e.source_id = m.source_id AND e.external_id = m.external_id) AS own_kind,
              (SELECT count(*)::int FROM ${MEMBERSHIPS} other WHERE other.experience_id = e.id) AS memberships,
              EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.part_id = e.id AND prt.reason = 'component') AS is_part,
              ${membershipItemSql('m', 'e')} AS item
         FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id JOIN ${KINDS} k ON k.id = m.kind_id
        WHERE m.id = $1`,
      [membershipId],
    )).rows[0];
    if (!found || found.experience_id !== placeId) return await refuse({ status: 404, error: 'Membership not found on this place' });
    if (found.memberships < 2) {
      return await refuse({ status: 409, error: 'This is the place\'s only kind: there is nothing to separate it from' });
    }
    if (found.own_kind) {
      // Every reader names a place's kind by the source that brought it
      // (`rowKindJoinSql`): with that kind gone the original would show none.
      // What a misleading item brought is the other kind, and that is the one
      // separated.
      return await refuse({
        status: 409, error: 'This is the kind that brought the place: separate the other kind into a place of its own',
      });
    }
    if (found.is_part) {
      return await refuse({ status: 409, error: 'A component part of a serial site follows its point, and is not separated' });
    }

    const original = locked.lock;
    const separated = await insertSeparatedExperience(client, original, membershipId);
    separatedId = separated.id;
    const moved = await moveWhatIsItsOwn(client, original, separated, membershipId, found.source_id);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO experience_separations (original_id, separated_id, membership_id, wikidata_item, separated_by, moved)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb) RETURNING id`,
      [original.id, separated.id, membershipId, found.item, separatedBy],
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
      separatedName: nameOf(separatedId), kind: found.kind_name, membershipId, item: found.item,
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
