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
 * `LockedExperience`, which nothing else in the codebase produces; every write
 * made under that lock requires one, so a write issued before the lock, or on a
 * path that never took it, does not type-check. Writes to the object's points
 * and works do not take the token yet — they get their own writer in the
 * `experience_locations` slice of #791 — so for them "the object first" is
 * still each handler's order of statements.
 *
 * A write outside the lock rule takes no token, and `db/locks.ts` names why.
 */

import type { PoolClient } from 'pg';
import { OBJECT_LOCK } from './locks.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';

declare const locked: unique symbol;

/**
 * Proof that this transaction holds the object's row lock: produced only by
 * `lockExperience`, on the connection the transaction runs on.
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
 * knows before it knows the id. Null where the source is offering it for the
 * first time: there is no row yet, and the insert's own row lock is the object
 * lock (`db/locks.ts`).
 */
export async function lockSourcedExperience(
  client: PoolClient,
  sourceId: number,
  externalId: string,
): Promise<LockedExperience | null> {
  const result = await client.query(
    `SELECT id FROM experiences WHERE source_id = $1 AND external_id = $2 ${OBJECT_LOCK}`,
    [sourceId, externalId],
  );
  const id = result.rows[0]?.id as number | undefined;
  return id === undefined ? null : ({ id } as LockedExperience);
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
 * A lifecycle verdict on the place (ADR-0020, ADR-0021): whether its source
 * still lists it and whether it still stands, with who decided. Clears
 * `missing_since` whatever the verdict, because a verdict answers the flag:
 * the flag is a question, and a curator has now said what it meant.
 */
export async function setLifecycleVerdict(
  client: PoolClient,
  lock: LockedExperience,
  verdict: { sourceMembership: string; existence: string; decidedBy: number; note: string | null },
): Promise<void> {
  await client.query(`
    UPDATE experiences
    SET source_membership = $2,
        existence = $3,
        missing_since = NULL,
        state_decided_by = $4,
        state_decided_at = NOW(),
        state_note = $5,
        updated_at = NOW()
    WHERE id = $1
  `, [lock.id, verdict.sourceMembership, verdict.existence, verdict.decidedBy, verdict.note]);
}

/**
 * A place a curator adds by hand, as `createManualExperience` builds it:
 * `is_manual`, owned by nobody's run, and `active` from the moment it exists.
 *
 * Outside the lock rule by the exception `db/locks.ts` names: the insert's own
 * row lock is the object lock, and no other transaction can hold a row of an
 * object that did not exist when it began. The caller's transaction goes on to
 * write the membership and the point under it.
 */
export async function insertCuratedExperience(
  client: PoolClient,
  row: {
    sourceId: number;
    externalId: string;
    name: unknown;
    shortDescription: unknown;
    type: unknown;
    longitude: unknown;
    latitude: unknown;
    imageUrl: unknown;
    tags: string | null;
    countryCodes: unknown[] | null;
    countryNames: unknown[] | null;
    metadata: string | null;
    createdBy: number;
  },
): Promise<number> {
  const inserted = await client.query(`
    INSERT INTO experiences (
      source_id, external_id, name, short_description, type,
      location, image_url, tags, country_codes, country_names,
      metadata, is_manual, created_by, status
    ) VALUES (
      $1, $2, $3, $4, $5,
      ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10, $11,
      $12, true, $13, 'active'
    ) RETURNING id
  `, [
    row.sourceId, row.externalId, row.name, row.shortDescription, row.type,
    row.longitude, row.latitude, row.imageUrl, row.tags, row.countryCodes, row.countryNames,
    row.metadata, row.createdBy,
  ]);
  return inserted.rows[0].id as number;
}
