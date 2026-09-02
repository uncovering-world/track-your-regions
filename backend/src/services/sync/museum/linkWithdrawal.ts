/**
 * What happens to a museum's links once its works are written: the ones the
 * source places here again get their place back, and the ones it no longer
 * places here are marked (ADR-0044).
 *
 * Its own file rather than two more statements in `treasureWriter.ts`, which
 * was approaching the development guide's line, and because the two arms are a
 * responsibility of their own — they act on the museum's *other* links, the
 * ones the loop never touched — with a rule about visibility that has to be
 * read on its own to be believed.
 *
 * Both are set-based, once per museum after every work is written, and in one
 * transaction. The order is the safety: a museum whose write throws part-way
 * never reaches either arm, so nothing is marked on the strength of a list the
 * run did not finish. The transaction is the other half of it: a restore that
 * landed while the mark failed would be a return the run's record never
 * carries, and a retry could not tell it had happened. The writer's own promise
 * — floor first, withdrawal second — is kept by the caller through `withdraw`.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../../db/index.js';
import { OBJECT_LOCK } from '../../../db/locks.js';
import type { ContentItem } from '../types.js';

/** What the two arms compare the museum's links against. */
export interface LinkReconciliation {
  /** Every work the run offers here, by the id the upsert answered with. */
  offered: number[];
  /**
   * Works this run places at another admitted museum and not here, by the
   * source's own id — the ones whose visible link is held while their new
   * place is not yet readable (decision 5). From the run's proposal, not the
   * table: the new museum may be written after this one in the same run.
   */
  placedElsewhere: string[];
  /**
   * Whether the run cleared the works coverage floor. False marks nothing; the
   * restore runs either way, since restoring is never what a short run gets
   * wrong.
   */
  withdraw: boolean;
}

/** What the arms did, named as the record names things (ADR-0026 decision 4). */
export interface LinkDelta {
  returned: ContentItem[];
  withdrawn: ContentItem[];
}

/** A row as both statements return it: the work's name and reference. */
function named(rows: { name: string | null; external_id: string | null }[]): ContentItem[] {
  return rows.map(row => ({ name: row.name, ref: row.external_id }));
}

/**
 * Give a marked link its place back where the source places the work here again.
 *
 * Every run, whatever the floor said — ADR-0021's one direction, a level down,
 * and the same arm a point has. The link keeps the curation state it had, so a
 * link a curator passed before it was marked is on show again at once, exactly
 * as a returned point is. Named from the stored work rather than the offer,
 * because a claimed name is the one a reader will find.
 */
async function restore(
  client: PoolClient, experienceId: number, offered: number[],
): Promise<ContentItem[]> {
  const result = await client.query(
    `UPDATE experience_treasures et
        SET missing_since = NULL
       FROM treasures t
      WHERE et.experience_id = $1
        AND t.id = et.treasure_id
        AND et.missing_since IS NOT NULL
        AND et.treasure_id = ANY($2::int[])
      RETURNING t.name, t.external_id`,
    [experienceId, offered],
  );
  return named(result.rows);
}

/**
 * Mark the links of works the run no longer places here. Marked, never
 * deleted: the row is what a person's viewed record points at (ADR-0022).
 *
 * `missing_since IS NULL` restricts this to links going missing *now* — a link
 * unoffered for the fifth run running was first observed missing once, and
 * rewriting it every run would churn the table to say nothing new.
 *
 * **A visible link is held while the work's new place is not yet readable.**
 * A gated source may not overwrite what a reader can already see (ADR-0025
 * decision 5), and a work that moved from one museum to another under a gate
 * arrives at the new one `pending`: marking the old link at once would take the
 * work off every reader's screen until a curator publishes the new one. So a
 * link a reader can see — its museum, itself and its work all past the gate —
 * is passed over while this run places the same work at another admitted
 * museum (`placedElsewhere`, from the proposal) and no readable link of it
 * stands anywhere yet: one that is offered, past the gate, at a museum past the
 * gate and not refused.
 *
 * The proposal rather than the table alone, and that is load-bearing: the new
 * museum may be written after this one in the same run, so a hold that looked
 * for the new link in the table would find nothing and mark — the work visible
 * at neither museum until a curator published the new link, the very state the
 * hold exists to prevent. And a readable twin, not merely an existing one: a
 * museum still `pending` under a switched-off gate holds `auto` links no reader
 * can see.
 *
 * No pointer column and nothing to release, unlike a point's deferral: the
 * question is asked again on every run, and the mark lands on the first run
 * after the arrival is readable — under an ungated source with a visible new
 * museum written after this one, on the very next run. It costs holding a link
 * the source really did drop for as long as the work's new place is unread,
 * which is the visible mistake rather than the invisible one. An unread link
 * costs a reader nothing when it goes and is marked at once; so is a link of a
 * work the run places nowhere, whatever unread links of it stand elsewhere.
 *
 * The visibility terms repeat `linkedForReaderSql` and the work's own gate
 * rather than importing them — no service depends on a controller module —
 * and have to track that definition.
 */
async function mark(
  client: PoolClient, experienceId: number, offered: number[], placedElsewhere: string[],
): Promise<ContentItem[]> {
  const result = await client.query(
    `UPDATE experience_treasures et
        SET missing_since = NOW()
       FROM treasures t
      WHERE et.experience_id = $1
        AND t.id = et.treasure_id
        AND et.missing_since IS NULL
        AND NOT (et.treasure_id = ANY($2::int[]))
        AND NOT (
          -- A link a reader can see: the museum, the link and the work, all
          -- past the gate (linkedForReaderSql, plus the work's own state)...
          et.curation_state <> 'pending'
          AND t.curation_state <> 'pending'
          AND EXISTS (
            SELECT 1 FROM experiences e
             WHERE e.id = et.experience_id
               AND e.curation_state <> 'pending'
               AND e.admission <> 'refused'
          )
          -- ...of a work this run places at another admitted museum...
          AND t.external_id = ANY($3::text[])
          -- ...with no readable link of it standing anywhere yet: the hold.
          AND NOT EXISTS (
            SELECT 1 FROM experience_treasures twin
              JOIN experiences te ON te.id = twin.experience_id
             WHERE twin.treasure_id = et.treasure_id
               AND twin.id <> et.id
               AND twin.missing_since IS NULL
               AND twin.curation_state <> 'pending'
               AND te.curation_state <> 'pending'
               AND te.admission <> 'refused'
          )
        )
      RETURNING t.name, t.external_id`,
    [experienceId, offered, placedElsewhere],
  );
  return named(result.rows);
}

/**
 * The museum's other links, reconciled against what the run offered here.
 *
 * Empty offered list: an admitted museum with no works is not a shape the
 * pipeline produces (a museum is admitted for a work it holds), and is read as
 * nothing to compare rather than everything to withdraw.
 */
export async function reconcileLinks(
  experienceId: number,
  { offered, placedElsewhere, withdraw }: LinkReconciliation,
): Promise<LinkDelta> {
  if (offered.length === 0) return { returned: [], withdrawn: [] };

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    // **The object first, then its works** — the rule every transaction that
    // locks a row of an object's contents follows (`OBJECT_LOCK`, `db/locks.ts`),
    // and this one is under it the moment it holds one link's lock while asking
    // for another: a curator publishing this museum's works holds the object
    // and wants those same link rows. Serialised on the object, neither can be
    // the far side of a cycle. The rest of `upsertMuseumTreasures` stays
    // outside the rule for the reason `locks.ts` gives — each of its
    // statements is its own transaction.
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId]);
    const returned = await restore(client, experienceId, offered);
    const withdrawn = withdraw ? await mark(client, experienceId, offered, placedElsewhere) : [];
    await client.query('COMMIT');
    return { returned, withdrawn };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed rather than pooled:
    // it would carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
