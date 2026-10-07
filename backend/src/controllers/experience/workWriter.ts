/**
 * The curator's writes to `treasures` and `experience_treasures` — a venue's
 * works and their links to it — under the venue's lock (ADR-0069, #1072).
 *
 * The tables' writers are a closed list the backend lint names
 * (`WORK_WRITE_RULES`): this module, the run's treasure writer and link
 * reconciliation (`services/sync/museum/treasureWriter.ts`,
 * `services/sync/museum/linkWithdrawal.ts`), and the seed. Every write here
 * takes the venue's `LockedExperience`, so **the object first, then its works**
 * — `db/locks.ts`'s order — is a property of the types, as it is for points.
 *
 * **A write names the venue.** A link is the venue's own row, so a link write
 * says `experience_id = lock.id`. A work is not: it is one row for every venue
 * that holds it (ADR-0025 decision 2), so a write to it goes through a link of
 * `lock.id`, and a token for one venue cannot be spent on a work that venue does
 * not hold.
 *
 * **A work's own lock.** Because a work is shared, two curators correcting it
 * from two venues hold two different venue locks, and the venue lock does not
 * serialise them. The work row's own `FOR UPDATE` does, taken after the venue:
 * `lockWork` for a correction, `lockPart` (`publishHeldParts.ts`) for a held
 * field. Every such transaction takes a venue first and its works second, so a
 * transaction on one work cannot wait for another in the opposite order. A
 * publish touches several, and a work is one row for every venue that holds it,
 * so two venues sharing two works could take them in opposite orders and
 * deadlock. So a publish takes every work it will write in one statement,
 * `lockWorksToPublish`, in ascending id, before it writes or locks any of them
 * one by one (#1095): whichever publish reaches a shared work first holds it,
 * and the other waits instead of holding the next. `publishContents` takes the
 * pending works so, for every caller; `publishUnderLock` takes them together
 * with the held works first, since it locks those one by one before.
 *
 * The statements and the reasoning that belongs to them live here; whether to
 * issue them — the verdict, the publication, the correction — stays with the
 * handler that decided it.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { offeredLinkSql } from '../../db/readerPredicates.js';
import { linkNotRefusedSql, unreadLinkSql } from './waitingCounts.js';

/** `AND <column> = ANY($2)` where the caller named works, nothing where it meant all of them. */
function namedWorks(column: string, treasureIds: readonly number[] | undefined): { sql: string; params: unknown[] } {
  return treasureIds === undefined ? { sql: '', params: [] } : { sql: `AND ${column} = ANY($2::int[])`, params: [treasureIds] };
}

/** The works a publish at the venue will write, for `lockWorksToPublish`. */
export interface WorksToPublish {
  /** The `external_id`s of the works the held record changes. */
  heldRefs: readonly string[];
  /** The pending works behind the venue's offered links — the named ones, or all — or null where this publish leaves them. */
  pending: { treasureIds?: readonly number[] } | null;
}

/**
 * Lock every work a publish at the venue will write, in ascending id, in one
 * statement, before any of them is written (#1095).
 *
 * The set is the held works and the pending works together, since a publish
 * writes both: a held work may also be pending, and two venues' publishes must
 * meet their shared works in the same order whichever pass writes them. The
 * held works' own `FOR UPDATE` in `lockPart` and the pending ones' UPDATE then
 * find the rows already this transaction's.
 */
export async function lockWorksToPublish(
  client: PoolClient, lock: LockedExperience, works: WorksToPublish,
): Promise<void> {
  if (works.heldRefs.length === 0 && works.pending === null) return;
  const params: unknown[] = [lock.id, works.heldRefs];
  let pendingSql = 'false';
  if (works.pending !== null) {
    let named = '';
    if (works.pending.treasureIds !== undefined) {
      params.push(works.pending.treasureIds);
      named = `AND et.treasure_id = ANY($${params.length}::int[])`;
    }
    pendingSql = `t.curation_state = 'pending' AND EXISTS (
          SELECT 1 FROM experience_treasures et
           WHERE et.treasure_id = t.id AND et.experience_id = $1
             AND ${offeredLinkSql('et')} AND ${linkNotRefusedSql('et')}
             ${named}
        )`;
  }
  await client.query(
    `SELECT t.id FROM treasures t
      WHERE (t.external_id = ANY($2::text[])
             AND EXISTS (SELECT 1 FROM experience_treasures et WHERE et.treasure_id = t.id AND et.experience_id = $1))
         OR (${pendingSql})
      ORDER BY t.id
      FOR UPDATE`,
    params,
  );
}

/**
 * Publish the venue's unread offered links — the named works', or all of them.
 * Answers how many.
 *
 * Only a link the source still places here (ADR-0044): a withdrawn link is
 * shown to nobody, so publishing it looks harmless until the run that places
 * the work here again clears `missing_since` and leaves the state this wrote —
 * a work back on the wall marked as one a curator passed, having been on no
 * card.
 */
export async function publishUnreadLinks(
  client: PoolClient, lock: LockedExperience, treasureIds?: readonly number[],
): Promise<number> {
  const named = namedWorks('treasure_id', treasureIds);
  const links = await client.query(
    `UPDATE experience_treasures SET curation_state = 'verified'
      WHERE experience_id = $1 AND curation_state = 'pending'
        AND ${linkNotRefusedSql('experience_treasures')}
        AND ${offeredLinkSql('experience_treasures')}
      ${named.sql}`,
    [lock.id, ...named.params],
  );
  return links.rowCount ?? 0;
}

/**
 * Publish the works behind the venue's offered links — the named ones, or all
 * of them. Answers how many.
 *
 * Scoped through this venue's own links, so a request cannot publish a work by
 * naming an id that has nothing to do with the venue the caller's scope was
 * checked against — and through its *offered* links, since a work whose only
 * link here is withdrawn is not on show here, and this card is not the one
 * that should pass it.
 */
export async function publishUnreadWorks(
  client: PoolClient, lock: LockedExperience, treasureIds?: readonly number[],
): Promise<number> {
  const named = namedWorks('et.treasure_id', treasureIds);
  const works = await client.query(
    `UPDATE treasures SET curation_state = 'verified', updated_at = NOW()
      WHERE curation_state = 'pending'
        AND EXISTS (
          SELECT 1 FROM experience_treasures et
           WHERE et.treasure_id = treasures.id AND et.experience_id = $1
             AND ${offeredLinkSql('et')} AND ${linkNotRefusedSql('et')}
             ${named.sql}
        )`,
    [lock.id, ...named.params],
  );
  return works.rowCount ?? 0;
}

/**
 * Mark the venue's unread offered links refused — the named works', or all of
 * them. Answers how many.
 *
 * The mark is on the link, not the work: "not this work here" is the link's
 * axis, and the work stays askable at every other venue that holds it. The join
 * is one row per link, so the UPDATE writes each link once.
 *
 * The link's own state goes to `pending` with the mark. A link is unread on
 * either axis (ADR-0025 decision 2), so one whose own state is `auto` can be
 * refused here because its *work* is pending — and the work is one row for
 * every venue, published from whichever venue passes it first. Readers hide a
 * link by `<> 'pending'` on both axes and never read the mark, so a refused
 * link left `auto` would surface the day the work is published elsewhere.
 * Pending says what is true — nobody passed this work *here* — and keeps the
 * one reader word the mark relies on.
 */
export async function markUnreadLinksRefused(
  client: PoolClient, lock: LockedExperience, treasureIds?: readonly number[],
): Promise<number> {
  const named = namedWorks('et.treasure_id', treasureIds);
  const links = await client.query(
    `UPDATE experience_treasures et SET refused_at = NOW(), curation_state = 'pending'
       FROM treasures t
      WHERE t.id = et.treasure_id AND et.experience_id = $1
        AND ${unreadLinkSql('et', 't')} AND ${offeredLinkSql('et')}
      ${named.sql}`,
    [lock.id, ...named.params],
  );
  return links.rowCount ?? 0;
}

/**
 * Clear the refusal on the venue's turned-down links — the named works', or all
 * of them — and say which works.
 *
 * The mark alone. A withdrawn link has no card of its own either, so an offered
 * term would strand it. `curation_state` is deliberately not written: the
 * refusal set the link `pending`, and that is what "nobody passed this work
 * here" means. The work's own axis is not this act's to decide.
 */
export async function restoreRefusedLinks(
  client: PoolClient, lock: LockedExperience, treasureIds?: readonly number[],
): Promise<number[]> {
  const named = namedWorks('et.treasure_id', treasureIds);
  const links = await client.query<{ treasure_id: number }>(
    `UPDATE experience_treasures et SET refused_at = NULL
      WHERE et.experience_id = $1 AND et.refused_at IS NOT NULL
      ${named.sql}
      RETURNING et.treasure_id`,
    [lock.id, ...named.params],
  );
  return links.rows.map(row => row.treasure_id);
}

/** A work's correctable columns, as they stand. */
export interface StoredWork {
  name: string;
  artists: string[];
  year: number | null;
  image_url: string | null;
  curated_fields: string[];
}

/**
 * Lock a work the venue offers, and read what a correction reads: the claim set
 * it adds to and the values the trail reports as `old`. Null where the venue no
 * longer offers the work.
 *
 * The work row's own lock, after the venue's (the module docblock says why a
 * shared row needs one). The link is read in the same statement, which starts
 * after the venue lock was granted in the one before it, so a withdrawal — the
 * run's link reconciliation takes the venue first too — cannot land between
 * the read and the write.
 */
export async function lockWork(
  client: PoolClient, lock: LockedExperience, treasureId: number,
): Promise<StoredWork | null> {
  const locked = await client.query(
    `SELECT name, artists, year, image_url, curated_fields FROM treasures t
      WHERE t.id = $1
        AND EXISTS (
          SELECT 1 FROM experience_treasures et
           WHERE et.treasure_id = t.id AND et.experience_id = $2 AND ${offeredLinkSql('et')}
        )
      FOR UPDATE`,
    [treasureId, lock.id],
  );
  return (locked.rows[0] as StoredWork | undefined) ?? null;
}

/** What a curator's correction changes: each field absent where the request left it alone. */
export interface WorkCorrection {
  name?: string;
  artists?: string[];
  year?: number | null;
  /** The new picture, `null` for removing it. */
  picture?: string | null;
  /** The photograph's credit, written with the picture; `null` for none. */
  credit: unknown;
  /** The work's whole claim set after this correction. */
  curatedFields: readonly string[];
}

/** Write a curator's correction to a work the venue offers, locked by `lockWork`. */
export async function correctWork(
  client: PoolClient, lock: LockedExperience, treasureId: number, change: WorkCorrection,
): Promise<void> {
  await client.query(
    `UPDATE treasures
        SET name = COALESCE($2, name),
            -- Not COALESCE: an empty list is a value a curator can mean — "the
            -- source names a maker and nobody knows who made this" — and
            -- COALESCE cannot tell it from "leave this alone". The boolean says
            -- which of the two the request was.
            artists = CASE WHEN $3::boolean THEN $4::varchar(500)[] ELSE artists END,
            year = CASE WHEN $5::boolean THEN $6::integer ELSE year END,
            image_url = CASE WHEN $8::boolean THEN $9::varchar(1000) ELSE image_url END,
            -- The credit moves in the same statement as the photograph it
            -- belongs to, so no moment exists in which the row holds one
            -- picture and another photographer's name. Merged rather than
            -- assigned: the metadata column is the run's too, and this edit
            -- answers for one key of it.
            metadata = CASE WHEN $8::boolean
                            THEN COALESCE(metadata, '{}'::jsonb) || $10::jsonb
                            ELSE metadata END,
            curated_fields = $7::jsonb,
            -- Stamped by hand, as every writer of this table does: there is no
            -- trigger, and a row whose value changed without its timestamp
            -- moving is one nothing downstream can tell has changed.
            updated_at = NOW()
      WHERE id = $1
        AND EXISTS (SELECT 1 FROM experience_treasures et WHERE et.treasure_id = $1 AND et.experience_id = $11)`,
    [treasureId, change.name ?? null,
      change.artists !== undefined, change.artists ?? [],
      change.year !== undefined, change.year ?? null,
      JSON.stringify(change.curatedFields),
      change.picture !== undefined, change.picture ?? null,
      JSON.stringify({ imageCredit: change.credit }),
      lock.id],
  );
}

/** A work field a held proposal can carry, and so the only ones a published held work writes. */
export type HeldWorkField = 'name' | 'artists' | 'year' | 'image_url' | 'metadata.imageCredit';

/**
 * The same list as a set: what the held-part plan accepts on a work
 * (`publishHeldParts.ts`) is what this writer can write, stated once.
 */
export const HELD_WORK_FIELDS: ReadonlySet<string> = new Set<HeldWorkField>(
  ['name', 'artists', 'year', 'image_url', 'metadata.imageCredit'],
);

export function isHeldWorkField(field: string): field is HeldWorkField {
  return HELD_WORK_FIELDS.has(field);
}

/**
 * Write the held fields of one work a gated run recorded rather than wrote
 * (ADR-0037), as `publishHeldParts.ts` planned them. The row is locked by
 * `lockPart` already.
 *
 * The values arrive as data; the assignments are built here from the closed
 * list of fields, and anything else is refused rather than put into the
 * statement.
 */
export async function writeHeldWorkFields(
  client: PoolClient,
  lock: LockedExperience,
  treasureId: number,
  fields: ReadonlyArray<{ field: HeldWorkField; value: unknown }>,
): Promise<void> {
  if (fields.length === 0) return;
  const params: unknown[] = [treasureId, lock.id];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const assignments = fields.map(({ field, value }) => {
    if (field === 'metadata.imageCredit') {
      // Absent and null are one case, as they are for the object's credit: the
      // key goes rather than being written as a jsonb null nothing reads.
      return value == null
        ? `metadata = COALESCE(metadata, '{}'::jsonb) - 'imageCredit'`
        : `metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('imageCredit', ${bind(JSON.stringify(value))}::jsonb)`;
    }
    if (!isHeldWorkField(field)) throw new Error(`A held work field this writer does not know: ${String(field)}`);
    // The column is the field's own name, and Postgres infers each parameter's
    // type from the column it is assigned to.
    return `${field} = ${bind(value)}`;
  });
  // `treasures` has `updated_at` where the location table does not, and a row
  // whose value changed without its timestamp moving is one nothing downstream
  // can tell has changed.
  assignments.push('updated_at = NOW()');
  await client.query(
    `UPDATE treasures SET ${assignments.join(', ')}
      WHERE id = $1
        AND EXISTS (SELECT 1 FROM experience_treasures et WHERE et.treasure_id = $1 AND et.experience_id = $2)`,
    params,
  );
}

/** A link folded into the survivor's link to the same work on a merge, and the placements that moved. */
export interface FoldedLinks {
  links: { link: number; target: number }[];
  added: { link: number; membership: number }[];
  removed: { link: number; membership: number }[];
}

/**
 * Fold the folded place's links into the survivor's where both link one work
 * (ADR-0086 decision 4): the folded link's placements move onto the survivor's
 * link, whose state stands; the folded link stays on the folded place.
 */
export async function foldLinks(
  client: PoolClient,
  folded: LockedExperience,
  survivor: LockedExperience,
): Promise<FoldedLinks> {
  const pairs = await client.query<{ link: number; target: number }>(
    `SELECT f.id AS link, s.id AS target
       FROM experience_treasures f
       JOIN experience_treasures s ON s.experience_id = $2 AND s.treasure_id = f.treasure_id
      WHERE f.experience_id = $1
      ORDER BY f.id`,
    [folded.id, survivor.id],
  );
  const links = pairs.rows;
  if (links.length === 0) return { links, added: [], removed: [] };
  const from = links.map(pair => pair.link);
  const added = await client.query<{ link: number; membership: number }>(
    `INSERT INTO experience_treasure_placements (link_id, membership_id)
     SELECT pair.target, p.membership_id
       FROM unnest($1::int[], $2::int[]) AS pair(link, target)
       JOIN experience_treasure_placements p ON p.link_id = pair.link
     ON CONFLICT DO NOTHING
     RETURNING link_id AS link, membership_id AS membership`,
    [from, links.map(pair => pair.target)],
  );
  const removed = await client.query<{ link: number; membership: number }>(
    `DELETE FROM experience_treasure_placements WHERE link_id = ANY($1::int[])
     RETURNING link_id AS link, membership_id AS membership`,
    [from],
  );
  return { links, added: added.rows, removed: removed.rows };
}

/** Undo `foldLinks`: the folded links get their own placements back. */
export async function unfoldLinks(client: PoolClient, record: FoldedLinks): Promise<void> {
  if (record.links.length === 0) return;
  await client.query(
    `DELETE FROM experience_treasure_placements p
      USING unnest($1::int[], $2::int[]) AS gained(link, membership)
      WHERE p.link_id = gained.link AND p.membership_id = gained.membership`,
    [record.added.map(row => row.link), record.added.map(row => row.membership)],
  );
  await client.query(
    `INSERT INTO experience_treasure_placements (link_id, membership_id)
     SELECT * FROM unnest($1::int[], $2::int[]) ON CONFLICT DO NOTHING`,
    [record.removed.map(row => row.link), record.removed.map(row => row.membership)],
  );
}

/**
 * Move work links from one place to another (ADR-0086): every link of the
 * folded place whose work the survivor does not link already, on a merge, or
 * the ones a merge moved, named, on its undo.
 */
export async function moveLinks(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE experience_treasures f SET experience_id = $2
      WHERE f.experience_id = $1 AND ($3::int[] IS NULL OR f.id = ANY($3::int[]))
        AND NOT EXISTS (SELECT 1 FROM experience_treasures s WHERE s.experience_id = $2 AND s.treasure_id = f.treasure_id)
      RETURNING f.id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}
