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
