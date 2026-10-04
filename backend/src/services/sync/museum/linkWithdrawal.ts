/**
 * What happens to a museum's links once its works are written: the ones the
 * source places here again get their place back, and the ones it no longer
 * places here are marked (ADR-0044).
 *
 * Its own file rather than more statements in `treasureWriter.ts`, which was
 * approaching the development guide's line, and because `place`, `restore`
 * and `mark` are a responsibility of their own — they act on the museum's
 * links as a set once the loop is done, the ones it never touched included —
 * with a rule about visibility that has to be read on its own to be believed.
 *
 * **Each run answers for its own placements** (ADR-0084, #1252). A place two
 * sources fill holds what each source places there — the Louvre's paintings
 * through Art Museums, its finds through Archaeology — and a work both place is
 * one link. So a run records its own placement on every link it offers
 * (`experience_treasure_placements`; the link insert in `treasureWriter.ts`
 * records it as the link is born, so a museum whose write throws part-way
 * leaves no link it wrote unplaced, and `place` here records it on every link
 * offered, whoever inserted it). The mark takes away only the run's own
 * placement from a link it no longer offers, and a link is marked missing only
 * once no placement is left: the Art Museums run never marks the finds, and the
 * Archaeology run never the paintings. A link no membership places at all —
 * written by code that predates the placements — is any run's to mark, as every
 * link was before them.
 *
 * All three are set-based, once per museum after every work is written, and in one
 * transaction. The order is the safety: a museum whose write throws part-way
 * never reaches `reconcileLinks`, so nothing is marked on the strength of a list the
 * run did not finish. The transaction is the other half of it: a restore that
 * landed while the mark failed would be a return the run's record never
 * carries, and a retry could not tell it had happened. The writer's own promise
 * — floor first, withdrawal second — is kept by the caller through `withdraw`.
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../../db/index.js';
import { MEMBERSHIPS, placeOfferedSql } from '../../../db/membership.js';
import type { ContentItem } from '../types.js';
import { publishedContentSql } from '../../../db/readerPredicates.js';
import { lockExperience } from '../../../db/experienceWriter.js';

/** What `place`, `restore` and `mark` compare the museum's links against. */
export interface LinkReconciliation {
  /** The run's source, whose membership of this place the placements are. */
  sourceId: number;
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
 * The run's membership of this place, as a scalar subquery: the one its source
 * brought (`$1` the place, the given placeholder the source).
 */
const runMembershipSql = (sourceParam: string) =>
  `(SELECT id FROM ${MEMBERSHIPS} WHERE experience_id = $1 AND source_id = ${sourceParam})`;

/**
 * Record the run's placement on every link it offers here, the work both
 * sources place included. Before `restore` and `mark`, which read it.
 */
async function place(
  client: PoolClient, experienceId: number, sourceId: number, offered: number[],
): Promise<void> {
  await client.query(
    `INSERT INTO experience_treasure_placements (link_id, membership_id)
     SELECT et.id, ${runMembershipSql('$3')}
       FROM experience_treasures et
      WHERE et.experience_id = $1
        AND et.treasure_id = ANY($2::int[])
        AND ${runMembershipSql('$3')} IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [experienceId, offered, sourceId],
  );
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
 * Only a link the run's own membership places, and only its own placement
 * goes: the link itself is marked once no other membership places it, so a
 * work another source still places here stays on show (ADR-0084). A held link
 * keeps the run's placement too, since the hold below is the run declining to
 * withdraw it yet.
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
 * The link's and the work's visibility terms repeat `linkedForReaderSql` and
 * the work's own gate rather than importing them — no service depends on a
 * controller module — and have to track that definition; the museum's own
 * offer is the shared `placeOfferedSql` (`db/membership.ts`), which both
 * layers read.
 */
async function mark(
  client: PoolClient, experienceId: number, sourceId: number, offered: number[], placedElsewhere: string[],
): Promise<ContentItem[]> {
  const result = await client.query(
    `WITH candidate AS (
       SELECT et.id
         FROM experience_treasures et
         JOIN treasures t ON t.id = et.treasure_id
        WHERE et.experience_id = $1
          AND et.missing_since IS NULL
          AND NOT (et.treasure_id = ANY($2::int[]))
          -- The run's own, or nobody's: a link no membership places is any
          -- run's to withdraw, as every link was before the placements.
          AND (EXISTS (SELECT 1 FROM experience_treasure_placements mine
                        WHERE mine.link_id = et.id AND mine.membership_id = ${runMembershipSql('$4')})
               OR NOT EXISTS (SELECT 1 FROM experience_treasure_placements any_placement
                               WHERE any_placement.link_id = et.id))
          AND NOT (
          -- A link a reader can see: the museum, the link and the work, all
          -- past the gate (linkedForReaderSql, plus the work's own state)...
          ${publishedContentSql('et')}
          AND ${publishedContentSql('t')}
          AND EXISTS (
            SELECT 1 FROM experiences e
             WHERE e.id = et.experience_id
               AND ${placeOfferedSql('e')}
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
               AND ${publishedContentSql('twin')}
               AND ${placeOfferedSql('te')}
          )
        )
     ), unplaced AS (
       DELETE FROM experience_treasure_placements pl
        USING candidate c
        WHERE pl.link_id = c.id
          AND pl.membership_id = ${runMembershipSql('$4')}
       RETURNING pl.link_id, pl.membership_id
     )
     -- The statement's snapshot still holds the placements the CTE deleted, so
     -- "no placement left" excludes them by name.
     UPDATE experience_treasures et
        SET missing_since = NOW()
       FROM treasures t
      WHERE et.id IN (SELECT id FROM candidate)
        AND t.id = et.treasure_id
        AND NOT EXISTS (
          SELECT 1 FROM experience_treasure_placements other
           WHERE other.link_id = et.id
             AND (other.link_id, other.membership_id) NOT IN (SELECT link_id, membership_id FROM unplaced)
        )
      RETURNING t.name, t.external_id`,
    [experienceId, offered, placedElsewhere, sourceId],
  );
  return named(result.rows);
}

/**
 * The museum's other links, reconciled against what the run offered here.
 *
 * An empty offered list is compared like any other, and marks every link
 * the museum holds — floor permitting, as always. Reading it as "nothing to
 * compare" would assume an admitted museum with no works is not a shape the
 * pipeline produces, and it is one (#890): a museum
 * admitted for what it is holds only what the venue-side read found, and
 * when the next run refuses that object — the Bendegó meteorite at the
 * Museu Nacional, live run 128 — the museum offers nothing and the stale
 * link has to go, or a meteorite stays a pending find of an archaeology
 * museum for as long as nothing else arrives there. The floor (ADR-0044)
 * is what guards a short run; a museum the run wrote and offered nothing at
 * is not a short run but an answer.
 */
export async function reconcileLinks(
  experienceId: number,
  { sourceId, offered, placedElsewhere, withdraw }: LinkReconciliation,
): Promise<LinkDelta> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    // **The object first, then its works** — the rule every transaction that
    // locks a row of an object's contents follows (`OBJECT_LOCK`, `db/locks.ts`),
    // and this one is under it the moment it holds one link's lock while asking
    // for another: a curator publishing this museum's works holds the object
    // and wants those same link rows. Serialised on the object, neither can be
    // the far side of a cycle. The rest of `upsertVenueTreasures` stays
    // outside the rule for the reason `locks.ts` gives — each of its
    // statements is its own transaction.
    await lockExperience(client, experienceId);
    await place(client, experienceId, sourceId, offered);
    const returned = await restore(client, experienceId, offered);
    const withdrawn = withdraw ? await mark(client, experienceId, sourceId, offered, placedElsewhere) : [];
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
