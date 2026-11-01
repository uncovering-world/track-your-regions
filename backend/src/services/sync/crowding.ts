/**
 * What a reader is shown in a crowded city (ADR-0172, #2201): a place is
 * shown unless ten places of the same kind and type within 10 km of it are
 * better known. This is the run's after-step half of it. It measures how well
 * known every membership of a kind that declares the rule is, from the
 * workbench's three signals, and writes that to the serving side
 * (`membership_fame`), then asks the schema to score and recount the whole
 * catalogue (`refresh_crowding()`). Between runs the schema recounts around a
 * place whenever its candidacy changes (`crowding_follows_membership()`,
 * `crowding_follows_place()`).
 *
 * A signal whose source is not in place is left as last measured rather than
 * read as zero: a readership year not yet folded, a subset or a Wikivoyage
 * build missing would otherwise rank every place as unknown and hide the wrong
 * ones.
 */

import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { latestSubset, entitiesAreHeld } from '../dumps/wikidata/subsetTables.js';
import { readershipYear, readWorks } from '../dumps/readership/workReadership.js';
import { guideEditions, latestUsage } from '../dumps/wikivoyage/usageTables.js';
import { subsetWikipediaEditions } from './subset/kit.js';

/** What one refresh did, for the run's closing line. */
export interface CrowdingRefresh {
  /** Memberships measured. */
  measured: number;
  /** The signals left as last measured, since their source is not in place. */
  stale: Array<'readers' | 'guides' | 'editions'>;
  /** Memberships crowded out once it ended. */
  crowded: number;
}

/** Measure every membership the rule reads, then score and recount the catalogue. */
export async function refreshCrowding(): Promise<CrowdingRefresh> {
  const members = await pool.query<{ id: number; qid: string }>(
    `SELECT m.id, m.external_id AS qid
       FROM ${MEMBERSHIPS} m
       JOIN ${KINDS} k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      WHERE m.external_id ~ '^Q[1-9][0-9]*$'`,
  );
  const qids = [...new Set(members.rows.map(row => row.qid))];
  const year = await readershipYear();
  const subset = (await latestSubset()) && (await entitiesAreHeld());
  const usage = await latestUsage();
  const [readers, editions, guides] = await Promise.all([
    year ? readWorks(year, qids).then(read => read.views) : null,
    subset ? subsetWikipediaEditions(qids) : null,
    usage ? guideEditions(qids) : null,
  ]);
  const stale: CrowdingRefresh['stale'] = [];
  if (!readers) stale.push('readers');
  if (!guides) stale.push('guides');
  if (!editions) stale.push('editions');

  // Null where a source is not in place, so the statement keeps what was
  // measured last; a membership measured for the first time then counts zero.
  const ids = members.rows.map(row => row.id);
  const read = (signal: Map<string, number> | null) =>
    members.rows.map(row => (signal ? signal.get(row.qid) ?? 0 : null));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO membership_fame (membership_id, readers, guide_editions, wikipedia_editions, measured_at)
       SELECT i.id, COALESCE(i.readers, old.readers, 0), COALESCE(i.guides, old.guide_editions, 0),
              COALESCE(i.editions, old.wikipedia_editions, 0), NOW()
         FROM unnest($1::int[], $2::int[], $3::int[], $4::int[]) AS i(id, readers, guides, editions)
         LEFT JOIN membership_fame old ON old.membership_id = i.id
       ON CONFLICT (membership_id) DO UPDATE
          SET readers = EXCLUDED.readers, guide_editions = EXCLUDED.guide_editions,
              wikipedia_editions = EXCLUDED.wikipedia_editions, measured_at = EXCLUDED.measured_at`,
      [ids, read(readers), read(guides), read(editions)],
    );
    // A membership whose kind no longer declares the rule, or whose item went.
    await client.query('DELETE FROM membership_fame WHERE membership_id <> ALL($1::int[])', [ids]);
    const refreshed = await client.query<{ crowded: number }>('SELECT refresh_crowding() AS crowded');
    await client.query('COMMIT');
    return { measured: ids.length, stale, crowded: refreshed.rows[0].crowded };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The run's closing clause for a refresh. */
export function crowdingSentence(refresh: CrowdingRefresh): string {
  const hidden = `${refresh.crowded} place${refresh.crowded === 1 ? '' : 's'} crowded out of crowded cities`;
  if (refresh.stale.length === 0) return hidden;
  const names = { readers: 'readers', guides: 'Wikivoyage use', editions: 'Wikipedia editions' };
  return `${hidden}, with ${refresh.stale.map(signal => names[signal]).join(' and ')} as last measured, since that source is not in place`;
}
