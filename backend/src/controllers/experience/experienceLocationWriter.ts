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
import { offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';
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
  return inserted.rows[0].id as number;
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
 * answered — published or refused — and clear the pairings that did their work.
 * Answers how many old points were withdrawn.
 *
 * A gated source that *moves* a point writes the new one `pending` and defers
 * the old one's withdrawal onto it (`locationWriter`), so readers keep the old
 * pin until the arrival is answered and never watch it vanish while its
 * replacement is invisible. Both answers end the pairing, and in the answer's own
 * transaction, since on either side of a COMMIT the place exists twice or not at
 * all:
 *
 * - **published**: the arrival is what a reader sees now, so the old point
 *   goes. Driven off the arrival's own column, which names the old row, rather
 *   than off the ids just published.
 * - **refused**: a curator turned the replacement down, so the old point becomes
 *   what it is — a withdrawn point asking its own question (ADR-0026) — rather
 *   than staying on the map for ever with no question anywhere. Every pairing a
 *   refused point of this object holds, not only this call's: one left standing
 *   by an earlier refusal is the same stranded pin.
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
  answeredBy: 'published' | 'refused',
): Promise<number> {
  const answered = (alias: string) => (answeredBy === 'published'
    ? publishedContentSql(alias)
    : `${alias}.refused_at IS NOT NULL`);
  const released = await client.query(
    `UPDATE experience_locations old
        SET missing_since = NOW(), ordinal = NULL,
            withdrawal_deferred_for_location_id = NULL
       FROM experience_locations arrived
      WHERE arrived.experience_id = $1
        AND old.experience_id = $1
        AND arrived.withdrawal_deferred_for_location_id = old.id
        AND ${answered('arrived')}
        AND old.missing_since IS NULL`,
    [lock.id],
  );
  await client.query(
    `UPDATE experience_locations
        SET withdrawal_deferred_for_location_id = NULL
      WHERE experience_id = $1
        AND withdrawal_deferred_for_location_id IS NOT NULL
        AND ${answered('experience_locations')}`,
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
 * A curator's correction to one point (#583): its name, its coordinate or both,
 * and the claim set that makes the correction survive the next run. The caller
 * builds the claim set from the one it re-read under the lock.
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
    curatedFields: readonly string[];
  },
): Promise<void> {
  await client.query(
    `UPDATE experience_locations
        SET name = COALESCE($2, name),
            location = CASE WHEN $3::boolean
                            THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)
                            ELSE location END,
            curated_fields = $6::jsonb
      WHERE id = $1 AND experience_id = $7`,
    [locationId, correction.name, correction.movesPoint, correction.longitude, correction.latitude,
      JSON.stringify(correction.curatedFields), lock.id],
  );
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

/** Write a held name onto one point: a published part (ADR-0037). */
export async function renamePoint(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  name: string | null,
): Promise<void> {
  await client.query(
    'UPDATE experience_locations SET name = $2 WHERE id = $1 AND experience_id = $3',
    [locationId, name, lock.id],
  );
}
