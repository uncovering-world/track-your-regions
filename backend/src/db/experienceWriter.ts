/**
 * The curator's writes to `experiences`, and the object lock every writer takes
 * (ADR-0069, #791).
 *
 * The table's writers are a closed list the backend lint names
 * (`EXPERIENCE_WRITE_RULES`): this module, the run's upsert
 * (`services/sync/experienceUpsert.ts`), missing detection's mark and the
 * picture repair, and the seed. Every curator write is a named function here;
 * the statement and what it does live here, and whether to issue it — the
 * verdict, the claim, the held proposal — stays with the caller that decided it.
 *
 * **A write that assumes the object's lock takes the lock.** `lockExperience`
 * runs `OBJECT_LOCK` (`db/locks.ts`) on the caller's connection and hands back a
 * `LockedExperience`, which nothing outside this module produces; every write
 * made under that lock requires one, so a write issued before the lock, or on a
 * path that never took it, does not type-check. The curator's writes to the
 * object's points and to its works take it too
 * (`controllers/experience/experienceLocationWriter.ts`,
 * `controllers/experience/workWriter.ts`), so for a point and a work alike "the
 * object first" is a property of the types.
 *
 * A write outside the lock rule takes no token, and `db/locks.ts` names why.
 */

import type { PoolClient } from 'pg';
import { OBJECT_LOCK } from './locks.js';
import { MEMBERSHIPS } from './membership.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';

declare const locked: unique symbol;

/**
 * Proof that this transaction holds the object's row lock, on the connection it
 * runs on. Produced only in this module: by `lockExperience`,
 * `lockSourcedExperience`, and `insertCuratedExperience`, whose insert's own row
 * lock is the object lock.
 */
export type LockedExperience = { readonly id: number; readonly [locked]: true };

/**
 * Lock the object, in a statement of its own, and read `columns` of it.
 *
 * `columns` is a select list of the row's own columns — they are re-read at
 * their latest version once the lock is granted, so reading them here is
 * fresh. A column of another table (a membership, a point) is not: `db/locks.ts`
 * § the snapshot says why, and that read belongs in the next statement.
 *
 * Null where the row is gone: a handler's existence check ran earlier, on
 * another connection, and a row deleted in between leaves nothing to lock.
 */
export async function lockExperience<Row extends Record<string, unknown> = { id: number }>(
  client: PoolClient,
  experienceId: number,
  columns = 'id',
): Promise<{ lock: LockedExperience; row: Row } | null> {
  const result = await client.query(
    `SELECT ${columns} FROM experiences WHERE id = $1 ${OBJECT_LOCK}`,
    [experienceId],
  );
  if (result.rows.length === 0) return null;
  return { lock: { id: experienceId } as LockedExperience, row: result.rows[0] as Row };
}

/**
 * The same lock, found by the source's own name for the object — what a run
 * knows before it knows the id — through the source's membership (ADR-0084:
 * a place belongs to no source, so the place's own `source_id` is not the
 * key). Null where the source is offering it for the first time: there is no
 * row yet, and the insert's own row lock is the object lock (`db/locks.ts`).
 *
 * The membership is read again once the lock is held. The first statement
 * chose the place under the snapshot it took before waiting, so a membership
 * a merge moved to another place during that wait would leave the run holding
 * the place it was moved from; the re-read names the place it hangs on now,
 * and the lock is taken there instead.
 *
 * The source's name for the object is locked first, for the transaction
 * (`pg_advisory_xact_lock`): where there is no place yet there is no row to
 * lock, and two writers offering the same new object — two processes, which
 * the in-memory `runningSyncs` guard cannot see — would both find nothing and
 * both insert, the second refused by the place's own unique pair. With the
 * name locked, the second waits, then finds the membership the first wrote.
 * Nothing else takes this lock, so it is always taken before the row's.
 */
export async function lockSourcedExperience(
  client: PoolClient,
  sourceId: number,
  externalId: string,
): Promise<LockedExperience | null> {
  const placeOf = async (): Promise<number | undefined> => (await client.query(
    `SELECT experience_id FROM ${MEMBERSHIPS} WHERE source_id = $1 AND external_id = $2`,
    [sourceId, externalId],
  )).rows[0]?.experience_id as number | undefined;

  await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2))', [sourceId, externalId]);
  let id = await placeOf();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (id === undefined) return null;
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [id]);
    const now = await placeOf();
    if (now === id) return { id } as LockedExperience;
    id = now;
  }
  throw new Error(`${sourceId}/${externalId} kept moving between places while a run locked it`);
}

/**
 * The object's own coordinate follows the one point a reader is positioned
 * over, and is claimed there (ADR-0028 decision 2, #550): what a curator's
 * correction of that point does to the object. Answers whether it moved.
 *
 * The statement decides whether this point is that one — the count and the
 * `EXISTS` below — so a caller hands over the edit and reads the answer rather
 * than deciding first. `locationEditController` says when a correction reaches
 * it at all.
 */
export async function anchorToItsPoint(
  client: PoolClient,
  lock: LockedExperience,
  longitude: number,
  latitude: number,
  locationId: number,
): Promise<boolean> {
  const anchored = await client.query(
    `UPDATE experiences e
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326),
            curated_fields = CASE WHEN e.curated_fields ? 'location'
                                  THEN e.curated_fields
                                  ELSE COALESCE(e.curated_fields, '[]'::jsonb) || '["location"]'::jsonb END,
            -- Stamped by hand like every other writer of this table: there is
            -- no trigger, and both columns above are ones a reader is served
            -- from, so a row left reporting the time of whatever last touched
            -- it would answer "last changed" with a moment before its
            -- coordinate moved.
            updated_at = NOW()
      WHERE e.id = $1
        AND (SELECT COUNT(*) FROM experience_locations el
              WHERE el.experience_id = e.id
                AND ${offeredLocationSql('el')}
                AND ${publishedContentSql('el')}) = 1
        -- ...and it is *this* point. The count alone says the object has one
        -- place a reader is positioned over; it does not say the curator was
        -- editing that one. Editing a withdrawn, lost or unread sibling beside
        -- one visible point satisfies the count and would move the object onto
        -- a coordinate readerPositionSql never sends anyone to -- #550's
        -- disagreement, made by the endpoint written to close it. Two of those
        -- three shapes are reachable only since the count learned the
        -- fragments: under missing_since IS NULL alone a lost or unread
        -- sibling made the count 2 and nothing moved.
        AND EXISTS (SELECT 1 FROM experience_locations el
                     WHERE el.id = $4 AND el.experience_id = e.id
                       AND ${offeredLocationSql('el')}
                       AND ${publishedContentSql('el')})
      RETURNING e.id`,
    [lock.id, longitude, latitude, locationId],
  );
  return anchored.rows.length > 0;
}

/**
 * Write columns a caller decided, under the lock: the curator's edit, an
 * accepted source value, a published held proposal.
 *
 * The caller owns which columns and what they are set to — each builds its
 * list from a claim set or a proposal this module has no business reading —
 * and this owns the rest of the statement: the row it names (`$1`, the locked
 * id) and the stamp. `params` bind `$2` onward, in the order the assignments
 * reference them.
 *
 * `updated_at` is stamped here because nothing else stamps it: the table has no
 * trigger, and a row read by readers that reports the time of whatever last
 * touched it answers "last changed" with the wrong moment.
 */
export async function updateExperienceColumns(
  client: PoolClient,
  lock: LockedExperience,
  assignments: readonly string[],
  params: readonly unknown[],
): Promise<void> {
  await client.query(
    `UPDATE experiences
     SET ${[...assignments, 'updated_at = NOW()'].join(',\n         ')}
     WHERE id = $1`,
    [lock.id, ...params],
  );
}

/**
 * Who decided about the place, when, and what they noted — the three columns
 * every curator verdict on the place shares (ADR-0020), written beside the
 * verdict itself: an admission answer or a curator's refusal, whose own columns
 * are the membership's (#822).
 */
export async function recordDecisionOnExperience(
  client: PoolClient,
  lock: LockedExperience,
  decidedBy: number,
  note: string | null,
): Promise<void> {
  await client.query(`
    UPDATE experiences
    SET state_decided_by = $2,
        state_decided_at = NOW(),
        state_note = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [lock.id, decidedBy, note]);
}

/**
 * A lifecycle verdict on the place (ADR-0020, ADR-0021): whether it still
 * stands, with who decided. Whether its sources still list it is its
 * memberships' (ADR-0084) and is written beside this by `setListingVerdict`
 * (`membershipWriter.ts`), under the same lock.
 */
export async function setLifecycleVerdict(
  client: PoolClient,
  lock: LockedExperience,
  verdict: { existence: string; decidedBy: number; note: string | null },
): Promise<void> {
  await client.query(`
    UPDATE experiences
    SET existence = $2,
        state_decided_by = $3,
        state_decided_at = NOW(),
        state_note = $4,
        updated_at = NOW()
    WHERE id = $1
  `, [lock.id, verdict.existence, verdict.decidedBy, verdict.note]);
}

/**
 * A place a curator adds by hand, as `createManualExperience` builds it:
 * `is_manual`, owned by nobody's run, and `active` from the moment it exists.
 *
 * Answers with the object's token, because the insert's own row lock *is* the
 * object lock (`db/locks.ts`): no other transaction can hold a row of an object
 * that did not exist when it began. The caller's transaction goes on to write
 * the membership and the point under it.
 */
export async function insertCuratedExperience(
  client: PoolClient,
  row: {
    sourceId: number;
    externalId: string;
    name: unknown;
    shortDescription: unknown;
    longitude: unknown;
    latitude: unknown;
    imageUrl: unknown;
    tags: string | null;
    countryCodes: unknown[] | null;
    countryNames: unknown[] | null;
    metadata: string | null;
    createdBy: number;
  },
): Promise<LockedExperience> {
  const inserted = await client.query(`
    INSERT INTO experiences (
      source_id, external_id, name, short_description,
      location, image_url, tags, country_codes, country_names,
      metadata, is_manual, created_by, status
    ) VALUES (
      $1, $2, $3, $4,
      ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10,
      $11, true, $12, 'active'
    ) RETURNING id
  `, [
    row.sourceId, row.externalId, row.name, row.shortDescription,
    row.longitude, row.latitude, row.imageUrl, row.tags, row.countryCodes, row.countryNames,
    row.metadata, row.createdBy,
  ]);
  return { id: inserted.rows[0].id as number } as LockedExperience;
}
