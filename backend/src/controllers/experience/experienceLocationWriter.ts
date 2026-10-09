/**
 * The curator's writes to `experience_locations` — an object's points — under
 * the object's lock (ADR-0069, #791).
 *
 * The table's writers are a closed list the backend lint names
 * (`EXPERIENCE_LOCATION_WRITE_RULES`): this module, the run's location writer
 * (`services/sync/locationWriter.ts`, which takes the same lock before it pairs
 * and writes a source's points), and the seed. Every write here takes the
 * `LockedExperience` that `lockExperience` hands out, so **the object first,
 * then its points** — `db/locks.ts`'s order — is a property of the types: a
 * point write issued before the object's lock does not compile. A write that
 * names one point also names the object (`AND experience_id = …`), so a token
 * for one object cannot be spent on another's point.
 *
 * The statements and the reasoning that belongs to them live here; whether to
 * issue them — the verdict, the publication, the correction — stays with the
 * handler that decided it. Beside the handlers rather than in `db/`, because
 * only they write points this way and the unread gate it composes
 * (`unreadPointSql`) is theirs.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { ImageCredit } from '../../services/sync/imageCredit.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';
import { unreadPointSql } from './waitingCounts.js';

/** `AND id = ANY($2)` where the caller named points, nothing where it meant all of them. */
function namedPoints(locationIds: readonly number[] | undefined): { sql: string; params: unknown[] } {
  return locationIds === undefined ? { sql: '', params: [] } : { sql: 'AND id = ANY($2::int[])', params: [locationIds] };
}

/**
 * The one point of a place a curator adds by hand: `verified`, because the
 * curator placed it, as the place itself is. Under the token the manual
 * create's own insert hands back (`insertCuratedExperience`).
 */
export async function insertCuratedPoint(
  client: PoolClient,
  lock: LockedExperience,
  name: unknown,
  longitude: unknown,
  latitude: unknown,
): Promise<number> {
  const inserted = await client.query(`
    INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
    VALUES (
      $1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4), 4326),
      -- Same reasoning as the experience row: the curator placed this point by
      -- hand, so it carries the same verdict.
      'verified'
    )
    RETURNING id
  `, [lock.id, name, longitude, latitude]);
  const id = inserted.rows[0].id as number;
  // Placed by the place's manual membership (ADR-0084), written just before by
  // the manual create: a membership no run brings, so no run withdraws the point.
  await client.query(`
    INSERT INTO experience_location_placements (location_id, membership_id)
    SELECT $2, m.id FROM ${MEMBERSHIPS} m WHERE m.experience_id = $1
    ON CONFLICT DO NOTHING
  `, [lock.id, id]);
  return id;
}

/**
 * Publish the object's unread offered points — the named ones, or all of them.
 * Answers how many.
 *
 * `offeredLocationSql` beside `unreadPointSql` because the card that asks the
 * question is built on the same pair, and the two have to move together: a row
 * the card never showed must not be something this can publish, and a row it
 * shows must be something this reaches. Since ADR-0026 the fragment also hides a
 * point a curator declared gone from the world, and publishing one would record
 * a curator as having passed a component another curator called demolished.
 *
 * Not merely cosmetic, either — "publishing it changes nothing on screen" holds
 * only while the point stays withdrawn. `locationWriter`'s "offering it again"
 * arm clears `missing_since` and deliberately leaves `curation_state` alone, so a
 * point published while withdrawn reappears on the map already `verified`: a
 * coordinate no card ever put in front of a curator, recorded as one a curator
 * passed.
 */
export async function publishUnreadPoints(
  client: PoolClient,
  lock: LockedExperience,
  locationIds?: readonly number[],
): Promise<number> {
  const named = namedPoints(locationIds);
  const result = await client.query(
    `UPDATE experience_locations SET curation_state = 'verified'
      WHERE experience_id = $1 AND ${unreadPointSql('experience_locations')}
        AND ${offeredLocationSql('experience_locations')}
      ${named.sql}`,
    [lock.id, ...named.params],
  );
  return result.rowCount ?? 0;
}

/**
 * Mark the object's unread offered points refused — the named ones, or all of
 * them — and answer how many. The mark alone: a refused point stays `pending`,
 * so every reader already hides it (ADR-0053), and the mark is what takes it off
 * the contents card.
 */
export async function markUnreadPointsRefused(
  client: PoolClient,
  lock: LockedExperience,
  locationIds?: readonly number[],
): Promise<number> {
  const named = namedPoints(locationIds);
  const result = await client.query(
    `UPDATE experience_locations SET refused_at = NOW()
      WHERE experience_id = $1 AND ${unreadPointSql('experience_locations')}
        AND ${offeredLocationSql('experience_locations')}
      ${named.sql}`,
    [lock.id, ...named.params],
  );
  return result.rowCount ?? 0;
}

/**
 * Take the refusal mark back off the object's turned-down points — the named
 * ones, or all of them — and say which.
 *
 * The mark alone, with no offered term beside it, and that is a decision rather
 * than an omission. A refused point is always `pending` — the refusal only marks
 * rows `unreadPointSql` reaches — and `withdrawnPointOpenSql` asks for a
 * published point, so a refused point the source then stops offering raises no
 * `withdrawn` card either. Filtering on offered here would leave it on no screen
 * at all, with the answer that put it there permanently unanswerable. Restoring
 * one changes nothing a reader sees: it is `pending` and withdrawn, exactly the
 * state it would have been in had nobody turned it down.
 */
export async function restoreRefusedPoints(
  client: PoolClient,
  lock: LockedExperience,
  locationIds?: readonly number[],
): Promise<number[]> {
  const named = namedPoints(locationIds);
  const result = await client.query<{ id: number }>(
    `UPDATE experience_locations SET refused_at = NULL
      WHERE experience_id = $1 AND refused_at IS NOT NULL
      ${named.sql}
      RETURNING id`,
    [lock.id, ...named.params],
  );
  return result.rows.map(row => row.id);
}

/**
 * Release the withdrawals a moved point held back, once its replacement is
 * published, and clear the pairings that did their work. Answers how many old
 * points were withdrawn.
 *
 * A gated source that *moves* a point writes the new one `pending` and defers
 * the old one's withdrawal onto it (`locationWriter`), so readers keep the old
 * pin until the arrival is answered and never watch it vanish while its
 * replacement is invisible. The publish ends the pairing in its own transaction,
 * since on either side of a COMMIT the place exists twice or not at all: the
 * arrival is what a reader sees now, so the old point goes. Driven off the
 * arrival's own column, which names the old row, rather than off the ids just
 * published.
 *
 * A refusal ends nothing (#1233): a curator's no to a move keeps the stored pin
 * where readers see it, and the refused arrival goes on naming it, which is what
 * keeps the location writer from withdrawing it. The question is settled for
 * that value — a different coordinate from the source is asked about again, and
 * the source offering the old point again clears the pairing (`locationWriter`).
 *
 * `old.missing_since IS NULL` so nothing is withdrawn twice: a second answer must
 * not restamp the date a predecessor stopped being offered. Both sides are scoped
 * to this object, not only the arrival: the location writer never pairs across
 * objects, and the foreign key does not say so, so the statement says it itself.
 *
 * **The released point's own pairing goes with it**, as the location writer's
 * withdraw clears the pairing of every row it marks: a withdrawn row can never be
 * answered, so a pairing left on it would hold the point *it* named visible with
 * nothing able to release it. That is the floor rather than the fix — the writer's
 * `withdrawn` CTE takes visible rows only, so a chain cannot form in the first
 * place — and both are kept: a chain arriving by a route the writer does not
 * cover would otherwise leave a duplicate pin that only hand-written SQL undoes.
 *
 * The pairings are then cleared whatever the release matched — one whose old
 * point some other path had already withdrawn is just as finished — or a run that
 * offers the old point again finds the stale pointer and holds it for ever.
 */
export async function releaseDeferredWithdrawals(
  client: PoolClient,
  lock: LockedExperience,
): Promise<number> {
  // The old point loses the placement of the membership whose run brought the
  // arrival, and is marked missing only once no placement is left (ADR-0084):
  // another source that still places it keeps it on the map. The statement's
  // snapshot still holds the placements its CTE deleted, so "none left"
  // excludes them by name.
  const released = await client.query(
    `WITH pairs AS (
       SELECT old.id AS old_id, arrived.id AS new_id
         FROM experience_locations arrived
         JOIN experience_locations old ON old.id = arrived.withdrawal_deferred_for_location_id
        WHERE arrived.experience_id = $1
          AND old.experience_id = $1
          AND ${publishedContentSql('arrived')}
          AND old.missing_since IS NULL
     ), unplaced AS (
       DELETE FROM experience_location_placements pl
        USING pairs
        WHERE pl.location_id = pairs.old_id
          AND pl.membership_id IN (SELECT membership_id FROM experience_location_placements
                                    WHERE location_id = pairs.new_id)
       RETURNING pl.location_id, pl.membership_id
     )
     UPDATE experience_locations old
        SET missing_since = NOW(), ordinal = NULL,
            withdrawal_deferred_for_location_id = NULL
       FROM pairs
      WHERE old.id = pairs.old_id
        AND NOT EXISTS (
          SELECT 1 FROM experience_location_placements other
           WHERE other.location_id = old.id
             AND (other.location_id, other.membership_id) NOT IN (SELECT location_id, membership_id FROM unplaced)
        )`,
    [lock.id],
  );
  await client.query(
    `UPDATE experience_locations
        SET withdrawal_deferred_for_location_id = NULL
      WHERE experience_id = $1
        AND withdrawal_deferred_for_location_id IS NOT NULL
        AND ${publishedContentSql('experience_locations')}`,
    [lock.id],
  );
  return released.rowCount ?? 0;
}

/**
 * A curator's verdict on one point (ADR-0026): whether its source still lists it
 * and whether it still stands, with who decided. `clearFlag` clears
 * `missing_since` only where the verdict answers the flag — the caller decides
 * that, since only it knows both axes as the curator sent them.
 */
export async function setPointVerdict(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  verdict: {
    sourceMembership: string;
    existence: string;
    clearFlag: boolean;
    decidedBy: number;
    note: string | null;
  },
): Promise<void> {
  await client.query(`
    UPDATE experience_locations
    SET source_membership = $2,
        existence = $3,
        missing_since = CASE WHEN $4 THEN NULL ELSE missing_since END,
        state_decided_by = $5,
        state_decided_at = NOW(),
        state_note = $6
    WHERE id = $1 AND experience_id = $7
  `, [
    locationId, verdict.sourceMembership, verdict.existence, verdict.clearFlag,
    verdict.decidedBy, verdict.note, lock.id,
  ]);
}

/**
 * A curator's correction to one point (#583): its name, its coordinate, its own
 * picture with the credit fetched for it, its description (#1270), any of them,
 * and the claim set that makes the correction survive the next run. The caller
 * builds the claim set from the one it re-read under the lock. `picture` and
 * `description` are `undefined` where the edit leaves them alone and `null`
 * where it clears them; a credit belongs to one photograph, so a new picture
 * with no credit drops the old one's.
 */
export async function correctPoint(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  correction: {
    name: string | null;
    movesPoint: boolean;
    longitude: number | null;
    latitude: number | null;
    picture?: string | null;
    credit?: ImageCredit | null;
    description?: string | null;
    curatedFields: readonly string[];
  },
): Promise<void> {
  await client.query(
    `UPDATE experience_locations
        SET name = COALESCE($2, name),
            location = CASE WHEN $3::boolean
                            THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)
                            ELSE location END,
            image_url = CASE WHEN $8::boolean THEN $9 ELSE image_url END,
            metadata = CASE WHEN NOT $8::boolean THEN metadata
                            WHEN $10::jsonb IS NULL THEN metadata - 'imageCredit'
                            ELSE metadata || jsonb_build_object('imageCredit', $10::jsonb) END,
            description = CASE WHEN $11::boolean THEN $12 ELSE description END,
            curated_fields = $6::jsonb
      WHERE id = $1 AND experience_id = $7`,
    [locationId, correction.name, correction.movesPoint, correction.longitude, correction.latitude,
      JSON.stringify(correction.curatedFields), lock.id,
      correction.picture !== undefined, correction.picture ?? null,
      correction.picture && correction.credit ? JSON.stringify(correction.credit) : null,
      correction.description !== undefined, correction.description ?? null],
  );
}

/** What a confirmed item gives its point: the item's picture with the credit read for it, and its description. */
export interface ClaimedItemContent {
  imageUrl: string | null;
  credit: ImageCredit | null;
  description: string | null;
}

/**
 * Record the Wikidata item a curator confirmed a component is (#1272), as the
 * curator's choice: the item, a claim on it — which a run respects and the
 * finder reads as answered — and what the item gives the point, written where
 * the point holds no claim on the field. The picture only with its credit, as a
 * curator's own picture edit writes one (ADR-0043): an item whose photograph
 * nobody could credit gives the point its identity and no picture — and only
 * a Commons file, as every writer of a picture refuses anything else. Answers
 * whether the picture was written.
 */
export async function claimPointItem(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  item: string,
  content: ClaimedItemContent,
): Promise<{ pictured: boolean }> {
  const picture = content.imageUrl !== null && content.credit !== null && isCommonsPictureUrl(content.imageUrl);
  const result = await client.query<{ pictured: boolean }>(
    `UPDATE experience_locations
        SET wikidata_item = $3,
            curated_fields = CASE WHEN curated_fields ? 'wikidata_item' THEN curated_fields
                                  ELSE curated_fields || '["wikidata_item"]'::jsonb END,
            image_url = CASE WHEN $4::boolean AND NOT curated_fields ? 'image_url' THEN $5 ELSE image_url END,
            metadata = CASE WHEN $4::boolean AND NOT curated_fields ? 'image_url'
                            THEN metadata || jsonb_build_object('imageCredit', $6::jsonb)
                            ELSE metadata END,
            description = CASE WHEN $7::boolean AND NOT curated_fields ? 'description' THEN $8 ELSE description END
      WHERE id = $1 AND experience_id = $2
      RETURNING ($4::boolean AND image_url = $5) AS pictured`,
    [
      locationId, lock.id, item,
      picture, content.imageUrl, picture ? JSON.stringify(content.credit) : null,
      content.description !== null, content.description,
    ],
  );
  return { pictured: result.rows[0]?.pictured === true };
}

/** A field a take-back clears beside the item: what the confirmation wrote with it. */
export type ReleasedField = 'image_url' | 'description';

/**
 * Take the confirmed item off a point (#1317): the item and the claim on it
 * go, and the picture with its credit and the description go where no curator
 * has claimed the field — a point with no item has no run-written picture or
 * description, so an unclaimed one is what the confirmation wrote. Answers
 * which of the two came off.
 */
export async function releasePointItem(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
): Promise<ReleasedField[]> {
  const result = await client.query<{ picture_cleared: boolean; description_cleared: boolean }>(
    `WITH before AS (
       SELECT id, image_url, description, curated_fields FROM experience_locations
        WHERE id = $1 AND experience_id = $2
     )
     UPDATE experience_locations el
        SET wikidata_item = NULL,
            curated_fields = el.curated_fields - 'wikidata_item',
            image_url = CASE WHEN el.curated_fields ? 'image_url' THEN el.image_url ELSE NULL END,
            metadata = CASE WHEN el.curated_fields ? 'image_url' THEN el.metadata ELSE el.metadata - 'imageCredit' END,
            description = CASE WHEN el.curated_fields ? 'description' THEN el.description ELSE NULL END
       FROM before b
      WHERE el.id = b.id
      RETURNING (b.image_url IS NOT NULL AND NOT b.curated_fields ? 'image_url') AS picture_cleared,
                (b.description IS NOT NULL AND NOT b.curated_fields ? 'description') AS description_cleared`,
    [locationId, lock.id],
  );
  const row = result.rows[0];
  const cleared: ReleasedField[] = [];
  if (row?.picture_cleared) cleared.push('image_url');
  if (row?.description_cleared) cleared.push('description');
  return cleared;
}

/**
 * Release the coordinate claim on the point the object's anchor was taken from,
 * together with the object's own (`accept-source` on `location`), and say which
 * points. `acceptSourceController` says why the two go together.
 */
export async function releaseAnchorPointClaim(
  client: PoolClient,
  lock: LockedExperience,
): Promise<Array<{ id: number; external_ref: string | null; name: string | null }>> {
  const released = await client.query(
    `UPDATE experience_locations el
        -- Qualified on the right-hand side: both tables carry the column, and
        -- unqualified it is ambiguous rather than wrong-but-working.
        SET curated_fields = el.curated_fields - 'location'
       FROM experiences e
      WHERE e.id = $1 AND el.experience_id = e.id
        AND el.curated_fields ? 'location'
        AND el.location = e.location
      RETURNING el.id, el.external_ref, el.name`,
    [lock.id],
  );
  return released.rows;
}

/** Put one point where its source says it is: an accepted source coordinate. */
export async function movePointTo(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  longitude: number,
  latitude: number,
): Promise<void> {
  await client.query(
    `UPDATE experience_locations
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)
      WHERE id = $1 AND experience_id = $4`,
    [locationId, longitude, latitude, lock.id],
  );
}

/** A point field a held proposal can carry, and so the only ones a published held point writes. */
export type HeldPointField = 'name' | 'image_url' | 'metadata.imageCredit' | 'description';

/**
 * The same list as a set: what the held-part plan accepts on a point
 * (`publishHeldParts.ts`) is what this writer can write, stated once. The
 * picture, its credit and the description are a component's own (#1270).
 */
export const HELD_POINT_FIELDS: ReadonlySet<string> = new Set<HeldPointField>(
  ['name', 'image_url', 'metadata.imageCredit', 'description'],
);

export function isHeldPointField(field: string): field is HeldPointField {
  return HELD_POINT_FIELDS.has(field);
}

/**
 * Write the held fields of one point a gated run recorded rather than wrote
 * (ADR-0037), as `publishHeldParts.ts` planned them. The values arrive as
 * data; the assignments are built from the closed list, and anything else is
 * refused rather than put into the statement.
 */
export async function writeHeldPointFields(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  fields: ReadonlyArray<{ field: HeldPointField; value: unknown }>,
): Promise<void> {
  if (fields.length === 0) return;
  const params: unknown[] = [locationId, lock.id];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const assignments = fields.map(({ field, value }) => {
    if (field === 'metadata.imageCredit') {
      // Absent and null are one case, as for a work's credit: the key goes.
      return value == null
        ? `metadata = metadata - 'imageCredit'`
        : `metadata = metadata || jsonb_build_object('imageCredit', ${bind(JSON.stringify(value))}::jsonb)`;
    }
    if (!isHeldPointField(field)) throw new Error(`A held point field this writer does not know: ${String(field)}`);
    return `${field} = ${bind(value)}`;
  });
  await client.query(
    `UPDATE experience_locations SET ${assignments.join(', ')} WHERE id = $1 AND experience_id = $2`,
    params,
  );
}

/** A point folded into one of the survivor's on a merge, and the placements that moved with it. */
export interface FoldedPoints {
  points: { point: number; target: number }[];
  /** Placements the survivor's points gained, which the undo takes away again. */
  added: { location: number; membership: number }[];
  /** The folded points' own placements, which the undo puts back. */
  removed: { location: number; membership: number }[];
}

/**
 * Fold the folded place's points into the survivor's where they are one point
 * (ADR-0086 decision 3, narrowed by ADR-0088): the same `external_ref`, which
 * both sources read off one Wikidata item; or the one point of a place of one
 * point folded into another place of one point — a World Heritage site and the
 * cathedral it is name the place by different references, and it is still one
 * place on the ground, where two pins would be the bug the merge exists to
 * end. The folded point's placements move onto the survivor's point, and the
 * folded point is marked `merged_into_id` and kept, hidden by
 * `offeredLocationSql` like a point the source withdrew.
 */
export async function foldPoints(
  client: PoolClient,
  folded: LockedExperience,
  survivor: LockedExperience,
): Promise<FoldedPoints> {
  const pairs = await client.query<{ point: number; target: number }>(
    `WITH standing AS (
       SELECT id, experience_id, external_ref FROM experience_locations
        WHERE experience_id IN ($1, $2) AND merged_into_id IS NULL
     ), by_ref AS (
       SELECT f.id AS point, s.id AS target
         FROM standing f JOIN standing s ON s.experience_id = $2 AND s.external_ref = f.external_ref
        WHERE f.experience_id = $1 AND f.external_ref IS NOT NULL
     ), one_each AS (
       SELECT f.id AS point, s.id AS target
         FROM standing f JOIN standing s ON s.experience_id = $2
        WHERE f.experience_id = $1
          AND (SELECT count(*) FROM standing WHERE experience_id = $1) = 1
          AND (SELECT count(*) FROM standing WHERE experience_id = $2) = 1
     )
     SELECT DISTINCT ON (point) point, target
       FROM (SELECT * FROM by_ref UNION ALL SELECT * FROM one_each) pair
      ORDER BY point, target`,
    [folded.id, survivor.id],
  );
  const points = pairs.rows;
  if (points.length === 0) return { points, added: [], removed: [] };
  const from = points.map(pair => pair.point);
  const into = points.map(pair => pair.target);
  const added = await client.query<{ location: number; membership: number }>(
    `INSERT INTO experience_location_placements (location_id, membership_id)
     SELECT pair.target, p.membership_id
       FROM unnest($1::int[], $2::int[]) AS pair(point, target)
       JOIN experience_location_placements p ON p.location_id = pair.point
     ON CONFLICT DO NOTHING
     RETURNING location_id AS location, membership_id AS membership`,
    [from, into],
  );
  const removed = await client.query<{ location: number; membership: number }>(
    `DELETE FROM experience_location_placements WHERE location_id = ANY($1::int[])
     RETURNING location_id AS location, membership_id AS membership`,
    [from],
  );
  await client.query(
    `UPDATE experience_locations el SET merged_into_id = pair.target
       FROM unnest($1::int[], $2::int[]) AS pair(point, target)
      WHERE el.id = pair.point AND el.experience_id = $3`,
    [from, into, folded.id],
  );
  return { points, added: added.rows, removed: removed.rows };
}

/** Undo `foldPoints`: the folded points come back with their own placements. */
export async function unfoldPoints(
  client: PoolClient,
  folded: LockedExperience,
  record: FoldedPoints,
): Promise<void> {
  if (record.points.length === 0) return;
  await client.query(
    `DELETE FROM experience_location_placements p
      USING unnest($1::int[], $2::int[]) AS gained(location, membership)
      WHERE p.location_id = gained.location AND p.membership_id = gained.membership`,
    [record.added.map(row => row.location), record.added.map(row => row.membership)],
  );
  await client.query(
    `INSERT INTO experience_location_placements (location_id, membership_id)
     SELECT * FROM unnest($1::int[], $2::int[]) ON CONFLICT DO NOTHING`,
    [record.removed.map(row => row.location), record.removed.map(row => row.membership)],
  );
  await client.query(
    'UPDATE experience_locations SET merged_into_id = NULL WHERE id = ANY($1::int[]) AND experience_id = $2',
    [record.points.map(pair => pair.point), folded.id],
  );
}

/**
 * Move points from one place to another (ADR-0086): every point of the folded
 * place not folded into one of the survivor's on a merge, or the ones a merge
 * moved, named, on its undo.
 */
export async function movePoints(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE experience_locations SET experience_id = $2
      WHERE experience_id = $1 AND merged_into_id IS NULL AND ($3::int[] IS NULL OR id = ANY($3::int[]))
      RETURNING id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}
