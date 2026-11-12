/**
 * The venues the place pass counted around the places of a kind that reads
 * them (ADR-0192, ADR-0194), kept for the curator (#2454): the pass reads them
 * for the surroundings verdict, and a curator weighing a crowded city reads
 * them beside the place's fame: Largo do Machado (Rio de Janeiro) holds its
 * place in Squares & streets by the 36 places to eat and drink around it.
 *
 * Keyed by the source and the item it knows the place by, not by membership:
 * the pool counts a candidate before the source's run writes a new arrival's
 * membership. A dry run and a pass that could not read the venue layer leave
 * the rows as they stand; the figure is no part of the score, so a failure to
 * keep it never stops the pass.
 */

import { pool, rollbackQuietly } from '../../../db/index.js';
import type { SurroundingsCut } from './surroundingsCut.js';
import type { SurroundingsPool } from './surroundingsPool.js';

/** A source whose kind reads the venues around its places, and the classes its places are of. */
export interface VenueSource {
  sourceId: number;
  classes: ReadonlySet<string>;
}

/** One place's venues as the pass counted them: around its point within `radiusM`, or per 100 m along `alongM` of its line. */
export interface VenueFigure {
  sourceId: number;
  qid: string;
  venues: number;
  radiusM: number | null;
  alongM: number | null;
}

/**
 * The figures the pool read for every place of a source that reads venues, or
 * null where the pool read none: no source of the pass reads them, or the
 * layer in place keeps no venue.
 */
export function venueFigures(read: SurroundingsPool, sources: readonly VenueSource[], cut: Pick<SurroundingsCut, 'venueRadiusM'>): VenueFigure[] | null {
  const venues = read.venues;
  if (sources.length === 0 || !venues || venues.unread !== undefined) return null;
  const figures: VenueFigure[] = [];
  for (const [qid, figure] of venues.counts) {
    const classes = read.rows.get(qid)?.classes ?? [];
    const line = venues.along.get(qid);
    for (const source of sources) {
      if (!classes.some((c) => source.classes.has(c))) continue;
      figures.push({
        sourceId: source.sourceId, qid, venues: figure,
        radiusM: line ? null : cut.venueRadiusM,
        alongM: line ? Math.max(1, Math.round(line.metres)) : null,
      });
    }
  }
  return figures;
}

/**
 * Replace the kept figures of `sources` with what the pool read; nothing is
 * written where it read none. Answers the rows kept, or null.
 */
export async function keepVenueFigures(read: SurroundingsPool, sources: readonly VenueSource[], cut: Pick<SurroundingsCut, 'venueRadiusM'>): Promise<number | null> {
  const figures = venueFigures(read, sources, cut);
  if (figures === null) return null;
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    // One replacement per source at a time, rows or none: two passes that both
    // deleted before either inserted would leave both snapshots' rows. Taken in
    // id order, so two passes over several sources never wait on each other.
    const ids = [...new Set(sources.map((s) => s.sourceId))].sort((a, b) => a - b);
    for (const id of ids) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`place_venues:${id}`]);
    await client.query('DELETE FROM place_venues WHERE source_id = ANY($1::int[])', [ids]);
    await client.query(
      `INSERT INTO place_venues (source_id, qid, venues, radius_m, along_m)
       SELECT * FROM unnest($1::int[], $2::text[], $3::real[], $4::int[], $5::int[])`,
      [figures.map((f) => f.sourceId), figures.map((f) => f.qid), figures.map((f) => f.venues),
        figures.map((f) => f.radiusM), figures.map((f) => f.alongM)],
    );
    await client.query('COMMIT');
    return figures.length;
  } catch (error) {
    // A client whose ROLLBACK also failed is destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
