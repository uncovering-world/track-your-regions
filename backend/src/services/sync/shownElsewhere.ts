/**
 * The works another kind already shows a reader (ADR-0103).
 *
 * A kind that would take a place only for a work it holds asks first whether
 * the work is on a card already: the Uffizi's Venus de' Medici is on the
 * Uffizi's art-museum card, so Archaeology has no question to ask about the
 * Uffizi for it. "On a card" is the reader's own test — the work published,
 * its link a reader may see, at a place a reader is offered — with one thing
 * more: the place is offered through a membership of *another* source. A place
 * the asking source alone offers is its own answer, and counting it would
 * refuse on its next run the museum a curator took for that work.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, membershipOfferedSql } from '../../db/membership.js';
import { linkedForReaderSql, publishedContentSql } from '../../db/readerPredicates.js';

/**
 * The ids every source outside `sourceIds` knows the places it offers a reader
 * by: an admitted membership a curator has passed or that arrived ungated.
 * Public Art reads it to tell a work held at a venue another kind offers,
 * which that kind takes (ADR-0102), from one stranded on the grounds of a
 * venue none offers (#1444). The asking pass's own places are left out, its
 * sibling sources' as well as its own (ADR-0132): a place only they offer has
 * no other kind to take the work, since Monuments & memorials holds no works
 * to take the obelisk on Monas's grounds. A Wikidata source's ids are item
 * ids; UNESCO's are its list numbers, which no chain of items ever names.
 */
export async function placesOtherSourcesOffer(sourceIds: readonly number[]): Promise<Set<string>> {
  const result = await pool.query<{ external_id: string }>(
    `SELECT DISTINCT m.external_id FROM ${MEMBERSHIPS} m
      WHERE m.source_id <> ALL($1::int[]) AND ${membershipOfferedSql('m')}`,
    [sourceIds],
  );
  return new Set(result.rows.map((row) => row.external_id));
}

/** The item ids of the works a reader sees on the card of a place another source offers. */
export async function worksShownByOtherSources(sourceId: number): Promise<Set<string>> {
  const result = await pool.query<{ external_id: string }>(
    `SELECT DISTINCT t.external_id
       FROM treasures t
       JOIN experience_treasures et ON et.treasure_id = t.id
       JOIN experiences e ON e.id = et.experience_id
      WHERE ${publishedContentSql('t')}
        AND ${linkedForReaderSql('e', 'et')}
        AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m
                     WHERE m.experience_id = e.id AND m.source_id <> $1 AND ${membershipOfferedSql('m')})`,
    [sourceId],
  );
  return new Set(result.rows.map((row) => row.external_id));
}
