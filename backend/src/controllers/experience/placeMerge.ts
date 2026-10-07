/**
 * Two rows that are one place become one place, and can become two again
 * (#1247, ADR-0046, ADR-0086).
 *
 * A merge folds one place into another in one transaction, under both places'
 * locks taken in id order: the folded place's memberships, points, work links,
 * changeset rows and answers move to the survivor, a point or a link both hold
 * is folded into the survivor's, and every traveller's visit is reconciled as
 * ADR-0046 decision 5 says — the earlier date, both notes, the later visit's
 * rating. The folded place is kept, marked `merged_into_id`; it keeps no
 * membership, so no reader offers it. What moved is the merge's record
 * (`experience_merges.moved`), and the undo moves exactly that back: anything
 * written to the survivor after the merge stays with it.
 *
 * Every write to a catalogue table goes through that table's writer module;
 * this module orders them and writes the merge's own record, the visits and the
 * log.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockTwoExperiences, markFolded, type LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { moveChangesOfPlace } from '../../services/sync/changeRecorder.js';
import { moveConflictDecisions } from './conflictDecisions.js';
import { foldPoints, movePoints, unfoldPoints, type FoldedPoints } from './experienceLocationWriter.js';
import { moveHeldDecisions } from './heldDecisions.js';
import { moveMemberships } from './membershipWriter.js';
import { placeAfterRelease } from './publishContents.js';
import { foldLinks, moveLinks, unfoldLinks, type FoldedLinks } from './workWriter.js';

export type MergeReason = 'equal_wikidata_item' | 'curator';

/** A traveller's visit to the survivor as it stood before the merge reconciled it. */
interface VisitSnapshot {
  id: number;
  /** As text, to the microsecond the column holds, so the undo can tell an untouched visit. */
  visited_at: string | null;
  notes: string | null;
  rating?: number | null;
}

/** Visits a merge wrote: the copies, and the reconciled visits as they were and as the merge left them. */
interface ReconciledVisits {
  inserted: VisitSnapshot[];
  updated: { before: VisitSnapshot; after: VisitSnapshot }[];
}

/** What a merge moved, which its undo moves back (ADR-0086 decision 1). */
export interface MergeRecord {
  memberships: number[];
  points: number[];
  foldedPoints: FoldedPoints;
  links: number[];
  foldedLinks: FoldedLinks;
  changes: number[];
  heldDecisions: number[];
  conflictDecisions: number[];
  rejections: number[];
  /**
   * The visits a folded visit was copied in as, and the survivor's visits it
   * reconciled, before and after: the undo takes back only what nobody has
   * written to since.
   */
  visits: ReconciledVisits;
  pointVisits: ReconciledVisits;
}

interface Refusal {
  status: number;
  error: string;
}

/**
 * Fold `foldedId` into `survivorId`. `mergedBy` is the curator, or null for the
 * catalogue's own merge (ADR-0086 decision 5). Refuses a pair it cannot make
 * one place of, saying why, and changes nothing then.
 */
export async function mergePlaces(
  { survivorId, foldedId, mergedBy, reason, detail }: {
    survivorId: number; foldedId: number; mergedBy: number | null; reason: MergeReason; detail?: Record<string, unknown>;
  },
): Promise<{ result?: { mergeId: number }; refusal?: Refusal }> {
  if (survivorId === foldedId) return { refusal: { status: 400, error: 'A place cannot be merged into itself' } };
  const client = await pool.connect();
  let unusable: Error | undefined;
  let mergeId: number;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: Refusal): Promise<{ refusal: Refusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockTwoExperiences(client, survivorId, foldedId);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const survivor = locked.get(survivorId)!;
    const folded = locked.get(foldedId)!;
    if (survivor.mergedInto !== null || folded.mergedInto !== null) {
      return await refuse({ status: 409, error: 'One of the two places has already been merged into another' });
    }
    const shared = await client.query<{ kind_id: number }>(
      `SELECT f.kind_id FROM ${MEMBERSHIPS} f JOIN ${MEMBERSHIPS} s ON s.kind_id = f.kind_id
        WHERE f.experience_id = $1 AND s.experience_id = $2`,
      [foldedId, survivorId],
    );
    if (shared.rows.length > 0) {
      // ADR-0086 decision 4: one place holds one membership per kind.
      return await refuse({ status: 409, error: 'Both places belong to the same kind, which one place cannot hold twice' });
    }

    const record = await moveEverything(client, folded.lock, survivor.lock);
    await markFolded(client, folded.lock, survivorId);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO experience_merges (survivor_id, folded_id, merged_by, reason, moved)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [survivorId, foldedId, mergedBy, reason, JSON.stringify(record)],
    );
    mergeId = inserted.rows[0].id;
    await logOnBoth(client, 'merged', {
      survivorId, foldedId, mergeId, userId: mergedBy, reason, detail, memberships: record.memberships,
    });
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  // The survivor holds the folded place's points now, and the regions they lie in.
  await placeAfterRelease(survivorId, 'Merging into experience %d moved its points');
  return { result: { mergeId } };
}

/** The moves, in the order `db/locks.ts` asks: the objects are locked; their contents follow. */
async function moveEverything(client: PoolClient, folded: LockedExperience, survivor: LockedExperience): Promise<MergeRecord> {
  const foldedPoints = await foldPoints(client, folded, survivor);
  const points = await movePoints(client, folded, survivor);
  const foldedLinks = await foldLinks(client, folded, survivor);
  const links = await moveLinks(client, folded, survivor);
  const memberships = await moveMemberships(client, folded, survivor);
  const changes = await moveChangesOfPlace(client, folded, survivor);
  const heldDecisions = await moveHeldDecisions(client, folded, survivor);
  const conflictDecisions = await moveConflictDecisions(client, folded, survivor);
  const rejections = await moveRejections(client, folded.id, survivor.id);
  const visits = await reconcileVisits(client, folded.id, survivor.id);
  const pointVisits = await reconcilePointVisits(client, foldedPoints);
  return {
    memberships, points, foldedPoints, links, foldedLinks, changes, heldDecisions, conflictDecisions, rejections,
    visits, pointVisits,
  };
}

/** A region's refusal of the folded place, where the survivor has none in that region. */
async function moveRejections(client: PoolClient, from: number, to: number, only?: number[]): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE experience_rejections f SET experience_id = $2
      WHERE f.experience_id = $1 AND ($3::int[] IS NULL OR f.id = ANY($3::int[]))
        AND NOT EXISTS (SELECT 1 FROM experience_rejections s WHERE s.experience_id = $2 AND s.region_id = f.region_id)
      RETURNING f.id`,
    [from, to, only ?? null],
  );
  return result.rows.map(row => row.id);
}

/**
 * A traveller who marked both places ends with one visit (ADR-0046 decision 5):
 * the earlier date, both notes, and where both carry a rating and they differ,
 * the one recorded with the later visit date. One who marked only the folded
 * place gets that visit on the survivor. The folded visits stay on the folded
 * place for the undo.
 */
async function reconcileVisits(client: PoolClient, folded: number, survivor: number): Promise<ReconciledVisits> {
  const before = await client.query<VisitSnapshot>(
    `SELECT s.id, s.visited_at::text AS visited_at, s.notes, s.rating
       FROM user_visited_experiences s
       JOIN user_visited_experiences f ON f.user_id = s.user_id AND f.experience_id = $1
      WHERE s.experience_id = $2`,
    [folded, survivor],
  );
  const after = await client.query<VisitSnapshot>(
    `UPDATE user_visited_experiences s
        SET visited_at = LEAST(s.visited_at, f.visited_at),
            notes = ${joinedNotesSql('s', 'f')},
            rating = CASE WHEN s.rating IS NULL THEN f.rating
                          WHEN f.rating IS NULL OR f.rating = s.rating THEN s.rating
                          WHEN f.visited_at > s.visited_at THEN f.rating
                          ELSE s.rating END
       FROM user_visited_experiences f
      WHERE f.user_id = s.user_id AND f.experience_id = $1 AND s.experience_id = $2
      RETURNING s.id, s.visited_at::text AS visited_at, s.notes, s.rating`,
    [folded, survivor],
  );
  const inserted = await client.query<VisitSnapshot>(
    `INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes, rating)
     SELECT f.user_id, $2, f.visited_at, f.notes, f.rating
       FROM user_visited_experiences f
      WHERE f.experience_id = $1
        AND NOT EXISTS (SELECT 1 FROM user_visited_experiences s WHERE s.experience_id = $2 AND s.user_id = f.user_id)
     RETURNING id, visited_at::text AS visited_at, notes, rating`,
    [folded, survivor],
  );
  return { inserted: inserted.rows, updated: pairUp(before.rows, after.rows) };
}

/** The same for a folded point's visits, onto the survivor's point it was folded into. A point visit has no rating. */
async function reconcilePointVisits(client: PoolClient, folded: FoldedPoints): Promise<ReconciledVisits> {
  if (folded.points.length === 0) return { inserted: [], updated: [] };
  const from = folded.points.map(pair => pair.point);
  const into = folded.points.map(pair => pair.target);
  const before = await client.query<VisitSnapshot>(
    `SELECT s.id, s.visited_at::text AS visited_at, s.notes
       FROM unnest($1::int[], $2::int[]) AS pair(point, target)
       JOIN user_visited_locations f ON f.location_id = pair.point
       JOIN user_visited_locations s ON s.location_id = pair.target AND s.user_id = f.user_id`,
    [from, into],
  );
  const after = await client.query<VisitSnapshot>(
    `UPDATE user_visited_locations s
        SET visited_at = LEAST(s.visited_at, f.visited_at), notes = ${joinedNotesSql('s', 'f')}
       FROM unnest($1::int[], $2::int[]) AS pair(point, target)
       JOIN user_visited_locations f ON f.location_id = pair.point
      WHERE s.location_id = pair.target AND s.user_id = f.user_id
      RETURNING s.id, s.visited_at::text AS visited_at, s.notes`,
    [from, into],
  );
  const inserted = await client.query<VisitSnapshot>(
    `INSERT INTO user_visited_locations (user_id, location_id, visited_at, notes)
     SELECT f.user_id, pair.target, f.visited_at, f.notes
       FROM unnest($1::int[], $2::int[]) AS pair(point, target)
       JOIN user_visited_locations f ON f.location_id = pair.point
      WHERE NOT EXISTS (SELECT 1 FROM user_visited_locations s WHERE s.location_id = pair.target AND s.user_id = f.user_id)
     RETURNING id, visited_at::text AS visited_at, notes`,
    [from, into],
  );
  return { inserted: inserted.rows, updated: pairUp(before.rows, after.rows) };
}

function pairUp(before: VisitSnapshot[], after: VisitSnapshot[]): ReconciledVisits['updated'] {
  const left = new Map(before.map(visit => [visit.id, visit]));
  return after.map(visit => ({ before: left.get(visit.id)!, after: visit }));
}

/** Both notes, the survivor's first, each once. */
function joinedNotesSql(survivor: string, folded: string): string {
  return `CASE WHEN COALESCE(${folded}.notes, '') = '' OR ${folded}.notes = ${survivor}.notes THEN ${survivor}.notes
               WHEN COALESCE(${survivor}.notes, '') = '' THEN ${folded}.notes
               ELSE ${survivor}.notes || E'\\n\\n' || ${folded}.notes END`;
}

/** The merge, or its undo, in each place's history. */
async function logOnBoth(
  client: PoolClient,
  action: 'merged' | 'merge_undone',
  { survivorId, foldedId, mergeId, userId, regionId = null, reason, detail, memberships }: {
    survivorId: number; foldedId: number; mergeId: number; userId: number | null; regionId?: number | null;
    reason?: MergeReason; detail?: Record<string, unknown>; memberships: number[];
  },
): Promise<void> {
  // The two places by name and the kinds that moved, as they stood at the act:
  // what a curator reads in the history is the place, not its id.
  const named = await client.query<{ survivor_name: string; folded_name: string; kinds: string[] }>(
    `SELECT (SELECT name FROM experiences WHERE id = $1) AS survivor_name,
            (SELECT name FROM experiences WHERE id = $2) AS folded_name,
            array(SELECT k.name FROM ${MEMBERSHIPS} m JOIN ${KINDS} k ON k.id = m.kind_id
                   WHERE m.id = ANY($3::int[]) ORDER BY k.display_priority, k.id) AS kinds`,
    [survivorId, foldedId, memberships],
  );
  const { survivor_name: survivorName, folded_name: foldedName, kinds } = named.rows[0];
  const details = {
    mergeId, survivorId, foldedId, survivorName, foldedName, kinds, ...(reason ? { reason } : {}), ...(detail ?? {}),
  };
  await client.query(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
     VALUES ($1, $3, $4, $6, $5), ($2, $3, $4, $6, $5)`,
    [survivorId, foldedId, userId, action, JSON.stringify(details), regionId],
  );
}

/**
 * Undo a merge (ADR-0046 decision 5): what the record says moved goes back, the
 * survivor's visits are as they were, and the folded place is a place again.
 * Anything written to the survivor since stays with it.
 */
export async function undoMerge(
  mergeId: number,
  userId: number,
  logRegionId: number | null = null,
): Promise<{ result?: { survivorId: number; foldedId: number }; refusal?: Refusal }> {
  const found = await pool.query<{ survivor_id: number; folded_id: number; moved: MergeRecord; undone_at: Date | null }>(
    'SELECT survivor_id, folded_id, moved, undone_at FROM experience_merges WHERE id = $1',
    [mergeId],
  );
  const merge = found.rows[0];
  if (!merge) return { refusal: { status: 404, error: 'Merge not found' } };
  if (merge.undone_at !== null) return { refusal: { status: 409, error: 'Already answered: this merge was undone' } };
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: Refusal): Promise<{ refusal: Refusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };
    const locked = await lockTwoExperiences(client, merge.survivor_id, merge.folded_id);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const survivor = locked.get(merge.survivor_id)!;
    const folded = locked.get(merge.folded_id)!;
    const again = await client.query<{ undone_at: Date | null }>(
      'SELECT undone_at FROM experience_merges WHERE id = $1 FOR UPDATE', [mergeId],
    );
    if (again.rows[0].undone_at !== null || folded.mergedInto !== merge.survivor_id) {
      return await refuse({ status: 409, error: 'Already answered: this merge was undone' });
    }
    // A later merge folded the survivor into a third place, which holds what
    // this one moved now: undoing this first would move nothing and strand the
    // folded place with no membership.
    if (survivor.mergedInto !== null) {
      return await refuse({
        status: 409, error: 'The place this was merged into has since been merged into another — undo that merge first',
      });
    }
    // A later merge into the same place may have folded a point or a link into
    // one this merge moved, so undoing this first would carry that merge's
    // placements away with it: merges into one place are undone last first.
    const later = await client.query(
      'SELECT 1 FROM experience_merges WHERE survivor_id = $1 AND id > $2 AND undone_at IS NULL LIMIT 1',
      [merge.survivor_id, mergeId],
    );
    if ((later.rowCount ?? 0) > 0) {
      return await refuse({
        status: 409, error: 'A later merge into the same place is still in effect — undo that merge first',
      });
    }
    await moveEverythingBack(client, merge.moved, folded.lock, survivor.lock);
    await markFolded(client, folded.lock, null);
    await client.query(
      'UPDATE experience_merges SET undone_at = NOW(), undone_by = $2 WHERE id = $1', [mergeId, userId],
    );
    await logOnBoth(client, 'merge_undone', {
      survivorId: merge.survivor_id, foldedId: merge.folded_id, mergeId, userId, regionId: logRegionId,
      memberships: merge.moved.memberships,
    });
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  await placeAfterRelease(merge.survivor_id, 'Undoing a merge moved points off experience %d');
  await placeAfterRelease(merge.folded_id, 'Undoing a merge moved points back to experience %d');
  return { result: { survivorId: merge.survivor_id, foldedId: merge.folded_id } };
}

async function moveEverythingBack(
  client: PoolClient, record: MergeRecord, folded: LockedExperience, survivor: LockedExperience,
): Promise<void> {
  await restoreVisits(client, record);
  await unfoldLinks(client, record.foldedLinks);
  await moveLinks(client, survivor, folded, record.links);
  await unfoldPoints(client, folded, record.foldedPoints);
  await movePoints(client, survivor, folded, record.points);
  await moveMemberships(client, survivor, folded, record.memberships);
  await moveChangesOfPlace(client, survivor, folded, record.changes);
  await moveHeldDecisions(client, survivor, folded, record.heldDecisions);
  await moveConflictDecisions(client, survivor, folded, record.conflictDecisions);
  await moveRejections(client, survivor.id, folded.id, record.rejections);
}

/**
 * The survivor's visits as they stood: the copies taken away and the reconciled
 * ones put back — each only where nobody has written to it since the merge, so
 * a note or a rating a traveller added afterwards stays with the place.
 */
async function restoreVisits(client: PoolClient, record: MergeRecord): Promise<void> {
  await restoreVisitsIn(client, 'user_visited_experiences', record.visits, true);
  await restoreVisitsIn(client, 'user_visited_locations', record.pointVisits, false);
}

async function restoreVisitsIn(
  client: PoolClient,
  table: 'user_visited_experiences' | 'user_visited_locations',
  visits: ReconciledVisits,
  rated: boolean,
): Promise<void> {
  const unchanged = (at: number) => {
    const rating = rated ? ` AND rating IS NOT DISTINCT FROM $${at + 2}::int` : '';
    return `visited_at IS NOT DISTINCT FROM $${at}::timestamptz AND notes IS NOT DISTINCT FROM $${at + 1}${rating}`;
  };
  const values = (visit: VisitSnapshot) => (rated ? [visit.visited_at, visit.notes, visit.rating ?? null] : [visit.visited_at, visit.notes]);
  for (const copy of visits.inserted) {
    await client.query(`DELETE FROM ${table} WHERE id = $1 AND ${unchanged(2)}`, [copy.id, ...values(copy)]);
  }
  for (const { before, after } of visits.updated) {
    const set = rated ? 'visited_at = $2, notes = $3, rating = $4' : 'visited_at = $2, notes = $3';
    const from = rated ? 5 : 4;
    await client.query(
      `UPDATE ${table} SET ${set} WHERE id = $1 AND ${unchanged(from)}`,
      [before.id, ...values(before), ...values(after)],
    );
  }
}
